/**
 * 内容寻址存储：哈希校验、幂等写入、签名 URL，以及私有 / 公共桶的访问边界。
 */
import { sha256Bytes } from "@char-pub/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { blobs } from "../src/db/schema/index.js";
import { type Cas, CasError, casKey } from "../src/storage/cas.js";
import { createTestDatabase, type TestDatabase, testCas, testStorageEnv } from "./helpers.js";

let t: TestDatabase;
let cas: Cas;
const enc = new TextEncoder();

/** 每个用例使用不同的内容，避免依赖其他用例写入的对象。 */
let n = 0;
const unique = (label: string) => enc.encode(`${label}:${Date.now()}:${n++}:${Math.random()}`);

function publicUrl(digest: string) {
  const env = testStorageEnv();
  return `${env.S3_ENDPOINT}/${env.S3_BUCKET_PUBLIC}/${casKey(digest)}`;
}
function privateUrl(digest: string) {
  const env = testStorageEnv();
  return `${env.S3_ENDPOINT}/${env.S3_BUCKET_PRIVATE}/${casKey(digest)}`;
}

async function casCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e instanceof CasError ? e.code : `other:${String(e)}`;
  }
}

beforeAll(async () => {
  t = await createTestDatabase();
  cas = testCas();
});

afterAll(async () => {
  await t.drop();
});

describe("casKey", () => {
  it("shards by the first two hex characters", () => {
    const d = `sha256:ab${"c".repeat(62)}`;
    expect(casKey(d)).toBe(`cas/sha256/ab/ab${"c".repeat(62)}`);
  });

  it("rejects malformed digests", () => {
    expect(() => casKey("sha256:xyz")).toThrow(CasError);
    expect(() => casKey(`md5:${"a".repeat(64)}`)).toThrow(CasError);
  });
});

describe("putBlob", () => {
  it("stores content under its own hash and records metadata", async () => {
    const bytes = unique("fragment");
    const r = await cas.putBlob(t.app.db, {
      bucket: "private",
      bytes,
      mediaType: "application/json",
      kind: "fragment",
    });
    expect(r.digest).toBe(sha256Bytes(bytes));
    expect(r.uploaded).toBe(true);
    expect(await cas.getBlob("private", r.digest)).toEqual(bytes);
    const [row] = await t.app.db.select().from(blobs).where(eq(blobs.digest, r.digest));
    expect(row).toMatchObject({
      size: bytes.byteLength,
      kind: "fragment",
      inPrivate: true,
      inPublic: false,
    });
  });

  it("rejects content that does not match the declared digest", async () => {
    const bytes = unique("x");
    const code = await casCode(
      cas.putBlob(t.app.db, {
        bucket: "private",
        bytes,
        mediaType: "text/plain",
        kind: "fragment",
        digest: sha256Bytes(enc.encode("something else")),
      }),
    );
    expect(code).toBe("cas.digest_mismatch");
    expect(await cas.exists("private", casKey(sha256Bytes(bytes)))).toBe(false);
  });

  it("is idempotent: writing the same content twice uploads once", async () => {
    const bytes = unique("same");
    const a = await cas.putBlob(t.app.db, {
      bucket: "private",
      bytes,
      mediaType: "text/plain",
      kind: "fragment",
      digest: sha256Bytes(bytes),
    });
    const b = await cas.putBlob(t.app.db, {
      bucket: "private",
      bytes,
      mediaType: "text/plain",
      kind: "fragment",
    });
    expect(a.uploaded).toBe(true);
    expect(b.uploaded).toBe(false);
    expect(b.digest).toBe(a.digest);
    const rows = await t.app.db.select().from(blobs).where(eq(blobs.digest, a.digest));
    expect(rows).toHaveLength(1);
  });

  it("evidence objects are stored but never listed in the blobs table", async () => {
    const bytes = unique("evidence");
    const r = await cas.putBlob(t.app.db, {
      bucket: "evidence",
      bytes,
      mediaType: "application/octet-stream",
      kind: "upload",
    });
    expect(await cas.exists("evidence", r.key)).toBe(true);
    expect(await t.app.db.select().from(blobs).where(eq(blobs.digest, r.digest))).toHaveLength(0);
  });

  it("getBlob reports missing objects", async () => {
    expect(await casCode(cas.getBlob("private", sha256Bytes(unique("missing"))))).toBe(
      "cas.not_found",
    );
  });
});

