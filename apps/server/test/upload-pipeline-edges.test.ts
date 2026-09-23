/**
 * 上传处理中不常走到的路径（Postgres + MinIO）：原件或记录不一致、处理中途被列入黑名单、
 * 意外错误、并发的重复任务、扫描结果为 clear、未到期的上传、补扫时的缺失与服务中断。
 * 图片在运行时用 sharp 合成。
 */
import { sha256Bytes } from "@char-pub/core";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Services } from "../src/api/app.js";
import { register as registerUploads } from "../src/api/routes/uploads.js";
import { createApi } from "../src/api/server.js";
import type { Principal } from "../src/authz/authorize.js";
import { assetMeta, authUser, blockedDigests, uploads } from "../src/db/schema/index.js";
import { JobQueue } from "../src/jobs/queue.js";
import { FlagCache } from "../src/ops/flags.js";
import { type CsamScanner, noopScanner } from "../src/upload/csam.js";
import {
  expireUploads,
  type PipelineDeps,
  processUpload,
  rescanAll,
} from "../src/upload/pipeline.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

/** 让下一次图片处理抛出一个意外错误（不是 ImageRejected）。 */
const imageFault = vi.hoisted(() => ({ next: null as Error | null }));
vi.mock("../src/upload/image.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/upload/image.js")>();
  return {
    ...real,
    processImage: async (...args: Parameters<typeof real.processImage>) => {
      const fault = imageFault.next;
      imageFault.next = null;
      if (fault) throw fault;
      return real.processImage(...args);
    },
  };
});

let t: TestDatabase;
let queue: JobQueue;
let services: Services;
let api: ReturnType<typeof createApi>;
const now = new Date("2026-09-22T12:00:00Z");

const ALICE = uuidv7();
const SYSTEM = uuidv7();

const sessionPrincipal = async (req: Request): Promise<Principal | null> => {
  const id = req.headers.get("x-test-user");
  return id ? { kind: "user", user_id: id, banned: false } : null;
};

function deps(scanner: CsamScanner = noopScanner): PipelineDeps {
  return {
    db: t.app.db,
    cas: services.cas,
    queue,
    scanner,
    now: () => now,
    newId: () => uuidv7(),
    systemActorId: SYSTEM,
  };
}

beforeAll(async () => {
  t = await createTestDatabase();
  queue = new JobQueue({ connectionString: t.appUrl, max: 4 });
  queue.boss.on("error", () => {});
  await queue.start();
  const old = new Date("2026-01-01T00:00:00Z");
  await t.app.db.insert(authUser).values([
    { id: ALICE, email: "alice@example.com", name: "Alice", createdAt: old },
    { id: SYSTEM, email: "system@char.pub", name: "system", createdAt: old },
  ]);
  const flags = new FlagCache(t.app.db, () => 0, 5000);
  services = {
    db: t.app.db,
    cas: testCas(),
    queue,
    clock: { now: () => now },
    ids: { uuid: () => uuidv7() },
    flags: () => flags.current(),
    publicAssetBaseUrl: "https://assets.example",
  };
  api = createApi({
    services,
    originSecrets: [],
    allowedOrigins: [],
    sessionPrincipal,
    modules: [registerUploads],
  });
});
afterAll(async () => {
  await queue.stop();
  await t.drop();
});

