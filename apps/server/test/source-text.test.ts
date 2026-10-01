import { SourceTextResponseSchema } from "@char-pub/contracts";
import { CreationArtifactSchema, materializeSourceText, sha256Bytes } from "@char-pub/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { register as read } from "../src/api/routes/read.js";
import { register as uploadsRoute } from "../src/api/routes/uploads.js";
import {
  assetMeta,
  blockedDigests,
  namespaceMembers,
  namespaces,
  releases,
} from "../src/db/schema/index.js";
import { decodeId } from "../src/registry/ids.js";
import { processUpload } from "../src/upload/pipeline.js";
import { type ApiHarness, createHarness } from "./api-harness.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

let t: TestDatabase;
let h: ApiHarness;
let owner: string;
let stranger: string;
beforeAll(async () => {
  t = await createTestDatabase();
  h = await createHarness(t, testCas(), { extraModules: [read, uploadsRoute] });
  owner = await h.createUser("source-owner");
  stranger = await h.createUser("source-stranger");
  expect((await h.as(owner).post("/v1/namespaces", { slug: "sources" })).status).toBe(201);
  expect((await h.as(stranger).post("/v1/namespaces", { slug: "outsider" })).status).toBe(201);
});
afterAll(async () => {
  await h.close();
  await t.drop();
});

async function upload(bytes: Uint8Array, type = "text/markdown") {
  const me = h.as(owner);
  const response = await me.post("/v1/uploads", {
    purpose: "asset",
    content_type: type,
    size: bytes.length,
    sha256: sha256Bytes(bytes),
  });
  expect(response.status, await response.clone().text()).toBe(201);
  const request = (await response.json()) as {
    upload: string;
    put_url: string;
    headers: Record<string, string>;
  };
  expect(
    (
      await fetch(request.put_url, {
        method: "PUT",
        headers: request.headers,
        body: Buffer.from(bytes),
      })
    ).status,
  ).toBe(200);
  expect((await me.post(`/v1/uploads/${request.upload}/complete`)).status).toBe(202);
  const outcome = await processUpload(
    {
      db: t.app.db,
      cas: h.services.cas,
      now: h.clock.now,
      newId: h.services.ids.uuid,
      systemActorId: owner,
    },
    request.upload,
  );
  const status = (await (await me.get(`/v1/uploads/${request.upload}`)).json()) as {
    blob: { digest: string; size: number; media_type: string };
    status: string;
  };
  return { outcome, status, id: request.upload };
}
async function publish(
  name: string,
  blob: { digest: string; size: number; media_type: string },
  visibility: "public" | "private",
  anchor = "#Intro",
  as = owner,
) {
  const ns = as === owner ? "sources" : "outsider";
  const me = h.as(as);
  expect(
    (await me.post(`/v1/namespaces/${ns}/creations`, { name, type: "world", display_name: name }))
      .status,
  ).toBe(201);
  const base = `/v1/creations/@${ns}/${name}`;
  const draft = (await (await me.get(`${base}/draft`)).json()) as { version: number };
  const working = {
    display_name: name,
    meta: { default_locale: "en", rights: "original", rating: "general", license: "CC0-1.0" },
    fragments: [
      { id: "world", stable: true, kind: "world", content: { type: "text", text: "A library." } },
    ],
    sources: [
      {
        id: "book",
        title: "Book",
        description: "Reference guide",
        format: "markdown",
        asset: "book",
        sections: [{ id: "intro", title: "Introduction", anchor }],
      },
    ],
    assets: [
      {
        slot: "book",
        role: "context",
        variants: [
          {
            id: "default",
            media_type: blob.media_type,
            blob: { digest: blob.digest, size: blob.size, availability: "mirrored" },
          },
        ],
      },
    ],
  };
  expect(
    (await me.put(`${base}/draft`, { working }, { "if-match": String(draft.version) })).status,
  ).toBe(200);
  const revision = (await (await me.post(`${base}/revisions`, {})).json()) as { id: string };
  const response = await me.post(
    `${base}/releases`,
    { revision: revision.id, label: "1.0.0", visibility },
    { "idempotency-key": `source-publish-${name}` },
  );
  expect(response.status, await response.clone().text()).toBe(202);
  const created = (await response.json()) as { release: string };
  const outcomes = await h.runPublishJobs();
  const id = decodeId("release", created.release);
  if (!id) throw new Error(`Missing release ${JSON.stringify(created)}`);
  const [row] = await t.app.db.select().from(releases).where(eq(releases.id, id));
  if (!row) throw new Error("Missing row");
  return { outcomes, row, base, release: created.release };
}

