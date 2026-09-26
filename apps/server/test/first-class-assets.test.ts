import { ASSEMBLER, TOKENIZER_VERSIONS } from "@char-pub/assembler";
import {
  CreationArtifactSchema,
  type CreationType,
  canonicalizeCreation,
  digestOf,
  PRESET_REGIONS,
} from "@char-pub/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { register as registerContributions } from "../src/api/routes/contributions.js";
import { register as registerRead } from "../src/api/routes/read.js";
import { register as registerSearch } from "../src/api/routes/search.js";
import {
  assetMeta,
  blockedDigests,
  buildArtifacts,
  releaseLocks,
  releases,
  reverseEdges,
} from "../src/db/schema/index.js";
import { QUEUE_NAMES } from "../src/jobs/definitions.js";
import { loadClosure } from "../src/registry/closure.js";
import { decodeId } from "../src/registry/ids.js";
import { executeTombstone, type TombstoneCascadeJob } from "../src/registry/tombstone.js";
import { type ExportJob, handleExportJob } from "../src/worker/export.js";
import { RecordingPurger, runTombstoneCascade } from "../src/worker/tombstone.js";
import { type ApiHarness, createHarness } from "./api-harness.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

let t: TestDatabase;
let h: ApiHarness;
let alice: string;
let bob: string;
const cas = testCas();
const meta = { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" };
beforeAll(async () => {
  t = await createTestDatabase();
  h = await createHarness(t, cas, {
    extraModules: [registerRead, registerContributions, registerSearch],
  });
  alice = await h.createUser("asset-alice");
  bob = await h.createUser("asset-bob");
  expect((await h.as(alice).post("/v1/namespaces", { slug: "test-assets" })).status).toBe(201);
  expect((await h.as(bob).post("/v1/namespaces", { slug: "other" })).status).toBe(201);
});
afterAll(async () => {
  await h.close();
  await t.drop();
});

async function publish(
  name: string,
  type: CreationType,
  extra: Record<string, unknown> = {},
  visibility: "public" | "private" = "public",
  user = alice,
  namespace = "test-assets",
) {
  const me = h.as(user);
  const path = `/v1/creations/@${namespace}/${name}`;
  const created = await me.post(`/v1/namespaces/${namespace}/creations`, {
    name,
    type,
    display_name: name,
  });
  expect(created.status, await created.text()).toBe(201);
  const draft = (await (await me.get(`${path}/draft`)).json()) as {
    version: number;
    working: Record<string, unknown>;
  };
  const saved = await me.put(
    `${path}/draft`,
    { working: { ...draft.working, meta, ...extra } },
    { "if-match": String(draft.version) },
  );
  expect(saved.status, await saved.text()).toBe(200);
  const revision = await me.post(`${path}/revisions`, {});
  const revisionBody = (await revision.json()) as { id: string };
  expect(revision.status, JSON.stringify(revisionBody)).toBe(201);
  const result = await me.post(
    `${path}/releases`,
    { revision: revisionBody.id, label: "1.0.0", visibility },
    { "idempotency-key": `asset-test-${namespace}-${name}` },
  );
  const body = (await result.json()) as { release: string };
  expect(result.status, JSON.stringify(body)).toBe(202);
  const outcomes = await h.runPublishJobs();
  const id = decodeId("release", body.release);
  if (!id) throw new Error("bad release id");
  const [row] = await t.app.db.select().from(releases).where(eq(releases.id, id));
  if (!row) throw new Error("missing release");
  return {
    revision: revisionBody.id,
    row,
    publicId: body.release,
    path,
    outcomes,
    exact: {
      ref: `@${namespace}/${name}`,
      release: body.release,
      semantic_digest: row.semanticDigest,
    },
  };
}
const policy = (imports: unknown[] = []) => ({
  version: "0-draft",
  imports,
  blocks: [{ id: "main", text: "Literal {{user}} policy.", position: "main" }],
  layout: [...PRESET_REGIONS],
  requires: { system_role: true },
});

it("publishes every newly opened type with the correct artifact kind and discoverable metadata", async () => {
  for (const type of [
    "persona",
    "style",
    "relationship",
    "scenario",
    "preset",
    "prompt-module",
  ] as const) {
    const p = await publish(`initial-${type}`, type);
    expect(p.outcomes).toEqual(["published"]);
    expect(p.row.artifactDigest).toMatch(/^sha256:/);
    if (!p.row.artifactDigest) throw new Error("missing artifact");
    const artifact = CreationArtifactSchema.parse(
      JSON.parse(new TextDecoder().decode(await cas.getBlob("public", p.row.artifactDigest))),
    );
    expect(artifact.kind).toBe(type === "preset" || type === "prompt-module" ? type : "content");
    expect(artifact.root.release).toBe(p.publicId);
    const searched = await h.as(null).get(`/v1/search?type=${type}`);
    expect(searched.status).toBe(200);
    expect(JSON.stringify(await searched.json())).toContain(p.exact.ref);
    const detail = await h.as(null).get(`${p.path}/releases/1.0.0`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ artifact_digest: p.row.artifactDigest });
    expect((await h.as(null).get(`${p.path}/releases/1.0.0/artifact`)).status).toBe(302);
    if (type === "preset" || type === "prompt-module") {
      expect(p.row.contextIrDigest).toBeNull();
      expect((await h.as(null).get(`${p.path}/releases/1.0.0/ir`)).status).toBe(422);
      expect((await h.as(null).get(`${p.path}/releases/1.0.0/export/ccv3`)).status).toBe(422);
    }
  }
});

