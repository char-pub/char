/**
 * admin 进程的三层防护：Cloudflare Access JWT、员工身份、角色能力与操作理由。
 * 另外验证公开 api 进程上没有任何 admin 路由。
 */
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdmin } from "../src/admin/app.js";
import { registerAudit, registerFlags } from "../src/admin/ops-routes.js";
import type { Services } from "../src/api/app.js";
import { createApi } from "../src/api/server.js";
import { verifyAuditChain } from "../src/audit/audit.js";
import { authUser } from "../src/db/schema/index.js";
import { FlagCache } from "../src/ops/flags.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

const TEAM = "https://char-pub.cloudflareaccess.com";
const AUD = "admin-aud";
let t: TestDatabase;
let sign: (email: string, over?: Record<string, unknown>) => Promise<string>;
let admin: ReturnType<typeof createAdmin>;
let services: Services;
let now = new Date("2026-09-22T12:00:00Z");

const STAFF = {
  owner: "owner@char.pub",
  ts: "ts@char.pub",
  viewer: "viewer@char.pub",
  nobody: "nobody@char.pub",
  banned: "banned@char.pub",
};

beforeAll(async () => {
  t = await createTestDatabase();
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "k", alg: "RS256" };
  sign = (email, over = {}) => {
    const iat = Math.floor(now.getTime() / 1000);
    return new SignJWT({ iss: TEAM, aud: AUD, sub: email, email, iat, exp: iat + 3600, ...over })
      .setProtectedHeader({ alg: "RS256", kid: "k" })
      .sign(privateKey);
  };
  await t.app.db.insert(authUser).values([
    { id: uuidv7(), email: STAFF.owner, name: "Owner", role: "owner" },
    { id: uuidv7(), email: STAFF.ts, name: "TS", role: "trust_safety,moderator" },
    { id: uuidv7(), email: STAFF.viewer, name: "Viewer", role: "viewer" },
    { id: uuidv7(), email: STAFF.nobody, name: "Creator", role: null },
    { id: uuidv7(), email: STAFF.banned, name: "Banned", role: "admin", banned: true },
  ]);
  const flags = new FlagCache(t.app.db, () => now.getTime(), 5000);
  services = {
    db: t.app.db,
    cas: testCas(),
    queue: undefined as never,
    clock: { now: () => now },
    ids: { uuid: () => uuidv7() },
    flags: () => flags.current(),
    publicAssetBaseUrl: "https://assets.example",
  };
  admin = createAdmin({
    services,
    access: {
      teamDomain: TEAM,
      audience: AUD,
      allowedEmails: new Set(Object.values(STAFF)),
      jwks: createLocalJWKSet({ keys: [jwk] }),
      now: () => now,
    },
    originSecrets: [],
    allowedOrigins: ["https://admin.char.pub"],
    modules: [registerFlags, registerAudit],
  });
});
afterAll(async () => {
  await t.drop();
});

async function call(
  email: string | null,
  method: string,
  path: string,
  body?: unknown,
  jwt?: string,
) {
  const headers: Record<string, string> = { origin: "https://admin.char.pub" };
  if (email) headers["cf-access-jwt-assertion"] = jwt ?? (await sign(email));
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await admin.request(path, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: res.status,
    json: (await res.json().catch(() => null)) as Record<string, unknown>,
  };
}

describe("layer 1–2: Cloudflare Access and staff identity", () => {
  it("rejects requests without a valid Access JWT", async () => {
    expect((await call(null, "GET", "/v1/admin/flags")).status).toBe(403);
    const forged = await call(STAFF.owner, "GET", "/v1/admin/flags", undefined, "not-a-jwt");
    expect(forged).toMatchObject({ status: 403, json: { code: "admin.access_required" } });
  });

  it("rejects Access users who are not staff or are banned", async () => {
    expect((await call(STAFF.nobody, "GET", "/v1/admin/flags")).json.code).toBe("admin.not_staff");
    expect((await call(STAFF.banned, "GET", "/v1/admin/flags")).json.code).toBe("admin.not_staff");
    // 不在员工允许名单里的邮箱在 Access JWT 校验阶段就被拒绝。
    expect((await call("someone@example.com", "GET", "/v1/admin/flags")).status).toBe(403);
  });

  it("health checks work without Access", async () => {
    const res = await admin.request("/healthz");
    expect(res.status).toBe(200);
  });
});

describe("layer 3: roles and reasons", () => {
  it("viewers can read flags but cannot toggle them", async () => {
    expect((await call(STAFF.viewer, "GET", "/v1/admin/flags")).status).toBe(200);
    const r = await call(STAFF.viewer, "PUT", "/v1/admin/flags/uploads", {
      enabled: false,
      reason: "suspected abuse wave",
    });
    expect(r).toMatchObject({ status: 403, json: { code: "admin.forbidden" } });
  });

  it("requires a reason of at least 10 characters for writes", async () => {
    const r = await call(STAFF.ts, "PUT", "/v1/admin/flags/uploads", {
      enabled: false,
      reason: "abuse",
    });
    expect(r).toMatchObject({ status: 422, json: { code: "admin.reason_required" } });
  });

  it("toggles a kill switch, audits it, and it takes effect within 5 seconds", async () => {
    expect([...(await services.flags())]).toEqual([]);
    const r = await call(STAFF.ts, "PUT", "/v1/admin/flags/uploads", {
      enabled: false,
      reason: "suspected abuse wave",
    });
    expect(r).toMatchObject({ status: 200, json: { key: "uploads", enabled: false } });
    now = new Date(now.getTime() + 5000);
    expect([...(await services.flags())]).toEqual(["uploads"]);
    const list = await call(STAFF.viewer, "GET", "/v1/admin/flags");
    expect(
      (list.json.flags as { key: string; enabled: boolean }[]).find((f) => f.key === "uploads")
        ?.enabled,
    ).toBe(false);
    expect((await verifyAuditChain(t.app.db)).ok).toBe(true);
  });

  it("rejects unknown flags", async () => {
    const r = await call(STAFF.owner, "PUT", "/v1/admin/flags/everything", {
      enabled: false,
      reason: "long enough reason",
    });
    expect(r.status).toBe(404);
  });
});

describe("audit log access", () => {
  it("owner sees all entries and can verify the chain; viewers only see their own", async () => {
    const all = await call(STAFF.owner, "GET", "/v1/admin/audit");
    expect((all.json.items as unknown[]).length).toBeGreaterThan(0);
    const own = await call(STAFF.viewer, "GET", "/v1/admin/audit");
    expect(own.json.items).toEqual([]);
    const verify = await call(STAFF.owner, "GET", "/v1/admin/audit/verify");
    expect(verify.json.ok).toBe(true);
    expect((await call(STAFF.viewer, "GET", "/v1/admin/audit/verify")).status).toBe(403);
  });
});

describe("admin routes are not mounted on the public api", () => {
  it("returns 404 for admin paths on the api process", async () => {
    const api = createApi({ services, originSecrets: [], allowedOrigins: [], modules: [] });
    for (const path of ["/v1/admin/flags", "/v1/admin/audit", "/v1/admin/audit/verify"]) {
      const res = await api.request(path, {
        headers: { "cf-access-jwt-assertion": await sign(STAFF.owner) },
      });
      expect(res.status).toBe(404);
    }
  });
});
