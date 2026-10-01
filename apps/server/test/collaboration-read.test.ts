/** Actual DB grants stay attached to one work and private reads intersect token scopes. */
import { DraftSchema } from "@char-pub/contracts";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { register as readRoutes } from "../src/api/routes/read.js";
import { generateToken, hashToken } from "../src/auth/tokens.js";
import {
  apiTokens,
  authUser,
  creationCollaborators,
  creationDrafts,
  namespaceMembers,
  namespaces,
} from "../src/db/schema/index.js";
import { authorizedRelease } from "../src/registry/artifacts.js";
import { loadContentRegistryState } from "../src/registry/closure.js";
import { collaborationAccess } from "../src/registry/collaboration-access.js";
import { decodeId, encodeId } from "../src/registry/ids.js";
import { type ApiHarness, createHarness } from "./api-harness.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

let db: TestDatabase;
let h: ApiHarness;
let owner: string;
let collaborator: string;
let sequence = 0;
const principal = () => ({ kind: "user" as const, user_id: collaborator, banned: false });
beforeAll(async () => {
  db = await createTestDatabase();
  h = await createHarness(db, testCas(), { extraModules: [readRoutes] });
  owner = await h.createUser("Owner");
  collaborator = await h.createUser("PRIVATE_LOGIN_NAME");
  expect((await h.as(collaborator).post("/v1/namespaces", { slug: "co-writer" })).status).toBe(201);
  expect((await h.as(owner).post("/v1/namespaces", { slug: "co-author" })).status).toBe(201);
});
afterAll(async () => {
  await h?.close();
  await db?.drop();
});
async function work(credit = false) {
  const name = `work-${++sequence}`;
  const created = await h
    .as(owner)
    .post("/v1/namespaces/co-author/creations", { name, type: "world", display_name: name });
  expect(created.status).toBe(201);
  const id = decodeId("creation", ((await created.json()) as { id: string }).id);
  if (!id) throw new Error("id");
  const path = `/v1/creations/@co-author/${name}`;
  const draft = DraftSchema.parse(await (await h.as(owner).get(`${path}/draft`)).json());
  const working = {
    ...(draft.working as Record<string, unknown>),
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
    fragments: [
      {
        id: "world",
        kind: "world",
        stable: true,
        content: { type: "text", text: "Private world definition" },
      },
    ],
  };
  expect(
    (await h.as(owner).put(`${path}/draft`, { working }, { "if-match": String(draft.version) }))
      .status,
  ).toBe(200);
  if (credit) {
    await grant(id);
    const current = DraftSchema.parse(await (await h.as(collaborator).get(`${path}/draft`)).json());
    const edited = await h.as(collaborator).put(
      `${path}/draft`,
      {
        working: {
          ...(current.working as Record<string, unknown>),
          summary: "A collaborator edited this work.",
        },
      },
      { "if-match": String(current.version) },
    );
    expect(edited.status, await edited.clone().text()).toBe(200);
  }
  const revisionResponse = await h.as(owner).post(`${path}/revisions`, {});
  expect([200, 201]).toContain(revisionResponse.status);
  const revision = ((await revisionResponse.json()) as { id: string }).id;
  async function publish(label: string, visibility: "public" | "private") {
    const response = await h
      .as(owner)
      .post(
        `${path}/releases`,
        { revision, label, visibility },
        { "idempotency-key": `${name}-${label}-publish-key` },
      );
    expect(response.status, await response.clone().text()).toBe(202);
    const release = ((await response.json()) as { release: string }).release;
    expect(await h.runPublishJobs()).toEqual(["published"]);
    return release;
  }
  const release = await publish("private", "private");
  return { id, path, release, publish };
}
async function grant(creationId: string, accepted = true) {
  await db.app.db.insert(creationCollaborators).values({
    creationId,
    userId: collaborator,
    invitedBy: owner,
    license: "CC0-1.0",
    acceptedAt: accepted ? h.clock.now() : null,
  });
}