it("locks a module import and records a reverse policy dependency without fabricating content IR", async () => {
  const module = await publish("voice", "prompt-module", {
    prompt_module: {
      version: "0-draft",
      blocks: [{ id: "voice", text: "Speak calmly.", position: "main" }],
    },
  });
  expect(module.outcomes).toEqual(["published"]);
  const p = await publish("calm", "preset", {
    policy: policy([
      {
        id: "voice",
        use: module.exact.ref,
        pin: { release: module.exact.release, semantic_digest: module.exact.semantic_digest },
      },
    ]),
  });
  expect(p.outcomes).toEqual(["published"]);
  const locks = await t.app.db
    .select()
    .from(releaseLocks)
    .where(eq(releaseLocks.releaseId, p.row.id));
  expect(locks.some((lock) => lock.depReleaseId === module.row.id)).toBe(true);
  const edges = await t.app.db
    .select()
    .from(reverseEdges)
    .where(eq(reverseEdges.dependentReleaseId, p.row.id));
  expect(edges.some((edge) => edge.depReleaseId === module.row.id && edge.rel === "policy")).toBe(
    true,
  );
  if (!p.row.artifactDigest) throw new Error("missing artifact");
  const artifact = CreationArtifactSchema.parse(
    JSON.parse(new TextDecoder().decode(await cas.getBlob("public", p.row.artifactDigest))),
  );
  expect(artifact.kind).toBe("preset");
  if (artifact.kind !== "preset") throw new Error("expected preset");
  expect(artifact.preset.policy.blocks.map((block) => block.text)).toContain("Speak calmly.");
});

it("authorizes each policy dependency and keeps private artifacts private", async () => {
  const module = await publish("private-voice", "prompt-module", {}, "private");
  expect(module.outcomes).toEqual(["published"]);
  expect((await h.as(null).get(`${module.path}/releases/1.0.0/artifact`)).status).toBe(404);
  expect((await h.as(bob).get(`${module.path}/releases/1.0.0/artifact`)).status).toBe(404);
  expect((await h.as(alice).get(`${module.path}/releases/1.0.0/artifact`)).status).toBe(302);
  const imports = [
    {
      id: "voice",
      use: module.exact.ref,
      pin: { release: module.exact.release, semantic_digest: module.exact.semantic_digest },
    },
  ];
  const own = await publish("own-private", "preset", { policy: policy(imports) }, "private");
  expect(own.outcomes).toEqual(["published"]);
  const denied = await publish(
    "stolen",
    "preset",
    { policy: policy(imports) },
    "private",
    bob,
    "other",
  );
  expect(denied.outcomes).toEqual(["failed"]);
  expect(JSON.stringify(denied.row.publishReport)).toContain("publish.dependency_unavailable");
  const leak = await publish("leak", "preset", { policy: policy(imports) });
  expect(leak.outcomes).toEqual(["failed"]);
});

