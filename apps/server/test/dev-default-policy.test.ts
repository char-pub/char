import { DraftBuildResponseSchema, DraftSchema } from "@char-pub/contracts";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  assertLocalDevelopment,
  ensureDevelopmentDefaultPolicy,
} from "../scripts/dev-default-policy.js";
import { creations, draftBuilds, releases } from "../src/db/schema/index.js";
import { decodeId } from "../src/registry/ids.js";
import { handleDraftBuild } from "../src/worker/draft-build.js";
import { type ApiHarness, createHarness } from "./api-harness.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

let t: TestDatabase;
let h: ApiHarness;
beforeAll(async () => {
  t = await createTestDatabase();
  h = await createHarness(t, testCas(), { defaultPolicy: false });
});
afterAll(async () => {
  await h?.close();
  await t?.drop();
});

it("initializes a real published policy, reuses it and builds an existing content draft", async () => {
  const user = await h.createUser("local-default-author");
  const me = h.as(user);
  expect((await me.post("/v1/namespaces", { slug: "local-default-author" })).status).toBe(201);
  expect(
    (
      await me.post("/v1/namespaces/local-default-author/creations", {
        name: "character",
        type: "character",
        display_name: "Local character",
      })
    ).status,
  ).toBe(201);
  const base = "/v1/creations/@local-default-author/character";
  const initial = DraftSchema.parse(await (await me.get(`${base}/draft`)).json());
  if (!initial.working || typeof initial.working !== "object")
    throw new Error("Missing working definition");
  const working = {
    ...initial.working,
    fragments: [
      {
        id: "description",
        stable: true,
        kind: "character",
        content: { type: "text", text: "An original local character meets {{user}}." },
      },
    ],
  };
  expect(
    (await me.put(`${base}/draft`, { working }, { "if-match": String(initial.version) })).status,
  ).toBe(200);
  const saved = DraftSchema.parse(await (await me.get(`${base}/draft`)).json());
  expect(
    (await me.post(`${base}/draft-builds`, {}, { "if-match": String(saved.version) })).status,
  ).toBe(503);
  const services = { ...h.services, publishDisabled: async () => false };
  const first = await ensureDevelopmentDefaultPolicy(services);
  const second = await ensureDevelopmentDefaultPolicy(services);
  expect(second).toEqual(first);
  const rows = await t.app.db.select().from(releases);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    publishState: "done",
    visibility: "public",
    label: "local-dev-v1",
  });
  expect(DraftSchema.parse(await (await me.get(`${base}/draft`)).json())).toEqual(saved);
  h.services.defaultPolicy = first;
  const requested = await me.post(
    `${base}/draft-builds`,
    {},
    { "if-match": String(saved.version) },
  );
  expect(requested.status, await requested.clone().text()).toBe(202);
  const receipt = DraftBuildResponseSchema.parse(await requested.json());
  const id = decodeId("draft_build", receipt.origin.build_id);
  if (!id) throw new Error("Missing draft build identity");
  expect(await handleDraftBuild(h.services, { build_id: id })).toBe("ready");
  const [row] = await t.app.db.select().from(draftBuilds).where(eq(draftBuilds.id, id));
  expect(row).toMatchObject({ state: "ready", defaultPolicy: first });
  expect(row?.artifactDigest).toMatch(/^sha256:/);
  expect(DraftSchema.parse(await (await me.get(`${base}/draft`)).json())).toMatchObject({
    working: saved.working,
    version: saved.version,
  });
});

it("does not overwrite an existing default preset owned outside the local bootstrap", async () => {
  const [policy] = await t.app.db
    .select()
    .from(creations)
    .where(eq(creations.name, "default-preset"));
  if (!policy) throw new Error("Missing first test policy");
  await t.app.db
    .update(creations)
    .set({ displayName: "Existing reviewed policy" })
    .where(eq(creations.id, policy.id));
  await expect(
    ensureDevelopmentDefaultPolicy({ ...h.services, publishDisabled: async () => false }),
  ).rejects.toThrow("not managed by local development");
  expect(await t.app.db.select().from(releases)).toHaveLength(1);
  const [after] = await t.app.db.select().from(creations).where(eq(creations.id, policy.id));
  expect(after?.displayName).toBe("Existing reviewed policy");
});

it("rejects production, remote services and other databases before touching them", () => {
  const local = {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://user:pass@127.0.0.1:54329/charpub",
    S3_ENDPOINT: "http://127.0.0.1:59000",
    S3_BUCKET_PUBLIC: "charpub-local-public",
    S3_BUCKET_PRIVATE: "charpub-local-private",
    S3_BUCKET_UPLOADS: "charpub-local-uploads",
    S3_BUCKET_EVIDENCE: "charpub-local-evidence",
  };
  expect(() => assertLocalDevelopment(local)).not.toThrow();
  for (const overrides of [
    { NODE_ENV: "production" },
    { DATABASE_URL: "postgres://remote.example/charpub" },
    { DATABASE_URL: "postgres://localhost/other" },
    { S3_ENDPOINT: "https://storage.example" },
    { S3_BUCKET_PUBLIC: "production-public" },
  ])
    expect(() => assertLocalDevelopment({ ...local, ...overrides })).toThrow(
      "requires the development",
    );
});