it("requires acceptance, reads only that private work, and revokes both named and exact release access", async () => {
  const shared = await work();
  const sibling = await work();
  await grant(shared.id, false);
  expect(await collaborationAccess(db.app.db, shared.id, principal())).toBe(false);
  expect((await h.as(collaborator).get(`${shared.path}/draft`)).status).toBe(404);
  expect(await authorizedRelease(db.app.db, principal(), shared.release)).toBeNull();
  await db.app.db
    .update(creationCollaborators)
    .set({ acceptedAt: h.clock.now() })
    .where(eq(creationCollaborators.creationId, shared.id));
  const detail = await h.as(collaborator).get(shared.path);
  expect(detail.status).toBe(200);
  expect(detail.headers.get("cache-control")).toBe("private, no-store");
  expect(await detail.json()).toMatchObject({
    permissions: {
      read_draft: true,
      edit: true,
      publish: false,
      update_sensitive: false,
      manage_source: false,
      manage_collaborators: false,
    },
  });
  expect((await h.as(collaborator).get(`${shared.path}/draft`)).status).toBe(200);
  expect((await h.as(collaborator).get(`${shared.path}/releases/private`)).status).toBe(200);
  expect(await authorizedRelease(db.app.db, principal(), shared.release)).not.toBeNull();
  // Missing source query is reached only after the exact private-release read gate succeeded.
  expect((await h.as(collaborator).get(`/v1/releases/${shared.release}/source-text`)).status).toBe(
    400,
  );
  expect((await h.as(collaborator).get(sibling.path)).status).toBe(404);
  expect((await h.as(collaborator).get(`${sibling.path}/draft`)).status).toBe(404);
  expect(await authorizedRelease(db.app.db, principal(), sibling.release)).toBeNull();
  expect(
    (
      await h.as(collaborator).post("/v1/namespaces/co-author/creations", {
        name: "unauthorized",
        type: "world",
        display_name: "Unauthorized",
      })
    ).status,
  ).toBe(403);
  await db.app.db
    .delete(creationCollaborators)
    .where(eq(creationCollaborators.creationId, shared.id));
  expect((await h.as(collaborator).get(shared.path)).status).toBe(404);
  expect((await h.as(collaborator).get(`${shared.path}/draft`)).status).toBe(404);
  expect((await h.as(collaborator).get(`/v1/releases/${shared.release}/source-text`)).status).toBe(
    404,
  );
  expect(await authorizedRelease(db.app.db, principal(), shared.release)).toBeNull();
});

it("keeps public detail readable to a publish-only token without leaking private releases or edit capabilities", async () => {
  const shared = await work();
  await grant(shared.id);
  const publicRelease = await shared.publish("public", "public");
  const token = generateToken();
  await db.app.db.insert(apiTokens).values({
    id: h.services.ids.uuid(),
    userId: collaborator,
    name: "Publish only",
    prefix: token.slice(0, 12),
    tokenHash: hashToken(token),
    scopes: ["releases:publish"],
  });
  const reader = h.withToken(token);
  const detail = await reader.get(shared.path);
  expect(detail.status).toBe(200);
  expect(detail.headers.get("cache-control")).toBe("private, no-store");
  const body = (await detail.json()) as {
    releases: { id: string }[];
    permissions: Record<string, boolean>;
  };
  expect(body.releases.map((r) => r.id)).toEqual([publicRelease]);
  expect(Object.values(body.permissions).every((value) => value === false)).toBe(true);
  expect((await reader.get(`${shared.path}/draft`)).status).toBe(403);
  expect((await reader.get(`${shared.path}/releases/private`)).status).toBe(403);
  expect((await reader.get(`${shared.path}/releases/public`)).status).toBe(200);
  expect(
    await authorizedRelease(
      db.app.db,
      { ...principal(), scopes: ["releases:publish"] },
      shared.release,
    ),
  ).toBeNull();
  expect(
    await authorizedRelease(
      db.app.db,
      { ...principal(), scopes: ["releases:publish"] },
      publicRelease,
    ),
  ).not.toBeNull();
});

it("does not treat a personal namespace maintainer as the owner or a collaborator", async () => {
  const privateWork = await work();
  const [ns] = await db.app.db.select().from(namespaces).where(eq(namespaces.slug, "co-author"));
  if (!ns) throw new Error("namespace");
  await db.app.db
    .insert(namespaceMembers)
    .values({ namespaceId: ns.id, userId: collaborator, role: "maintainer" });
  try {
    expect((await h.as(collaborator).get(privateWork.path)).status).toBe(404);
    expect((await h.as(collaborator).get(`${privateWork.path}/draft`)).status).toBe(404);
    expect(await authorizedRelease(db.app.db, principal(), privateWork.release)).toBeNull();
    expect(
      (
        await h.as(collaborator).post("/v1/namespaces/co-author/creations", {
          name: "maintainer-write",
          type: "world",
          display_name: "No",
        })
      ).status,
    ).toBe(403);
  } finally {
    await db.app.db
      .delete(namespaceMembers)
      .where(
        and(eq(namespaceMembers.namespaceId, ns.id), eq(namespaceMembers.userId, collaborator)),
      );
  }
});

