import { prepareContext } from "@char-pub/assembler";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { register as readModule } from "../src/api/routes/read.js";
import { releaseLocks, releases, reverseEdges } from "../src/db/schema/index.js";
import { readArtifact } from "../src/registry/artifacts.js";
import { loadSnapshot } from "../src/registry/content.js";
import { decodeId } from "../src/registry/ids.js";
import { handlePublish } from "../src/worker/publish.js";
import { type ApiHarness, createHarness } from "./api-harness.js";
import { publishDefaultPolicy } from "./fixtures/default-policy.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

let t: TestDatabase;
let h: ApiHarness;
beforeAll(async () => {
  t = await createTestDatabase();
  h = await createHarness(t, testCas(), { defaultPolicy: false, extraModules: [readModule] });
});
afterAll(async () => {
  await h?.close();
  await t?.drop();
});

it("pins the policy at request time and replays it after configuration changes", async () => {
  const first = await publishDefaultPolicy(h.services, "FIRST_DEFAULT");
  const second = await publishDefaultPolicy(h.services, "SECOND_DEFAULT");
  expect((await h.as(null).get("/v1/default-policy")).status).toBe(503);
  const user = await h.createUser("default-test");
  const me = h.as(user);
  expect((await me.post("/v1/namespaces", { slug: "default-test" })).status).toBe(201);
  expect(
    (
      await me.post("/v1/namespaces/default-test/creations", {
        name: "actor",
        type: "character",
        display_name: "Actor",
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await me.put(
        "/v1/creations/@default-test/actor/draft",
        {
          working: {
            display_name: "Actor",
            fragments: [
              {
                id: "description",
                stable: true,
                kind: "character",
                content: { type: "text", text: "A quiet traveller meets {{user}}." },
              },
            ],
            meta: {
              default_locale: "en",
              rating: "general",
              rights: "original",
              license: "CC-BY-4.0",
            },
          },
        },
        { "if-match": "1" },
      )
    ).status,
  ).toBe(200);
  const revisionResponse = await me.post("/v1/creations/@default-test/actor/revisions", {});
  expect(revisionResponse.status).toBe(201);
  const revision = (await revisionResponse.json()) as { id: string };
  const body = { revision: revision.id, label: "v1", visibility: "private" };
  const headers = { "idempotency-key": "fixed-default-publish" };
  const path = "/v1/creations/@default-test/actor/releases";
  const missing = await me.post(path, body, headers);
  expect(missing.status).toBe(503);
  expect(await missing.json()).toMatchObject({ code: "publish.default_policy_unavailable" });
  h.services.defaultPolicy = first;
  const advertised = await h.as(null).get("/v1/default-policy");
  expect(advertised.headers.get("cache-control")).toBe("no-store");
  expect(await advertised.json()).toEqual(first);
  const pending = await me.post(path, body, headers);
  expect(pending.status).toBe(202);
  const response = (await pending.json()) as { release: string };
  const id = decodeId("release", response.release);
  if (!id) throw new Error("Invalid release ID");
  let [row] = await t.app.db.select().from(releases).where(eq(releases.id, id));
  expect(row?.defaultPolicy).toEqual(first);
  h.services.defaultPolicy = second;
  expect(await (await h.as(null).get("/v1/default-policy")).json()).toEqual(second);
  expect(await h.runPublishJobs()).toEqual(["published"]);
  [row] = await t.app.db.select().from(releases).where(eq(releases.id, id));
  if (!row?.snapshotDigest) throw new Error("Missing completed release");
  const artifact = await readArtifact(h.services.cas, row, h.services.publicAssetBaseUrl);
  expect(artifact).toMatchObject({ kind: "content", default_policy: { release: first.release } });
  const snapshot = await loadSnapshot(h.services.cas, "private", row.snapshotDigest);
  expect(snapshot.default_policy).toEqual(first);
  expect(snapshot.dependencies.find((dep) => dep.release === first.release)?.visibility).toBe(
    "public",
  );
  const rebuilt = await readArtifact(
    h.services.cas,
    { ...row, artifactDigest: null },
    h.services.publicAssetBaseUrl,
  );
  expect(rebuilt).toEqual(artifact);
  await expect(
    readArtifact(
      h.services.cas,
      { ...row, artifactDigest: null, defaultPolicy: second },
      h.services.publicAssetBaseUrl,
    ),
  ).rejects.toMatchObject({ code: "registry.default_policy_mismatch" });
  const locks = await t.app.db.select().from(releaseLocks).where(eq(releaseLocks.releaseId, id));
  expect(locks.map((lock) => lock.depReleaseId)).toContain(decodeId("release", first.release));
  const reverse = await t.app.db
    .select()
    .from(reverseEdges)
    .where(eq(reverseEdges.dependentReleaseId, id));
  expect(reverse).toEqual(
    expect.arrayContaining([expect.objectContaining({ rel: "default_policy" })]),
  );
  const output = prepareContext({
    artifact,
    turn: { bindings: { user: { kind: "persona", display_name: "Player" } } },
    profile: {
      runtime: { name: "test", version: "1" },
      mode: "narrator",
      tokenizer: "estimate",
      context_window: 8192,
      reserve_for_output: 1024,
      capabilities: { system_role: true, multiple_system_messages: true },
    },
  });
  expect(output.messages[0]?.content).toBe("FIRST_DEFAULT");
  delete h.services.defaultPolicy;
  expect((await me.post(path, body, headers)).status).toBe(200);
  expect((await me.post(path, body, { "idempotency-key": "same-label-new-key" })).status).toBe(200);
  expect(await handlePublish(h.publishDeps, { release_id: id })).toBe("skipped");
  h.services.defaultPolicy = second;
  expect(
    (await me.post(path, { ...body, label: "v2" }, { "idempotency-key": "new-label-default" }))
      .status,
  ).toBe(202);
  expect(await h.runPublishJobs()).toEqual(["published"]);
  const [newRow] = await t.app.db.select().from(releases).where(eq(releases.label, "v2"));
  expect(newRow?.defaultPolicy).toEqual(second);
  h.services.defaultPolicy = first;
  expect(
    (await me.post(path, { ...body, label: "v3" }, { "idempotency-key": "removed-fixed-default" }))
      .status,
  ).toBe(202);
  const firstId = decodeId("release", first.release);
  if (!firstId) throw new Error("Invalid policy ID");
  await t.app.db
    .update(releases)
    .set({ status: "tombstoned", statusReason: "test.removed" })
    .where(eq(releases.id, firstId));
  h.services.defaultPolicy = second;
  expect(await h.runPublishJobs()).toEqual(["failed"]);
  const [failed] = await t.app.db.select().from(releases).where(eq(releases.label, "v3"));
  expect(failed?.defaultPolicy).toEqual(first);
});
