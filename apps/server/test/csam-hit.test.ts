/**
 * CSAM 命中路径的集成测试。**不使用任何真实的 CSAM 素材**：图片全部是运行时合成的纯色图，
 * “命中”由一个替身扫描器返回。验证的是处置流程本身：隔离、证据保全、删除副本、锁定账号、
 * 黑名单、事件工单、审计，以及已被 Release 引用时的 tombstone 入队。
 */
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { sha256Bytes } from "@char-pub/core";
import { and, eq, isNull } from "drizzle-orm";
import sharp from "sharp";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Services } from "../src/api/app.js";
import { register as registerUploads } from "../src/api/routes/uploads.js";
import { createApi } from "../src/api/server.js";
import { verifyAuditChain } from "../src/audit/audit.js";
import { generateToken, hashToken, principalFromToken } from "../src/auth/tokens.js";
import type { Principal } from "../src/authz/authorize.js";
import {
  apiTokens,
  assetMeta,
  authSession,
  authUser,
  blobRefs,
  blockedDigests,
  creations,
  csamIncidents,
  moderationActions,
  namespaces,
  releases,
  uploads,
} from "../src/db/schema/index.js";
import { QUEUE_NAMES } from "../src/jobs/definitions.js";
import { JobQueue } from "../src/jobs/queue.js";
import { handleCsamHit } from "../src/moderation/csam.js";
import { FlagCache } from "../src/ops/flags.js";
import { casKey } from "../src/storage/cas.js";
import type { CsamScanner } from "../src/upload/csam.js";
import { type PipelineDeps, processUpload, rescanAll } from "../src/upload/pipeline.js";
import { handleUploadJob } from "../src/worker/upload.js";
import { BUCKETS, MINIO_PASSWORD, MINIO_USER } from "./global-setup.js";
import {
  createTestDatabase,
  pgErrorCode,
  type TestDatabase,
  testCas,
  testStorageEnv,
} from "./helpers.js";

let t: TestDatabase;
let queue: JobQueue;
let services: Services;
let api: ReturnType<typeof createApi>;
let s3: S3Client;
const now = new Date("2026-09-22T12:00:00Z");
const SYSTEM = uuidv7();
const STAFF = uuidv7();

const matchScanner: CsamScanner = {
  provider: "fake",
  scan: async () => ({ status: "match", provider: "fake", match_id: "m-42" }),
};
const clearScanner: CsamScanner = {
  provider: "fake",
  scan: async () => ({ status: "clear", provider: "fake" }),
};

const sessionPrincipal = async (req: Request): Promise<Principal | null> => {
  const id = req.headers.get("x-test-user");
  return id ? { kind: "user", user_id: id, banned: false } : null;
};

function deps(scanner?: CsamScanner): PipelineDeps {
  return {
    db: t.app.db,
    cas: services.cas,
    queue,
    ...(scanner ? { scanner } : {}),
    now: () => now,
    newId: () => uuidv7(),
    systemActorId: SYSTEM,
  };
}

async function exists(bucket: keyof typeof BUCKETS, key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKETS[bucket], Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function newUser(name: string) {
  const id = uuidv7();
  await t.app.db
    .insert(authUser)
    .values({ id, email: `${name}-${id}@example.com`, name, createdAt: new Date("2026-01-01") });
  const token = generateToken();
  await t.app.db.insert(apiTokens).values({
    id: uuidv7(),
    userId: id,
    name: "cli",
    prefix: token.slice(0, 12),
    tokenHash: hashToken(token),
    scopes: ["creations:write"],
  });
  await t.app.db.insert(authSession).values({
    id: uuidv7(),
    userId: id,
    token: `session-${id}`,
    expiresAt: new Date("2027-01-01"),
  });
  return { id, token };
}

async function pngOf(color: string): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width: 24, height: 24, channels: 3, background: color } })
      .png()
      .toBuffer(),
  );
}

async function uploadAs(user: string, bytes: Uint8Array): Promise<string> {
  const res = await api.request("/v1/uploads", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-user": user },
    body: JSON.stringify({
      purpose: "asset",
      content_type: "image/png",
      size: bytes.byteLength,
      sha256: sha256Bytes(bytes),
    }),
  });
  if (res.status !== 201) return `status:${res.status}`;
  const c = (await res.json()) as {
    upload: string;
    put_url: string;
    headers: Record<string, string>;
  };
  await fetch(c.put_url, { method: "PUT", body: Buffer.from(bytes), headers: c.headers });
  await api.request(`/v1/uploads/${c.upload}/complete`, {
    method: "POST",
    headers: { "x-test-user": user },
  });
  return c.upload;
}

