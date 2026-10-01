/** The private author list applies work authorization in SQL before its 500-row limit. */
import { MyCreationsResponseSchema } from "@char-pub/contracts";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { generateToken, hashToken } from "../src/auth/tokens.js";
import {
  apiTokens,
  creationCollaborators,
  creationDrafts,
  creations,
  namespaceMembers,
  namespaces,
} from "../src/db/schema/index.js";
import { decodeId, encodeId } from "../src/registry/ids.js";
import { type ApiHarness, createHarness } from "./api-harness.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

let db: TestDatabase;
let h: ApiHarness;
let owner: string;
let writer: string;
let index = 0;
beforeAll(async () => {
  db = await createTestDatabase();
  h = await createHarness(db, testCas(), { defaultPolicy: false });
  owner = await h.createUser("Work owner");
  writer = await h.createUser("Collaborating writer");
  expect((await h.as(owner).post("/v1/namespaces", { slug: "list-owner" })).status).toBe(201);
  expect((await h.as(writer).post("/v1/namespaces", { slug: "list-writer" })).status).toBe(201);
});
afterAll(async () => {
  await h?.close();
  await db?.drop();
});
async function draft(as = owner) {
  const slug = as === owner ? "list-owner" : "list-writer";
  const name = `work-${++index}`;
  const response = await h.as(as).post(`/v1/namespaces/${slug}/creations`, {
    name,
    type: "world",
    display_name: `Private ${name}`,
  });
  expect(response.status).toBe(201);
  const result = (await response.json()) as { id: string; ref: string };
  const id = decodeId("creation", result.id);
  if (!id) throw new Error("id");
  return { id, ref: result.ref };
}
async function consent(creationId: string, accepted = true, user = writer) {
  await db.app.db.insert(creationCollaborators).values({
    creationId,
    userId: user,
    invitedBy: owner,
    license: "LicenseRef-All-Rights-Reserved",
    acceptedAt: accepted ? h.clock.now() : null,
  });
}
async function listed() {
  const response = await h.as(writer).get("/v1/me/creations");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  return MyCreationsResponseSchema.parse(await response.json()).items;
}

it("lists owned and accepted works once, excluding pending, revoked, stale-license and private siblings", async () => {
  const own = await draft(writer);
  await consent(own.id, true);
  const shared = await draft();
  await consent(shared.id);
  const pending = await draft();
  await consent(pending.id, false);
  const sibling = await draft();
  const revoked = await draft();
  await consent(revoked.id);
  await db.app.db
    .delete(creationCollaborators)
    .where(eq(creationCollaborators.creationId, revoked.id));
  const stale = await draft();
  await consent(stale.id);
  await db.app.db
    .update(creationDrafts)
    .set({ working: sql`jsonb_set(${creationDrafts.working},'{meta,license}','"CC0-1.0"'::jsonb)` })
    .where(eq(creationDrafts.creationId, stale.id));
  const refs = (await listed()).map((row) => row.ref);
  expect(refs.filter((ref) => ref === own.ref)).toHaveLength(1);
  expect(refs).toContain(shared.ref);
  for (const work of [pending, sibling, revoked, stale]) expect(refs).not.toContain(work.ref);
  await db.app.db
    .delete(creationCollaborators)
    .where(eq(creationCollaborators.creationId, shared.id));
  expect((await listed()).map((row) => row.ref)).not.toContain(shared.ref);
  const ownerRows = MyCreationsResponseSchema.parse(
    await (await h.as(owner).get("/v1/me/creations")).json(),
  ).items;
  expect(ownerRows.map((row) => row.ref)).toContain(stale.ref);
  expect(ownerRows.map((row) => row.ref)).not.toContain(own.ref);
});

it("rejects a PAT without creations:read while permitting the same accepted work with read scope", async () => {
  const shared = await draft();
  await consent(shared.id);
  async function token(scopes: string[]) {
    const value = generateToken();
    await db.app.db.insert(apiTokens).values({
      id: h.services.ids.uuid(),
      userId: writer,
      name: "List permission",
      prefix: value.slice(0, 12),
      tokenHash: hashToken(value),
      scopes,
    });
    return h.withToken(value);
  }
  const noRead = await token(["creations:write", "releases:publish"]);
  const response = await noRead.get("/v1/me/creations");
  expect(response.status).toBe(403);
  expect(await response.text()).toContain("token.insufficient_scope");
  const reader = await token(["creations:read"]);
  const result = await reader.get("/v1/me/creations");
  expect(result.status).toBe(200);
  expect(
    MyCreationsResponseSchema.parse(await result.json()).items.map((row) => row.ref),
  ).toContain(shared.ref);
  expect((await h.as(null).get("/v1/me/creations")).status).toBe(401);
});

it("does not allow personal maintainers to fill the page with inaccessible drafts before an older valid collaboration", async () => {
  const shared = await draft();
  await consent(shared.id);
  await db.app.db
    .update(creationDrafts)
    .set({ updatedAt: new Date("2020-01-01T00:00:00Z") })
    .where(eq(creationDrafts.creationId, shared.id));
  const [namespace] = await db.app.db
    .select()
    .from(namespaces)
    .where(eq(namespaces.slug, "list-owner"));
  if (!namespace) throw new Error("namespace");
  await db.app.db
    .insert(namespaceMembers)
    .values({ namespaceId: namespace.id, userId: writer, role: "maintainer" });
  const hidden = Array.from({ length: 501 }, (_, i) => ({
    id: h.services.ids.uuid(),
    name: `unreadable-${i}`,
  }));
  await db.app.db.insert(creations).values(
    hidden.map((row) => ({
      ...row,
      namespaceId: namespace.id,
      type: "world" as const,
      displayName: "DO NOT DISCLOSE",
      rating: "general" as const,
    })),
  );
  await db.app.db.insert(creationDrafts).values(
    hidden.map((row) => ({
      creationId: row.id,
      working: {
        id: encodeId("creation", row.id),
        ref: `@list-owner/${row.name}`,
        type: "world",
        display_name: "DO NOT DISCLOSE",
        meta: { license: "CC0-1.0" },
      },
      updatedBy: owner,
      updatedAt: new Date("2030-01-01T00:00:00Z"),
    })),
  );
  try {
    const rows = await listed();
    expect(rows.some((row) => row.ref === shared.ref)).toBe(true);
    expect(rows.some((row) => row.ref.startsWith("@list-owner/unreadable-"))).toBe(false);
    expect(JSON.stringify(rows)).not.toContain("DO NOT DISCLOSE");
  } finally {
    await db.app.db
      .delete(namespaceMembers)
      .where(
        and(eq(namespaceMembers.namespaceId, namespace.id), eq(namespaceMembers.userId, writer)),
      );
  }
});

it("preserves the explicit system-namespace maintenance exception", async () => {
  const namespaceId = h.services.ids.uuid();
  const creationId = h.services.ids.uuid();
  await db.app.db
    .insert(namespaces)
    .values({ id: namespaceId, slug: "list-system", kind: "system", createdBy: owner });
  await db.app.db
    .insert(namespaceMembers)
    .values({ namespaceId, userId: writer, role: "maintainer" });
  await db.app.db.insert(creations).values({
    id: creationId,
    namespaceId,
    name: "platform-work",
    type: "world",
    displayName: "Platform work",
    rating: "general",
  });
  await db.app.db.insert(creationDrafts).values({
    creationId,
    working: { display_name: "Platform draft", meta: { license: "CC0-1.0" } },
    updatedBy: owner,
  });
  expect((await listed()).map((row) => row.ref)).toContain("@list-system/platform-work");
});
