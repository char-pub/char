/** Work-scoped byte grants and real PostgreSQL permission-lock ordering. */
import { DraftBuildResponseSchema, DraftSchema, UploadStatusSchema } from "@char-pub/contracts";
import { type CreationInput, sha256Bytes } from "@char-pub/core";
import { and, eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { register as uploadRoutes } from "../src/api/routes/uploads.js";
import { creationAssetGrants, creationCollaborators, creations } from "../src/db/schema/index.js";
import { grantDraftAssets } from "../src/registry/asset-ownership.js";
import { lockDraftBuildCreation } from "../src/registry/draft-builds.js";
import { decodeId } from "../src/registry/ids.js";
import { processUpload } from "../src/upload/pipeline.js";
import { handleDraftBuild } from "../src/worker/draft-build.js";
import { type ApiHarness, createHarness } from "./api-harness.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

let t: TestDatabase;
let h: ApiHarness;
let owner: string;
let editor: string;
let outsider: string;
const body = "\uFEFF# Source\r\nPRIVATE_WORK_ASSET\r\n";
const meta = {
  default_locale: "en",
  rating: "general" as const,
  rights: "original" as const,
  license: "CC0-1.0",
};
type Working = Omit<CreationInput, "id" | "ref">;

function gate() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function upload(actor: string, bytes: Uint8Array, contentType: string) {
  const me = h.as(actor);
  const response = await me.post("/v1/uploads", {
    purpose: "asset",
    content_type: contentType,
    size: bytes.length,
    sha256: sha256Bytes(bytes),
  });
  expect(response.status, await response.clone().text()).toBe(201);
  const target = (await response.json()) as {
    upload: string;
    put_url: string;
    headers: Record<string, string>;
  };
  expect(
    (
      await fetch(target.put_url, {
        method: "PUT",
        headers: target.headers,
        body: Buffer.from(bytes),
      })
    ).status,
  ).toBe(200);
  expect((await me.post(`/v1/uploads/${target.upload}/complete`)).status).toBe(202);
  expect(
    (
      await processUpload(
        {
          db: t.app.db,
          cas: h.services.cas,
          now: h.clock.now,
          newId: h.services.ids.uuid,
          systemActorId: actor,
        },
        target.upload,
      )
    ).state,
  ).toBe("ready");
  const status = UploadStatusSchema.parse(
    await (await me.get(`/v1/uploads/${target.upload}`)).json(),
  );
  if (!status.blob) throw new Error("Expected real processed upload");
  return status.blob;
}
function definition(name: string): Working {
  return {
    type: "character",
    display_name: name,
    meta,
    fragments: [
      {
        id: "identity",
        stable: true,
        kind: "character",
        content: { type: "text", text: "A collaborative character." },
      },
    ],
  };
}
async function work(name: string, working = definition(name)) {
  const response = await h
    .as(owner)
    .post("/v1/namespaces/work-grants/creations", { name, type: working.type, display_name: name });
  expect(response.status).toBe(201);
  const [row] = await t.app.db
    .select({ id: creations.id })
    .from(creations)
    .where(eq(creations.name, name));
  if (!row) throw new Error("Expected work");
  const base = `/v1/creations/@work-grants/${name}`;
  const draft = DraftSchema.parse(await (await h.as(owner).get(`${base}/draft`)).json());
  const saved = await h
    .as(owner)
    .put(`${base}/draft`, { working }, { "if-match": String(draft.version) });
  expect(saved.status, await saved.clone().text()).toBe(200);
  // Authorization fixture only: invitation lifecycle is tested separately through its API.
  await t.app.db.insert(creationCollaborators).values({
    creationId: row.id,
    userId: editor,
    invitedBy: owner,
    license: meta.license,
    acceptedAt: h.clock.now(),
  });
  return { id: row.id, base };
}
async function request(w: Awaited<ReturnType<typeof work>>, actor = editor) {
  const draft = DraftSchema.parse(await (await h.as(actor).get(`${w.base}/draft`)).json());
  const response = await h
    .as(actor)
    .post(`${w.base}/draft-builds`, {}, { "if-match": String(draft.version) });
  expect(response.status, await response.clone().text()).toBe(202);
  return DraftBuildResponseSchema.parse(await response.json());
}
async function ready(w: Awaited<ReturnType<typeof work>>) {
  const build = await request(w);
  const id = decodeId("draft_build", build.origin.build_id);
  if (!id) throw new Error("Expected build ID");
  expect(await handleDraftBuild(h.services, { build_id: id })).toBe("ready");
  return `/v1/draft-builds/${build.origin.build_id}`;
}
async function revoke(creationId: string) {
  await t.app.db.transaction(async (tx) => {
    await lockDraftBuildCreation(tx, creationId);
    await tx
      .delete(creationCollaborators)
      .where(
        and(
          eq(creationCollaborators.creationId, creationId),
          eq(creationCollaborators.userId, editor),
        ),
      );
  });
}
async function blockedCreationLock() {
  await expect
    .poll(
      async () => {
        const result = await t.app.db.execute<{ blocked: number }>(sql`
      select count(*)::int as blocked from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'
        and cardinality(pg_blocking_pids(pid)) > 0 and query like '%creations%'
    `);
        return result.rows[0]?.blocked ?? 0;
      },
      { timeout: 5000, interval: 20 },
    )
    .toBeGreaterThan(0);
}
beforeAll(async () => {
  t = await createTestDatabase();
  h = await createHarness(t, testCas(), { extraModules: [uploadRoutes] });
  owner = await h.createUser("work-grant-owner");
  editor = await h.createUser("work-grant-editor");
  outsider = await h.createUser("work-grant-outsider");
  expect((await h.as(owner).post("/v1/namespaces", { slug: "work-grants" })).status).toBe(201);
});
afterAll(async () => {
  await h?.close();
  await t?.drop();
});

it("shares only saved work assets across owner/editor builds and avatar reads", async () => {
  const text = await upload(owner, new TextEncoder().encode(body), "text/markdown");
  const png = new Uint8Array(
    await sharp({ create: { width: 32, height: 32, channels: 3, background: "#25a" } })
      .png()
      .toBuffer(),
  );
  const avatar = await upload(owner, png, "image/png");
  const working: Working = {
    ...definition("shared"),
    assets: [
      {
        slot: "book",
        role: "context",
        variants: [
          {
            id: "default",
            media_type: text.media_type,
            blob: { digest: text.digest, size: text.size, availability: "mirrored" },
          },
        ],
      },
      {
        slot: "avatar",
        role: "presentation",
        variants: [
          {
            id: "default",
            media_type: avatar.media_type,
            blob: { digest: avatar.digest, size: avatar.size, availability: "mirrored" },
          },
        ],
      },
    ],
    sources: [
      {
        id: "book",
        title: "Book",
        description: "Shared work document",
        asset: "book",
        format: "markdown",
        visibility: { scope: "shared" },
      },
    ],
  };
  const w = await work("shared", working);
  const grants = await t.app.db
    .select()
    .from(creationAssetGrants)
    .where(eq(creationAssetGrants.creationId, w.id));
  expect(grants.map((row) => row.digest).sort()).toEqual([text.digest, avatar.digest].sort());
  const avatarRead = await h.as(editor).get(`${w.base}/draft/avatar`);
  expect(avatarRead.status, await avatarRead.clone().text()).toBe(200);
  const path = await ready(w);
  const reader = await h
    .as(editor)
    .get(
      `${path}/source-text?source=${encodeURIComponent("@work-grants/shared#source/book~root")}`,
    );
  expect(reader.status, await reader.clone().text()).toBe(200);
  expect((await reader.json()).text).toBe(body);
  expect((await h.as(outsider).get(`${w.base}/draft/avatar`)).status).toBe(404);
  expect((await h.as(outsider).get(path)).status).toBe(404);
  const own = await request(w, owner);
  expect(path.endsWith(own.origin.build_id)).toBe(false);
  const ownId = decodeId("draft_build", own.origin.build_id);
  if (!ownId) throw new Error("Expected build");
  expect(await handleDraftBuild(h.services, { build_id: ownId })).toBe("ready");
});

it("never grants unrelated uploads, another actor's bytes, or linked-only declarations", async () => {
  const included = await upload(
    editor,
    new TextEncoder().encode("included editor bytes"),
    "text/plain",
  );
  const unrelated = await upload(
    editor,
    new TextEncoder().encode("unrelated editor bytes"),
    "text/plain",
  );
  const privateOther = await upload(
    owner,
    new TextEncoder().encode("private owner bytes"),
    "text/plain",
  );
  const w = await work("scope");
  const a = (
    slot: string,
    blob: typeof included,
    availability: "mirrored" | "linked" = "mirrored",
  ) => ({
    slot,
    role: "context" as const,
    variants: [
      {
        id: "default",
        media_type: blob.media_type,
        blob: {
          digest: blob.digest,
          size: blob.size,
          availability,
          ...(availability === "linked"
            ? { locator: { provider: "http" as const, url: "https://example.test/other.txt" } }
            : {}),
        },
      },
    ],
  });
  const draft = DraftSchema.parse(await (await h.as(editor).get(`${w.base}/draft`)).json());
  const saved = await h
    .as(editor)
    .put(
      `${w.base}/draft`,
      { working: { ...(draft.working as object), assets: [a("included", included)] } },
      { "if-match": String(draft.version) },
    );
  expect(saved.status, await saved.clone().text()).toBe(200);
  await t.app.db.transaction(async (tx) => {
    await lockDraftBuildCreation(tx, w.id);
    await grantDraftAssets(
      tx,
      w.id,
      editor,
      { assets: [a("linked", unrelated, "linked"), a("stolen", privateOther)] },
      h.clock.now(),
    );
  });
  const grants = await t.app.db
    .select()
    .from(creationAssetGrants)
    .where(eq(creationAssetGrants.creationId, w.id));
  expect(grants.map((row) => row.digest)).toEqual([included.digest]);
  const sibling = await work("sibling");
  const fresh = DraftSchema.parse(await (await h.as(editor).get(`${sibling.base}/draft`)).json());
  expect(
    (
      await h
        .as(editor)
        .put(
          `${sibling.base}/draft`,
          { working: { ...(fresh.working as object), assets: [a("stolen", privateOther)] } },
          { "if-match": String(fresh.version) },
        )
    ).status,
  ).toBe(200);
  const build = await request(sibling);
  const id = decodeId("draft_build", build.origin.build_id);
  if (!id) throw new Error("Expected build");
  expect(await handleDraftBuild(h.services, { build_id: id })).toBe("failed");
  const failed = DraftBuildResponseSchema.parse(
    await (await h.as(editor).get(`/v1/draft-builds/${build.origin.build_id}`)).json(),
  );
  expect(JSON.stringify(failed.report)).toContain("asset.not_authorized");
});

it("lets a locked read finish before revocation, then refuses all new signatures without deleting shared bytes", async () => {
  const w = await work("read-before-revoke");
  const path = await ready(w);
  const payloads = h.services.draftPayloads;
  if (!payloads) throw new Error("Expected payloads");
  const entered = gate(),
    resume = gate();
  const original = payloads.readPayload.bind(payloads);
  const reading = vi.spyOn(payloads, "readPayload").mockImplementation(async (...args) => {
    entered.resolve();
    await resume.promise;
    return original(...args);
  });
  const signing = vi.spyOn(payloads, "signedGet");
  const get = h.as(editor).get(`${path}/artifact`);
  let revocation: Promise<void> | undefined;
  try {
    await entered.promise;
    revocation = revoke(w.id);
    await blockedCreationLock();
    resume.resolve();
    const response = await get;
    expect(response.status).toBe(302);
    await revocation;
    reading.mockRestore();
    expect(signing).toHaveBeenCalledTimes(1);
    expect((await h.as(editor).get(`${path}/artifact`)).status).toBe(404);
    expect((await h.as(editor).get(path)).status).toBe(404);
    expect(signing).toHaveBeenCalledTimes(1);
    // Already-issued URLs retain their bounded TTL; revocation never deletes CAS/payloads.
    expect((await fetch(response.headers.get("location") ?? "")).status).toBe(200);
    expect((await h.as(owner).get(path)).status).toBe(200);
  } finally {
    resume.resolve();
    await Promise.allSettled([get, ...(revocation ? [revocation] : [])]);
    reading.mockRestore();
    signing.mockRestore();
  }
});

it("rechecks authorization after waiting for a revocation permission lock", async () => {
  const w = await work("revoke-before-read");
  const path = await ready(w);
  const entered = gate(),
    resume = gate();
  const revocation = t.app.db.transaction(async (tx) => {
    await lockDraftBuildCreation(tx, w.id);
    await tx
      .delete(creationCollaborators)
      .where(
        and(eq(creationCollaborators.creationId, w.id), eq(creationCollaborators.userId, editor)),
      );
    entered.resolve();
    await resume.promise;
  });
  const payloads = h.services.draftPayloads;
  if (!payloads) throw new Error("Expected payloads");
  const signing = vi.spyOn(payloads, "signedGet");
  await entered.promise;
  const get = h.as(editor).get(`${path}/artifact`);
  try {
    await blockedCreationLock();
    resume.resolve();
    await revocation;
    expect((await get).status).toBe(404);
    expect(signing).not.toHaveBeenCalled();
  } finally {
    resume.resolve();
    await Promise.allSettled([revocation, get]);
    signing.mockRestore();
  }
});

it("fails a revoked requester's pending job while the owner can issue an independent build", async () => {
  const w = await work("pending-revoke");
  const pending = await request(w);
  await revoke(w.id);
  const id = decodeId("draft_build", pending.origin.build_id);
  if (!id) throw new Error("Expected build");
  expect(await handleDraftBuild(h.services, { build_id: id })).toBe("failed");
  const ownerBuild = await request(w, owner);
  expect(ownerBuild.origin.build_id).not.toBe(pending.origin.build_id);
  const ownerId = decodeId("draft_build", ownerBuild.origin.build_id);
  if (!ownerId) throw new Error("Expected build");
  expect(await handleDraftBuild(h.services, { build_id: ownerId })).toBe("ready");
});
