/** Work-scoped review authority must not become a path around protected owner fields. */
import { canonicalFragment, digestOf } from "@char-pub/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  contributionChanges,
  contributions,
  creationCollaborators,
} from "../src/db/schema/index.js";
import { decodeId } from "../src/registry/ids.js";
import {
  type ContributionHarness,
  createContributionHarness,
  userTypeId,
} from "./contributions-harness.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

let db: TestDatabase;
let h: ContributionHarness;
let reviewer: string;
let submitter: string;
let sequence = 0;
const fragment = (text: string) => ({
  id: "description",
  stable: true,
  kind: "character" as const,
  content: { type: "text" as const, text },
});
const working = {
  display_name: "Courier",
  fragments: [fragment("A careful courier.")],
  meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
};
const ordinary = {
  on: "fragment",
  op: "modify",
  id: "description",
  base_digest: canonicalFragment(fragment("A careful courier.")).digest,
  after: fragment("A courier who remembers every delivery."),
};
beforeAll(async () => {
  db = await createTestDatabase();
  h = await createContributionHarness(db, testCas());
  reviewer = await h.createUser("Reviewer");
  submitter = await h.createUser("Proposer");
});
afterAll(async () => {
  await h?.close();
  await db?.drop();
});
async function work() {
  const ns = `proposal-team-${++sequence}`;
  const result = await h.setupCreation(ns, "courier", working);
  const draft = await h.draft(result.owner, result.path);
  const id = decodeId("creation", String(draft.working.id));
  if (!id) throw new Error("creation");
  return { ...result, id, ns };
}
type Work = Awaited<ReturnType<typeof work>>;
async function consent(w: Work, accepted = true, license = "CC-BY-4.0") {
  await db.app.db.insert(creationCollaborators).values({
    creationId: w.id,
    userId: reviewer,
    invitedBy: w.owner,
    license,
    acceptedAt: accepted ? h.clock.now() : null,
  });
}
async function propose(w: Work, change: unknown = ordinary) {
  const response = await h.asUser(submitter).post(`${w.path}/contributions`, {
    title: "Review this change",
    base_revision: w.revision,
    changes: [change],
    rights_ack: { inbound_equals_outbound: true },
  });
  expect(response.status, await response.clone().text()).toBe(201);
  const result = (await response.json()) as {
    id: string;
    number: number;
    sensitive_keys: string[];
  };
  const id = decodeId("contribution", result.id);
  if (!id) throw new Error("contribution id");
  return { ...result, id, path: `${w.path}/contributions/${result.number}` };
}
async function snapshot(w: Work, proposalId: string) {
  const [proposal] = await db.app.db
    .select()
    .from(contributions)
    .where(eq(contributions.id, proposalId));
  const changes = await db.app.db
    .select()
    .from(contributionChanges)
    .where(eq(contributionChanges.contributionId, proposalId));
  return { draft: await h.draft(w.owner, w.path), proposal, changes };
}

it("lets an accepted collaborator review and accept ordinary content while retaining only the real submitter's contribution credit", async () => {
  const w = await work();
  await consent(w);
  const proposal = await propose(w);
  const detail = await h.asUser(reviewer).get(proposal.path);
  expect(detail.status).toBe(200);
  expect(await detail.json()).toMatchObject({ preview: { mergeable: true } });
  const list = await h.asUser(reviewer).get(`${w.path}/contributions`);
  expect(list.status).toBe(200);
  expect(await list.json()).toMatchObject({ items: [{ number: proposal.number }] });
  const before = await h.draft(w.owner, w.path);
  const accepted = await h.asUser(reviewer).post(`${proposal.path}/accept`, {});
  expect(accepted.status, await accepted.clone().text()).toBe(200);
  const after = await h.draft(w.owner, w.path);
  expect(after.version).toBe(before.version + 1);
  expect(after.working.fragments).toEqual([
    expect.objectContaining(fragment("A courier who remembers every delivery.")),
  ]);
  expect(after.working.provenance).toMatchObject({
    contributors: [{ author: userTypeId(submitter) }],
  });
  const [row] = await db.app.db
    .select()
    .from(contributions)
    .where(eq(contributions.id, proposal.id));
  expect(row).toMatchObject({ status: "accepted", decidedBy: reviewer });
  expect(row?.resultRevisionId).toBeTruthy();
  const repeated = await h.asUser(reviewer).post(`${proposal.path}/accept`, {});
  expect(repeated.status).toBe(403);
  expect(await h.draft(w.owner, w.path)).toEqual(after);
});

