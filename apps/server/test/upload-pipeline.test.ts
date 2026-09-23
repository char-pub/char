/**
 * 上传状态机的集成测试（Postgres + MinIO）：申请上传 → 签名 PUT → 完成 → worker 处理。
 * 所有图片都在运行时用 sharp 合成，不提交二进制样本。
 */
import { sha256Bytes } from "@char-pub/core";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Services } from "../src/api/app.js";
import { register as registerUploads } from "../src/api/routes/uploads.js";
import { createApi } from "../src/api/server.js";
import type { Principal } from "../src/authz/authorize.js";
import {
  assetMeta,
  authUser,
  blockedDigests,
  featureFlags,
  uploads,
} from "../src/db/schema/index.js";
import { QUEUE_NAMES } from "../src/jobs/definitions.js";
import { JobQueue } from "../src/jobs/queue.js";
import { FlagCache } from "../src/ops/flags.js";
import { type CsamScanner, noopScanner } from "../src/upload/csam.js";
import { expireUploads, type PipelineDeps, RetryableUploadError } from "../src/upload/pipeline.js";
import { handleUploadJob } from "../src/worker/upload.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

let t: TestDatabase;
let queue: JobQueue;
let services: Services;
let api: ReturnType<typeof createApi>;
let flagNow = 0;
let now = new Date("2026-09-22T12:00:00Z");

const ALICE = uuidv7();
const MALLORY = uuidv7();
const NEWBIE = uuidv7();
const SYSTEM = uuidv7();

/** 测试专用的 session 解析：读取 `x-test-user` 头。只存在于测试代码中。 */
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
    { id: MALLORY, email: "mallory@example.com", name: "Mallory", createdAt: old },
    { id: NEWBIE, email: "new@example.com", name: "New", createdAt: now },
    { id: SYSTEM, email: "system@char.pub", name: "system", createdAt: old },
  ]);
  const flags = new FlagCache(t.app.db, () => flagNow, 5000);
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

function post(path: string, user: string | null, body?: unknown) {
  return api.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(user ? { "x-test-user": user } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function get(path: string, user: string | null) {
  return api.request(path, { headers: user ? { "x-test-user": user } : {} });
}

/** 走完整条上传路径：申请 → PUT → 完成。返回上传 ID。 */
async function upload(bytes: Uint8Array, contentType: string, user = ALICE, declared?: string) {
  const res = await post("/v1/uploads", user, {
    purpose: "asset",
    content_type: contentType,
    size: bytes.byteLength,
    sha256: declared ?? sha256Bytes(bytes),
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
  const done = await post(`/v1/uploads/${created.upload}/complete`, user);
  expect(done.status).toBe(202);
  return created.upload;
}

async function gpsJpeg(): Promise<Uint8Array> {
  const buf = await sharp({ create: { width: 64, height: 32, channels: 3, background: "#3a6" } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExifMerge({
      IFD0: { Make: "TestCam" },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "35/1 41/1 0/1",
        GPSLongitudeRef: "E",
        GPSLongitude: "139/1 41/1 0/1",
      },
    })
    .toBuffer();
  return new Uint8Array(buf);
}

async function solidPng(w = 32, h = 32, color = "#c35"): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width: w, height: h, channels: 3, background: color } })
      .png()
      .toBuffer(),
  );
}

