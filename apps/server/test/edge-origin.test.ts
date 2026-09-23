/**
 * 源站校验与安全响应头的集成测试：按生产环境的方式设置环境变量，经过真实的进程装配
 * （环境变量解析 → 中间件顺序 → 路由模块）启动 api，再从外部发请求。
 *
 * Cloudflare 回源时附带 `X-Origin-Auth`；绕过 Cloudflare 直接访问源站的请求没有正确的值，
 * 一律 403。轮换期间当前值与上一个值都有效；健康检查不要求这个头，供部署探针使用。
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Started, startProcess } from "../src/processes/start.js";
import { createTestDatabase, type TestDatabase, testStorageEnv } from "./helpers.js";

const CURRENT = randomBytes(32).toString("base64url");
const PREVIOUS = randomBytes(32).toString("base64url");
const API = "https://api.example.test";

/** 这些功能各自有开关式的配置；测试进程的环境里如果带着它们，会改变被测的装配。 */
const UNRELATED = [
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "GITHUB_WEBHOOK_SECRET_PREVIOUS",
  "OIDC_AUDIENCE",
  "TURNSTILE_SECRET_KEY",
  "SMTP_URL",
  "EMAIL_FROM",
  "GUEST_HMAC_KEY",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
];

let t: TestDatabase;
let api: Started;
let admin: Started;
const saved = { ...process.env };

beforeAll(async () => {
  t = await createTestDatabase();
  for (const k of UNRELATED) delete process.env[k];
  Object.assign(process.env, {
    NODE_ENV: "production",
    DATABASE_URL: t.appUrl,
    DATABASE_POOL_MAX: "2",
    ...testStorageEnv(),
    BETTER_AUTH_SECRET: randomBytes(32).toString("base64url"),
    BETTER_AUTH_URL: API,
    AUTH_TRUSTED_ORIGINS: "https://www.example.test",
    ORIGIN_AUTH_SECRET: CURRENT,
    ORIGIN_AUTH_SECRET_PREVIOUS: PREVIOUS,
    CF_ACCESS_TEAM_DOMAIN: "https://example-team.cloudflareaccess.com",
    CF_ACCESS_AUD: "test-aud",
    STAFF_EMAILS: "owner@example.test",
    ADMIN_ORIGINS: "https://admin.example.test",
    LEGAL_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  });
  api = await startProcess("api");
  admin = await startProcess("admin");
});

afterAll(async () => {
  await api?.shutdown();
  await admin?.shutdown();
  process.env = saved;
  await t.drop();
});

function get(path: string, originAuth?: string, target: Started = api) {
  return target.fetch(
    new Request(`${API}${path}`, {
      headers: originAuth === undefined ? {} : { "x-origin-auth": originAuth },
    }),
  );
}

async function codeOf(r: Response) {
  return [r.status, ((await r.json()) as { code?: string }).code];
}

describe("origin check on the api process", () => {
  it("rejects requests that did not come through Cloudflare", async () => {
    expect(await codeOf(await get("/v1/search?q=alice"))).toEqual([403, "origin.forbidden"]);
    expect(await codeOf(await get("/v1/search?q=alice", "wrong"))).toEqual([
      403,
      "origin.forbidden",
    ]);
    expect(await codeOf(await get("/v1/search?q=alice", `${CURRENT}x`))).toEqual([
      403,
      "origin.forbidden",
    ]);
    expect(await codeOf(await get("/v1/search?q=alice", ""))).toEqual([403, "origin.forbidden"]);
  });

  it("checks the header before routing, so unknown and auth paths are rejected the same way", async () => {
    expect(await codeOf(await get("/v1/no-such-route"))).toEqual([403, "origin.forbidden"]);
    expect(await codeOf(await get("/v1/auth/get-session"))).toEqual([403, "origin.forbidden"]);
    expect(await codeOf(await get("/v1/admin/flags"))).toEqual([403, "origin.forbidden"]);
  });

  it("accepts the current secret and, during rotation, the previous one", async () => {
    expect((await get("/v1/search?q=alice", CURRENT)).status).toBe(200);
    expect((await get("/v1/search?q=alice", PREVIOUS)).status).toBe(200);
    // 通过源站校验之后照常路由：不存在的路径是 404，而不是 403。
    expect((await get("/v1/no-such-route", CURRENT)).status).toBe(404);
  });

  it("exempts the health check", async () => {
    const r = await get("/healthz");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });
});

describe("origin check on the admin process", () => {
  it("rejects requests without the secret before Cloudflare Access is even checked", async () => {
    expect(await codeOf(await get("/v1/admin/flags", undefined, admin))).toEqual([
      403,
      "origin.forbidden",
    ]);
    expect(await codeOf(await get("/v1/admin/flags", "wrong", admin))).toEqual([
      403,
      "origin.forbidden",
    ]);
  });

  it("with the secret, the request still needs a Cloudflare Access token", async () => {
    for (const secret of [CURRENT, PREVIOUS]) {
      expect(await codeOf(await get("/v1/admin/flags", secret, admin))).toEqual([
        403,
        "admin.access_required",
      ]);
    }
    expect((await get("/healthz", undefined, admin)).status).toBe(200);
  });
});

describe("security headers on the api process", () => {
  const EXPECTED = {
    "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "cross-origin-resource-policy": "same-site",
    "cross-origin-opener-policy": "same-origin",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  };

  it("are set on successful responses, errors, rejected requests and the health check", async () => {
    const responses = [
      await get("/v1/search?q=alice", CURRENT),
      await get("/v1/no-such-route", CURRENT),
      await get("/v1/search?q=alice"),
      await get("/healthz"),
      await get("/v1/admin/flags", undefined, admin),
      await get("/v1/admin/flags", CURRENT, admin),
    ];
    for (const r of responses) {
      for (const [name, value] of Object.entries(EXPECTED)) {
        expect([r.status, name, r.headers.get(name)]).toEqual([r.status, name, value]);
      }
      expect(r.headers.get("permissions-policy")).toMatch(/camera=\(\)/);
      expect(r.headers.get("x-powered-by")).toBeNull();
    }
  });
});