it("shows immutable revision contributors in release detail and lists without changing authors or exposing login names", async () => {
  const shared = await work(true);
  const expected = [{ user: encodeId("user", collaborator), name: "@co-writer" }];
  const detail = (await (await h.as(owner).get(`${shared.path}/releases/private`)).json()) as {
    contributors: unknown;
  };
  expect(detail.contributors).toEqual(expected);
  const creation = (await (await h.as(owner).get(shared.path)).json()) as {
    releases: { contributors: unknown }[];
    latest_release: { contributors: unknown };
  };
  expect(creation.releases[0]?.contributors).toEqual(expected);
  expect(creation.latest_release.contributors).toEqual(expected);
  await db.app.db
    .update(authUser)
    .set({ name: "CHANGED_PRIVATE_LOGIN_NAME" })
    .where(eq(authUser.id, collaborator));
  await db.app.db
    .delete(creationCollaborators)
    .where(eq(creationCollaborators.creationId, shared.id));
  const after = (await (await h.as(owner).get(`${shared.path}/releases/private`)).json()) as {
    contributors: unknown;
  };
  expect(after.contributors).toEqual(expected);
  const saved = DraftSchema.parse(await (await h.as(owner).get(`${shared.path}/draft`)).json());
  const authors = (saved.working as { authors: { user: string }[] }).authors;
  expect(authors.map((author) => author.user)).toEqual([encodeId("user", owner)]);
});

it("uses the same owner rule for license exemptions and never promotes a personal maintainer or work collaborator", async () => {
  const shared = await work();
  await grant(shared.id);
  const [personal] = await db.app.db
    .select()
    .from(namespaces)
    .where(eq(namespaces.slug, "co-author"));
  if (!personal) throw new Error("namespace");
  const systemId = h.services.ids.uuid();
  await db.app.db
    .insert(namespaces)
    .values({ id: systemId, slug: "platform-test", kind: "system", createdBy: owner });
  await db.app.db.insert(namespaceMembers).values([
    { namespaceId: personal.id, userId: collaborator, role: "maintainer" },
    { namespaceId: systemId, userId: collaborator, role: "maintainer" },
  ]);
  try {
    const registry = await loadContentRegistryState(db.app.db, {
      namespaceSlug: "build-root",
      publisherUserId: collaborator,
      digests: [],
      assetDigests: [],
    });
    expect([...registry.ownerNamespaces].sort()).toEqual([
      "build-root",
      "co-writer",
      "platform-test",
    ]);
    expect(registry.ownerNamespaces.has("co-author")).toBe(false);
  } finally {
    await db.app.db
      .delete(namespaceMembers)
      .where(
        and(
          eq(namespaceMembers.namespaceId, personal.id),
          eq(namespaceMembers.userId, collaborator),
        ),
      );
    await db.app.db.delete(namespaceMembers).where(eq(namespaceMembers.namespaceId, systemId));
    await db.app.db.delete(namespaces).where(eq(namespaces.id, systemId));
  }
});

it("rejects a stale accepted license even when another write path did not reset acceptedAt", async () => {
  const shared = await work();
  await grant(shared.id);
  expect(await collaborationAccess(db.app.db, shared.id, principal())).toBe(true);
  // Simulate an owner Source/import write that bypassed invitation invalidation.
  await db.app.db
    .update(creationDrafts)
    .set({
      working: sql`jsonb_set(${creationDrafts.working}, '{meta,license}', '"CC-BY-4.0"'::jsonb)`,
    })
    .where(eq(creationDrafts.creationId, shared.id));
  const [unchanged] = await db.app.db
    .select()
    .from(creationCollaborators)
    .where(
      and(
        eq(creationCollaborators.creationId, shared.id),
        eq(creationCollaborators.userId, collaborator),
      ),
    );
  expect(unchanged?.acceptedAt).not.toBeNull();
  expect(unchanged?.license).toBe("CC0-1.0");
  expect(await collaborationAccess(db.app.db, shared.id, principal())).toBe(false);
  expect((await h.as(collaborator).get(`${shared.path}/draft`)).status).toBe(404);
  expect((await h.as(collaborator).post(`${shared.path}/revisions`, {})).status).toBe(404);
  expect(await authorizedRelease(db.app.db, principal(), shared.release)).toBeNull();
  expect((await h.as(owner).get(`${shared.path}/draft`)).status).toBe(200);
  // Only consent that matches the new license can authorize this work again.
  await db.app.db
    .update(creationCollaborators)
    .set({ license: "CC-BY-4.0", acceptedAt: h.clock.now() })
    .where(
      and(
        eq(creationCollaborators.creationId, shared.id),
        eq(creationCollaborators.userId, collaborator),
      ),
    );
  expect(await collaborationAccess(db.app.db, shared.id, principal())).toBe(true);
});
