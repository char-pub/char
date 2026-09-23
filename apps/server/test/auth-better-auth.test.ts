/**
 * 创作者登录（Better Auth）的集成测试：真实 Postgres，模拟的 GitHub OAuth 端点。
 *
 * 覆盖：session cookie 的名字与属性、session → principal、Origin 白名单、封禁后会话与
 * Token 立即失效、OAuth 回调建号（UUIDv7 user id + 外部身份记录）、登录接口限流。
 */
import { eq, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Env, Services } from "../src/api/app.js";
import { createApi } from "../src/api/server.js";
import { verifyAuditChain } from "../src/audit/audit.js";
import { banUser, unbanUser } from "../src/auth/ban.js";
import { createAuth, SESSION_COOKIE, sessionPrincipalResolver } from "../src/auth/better-auth.js";
import { displayPrefix, generateToken, hashToken } from "../src/auth/tokens.js";
import type { Principal } from "../src/authz/authorize.js";
import * as s from "../src/db/schema/index.js";
import { createTestDatabase, type TestDatabase } from "./helpers.js";

const BASE_URL = "https://api.char.test";
const WEB = "https://www.char.test";
const SECRET = "test-only-auth-secret-0123456789abcdef";
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.drop();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeAuth(overrides: Partial<Parameters<typeof createAuth>[0]> = {}) {
  return createAuth({
    db: t.app.db,
    secret: SECRET,
    baseURL: BASE_URL,
    trustedOrigins: [WEB],
    providers: { github: { clientId: "gh-client", clientSecret: "gh-secret" } },
    rateLimit: false,
    ...overrides,
  });
}

/** 一个只包含 principal 回显路由的 API，用来观察认证结果。 */
function makeApi(auth: ReturnType<typeof makeAuth>) {
  const services = {
    db: t.app.db,
    clock: { now: () => new Date() },
    ids: { uuid: () => "req-00000000" },
    flags: async () => new Set(),
  } as unknown as Services;
  const echo = (app: Hono<Env>) => {
    // 测试专用：直接回显 principal，不经过 route()（路由扫描只检查 api/routes 目录）。
    app.get("/whoami", (c) => c.json(c.var.principal));
  };
  return createApi({
    services,
    originSecrets: [],
    allowedOrigins: [WEB],
    sessionPrincipal: sessionPrincipalResolver(auth),
    authHandler: (req) => auth.handler(req),
    modules: [echo],
  });
}

async function createUser(email: string, name = "Tester") {
  const auth = makeAuth();
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser(
    { email, name, emailVerified: true },
    { method: "admin" },
  );
  return user;
}

/** 用 Better Auth 自己的内部接口创建会话，并按它的规则签名 cookie。 */
async function loginCookie(auth: ReturnType<typeof makeAuth>, userId: string) {
  const ctx = await auth.$context;
  const session = await ctx.internalAdapter.createSession(userId);
  const { makeSignature } = await import("better-auth/crypto");
  const signed = `${session.token}.${await makeSignature(session.token, ctx.secret)}`;
  return { cookie: `${SESSION_COOKIE}=${encodeURIComponent(signed)}`, token: session.token };
}

async function whoami(app: Hono<Env>, headers: Record<string, string>): Promise<Principal> {
  const r = await app.request("/whoami", { headers });
  expect(r.status).toBe(200);
  return (await r.json()) as Principal;
}

