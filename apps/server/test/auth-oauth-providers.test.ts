/**
 * Discord 与 Google 登录的完整回调流程。两个提供方的授权、token 与用户信息端点按各自的真实协议
 * 伪造：Discord 用授权码换 access token 再读 `/users/@me`；Google 使用 PKCE，token 端点返回
 * RS256 签名的 id_token，签名密钥在测试运行时生成，并通过伪造的 JWKS 端点公布。
 *
 * 覆盖：建号与外部身份记录、`__Host-` 会话 cookie、被封禁的账号不能登录、同邮箱不会被隐式
 * 关联到已有账号。
 */
import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Env, Services } from "../src/api/app.js";
import { createApi } from "../src/api/server.js";
import { banUser } from "../src/auth/ban.js";
import { createAuth, SESSION_COOKIE, sessionPrincipalResolver } from "../src/auth/better-auth.js";
import type { Principal } from "../src/authz/authorize.js";
import * as s from "../src/db/schema/index.js";
import { createTestDatabase, type TestDatabase } from "./helpers.js";

const BASE_URL = "https://api.char.test";
const WEB = "https://www.char.test";
const SECRET = "test-only-auth-secret-0123456789abcdef";
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CLIENTS = {
  github: { clientId: "gh-client", clientSecret: "gh-secret" },
  discord: { clientId: "discord-client", clientSecret: "discord-secret" },
  google: { clientId: "google-client.apps.googleusercontent.com", clientSecret: "google-secret" },
};

type Provider = "discord" | "google";
interface Profile {
  subject: string;
  email: string;
  name: string;
  emailVerified?: boolean;
}

let t: TestDatabase;
let googleKey: Awaited<ReturnType<typeof generateKeyPair>>;
let googleJwk: Record<string, unknown>;

beforeAll(async () => {
  t = await createTestDatabase();
  googleKey = await generateKeyPair("RS256", { extractable: true });
  googleJwk = { ...(await exportJWK(googleKey.publicKey)), kid: "google-test", alg: "RS256" };
});

