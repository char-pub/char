import { ASSEMBLER, TOKENIZER_VERSIONS } from "@char-pub/assembler";
import { DraftBuildResponseSchema, DraftSchema, UploadStatusSchema } from "@char-pub/contracts";
import {
  CreationArtifactSchema,
  type CreationInput,
  lateSlotKey,
  PRESET_REGIONS,
  sha256Bytes,
} from "@char-pub/core";
import { and, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { register as uploadRoutes } from "../src/api/routes/uploads.js";
import {
  blockedDigests,
  creationCollaborators,
  creations,
  draftBuilds,
  releases,
} from "../src/db/schema/index.js";
import { QUEUE_NAMES } from "../src/jobs/definitions.js";
import { decodeId, encodeId } from "../src/registry/ids.js";
import { processUpload } from "../src/upload/pipeline.js";
import {
  expireDraftBuilds,
  failDraftBuild,
  handleDraftBuild,
  requeueDraftBuilds,
} from "../src/worker/draft-build.js";
import { type ApiHarness, createHarness } from "./api-harness.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

let t: TestDatabase;
let h: ApiHarness;
let owner: string;
let stranger: string;
const meta = {
  default_locale: "en",
  rating: "general" as const,
  rights: "original" as const,
  license: "CC0-1.0",
};
type Working = Omit<CreationInput, "id" | "ref">;

function definition(name: string, type: "character" | "world" | "preset" = "character"): Working {
  return {
    type,
    display_name: name,
    meta,
    ...(type === "preset"
      ? {
          policy: {
            version: "1-draft" as const,
            blocks: [],
            layout: [...PRESET_REGIONS],
            requires: { system_role: true },
          },
        }
      : {
          fragments: [
            {
              id: "definition",
              stable: true,
              kind: type,
              content: { type: "text" as const, text: `Definition for ${name}` },
            },
          ],
        }),
  };
}
async function newDraft(name: string, working: Working = definition(name), as = owner) {
  const ns = as === owner ? "draft-author" : "draft-other";
  const created = await h
    .as(as)
    .post(`/v1/namespaces/${ns}/creations`, { name, type: working.type, display_name: name });
  expect(created.status, await created.clone().text()).toBe(201);
  const base = `/v1/creations/@${ns}/${name}`;
  const draft = DraftSchema.parse(await (await h.as(as).get(`${base}/draft`)).json());
  const saved = await h
    .as(as)
    .put(`${base}/draft`, { working }, { "if-match": String(draft.version) });
  expect(saved.status, await saved.clone().text()).toBe(200);
  return { base, version: ((await saved.json()) as { version: number }).version, working, as };
}
async function request(draft: Awaited<ReturnType<typeof newDraft>>) {
  return h
    .as(draft.as)
    .post(`${draft.base}/draft-builds`, {}, { "if-match": String(draft.version) });
}
async function requested(draft: Awaited<ReturnType<typeof newDraft>>) {
  const response = await request(draft);
  expect(response.status, await response.clone().text()).toBe(202);
  return DraftBuildResponseSchema.parse(await response.json());
}
function buildUuid(id: string) {
  const uuid = decodeId("draft_build", id);
  if (!uuid) throw new Error("Invalid build ID");
  return uuid;
}
async function rowOf(id: string) {
  const [row] = await t.app.db
    .select()
    .from(draftBuilds)
    .where(eq(draftBuilds.id, buildUuid(id)));
  if (!row) throw new Error("Missing build row");
  return row;
}
async function finish(id: string) {
  return handleDraftBuild(h.services, { build_id: buildUuid(id) });
}
async function polling(id: string, as = owner) {
  const response = await h.as(as).get(`/v1/draft-builds/${id}`);
  expect(response.status, await response.clone().text()).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  return DraftBuildResponseSchema.parse(await response.json());
}
async function artifactOf(id: string, as = owner) {
  const response = await h.as(as).get(`/v1/draft-builds/${id}/artifact`);
  expect(response.status, await response.clone().text()).toBe(302);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const url = response.headers.get("location");
  if (!url) throw new Error("Missing signed payload URL");
  const downloaded = await fetch(url);
  expect(downloaded.status).toBe(200);
  expect(downloaded.headers.get("cache-control")).toBe("private, no-store");
  const bytes = new Uint8Array(await downloaded.arrayBuffer());
  return {
    artifact: CreationArtifactSchema.parse(JSON.parse(new TextDecoder().decode(bytes))),
    bytes,
    url,
  };
}
async function sourceDraft(name: string) {
  const text = `# Intro\r\nPrivate source ${name}\r\n`;
  const bytes = new TextEncoder().encode(text);
  const response = await h.as(owner).post("/v1/uploads", {
    purpose: "asset",
    content_type: "text/markdown",
    size: bytes.length,
    sha256: sha256Bytes(bytes),
  });
  expect(response.status).toBe(201);
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
  expect((await h.as(owner).post(`/v1/uploads/${target.upload}/complete`)).status).toBe(202);
  expect(
    (
      await processUpload(
        {
          db: t.app.db,
          cas: h.services.cas,
          now: () => h.clock.now(),
          newId: h.services.ids.uuid,
          systemActorId: owner,
        },
        target.upload,
      )
    ).state,
  ).toBe("ready");
  const upload = UploadStatusSchema.parse(
    await (await h.as(owner).get(`/v1/uploads/${target.upload}`)).json(),
  );
  if (!upload.blob) throw new Error("Missing processed text");
  const working: Working = {
    ...definition(name, "world"),
    assets: [
      {
        slot: "book",
        role: "context",
        variants: [
          {
            id: "default",
            media_type: upload.blob.media_type,
            blob: { digest: upload.blob.digest, size: upload.blob.size, availability: "mirrored" },
          },
        ],
      },
    ],
    sources: [
      {
        id: "book",
        title: "Book",
        description: "Reference guide",
        format: "markdown",
        asset: "book",
        visibility: { scope: "shared" },
        sections: [{ id: "intro", title: "Intro", anchor: "#Intro" }],
      },
    ],
  };
  return { draft: await newDraft(name, working), text, bytes, blob: upload.blob };
}

beforeAll(async () => {
  t = await createTestDatabase();
  h = await createHarness(t, testCas(), { extraModules: [uploadRoutes] });
  owner = await h.createUser("draft-author");
  stranger = await h.createUser("draft-other");
  for (const [user, slug] of [
    [owner, "draft-author"],
    [stranger, "draft-other"],
  ] as const)
    expect((await h.as(user).post("/v1/namespaces", { slug })).status).toBe(201);
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await h?.close();
  await t?.drop();
});

describe("Registry-issued draft builds", () => {
  it("returns actual successful author test receipts for the saved draft build", async () => {
    const work: Working = {
      ...definition("Author checks"),
      type: "scenario",
      cast: [{ key: "player", who: { late: "persona" } }],
      fragments: [
        {
          id: "definition",
          stable: true,
          kind: "scenario",
          content: { type: "text", text: "A quiet room." },
        },
      ],
    };
    const draft = await newDraft("author-check-results", {
      ...work,
      assembly_tests: [
        {
          id: "opening",
          root: "self",
          profile: {
            runtime: { name: "test", version: "1" },
            tokenizer: "estimate",
            context_window: 4096,
            reserve_for_output: 128,
            mode: "narrator",
            capabilities: { system_role: true, multiple_system_messages: true },
          },
          session: {
            bindings: {
              user: { kind: "persona", display_name: "Reader" },
              [lateSlotKey("root", "player")]: { kind: "persona", display_name: "Player" },
            },
            history: [],
          },
          assembler: ASSEMBLER,
          tokenizer: { name: "estimate", version: TOKENIZER_VERSIONS.estimate },
          expected: {
            kind: "success",
            trace: [
              { source: "@draft-author/author-check-results#definition~root", included: true },
            ],
          },
        },
      ],
    });
    const build = await requested(draft);
    const outcome = await finish(build.origin.build_id);
    expect(outcome, JSON.stringify((await rowOf(build.origin.build_id)).report)).toBe("ready");
    const receipt = await polling(build.origin.build_id);
    expect(receipt.report).toMatchObject({
      assembly_tests: [
        { id: "opening", ok: true, issues: [], messages_digest: expect.stringMatching(/^sha256:/) },
      ],
    });
  });

  it("builds a real uploaded Source through HTTP, worker, signed artifact and source-text without a Release", async () => {
    const source = await sourceDraft("source-preview");
    const build = await requested(source.draft);
    const id = build.origin.build_id;
    expect(build.state).toBe("pending");
    expect((await polling(id)).state).toBe("pending");
    expect((await h.as(owner).get(`/v1/draft-builds/${id}/artifact`)).status).toBe(409);
    expect(await finish(id)).toBe("ready");
    const ready = await polling(id);
    expect(ready.state).toBe("ready");
    const { artifact, bytes } = await artifactOf(id);
    expect(sha256Bytes(bytes)).toBe(ready.artifact_digest);
    expect(artifact.root).toMatchObject({
      origin: build.origin,
      semantic_digest: build.semantic_digest,
    });
    expect(artifact.root).not.toHaveProperty("release");
    if (artifact.kind !== "content") throw new Error("Expected content artifact");
    expect(artifact.ir.root).toEqual(artifact.root);
    const document = artifact.catalog_index.sources[0];
    if (!document) throw new Error("Expected Source");
    const sourceResponse = await h
      .as(owner)
      .get(`/v1/draft-builds/${id}/source-text?source=${encodeURIComponent(document.id)}`);
    expect(sourceResponse.status, await sourceResponse.clone().text()).toBe(200);
    expect(sourceResponse.headers.get("cache-control")).toBe("private, no-store");
    expect(await sourceResponse.json()).toMatchObject({
      source: document.id,
      digest: source.blob.digest,
      text: source.text,
    });
    const assetResponse = await h
      .as(owner)
      .get(`/v1/draft-builds/${id}/assets?asset=${encodeURIComponent(document.asset)}`);
    expect(assetResponse.status, await assetResponse.clone().text()).toBe(302);
    expect(assetResponse.headers.get("cache-control")).toBe("private, no-store");
    const assetUrl = assetResponse.headers.get("location");
    if (!assetUrl) throw new Error("Missing signed asset URL");
    expect(new URL(assetUrl).searchParams.get("X-Amz-Expires")).toBe("900");
    const downloadedAsset = await fetch(assetUrl);
    expect(downloadedAsset.status).toBe(200);
    expect(downloadedAsset.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await downloadedAsset.arrayBuffer())).toEqual(source.bytes);
    expect(
      (
        await h
          .as(owner)
          .get(`/v1/draft-builds/${id}/assets?asset=${encodeURIComponent(source.blob.digest)}`)
      ).status,
    ).toBe(404);
    const row = await rowOf(id);
    expect(
      await t.app.db.select().from(releases).where(eq(releases.creationId, row.creationId)),
    ).toHaveLength(0);
    await expect(h.services.cas.getBlob("public", source.blob.digest)).rejects.toThrow();
    expect(await finish(id)).toBe("skipped");
  });

  it("requires If-Match and reuses a single build for concurrent requests and a ready preset", async () => {
    const draft = await newDraft("preset-preview", definition("Preset preview", "preset"));
    expect((await h.as(owner).post(`${draft.base}/draft-builds`, {})).status).toBe(428);
    expect(
      (
        await h
          .as(owner)
          .post(`${draft.base}/draft-builds`, {}, { "if-match": String(draft.version + 1) })
      ).status,
    ).toBe(409);
    const replies = await Promise.all([request(draft), request(draft)]);
    expect(replies.map((r) => r.status).sort()).toEqual([200, 202]);
    const builds = await Promise.all(
      replies.map(async (r) => DraftBuildResponseSchema.parse(await r.json())),
    );
    expect(builds[0]?.origin).toEqual(builds[1]?.origin);
    const id = builds[0]?.origin.build_id;
    if (!id) throw new Error("Missing build");
    expect(await finish(id)).toBe("ready");
    const reused = await request(draft);
    expect(reused.status).toBe(200);
    expect(DraftBuildResponseSchema.parse(await reused.json()).origin.build_id).toBe(id);
    const { artifact } = await artifactOf(id);
    expect(artifact.kind).toBe("preset");
    if (artifact.kind !== "preset") throw new Error("Expected preset");
    if (!("origin" in artifact.root)) throw new Error("Expected draft root identity");
    expect(artifact.preset).toMatchObject({ origin: artifact.root.origin });
    expect(artifact.preset).not.toHaveProperty("release");
    const row = await rowOf(id);
    expect(
      await t.app.db.select().from(draftBuilds).where(eq(draftBuilds.creationId, row.creationId)),
    ).toHaveLength(1);
  });

  it("freezes the exact revision and default policy before later edits or deployment configuration changes", async () => {
    const draft = await newDraft("fixed-input");
    const build = await requested(draft);
    const id = build.origin.build_id;
    const oldPolicy = h.services.defaultPolicy;
    if (!oldPolicy) throw new Error("Expected configured test default policy");
    expect((await rowOf(id)).defaultPolicy).toEqual(oldPolicy);
    const edited = await h
      .as(owner)
      .put(
        `${draft.base}/draft`,
        { working: { ...draft.working, display_name: "Later edits" } },
        { "if-match": String(draft.version) },
      );
    expect(edited.status).toBe(200);
    h.services.defaultPolicy = { ...oldPolicy, release: encodeId("release", uuidv7()) };
    try {
      expect(await finish(id)).toBe("ready");
      const { artifact } = await artifactOf(id);
      expect(artifact.root).toMatchObject({
        semantic_digest: build.semantic_digest,
        origin: build.origin,
      });
      if (artifact.kind !== "content") throw new Error("Expected content");
      expect(artifact.default_policy).toMatchObject(oldPolicy);
      expect((await rowOf(id)).defaultPolicy).toEqual(oldPolicy);
    } finally {
      h.services.defaultPolicy = oldPolicy;
    }
  });

  it("revalidates a cached ready build against current blocked content before reuse or downloading", async () => {
    const draft = await newDraft("blocked-cache");
    const build = await requested(draft);
    const id = build.origin.build_id;
    expect(await finish(id)).toBe("ready");
    await artifactOf(id);
    await t.app.db
      .insert(blockedDigests)
      .values({ digest: build.semantic_digest, reason: "test-draft-build-block" });
    for (const response of [
      await request(draft),
      await h.as(owner).get(`/v1/draft-builds/${id}`),
      await h.as(owner).get(`/v1/draft-builds/${id}/artifact`),
    ]) {
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: "draft_build.check_failed" });
    }
  });

  it("rechecks access to an exact private dependency when a ready build is read or reused", async () => {
    const dependency = await newDraft(
      "private-dependency",
      definition("Private dependency"),
      stranger,
    );
    const revision = (await (
      await h.as(stranger).post(`${dependency.base}/revisions`, {})
    ).json()) as { id: string };
    const published = await h
      .as(stranger)
      .post(
        `${dependency.base}/releases`,
        { revision: revision.id, label: "1", visibility: "private" },
        { "idempotency-key": "draft-private-dependency" },
      );
    expect(published.status).toBe(202);
    const publicRelease = (await published.json()) as { release: string };
    expect(await h.runPublishJobs()).toEqual(["published"]);
    const releaseId = decodeId("release", publicRelease.release);
    if (!releaseId) throw new Error("Expected release");
    const [release] = await t.app.db.select().from(releases).where(eq(releases.id, releaseId));
    if (!release) throw new Error("Expected private dependency");
    await t.app.db.insert(creationCollaborators).values({
      creationId: release.creationId,
      userId: owner,
      invitedBy: stranger,
      license: meta.license,
      acceptedAt: h.clock.now(),
    });
    const draft = await newDraft("revoked-dependency", {
      ...definition("Dependency consumer"),
      references: [
        {
          id: "dep",
          use: "@draft-other/private-dependency",
          mode: "default",
          pin: { release: publicRelease.release, semantic_digest: release.semanticDigest },
        },
      ],
    });
    const build = await requested(draft);
    expect(await finish(build.origin.build_id)).toBe("ready");
    await artifactOf(build.origin.build_id);
    await t.app.db
      .delete(creationCollaborators)
      .where(
        and(
          eq(creationCollaborators.creationId, release.creationId),
          eq(creationCollaborators.userId, owner),
        ),
      );
    for (const response of [
      await request(draft),
      await h.as(owner).get(`/v1/draft-builds/${build.origin.build_id}/artifact`),
    ]) {
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: "draft_build.dependency_unavailable" });
    }
  });

  it("defers pending work while read_only is enabled and resumes the same fixed build", async () => {
    const draft = await newDraft("read-only");
    const build = await requested(draft);
    await h.setFlag("read_only", false);
    try {
      expect(await finish(build.origin.build_id)).toBe("deferred");
      expect((await rowOf(build.origin.build_id)).state).toBe("pending");
      expect((await request(draft)).status).toBe(503);
    } finally {
      await h.setFlag("read_only", true);
    }
    expect(await finish(build.origin.build_id)).toBe("ready");
  });

  it("returns the same 404 for anonymous/non-member deletion of real and nonexistent build IDs", async () => {
    const build = await requested(
      await newDraft("delete-access", definition("Delete access", "preset")),
    );
    for (const user of [null, stranger])
      for (const id of [build.origin.build_id, encodeId("draft_build", uuidv7())])
        expect((await h.as(user).delete(`/v1/draft-builds/${id}`)).status).toBe(404);
    expect((await rowOf(build.origin.build_id)).state).toBe("pending");
  });

  it("deletes a build durably, then cleans dedicated payloads without deleting identical CAS bytes", async () => {
    const build = await requested(
      await newDraft("delete-payload", definition("Delete payload", "preset")),
    );
    const id = build.origin.build_id;
    expect(await finish(id)).toBe("ready");
    const { bytes, url } = await artifactOf(id);
    const shared = await h.services.cas.putBlob(t.app.db, {
      bucket: "private",
      bytes,
      mediaType: "application/json",
      kind: "artifact",
    });
    expect((await h.as(owner).delete(`/v1/draft-builds/${id}`)).status).toBe(204);
    expect((await polling(id)).state).toBe("deleted");
    expect((await h.as(owner).get(`/v1/draft-builds/${id}/artifact`)).status).toBe(410);
    expect(await finish(id)).toBe("skipped");
    await expireDraftBuilds(h.services);
    expect((await rowOf(id)).payloadDeletedAt).not.toBeNull();
    expect((await fetch(url)).status).toBe(404);
    expect(await h.services.cas.getBlob("private", shared.digest)).toEqual(bytes);
    expect(await expireDraftBuilds(h.services)).toBe(0);
  });

  it("expires and cleans a Source build while preserving the original uploaded shared asset", async () => {
    const source = await sourceDraft("expiry-source");
    const build = await requested(source.draft);
    const id = build.origin.build_id;
    expect(await finish(id)).toBe("ready");
    const { artifact } = await artifactOf(id);
    if (artifact.kind !== "content") throw new Error("Expected content");
    const sourceId = artifact.catalog_index.sources[0]?.id;
    if (!sourceId) throw new Error("Expected Source");
    h.clock.advance(new Date(build.origin.expires_at).getTime() - h.clock.now().getTime() + 1);
    expect((await polling(id)).state).toBe("expired");
    expect((await h.as(owner).get(`/v1/draft-builds/${id}/artifact`)).status).toBe(410);
    expect(
      (
        await h
          .as(owner)
          .get(`/v1/draft-builds/${id}/source-text?source=${encodeURIComponent(sourceId)}`)
      ).status,
    ).toBe(410);
    expect(await expireDraftBuilds(h.services)).toBeGreaterThanOrEqual(1);
    expect((await rowOf(id)).state).toBe("expired");
    expect((await rowOf(id)).payloadDeletedAt).not.toBeNull();
    expect(await h.services.cas.getBlob("private", source.blob.digest)).toEqual(source.bytes);
  });

  it("keeps transient storage failure pending, then records final failure without later resurrection", async () => {
    const build = await requested(
      await newDraft("final-failure", definition("Final failure", "preset")),
    );
    const store = h.services.draftPayloads;
    if (!store) throw new Error("Missing payload store");
    const write = vi
      .spyOn(store, "writePayload")
      .mockRejectedValueOnce(new Error("temporary storage outage"));
    await expect(finish(build.origin.build_id)).rejects.toThrow("temporary storage outage");
    write.mockRestore();
    expect((await rowOf(build.origin.build_id)).state).toBe("pending");
    // Same terminal callback used by JobQueue.work after retries are exhausted.
    await failDraftBuild(h.services, buildUuid(build.origin.build_id));
    const failed = await polling(build.origin.build_id);
    expect(failed.state).toBe("failed");
    expect(failed.report).toMatchObject({ issues: [{ code: "draft_build.worker_failed" }] });
    expect(await finish(build.origin.build_id)).toBe("skipped");
    expect(
      (await h.as(owner).get(`/v1/draft-builds/${build.origin.build_id}/artifact`)).status,
    ).toBe(409);
  });

  it("fails a pending worker after work collaboration is revoked while the owner can still read its receipt", async () => {
    const requester = await h.createUser("revoked-draft-requester");
    const draft = await newDraft("revoked-requester", definition("Revoked requester", "preset"));
    const [creation] = await t.app.db
      .select()
      .from(creations)
      .where(eq(creations.name, "revoked-requester"));
    if (!creation) throw new Error("Missing work");
    await t.app.db.insert(creationCollaborators).values({
      creationId: creation.id,
      userId: requester,
      invitedBy: owner,
      license: meta.license,
      acceptedAt: h.clock.now(),
    });
    const response = await h
      .as(requester)
      .post(`${draft.base}/draft-builds`, {}, { "if-match": String(draft.version) });
    expect(response.status, await response.clone().text()).toBe(202);
    const build = DraftBuildResponseSchema.parse(await response.json());
    expect((await rowOf(build.origin.build_id)).requesterId).toBe(requester);
    await t.app.db
      .delete(creationCollaborators)
      .where(
        and(
          eq(creationCollaborators.creationId, creation.id),
          eq(creationCollaborators.userId, requester),
        ),
      );
    expect(await finish(build.origin.build_id)).toBe("failed");
    const receipt = await polling(build.origin.build_id);
    expect(receipt.state).toBe("failed");
    expect(receipt.artifact_digest).toBeUndefined();
    expect((await h.as(requester).get(`/v1/draft-builds/${build.origin.build_id}`)).status).toBe(
      404,
    );
    expect(
      (await h.as(owner).get(`/v1/draft-builds/${build.origin.build_id}/artifact`)).status,
    ).toBe(409);
  });

  it("reuses builds without new quota and enforces retained/hourly limits even after deletion", async () => {
    const previousLimits = h.services.draftBuildLimits;
    h.services.draftBuildLimits = { retained: 1, perHour: 20 };
    try {
      const draft = await newDraft("build-quota", definition("Quota first", "preset"));
      const first = await requested(draft);
      const pendingReuse = await request(draft);
      expect(pendingReuse.status).toBe(200);
      expect(DraftBuildResponseSchema.parse(await pendingReuse.json()).origin.build_id).toBe(
        first.origin.build_id,
      );
      expect(await finish(first.origin.build_id)).toBe("ready");
      const readyReuse = await request(draft);
      expect(readyReuse.status).toBe(200);
      expect(DraftBuildResponseSchema.parse(await readyReuse.json()).origin.build_id).toBe(
        first.origin.build_id,
      );
      const changed = { ...draft.working, display_name: "Quota second" };
      const save = await h
        .as(owner)
        .put(`${draft.base}/draft`, { working: changed }, { "if-match": String(draft.version) });
      expect(save.status).toBe(200);
      const changedDraft = {
        ...draft,
        working: changed,
        version: ((await save.json()) as { version: number }).version,
      };
      const retained = await request(changedDraft);
      expect(retained.status).toBe(429);
      expect(await retained.json()).toMatchObject({ code: "draft_build.limit" });
      const firstRow = await rowOf(first.origin.build_id);
      expect(
        await t.app.db
          .select()
          .from(draftBuilds)
          .where(eq(draftBuilds.creationId, firstRow.creationId)),
      ).toHaveLength(1);

      h.services.draftBuildLimits = { retained: 20, perHour: 1 };
      expect((await h.as(owner).delete(`/v1/draft-builds/${first.origin.build_id}`)).status).toBe(
        204,
      );
      const hourly = await request(changedDraft);
      expect(hourly.status).toBe(429);
      expect(await hourly.json()).toMatchObject({ code: "draft_build.limit" });
      h.clock.advance(60 * 60_000 + 1);
      const second = await requested(changedDraft);
      expect(second.origin.build_id).not.toBe(first.origin.build_id);
      expect(second.semantic_digest).not.toBe(first.semantic_digest);
      expect(await finish(second.origin.build_id)).toBe("ready");
      expect(
        await t.app.db
          .select()
          .from(draftBuilds)
          .where(eq(draftBuilds.creationId, firstRow.creationId)),
      ).toHaveLength(2);
    } finally {
      if (previousLimits) h.services.draftBuildLimits = previousLimits;
      else delete h.services.draftBuildLimits;
    }
  });

  it("requeues a genuinely lost pending job after six minutes but excludes expired and deleted builds", async () => {
    const expired = await requested(
      await newDraft("lost-expired", definition("Lost expired", "preset")),
    );
    h.clock.advance(new Date(expired.origin.expires_at).getTime() - h.clock.now().getTime() + 1);
    // Keep the expired receipt pending: requeue must inspect expiresAt, not just state.
    expect((await rowOf(expired.origin.build_id)).state).toBe("pending");
    const pending = await requested(
      await newDraft("lost-pending", definition("Lost pending", "preset")),
    );
    const deleted = await requested(
      await newDraft("lost-deleted", definition("Lost deleted", "preset")),
    );
    expect((await h.as(owner).delete(`/v1/draft-builds/${deleted.origin.build_id}`)).status).toBe(
      204,
    );
    const originalJobs = new Map<string, string>();
    for (const build of [expired, pending, deleted]) {
      const key = `draft:${buildUuid(build.origin.build_id)}`;
      const jobs = await h.queue.boss.findJobs<{ build_id: string }>(QUEUE_NAMES.draftBuild, {
        key,
      });
      expect(jobs).toHaveLength(1);
      const job = jobs[0];
      if (!job) throw new Error("Missing original queued job");
      originalJobs.set(build.origin.build_id, job.id);
      await h.queue.boss.deleteJob(QUEUE_NAMES.draftBuild, job.id);
      expect(await h.queue.boss.findJobs(QUEUE_NAMES.draftBuild, { key })).toHaveLength(0);
    }
    expect(await requeueDraftBuilds(h.services)).toBe(0);
    h.clock.advance(6 * 60_000);
    expect(await requeueDraftBuilds(h.services)).toBe(1);
    const jobs = await h.queue.boss.findJobs<{ build_id: string }>(QUEUE_NAMES.draftBuild, {
      key: `draft:${buildUuid(pending.origin.build_id)}`,
    });
    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    if (!job) throw new Error("Missing requeued job");
    expect(job.id).not.toBe(originalJobs.get(pending.origin.build_id));
    expect(job.data).toEqual({ build_id: buildUuid(pending.origin.build_id) });
    expect(await requeueDraftBuilds(h.services)).toBe(0);
    for (const build of [expired, deleted])
      expect(
        await h.queue.boss.findJobs(QUEUE_NAMES.draftBuild, {
          key: `draft:${buildUuid(build.origin.build_id)}`,
        }),
      ).toHaveLength(0);
    expect(await handleDraftBuild(h.services, job.data)).toBe("ready");
    expect((await polling(pending.origin.build_id)).state).toBe("ready");
  });
});
