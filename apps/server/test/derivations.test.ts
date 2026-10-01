import { DraftBuildResponseSchema, DraftSchema, UploadStatusSchema } from "@char-pub/contracts";
import {
  CreationArtifactSchema,
  type CreationInput,
  initStoryState,
  sha256Bytes,
} from "@char-pub/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { register as reads } from "../src/api/routes/read.js";
import { register as uploads } from "../src/api/routes/uploads.js";
import {
  creationAssetGrants,
  creationDerivations,
  creationDrafts,
  creations,
  releaseFragments,
  releaseLocks,
  releases,
} from "../src/db/schema/index.js";
import { decodeId } from "../src/registry/ids.js";
import { processUpload } from "../src/upload/pipeline.js";
import { handleDraftBuild } from "../src/worker/draft-build.js";
import { type ApiHarness, createHarness, type Requester } from "./api-harness.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

let t: TestDatabase;
let h: ApiHarness;
let owner: string;
let writer: string;
let sequence = 0;
const meta = {
  default_locale: "en",
  license: "CC0-1.0",
  rights: "original",
  rating: "general",
} as const;
const rights_ack = { inbound_equals_outbound: true } as const;
const character = (): Omit<CreationInput, "id" | "ref"> => ({
  type: "character",
  display_name: "Courier",
  meta,
  fragments: [
    {
      id: "description",
      stable: true,
      kind: "character",
      content: { type: "text", text: "A patient courier." },
    },
  ],
});
function requireId(type: "creation" | "release" | "draft_build", value: string) {
  const id = decodeId(type, value);
  if (!id) throw new Error("Invalid test identity");
  return id;
}
async function json(response: Response, status: number) {
  expect(response.status, await response.clone().text()).toBe(status);
  return response.json();
}
async function publish(
  who: Requester,
  path: string,
  visibility: "public" | "private" = "public",
  label = "1.0.0",
) {
  const response = await who.post(`${path}/revisions`, {});
  expect([200, 201], await response.clone().text()).toContain(response.status);
  const revision = await response.json();
  const publication = await json(
    await who.post(
      `${path}/releases`,
      { revision: revision.id, label, visibility },
      { "idempotency-key": `derive-test-${++sequence}` },
    ),
    202,
  );
  expect(await h.runPublishJobs()).toEqual(["published"]);
  return {
    release: publication.release as string,
    semantic_digest: revision.semantic_digest as string,
  };
}
async function source(working = character(), visibility: "public" | "private" = "public") {
  const name = `source-${++sequence}`;
  const created = await json(
    await h.as(owner).post("/v1/namespaces/derive-owner/creations", {
      name,
      type: working.type,
      display_name: "Original",
      working,
    }),
    201,
  );
  const path = `/v1/creations/${created.ref}`;
  return {
    source: { ref: created.ref as string, ...(await publish(h.as(owner), path, visibility)) },
    path,
  };
}
async function derive(
  origin: Awaited<ReturnType<typeof source>>,
  kind: "remix" | "sequel" = "remix",
  ending?: string,
) {
  const name = `derived-${++sequence}`;
  const response = await h.as(writer).post("/v1/namespaces/derive-writer/derivations", {
    source: origin.source,
    kind,
    name,
    display_name: "My story",
    rights_ack,
    ...(ending ? { ending } : {}),
  });
  const created = await json(response, 201);
  const path = `/v1/creations/${created.ref}`;
  const draft = DraftSchema.parse(await (await h.as(writer).get(`${path}/draft`)).json());
  return { created, path, draft };
}
async function artifact(work: Awaited<ReturnType<typeof derive>>) {
  const requested = await h
    .as(writer)
    .post(`${work.path}/draft-builds`, {}, { "if-match": String(work.draft.version) });
  const receipt = DraftBuildResponseSchema.parse(await json(requested, 202));
  expect(
    await handleDraftBuild(h.services, {
      build_id: requireId("draft_build", receipt.origin.build_id),
    }),
  ).toBe("ready");
  const response = await h.as(writer).get(`/v1/draft-builds/${receipt.origin.build_id}/artifact`);
  expect(response.status).toBe(302);
  const location = response.headers.get("location");
  if (!location) throw new Error("Missing artifact URL");
  return CreationArtifactSchema.parse(await (await fetch(location)).json());
}
beforeAll(async () => {
  t = await createTestDatabase();
  h = await createHarness(t, testCas(), { extraModules: [reads, uploads] });
  owner = await h.createUser("Source Author");
  writer = await h.createUser("New Author");
  await json(await h.as(owner).post("/v1/namespaces", { slug: "derive-owner" }), 201);
  await json(await h.as(writer).post("/v1/namespaces", { slug: "derive-writer" }), 201);
});
afterAll(async () => {
  await h?.close();
  await t?.drop();
});

