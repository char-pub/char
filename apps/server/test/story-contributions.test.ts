/** Immutable base, field-level merge and private review through the actual Registry API. */
import { canonicalizeCreation, compositionDigest } from "@char-pub/core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type ContributionHarness, createContributionHarness } from "./contributions-harness.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

let db: TestDatabase,
  h: ContributionHarness,
  proposer: string,
  sequence = 0;
const scene = { id: "port", title: "Port", description: "The old port." };
const root = {
  type: "scenario",
  cast: [{ key: "visitor", who: { late: "persona" } }],
  display_name: "Port story",
  meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
  fragments: [
    {
      id: "premise",
      kind: "scenario",
      stable: true,
      content: { type: "text", text: "Visitors meet at the port." },
    },
  ],
  story: { version: 1, scenes: [scene], starts: [{ id: "arrival", scene: "port" }] },
};
beforeAll(async () => {
  db = await createTestDatabase();
  h = await createContributionHarness(db, testCas());
  proposer = await h.createUser("story proposer");
});
afterAll(async () => {
  await h?.close();
  await db?.drop();
});
async function work() {
  const w = await h.setupCreation(`story-proposal-${++sequence}`, "port", root);
  const draft = await h.draft(w.owner, w.path);
  return { ...w, base: canonicalizeCreation(draft.working).creation };
}
async function propose(w: Awaited<ReturnType<typeof work>>, changes: unknown[]) {
  return h.asUser(proposer).post(`${w.path}/contributions`, {
    title: "Port proposal",
    changes_version: 1,
    base_revision: w.revision,
    changes,
    rights_ack: { inbound_equals_outbound: true },
  });
}
it("merges different scene fields against the recorded Revision and preserves concurrent owner text", async () => {
  const w = await work();
  const change = {
    on: "story",
    kind: "scene",
    id: "port",
    op: "modify",
    base_digest: compositionDigest(w.base, { on: "story", kind: "scene", id: "port" }),
    after: { ...scene, title: "Proposed harbor" },
  };
  const submitted = await propose(w, [change]);
  expect(submitted.status, await submitted.clone().text()).toBe(201);
  const n = (await submitted.json()).number;
  await h.editDraft(w.owner, w.path, (raw) => {
    const story = raw.story as typeof root.story;
    story.scenes = story.scenes.map((s) => ({ ...s, description: "Private owner description" }));
  });
  const privateRead = await h.asUser(proposer).get(`${w.path}/contributions/${n}`);
  expect((await privateRead.json()).preview).toBeNull();
  const review = await h.asUser(w.owner).get(`${w.path}/contributions/${n}`);
  expect(await review.json()).toMatchObject({
    preview: { mergeable: true, outcomes: [{ key: "story:scene:port", state: "applied" }] },
  });
  const accepted = await h.asUser(w.owner).post(`${w.path}/contributions/${n}/accept`, {});
  expect(accepted.status, await accepted.clone().text()).toBe(200);
  const after = await h.draft(w.owner, w.path);
  expect((after.working.story as typeof root.story).scenes[0]).toMatchObject({
    title: "Proposed harbor",
    description: "Private owner description",
  });
  const source = await h.asUser(proposer).get(`${w.path}/releases/0.1.0/source`);
  expect(await source.json()).toMatchObject({ creation: { story: { scenes: [scene] } } });
});
it("reports the exact conflicting field and leaves the entire draft untouched", async () => {
  const w = await work();
  const submitted = await propose(w, [
    {
      on: "story",
      kind: "scene",
      id: "port",
      op: "modify",
      base_digest: compositionDigest(w.base, { on: "story", kind: "scene", id: "port" }),
      after: { ...scene, title: "Proposed" },
    },
    {
      on: "story",
      kind: "ending",
      id: "safe",
      op: "add",
      after: { id: "safe", title: "Safe", description: "The ship arrived." },
    },
  ]);
  expect(submitted.status, await submitted.clone().text()).toBe(201);
  const n = (await submitted.json()).number;
  await h.editDraft(w.owner, w.path, (raw) => {
    const story = raw.story as typeof root.story;
    story.scenes = story.scenes.map((s) => ({ ...s, title: "Owner title" }));
  });
  const before = await h.draft(w.owner, w.path);
  const review = await h.asUser(w.owner).get(`${w.path}/contributions/${n}`);
  expect(await review.json()).toMatchObject({
    preview: {
      mergeable: false,
      outcomes: expect.arrayContaining([
        expect.objectContaining({
          key: "story:scene:port",
          state: "conflict",
          conflict_fields: ["title"],
        }),
      ]),
    },
  });
  expect((await h.asUser(w.owner).post(`${w.path}/contributions/${n}/accept`, {})).status).toBe(
    409,
  );
  expect(await h.draft(w.owner, w.path)).toEqual(before);
});
it("rejects forged base object digests and invalid dangling references before storing a proposal", async () => {
  const w = await work();
  const forged = await propose(w, [
    {
      on: "story",
      kind: "scene",
      id: "port",
      op: "modify",
      base_digest: `sha256:${"a".repeat(64)}`,
      after: { ...scene, title: "Forged" },
    },
  ]);
  expect(forged.status).toBe(422);
  const dangling = await propose(w, [
    {
      on: "story",
      kind: "scene",
      id: "port",
      op: "modify",
      base_digest: compositionDigest(w.base, { on: "story", kind: "scene", id: "port" }),
      after: { ...scene, beats: ["missing"] },
    },
  ]);
  expect(dangling.status).toBe(422);
  const list = await h.asUser(w.owner).get(`${w.path}/contributions`);
  expect((await list.json()).items).toEqual([]);
});

it("requires an explicit supported format for structured changes", async () => {
  const w = await work();
  const body = {
    title: "New ending",
    base_revision: w.revision,
    rights_ack: { inbound_equals_outbound: true },
    changes: [
      {
        on: "story",
        kind: "ending",
        id: "away",
        op: "add",
        after: { id: "away", title: "Away", description: "The visitor leaves." },
      },
    ],
  };
  const missing = await h.asUser(proposer).post(`${w.path}/contributions`, body);
  expect(missing.status).toBe(422);
  expect((await missing.json()).code).toBe("contribution.unsupported_version");
  expect(
    (await h.asUser(proposer).post(`${w.path}/contributions`, { ...body, changes_version: 2 }))
      .status,
  ).toBe(422);
  expect(
    (await h.asUser(proposer).post(`${w.path}/contributions`, { ...body, changes_version: 1 }))
      .status,
  ).toBe(201);
});