it("fails publication when an author supplied deterministic assembly assertion does not hold", async () => {
  const failed = await publish("bad-assertion", "scenario", {
    assembly_tests: [
      {
        id: "style-test",
        root: "self",
        profile: {
          runtime: { name: "test", version: "1" },
          tokenizer: "estimate",
          context_window: 1024,
          reserve_for_output: 128,
          mode: "narrator",
          capabilities: { system_role: true, multiple_system_messages: true },
        },
        session: {
          bindings: {
            player: { kind: "persona", display_name: "Player" },
            user: { kind: "persona", display_name: "User" },
          },
          history: [],
        },
        assembler: ASSEMBLER,
        tokenizer: { name: "estimate", version: TOKENIZER_VERSIONS.estimate },
        expected: { kind: "success", messages_digest: `sha256:${"0".repeat(64)}` },
      },
    ],
  });
  expect(failed.outcomes).toEqual(["failed"]);
  expect(JSON.stringify(failed.row.publishReport)).toContain("publish.assembly_tests_failed");
  expect(failed.row.artifactDigest).toBeNull();
});

it("preserves policy configuration contributions and rejects an overlapping author edit", async () => {
  const p = await publish("contributed", "preset", { policy: policy() });
  expect(p.outcomes).toEqual(["published"]);
  const initial = (await (await h.as(alice).get(`${p.path}/draft`)).json()) as {
    version: number;
    working: { policy: unknown };
  };
  const proposal = {
    on: "configuration",
    field: "policy",
    op: "set",
    base_digest: digestOf(canonicalizeCreation(initial.working).creation.policy),
    after: { ...policy(), blocks: [{ id: "main", text: "Contributed policy.", position: "main" }] },
  };
  const submit = await h.as(bob).post(`${p.path}/contributions`, {
    title: "Better policy",
    base_revision: p.revision,
    changes: [proposal],
    rights_ack: { inbound_equals_outbound: true },
  });
  expect(submit.status, await submit.clone().text()).toBe(201);
  expect((await h.as(bob).post(`${p.path}/contributions/1/accept`, {})).status).toBe(403);
  const accepted = await h.as(alice).post(`${p.path}/contributions/1/accept`, {});
  expect(accepted.status, await accepted.clone().text()).toBe(200);
  const after = (await (await h.as(alice).get(`${p.path}/draft`)).json()) as {
    version: number;
    working: Record<string, unknown>;
  };
  expect(after.working.policy).toMatchObject({ blocks: [{ text: "Contributed policy." }] });
  const second = await h.as(bob).post(`${p.path}/contributions`, {
    title: "Competing policy",
    base_revision: p.revision,
    changes: [
      {
        ...proposal,
        after: {
          ...policy(),
          blocks: [{ id: "main", text: "Competing policy.", position: "main" }],
        },
      },
    ],
    rights_ack: { inbound_equals_outbound: true },
  });
  expect(second.status, await second.clone().text()).toBe(201);
  const preview = await (await h.as(alice).get(`${p.path}/contributions/2`)).json();
  expect(preview).toMatchObject({
    preview: { mergeable: false, conflicts: ["configuration:policy"] },
  });
  expect((await h.as(alice).post(`${p.path}/contributions/2/accept`, {})).status).toBe(409);
});