it("remixes an exact release with original attribution, source lock and a separately publishable work", async () => {
  const original = await source();
  const copied = await derive(original);
  expect(copied.draft.working).toMatchObject({
    ref: copied.created.ref,
    authors: [{ name: "@derive-owner" }, { name: "@derive-writer" }],
    provenance: { derived_from: [{ ...original.source, relation: "remix" }] },
  });
  const built = await artifact(copied);
  expect(built.lock).toContainEqual(expect.objectContaining(original.source));
  expect(built.meta.attribution).toContainEqual(
    expect.objectContaining({ ref: original.source.ref }),
  );
  expect(built.kind).toBe("content");
  if (built.kind !== "content") throw new Error("Content required");
  expect(
    built.ir.fragments.filter(
      (fragment) =>
        fragment.content.type === "text" && fragment.content.text === "A patient courier.",
    ),
  ).toHaveLength(1);
  await publish(h.as(writer), copied.path);
  const record = await t.app.db
    .select()
    .from(creationDerivations)
    .where(eq(creationDerivations.creationId, requireId("creation", copied.created.id)));
  expect(record[0]).toMatchObject({ source: original.source, kind: "remix" });
});

it("prepares a sequel with its own two roles and an authored ending effect, without running the old plot", async () => {
  const original = await source({
    type: "scenario",
    display_name: "Two guards",
    meta,
    cast: [
      { key: "alice", who: { late: "character" } },
      { key: "bob", who: { late: "character" } },
    ],
    story: {
      version: 1,
      vars: { trust: { type: "int", min: 0, max: 10, init: 1, description: "Trust" } },
      scenes: [{ id: "gate", title: "Gate", opening: "Old beginning" }],
      endings: [
        {
          id: "peace",
          title: "Peace",
          description: "They agree",
          effects: [{ set: ["var/trust", 4] }],
        },
      ],
    },
  });
  const copied = await derive(original, "sequel", "peace");
  const built = await artifact(copied);
  if (built.kind !== "content") throw new Error("Content required");
  expect(
    built.ir.participants
      .filter((participant) => participant.cast_key)
      .map((participant) => participant.cast_key),
  ).toEqual(["alice", "bob"]);
  expect(built.ir.graph.instances.some((instance) => instance.ref === original.source.ref)).toBe(
    false,
  );
  expect(Object.keys(built.story_refs?.participants ?? {})).toEqual(["alice", "bob"]);
  expect(built.story?.starts?.[0]?.set).toEqual([{ set: ["var/trust", 4] }]);
  expect(built.story?.endings ?? []).toEqual([]);
  expect(built.story?.scenes.some((scene) => scene.opening === "Old beginning")).toBe(false);
  expect(built.lock).toContainEqual(expect.objectContaining(original.source));
});

it("refuses private, mismatched, non-derivative and withdrawn sources and requires the rights confirmation", async () => {
  const hidden = await source(character(), "private");
  const denied = await source({ ...character(), meta: { ...meta, license: "CC-BY-ND-4.0" } });
  const valid = await source();
  const call = (pin = valid.source, extra = {}) =>
    h.as(writer).post("/v1/namespaces/derive-writer/derivations", {
      source: pin,
      kind: "remix",
      name: `blocked-${++sequence}`,
      display_name: "Blocked",
      rights_ack,
      ...extra,
    });
  expect((await call(hidden.source)).status).toBe(404);
  expect((await call(denied.source)).status).toBe(422);
  expect(
    (await call({ ...valid.source, semantic_digest: `sha256:${"0".repeat(64)}` })).status,
  ).toBe(422);
  expect(
    (await call(valid.source, { rights_ack: { inbound_equals_outbound: false } })).status,
  ).toBe(422);
  expect(
    (
      await h.as(owner).post("/v1/namespaces/derive-writer/derivations", {
        source: valid.source,
        kind: "remix",
        name: "wrong-owner",
        display_name: "Wrong",
        rights_ack,
      })
    ).status,
  ).toBe(403);
  await t.app.db
    .update(releases)
    .set({ status: "yanked" })
    .where(eq(releases.id, requireId("release", valid.source.release)));
  expect((await call()).status).toBe(422);
});

