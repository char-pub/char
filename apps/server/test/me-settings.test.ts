/**
 * 当前用户与账号设置：`GET /v1/me` 返回个人 namespace 与设置；开启成人内容必须确认
 * 已满 18 岁，关闭时清空确认时间；个人 Token 不能修改设置；每次修改都进入审计链，
 * 并立即影响服务端的搜索过滤。
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { register as registerSearch } from "../src/api/routes/search.js";
import { verifyAuditChain } from "../src/audit/audit.js";
import { auditLog, userSettings } from "../src/db/schema/index.js";
import { type ApiHarness, createHarness, ORIGIN } from "./api-harness.js";
import { createNamespace, META, publishRelease, textFragment } from "./fixtures/published.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

let t: TestDatabase;
let h: ApiHarness;
let user: string;
let fresh: string;

beforeAll(async () => {
  t = await createTestDatabase();
  const cas = testCas();
  h = await createHarness(t, cas, { extraModules: [registerSearch] });
  user = await h.createUser("reader");
  fresh = await h.createUser("fresh");
  expect((await h.as(user).post("/v1/namespaces", { slug: "reader" })).status).toBe(201);
  const ns = await createNamespace(t.app.db, "lounge");
  await publishRelease({
    db: t.app.db,
    cas,
    namespaceId: ns,
    label: "1.0.0",
    creation: {
      ref: "@lounge/velvet",
      type: "world",
      display_name: "Velvet Lounge",
      fragments: [textFragment("world", "world", "x")],
      meta: { ...META, rating: "mature" },
    },
  });
});

afterAll(async () => {
  await h.close();
  await t.drop();
});

async function json(r: Response) {
  return (await r.json()) as Record<string, unknown>;
}

async function velvetVisibleTo(userId: string | null) {
  const r = await h.as(userId).get("/v1/search?q=velvet");
  expect(r.status).toBe(200);
  const body = (await r.json()) as { items: { ref: string }[] };
  return body.items.some((i) => i.ref === "@lounge/velvet");
}

describe("GET /v1/me", () => {
  it("requires a session", async () => {
    const r = await h.as(null).get("/v1/me");
    expect(r.status).toBe(401);
    expect(await json(r)).toMatchObject({ code: "auth.required" });
  });

  it("returns the user's namespace and default settings, never cached", async () => {
    const r = await h.as(user).get("/v1/me");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    const me = await json(r);
    expect(me).toMatchObject({
      name: "reader",
      namespace: "reader",
      settings: { show_mature: false, mature_confirmed_at: null },
    });
    expect(String(me.id)).not.toContain(user);
    const other = await json(await h.as(fresh).get("/v1/me"));
    expect(other.namespace).toBeNull();
  });
});

describe("PUT /v1/me/settings", () => {
  it("refuses to turn on mature content without the adult confirmation", async () => {
    for (const body of [{ show_mature: true }, { show_mature: true, confirm_adult: false }]) {
      const r = await h.as(user).put("/v1/me/settings", body);
      expect(r.status).toBe(422);
    }
    expect(await velvetVisibleTo(user)).toBe(false);
  });

  it("turns mature content on with confirmation and records when", async () => {
    const r = await h.as(user).put("/v1/me/settings", { show_mature: true, confirm_adult: true });
    expect(r.status).toBe(200);
    const me = await json(r);
    expect(me.settings).toMatchObject({
      show_mature: true,
      mature_confirmed_at: h.clock.now().toISOString(),
    });
    expect(await velvetVisibleTo(user)).toBe(true);
    expect(await velvetVisibleTo(null)).toBe(false);
    expect(await velvetVisibleTo(fresh)).toBe(false);
  });

  it("turns it off again and clears the confirmation", async () => {
    const r = await h.as(user).put("/v1/me/settings", { show_mature: false });
    expect(r.status).toBe(200);
    const [row] = await t.app.db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, user))
      .limit(1);
    expect(row).toMatchObject({ showMature: false, matureConfirmedAt: null });
    expect(await velvetVisibleTo(user)).toBe(false);
  });

  it("cannot be changed anonymously or with a personal token", async () => {
    expect((await h.as(null).put("/v1/me/settings", { show_mature: false })).status).toBe(401);
    const created = await json(
      await h.as(user).post("/v1/me/tokens", {
        name: "cli",
        scopes: ["creations:read", "creations:write"],
        expires_in_days: 30,
      }),
    );
    const viaToken = h.withToken(created.token as string);
    expect((await viaToken.get("/v1/me")).status).toBe(200);
    const r = await viaToken.put("/v1/me/settings", { show_mature: true, confirm_adult: true });
    expect(r.status).toBe(403);
    expect(await json(r)).toMatchObject({ code: "token.not_allowed" });
  });

  it("rejects unknown fields", async () => {
    const r = await h.as(user).put("/v1/me/settings", { show_mature: false, locale: "fr" });
    expect(r.status).toBe(422);
  });

  it("writes every change to the audit chain without content", async () => {
    const rows = await t.app.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "account.settings"), eq(auditLog.subject, `user:${user}`)));
    expect(rows.map((r) => [r.before, r.after])).toEqual([
      [{ show_mature: false }, { show_mature: true }],
      [{ show_mature: true }, { show_mature: false }],
    ]);
    expect((await verifyAuditChain(t.app.db)).ok).toBe(true);
  });
});

describe("GET /v1/me/creations", () => {
  it("lists the user's own creations, including unpublished drafts", async () => {
    await h.as(user).post("/v1/namespaces/reader/creations", {
      name: "wanderer",
      type: "character",
      display_name: "Wanderer",
    });
    const r = await h.as(user).get("/v1/me/creations");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    const body = (await r.json()) as { items: Record<string, unknown>[] };
    expect(body.items).toEqual([
      expect.objectContaining({
        ref: "@reader/wanderer",
        type: "character",
        display_name: "Wanderer",
        latest_release: null,
      }),
    ]);
    const other = (await (await h.as(fresh).get("/v1/me/creations")).json()) as {
      items: unknown[];
    };
    expect(other.items).toEqual([]);
    expect((await h.as(null).get("/v1/me/creations")).status).toBe(401);
  });
});

describe("CORS for the web app", () => {
  it("answers preflight requests from allowed origins only, with credentials", async () => {
    const preflight = (origin: string) =>
      h.app.request("/v1/me/settings", {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "PUT",
          "access-control-request-headers": "content-type",
        },
      });
    const ok = await preflight(ORIGIN);
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(ok.headers.get("access-control-allow-credentials")).toBe("true");
    expect(ok.headers.get("access-control-allow-methods")).toContain("PUT");
    const evil = await preflight("https://evil.example");
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
  });
});