/** 已 ready 的上传中处理后 webp 的 digest。 */
async function readyBlob(uploadId: string): Promise<string> {
  const [row] = await t.app.db.select().from(uploads).where(eq(uploads.id, uploadId));
  const digest = (row?.result as { blob?: { digest?: string } } | null)?.blob?.digest;
  if (!digest) throw new Error(`upload ${uploadId} is not ready`);
  return digest;
}

async function expectLocked(user: { id: string; token: string }) {
  const [u] = await t.app.db.select().from(authUser).where(eq(authUser.id, user.id));
  expect(u).toMatchObject({ banned: true, banReason: "csam" });
  expect(await principalFromToken(t.app.db, user.token, now)).toBeNull();
  const live = await t.app.db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, user.id), isNull(apiTokens.revokedAt)));
  expect(live).toHaveLength(0);
  expect(
    await t.app.db.select().from(authSession).where(eq(authSession.userId, user.id)),
  ).toHaveLength(0);
}

beforeAll(async () => {
  t = await createTestDatabase();
  queue = new JobQueue({ connectionString: t.appUrl, max: 4 });
  queue.boss.on("error", () => {});
  await queue.start();
  await t.app.db.insert(authUser).values([
    { id: SYSTEM, email: "system@char.pub", name: "system" },
    { id: STAFF, email: "ts@char.pub", name: "Trust & Safety", role: "trust_safety" },
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
  const env = testStorageEnv();
  s3 = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    credentials: { accessKeyId: MINIO_USER, secretAccessKey: MINIO_PASSWORD },
    forcePathStyle: true,
  });
});
afterAll(async () => {
  s3.destroy();
  await queue.stop();
  await t.drop();
});

describe("scanner match on upload", () => {
  it("quarantines, preserves evidence, locks the uploader and blocks the content", async () => {
    const uploader = await newUser("uploader");
    const bytes = await pngOf("#aa1133");
    const digest = sha256Bytes(bytes);
    const id = await uploadAs(uploader.id, bytes);

    const out = await processUpload(deps(matchScanner), id);
    expect(out.state).toBe("quarantined");
    if (out.state !== "quarantined") return;

    const [row] = await t.app.db.select().from(uploads).where(eq(uploads.id, id));
    expect(row?.status).toBe("quarantined");
    // 证据在 evidence 桶中，原件已从 uploads 桶删除，private 桶没有处理后的副本。
    expect(await exists("evidence", out.incident.evidenceKey)).toBe(true);
    expect(out.incident.evidenceKey).toBe(`evidence/${casKey(digest)}`);
    expect(await exists("uploads", row?.stagingKey ?? "")).toBe(false);
    expect(await t.app.db.select().from(assetMeta)).toHaveLength(0);

    await expectLocked(uploader);
    const [blocked] = await t.app.db
      .select()
      .from(blockedDigests)
      .where(eq(blockedDigests.digest, digest));
    expect(blocked).toMatchObject({ reason: "policy.minor_sexual" });

    const [incident] = await t.app.db
      .select()
      .from(csamIncidents)
      .where(eq(csamIncidents.id, out.incident.incidentId));
    expect(incident).toMatchObject({
      uploadId: id,
      userId: uploader.id,
      reason: "csam_scan",
      matchId: "m-42",
      status: "open",
      evidenceExpiresAt: null,
    });
    const actions = await t.app.db.select().from(moderationActions);
    expect(actions.map((a) => a.action)).toContain("csam.quarantine");

    const chain = await verifyAuditChain(t.app.db);
    expect(chain.ok).toBe(true);
    // 没有 Release 引用它，所以不入队 tombstone。
    expect(out.incident.affectedReleases).toEqual([]);
  });

  it("refuses the same content when it is uploaded again, even by another account", async () => {
    const other = await newUser("other");
    const bytes = await pngOf("#aa1133");
    const res = await api.request("/v1/uploads", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": other.id },
      body: JSON.stringify({
        purpose: "asset",
        content_type: "image/png",
        size: bytes.byteLength,
        sha256: sha256Bytes(bytes),
      }),
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "upload.rejected" });
  });

  it("the app role cannot delete incident records", async () => {
    // 42501 = insufficient_privilege
    expect(await pgErrorCode(t.app.db.delete(csamIncidents))).toBe("42501");
  });
});