describe("access boundaries", () => {
  it("private objects cannot be read anonymously but can with a signed URL", async () => {
    const bytes = unique("private");
    const { digest } = await cas.putBlob(t.app.db, {
      bucket: "private",
      bytes,
      mediaType: "text/plain",
      kind: "fragment",
    });
    const anon = await fetch(privateUrl(digest));
    expect(anon.status).toBe(403);

    const signed = await cas.signedGet(digest, 60);
    const res = await fetch(signed);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it("signed GET URLs are limited to five minutes", async () => {
    const d = sha256Bytes(unique("ttl"));
    expect(await casCode(cas.signedGet(d, 301))).toBe("cas.ttl_too_long");
    expect(await casCode(cas.signedGet(d, 0))).toBe("cas.ttl_too_long");
  });

  it("copyToPublic makes an object anonymously readable and marks it public", async () => {
    const bytes = unique("to-public");
    const { digest } = await cas.putBlob(t.app.db, {
      bucket: "private",
      bytes,
      mediaType: "text/plain",
      kind: "snapshot",
    });
    expect((await fetch(publicUrl(digest))).status).not.toBe(200);

    expect(await cas.copyToPublic(t.app.db, digest)).toEqual({ copied: true });
    const res = await fetch(publicUrl(digest));
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    expect(await cas.copyToPublic(t.app.db, digest)).toEqual({ copied: false });

    const [row] = await t.app.db.select().from(blobs).where(eq(blobs.digest, digest));
    expect(row).toMatchObject({ inPublic: true, inPrivate: true });
  });

  it("copyToPublic refuses digests that are not stored", async () => {
    expect(await casCode(cas.copyToPublic(t.app.db, sha256Bytes(unique("absent"))))).toBe(
      "cas.not_found",
    );
  });
});

describe("signed uploads", () => {
  it("accepts a PUT matching the signed length and type", async () => {
    const bytes = unique("upload");
    const key = `staging/upl_${n}`;
    const url = await cas.signedPut({
      key,
      contentLength: bytes.byteLength,
      contentType: "image/png",
      ttlSeconds: 120,
    });
    const res = await fetch(url, {
      method: "PUT",
      body: bytes,
      headers: { "content-type": "image/png", "content-length": String(bytes.byteLength) },
    });
    expect(res.status).toBe(200);
    expect(await cas.exists("uploads", key)).toBe(true);
  });

  it("rejects a PUT whose content type differs from the signed one", async () => {
    const bytes = unique("upload-type");
    const key = `staging/upl_type_${n}`;
    const url = await cas.signedPut({
      key,
      contentLength: bytes.byteLength,
      contentType: "image/png",
    });
    const res = await fetch(url, {
      method: "PUT",
      body: bytes,
      headers: { "content-type": "text/html", "content-length": String(bytes.byteLength) },
    });
    expect(res.status).toBe(403);
    expect(await cas.exists("uploads", key)).toBe(false);
  });

  it("rejects a PUT whose length differs from the signed one", async () => {
    const bytes = unique("upload-len");
    const key = `staging/upl_len_${n}`;
    const url = await cas.signedPut({
      key,
      contentLength: bytes.byteLength + 10,
      contentType: "image/png",
    });
    const res = await fetch(url, {
      method: "PUT",
      body: bytes,
      headers: { "content-type": "image/png", "content-length": String(bytes.byteLength) },
    });
    expect(res.status).toBe(403);
  });

  it("limits signed PUT to ten minutes and to staging keys", async () => {
    expect(
      await casCode(
        cas.signedPut({
          key: "staging/a",
          contentLength: 1,
          contentType: "image/png",
          ttlSeconds: 601,
        }),
      ),
    ).toBe("cas.ttl_too_long");
    expect(
      await casCode(
        cas.signedPut({ key: "cas/sha256/aa/x", contentLength: 1, contentType: "image/png" }),
      ),
    ).toBe("cas.bucket_not_allowed");
  });
});