afterAll(async () => {
  await t.drop();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeApi() {
  const auth = createAuth({
    db: t.app.db,
    secret: SECRET,
    baseURL: BASE_URL,
    trustedOrigins: [WEB],
    providers: CLIENTS,
    rateLimit: false,
  });
  const services = {
    db: t.app.db,
    clock: { now: () => new Date() },
    ids: { uuid: () => "req-00000000" },
    flags: async () => new Set(),
  } as unknown as Services;
  const echo = (app: Hono<Env>) => {
    // 测试专用：直接回显 principal。
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

function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

async function formOf(input: RequestInfo | URL, init?: RequestInit): Promise<URLSearchParams> {
  const body = input instanceof Request ? await input.text() : String(init?.body ?? "");
  return new URLSearchParams(body);
}

function headerOf(input: RequestInfo | URL, init: RequestInit | undefined, name: string) {
  if (input instanceof Request) return input.headers.get(name);
  return new Headers(init?.headers).get(name);
}

/** 客户端认证可以放在表单里，也可以用 HTTP Basic；两种都按 OAuth 2.0 的规则核对。 */
function clientAuthenticated(
  form: URLSearchParams,
  basic: string | null,
  client: typeof CLIENTS.discord,
) {
  if (
    form.get("client_id") === client.clientId &&
    form.get("client_secret") === client.clientSecret
  )
    return true;
  if (!basic?.startsWith("Basic ")) return false;
  const [id, secret] = Buffer.from(basic.slice(6), "base64").toString().split(":");
  return (
    decodeURIComponent(id ?? "") === client.clientId &&
    decodeURIComponent(secret ?? "") === client.clientSecret
  );
}

/**
 * 伪造一个提供方：记录签发的授权码，token 端点只接受一次、且必须带正确的 redirect_uri、客户端
 * 凭证（Google 还要求 PKCE 的 code_verifier）；用户信息只对签发过的 access token 返回。
 */
function stubProvider(provider: Provider, profile: Profile) {
  const real = globalThis.fetch;
  const codes = new Map<string, { redirectUri: string; challenge: string | null }>();
  const tokens = new Set<string>();
  const issue = (authorizeUrl: string) => {
    const u = new URL(authorizeUrl);
    const code = randomUUID();
    codes.set(code, {
      redirectUri: u.searchParams.get("redirect_uri") ?? "",
      challenge: u.searchParams.get("code_challenge"),
    });
    return code;
  };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input).replace("/users/%40me", "/users/@me");
    if (provider === "discord" && url === "https://discord.com/api/oauth2/token") {
      const form = await formOf(input, init);
      const grant = codes.get(form.get("code") ?? "");
      codes.delete(form.get("code") ?? "");
      if (
        form.get("grant_type") !== "authorization_code" ||
        !grant ||
        grant.redirectUri !== form.get("redirect_uri") ||
        !clientAuthenticated(form, headerOf(input, init, "authorization"), CLIENTS.discord)
      ) {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      const access = `discord-at-${randomUUID()}`;
      tokens.add(access);
      return Response.json({
        access_token: access,
        token_type: "Bearer",
        expires_in: 604800,
        refresh_token: `discord-rt-${randomUUID()}`,
        scope: "identify email",
      });
    }
    if (provider === "discord" && url === "https://discord.com/api/users/@me") {
      const auth = headerOf(input, init, "authorization") ?? "";
      if (!tokens.has(auth.replace(/^Bearer /, ""))) return new Response(null, { status: 401 });
      return Response.json({
        id: profile.subject,
        username: profile.name.toLowerCase(),
        global_name: profile.name,
        discriminator: "0",
        avatar: null,
        email: profile.email,
        verified: profile.emailVerified ?? true,
      });
    }
    if (provider === "google" && url === "https://oauth2.googleapis.com/token") {
      const form = await formOf(input, init);
      const grant = codes.get(form.get("code") ?? "");
      codes.delete(form.get("code") ?? "");
      const verifier = form.get("code_verifier") ?? "";
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      if (
        form.get("grant_type") !== "authorization_code" ||
        !grant ||
        grant.redirectUri !== form.get("redirect_uri") ||
        !verifier ||
        grant.challenge !== challenge ||
        !clientAuthenticated(form, headerOf(input, init, "authorization"), CLIENTS.google)
      ) {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      const now = Math.floor(Date.now() / 1000);
      const idToken = await new SignJWT({
        email: profile.email,
        email_verified: profile.emailVerified ?? true,
        name: profile.name,
        picture: "https://lh3.googleusercontent.example/a/photo",
      })
        .setProtectedHeader({ alg: "RS256", kid: "google-test", typ: "JWT" })
        .setIssuer("https://accounts.google.com")
        .setAudience(CLIENTS.google.clientId)
        .setSubject(profile.subject)
        .setIssuedAt(now)
        .setExpirationTime(now + 3600)
        .sign(googleKey.privateKey);
      return Response.json({
        access_token: `ya29.${randomUUID()}`,
        expires_in: 3599,
        token_type: "Bearer",
        scope:
          "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
        id_token: idToken,
      });
    }
    if (provider === "google" && url === "https://www.googleapis.com/oauth2/v3/certs") {
      return Response.json({ keys: [googleJwk] });
    }
    return real(input, init);
  });
  return { issue };
}

function cookiesFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

/** 走一遍“开始登录 → 提供方授权 → 回调”，返回回调响应。 */
async function signIn(app: Hono<Env>, provider: Provider, profile: Profile) {
  const fake = stubProvider(provider, profile);
  const start = await app.request("/v1/auth/sign-in/social", {
    method: "POST",
    headers: { origin: WEB, "content-type": "application/json" },
    body: JSON.stringify({ provider, callbackURL: `${WEB}/welcome` }),
  });
  expect(start.status).toBe(200);
  const authorizeUrl = ((await start.json()) as { url: string }).url;
  const authorize = new URL(authorizeUrl);
  const state = authorize.searchParams.get("state");
  const code = fake.issue(authorizeUrl);
  const callback = await app.request(
    `/v1/auth/callback/${provider}?code=${encodeURIComponent(code)}&state=${state}`,
    { headers: { cookie: cookiesFrom(start) } },
  );
  return { authorize, callback };
}

function sessionCookieOf(res: Response): string | undefined {
  return res.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`) && !/Max-Age=0/i.test(c));
}

async function whoami(app: Hono<Env>, cookie: string): Promise<Principal> {
  const r = await app.request("/whoami", { headers: { cookie } });
  return (await r.json()) as Principal;
}

async function identitiesOf(userId: string) {
  const r = await t.app.db.execute<{ provider: string; provider_subject: string }>(
    sql`SELECT provider, provider_subject FROM app.external_identities WHERE user_id = ${userId} ORDER BY provider`,
  );
  return r.rows;
}

const AUTHORIZE_ENDPOINT: Record<Provider, string> = {
  discord: "https://discord.com/api/oauth2/authorize",
  google: "https://accounts.google.com/o/oauth2/v2/auth",
};

describe.each(["discord", "google"] as const)("%s sign-in", (provider) => {
  it("creates a user, records the external identity and sets the __Host- session cookie", async () => {
    const app = makeApi();
    const profile = {
      subject: provider === "discord" ? "80351110224678912" : "110169484474386276334",
      email: `${provider}-user@example.test`,
      name: provider === "discord" ? "Nelly" : "Grace",
    };
    const { authorize, callback } = await signIn(app, provider, profile);
    expect(authorize.origin + authorize.pathname).toBe(AUTHORIZE_ENDPOINT[provider]);
    expect(authorize.searchParams.get("redirect_uri")).toBe(
      `${BASE_URL}/v1/auth/callback/${provider}`,
    );
    if (provider === "google")
      expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");

    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(`${WEB}/welcome`);
    const setCookie = sessionCookieOf(callback);
    expect(setCookie).toBeDefined();
    expect(setCookie).toMatch(/; Path=\//);
    expect(setCookie).toMatch(/; HttpOnly/);
    expect(setCookie).toMatch(/; Secure/);
    expect(setCookie).toMatch(/; SameSite=Lax/);
    expect(setCookie).not.toMatch(/Domain=/i);

    const [user] = await t.app.db
      .select()
      .from(s.authUser)
      .where(eq(s.authUser.email, profile.email));
    expect(user?.id).toMatch(UUID_V7);
    expect(await identitiesOf(user?.id ?? "")).toEqual([
      { provider, provider_subject: profile.subject },
    ]);
    const [account] = await t.app.db
      .select()
      .from(s.authAccount)
      .where(eq(s.authAccount.userId, user?.id ?? ""));
    expect(account?.accessToken).toBeTruthy();
    expect(account?.accessToken).not.toMatch(/^(discord-at-|ya29\.)/);
    expect(await whoami(app, setCookie?.split(";")[0] ?? "")).toEqual({
      kind: "user",
      user_id: user?.id,
      banned: false,
    });

    // 同一个第三方账号再次登录，得到同一个用户。
    const again = await signIn(app, provider, { ...profile, name: `${profile.name} Renamed` });
    expect(again.callback.status).toBe(302);
    expect(
      await t.app.db.select().from(s.authUser).where(eq(s.authUser.email, profile.email)),
    ).toHaveLength(1);
  });

  it("a banned account cannot sign in", async () => {
    const app = makeApi();
    const profile = {
      subject: provider === "discord" ? "90351110224678913" : "210169484474386276335",
      email: `${provider}-banned@example.test`,
      name: "Mallory",
    };
    expect((await signIn(app, provider, profile)).callback.status).toBe(302);
    const [user] = await t.app.db
      .select()
      .from(s.authUser)
      .where(eq(s.authUser.email, profile.email));
    await banUser(t.app.db, {
      userId: user?.id ?? "",
      reason: "abuse",
      actor: { kind: "staff", id: "staff-1" },
      now: new Date(),
    });
    const { callback } = await signIn(app, provider, profile);
    expect(sessionCookieOf(callback)).toBeUndefined();
    const sessions = await t.app.db
      .select()
      .from(s.authSession)
      .where(eq(s.authSession.userId, user?.id ?? ""));
    expect(sessions).toHaveLength(0);
  });

  it("does not link a new provider to an existing account with the same email", async () => {
    const app = makeApi();
    const email = `${provider}-victim@example.test`;
    // 已有账号：邮箱已验证，只用 GitHub 登录过。
    const ctx = await createAuth({
      db: t.app.db,
      secret: SECRET,
      baseURL: BASE_URL,
      trustedOrigins: [WEB],
      providers: CLIENTS,
      rateLimit: false,
    }).$context;
    const victim = await ctx.internalAdapter.createUser(
      { email, name: "Victim", emailVerified: true },
      { method: "admin" },
    );
    const githubId = provider === "discord" ? "4242" : "4343";
    await ctx.internalAdapter.linkAccount({
      userId: victim.id,
      providerId: "github",
      accountId: githubId,
    });

    // 另一个人控制了同邮箱的第三方账号（提供方也声称邮箱已验证）。
    const { callback } = await signIn(app, provider, {
      subject: provider === "discord" ? "99999999999999999" : "999999999999999999999",
      email,
      name: "Attacker",
      emailVerified: true,
    });
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toMatch(/error=account_not_linked/);
    expect(sessionCookieOf(callback)).toBeUndefined();
    expect(await identitiesOf(victim.id)).toEqual([
      { provider: "github", provider_subject: githubId },
    ]);
    expect(
      await t.app.db.select().from(s.authUser).where(eq(s.authUser.email, email)),
    ).toHaveLength(1);
  });
});
