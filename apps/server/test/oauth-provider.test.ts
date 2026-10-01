import { createHash, randomUUID } from "node:crypto";
import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuth, SESSION_COOKIE, sessionPrincipalResolver } from "../src/auth/better-auth.js";
import { createOAuthService } from "../src/auth/oauth.js";
import * as s from "../src/db/schema/index.js";
import { createTestDatabase, type TestDatabase } from "./helpers.js";

const API = "https://api.char.test";
const WEB = "https://www.char.test";
const REDIRECT = "https://runtime.test/callback";
const VERIFIER = "a".repeat(64);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
let t: TestDatabase;
let auth: ReturnType<typeof createAuth>;
let oauth: ReturnType<typeof createOAuthService>;
beforeAll(async () => {
  t = await createTestDatabase();
  auth = createAuth({
    db: t.app.db,
    secret: "oauth-test-secret-at-least-32-characters",
    baseURL: API,
    trustedOrigins: [WEB],
    providers: {},
    rateLimit: false,
  });
  oauth = createOAuthService(auth, t.app.db);
});
afterAll(async () => t.drop());

function required(value: string | null): string {
  if (!value) throw new Error("Missing expected protocol value");
  return value;
}

async function actor() {
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser(
    { email: `${randomUUID()}@test.invalid`, name: "Secret Real Name", emailVerified: true },
    { method: "admin" },
  );
  const session = await ctx.internalAdapter.createSession(user.id);
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(`${session.token}.${await makeSignature(session.token, ctx.secret)}`)}`;
  return { user, headers: new Headers({ cookie, origin: WEB }) };
}
async function client(headers: Headers, redirect = REDIRECT) {
  return oauth.createClient(headers, { name: "Test Runtime", redirect_uris: [redirect] });
}
async function authorize(headers: Headers, clientId: string, extra: Record<string, string> = {}) {
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: "profile creations:read offline_access",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "client-state",
    ...extra,
  });
  return oauth.handler(new Request(`${API}/v1/auth/oauth2/authorize?${query}`, { headers }));
}
async function code(headers: Headers, clientId: string) {
  const response = await authorize(headers, clientId);
  expect(response.status).toBe(302);
  const location = new URL(required(response.headers.get("location")));
  if (location.origin === new URL(REDIRECT).origin)
    return required(location.searchParams.get("code"));
  expect(location.pathname).toBe("/oauth/consent");
  const query = location.search.slice(1);
  const detail = await oauth.consentDetails(headers, query);
  expect(detail).toMatchObject({
    client_id: clientId,
    client_name: "Test Runtime",
    redirect_uri: REDIRECT,
  });
  expect(JSON.stringify(detail)).not.toContain("Secret Real Name");
  const result = await oauth.consent(headers, { oauth_query: query, accept: true });
  return required(new URL(result.redirect_uri).searchParams.get("code"));
}
async function token(clientId: string, body: Record<string, string>) {
  return oauth.handler(
    new Request(`${API}/v1/auth/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, ...body }),
    }),
  );
}
async function grant() {
  const who = await actor();
  const app = await client(who.headers);
  const authCode = await code(who.headers, app.client_id);
  const response = await token(app.client_id, {
    grant_type: "authorization_code",
    code: authCode,
    code_verifier: VERIFIER,
    redirect_uri: REDIRECT,
  });
  expect(response.status).toBe(200);
  const tokens = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  return { who, app, tokens };
}
function bearer(access: string) {
  return new Request(API, { headers: { authorization: `Bearer ${access}` } });
}

