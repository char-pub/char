import { DraftSchema } from "@char-pub/contracts";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { register as collaboration } from "../src/api/routes/collaborators.js";
import { register as read } from "../src/api/routes/read.js";
import {
  creationCollaborators,
  creationContributors,
  creationDrafts,
} from "../src/db/schema/index.js";
import { lockDraftBuildCreation } from "../src/registry/draft-builds.js";
import { decodeId, encodeId } from "../src/registry/ids.js";
import { type ApiHarness, createHarness } from "./api-harness.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

let db: TestDatabase, h: ApiHarness, owner: string, editor: string;
let seq = 0;
beforeAll(async () => {
  db = await createTestDatabase();
  h = await createHarness(db, testCas(), { extraModules: [collaboration, read] });
  owner = await h.createUser("Owner private login");
  editor = await h.createUser("Writer private login");
  await h.as(owner).post("/v1/namespaces", { slug: "share-owner" });
  await h.as(editor).post("/v1/namespaces", { slug: "share-writer" });
});
afterAll(async () => {
  await h?.close();
  await db?.drop();
});
async function work() {
  const name = `work-${++seq}`;
  const created = await h.as(owner).post("/v1/namespaces/share-owner/creations", {
    name,
    type: "world",
    display_name: "Shared world",
  });
  expect(created.status).toBe(201);
  const id = decodeId("creation", (await created.json()).id);
  if (!id) throw new Error("id");
  const path = `/v1/creations/@share-owner/${name}`;
  let draft = DraftSchema.parse(await (await h.as(owner).get(`${path}/draft`)).json());
  const working = {
    ...(draft.working as Record<string, unknown>),
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
    fragments: [
      {
        id: "world",
        kind: "world",
        stable: true,
        content: { type: "text", text: "The first world." },
      },
    ],
  };
  expect(
    (await h.as(owner).put(`${path}/draft`, { working }, { "if-match": String(draft.version) }))
      .status,
  ).toBe(200);
  draft = DraftSchema.parse(await (await h.as(owner).get(`${path}/draft`)).json());
  return { id, path, draft };
}
async function invite(path: string) {
  const response = await h.as(owner).post(`${path}/collaborators`, { namespace: "share-writer" });
  expect(response.status, await response.clone().text()).toBe(201);
}
async function accept(path: string, license = "CC0-1.0") {
  return h.as(editor).post(`${path}/collaborators/accept`, { license, agree: true });
}
it("requires explicit license agreement and grants only the named work, with owner-only management and publication", async () => {
  const a = await work(),
    b = await work();
  await invite(a.path);
  expect((await h.as(editor).get(`${a.path}/draft`)).status).toBe(404);
  const invitations = await h.as(editor).get("/v1/me/collaborations");
  expect(invitations.status).toBe(200);
  expect((await invitations.json()).items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ ref: a.path.slice(14), status: "pending", license: "CC0-1.0" }),
    ]),
  );
  expect((await accept(a.path, "CC-BY-4.0")).status).toBe(409);
  expect((await accept(a.path)).status).toBe(200);
  expect((await h.as(editor).get(`${a.path}/draft`)).status).toBe(200);
  expect((await h.as(editor).get(`${b.path}/draft`)).status).toBe(404);
  expect(
    (await h.as(editor).post(`${a.path}/collaborators`, { namespace: "share-owner" })).status,
  ).toBe(403);
  const revision = await h.as(editor).post(`${a.path}/revisions`, {});
  expect([200, 201]).toContain(revision.status);
  expect(
    (
      await h
        .as(editor)
        .post(
          `${a.path}/releases`,
          { revision: (await revision.json()).id, label: "v1", visibility: "public" },
          { "idempotency-key": "collaborator-publish-key" },
        )
    ).status,
  ).toBe(403);
  const list = await h.as(owner).get(`${a.path}/collaborators`);
  const members = await list.json();
  expect(members.items[0]).toMatchObject({ name: "@share-writer", status: "active" });
  expect(JSON.stringify(members)).not.toContain("Writer private login");
  expect(
    (await h.as(owner).delete(`${a.path}/collaborators/${members.items[0].user_id}`)).status,
  ).toBe(204);
  expect((await h.as(editor).get(`${a.path}/draft`)).status).toBe(404);
  expect((await accept(a.path)).status).toBe(404);
});
it("protects owner fields including asset overrides, credits actual edits, and requires new consent after license changes", async () => {
  const a = await work();
  await invite(a.path);
  expect((await accept(a.path)).status).toBe(200);
  const current = DraftSchema.parse(await (await h.as(editor).get(`${a.path}/draft`)).json());
  const working = current.working as { meta: Record<string, unknown> };
  for (const patch of [
    { license: "CC-BY-4.0" },
    { rating: "mature" },
    { content_warnings: ["violence"] },
  ]) {
    const denied = await h
      .as(editor)
      .put(
        `${a.path}/draft`,
        { working: { ...working, meta: { ...working.meta, ...patch } } },
        { "if-match": String(current.version) },
      );
    expect(denied.status, await denied.clone().text()).toBe(403);
    expect((await denied.json()).code).toBe("collaboration.owner_fields");
  }
  const protectedAsset = await h.as(editor).put(
    `${a.path}/draft`,
    {
      working: {
        ...working,
        assets: [
          {
            slot: "cover",
            role: "presentation",
            variants: [
              {
                id: "default",
                media_type: "image/png",
                license: "CC-BY-4.0",
                blob: { digest: `sha256:${"a".repeat(64)}`, size: 4, availability: "mirrored" },
              },
            ],
          },
        ],
      },
    },
    { "if-match": String(current.version) },
  );
  expect(protectedAsset.status, await protectedAsset.clone().text()).toBe(403);
  expect((await protectedAsset.json()).code).toBe("collaboration.owner_fields");
  const saved = await h
    .as(editor)
    .put(
      `${a.path}/draft`,
      { working: { ...working, summary: "The writer added a summary." } },
      { "if-match": String(current.version) },
    );
  expect(saved.status).toBe(200);
  expect(
    await db.app.db
      .select()
      .from(creationContributors)
      .where(eq(creationContributors.creationId, a.id)),
  ).toHaveLength(1);
  const latest = DraftSchema.parse(await (await h.as(owner).get(`${a.path}/draft`)).json());
  const ownerDraft = latest.working as typeof working;
  expect(
    (
      await h
        .as(owner)
        .put(
          `${a.path}/draft`,
          { working: { ...ownerDraft, meta: { ...ownerDraft.meta, license: "CC-BY-4.0" } } },
          { "if-match": String(latest.version) },
        )
    ).status,
  ).toBe(200);
  const [membership] = await db.app.db
    .select()
    .from(creationCollaborators)
    .where(eq(creationCollaborators.creationId, a.id));
  expect(membership?.acceptedAt).toBeNull();
  expect(membership?.license).toBe("CC-BY-4.0");
  expect((await h.as(editor).get(`${a.path}/draft`)).status).toBe(404);
  expect((await accept(a.path)).status).toBe(409);
  expect((await accept(a.path, "CC-BY-4.0")).status).toBe(200);
});

