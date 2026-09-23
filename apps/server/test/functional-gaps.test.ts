import { randomBytes } from "node:crypto";
import { MAX_ASSET_BYTES, MAX_CARD_JSON_BYTES } from "@char-pub/contracts";
import { sha256Bytes } from "@char-pub/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { register as registerUploads } from "../src/api/routes/uploads.js";
import {
  blockedDigests,
  creationDrafts,
  imports,
  legalRequests,
  namespaces,
  uploads,
} from "../src/db/schema/index.js";
import { decryptJson, type EncryptedValue } from "../src/moderation/legal-crypto.js";
import { decodeId, encodeId } from "../src/registry/ids.js";
import {
  createGitHubHarness,
  type GitHubHarness,
  grantRepositoryAccess,
} from "./github-harness.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

let t: TestDatabase;
let g: GitHubHarness;
let alice: string;
let bob: string;
let creationId: string;
const base = "/v1/creations/@writer/card";
const legalKey = randomBytes(32);
beforeAll(async () => {
  t = await createTestDatabase();
  g = await createGitHubHarness(t, testCas());
  registerUploads(g.h.app);
  alice = await g.h.createUser("writer");
  bob = await g.h.createUser("other");
  g.h.services.legalKey = legalKey;
  await g.h.as(alice).post("/v1/namespaces", { slug: "writer" });
  const res = await g.h.as(alice).post("/v1/namespaces/writer/creations", {
    name: "card",
    type: "character",
    display_name: "Card",
  });
  creationId = decodeId("creation", (await res.json()).id) as string;
});
afterAll(async () => {
  await g.h.close();
  await t.drop();
});

describe("deletion request intake", () => {
  const endpoint = "/v1/me/deletion-requests";
  const body = { reason: "Please remove my private account data.", confirm: true };
  it("requires a browser session and explicit confirmation", async () => {
    expect((await g.h.as(null).post(endpoint, body)).status).toBe(401);
    expect((await g.h.as(alice).post(endpoint, { reason: body.reason })).status).toBe(422);
    const token = await g.h
      .as(alice)
      .post("/v1/me/tokens", { name: "cli", scopes: ["creations:write"], expires_in_days: 1 });
    expect((await g.h.withToken((await token.json()).token).post(endpoint, body)).status).toBe(403);
  });
  it("encrypts details, deduplicates retries, and exposes only the requester's statuses", async () => {
    const first = await g.h.as(alice).post(endpoint, body);
    expect(first.status).toBe(202);
    const receipt = await first.json();
    const again = await g.h.as(alice).post(endpoint, body);
    expect((await again.json()).id).toBe(receipt.id);
    const [row] = await t.app.db
      .select()
      .from(legalRequests)
      .where(eq(legalRequests.id, receipt.id));
    expect(JSON.stringify(row?.requester)).not.toContain(body.reason);
    expect(decryptJson(legalKey, row?.requester as EncryptedValue)).toMatchObject({
      reason: body.reason,
    });
    expect((await (await g.h.as(bob).get(endpoint)).json()).items).toEqual([]);
    const own = await (await g.h.as(alice).get(endpoint)).json();
    expect(own.items).toHaveLength(1);
    expect(JSON.stringify(own)).not.toContain(body.reason);
    expect((await g.h.as(alice).get("/v1/me")).status).toBe(200);
  });
  it("checks creation ownership and does not remove content on submission", async () => {
    expect((await g.h.as(bob).post(endpoint, { ...body, creation: "@writer/card" })).status).toBe(
      404,
    );
    expect((await g.h.as(alice).post(endpoint, { ...body, creation: "@writer/card" })).status).toBe(
      202,
    );
    expect((await g.h.as(alice).get(`${base}/draft`)).status).toBe(200);
  });
  it("fails closed without encryption and respects maintenance", async () => {
    delete g.h.services.legalKey;
    expect((await g.h.as(alice).post(endpoint, body)).status).toBe(503);
    g.h.services.legalKey = legalKey;
    await g.h.setFlag("read_only", false);
    expect((await g.h.as(alice).post(endpoint, body)).status).toBe(503);
    await g.h.setFlag("read_only", true);
  });
});