it("allows rejection with a reason without changing the draft", async () => {
  const w = await work();
  await consent(w);
  const proposal = await propose(w);
  const before = await h.draft(w.owner, w.path);
  const rejected = await h.asUser(reviewer).post(`${proposal.path}/reject`, {
    reason: "The existing characterization fits this work better.",
  });
  expect(rejected.status, await rejected.clone().text()).toBe(200);
  expect(await h.draft(w.owner, w.path)).toEqual(before);
  const [row] = await db.app.db
    .select()
    .from(contributions)
    .where(eq(contributions.id, proposal.id));
  expect(row).toMatchObject({
    status: "rejected",
    decidedBy: reviewer,
    decisionReason: "The existing characterization fits this work better.",
  });
});

it.each(["pending", "revoked", "stale-license"])(
  "does not allow %s collaboration to read, accept or reject another person's proposal",
  async (state) => {
    const w = await work();
    await consent(w, state !== "pending", state === "stale-license" ? "CC0-1.0" : "CC-BY-4.0");
    if (state === "revoked")
      await db.app.db
        .delete(creationCollaborators)
        .where(eq(creationCollaborators.creationId, w.id));
    const proposal = await propose(w);
    const before = await snapshot(w, proposal.id);
    expect((await h.asUser(reviewer).get(proposal.path)).status).toBe(404);
    expect((await h.asUser(reviewer).post(`${proposal.path}/accept`, {})).status).toBe(404);
    expect(
      (
        await h.asUser(reviewer).post(`${proposal.path}/reject`, {
          reason: "This role should have no review permission.",
        })
      ).status,
    ).toBe(404);
    expect(await snapshot(w, proposal.id)).toEqual(before);
  },
);

it("does not inherit review authority for a sibling work in the same namespace", async () => {
  const granted = await work();
  await consent(granted);
  const created = await h.asUser(granted.owner).post(`/v1/namespaces/${granted.ns}/creations`, {
    name: "sibling",
    type: "character",
    display_name: "Sibling",
  });
  expect(created.status).toBe(201);
  const id = decodeId("creation", ((await created.json()) as { id: string }).id);
  if (!id) throw new Error("id");
  const path = `/v1/creations/@${granted.ns}/sibling`;
  const draft = await h.draft(granted.owner, path);
  expect(
    (
      await h
        .asUser(granted.owner)
        .put(`${path}/draft`, { working }, { "if-match": String(draft.version) })
    ).status,
  ).toBe(200);
  const revision = (
    (await (await h.asUser(granted.owner).post(`${path}/revisions`, {})).json()) as { id: string }
  ).id;
  const pub = await h
    .asUser(granted.owner)
    .post(
      `${path}/releases`,
      { revision, label: "1", visibility: "public" },
      { "idempotency-key": "sibling-review-publication" },
    );
  expect(pub.status).toBe(202);
  expect(await h.runPublishJobs()).toEqual(["published"]);
  const sibling = { ...granted, id, path, revision };
  const proposal = await propose(sibling);
  const before = await snapshot(sibling, proposal.id);
  expect((await h.asUser(reviewer).get(proposal.path)).status).toBe(404);
  expect((await h.asUser(reviewer).post(`${proposal.path}/accept`, {})).status).toBe(404);
  expect(
    (
      await h
        .asUser(reviewer)
        .post(`${proposal.path}/reject`, { reason: "Cross-work review must not be allowed." })
    ).status,
  ).toBe(404);
  expect(await snapshot(sibling, proposal.id)).toEqual(before);
});

