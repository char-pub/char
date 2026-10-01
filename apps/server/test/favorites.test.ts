import { FavoritesResponseSchema } from "@char-pub/contracts";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { generateToken, hashToken } from "../src/auth/tokens.js";
import { apiTokens, creationCollaborators, favorites } from "../src/db/schema/index.js";
import { decodeId } from "../src/registry/ids.js";
import { type ApiHarness, createHarness } from "./api-harness.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

let db: TestDatabase;
let h: ApiHarness;
let owner: string;
let reader: string;
let index = 0;
beforeAll(async () => {
  db = await createTestDatabase();
  h = await createHarness(db, testCas());
  owner = await h.createUser("Favorite owner");
  reader = await h.createUser("Favorite reader");
  expect((await h.as(owner).post("/v1/namespaces", { slug: "favorite-owner" })).status).toBe(201);
  expect((await h.as(reader).post("/v1/namespaces", { slug: "favorite-reader" })).status).toBe(201);
});
afterAll(async () => {
  await h?.close();
  await db?.drop();
});
async function character(visibility?: "public" | "private") {
  const name = `character-${++index}`;
  const response = await h.as(owner).post("/v1/namespaces/favorite-owner/creations", {
    name,
    type: "character",
    display_name: `Character ${index}`,
    working: {
      fragments: [
        {
          id: "description",
          stable: true,
          kind: "character",
          content: { type: "text", text: "A quiet traveler." },
        },
      ],
      meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
    },
  });
  expect(response.status).toBe(201);
  const result = (await response.json()) as { id: string; ref: string };
  const id = decodeId("creation", result.id);
  if (!id) throw new Error("creation id");
  const path = `/v1/creations/${result.ref}`;
  if (visibility) {
    const revisionResponse = await h.as(owner).post(`${path}/revisions`, {});
    expect(revisionResponse.status).toBe(201);
    const revision = (await revisionResponse.json()) as { id: string };
    const publish = await h
      .as(owner)
      .post(
        `${path}/releases`,
        { revision: revision.id, label: "1.0.0", visibility },
        { "idempotency-key": `favorite-${index}` },
      );
    expect(publish.status).toBe(202);
    expect(await h.runPublishJobs()).toContain("published");
  }
  return { id, ref: result.ref, path };
}
async function list(user: string, suffix = "") {
  const response = await h.as(user).get(`/v1/me/favorites${suffix}`);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  return FavoritesResponseSchema.parse(await response.json());
}

it("saves idempotently per account and removes only that account's bookmark", async () => {
  const work = await character("public");
  for (const user of [owner, reader, reader])
    expect((await h.as(user).put(`${work.path}/favorite`)).status).toBe(200);
  expect(
    await db.app.db.select().from(favorites).where(eq(favorites.creationId, work.id)),
  ).toHaveLength(2);
  expect((await list(reader)).items.map((item) => item.ref)).toContain(work.ref);
  for (let n = 0; n < 2; n++)
    expect((await h.as(reader).delete(`${work.path}/favorite`)).status).toBe(200);
  expect((await list(reader)).items.map((item) => item.ref)).not.toContain(work.ref);
  expect((await list(owner)).items.map((item) => item.ref)).toContain(work.ref);
});

it("does not expose private favorites after collaboration is revoked, including pagination", async () => {
  const hidden = await character("private");
  expect((await h.as(reader).put(`${hidden.path}/favorite`)).status).toBe(404);
  await db.app.db.insert(creationCollaborators).values({
    creationId: hidden.id,
    userId: reader,
    invitedBy: owner,
    license: "CC-BY-4.0",
    acceptedAt: h.clock.now(),
  });
  expect((await h.as(reader).put(`${hidden.path}/favorite`)).status).toBe(200);
  expect((await list(reader)).items.map((item) => item.ref)).toContain(hidden.ref);
  await db.app.db
    .delete(creationCollaborators)
    .where(
      and(
        eq(creationCollaborators.creationId, hidden.id),
        eq(creationCollaborators.userId, reader),
      ),
    );
  const first = await character("public");
  const second = await character("public");
  for (const work of [first, second])
    expect((await h.as(reader).put(`${work.path}/favorite`)).status).toBe(200);
  const page = await list(reader, "?limit=1");
  expect(page.items.map((item) => item.ref)).toEqual([first.ref]);
  expect(page.next_cursor).toBe(page.items[0]?.id);
  expect(JSON.stringify(page)).not.toContain(hidden.ref);
  const next = await list(reader, `?limit=1&cursor=${page.next_cursor}`);
  expect(next.items.map((item) => item.ref)).toEqual([second.ref]);
  expect(next.next_cursor).toBeNull();
  expect((await h.as(reader).delete(`${hidden.path}/favorite`)).status).toBe(404);
});

it("requires a browser session and respects read-only writes", async () => {
  const work = await character("public");
  expect((await h.as(null).get("/v1/me/favorites")).status).toBe(401);
  expect((await h.as(null).put(`${work.path}/favorite`)).status).toBe(401);
  const token = generateToken();
  await db.app.db.insert(apiTokens).values({
    id: h.services.ids.uuid(),
    userId: reader,
    name: "Favorite token",
    prefix: token.slice(0, 12),
    tokenHash: hashToken(token),
    scopes: ["creations:read", "creations:write"],
  });
  expect((await h.withToken(token).get("/v1/me/favorites")).status).toBe(403);
  expect((await h.withToken(token).put(`${work.path}/favorite`)).status).toBe(403);
  await h.setFlag("read_only", false);
  try {
    expect((await h.as(reader).put(`${work.path}/favorite`)).status).toBe(503);
    expect((await h.as(reader).get("/v1/me/favorites")).status).toBe(200);
  } finally {
    await h.setFlag("read_only", true);
  }
});

it("does not turn a newly created saved character into a published favorite version", async () => {
  const draft = await character();
  expect((await h.as(owner).put(`${draft.path}/favorite`)).status).toBe(200);
  const item = (await list(owner)).items.find((entry) => entry.ref === draft.ref);
  expect(item).toBeDefined();
  expect(item?.latest_release).toBeUndefined();
  expect((await h.as(reader).put(`${draft.path}/favorite`)).status).toBe(404);
  expect((await h.as(owner).get("/v1/me/favorites?cursor=not-a-creation")).status).toBe(422);
});