function gate() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
it.each(["save", "accept"] as const)(
  "does not resurrect revoked access when %s waits behind the work lock",
  async (action) => {
    const a = await work();
    await invite(a.path);
    expect((await accept(a.path)).status).toBe(200);
    const entered = gate(),
      release = gate();
    const revoking = db.app.db.transaction(async (tx) => {
      await lockDraftBuildCreation(tx, a.id);
      await tx.delete(creationCollaborators).where(eq(creationCollaborators.creationId, a.id));
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const request =
      action === "accept"
        ? accept(a.path)
        : h
            .as(editor)
            .put(
              `${a.path}/draft`,
              { working: { ...(a.draft.working as object), summary: "Must not be saved" } },
              { "if-match": String(a.draft.version) },
            );
    try {
      await expect
        .poll(
          async () => {
            const result = await db.app.db.execute<{ blocked: number }>(
              sql`select count(*)::int as blocked from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0 and query like '%creations%'`,
            );
            return result.rows[0]?.blocked ?? 0;
          },
          { timeout: 5000, interval: 20 },
        )
        .toBeGreaterThan(0);
      release.resolve();
      await revoking;
      expect((await request).status).toBe(404);
      const after = DraftSchema.parse(await (await h.as(owner).get(`${a.path}/draft`)).json());
      expect(after.version).toBe(a.draft.version);
      expect(
        await db.app.db
          .select()
          .from(creationCollaborators)
          .where(eq(creationCollaborators.creationId, a.id)),
      ).toEqual([]);
    } finally {
      release.resolve();
      await Promise.allSettled([revoking, request]);
    }
  },
);

it("shows stale license consent as pending and refreshes it on owner reinvitation without resetting matching consent", async () => {
  const a = await work();
  await invite(a.path);
  expect((await accept(a.path)).status).toBe(200);
  await invite(a.path);
  expect((await h.as(editor).get(`${a.path}/draft`)).status).toBe(200);
  await db.app.db
    .update(creationDrafts)
    .set({
      working: {
        ...(a.draft.working as object),
        meta: { default_locale: "en", rights: "original", rating: "general", license: "CC-BY-4.0" },
      },
    })
    .where(eq(creationDrafts.creationId, a.id));
  const listing = await (await h.as(owner).get(`${a.path}/collaborators`)).json();
  expect(listing.items[0].status).toBe("pending");
  const invitations = await (await h.as(editor).get("/v1/me/collaborations")).json();
  expect(
    invitations.items.find((item: { ref: string }) => item.ref === a.path.slice(14)).status,
  ).toBe("pending");
  expect((await accept(a.path, "CC-BY-4.0")).status).toBe(409);
  await invite(a.path);
  expect((await accept(a.path, "CC-BY-4.0")).status).toBe(200);
  expect((await h.as(editor).get(`${a.path}/draft`)).status).toBe(200);
});

it("lets an accepted editor declare agent-assisted work without granting any other provenance authority", async () => {
  const a = await work();
  await invite(a.path);
  expect((await accept(a.path)).status).toBe(200);
  const before = DraftSchema.parse(await (await h.as(editor).get(`${a.path}/draft`)).json());
  const original = before.working as Record<string, unknown>;
  const provenance = (original.provenance ?? {}) as Record<string, unknown>;
  // This is the ordinary Working payload produced by local reviewed Apply, not a privileged write API.
  const assisted = {
    ...original,
    description: "An agent-drafted summary reviewed by the editor.",
    provenance: { ...provenance, authored_by_agent: true },
  };
  for (const extra of [
    { client_id: "forged-client" },
    { contributors: [{ author: encodeId("user", editor) }] },
  ]) {
    const denied = await h.as(editor).put(
      `${a.path}/draft`,
      {
        working: { ...assisted, provenance: { ...assisted.provenance, ...extra } },
      },
      { "if-match": String(before.version) },
    );
    expect(denied.status, await denied.clone().text()).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "collaboration.owner_fields" });
    expect(DraftSchema.parse(await (await h.as(editor).get(`${a.path}/draft`)).json())).toEqual(
      before,
    );
  }
  const saved = await h
    .as(editor)
    .put(`${a.path}/draft`, { working: assisted }, { "if-match": String(before.version) });
  expect(saved.status, await saved.clone().text()).toBe(200);
  const after = DraftSchema.parse(await (await h.as(editor).get(`${a.path}/draft`)).json());
  expect(after.version).toBe(before.version + 1);
  expect(after.working).toMatchObject({
    description: assisted.description,
    provenance: { authored_by_agent: true },
  });
  for (const extra of [
    { client_id: "forged-client" },
    { contributors: [{ author: encodeId("user", editor) }] },
    { derived_from: [{ release: "rel_01h455vb4pex5vsknk084sn001", relation: "remix" }] },
  ]) {
    const denied = await h.as(editor).put(
      `${a.path}/draft`,
      {
        working: { ...assisted, provenance: { ...assisted.provenance, ...extra } },
      },
      { "if-match": String(after.version) },
    );
    expect(denied.status, await denied.clone().text()).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "collaboration.owner_fields" });
    expect(DraftSchema.parse(await (await h.as(editor).get(`${a.path}/draft`)).json())).toEqual(
      after,
    );
  }
  for (const actor of [editor, owner]) {
    for (const replacement of [provenance, { ...provenance, authored_by_agent: false }]) {
      const denied = await h
        .as(actor)
        .put(
          `${a.path}/draft`,
          { working: { ...assisted, provenance: replacement } },
          { "if-match": String(after.version) },
        );
      expect(denied.status, await denied.clone().text()).toBe(422);
      expect(await denied.json()).toMatchObject({ code: "check.agent_history_required" });
      expect(DraftSchema.parse(await (await h.as(editor).get(`${a.path}/draft`)).json())).toEqual(
        after,
      );
    }
  }
  // Undo of the assisted field may keep the conservative history marker and remains an ordinary edit.
  const undo = await h
    .as(editor)
    .put(
      `${a.path}/draft`,
      { working: { ...original, provenance: assisted.provenance } },
      { "if-match": String(after.version) },
    );
  expect(undo.status, await undo.clone().text()).toBe(200);
});