it("cannot erase a verified origin through draft writes", async () => {
  const copied = await derive(await source());
  const response = await h
    .as(writer)
    .put(
      `${copied.path}/draft`,
      { working: { ...(copied.draft.working as Record<string, unknown>), provenance: {} } },
      { "if-match": String(copied.draft.version) },
    );
  expect(response.status, await response.clone().text()).toBe(422);
  expect((await response.json()).code).toBe("check.derivation_source_required");
  expect(
    DraftSchema.parse(await (await h.as(writer).get(`${copied.path}/draft`)).json()).version,
  ).toBe(copied.draft.version);
});

it("grants only copied Source bytes to the derived work", async () => {
  const bytes = new TextEncoder().encode("\uFEFF# Notes\r\nCafe\u0301 background.  \r\n");
  const target = await json(
    await h.as(owner).post("/v1/uploads", {
      purpose: "asset",
      content_type: "text/markdown",
      size: bytes.length,
      sha256: sha256Bytes(bytes),
    }),
    201,
  );
  expect(
    (
      await fetch(target.put_url, {
        method: "PUT",
        headers: target.headers,
        body: Buffer.from(bytes),
      })
    ).status,
  ).toBe(200);
  await json(await h.as(owner).post(`/v1/uploads/${target.upload}/complete`, {}), 202);
  expect(
    (
      await processUpload(
        {
          db: t.app.db,
          cas: h.services.cas,
          now: h.clock.now,
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
  if (!upload.blob) throw new Error("Missing Source bytes");
  const original = await source({
    ...character(),
    assets: [
      {
        slot: "notes",
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
        id: "notes",
        title: "Notes",
        description: "Background",
        format: "markdown",
        asset: "notes",
        visibility: { scope: "shared" },
      },
    ],
  });
  const copied = await derive(original);
  const built = await artifact(copied);
  expect(built.assets.filter((asset) => asset.digest === upload.blob?.digest)).toHaveLength(1);
  const grants = await t.app.db
    .select()
    .from(creationAssetGrants)
    .where(eq(creationAssetGrants.creationId, requireId("creation", copied.created.id)));
  expect(grants.map((grant) => grant.digest)).toEqual([upload.blob.digest]);
  await publish(h.as(writer), copied.path);
});

it("keeps historical source versions while the new work upgrades its active dependency", async () => {
  const guard = await source();
  const parent = await source({
    type: "scenario",
    display_name: "Gate",
    meta,
    references: [
      {
        id: "guard",
        use: guard.source.ref,
        mode: "default",
        pin: { release: guard.source.release, semantic_digest: guard.source.semantic_digest },
      },
    ],
    cast: [{ key: "guard", who: guard.source.ref }],
    story: { version: 1, scenes: [{ id: "gate", title: "Gate" }] },
  });
  const oldDraft = DraftSchema.parse(await (await h.as(owner).get(`${guard.path}/draft`)).json());
  const newContent = {
    ...(oldDraft.working as Record<string, unknown>),
    fragments: [
      {
        id: "description",
        stable: true,
        kind: "character",
        content: { type: "text", text: "A changed courier." },
      },
    ],
  };
  await json(
    await h
      .as(owner)
      .put(
        `${guard.path}/draft`,
        { working: newContent },
        { "if-match": String(oldDraft.version) },
      ),
    200,
  );
  const newer = await publish(h.as(owner), guard.path, "public", "2.0.0");
  const copied = await derive(parent);
  const working = copied.draft.working as Record<string, unknown>;
  await json(
    await h.as(writer).put(
      `${copied.path}/draft`,
      {
        working: {
          ...working,
          references: [{ id: "guard", use: guard.source.ref, mode: "default", pin: newer }],
        },
      },
      { "if-match": String(copied.draft.version) },
    ),
    200,
  );
  copied.draft = DraftSchema.parse(await (await h.as(writer).get(`${copied.path}/draft`)).json());
  const built = await artifact(copied);
  expect(
    built.lock
      .filter((entry) => entry.ref === guard.source.ref)
      .map((entry) => entry.release)
      .sort(),
  ).toEqual([guard.source.release, newer.release].sort());
  if (built.kind !== "content") throw new Error("Content required");
  const rendered = built.ir.fragments.map((fragment) =>
    fragment.content.type === "text" ? fragment.content.text : "",
  );
  expect(rendered).toContain("A changed courier.");
  expect(rendered).not.toContain("A patient courier.");
  expect(
    built.ir.participants.filter((participant) => participant.cast_key === "guard"),
  ).toHaveLength(1);
  const published = await publish(h.as(writer), copied.path);
  const id = requireId("release", published.release);
  const locks = await t.app.db.select().from(releaseLocks).where(eq(releaseLocks.releaseId, id));
  expect(
    locks.filter((row) =>
      [guard.source.release, newer.release].some(
        (release) => requireId("release", release) === row.depReleaseId,
      ),
    ),
  ).toHaveLength(2);
  const fragments = await t.app.db
    .select()
    .from(releaseFragments)
    .where(eq(releaseFragments.releaseId, id));
  const historical = fragments.filter(
    (row) => row.ownerRef === guard.source.ref && row.fragmentId === "description",
  );
  expect(historical).toHaveLength(2);
  expect(new Set(historical.map((row) => row.digest)).size).toBe(2);
});

it("allows adapting a permissive Scenario which keeps its no-derivatives character unchanged", async () => {
  const guard = await source({ ...character(), meta: { ...meta, license: "CC-BY-ND-4.0" } });
  const original = await source({
    type: "scenario",
    display_name: "An adaptable setting",
    meta,
    references: [
      {
        id: "guard",
        use: guard.source.ref,
        mode: "default",
        pin: { release: guard.source.release, semantic_digest: guard.source.semantic_digest },
      },
    ],
    cast: [{ key: "guard", who: guard.source.ref }],
    story: { version: 1, scenes: [{ id: "gate", title: "Gate" }] },
  });
  const copied = await derive(original);
  const built = await artifact(copied);
  expect(built.meta.licenses).toContainEqual(
    expect.objectContaining({ ref: guard.source.ref, license: "CC-BY-ND-4.0" }),
  );
  await publish(h.as(writer), copied.path);
});

const playedScenario = (): Omit<CreationInput, "id" | "ref"> => ({
  type: "scenario",
  display_name: "Played gate",
  meta,
  cast: [
    { key: "alice", who: { late: "character" } },
    { key: "bob", who: { late: "character" } },
  ],
  fragments: [
    {
      id: "secret",
      stable: true,
      kind: "knowledge",
      content: { type: "text", text: "A hidden door." },
    },
  ],
  story: {
    version: 1,
    vars: { trust: { type: "int", min: 0, max: 10, init: 1, description: "Trust" } },
    scenes: [{ id: "gate", title: "Gate", opening: "OLD OPENING" }],
    knowing: { "#secret": { start: { knows: ["alice"] }, enter: { gate: { knows: "*" } } } },
    starts: [{ id: "old", scene: "gate", set: [{ add: ["var/trust", 2] }] }],
    endings: [
      {
        id: "peace",
        title: "Peace",
        description: "Agreement",
        effects: [{ add: ["var/trust", 2] }],
      },
    ],
  },
});
const playedSituation = () => ({
  scene: "gate",
  present: ["bob"],
  vars: { trust: 7 },
  knowing: { "#secret": ["bob"] },
  opening: "A reviewed new beginning.",
});

it("creates one private sequel from a reviewed situation and the exact source, without replaying old effects", async () => {
  const original = await source(playedScenario());
  const before = await t.app.db.select({ id: releases.id }).from(releases);
  const body = {
    source: original.source,
    kind: "sequel",
    name: `played-${++sequence}`,
    display_name: "Continued story",
    from_play: playedSituation(),
    rights_ack,
    agent: true,
  };
  const created = await json(
    await h.as(writer).post("/v1/namespaces/derive-writer/derivations", body),
    201,
  );
  const path = `/v1/creations/${created.ref}`;
  const draft = DraftSchema.parse(await json(await h.as(writer).get(`${path}/draft`), 200));
  expect(draft.working).toMatchObject({
    provenance: {
      authored_by_agent: true,
      derived_from: [{ ...original.source, relation: "sequel" }],
    },
    story: {
      vars: { trust: { init: 7 } },
      scenes: [{ id: "gate", opening: body.from_play.opening }],
    },
  });
  expect(draft.working).not.toHaveProperty("provenance.client_id");
  expect((await h.as(owner).get(`${path}/draft`)).status).toBe(404);
  expect((await h.as(writer).post("/v1/namespaces/derive-writer/derivations", body)).status).toBe(
    409,
  );
  const built = await artifact({ created, path, draft });
  if (built.kind !== "content" || !built.story || !built.story_refs)
    throw new Error("Story required");
  const state = initStoryState(built.story, Object.keys(built.story_refs.participants));
  expect(state).toMatchObject({
    scene: "gate",
    present: ["bob"],
    vars: { trust: 7 },
    knowing: { "#secret": ["bob"] },
    reached: [],
    ended: [],
    happened: [],
    stopped: false,
  });
  expect(built.story.endings ?? []).toEqual([]);
  expect(built.lock).toContainEqual(expect.objectContaining(original.source));
  expect(await t.app.db.select({ id: releases.id }).from(releases)).toEqual(before);
});

it("rejects untrusted continuation fields and invalid state before writing any work or asset grant", async () => {
  const original = await source(playedScenario());
  const base = {
    source: original.source,
    kind: "sequel",
    name: `invalid-play-${++sequence}`,
    display_name: "Invalid",
    rights_ack,
    from_play: playedSituation(),
  };
  const sizes = async () =>
    Promise.all(
      [creations, creationDrafts, creationDerivations, creationAssetGrants].map(
        async (table) => (await t.app.db.select().from(table)).length,
      ),
    );
  const before = await sizes();
  for (const extra of [
    { kind: "remix" },
    { ending: "peace" },
    { working: {} },
    { provenance: { client_id: "forged" } },
    { rights_ack: { inbound_equals_outbound: false } },
    { from_play: { ...playedSituation(), history: [{ role: "user", text: "PRIVATE" }] } },
    { from_play: { ...playedSituation(), scene: "missing" } },
    { from_play: { ...playedSituation(), present: ["foreign"] } },
    { from_play: { ...playedSituation(), vars: { trust: 11 } } },
    { from_play: { ...playedSituation(), knowing: { "#secret": ["foreign"] } } },
    { from_play: { ...playedSituation(), knowing: { "@other/private#secret": ["bob"] } } },
    { source: { ...original.source, semantic_digest: `sha256:${"0".repeat(64)}` } },
  ]) {
    const response = await h
      .as(writer)
      .post("/v1/namespaces/derive-writer/derivations", { ...base, ...extra });
    expect([400, 422], await response.clone().text()).toContain(response.status);
  }
  expect(await sizes()).toEqual(before);
});

it("forces agent PAT provenance and preserves inherited agent authorship when the request says false", async () => {
  const original = await source({ ...playedScenario(), provenance: { authored_by_agent: true } });
  const token = await json(
    await h.as(writer).post("/v1/me/tokens", {
      name: "Story agent",
      scopes: ["creations:write"],
      expires_in_days: 1,
      agent: true,
    }),
    201,
  );
  for (const [requester, origin] of [
    [h.withToken(token.token), await source(playedScenario())],
    [h.as(writer), original],
  ] as const) {
    const created = await json(
      await requester.post("/v1/namespaces/derive-writer/derivations", {
        source: origin.source,
        kind: "sequel",
        name: `agent-play-${++sequence}`,
        display_name: "Continued",
        rights_ack,
        from_play: playedSituation(),
        agent: false,
      }),
      201,
    );
    const draft = DraftSchema.parse(
      await json(await h.as(writer).get(`/v1/creations/${created.ref}/draft`), 200),
    );
    expect(draft.working).toMatchObject({ provenance: { authored_by_agent: true } });
  }
});