it("isolates CCv3 export caches and bytes when a public character selects a private Preset", async () => {
  const character = await publish("export-character", "character", {
    fragments: [
      {
        id: "description",
        kind: "character",
        stable: true,
        content: { type: "text", text: "A courier." },
      },
    ],
  });
  const preset = await publish("export-private", "preset", { policy: policy() }, "private");
  expect(character.outcomes).toEqual(["published"]);
  expect(preset.outcomes).toEqual(["published"]);
  const path = `${character.path}/releases/1.0.0/export/ccv3`;
  const selectedPath = `${path}?preset=${preset.publicId}`;
  expect((await h.as(bob).get(selectedPath)).status).toBe(404);
  expect((await h.as(null).get(selectedPath)).status).toBe(404);
  expect((await h.as(alice).get(selectedPath)).status).toBe(202);
  expect((await h.as(null).get(path)).status).toBe(202);
  const jobs = await h.queue.boss.fetch<ExportJob>(QUEUE_NAMES.exportBuild, { batchSize: 10 });
  expect(jobs).toHaveLength(2);
  for (const job of jobs ?? []) {
    expect(await handleExportJob({ db: t.app.db, cas }, job.data)).toBe("built");
    const [cached] = await t.app.db
      .select()
      .from(buildArtifacts)
      .where(eq(buildArtifacts.cacheKey, job.data.cache_key));
    if (!cached) throw new Error("missing cache");
    const bytes = await cas.getBlob(
      job.data.preset_release_id ? "private" : "public",
      cached.blobDigest,
    );
    const out = JSON.parse(new TextDecoder().decode(bytes)) as {
      card: { data: { system_prompt: string; creator_notes: string } };
    };
    if (job.data.preset_release_id) {
      expect(out.card.data.system_prompt).toBe("Literal {{user}} policy.");
      expect(out.card.data.creator_notes).toContain("CC-BY-4.0");
      await expect(cas.getBlob("public", cached.blobDigest)).rejects.toThrow();
    } else expect(out.card.data.system_prompt).toBe("");
    await h.queue.boss.complete(QUEUE_NAMES.exportBuild, job.id);
  }
  const selected = await h.as(alice).get(selectedPath);
  expect(selected.status).toBe(302);
  expect(selected.headers.get("cache-control")).toContain("private");
  expect((await h.as(null).get(selectedPath)).status).toBe(404);
  for (const part of ["card", "loss"]) {
    expect((await h.as(null).get(`${selectedPath}&part=${part}`)).status).toBe(404);
    expect((await h.as(bob).get(`${selectedPath}&part=${part}`)).status).toBe(404);
    const result = await h.as(alice).get(`${selectedPath}&part=${part}`);
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    const body = await result.json();
    if (part === "card")
      expect(body).toMatchObject({
        spec: "chara_card_v3",
        data: { system_prompt: "Literal {{user}} policy." },
      });
    else expect(body).toMatchObject({ target: "ccv3", other: expect.any(Array) });
  }
});

it("separates export cache keys for public and private releases of identical content", async () => {
  const content = await publish("two-visibilities", "character", {
    fragments: [
      {
        id: "description",
        kind: "character",
        stable: true,
        content: { type: "text", text: "A courier." },
      },
    ],
  });
  const preset = await publish("export-public", "preset", { policy: policy() });
  const second = await h
    .as(alice)
    .post(
      `${content.path}/releases`,
      { revision: content.revision, label: "2.0.0", visibility: "private" },
      { "idempotency-key": "two-visibilities-private" },
    );
  expect(second.status).toBe(202);
  expect(await h.runPublishJobs()).toEqual(["published"]);
  for (const label of ["1.0.0", "2.0.0"])
    expect(
      (
        await h
          .as(alice)
          .get(`${content.path}/releases/${label}/export/ccv3?preset=${preset.publicId}`)
      ).status,
    ).toBe(202);
  const jobs = await h.queue.boss.fetch<ExportJob>(QUEUE_NAMES.exportBuild, { batchSize: 10 });
  expect(jobs).toHaveLength(2);
  expect(new Set(jobs?.map((job) => job.data.cache_key)).size).toBe(2);
  for (const job of jobs ?? []) {
    expect(await handleExportJob({ db: t.app.db, cas }, job.data)).toBe("built");
    await h.queue.boss.complete(QUEUE_NAMES.exportBuild, job.id);
  }
  const privateResult = await h
    .as(alice)
    .get(`${content.path}/releases/2.0.0/export/ccv3?preset=${preset.publicId}`);
  expect(privateResult.status).toBe(302);
  expect(privateResult.headers.get("cache-control")).toContain("private");
  const publicResult = await h
    .as(null)
    .get(`${content.path}/releases/1.0.0/export/ccv3?preset=${preset.publicId}`);
  expect(publicResult.status).toBe(302);
  expect(publicResult.headers.get("location")).toContain("assets.char.pub");
});

