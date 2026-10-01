/** Narrow server capabilities around the official OAuth protocol implementation. */
import {
  getOAuthProviderApi,
  getOAuthProviderState,
  oauthProvider,
} from "@better-auth/oauth-provider";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { z } from "zod";

export const OAUTH_SCOPES = [
  "profile",
  "creations:read",
  "drafts:write",
  "contributions:write",
  "offline_access",
] as const;
export const OAUTH_TOKEN_PREFIX = "cp_oauth_";

export interface OAuthPages {
  loginPage: string;
  consentPage: string;
}

function providerOptions(pages: OAuthPages) {
  const options = {
    ...pages,
    scopes: [...OAUTH_SCOPES],
    grantTypes: ["authorization_code", "refresh_token"],
    disableJwtPlugin: true,
    accessTokenExpiresIn: 3600,
    refreshTokenExpiresIn: 30 * 24 * 60 * 60,
    refreshTokenReuseInterval: 0,
    allowDynamicClientRegistration: false,
    allowUnauthenticatedClientRegistration: false,
    clientRegistrationRequirePKCE: true,
    prefix: { opaqueAccessToken: OAUTH_TOKEN_PREFIX },
    // Public clients are manually created through the session-owned wrapper only.
    clientPrivileges: async ({ session }: { session?: unknown }) => Boolean(session),
    resourcePrivileges: async () => false,
  };
  return options;
}

export function oauthPlugins(
  pages: OAuthPages,
): [BetterAuthPlugin, ReturnType<typeof boundaryPlugin>] {
  const options = providerOptions(pages);
  const provider = oauthProvider(options);
  // Upstream OpenAPI declarations emit optional `undefined` incompatible with
  // exactOptionalPropertyTypes; retain all endpoint types at this integration boundary.
  return [provider as unknown as BetterAuthPlugin, boundaryPlugin(options)];
}

function boundaryPlugin(options: ReturnType<typeof providerOptions>) {
  return {
    id: "charpub-oauth-boundary",
    endpoints: {
      charpubOAuthTokenKey: createAuthEndpoint(
        "/charpub-oauth/token-key",
        {
          method: "POST",
          body: z.object({
            token: z.string(),
            type: z.enum(["access_token", "refresh_token", "authorization_code"]),
          }),
          metadata: { SERVER_ONLY: true },
        },
        async (ctx) => getOAuthProviderApi(ctx, options).hashToken(ctx.body.token, ctx.body.type),
      ),
      charpubOAuthVerify: createAuthEndpoint(
        "/charpub-oauth/verify",
        {
          method: "POST",
          body: z.object({ token: z.string() }),
          metadata: { SERVER_ONLY: true },
        },
        async (ctx) => {
          const provider = getOAuthProviderApi(ctx, options);
          const payload = await provider.requireActiveAccessToken(ctx.body.token);
          const row = await ctx.context.adapter.findOne<{ id: string }>({
            model: "oauthAccessToken",
            where: [
              {
                field: "token",
                value: await provider.hashToken(
                  ctx.body.token.slice(OAUTH_TOKEN_PREFIX.length),
                  "access_token",
                ),
              },
            ],
          });
          if (!row || typeof payload.sub !== "string" || typeof payload.client_id !== "string")
            throw new APIError("UNAUTHORIZED");
          return {
            user_id: payload.sub,
            client_id: payload.client_id,
            token_id: row.id,
            scopes: typeof payload.scope === "string" ? payload.scope.split(" ") : [],
          };
        },
      ),
      charpubOAuthConsentDetails: createAuthEndpoint(
        "/charpub-oauth/consent-details",
        {
          method: "POST",
          body: z.object({ oauth_query: z.string() }),
          use: [sessionMiddleware],
          metadata: { SERVER_ONLY: true },
        },
        async (ctx) => {
          // The provider's before hook verifies signature and expiry before this endpoint.
          const state = await getOAuthProviderState();
          if (!state?.query)
            throw new APIError("BAD_REQUEST", { message: "Invalid OAuth request" });
          const params = new URLSearchParams(state.query);
          const client = await getOAuthProviderApi(ctx, options).getClient(
            params.get("client_id") ?? "",
          );
          const redirect = params.get("redirect_uri") ?? "";
          if (!client || client.disabled || !client.redirectUris?.includes(redirect))
            throw new APIError("BAD_REQUEST", { message: "Invalid OAuth client or redirect" });
          const scopes = (params.get("scope") ?? "").split(" ").filter(Boolean);
          if (
            !scopes.every(
              (s) => OAUTH_SCOPES.some((allowed) => allowed === s) && client.scopes?.includes(s),
            )
          )
            throw new APIError("BAD_REQUEST", { message: "Invalid OAuth scope" });
          return {
            client_id: client.clientId,
            client_name: client.name ?? client.clientId,
            redirect_uri: redirect,
            scopes,
          };
        },
      ),
    },
  } as const;
}

export type OAuthProtocolEndpoints = Pick<
  ReturnType<typeof oauthProvider>["endpoints"],
  "getOAuthServerConfig" | "oauth2Consent" | "adminCreateOAuthClient"
>;
export type OAuthBoundaryEndpoints = ReturnType<typeof boundaryPlugin>["endpoints"];
