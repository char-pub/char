import { APIError, isAPIError } from "better-auth/api";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Principal, Scope } from "../authz/authorize.js";
import type { Db } from "../db/client.js";
import * as s from "../db/schema/index.js";
import {
  AUTH_BASE_PATH,
  type Auth,
  isBanned,
  sessionHeaders,
  transactionalAuth,
} from "./better-auth.js";
import { OAUTH_SCOPES, OAUTH_TOKEN_PREFIX } from "./oauth-provider.js";

export interface OAuthClientSummary {
  client_id: string;
  name: string;
  redirect_uris: string[];
  created_at: string | null;
}
export interface OAuthGrantSummary {
  client_id: string;
  name: string;
  scopes: string[];
  created_at: string;
}
export interface OAuthConsentDetails {
  client_id: string;
  client_name: string;
  redirect_uri: string;
  scopes: string[];
}
export interface OAuthClientInput {
  name: string;
  redirect_uris: string[];
}

const authorizationRecord = z.object({
  type: z.literal("authorization_code"),
  userId: z.string(),
  query: z.object({ client_id: z.string(), scope: z.string() }),
});
const clientInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    redirect_uris: z.array(z.string().url().max(2048)).min(1).max(10),
  })
  .strict();
const failure = (error: string, status = 400) =>
  Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
function summary(c: typeof s.oauthClient.$inferSelect): OAuthClientSummary {
  return {
    client_id: c.clientId,
    name: c.name ?? c.clientId,
    redirect_uris: c.redirectUris,
    created_at: c.createdAt?.toISOString() ?? null,
  };
}

/** Exact redirect registration: HTTPS or explicitly registered HTTP loopback only. */
function registration(input: OAuthClientInput) {
  const parsed = clientInput.parse(input);
  for (const uri of parsed.redirect_uris) {
    const u = new URL(uri);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    if (
      u.hash ||
      u.username ||
      u.password ||
      uri.includes("*") ||
      (u.protocol !== "https:" && !(u.protocol === "http:" && loopback))
    )
      throw new APIError("BAD_REQUEST", {
        message:
          "Redirect URI must be exact HTTPS or HTTP loopback, without fragment or credentials",
      });
    if (loopback && u.protocol !== "http:")
      throw new APIError("BAD_REQUEST", { message: "Loopback redirect requires HTTP" });
  }
  const native = parsed.redirect_uris.some((u) => new URL(u).protocol === "http:");
  return { parsed, native };
}