describe("verified GitHub connection", () => {
  const repo = { id: "1001", owner_id: "2001", owner_login: "writer", name: "card" };
  it("does not leak repository metadata before verifying the linked identity", async () => {
    await g.install("77", repo, [repo]);
    expect(
      (await g.h.as(alice).post(`${base}/source-binding/lookup`, { repository: "writer/card" }))
        .status,
    ).toBe(403);
    await grantRepositoryAccess(t, g, alice, [], "4242");
    const denied = await g.h
      .as(alice)
      .post(`${base}/source-binding/lookup`, { repository: "writer/card" });
    expect(denied.status).toBe(404);
    expect(JSON.stringify(await denied.json())).not.toContain("installation_id");
    expect(
      (
        await g.h.as(alice).post(`${base}/source-binding`, {
          installation_id: "77",
          repository_id: "1001",
          path: "char.yaml",
        })
      ).status,
    ).toBe(403);
  });
  it("discovers installation and repository, then rechecks permission at bind time", async () => {
    g.source.writers.add("1001:4242");
    const connection = await g.h.as(alice).get(`${base}/source-binding/connect`);
    expect(await connection.json()).toMatchObject({ linked: true });
    const found = await g.h
      .as(alice)
      .post(`${base}/source-binding/lookup`, { repository: "writer/card" });
    expect(await found.json()).toMatchObject({
      id: "1001",
      installation_id: "77",
      default_branch: "main",
    });
    g.source.writers.delete("1001:4242");
    const bind = { installation_id: "77", repository_id: "1001", path: "char.yaml" };
    expect((await g.h.as(alice).post(`${base}/source-binding`, bind)).status).toBe(403);
    g.source.writers.add("1001:4242");
    expect((await g.h.as(alice).post(`${base}/source-binding`, bind)).status).toBe(201);
  });
});

describe("private draft recovery", () => {
  let digest: string;
  let uploadId: string;
  it("previews processed owned assets and rejects guessed private digests", async () => {
    const blob = await g.h.services.cas.putBlob(t.app.db, {
      bucket: "private",
      bytes: randomBytes(30),
      mediaType: "image/webp",
      kind: "asset",
    });
    digest = blob.digest;
    const [draft] = await t.app.db
      .select()
      .from(creationDrafts)
      .where(eq(creationDrafts.creationId, creationId));
    const working = {
      ...(draft?.working as object),
      assets: [
        {
          slot: "avatar",
          role: "presentation",
          variants: [
            {
              id: "default",
              media_type: "image/webp",
              blob: { digest, size: blob.size, availability: "mirrored" },
            },
          ],
        },
      ],
    };
    await t.app.db
      .update(creationDrafts)
      .set({ working })
      .where(eq(creationDrafts.creationId, creationId));
    expect((await g.h.as(alice).get(`${base}/draft/avatar`)).status).toBe(404);
    uploadId = g.h.services.ids.uuid();
    await t.app.db.insert(uploads).values({
      id: uploadId,
      ownerUserId: alice,
      status: "ready",
      declaredType: "image/png",
      size: 30,
      stagingKey: `staging/${uploadId}`,
      result: { blob: { digest } },
      expiresAt: new Date("2030-01-01"),
    });
    const res = await g.h.as(alice).get(`${base}/draft/avatar`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toMatchObject({ digest, url: expect.stringContaining("X-Amz-") });
    expect((await g.h.as(bob).get(`${base}/draft/avatar`)).status).toBe(404);
    await t.app.db.insert(blockedDigests).values({ digest, reason: "author.request" });
    expect((await g.h.as(alice).get(`${base}/draft/avatar`)).status).toBe(404);
  });
  it("returns recoverable import identity only to its uploader", async () => {
    const [ns] = await t.app.db.select().from(namespaces).where(eq(namespaces.slug, "writer"));
    const id = g.h.services.ids.uuid();
    await t.app.db.insert(imports).values({
      id,
      ownerUserId: alice,
      uploadId,
      namespaceId: ns?.id as string,
      name: "card",
      status: "succeeded",
      creationId,
      needsConfirmation: ["meta.rating"],
    });
    const res = await g.h.as(alice).get(`${base}/draft`);
    expect(await res.json()).toMatchObject({ unconfirmed_import: encodeId("import", id) });
    await t.app.db.update(imports).set({ confirmedAt: g.h.clock.now() }).where(eq(imports.id, id));
    expect(await (await g.h.as(alice).get(`${base}/draft`)).json()).not.toHaveProperty(
      "unconfirmed_import",
    );
  });
  it("rejects oversized assets and JSON before issuing upload URLs", async () => {
    for (const [purpose, type, size] of [
      ["asset", "image/png", MAX_ASSET_BYTES + 1],
      ["import", "application/json", MAX_CARD_JSON_BYTES + 1],
    ] as const) {
      const res = await g.h.as(alice).post("/v1/uploads", {
        purpose,
        content_type: type,
        size,
        sha256: sha256Bytes(new Uint8Array()),
      });
      expect(res.status).toBe(413);
    }
  });
});
