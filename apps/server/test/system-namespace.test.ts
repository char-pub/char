/**
 * `@commons` 这类 system namespace：只能由 bootstrap 创建，成员是 maintainer，按普通 API
 * 发布（经过同样的发布校验），但不能改名；普通用户既注册不到这个名字，也不能在里面发布。
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { register as registerRead } from "../src/api/routes/read.js";
import { verifyAuditChain } from "../src/audit/audit.js";
import { namespaces } from "../src/db/schema/index.js";
import { ensureSystemNamespace } from "../src/processes/bootstrap.js";
import { type ApiHarness, createHarness } from "./api-harness.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

let t: TestDatabase;
let h: ApiHarness;
let curator: string;
let stranger: string;
const now = new Date("2026-09-22T12:00:00Z");

const world = {
  display_name: "Saltmere",
  fragments: [
    {
      id: "overview",
      stable: true,
      kind: "world",
      content: { type: "text", text: "A harbor city-state of salt merchants." },
    },
  ],
  meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
};

beforeAll(async () => {
  t = await createTestDatabase();
  h = await createHarness(t, testCas(), { extraModules: [registerRead] });
  curator = await h.createUser("curator");
  stranger = await h.createUser("stranger");
});

afterAll(async () => {
  await h.close();
  await t.drop();
});

describe("system namespaces", () => {
  it("cannot be registered through the public API", async () => {
    const r = await h.as(stranger).post("/v1/namespaces", { slug: "commons" });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: "namespace.reserved" });
  });

  it("is created by bootstrap once, and adding the same member again changes nothing", async () => {
    expect(await ensureSystemNamespace(t.app.db, "commons", "nobody@example.test", now)).toEqual({
      ok: false,
      code: "bootstrap.user_not_found",
    });
    expect(await ensureSystemNamespace(t.app.db, "commons", "CURATOR@example.test", now)).toEqual({
      ok: true,
      created: true,
      added: true,
    });
    expect(await ensureSystemNamespace(t.app.db, "commons", "curator@example.test", now)).toEqual({
      ok: true,
      created: false,
      added: false,
    });
    const [ns] = await t.app.db.select().from(namespaces).where(eq(namespaces.slug, "commons"));
    expect(ns?.kind).toBe("system");
    expect((await verifyAuditChain(t.app.db)).ok).toBe(true);
  });

  it("lets a maintainer publish through the normal flow and publish checks", async () => {
    const me = h.as(curator);
    const created = await me.post("/v1/namespaces/commons/creations", {
      name: "saltmere",
      type: "world",
      display_name: "Saltmere",
    });
    expect(created.status).toBe(201);
    const draft = (await (await me.get("/v1/creations/@commons/saltmere/draft")).json()) as {
      version: number;
    };
    const put = await me.put(
      "/v1/creations/@commons/saltmere/draft",
      { working: world },
      { "if-match": String(draft.version) },
    );
    expect(put.status).toBe(200);
    const rev = (await (await me.post("/v1/creations/@commons/saltmere/revisions", {})).json()) as {
      id: string;
    };
    const pub = await me.post(
      "/v1/creations/@commons/saltmere/releases",
      { revision: rev.id, label: "1.0.0", visibility: "public" },
      { "idempotency-key": "commons-saltmere-1" },
    );
    expect(pub.status).toBe(202);
    expect(await h.runPublishJobs()).toEqual(["published"]);
    const anon = await h.as(null).get("/v1/creations/@commons/saltmere");
    expect(anon.status).toBe(200);
  });

  it("cannot be renamed by its maintainer, and outsiders cannot publish into it", async () => {
    const rename = await h.as(curator).patch("/v1/namespaces/commons", { new_slug: "commons2" });
    expect(rename.status).toBe(403);
    const intrude = await h.as(stranger).post("/v1/namespaces/commons/creations", {
      name: "intruder",
      type: "world",
      display_name: "Intruder",
    });
    expect([403, 404]).toContain(intrude.status);
  });

  it("refuses to take over a namespace that is not a system namespace", async () => {
    await h.as(stranger).post("/v1/namespaces", { slug: "stranger-ns" });
    await t.app.db
      .update(namespaces)
      .set({ slug: "commons-old" })
      .where(eq(namespaces.slug, "commons"));
    await t.app.db
      .update(namespaces)
      .set({ slug: "commons" })
      .where(eq(namespaces.slug, "stranger-ns"));
    expect(await ensureSystemNamespace(t.app.db, "commons", "curator@example.test", now)).toEqual({
      ok: false,
      code: "bootstrap.namespace_not_system",
    });
  });
});
