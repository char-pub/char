import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { sha256Bytes } from "@char-pub/core";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeId } from "../src/registry/ids.js";
import { Cas, type CasConfig, casConfigFromEnv } from "../src/storage/cas.js";
import {
  DRAFT_PAYLOAD_CACHE_CONTROL,
  DRAFT_PAYLOAD_KINDS,
  type DraftPayloadKind,
  DraftPayloadStore,
  draftPayloadKey,
} from "../src/storage/draft-payload.js";
import { createTestDatabase, type TestDatabase, testStorageEnv } from "./helpers.js";

let t: TestDatabase;
let config: CasConfig;
let store: DraftPayloadStore;
let cas: Cas;
const builds: string[] = [];
const enc = new TextEncoder();
function newBuild() {
  const id = encodeId("draft_build", uuidv7());
  builds.push(id);
  return id;
}

beforeAll(async () => {
  t = await createTestDatabase();
  config = casConfigFromEnv(testStorageEnv());
  store = new DraftPayloadStore(config);
  cas = new Cas(config);
});
afterAll(async () => {
  if (store) await Promise.all(builds.map((id) => store.deleteBuild(id)));
  config?.client.destroy();
  await t?.drop();
});

describe("build-owned private payload storage", () => {
  it.each(DRAFT_PAYLOAD_KINDS)(
    "stores and verifies %s bytes with private no-store metadata",
    async (kind) => {
      const id = newBuild();
      const bytes = enc.encode(JSON.stringify({ id, kind }));
      const digest = sha256Bytes(bytes);
      const written = await store.writePayload(id, kind, bytes, { digest });
      expect(written).toEqual({
        key: draftPayloadKey(id, kind),
        digest,
        size: bytes.length,
        uploaded: true,
      });
      expect(await store.readPayload(id, kind, digest)).toEqual(bytes);
      const head = await config.client.send(
        new HeadObjectCommand({ Bucket: config.buckets.private, Key: written.key }),
      );
      expect(head.CacheControl).toBe(DRAFT_PAYLOAD_CACHE_CONTROL);
      expect(head.Metadata?.sha256).toBe(digest.slice(7));
      expect(head.ContentType).toContain(
        kind === "artifact" ? "application/vnd.char.creation-artifact+json" : "application/json",
      );
      const env = testStorageEnv();
      expect(
        (await fetch(`${env.S3_ENDPOINT}/${env.S3_BUCKET_PRIVATE}/${written.key}`)).status,
      ).toBe(403);
      await expect(
        config.client.send(
          new HeadObjectCommand({ Bucket: config.buckets.public, Key: written.key }),
        ),
      ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    },
  );

  it("is idempotent for identical bytes and refuses replacement or an incorrect declared digest", async () => {
    const id = newBuild();
    const bytes = enc.encode("first payload");
    const different = enc.encode("different payload");
    await expect(
      store.writePayload(id, "artifact", bytes, { digest: sha256Bytes(different) }),
    ).rejects.toMatchObject({ code: "draft_payload.digest_mismatch" });
    await expect(store.readPayload(id, "artifact", sha256Bytes(bytes))).rejects.toMatchObject({
      code: "draft_payload.not_found",
    });
    expect((await store.writePayload(id, "artifact", bytes)).uploaded).toBe(true);
    expect((await store.writePayload(id, "artifact", bytes)).uploaded).toBe(false);
    await expect(store.writePayload(id, "artifact", different)).rejects.toMatchObject({
      code: "draft_payload.conflict",
    });
    expect(await store.readPayload(id, "artifact", sha256Bytes(bytes))).toEqual(bytes);
  });

  it("verifies stored bytes against the trusted digest rather than trusting S3 metadata", async () => {
    const id = newBuild();
    const expected = enc.encode("expected payload");
    const changed = enc.encode("tampered payload");
    const { digest, key } = await store.writePayload(id, "snapshot", expected);
    await config.client.send(
      new PutObjectCommand({
        Bucket: config.buckets.private,
        Key: key,
        Body: changed,
        Metadata: { sha256: digest.slice(7) },
      }),
    );
    await expect(store.readPayload(id, "snapshot", digest)).rejects.toMatchObject({
      code: "draft_payload.digest_mismatch",
    });
  });

  it("restricts keys to draft-build TypeIDs and three fixed payload names", async () => {
    const bytes = enc.encode("not uploaded");
    for (const id of [
      uuidv7(),
      encodeId("release", uuidv7()),
      `${encodeId("draft_build", uuidv7())}\n`,
      "../cas/sha256/ab/a",
      "dbld_../other",
      "dbld_zzzzzzzzzzzzzzzzzzzzzzzzzz",
    ]) {
      expect(() => draftPayloadKey(id, "artifact")).toThrow();
      await expect(store.writePayload(id, "artifact", bytes)).rejects.toMatchObject({
        code: "draft_payload.invalid_build",
      });
      await expect(store.deleteBuild(id)).rejects.toMatchObject({
        code: "draft_payload.invalid_build",
      });
    }
    const id = newBuild();
    for (const kind of ["../artifact", "asset", "artifact/other", "artifact%2fother"]) {
      await expect(store.writePayload(id, kind as DraftPayloadKind, bytes)).rejects.toMatchObject({
        code: "draft_payload.invalid_kind",
      });
      await expect(store.deletePayload(id, kind as DraftPayloadKind)).rejects.toMatchObject({
        code: "draft_payload.invalid_kind",
      });
    }
    await expect(store.readPayload(id, "artifact", "not-a-digest")).rejects.toMatchObject({
      code: "draft_payload.invalid_digest",
    });
  });

  it("signs private GET for at most fifteen minutes and returns private no-store headers", async () => {
    const id = newBuild();
    const bytes = enc.encode("signed payload");
    await store.writePayload(id, "artifact", bytes);
    const now = new Date();
    const url = await store.signedGet(id, "artifact", new Date(now.getTime() + 3600_000), now);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(parsed.searchParams.get("response-cache-control")).toBe(DRAFT_PAYLOAD_CACHE_CONTROL);
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(DRAFT_PAYLOAD_CACHE_CONTROL);
    expect(response.headers.get("content-type")).toContain(
      "application/vnd.char.creation-artifact+json",
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it("caps URL lifetime to remaining build validity and rejects expired or invalid clocks/TTLs", async () => {
    const id = newBuild();
    await store.writePayload(id, "report", enc.encode("report"));
    const now = new Date();
    const expires = new Date(now.getTime() + 31_999);
    const short = await store.signedGet(id, "report", expires, now);
    expect(new URL(short).searchParams.get("X-Amz-Expires")).toBe("31");
    expect((await fetch(short)).status).toBe(200);
    const requested = await store.signedGet(id, "report", expires, now, 10);
    expect(new URL(requested).searchParams.get("X-Amz-Expires")).toBe("10");
    for (const remaining of [-1, 0, 999])
      await expect(
        store.signedGet(id, "report", new Date(now.getTime() + remaining), now),
      ).rejects.toMatchObject({ code: "draft_payload.expired" });
    for (const ttl of [0, -1, 901, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
      await expect(store.signedGet(id, "report", expires, now, ttl)).rejects.toMatchObject({
        code: "draft_payload.invalid_ttl",
      });
    await expect(store.signedGet(id, "report", new Date(Number.NaN), now)).rejects.toMatchObject({
      code: "draft_payload.invalid_expiry",
    });
    await expect(
      store.signedGet(id, "report", expires, new Date(Number.NaN)),
    ).rejects.toMatchObject({ code: "draft_payload.invalid_expiry" });
  });

  it("deletes only one build's named payloads, preserving another build and identical shared CAS bytes", async () => {
    const a = newBuild();
    const b = newBuild();
    const bytes = enc.encode(`shared content ${a}`);
    const { digest } = await cas.putBlob(t.app.db, {
      bucket: "private",
      bytes,
      mediaType: "application/json",
      kind: "asset",
    });
    for (const kind of DRAFT_PAYLOAD_KINDS) await store.writePayload(a, kind, bytes);
    await store.writePayload(b, "artifact", bytes);
    const now = new Date();
    const url = await store.signedGet(a, "artifact", new Date(now.getTime() + 900_000), now);
    await store.deletePayload(a, "report");
    await store.deletePayload(a, "report");
    expect(await store.readPayload(a, "artifact", digest)).toEqual(bytes);
    await store.deleteBuild(a);
    await store.deleteBuild(a);
    for (const kind of DRAFT_PAYLOAD_KINDS)
      await expect(store.readPayload(a, kind, digest)).rejects.toMatchObject({
        code: "draft_payload.not_found",
      });
    expect((await fetch(url)).status).toBe(404);
    expect(await store.readPayload(b, "artifact", digest)).toEqual(bytes);
    expect(await cas.getBlob("private", digest)).toEqual(bytes);
  });

  it.each(["private", "public"] as const)(
    "signs a trusted %s CAS asset with no-store and preserves it after build deletion",
    async (bucket) => {
      const id = newBuild();
      const bytes = enc.encode(`shared ${bucket} asset ${id}`);
      const { digest } = await cas.putBlob(t.app.db, {
        bucket,
        bytes,
        mediaType: "text/plain",
        kind: "asset",
      });
      await store.writePayload(id, "artifact", enc.encode(`artifact ${id}`));
      const now = new Date();
      const expires = new Date(now.getTime() + 22_999);
      const url = await store.signedAsset(digest, bucket, expires, now);
      expect(new URL(url).searchParams.get("X-Amz-Expires")).toBe("22");
      const response = await fetch(url);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("content-type")).toContain("text/plain");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
      await store.deleteBuild(id);
      expect(await cas.getBlob(bucket, digest)).toEqual(bytes);
      expect((await fetch(url)).status).toBe(200);
      await expect(store.signedAsset(digest, bucket, now, now)).rejects.toMatchObject({
        code: "draft_payload.expired",
      });
      await expect(store.signedAsset(digest, bucket, expires, now, 901)).rejects.toMatchObject({
        code: "draft_payload.invalid_ttl",
      });
      await expect(
        store.signedAsset("../private/path", bucket, expires, now),
      ).rejects.toMatchObject({ code: "draft_payload.invalid_digest" });
      await expect(
        store.signedAsset(digest, "evidence" as "private", expires, now),
      ).rejects.toMatchObject({ code: "draft_payload.invalid_bucket" });
    },
  );
});