describe("published reference text", () => {
  it("stores original UTF-8, publishes validated anchors, and reads only through authorized releases", async () => {
    const text = "\uFEFF# Intro\r\nSECRET_LINE\r\n# Other\r\nRest";
    const uploaded = await upload(new TextEncoder().encode(text));
    expect(uploaded.outcome.state).toBe("ready");
    const blob = uploaded.status.blob;
    expect(blob.digest).toBe(sha256Bytes(new TextEncoder().encode(text)));
    const [meta] = await t.app.db.select().from(assetMeta).where(eq(assetMeta.digest, blob.digest));
    expect(meta).toMatchObject({
      width: null,
      height: null,
      mediaType: "text/markdown",
      scanStatus: "not_scanned",
    });
    const published = await publish("private-book", blob, "private");
    expect(published.outcomes).toEqual(["published"]);
    const artifact = CreationArtifactSchema.parse(
      JSON.parse(
        new TextDecoder().decode(
          await h.services.cas.getBlob("private", published.row.artifactDigest ?? ""),
        ),
      ),
    );
    if (artifact.kind !== "content") throw new Error("Content required");
    const source = artifact.catalog_index.sources[0];
    const asset = artifact.assets.find((a) => a.id === source?.asset);
    if (!source || !asset) throw new Error("Missing source");
    const url = `/v1/releases/${published.release}/source-text?source=${encodeURIComponent(source.id)}`;
    expect((await h.as(null).get(url)).status).toBe(404);
    expect((await h.as(stranger).get(url)).status).toBe(404);
    const response = await h.as(owner).get(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = SourceTextResponseSchema.parse(await response.json());
    expect(body.text).toBe(text);
    expect(materializeSourceText(source, asset, body.text).sections.intro).toBe(
      "# Intro\nSECRET_LINE",
    );
    expect(
      (
        await h
          .as(owner)
          .get(
            `/v1/releases/${published.release}/source-text?source=${encodeURIComponent(blob.digest)}`,
          )
      ).status,
    ).toBe(404);
    await expect(h.services.cas.getBlob("public", blob.digest)).rejects.toThrow();
    const publicRelease = await publish("public-book", blob, "public");
    expect(publicRelease.outcomes).toEqual(["published"]);
    const publicSource = `@sources/public-book#source/book~root`;
    expect(
      (
        await h
          .as(null)
          .get(
            `/v1/releases/${publicRelease.release}/source-text?source=${encodeURIComponent(publicSource)}`,
          )
      ).status,
    ).toBe(200);
    expect(await h.services.cas.getBlob("public", blob.digest)).toEqual(
      new TextEncoder().encode(text),
    );
    await t.app.db
      .insert(blockedDigests)
      .values({ digest: blob.digest, reason: "test-source-block" });
    expect((await h.as(owner).get(url)).status).toBe(404);
    await t.app.db
      .update(releases)
      .set({ status: "tombstoned", statusReason: "test-source-removal" })
      .where(eq(releases.id, published.row.id));
    expect((await h.as(owner).get(url)).status).toBe(410);
  });
  it("rejects invalid UTF-8 and binary text before marking uploads ready", async () => {
    expect((await upload(new Uint8Array([0xc3, 0x28]))).outcome).toEqual({
      state: "rejected",
      reason: "source.invalid_utf8",
    });
    expect((await upload(new Uint8Array([65, 0, 66]))).outcome).toEqual({
      state: "rejected",
      reason: "source.binary_content",
    });
  });
  it("fails publication for invalid anchors and prevents laundering a private asset digest", async () => {
    const { status } = await upload(new TextEncoder().encode("# Intro\nPrivate document"));
    const missing = await publish("bad-anchor", status.blob, "public", "#Absent");
    expect(missing.outcomes).toEqual(["failed"]);
    expect(missing.row.publishReport).toMatchObject({
      issues: [{ code: "source.anchor_missing" }],
    });
    const [otherNamespace] = await t.app.db
      .select()
      .from(namespaces)
      .where(eq(namespaces.slug, "outsider"));
    if (!otherNamespace) throw new Error("Missing namespace");
    await t.app.db
      .insert(namespaceMembers)
      .values({ namespaceId: otherNamespace.id, userId: owner, role: "maintainer" });
    const stolen = await publish("stolen", status.blob, "public", "#Intro", stranger);
    expect(stolen.outcomes).toEqual(["failed"]);
    expect(stolen.row.publishReport).toMatchObject({
      issues: [{ code: "asset.not_authorized" }],
    });
    await expect(h.services.cas.getBlob("public", status.blob.digest)).rejects.toThrow();
  });
});