describe("public OAuth provider", () => {
  it("uses opaque one-hour access tokens, hashed storage, scoped principals and no first-party session", async () => {
    const { who, app, tokens } = await grant();
    expect(tokens.expires_in).toBe(3600);
    expect(tokens.access_token).toMatch(/^cp_oauth_/);
    expect(tokens.refresh_token).toBeTruthy();
    const principal = await oauth.resolvePrincipal(bearer(tokens.access_token));
    expect(principal).toMatchObject({
      kind: "user",
      user_id: who.user.id,
      scopes: ["profile", "creations:read"],
      oauth: { client_id: app.client_id },
    });
    expect(await sessionPrincipalResolver(auth)(bearer(tokens.access_token))).toBeNull();
    const stored = await t.app.db
      .select()
      .from(s.oauthAccessToken)
      .where(eq(s.oauthAccessToken.clientId, app.client_id));
    expect(stored).toHaveLength(1);
    expect(stored[0]?.token).not.toBe(tokens.access_token);
    expect(await oauth.listGrants(who.headers)).toEqual([
      expect.objectContaining({ client_id: app.client_id }),
    ]);
  });

  it("requires exact redirects and S256; disallows unknown scopes and client credentials", async () => {
    const who = await actor();
    const app = await client(who.headers);
    expect(
      (await authorize(who.headers, app.client_id, { redirect_uri: `${REDIRECT}/different` }))
        .status,
    ).toBe(400);
    for (const extra of [
      { code_challenge_method: "plain" },
      { scope: "openid email" },
      { scope: "creations:publish" },
    ]) {
      const response = await authorize(who.headers, app.client_id, extra);
      expect(
        response.status === 400 ||
          new URL(required(response.headers.get("location"))).searchParams.has("error"),
      ).toBe(true);
    }
    expect((await token(app.client_id, { grant_type: "client_credentials" })).status).toBe(400);
    await expect(client(who.headers, "https://runtime.test/*")).rejects.toThrow();
    const native = await client(who.headers, "http://127.0.0.1:3000/callback");
    expect(
      (
        await authorize(who.headers, native.client_id, {
          redirect_uri: "http://127.0.0.1:3001/callback",
        })
      ).status,
    ).toBe(400);
  });

  it("validates signed consent details and denial without trusting display query", async () => {
    const who = await actor();
    const app = await client(who.headers);
    const res = await authorize(who.headers, app.client_id);
    const query = new URL(required(res.headers.get("location"))).search.slice(1);
    await expect(
      oauth.consentDetails(who.headers, query.replace("profile", "openid")),
    ).rejects.toThrow();
    const denied = await oauth.consent(who.headers, { oauth_query: query, accept: false });
    expect(new URL(denied.redirect_uri).searchParams.get("error")).toBe("access_denied");
    expect(await oauth.listGrants(who.headers)).toEqual([]);
  });

  it("consumes an authorization code once even under concurrent requests", async () => {
    const who = await actor();
    const app = await client(who.headers);
    const value = await code(who.headers, app.client_id);
    const body = {
      grant_type: "authorization_code",
      code: value,
      code_verifier: VERIFIER,
      redirect_uri: REDIRECT,
    };
    const results = await Promise.all([token(app.client_id, body), token(app.client_id, body)]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  });

  it("rotates refresh tokens and rejects replay, invalidating the family", async () => {
    const { app, tokens } = await grant();
    const refreshed = await token(app.client_id, {
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    });
    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()) as typeof tokens;
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    const replay = await token(app.client_id, {
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    });
    expect(replay.status).toBe(400);
    expect(await oauth.resolvePrincipal(bearer(next.access_token))).toBeNull();
  });

  it("serializes concurrent refreshes; the losing replay invalidates the winning family", async () => {
    const { app, tokens } = await grant();
    const body = { grant_type: "refresh_token", refresh_token: tokens.refresh_token };
    const responses = await Promise.all([token(app.client_id, body), token(app.client_id, body)]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 400]);
    for (const response of responses)
      if (response.ok) {
        const next = (await response.json()) as typeof tokens;
        expect(await oauth.resolvePrincipal(bearer(next.access_token))).toBeNull();
        expect(
          (
            await token(app.client_id, {
              grant_type: "refresh_token",
              refresh_token: next.refresh_token,
            })
          ).status,
        ).toBe(400);
      }
  });

  it("revokes an unexchanged authorization code and supports protocol refresh revocation", async () => {
    const { who, app, tokens } = await grant();
    const pending = await code(who.headers, app.client_id);
    await oauth.revokeGrant(who.headers, app.client_id);
    expect(
      (
        await token(app.client_id, {
          grant_type: "authorization_code",
          code: pending,
          code_verifier: VERIFIER,
          redirect_uri: REDIRECT,
        })
      ).status,
    ).toBe(400);
    const nextGrant = await grant();
    const revoked = await oauth.handler(
      new Request(`${API}/v1/auth/oauth2/revoke`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: nextGrant.app.client_id,
          token: nextGrant.tokens.refresh_token,
          token_type_hint: "refresh_token",
        }),
      }),
    );
    expect(revoked.status).toBe(200);
    expect(await oauth.resolvePrincipal(bearer(nextGrant.tokens.access_token))).toBeNull();
    expect(await oauth.resolvePrincipal(bearer(tokens.access_token))).toBeNull();
  });

  it("continues a signed login request through a newly established first-party session", async () => {
    const owner = await actor();
    const app = await client(owner.headers);
    const beforeLogin = await authorize(new Headers(), app.client_id, { prompt: "login consent" });
    expect(beforeLogin.status).toBe(302);
    const query = new URL(required(beforeLogin.headers.get("location"))).search.slice(1);
    const newlyLoggedIn = await actor();
    const details = await oauth.consentDetails(newlyLoggedIn.headers, query);
    expect(details.client_id).toBe(app.client_id);
    const accepted = await oauth.consent(newlyLoggedIn.headers, {
      oauth_query: query,
      accept: true,
    });
    const location = new URL(accepted.redirect_uri);
    expect(location.origin).toBe(new URL(REDIRECT).origin);
    expect(location.searchParams.get("code")).toBeTruthy();
  });

  it("does not resurrect tokens when a refresh races connected-app revocation", async () => {
    const { who, app, tokens } = await grant();
    const [response] = await Promise.all([
      token(app.client_id, { grant_type: "refresh_token", refresh_token: tokens.refresh_token }),
      oauth.revokeGrant(who.headers, app.client_id),
    ]);
    expect(await oauth.resolvePrincipal(bearer(tokens.access_token))).toBeNull();
    if (response.ok) {
      const next = (await response.json()) as typeof tokens;
      expect(await oauth.resolvePrincipal(bearer(next.access_token))).toBeNull();
      expect(
        (
          await token(app.client_id, {
            grant_type: "refresh_token",
            refresh_token: next.refresh_token,
          })
        ).status,
      ).toBe(400);
    }
    expect(await oauth.listGrants(who.headers)).toEqual([]);
  });

  it("only exposes audited protocol endpoints and OAuth metadata without OIDC profile disclosure", async () => {
    const { tokens } = await grant();
    for (const path of [
      "register",
      "create-client",
      "update-client",
      "rotate-client-secret",
      "userinfo",
      "get-consents",
      "introspect",
      "consent",
    ]) {
      expect(
        (
          await oauth.handler(
            new Request(`${API}/v1/auth/oauth2/${path}`, {
              headers: { authorization: `Bearer ${tokens.access_token}` },
            }),
          )
        ).status,
      ).toBe(404);
    }
    const metadata = await oauth.metadata();
    expect(metadata.scopes_supported).not.toContain("openid");
    expect(metadata.scopes_supported).not.toContain("email");
    expect(metadata.token_endpoint_auth_methods_supported).toEqual(["none"]);
    expect(metadata.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
  });

  it("checks ownership for management and live bans for issued access and refresh", async () => {
    const { who, app, tokens } = await grant();
    const other = await actor();
    await expect(oauth.deleteClient(other.headers, app.client_id)).rejects.toThrow();
    expect(await oauth.listClients(other.headers)).toEqual([]);
    await t.app.db.update(s.authUser).set({ banned: true }).where(eq(s.authUser.id, who.user.id));
    expect(await oauth.resolvePrincipal(bearer(tokens.access_token))).toBeNull();
    expect(
      (
        await token(app.client_id, {
          grant_type: "refresh_token",
          refresh_token: tokens.refresh_token,
        })
      ).status,
    ).toBe(400);
  });

  it("rejects expired tokens, wrong PKCE, scope escalation and altered lock identities", async () => {
    const { who, app, tokens } = await grant();
    const wrongCode = await code(who.headers, app.client_id);
    expect(
      (
        await token(app.client_id, {
          grant_type: "authorization_code",
          code: wrongCode,
          code_verifier: "b".repeat(64),
          redirect_uri: REDIRECT,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await token(app.client_id, {
          grant_type: "refresh_token",
          refresh_token: tokens.refresh_token,
          scope: "creations:publish",
        })
      ).status,
    ).toBe(400);
    const repeated = new URLSearchParams({
      client_id: app.client_id,
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    });
    repeated.append("client_id", "another-client");
    expect(
      (
        await oauth.handler(
          new Request(`${API}/v1/auth/oauth2/token`, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: repeated,
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await oauth.handler(new Request(`${API}/v1/auth/%6fauth2/token`, { method: "POST" })))
        .status,
    ).toBe(404);
    const bearerWithCookie = new Headers(who.headers);
    bearerWithCookie.set("authorization", `Bearer ${tokens.access_token}`);
    expect(
      (
        await oauth.handler(
          new Request(`${API}/v1/auth/get-session`, { headers: bearerWithCookie }),
        )
      ).status,
    ).toBe(401);
    await t.app.db
      .update(s.oauthAccessToken)
      .set({ expiresAt: new Date(0) })
      .where(eq(s.oauthAccessToken.clientId, app.client_id));
    expect(await oauth.resolvePrincipal(bearer(tokens.access_token))).toBeNull();
    await oauth.deleteClient(who.headers, app.client_id);
    expect(
      (
        await token(app.client_id, {
          grant_type: "refresh_token",
          refresh_token: tokens.refresh_token,
        })
      ).status,
    ).toBe(401);
  });
});
