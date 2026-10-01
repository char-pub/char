/** Agent attribution survives human acceptance and ordinary editing, without labeling human work. */
import { canonicalizeCreation, compositionDigest } from "@char-pub/core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { creationCollaborators } from "../src/db/schema/index.js";
import { decodeId } from "../src/registry/ids.js";
import { type ContributionHarness, createContributionHarness } from "./contributions-harness.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

let db: TestDatabase,
  h: ContributionHarness,
  proposer: string,
  collaborator: string,
  seq = 0;
const scene = { id: "port", title: "Port", description: "A quiet harbor." };
const content = {
  type: "scenario",
  display_name: "Harbor",
  cast: [{ key: "player", who: { late: "persona" } }],
  meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
  fragments: [
    {
      id: "premise",
      kind: "scenario",
      stable: true,
      content: { type: "text", text: "A visitor arrives." },
    },
  ],
  story: { version: 1, scenes: [scene] },
};
beforeAll(async () => {
  db = await createTestDatabase();
  h = await createContributionHarness(db, testCas());
  proposer = await h.createUser("Agent-assisted writer");
  collaborator = await h.createUser("Human reviewer");
  expect(
    (await h.asUser(collaborator).post("/v1/namespaces", { slug: "agent-history-reviewer" }))
      .status,
  ).toBe(201);
});
afterAll(async () => {
  await h?.close();
  await db?.drop();
});
async function work(agent = false) {
  return h.setupCreation(`agent-history-${++seq}`, "harbor", {
    ...content,
    ...(agent ? { provenance: { authored_by_agent: true } } : {}),
  });
}
async function proposal(w: Awaited<ReturnType<typeof work>>, agent: boolean) {
  const before = canonicalizeCreation((await h.draft(w.owner, w.path)).working).creation;
  const submitted = await h.asUser(proposer).post(`${w.path}/contributions`, {
    title: "Harbor description",
    changes_version: 1,
    base_revision: w.revision,
    agent,
    rights_ack: { inbound_equals_outbound: true },
    changes: [
      {
        on: "story",
        kind: "scene",
        id: "port",
        op: "modify",
        base_digest: compositionDigest(before, { on: "story", kind: "scene", id: "port" }),
        after: { ...scene, description: "The traveler hears a distant bell." },
      },
    ],
  });
  expect(submitted.status, await submitted.clone().text()).toBe(201);
  return (await submitted.json()).number as number;
}
it.each(["owner", "collaborator"] as const)(
  "records accepted agent content when the %s reviews it",
  async (reviewer) => {
    const w = await work();
    const number = await proposal(w, true);
    if (reviewer === "collaborator") {
      const id = decodeId("creation", String((await h.draft(w.owner, w.path)).working.id));
      if (!id) throw new Error("Creation ID missing");
      await db.app.db.insert(creationCollaborators).values({
        creationId: id,
        userId: collaborator,
        invitedBy: w.owner,
        license: "CC-BY-4.0",
        acceptedAt: h.clock.now(),
      });
    }
    const accepted = await h
      .asUser(reviewer === "owner" ? w.owner : collaborator)
      .post(`${w.path}/contributions/${number}/accept`, {});
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    const draft = canonicalizeCreation((await h.draft(w.owner, w.path)).working).creation;
    expect(draft.provenance.authored_by_agent).toBe(true);
    expect(draft.provenance.contributors).toHaveLength(1);
    expect(draft.provenance.client_id).toBeUndefined();
    expect(draft.provenance.contributors?.[0]?.client_id).toBeUndefined();
    await h.editDraft(w.owner, w.path, (raw) => {
      raw.display_name = "Reviewed by the author";
    });
    const saved = await h.draft(w.owner, w.path);
    expect(canonicalizeCreation(saved.working).creation.provenance.authored_by_agent).toBe(true);
    const revision = await h.asUser(w.owner).post(`${w.path}/revisions`, {});
    expect([200, 201]).toContain(revision.status);
    const published = await h
      .asUser(w.owner)
      .post(
        `${w.path}/releases`,
        { revision: (await revision.json()).id, label: "0.2.0", visibility: "public" },
        { "idempotency-key": `agent-history-${reviewer}` },
      );
    expect(published.status, await published.clone().text()).toBe(202);
    await h.runPublishJobs();
    const source = await h.asUser(w.owner).get(`${w.path}/releases/0.2.0/source`);
    expect(source.status, await source.clone().text()).toBe(200);
    expect(await source.json()).toMatchObject({
      creation: { provenance: { authored_by_agent: true } },
    });
  },
);
it.each([false, true])(
  "preserves earlier agent attribution %s when accepting a human contribution",
  async (previous) => {
    const w = await work(previous);
    const number = await proposal(w, false);
    expect(
      (await h.asUser(w.owner).post(`${w.path}/contributions/${number}/accept`, {})).status,
    ).toBe(200);
    const agent = canonicalizeCreation((await h.draft(w.owner, w.path)).working).creation.provenance
      .authored_by_agent;
    expect(agent === true).toBe(previous);
  },
);
it("rejects deleting or resetting earlier agent attribution without changing the saved draft", async () => {
  const w = await work(true);
  const before = await h.draft(w.owner, w.path);
  for (const provenance of [{}, { authored_by_agent: false }]) {
    const response = await h
      .asUser(w.owner)
      .put(
        `${w.path}/draft`,
        { working: { ...before.working, display_name: "Changed", provenance } },
        { "if-match": String(before.version) },
      );
    expect(response.status, await response.clone().text()).toBe(422);
    expect(await response.json()).toMatchObject({ code: "check.agent_history_required" });
    expect(await h.draft(w.owner, w.path)).toEqual(before);
  }
});