it("checks blacklisted policy blocks throughout the dependency closure", async () => {
  const module = await publish("blocked-module", "prompt-module", {
    prompt_module: {
      version: "0-draft",
      blocks: [{ id: "blocked", text: "Blocked policy text.", position: "main" }],
    },
  });
  expect(module.outcomes).toEqual(["published"]);
  const draft = (await (await h.as(alice).get(`${module.path}/draft`)).json()) as {
    working: unknown;
  };
  const block = canonicalizeCreation(draft.working).creation.prompt_module?.blocks[0];
  if (!block) throw new Error("missing policy block");
  await t.app.db
    .insert(blockedDigests)
    .values({ digest: digestOf(block), reason: "test policy restriction" });
  const p = await publish("blocked-import", "preset", {
    policy: policy([
      {
        id: "blocked",
        use: module.exact.ref,
        pin: { release: module.exact.release, semantic_digest: module.exact.semantic_digest },
      },
    ]),
  });
  expect(p.outcomes).toEqual(["failed"]);
  expect(JSON.stringify(p.row.publishReport)).toContain("publish.blocked_content");
});

it("serves a Preset avatar from the artifact while retaining private authorization", async () => {
  const bytes = new TextEncoder().encode("preset avatar bytes");
  const blob = await cas.putBlob(t.app.db, {
    bucket: "private",
    bytes,
    kind: "asset",
    mediaType: "image/webp",
  });
  await t.app.db
    .insert(assetMeta)
    .values({ digest: blob.digest, width: 64, height: 64, mediaType: "image/webp" });
  const p = await publish(
    "avatar-preset",
    "preset",
    {
      assets: [
        {
          slot: "avatar",
          role: "presentation",
          variants: [
            {
              id: "default",
              media_type: "image/webp",
              blob: { digest: blob.digest, size: bytes.length, availability: "mirrored" },
            },
          ],
        },
      ],
    },
    "private",
  );
  expect(p.outcomes).toEqual(["published"]);
  const path = `${p.path}/releases/1.0.0/avatar`;
  expect((await h.as(null).get(path)).status).toBe(404);
  const response = await h.as(alice).get(path);
  expect(response.status).toBe(302);
  const image = await fetch(response.headers.get("location") ?? "");
  expect(image.status).toBe(200);
  expect(new Uint8Array(await image.arrayBuffer())).toEqual(bytes);
});