/** All OAuth protocol mutations share a cross-process client lock and adapter transaction. */
export function createOAuthService(auth: Auth, db: Db) {
  async function locked<T>(
    clientId: string,
    fn: (bound: Auth, tx: Parameters<Parameters<Db["transaction"]>[0]>[0]) => Promise<T>,
  ): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`charpub:oauth:${clientId}`}, 0))`,
      );
      return fn(transactionalAuth(auth, tx), tx);
    });
  }
  async function session(headers: Headers, bound = auth) {
    const result = await bound.api.getSession({
      headers: sessionHeaders(headers),
      query: { disableCookieCache: true },
    });
    if (!result || isBanned(result.user as Parameters<typeof isBanned>[0], new Date()))
      throw new APIError("UNAUTHORIZED");
    return result;
  }
  async function details(
    headers: Headers,
    oauthQuery: string,
    bound = auth,
  ): Promise<OAuthConsentDetails> {
    await session(headers, bound);
    return bound.api.charpubOAuthConsentDetails({
      headers: sessionHeaders(headers),
      body: { oauth_query: oauthQuery },
    });
  }
  return {
    /** This wrapper, never bare auth.handler, is the public authentication handler. */
    async handler(req: Request): Promise<Response> {
      const rawPath = new URL(req.url).pathname;
      let path: string;
      try {
        path = decodeURIComponent(rawPath);
      } catch {
        return failure("invalid_request");
      }
      if (path !== rawPath && /\/(?:oauth2|charpub-oauth)\//.test(path))
        return failure("not_found", 404);
      if (
        !path.startsWith(`${AUTH_BASE_PATH}/oauth2/`) &&
        !path.startsWith(`${AUTH_BASE_PATH}/admin/oauth2/`) &&
        !path.startsWith(`${AUTH_BASE_PATH}/charpub-oauth/`)
      ) {
        if (req.headers.has("authorization")) return failure("invalid_token", 401);
        return auth.handler(req);
      }
      if (
        ![
          `${AUTH_BASE_PATH}/oauth2/authorize`,
          `${AUTH_BASE_PATH}/oauth2/token`,
          `${AUTH_BASE_PATH}/oauth2/revoke`,
        ].includes(path)
      )
        return failure("not_found", 404);
      const authorize = path.endsWith("/authorize");
      if (req.method !== (authorize ? "GET" : "POST")) return failure("invalid_request", 405);
      // Only public clients: no Basic/assertion identity competing with body.client_id.
      if (req.headers.has("authorization")) return failure("invalid_client", 401);
      if (
        !authorize &&
        req.headers.get("content-type")?.split(";")[0]?.trim() !==
          "application/x-www-form-urlencoded"
      )
        return failure("invalid_request", 415);
      const params = authorize
        ? new URL(req.url).searchParams
        : new URLSearchParams(await req.clone().text());
      for (const key of new Set(params.keys()))
        if (params.getAll(key).length !== 1) return failure("invalid_request");
      const clientId = params.get("client_id");
      if (
        !clientId ||
        clientId.length > 256 ||
        params.has("client_secret") ||
        params.has("client_assertion") ||
        params.has("resource") ||
        params.has("request") ||
        params.has("request_uri") ||
        params.has("claims") ||
        (params.has("response_mode") && params.get("response_mode") !== "query")
      )
        return failure("invalid_client");
      return locked(clientId, async (bound, tx) => {
        const [client] = await tx
          .select()
          .from(s.oauthClient)
          .where(eq(s.oauthClient.clientId, clientId));
        if (
          !client ||
          client.disabled ||
          client.tokenEndpointAuthMethod !== "none" ||
          client.skipConsent ||
          !client.requirePKCE
        )
          return failure("invalid_client", 401);
        const redirect = params.get("redirect_uri");
        if (
          (authorize && !redirect) ||
          (redirect !== null && !client.redirectUris.includes(redirect))
        )
          return failure("invalid_redirect_uri");
        if (authorize) {
          const current = await bound.api.getSession({
            headers: sessionHeaders(req.headers),
            query: { disableCookieCache: true },
          });
          if (current && isBanned(current.user as Parameters<typeof isBanned>[0], new Date()))
            return failure("access_denied", 403);
        }
        if (params.get("grant_type") === "authorization_code") {
          const key = await bound.api.charpubOAuthTokenKey({
            body: { token: params.get("code") ?? "", type: "authorization_code" },
          });
          const [verification] = await tx
            .select()
            .from(s.authVerification)
            .where(eq(s.authVerification.identifier, key));
          if (verification) {
            const value = authorizationRecord.safeParse(JSON.parse(verification.value));
            if (!value.success || value.data.query.client_id !== clientId)
              return failure("invalid_grant");
            const [user] = await tx
              .select()
              .from(s.authUser)
              .where(eq(s.authUser.id, value.data.userId));
            const [consent] = await tx
              .select()
              .from(s.oauthConsent)
              .where(
                and(
                  eq(s.oauthConsent.clientId, clientId),
                  eq(s.oauthConsent.userId, value.data.userId),
                ),
              );
            if (
              !user ||
              isBanned(user, new Date()) ||
              !consent ||
              !value.data.query.scope.split(" ").every((scope) => consent.scopes.includes(scope))
            )
              return failure("invalid_grant");
          }
        }
        if (params.get("grant_type") === "refresh_token") {
          // The library checks token validity; this additionally checks live account bans.
          const key = await bound.api.charpubOAuthTokenKey({
            body: { token: params.get("refresh_token") ?? "", type: "refresh_token" },
          });
          const users = await tx
            .select({ user: s.authUser })
            .from(s.oauthRefreshToken)
            .innerJoin(s.authUser, eq(s.authUser.id, s.oauthRefreshToken.userId))
            .where(
              and(eq(s.oauthRefreshToken.clientId, clientId), eq(s.oauthRefreshToken.token, key)),
            );
          // Token-specific lookup is performed by the provider; banned users' rows are revoked below.
          for (const { user } of users)
            if (isBanned(user, new Date())) {
              await tx
                .delete(s.oauthAccessToken)
                .where(
                  and(
                    eq(s.oauthAccessToken.clientId, clientId),
                    eq(s.oauthAccessToken.userId, user.id),
                  ),
                );
              await tx
                .delete(s.oauthRefreshToken)
                .where(
                  and(
                    eq(s.oauthRefreshToken.clientId, clientId),
                    eq(s.oauthRefreshToken.userId, user.id),
                  ),
                );
            }
        }
        if (authorize) return bound.handler(req);
        const protocolHeaders = new Headers(req.headers);
        protocolHeaders.delete("cookie");
        return bound.handler(new Request(req, { headers: protocolHeaders }));
      });
    },
    async metadata() {
      const raw = await auth.api.getOAuthServerConfig();
      // Advertise only the protocol surface actually exposed by this wrapper.
      return {
        issuer: raw.issuer,
        authorization_endpoint: raw.authorization_endpoint,
        token_endpoint: raw.token_endpoint,
        revocation_endpoint: raw.revocation_endpoint,
        scopes_supported: [...OAUTH_SCOPES],
        response_types_supported: ["code"],
        response_modes_supported: ["query"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        revocation_endpoint_auth_methods_supported: ["none"],
      };
    },
    async resolvePrincipal(req: Request): Promise<Principal | null> {
      const header = req.headers.get("authorization");
      if (!header?.startsWith(`Bearer ${OAUTH_TOKEN_PREFIX}`)) return null;
      try {
        const token = await auth.api.charpubOAuthVerify({ body: { token: header.slice(7) } });
        const [user] = await db.select().from(s.authUser).where(eq(s.authUser.id, token.user_id));
        if (!user || isBanned(user, new Date())) return null;
        return {
          kind: "user",
          user_id: user.id,
          banned: false,
          scopes: token.scopes.filter(
            (v): v is Scope => v !== "offline_access" && OAUTH_SCOPES.some((s) => s === v),
          ),
          oauth: { client_id: token.client_id, token_id: token.token_id },
        };
      } catch (error) {
        if (isAPIError(error) && (error.statusCode === 400 || error.statusCode === 401))
          return null;
        throw error;
      }
    },
    consentDetails: details,
    async consent(headers: Headers, input: { oauth_query: string; accept: boolean }) {
      const verified = await details(headers, input.oauth_query);
      return locked(verified.client_id, async (bound) => {
        await details(headers, input.oauth_query, bound);
        const ctx = await bound.$context;
        const result = await bound.api.oauth2Consent({
          headers: sessionHeaders(headers),
          body: input,
          asResponse: false,
          request: new Request(`${ctx.baseURL}/oauth2/consent`, {
            method: "POST",
            headers: sessionHeaders(headers),
          }),
        });
        return { redirect_uri: result.url };
      });
    },
    async listClients(headers: Headers): Promise<OAuthClientSummary[]> {
      const who = await session(headers);
      return (
        await db.select().from(s.oauthClient).where(eq(s.oauthClient.userId, who.user.id))
      ).map(summary);
    },
    async createClient(headers: Headers, input: OAuthClientInput): Promise<OAuthClientSummary> {
      await session(headers);
      const { parsed, native } = registration(input);
      const created = await auth.api.adminCreateOAuthClient({
        headers: sessionHeaders(headers),
        body: {
          client_name: parsed.name,
          redirect_uris: parsed.redirect_uris,
          application_type: native ? "native" : "web",
          scope: OAUTH_SCOPES.join(" "),
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          require_pkce: true,
          skip_consent: false,
          enable_end_session: false,
        },
      });
      const [row] = await db
        .select()
        .from(s.oauthClient)
        .where(eq(s.oauthClient.clientId, created.client_id));
      if (!row) throw new Error("Created OAuth client missing");
      return summary(row);
    },
    async deleteClient(headers: Headers, clientId: string): Promise<void> {
      const who = await session(headers);
      await locked(clientId, async (_bound, tx) => {
        const [row] = await tx
          .select()
          .from(s.oauthClient)
          .where(and(eq(s.oauthClient.clientId, clientId), eq(s.oauthClient.userId, who.user.id)));
        if (!row) throw new APIError("NOT_FOUND");
        await tx.delete(s.oauthClient).where(eq(s.oauthClient.id, row.id));
      });
    },
    async listGrants(headers: Headers): Promise<OAuthGrantSummary[]> {
      const who = await session(headers);
      return (
        await db
          .select({ consent: s.oauthConsent, client: s.oauthClient })
          .from(s.oauthConsent)
          .innerJoin(s.oauthClient, eq(s.oauthClient.clientId, s.oauthConsent.clientId))
          .where(eq(s.oauthConsent.userId, who.user.id))
      ).map(({ consent, client }) => ({
        client_id: client.clientId,
        name: client.name ?? client.clientId,
        scopes: consent.scopes,
        created_at: consent.createdAt.toISOString(),
      }));
    },
    async revokeGrant(headers: Headers, clientId: string): Promise<void> {
      const who = await session(headers);
      await locked(clientId, async (_bound, tx) => {
        await tx
          .delete(s.oauthAccessToken)
          .where(
            and(
              eq(s.oauthAccessToken.clientId, clientId),
              eq(s.oauthAccessToken.userId, who.user.id),
            ),
          );
        await tx
          .delete(s.oauthRefreshToken)
          .where(
            and(
              eq(s.oauthRefreshToken.clientId, clientId),
              eq(s.oauthRefreshToken.userId, who.user.id),
            ),
          );
        await tx
          .delete(s.oauthConsent)
          .where(
            and(eq(s.oauthConsent.clientId, clientId), eq(s.oauthConsent.userId, who.user.id)),
          );
        // Revoke not-yet-exchanged codes as well, without touching login/OAuth-login state.
        const pending = await tx
          .select()
          .from(s.authVerification)
          .where(sql`${s.authVerification.value} like '{"type":"authorization_code",%'`);
        for (const row of pending) {
          const record = authorizationRecord.safeParse(JSON.parse(row.value));
          if (
            record.success &&
            record.data.userId === who.user.id &&
            record.data.query.client_id === clientId
          )
            await tx.delete(s.authVerification).where(eq(s.authVerification.id, row.id));
        }
      });
    },
  };
}

export type OAuthService = ReturnType<typeof createOAuthService>;