describe("upload → ready", () => {
  it("strips EXIF including GPS and records the asset as not scanned", async () => {
    const jpeg = await gpsJpeg();
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();
    const id = await upload(jpeg, "image/jpeg");

    const jobs = await queue.boss.findJobs(QUEUE_NAMES.uploadProcess, { key: `upload:${id}` });
    expect(jobs).toHaveLength(1);

    await handleUploadJob(deps(), { upload_id: id });
    const status = await (await get(`/v1/uploads/${id}`, ALICE)).json();
    expect(status).toMatchObject({
      upload: id,
      status: "ready",
      blob: { media_type: "image/webp" },
    });

    const webp = await services.cas.getBlob("private", status.blob.digest);
    const meta = await sharp(webp).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(Buffer.from(webp).includes(Buffer.from("TestCam"))).toBe(false);
    // 按方向信息旋转后宽高互换。
    expect([meta.width, meta.height]).toEqual([32, 64]);

    const [am] = await t.app.db
      .select()
      .from(assetMeta)
      .where(eq(assetMeta.digest, status.blob.digest));
    expect(am).toMatchObject({
      scanStatus: "not_scanned",
      mediaType: "image/webp",
      width: 32,
      height: 64,
    });

    // 原件已从 uploads 桶删除。
    const [row] = await t.app.db.select().from(uploads).where(eq(uploads.id, id));
    expect(await services.cas.exists("uploads", row?.stagingKey ?? "")).toBe(false);
  });

  it("is idempotent when the job is delivered twice", async () => {
    const id = await upload(await solidPng(20, 20, "#123"), "image/png");
    await handleUploadJob(deps(), { upload_id: id });
    const [first] = await t.app.db.select().from(uploads).where(eq(uploads.id, id));
    await handleUploadJob(deps(), { upload_id: id });
    const [second] = await t.app.db.select().from(uploads).where(eq(uploads.id, id));
    expect(second).toEqual(first);
  });
});

describe("malicious and broken uploads are rejected and their originals deleted", () => {
  async function expectRejected(
    bytes: Uint8Array,
    type: string,
    reason: RegExp,
    declared?: string,
  ) {
    const id = await upload(bytes, type, ALICE, declared);
    await handleUploadJob(deps(), { upload_id: id });
    const [row] = await t.app.db.select().from(uploads).where(eq(uploads.id, id));
    expect(row?.status).toBe("rejected");
    expect(row?.rejectReason).toMatch(reason);
    expect(await services.cas.exists("uploads", row?.stagingKey ?? "")).toBe(false);
  }

  it("rejects SVG disguised as PNG", async () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    await expectRejected(svg, "image/png", /upload\.unsupported_type/);
  });

  it("rejects a PNG + ZIP polyglot", async () => {
    const png = await solidPng();
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(40).fill(7)]);
    const poly = new Uint8Array(png.length + zip.length);
    poly.set(png);
    poly.set(zip, png.length);
    await expectRejected(poly, "image/png", /upload\.trailing_data/);
  });

  it("rejects a pixel bomb", async () => {
    const bomb = new Uint8Array(
      await sharp({ create: { width: 9000, height: 9000, channels: 3, background: "#000" } })
        .png({ compressionLevel: 9 })
        .toBuffer(),
    );
    await expectRejected(bomb, "image/png", /^upload\.too_many_pixels$/);
  });

  it("rejects a file whose content does not match the declared sha256", async () => {
    const png = await solidPng(8, 8);
    await expectRejected(png, "image/png", /upload\.digest_mismatch/, `sha256:${"0".repeat(64)}`);
  });
});