it("deletes downstream Preset and Scenario artifacts when their module is tombstoned", async () => {
  const module = await publish("removed-module", "prompt-module", {
    prompt_module: {
      version: "0-draft",
      blocks: [{ id: "main", text: "Policy to remove.", position: "main" }],
    },
  });
  const preset = await publish("removed-preset", "preset", {
    policy: policy([
      {
        id: "module",
        use: module.exact.ref,
        pin: { release: module.exact.release, semantic_digest: module.exact.semantic_digest },
      },
    ]),
  });
  const scenario = await publish("removed-scenario", "scenario", {
    assembly: {
      version: "0-draft",
      preset: preset.exact,
      profile: {
        runtime: { name: "test", version: "1" },
        tokenizer: "estimate",
        context_window: 1024,
        reserve_for_output: 128,
        mode: "narrator",
        capabilities: { system_role: true, multiple_system_messages: true },
      },
      assembler: ASSEMBLER,
      tokenizer: { name: "estimate", version: TOKENIZER_VERSIONS.estimate },
    },
  });
  for (const p of [module, preset, scenario]) expect(p.outcomes).toEqual(["published"]);
  const result = await executeTombstone(t.app.db, h.queue, {
    subject: { kind: "release", release_id: module.row.id },
    reason_code: "policy.illegal",
    note: "Remove the supplied policy.",
    actor: { staff_user_id: alice },
    now: h.clock.now(),
    action_id: h.services.ids.uuid(),
    publicAssetBaseUrl: h.services.publicAssetBaseUrl,
  });
  for (const p of [module, preset, scenario]) {
    expect(result.preview.objects.map((o) => o.digest)).toContain(p.row.artifactDigest);
    expect((await h.as(null).get(`${p.path}/releases/1.0.0/artifact`)).status).toBe(410);
  }
  const jobs = await h.queue.boss.fetch<TombstoneCascadeJob>(QUEUE_NAMES.tombstoneCascade, {
    batchSize: 10,
  });
  expect(jobs).toHaveLength(1);
  const cdn = new RecordingPurger();
  for (const job of jobs ?? [])
    await runTombstoneCascade({ db: t.app.db, cas, cdn, now: h.clock.now }, job.data);
  for (const p of [module, preset, scenario]) {
    if (!p.row.artifactDigest) throw new Error("missing artifact");
    await expect(cas.getBlob("public", p.row.artifactDigest)).rejects.toThrow();
    expect(
      cdn.purged.some((url) => url.endsWith(p.row.artifactDigest?.slice(7) ?? "missing")),
    ).toBe(true);
  }
});

it("rejects a dependency snapshot whose recorded digest disagrees with the immutable release", async () => {
  const leaf = await publish("snapshot-leaf", "prompt-module");
  const parent = await publish("snapshot-parent", "prompt-module", {
    prompt_module: {
      version: "0-draft",
      blocks: [],
      imports: [
        {
          id: "leaf",
          use: leaf.exact.ref,
          pin: { release: leaf.exact.release, semantic_digest: leaf.exact.semantic_digest },
        },
      ],
    },
  });
  expect(parent.outcomes).toEqual(["published"]);
  const root = canonicalizeCreation({
    id: "cr_01h455vb4pex5vsknk084sn001",
    ref: "@test-assets/snapshot-root",
    type: "preset",
    display_name: "Snapshot root",
    meta,
    policy: policy([
      {
        id: "parent",
        use: parent.exact.ref,
        pin: { release: parent.exact.release, semantic_digest: parent.exact.semantic_digest },
      },
    ]),
  }).creation;
  const tamperedCas = new Proxy(cas, {
    get(target, key, receiver) {
      if (key !== "getBlob") return Reflect.get(target, key, receiver);
      return async (bucket: "public" | "private", digest: string) => {
        const bytes = await cas.getBlob(bucket, digest);
        if (digest !== parent.row.snapshotDigest) return bytes;
        const snapshot = JSON.parse(new TextDecoder().decode(bytes));
        snapshot.dependencies[0].semantic_digest = `sha256:${"0".repeat(64)}`;
        return new TextEncoder().encode(JSON.stringify(snapshot));
      };
    },
  });
  const closure = await loadClosure(t.app.db, tamperedCas, root, {
    kind: "user",
    user_id: alice,
    banned: false,
  });
  expect(closure.unavailable).toEqual([
    {
      release: leaf.publicId,
      status: "active",
      reason: "snapshot dependency digest differs from its release",
    },
  ]);
});