function post(path: string, body?: unknown) {
  return api.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-user": ALICE },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** 申请 → PUT → 完成，返回处于 processing 状态的上传记录。 */
async function processingUpload(bytes: Uint8Array) {
  const res = await post("/v1/uploads", {
    purpose: "asset",
    content_type: "image/png",
    size: bytes.byteLength,
    sha256: sha256Bytes(bytes),
  });
  expect(res.status).toBe(201);
  const created = (await res.json()) as {
    upload: string;
    put_url: string;
    headers: Record<string, string>;
  };
  const put = await fetch(created.put_url, {
    method: "PUT",
    body: Buffer.from(bytes),
    headers: created.headers,
  });
  expect(put.status).toBe(200);
  expect((await post(`/v1/uploads/${created.upload}/complete`)).status).toBe(202);
  const [row] = await t.app.db.select().from(uploads).where(eq(uploads.id, created.upload));
  if (!row) throw new Error("upload row missing");
  expect(row.status).toBe("processing");
  return row;
}

/**
 * 每次调用尺寸与颜色都不同，保证重新编码后的 digest 不与其他用例重复（有损 WebP 会把相近的
 * 颜色编码成相同的字节，只换颜色不够）。
 */
let shade = 0;
async function png(): Promise<Uint8Array> {
  shade++;
  const hex = ((shade * 0x3f5a17) & 0xffffff).toString(16).padStart(6, "0");
  return new Uint8Array(
    await sharp({
      create: { width: 16 + shade, height: 16, channels: 3, background: `#${hex}` },
    })
      .png()
      .toBuffer(),
  );
}

async function row(id: string) {
  const [r] = await t.app.db.select().from(uploads).where(eq(uploads.id, id));
  return r;
}

describe("inconsistent uploads are rejected and their originals deleted", () => {
  it("skips an upload that does not exist", async () => {
    expect(await processUpload(deps(), uuidv7())).toEqual({ state: "skipped", reason: "missing" });
  });

  it("rejects an upload whose original is gone from storage", async () => {
    const u = await processingUpload(await png());
    await services.cas.deleteUpload(u.stagingKey);
    expect(await processUpload(deps(), u.id)).toEqual({
      state: "rejected",
      reason: "upload.missing_object",
    });
    expect(await row(u.id)).toMatchObject({
      status: "rejected",
      rejectReason: "upload.missing_object",
    });
  });

  it("rejects an original whose length differs from the recorded size", async () => {
    const u = await processingUpload(await png());
    await t.app.db
      .update(uploads)
      .set({ size: u.size + 1 })
      .where(eq(uploads.id, u.id));
    expect(await processUpload(deps(), u.id)).toMatchObject({ reason: "upload.size_mismatch" });
    expect(await services.cas.exists("uploads", u.stagingKey)).toBe(false);
  });

  it("rejects content that was blocked after the upload started", async () => {
    const bytes = await png();
    const u = await processingUpload(bytes);
    await t.app.db
      .insert(blockedDigests)
      .values({ digest: sha256Bytes(bytes), reason: "policy.illegal" });
    expect(await processUpload(deps(), u.id)).toMatchObject({
      state: "rejected",
      reason: "upload.blocked_content",
    });
    expect(await services.cas.exists("uploads", u.stagingKey)).toBe(false);
  });
});

describe("processing failures and races", () => {
  it("lets an unexpected processing error propagate so the job is retried", async () => {
    const u = await processingUpload(await png());
    imageFault.next = new Error("libvips crashed");
    await expect(processUpload(deps(), u.id)).rejects.toThrow("libvips crashed");
    // 上传没有被当作用户的问题拒绝，原件还在，重试时可以继续处理。
    expect((await row(u.id))?.status).toBe("processing");
    expect(await services.cas.exists("uploads", u.stagingKey)).toBe(true);
    expect((await processUpload(deps(), u.id)).state).toBe("ready");
  });

  it("records a clear scan with the provider and scan time", async () => {
    const u = await processingUpload(await png());
    const clear: CsamScanner = {
      provider: "fake-hash",
      scan: async () => ({ status: "clear", provider: "fake-hash" }),
    };
    const out = await processUpload(deps(clear), u.id);
    if (out.state !== "ready") throw new Error(`unexpected ${out.state}`);
    const [meta] = await t.app.db.select().from(assetMeta).where(eq(assetMeta.digest, out.blob));
    expect(meta).toMatchObject({ scanStatus: "clean", scanProvider: "fake-hash", scannedAt: now });
    expect((await row(u.id))?.result).toMatchObject({
      scan: { status: "clear", provider: "fake-hash" },
    });
  });

  it("does not overwrite the result of a duplicate job that finished first", async () => {
    const u = await processingUpload(await png());
    const winner = { original_digest: "sha256:winner" };
    // 扫描期间另一个 worker 已经把这个上传处理完。
    const racing: CsamScanner = {
      provider: "none",
      scan: async () => {
        await t.app.db
          .update(uploads)
          .set({ status: "ready", result: winner })
          .where(eq(uploads.id, u.id));
        return { status: "not_scanned", provider: "none" };
      },
    };
    const out = await processUpload(deps(racing), u.id);
    if (out.state !== "ready") throw new Error(`unexpected ${out.state}`);
    expect((await row(u.id))?.result).toEqual(winner);
    const metas = await t.app.db.select().from(assetMeta).where(eq(assetMeta.digest, out.blob));
    expect(metas).toHaveLength(0);
  });
});

describe("expiry and rescans", () => {
  it("leaves uploads that have not expired yet", async () => {
    const res = await post("/v1/uploads", {
      purpose: "asset",
      content_type: "image/png",
      size: 10,
      sha256: `sha256:${"9".repeat(64)}`,
    });
    const { upload: id } = (await res.json()) as { upload: string };
    await expireUploads(deps());
    expect((await row(id))?.status).toBe("uploaded");
  });

  it("skips assets whose blob is missing and keeps unscanned ones when the scanner is down", async () => {
    const missing = `sha256:${"a".repeat(64)}`;
    await t.app.db
      .insert(assetMeta)
      .values({ digest: missing, width: 1, height: 1, mediaType: "image/webp" });
    const down: CsamScanner = {
      provider: "fake-hash",
      scan: async () => ({ status: "unavailable", provider: "fake-hash", retry_after_seconds: 60 }),
    };
    const before = await t.app.db
      .select({ digest: assetMeta.digest })
      .from(assetMeta)
      .where(eq(assetMeta.scanStatus, "not_scanned"));
    // 不传 pageSize，使用默认分页。
    const stats = await rescanAll({ ...deps(), scanner: down });
    expect(stats.scanned).toBe(0);
    expect(stats.matched).toBe(0);
    // 缺失 blob 的记录被跳过，不计入“扫描服务不可用”。
    expect(stats.unavailable).toBe(before.length - 1);
    const after = await t.app.db
      .select({ digest: assetMeta.digest })
      .from(assetMeta)
      .where(eq(assetMeta.scanStatus, "not_scanned"));
    expect(after.map((a) => a.digest).sort()).toEqual(before.map((b) => b.digest).sort());
  });
});