describe("session cookie", () => {
  it("uses the __Host- prefix with Secure, HttpOnly, SameSite=Lax, Path=/ and no Domain", async () => {
    const ctx = await makeAuth().$context;
    const c = ctx.authCookies.sessionToken;
    expect(c.name).toBe("__Host-charpub.session");
    expect(c.attributes).toMatchObject({
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    expect(c.attributes.domain).toBeUndefined();
    expect(c.attributes.maxAge).toBe(30 * 24 * 60 * 60);
    // 其他认证 cookie（OAuth state 等）也使用同样的前缀和属性。
    const state = ctx.createAuthCookie("state");
    expect(state.name.startsWith("__Host-charpub.")).toBe(true);
    expect(state.attributes.secure).toBe(true);
  });

  it("does not cache sessions in cookies", async () => {
    const ctx = await makeAuth().$context;
    expect(ctx.options.session?.cookieCache?.enabled).toBe(false);
  });

  it("rejects a secret shorter than 32 characters", () => {
    expect(() => makeAuth({ secret: "short" })).toThrow(/32/);
  });
});

describe("database permissions for auth tables", () => {
  it("lets the app role read and write sessions, accounts, verifications and rate limits", async () => {
    const r = await t.owner.db.execute<{ table_name: string; privilege_type: string }>(
      sql`SELECT table_name, privilege_type FROM information_schema.role_table_grants
          WHERE grantee = 'charpub_app' AND table_schema = 'app'
            AND table_name IN ('auth_session', 'auth_account', 'auth_verification', 'auth_rate_limit')`,
    );
    for (const table of ["auth_session", "auth_account", "auth_verification", "auth_rate_limit"]) {
      const privs = r.rows.filter((x) => x.table_name === table).map((x) => x.privilege_type);
      expect(privs.sort()).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
    }
  });

  it("lets the app role read the external identities view", async () => {
    const r = await t.app.db.execute(sql`SELECT count(*) FROM app.external_identities`);
    expect(r.rows).toHaveLength(1);
  });
});

describe("session principal", () => {
  it("resolves a signed session cookie to the user principal", async () => {
    const user = await createUser("alice@example.test", "Alice");
    expect(user.id).toMatch(UUID_V7);
    const auth = makeAuth();
    const app = makeApi(auth);
    const { cookie } = await loginCookie(auth, user.id);
    expect(await whoami(app, { cookie })).toEqual({
      kind: "user",
      user_id: user.id,
      banned: false,
    });
  });

  it("treats missing, forged or unknown cookies as anonymous", async () => {
    const app = makeApi(makeAuth());
    expect(await whoami(app, {})).toEqual({ kind: "anonymous" });
    expect(await whoami(app, { cookie: `${SESSION_COOKIE}=forged.value` })).toEqual({
      kind: "anonymous",
    });
    // 没有 __Host- 前缀的同名 cookie 不被接受。
    const user = await createUser("prefix@example.test");
    const auth = makeAuth();
    const { cookie } = await loginCookie(auth, user.id);
    const unprefixed = cookie.replace("__Host-", "");
    expect(await whoami(makeApi(auth), { cookie: unprefixed })).toEqual({ kind: "anonymous" });
  });

  it("does not accept a cookie signed with another secret (another environment)", async () => {
    const user = await createUser("env@example.test");
    const other = makeAuth({ secret: "a-different-environment-secret-00000000" });
    const { cookie } = await loginCookie(other, user.id);
    expect(await whoami(makeApi(makeAuth()), { cookie })).toEqual({ kind: "anonymous" });
  });
});

describe("origin allow-list", () => {
  it("rejects auth writes from an origin that is not trusted", async () => {
    const user = await createUser("origin@example.test");
    const auth = makeAuth();
    const app = makeApi(auth);
    const { cookie } = await loginCookie(auth, user.id);
    const bad = await app.request("/v1/auth/sign-out", {
      method: "POST",
      headers: { cookie, origin: "https://evil.example", "content-type": "application/json" },
      body: "{}",
    });
    expect(bad.status).toBe(403);
    // staging 与 production 同属一个站点，Origin 必须精确匹配。
    const staging = await app.request("/v1/auth/sign-out", {
      method: "POST",
      headers: { cookie, origin: "https://staging.char.test", "content-type": "application/json" },
      body: "{}",
    });
    expect(staging.status).toBe(403);
    const ok = await app.request("/v1/auth/sign-out", {
      method: "POST",
      headers: { cookie, origin: WEB, "content-type": "application/json" },
      body: "{}",
    });
    expect(ok.status).toBe(200);
    // 登出后旧 cookie 失效。
    expect(await whoami(app, { cookie })).toEqual({ kind: "anonymous" });
  });

  it("Better Auth itself rejects an untrusted origin even without the API middleware", async () => {
    const user = await createUser("origin2@example.test");
    const auth = makeAuth();
    const { cookie } = await loginCookie(auth, user.id);
    const r = await auth.handler(
      new Request(`${BASE_URL}/v1/auth/sign-out`, {
        method: "POST",
        headers: { cookie, origin: "https://evil.example", "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(r.status).toBe(403);
  });
});

describe("banning", () => {
  it("revokes all sessions and tokens at once and writes an audit record", async () => {
    const user = await createUser("mallory@example.test", "Mallory");
    const auth = makeAuth();
    const app = makeApi(auth);
    const a = await loginCookie(auth, user.id);
    const b = await loginCookie(auth, user.id);
    const token = generateToken();
    await t.app.db.insert(s.apiTokens).values({
      id: "0192a6a0-0000-7000-8000-000000000001",
      userId: user.id,
      name: "cli",
      prefix: displayPrefix(token),
      tokenHash: hashToken(token),
      scopes: ["creations:read"],
    });
    const bearer = { authorization: `Bearer ${token}` };
    expect((await whoami(app, bearer)).kind).toBe("user");
    expect((await whoami(app, { cookie: a.cookie })).kind).toBe("user");

    const now = new Date();
    const result = await banUser(t.app.db, {
      userId: user.id,
      reason: "spam campaign",
      actor: { kind: "staff", id: "staff-1" },
      now,
    });
    expect(result).toEqual({ sessionsRevoked: 2, tokensRevoked: 1 });

    expect(await whoami(app, { cookie: a.cookie })).toEqual({ kind: "anonymous" });
    expect(await whoami(app, { cookie: b.cookie })).toEqual({ kind: "anonymous" });
    const r = await app.request("/whoami", { headers: bearer });
    expect(r.status).toBe(401);

    const audit = await t.app.db.select().from(s.auditLog).where(eq(s.auditLog.action, "user.ban"));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.subject).toBe(`user:${user.id}`);
    expect(audit[0]?.after).toMatchObject({
      reason: "spam campaign",
      sessions_revoked: 2,
      tokens_revoked: 1,
    });
    expect((await verifyAuditChain(t.app.db)).ok).toBe(true);
  });

  it("prevents banned users from creating new sessions until unbanned", async () => {
    const user = await createUser("banned@example.test");
    await banUser(t.app.db, {
      userId: user.id,
      reason: "abuse",
      actor: { kind: "staff", id: "staff-1" },
      now: new Date(),
    });
    const auth = makeAuth();
    await expect(loginCookie(auth, user.id)).rejects.toThrow();
    await unbanUser(t.app.db, {
      userId: user.id,
      reason: "appeal accepted",
      actor: { kind: "staff", id: "staff-1" },
      now: new Date(),
    });
    const { cookie } = await loginCookie(auth, user.id);
    expect((await whoami(makeApi(auth), { cookie })).kind).toBe("user");
  });

  it("lets a temporary ban expire", async () => {
    const user = await createUser("temp@example.test");
    await banUser(t.app.db, {
      userId: user.id,
      reason: "cool down",
      until: new Date(Date.now() - 1000),
      actor: { kind: "staff", id: "staff-1" },
      now: new Date(),
    });
    const auth = makeAuth();
    const { cookie } = await loginCookie(auth, user.id);
    // 封禁已过期：可以建立会话，也按正常用户处理。
    const p = await whoami(makeApi(auth), { cookie });
    expect(p).toEqual({ kind: "user", user_id: user.id, banned: false });
  });

  it("requires a reason and an existing user", async () => {
    await expect(
      banUser(t.app.db, {
        userId: "0192a6a0-0000-7000-8000-00000000dead",
        reason: "x",
        actor: { kind: "staff", id: "s" },
        now: new Date(),
      }),
    ).rejects.toThrow(/not found/);
    const user = await createUser("reason@example.test");
    await expect(
      banUser(t.app.db, {
        userId: user.id,
        reason: "  ",
        actor: { kind: "staff", id: "s" },
        now: new Date(),
      }),
    ).rejects.toThrow(/reason/);
  });
});

describe("GitHub OAuth", () => {
  /** 模拟 GitHub 的 token 与用户信息端点；其他请求交给真实 fetch（本测试不应发生）。 */
  function stubGitHub(profile: { id: number; login: string; email: string; name?: string }) {
    const real = globalThis.fetch;
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      if (url.startsWith("https://github.com/login/oauth/access_token")) {
        return Response.json({
          access_token: "gho_test",
          token_type: "bearer",
          scope: "read:user,user:email",
        });
      }
      if (url === "https://api.github.com/user") {
        return Response.json({ ...profile, avatar_url: "https://avatars.example/u.png" });
      }
      if (url === "https://api.github.com/user/emails") {
        return Response.json([{ email: profile.email, primary: true, verified: true }]);
      }
      return real(input, init);
    });
    return calls;
  }

  function cookiesFrom(res: Response): string {
    return res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
  }

  it("signs in with GitHub: creates a UUIDv7 user, records the external identity and sets the session cookie", async () => {
    const auth = makeAuth();
    const app = makeApi(auth);
    const calls = stubGitHub({
      id: 987654321,
      login: "octo",
      email: "octo@example.test",
      name: "Octo",
    });

    const start = await app.request("/v1/auth/sign-in/social", {
      method: "POST",
      headers: { origin: WEB, "content-type": "application/json" },
      body: JSON.stringify({ provider: "github", callbackURL: `${WEB}/welcome` }),
    });
    expect(start.status).toBe(200);
    const { url } = (await start.json()) as { url: string };
    const authorize = new URL(url);
    expect(authorize.origin + authorize.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${BASE_URL}/v1/auth/callback/github`);
    const state = authorize.searchParams.get("state");
    expect(state).toBeTruthy();
    const stateCookie = cookiesFrom(start);
    expect(stateCookie).toContain("__Host-charpub.");

    const cb = await app.request(`/v1/auth/callback/github?code=test-code&state=${state}`, {
      headers: { cookie: stateCookie },
    });
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toBe(`${WEB}/welcome`);
    const setCookie = cb.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    expect(setCookie).toBeDefined();
    expect(setCookie).toMatch(/; Path=\//);
    expect(setCookie).toMatch(/; HttpOnly/);
    expect(setCookie).toMatch(/; Secure/);
    expect(setCookie).toMatch(/; SameSite=Lax/);
    expect(setCookie).not.toMatch(/Domain=/i);
    expect(calls.some((c) => c.startsWith("https://github.com/login/oauth/access_token"))).toBe(
      true,
    );

    const [user] = await t.app.db
      .select()
      .from(s.authUser)
      .where(eq(s.authUser.email, "octo@example.test"));
    expect(user?.id).toMatch(UUID_V7);
    const identities = await t.app.db.execute<{
      user_id: string;
      provider: string;
      provider_subject: string;
    }>(
      sql`SELECT user_id, provider, provider_subject FROM app.external_identities WHERE user_id = ${user?.id}`,
    );
    expect(identities.rows).toEqual([
      { user_id: user?.id, provider: "github", provider_subject: "987654321" },
    ]);
    const [account] = await t.app.db
      .select()
      .from(s.authAccount)
      .where(eq(s.authAccount.userId, user?.id ?? ""));
    // OAuth token 加密存储，数据库里不是明文。
    expect(account?.accessToken).toBeTruthy();
    expect(account?.accessToken).not.toBe("gho_test");

    const sessionCookie = setCookie?.split(";")[0] ?? "";
    expect(await whoami(app, { cookie: sessionCookie })).toEqual({
      kind: "user",
      user_id: user?.id,
      banned: false,
    });

    // 同一个 GitHub 账号再次登录，得到的是同一个用户。
    stubGitHub({ id: 987654321, login: "octo-renamed", email: "octo@example.test" });
    const again = await app.request("/v1/auth/sign-in/social", {
      method: "POST",
      headers: { origin: WEB, "content-type": "application/json" },
      body: JSON.stringify({ provider: "github", callbackURL: `${WEB}/welcome` }),
    });
    const state2 = new URL(((await again.json()) as { url: string }).url).searchParams.get("state");
    const cb2 = await app.request(`/v1/auth/callback/github?code=c2&state=${state2}`, {
      headers: { cookie: cookiesFrom(again) },
    });
    expect(cb2.status).toBe(302);
    const users = await t.app.db
      .select()
      .from(s.authUser)
      .where(eq(s.authUser.email, "octo@example.test"));
    expect(users).toHaveLength(1);
  });

  it("rejects a callback whose state does not match", async () => {
    const auth = makeAuth();
    const app = makeApi(auth);
    stubGitHub({ id: 1, login: "x", email: "x@example.test" });
    const start = await app.request("/v1/auth/sign-in/social", {
      method: "POST",
      headers: { origin: WEB, "content-type": "application/json" },
      body: JSON.stringify({ provider: "github", callbackURL: `${WEB}/` }),
    });
    const cb = await app.request("/v1/auth/callback/github?code=c&state=not-the-state", {
      headers: { cookie: cookiesFrom(start) },
    });
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toMatch(/error=/);
    expect(
      cb.headers
        .getSetCookie()
        .some((c) => c.startsWith(`${SESSION_COOKIE}=`) && !c.includes("Max-Age=0")),
    ).toBe(false);
  });

  it("rejects a callback URL on an untrusted origin", async () => {
    const app = makeApi(makeAuth());
    const r = await app.request("/v1/auth/sign-in/social", {
      method: "POST",
      headers: { origin: WEB, "content-type": "application/json" },
      body: JSON.stringify({ provider: "github", callbackURL: "https://evil.example/steal" }),
    });
    expect(r.status).toBe(403);
  });

  it("does not offer providers that are not configured", async () => {
    const app = makeApi(makeAuth());
    const r = await app.request("/v1/auth/sign-in/social", {
      method: "POST",
      headers: { origin: WEB, "content-type": "application/json" },
      body: JSON.stringify({ provider: "discord", callbackURL: `${WEB}/` }),
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it("offers no password sign-up", async () => {
    const app = makeApi(makeAuth());
    const r = await app.request("/v1/auth/sign-up/email", {
      method: "POST",
      headers: { origin: WEB, "content-type": "application/json" },
      body: JSON.stringify({ email: "p@example.test", password: "password1234", name: "P" }),
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
    const rows = await t.app.db
      .select()
      .from(s.authUser)
      .where(eq(s.authUser.email, "p@example.test"));
    expect(rows).toHaveLength(0);
  });
});

describe("magic link", () => {
  it("only signs in existing accounts and never creates new ones", async () => {
    const sent: { email: string; url: string }[] = [];
    const auth = makeAuth({ sendMagicLink: async (m) => void sent.push(m) });
    const app = makeApi(auth);
    await createUser("existing@example.test");
    const req = (email: string) =>
      app.request("/v1/auth/sign-in/magic-link", {
        method: "POST",
        headers: { origin: WEB, "content-type": "application/json" },
        body: JSON.stringify({ email, callbackURL: `${WEB}/` }),
      });
    expect((await req("existing@example.test")).status).toBe(200);
    expect(sent).toHaveLength(1);
    const link = new URL(sent[0]?.url ?? "");
    const verify = await app.request(`${link.pathname}${link.search}`);
    expect(verify.status).toBe(302);
    expect(verify.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(
      true,
    );

    await req("newcomer@example.test");
    const link2 = sent[1] ? new URL(sent[1].url) : undefined;
    if (link2) await app.request(`${link2.pathname}${link2.search}`);
    const rows = await t.app.db
      .select()
      .from(s.authUser)
      .where(eq(s.authUser.email, "newcomer@example.test"));
    expect(rows).toHaveLength(0);
  });
});

describe("rate limiting", () => {
  it("stores counters in the database and limits sign-in attempts per client", async () => {
    const auth = makeAuth({ rateLimit: true });
    const app = makeApi(auth);
    const attempt = () =>
      app.request("/v1/auth/sign-in/social", {
        method: "POST",
        headers: {
          origin: WEB,
          "content-type": "application/json",
          "cf-connecting-ip": "203.0.113.7",
        },
        body: JSON.stringify({ provider: "github", callbackURL: `${WEB}/` }),
      });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await attempt()).status);
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses.at(-1)).toBe(429);
    const rows = await t.app.db.select().from(s.authRateLimit);
    expect(rows.some((r) => r.key.includes("203.0.113.7"))).toBe(true);
  });
});