const assetChange = (override: Record<string, string>) => ({
  on: "asset",
  op: "add",
  slot: "portrait",
  after: {
    slot: "portrait",
    role: "presentation",
    variants: [
      {
        id: "default",
        media_type: "image/png",
        blob: {
          digest: `sha256:${"a".repeat(64)}`,
          size: 1,
          availability: "linked",
          locator: { provider: "http", url: "https://example.test/portrait.png" },
        },
        ...override,
      },
    ],
  },
});
const protectedChanges = [
  {
    name: "license",
    change: {
      on: "metadata",
      field: "meta.license",
      op: "set",
      base_digest: digestOf("CC-BY-4.0"),
      after: "CC-BY-SA-4.0",
      sensitive: false,
    },
  },
  {
    name: "rating",
    change: {
      on: "metadata",
      field: "meta.rating",
      op: "set",
      base_digest: digestOf("general"),
      after: "teen",
      sensitive: false,
    },
  },
  {
    name: "rights",
    change: {
      on: "metadata",
      field: "meta.rights",
      op: "set",
      base_digest: digestOf("original"),
      after: "licensed",
      sensitive: false,
    },
  },
  { name: "asset license override", change: assetChange({ license: "CC0-1.0" }) },
  { name: "asset rating override", change: assetChange({ rating: "teen" }) },
];
it.each(protectedChanges)(
  "rejects $name acceptance with 403 even after every sensitive key is confirmed, preserving all records",
  async ({ change }) => {
    const w = await work();
    await consent(w);
    const proposal = await propose(w, change);
    const before = await snapshot(w, proposal.id);
    const response = await h
      .asUser(reviewer)
      .post(`${proposal.path}/accept`, { confirm_sensitive: proposal.sensitive_keys });
    expect(response.status, await response.clone().text()).toBe(403);
    expect(await response.json()).toMatchObject({ code: "collaboration.owner_fields" });
    expect(await snapshot(w, proposal.id)).toEqual(before);
  },
);

it.each(["authors", "provenance"])(
  "rejects %s at the Contribution schema boundary rather than inventing a legal proposal to accept",
  async (field) => {
    const w = await work();
    await consent(w);
    const before = await h.draft(w.owner, w.path);
    const response = await h.asUser(submitter).post(`${w.path}/contributions`, {
      title: "Forged attribution",
      base_revision: w.revision,
      changes: [
        {
          on: "metadata",
          op: "set",
          field,
          after:
            field === "authors"
              ? [{ name: "Fake owner", user: userTypeId(submitter) }]
              : { contributors: [{ author: userTypeId(submitter) }] },
          sensitive: false,
        },
      ],
      rights_ack: { inbound_equals_outbound: true },
    });
    expect(response.status, await response.clone().text()).toBe(422);
    expect(await response.json()).toMatchObject({ code: "contribution.invalid_change" });
    expect(await h.draft(w.owner, w.path)).toEqual(before);
    expect(
      await db.app.db.select().from(contributions).where(eq(contributions.targetCreationId, w.id)),
    ).toEqual([]);
  },
);

it("requires read scope for private proposal lists on public works, and write scope for decisions", async () => {
  const w = await work();
  await consent(w);
  const proposal = await propose(w);
  const noRead = await h.token(reviewer, { scopes: ["creations:write", "releases:publish"] });
  const list = await noRead.get(`${w.path}/contributions`);
  expect(list.status).toBe(403);
  expect(await list.json()).toMatchObject({ code: "token.insufficient_scope" });
  const detail = await noRead.get(proposal.path);
  expect(detail.status).toBe(403);
  const readOnly = await h.token(reviewer, { scopes: ["creations:read"] });
  expect((await readOnly.get(`${w.path}/contributions`)).status).toBe(200);
  expect((await readOnly.get(proposal.path)).status).toBe(200);
  const before = await snapshot(w, proposal.id);
  expect((await readOnly.post(`${proposal.path}/accept`, {})).status).toBe(403);
  expect(
    (await readOnly.post(`${proposal.path}/reject`, { reason: "A read-only token cannot decide." }))
      .status,
  ).toBe(403);
  expect(await snapshot(w, proposal.id)).toEqual(before);
});