describe("staff flag on an asset that is already ready and referenced by a release", () => {
  it("runs the same path and enqueues a tombstone for the referencing release", async () => {
    const uploader = await newUser("artist");
    const id = await uploadAs(uploader.id, await pngOf("#11aa33"));
    await handleUploadJob(deps(), { upload_id: id });
    const blob = await readyBlob(id);
    expect(await exists("private", casKey(blob))).toBe(true);

    // 构造一个引用该 asset 的 Release（只写引用所需的最少数据）。
    const nsId = uuidv7();
    const crId = uuidv7();
    const relId = uuidv7();
    await t.app.db
      .insert(namespaces)
      .values({ id: nsId, slug: `artist-${nsId.slice(-6)}`, kind: "user" });
    await t.app.db.insert(creations).values({
      id: crId,
      namespaceId: nsId,
      name: "portrait",
      type: "character",
      displayName: "Portrait",
      rating: "general",
    });
    await t.app.db.insert(releases).values({
      id: relId,
      creationId: crId,
      label: "1.0.0",
      visibility: "public",
      source: { provider: "native" },
      semanticDigest: `sha256:${"a".repeat(64)}`,
      publishedBy: { user: uploader.id },
    });
    await t.app.db.insert(blobRefs).values({ digest: blob, releaseId: relId, role: "asset" });

    const out = await handleCsamHit(t.app.db, services.cas, queue, () => uuidv7(), {
      blobDigest: blob,
      reason: "staff_flag",
      actorId: STAFF,
      actorKind: "staff",
      now,
    });
    expect(out.affectedReleases).toEqual([relId]);
    const jobs = await queue.boss.findJobs<{ reason_code: string; releases: string[] }>(
      QUEUE_NAMES.tombstoneCascade,
    );
    expect(jobs.map((j) => j.data)).toContainEqual(
      expect.objectContaining({ reason_code: "policy.minor_sexual", releases: [relId] }),
    );

    const [after] = await t.app.db.select().from(uploads).where(eq(uploads.id, id));
    expect(after?.status).toBe("quarantined");
    expect(await exists("private", casKey(blob))).toBe(false);
    expect(await exists("evidence", out.evidenceKey)).toBe(true);
    await expectLocked(uploader);
    expect(out.blockedDigests).toContain(blob);
    const [incident] = await t.app.db
      .select()
      .from(csamIncidents)
      .where(eq(csamIncidents.id, out.incidentId));
    expect(incident).toMatchObject({ reason: "staff_flag", userId: uploader.id });
    expect((await verifyAuditChain(t.app.db)).ok).toBe(true);
  });
});

describe("rescanning existing assets once a real scanner is connected", () => {
  it("marks clean assets and quarantines matches", async () => {
    const a = await newUser("rescan-a");
    const b = await newUser("rescan-b");
    const idA = await uploadAs(a.id, await pngOf("#0000aa"));
    const idB = await uploadAs(b.id, await pngOf("#00aa00"));
    await handleUploadJob(deps(), { upload_id: idA });
    await handleUploadJob(deps(), { upload_id: idB });
    const bad = await readyBlob(idB);

    const selective: CsamScanner = {
      provider: "fake",
      scan: async (bytes) =>
        sha256Bytes(bytes) === bad
          ? { status: "match", provider: "fake", match_id: "m-7" }
          : clearScanner.scan(bytes),
    };
    const stats = await rescanAll({ ...deps(), scanner: selective, pageSize: 1 });
    expect(stats.matched).toBe(1);
    expect(stats.scanned).toBeGreaterThanOrEqual(2);
    const notScanned = await t.app.db
      .select()
      .from(assetMeta)
      .where(eq(assetMeta.scanStatus, "not_scanned"));
    expect(notScanned).toHaveLength(0);
    const [qb] = await t.app.db.select().from(uploads).where(eq(uploads.id, idB));
    expect(qb?.status).toBe("quarantined");
    await expectLocked(b);
  });
});