describe("access control, quotas and kill switch", () => {
  it("hides uploads from everyone but the uploader", async () => {
    const id = await upload(await solidPng(10, 10, "#abc"), "image/png");
    expect((await get(`/v1/uploads/${id}`, MALLORY)).status).toBe(404);
    expect((await get(`/v1/uploads/${id}`, null)).status).toBe(404);
    expect((await post(`/v1/uploads/${id}/complete`, MALLORY)).status).toBe(404);
    expect((await get("/v1/uploads/not-a-uuid", ALICE)).status).toBe(404);
  });

  it("requires sign-in", async () => {
    const res = await post("/v1/uploads", null, {
      purpose: "asset",
      content_type: "image/png",
      size: 10,
      sha256: `sha256:${"1".repeat(64)}`,
    });
    expect(res.status).toBe(401);
  });

  it("enforces type and size limits per purpose", async () => {
    const base = { sha256: `sha256:${"2".repeat(64)}` };
    const tooBig = await post("/v1/uploads", ALICE, {
      ...base,
      purpose: "asset",
      content_type: "image/png",
      size: 9 * 1024 * 1024,
    });
    expect(tooBig.status).toBe(413);
    const wrongType = await post("/v1/uploads", ALICE, {
      ...base,
      purpose: "asset",
      content_type: "application/json",
      size: 10,
    });
    expect(wrongType.status).toBe(422);
    const bigJson = await post("/v1/uploads", ALICE, {
      ...base,
      purpose: "import",
      content_type: "application/json",
      size: 6 * 1024 * 1024,
    });
    expect(bigJson.status).toBe(413);
  });

  it("refuses to start an upload of blocked content without saying why", async () => {
    const digest = `sha256:${"3".repeat(64)}`;
    await t.app.db.insert(blockedDigests).values({ digest, reason: "policy.illegal" });
    const res = await post("/v1/uploads", ALICE, {
      purpose: "asset",
      content_type: "image/png",
      size: 10,
      sha256: digest,
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "upload.rejected" });
  });

  it("applies a lower daily quota to new accounts, with Retry-After", async () => {
    const body = {
      purpose: "asset",
      content_type: "image/png",
      size: 10,
      sha256: `sha256:${"4".repeat(64)}`,
    };
    let last: Response | undefined;
    for (let i = 0; i < 21; i++) last = await post("/v1/uploads", NEWBIE, body);
    expect(last?.status).toBe(429);
    expect(await last?.json()).toMatchObject({ code: "rate_limited" });
    expect(Number(last?.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("returns 503 when uploads are switched off", async () => {
    await t.app.db
      .insert(featureFlags)
      .values({ key: "uploads", enabled: false, reason: "incident drill" });
    flagNow += 10_000;
    const res = await post("/v1/uploads", ALICE, {
      purpose: "asset",
      content_type: "image/png",
      size: 10,
      sha256: `sha256:${"5".repeat(64)}`,
    });
    expect(res.status).toBe(503);
    await t.app.db.delete(featureFlags).where(eq(featureFlags.key, "uploads"));
    flagNow += 10_000;
  });

  it("refuses to complete an upload whose file was never uploaded", async () => {
    const res = await post("/v1/uploads", ALICE, {
      purpose: "asset",
      content_type: "image/png",
      size: 10,
      sha256: `sha256:${"6".repeat(64)}`,
    });
    const { upload: id } = (await res.json()) as { upload: string };
    expect((await post(`/v1/uploads/${id}/complete`, ALICE)).status).toBe(409);
  });
});

describe("scanner outages and expiry", () => {
  it("keeps the upload in processing and asks for a retry when the scanner is unavailable", async () => {
    const id = await upload(await solidPng(12, 12, "#321"), "image/png");
    const down: CsamScanner = {
      provider: "fake",
      scan: async () => ({ status: "unavailable", provider: "fake", retry_after_seconds: 5 }),
    };
    await expect(handleUploadJob(deps(down), { upload_id: id })).rejects.toBeInstanceOf(
      RetryableUploadError,
    );
    const [row] = await t.app.db.select().from(uploads).where(eq(uploads.id, id));
    expect(row?.status).toBe("processing");
    // 扫描恢复后正常完成。
    await handleUploadJob(deps(), { upload_id: id });
    const [after] = await t.app.db.select().from(uploads).where(eq(uploads.id, id));
    expect(after?.status).toBe("ready");
  });

  it("expires unfinished uploads after 24 hours", async () => {
    const res = await post("/v1/uploads", ALICE, {
      purpose: "asset",
      content_type: "image/png",
      size: 10,
      sha256: `sha256:${"7".repeat(64)}`,
    });
    const { upload: id } = (await res.json()) as { upload: string };
    const saved = now;
    now = new Date(saved.getTime() + 25 * 60 * 60 * 1000);
    expect(await expireUploads(deps())).toBeGreaterThanOrEqual(1);
    const [row] = await t.app.db.select().from(uploads).where(eq(uploads.id, id));
    expect(row).toMatchObject({ status: "rejected", rejectReason: "upload.expired" });
    now = saved;
  });
});
