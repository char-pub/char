/** Browser-session management around the OAuth provider; protocol endpoints live in auth/oauth. */
import {
  DecideOAuthConsentSchema,
  OAuthConsentRequestSchema,
  RegisterOAuthClientSchema,
} from "@char-pub/contracts";
import { APIError, isAPIError } from "better-auth/api";
import type { Hono } from "hono";
import { ZodError } from "zod";
import type { Action } from "../../authz/authorize.js";
import { problem } from "../../http/middleware.js";
import { type AppContext, type Env, route } from "../app.js";

function account(c: AppContext, action: Action) {
  const p = c.var.principal;
  if (p.kind !== "user") return problem(c, 401, "auth.required");
  return { action, resource: { type: "account" as const, user_id: p.user_id }, loaded: p.user_id };
}
function service(c: AppContext) {
  if (!c.var.services.oauth) throw new APIError("SERVICE_UNAVAILABLE");
  return c.var.services.oauth;
}
async function respond(c: AppContext, run: () => Promise<Response>): Promise<Response> {
  c.header("cache-control", "private, no-store");
  try {
    return await run();
  } catch (error) {
    if (isAPIError(error))
      return problem(
        c,
        error.statusCode,
        error.statusCode === 401
          ? "auth.required"
          : error.statusCode === 404
            ? "not_found"
            : error.statusCode === 503
              ? "oauth.unavailable"
              : "oauth.invalid_request",
      );
    if (error instanceof ZodError)
      return problem(
        c,
        422,
        "oauth.invalid_request",
        "Check the client name and exact redirect addresses.",
      );
    throw error;
  }
}
export function register(app: Hono<Env>) {
  for (const path of [
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-authorization-server/v1/auth",
  ])
    route(app, {
      method: "get",
      path,
      authorize: async () => ({ public: true, loaded: null }),
      handler: async (c) =>
        respond(c, async () => {
          c.header("access-control-allow-origin", "*");
          return c.json(await service(c).metadata());
        }),
    });
  route(app, {
    method: "get",
    path: "/v1/me/oauth/clients",
    authorize: async (c) => account(c, "account.read_oauth"),
    handler: async (c) =>
      respond(c, async () => c.json({ items: await service(c).listClients(c.req.raw.headers) })),
  });
  route(app, {
    method: "post",
    path: "/v1/me/oauth/clients",
    body: RegisterOAuthClientSchema,
    authorize: async (c) => account(c, "account.manage_oauth"),
    handler: async (c, { body }) =>
      respond(c, async () => c.json(await service(c).createClient(c.req.raw.headers, body), 201)),
  });
  route(app, {
    method: "delete",
    path: "/v1/me/oauth/clients/:client",
    authorize: async (c) => account(c, "account.manage_oauth"),
    handler: async (c) =>
      respond(c, async () => {
        await service(c).deleteClient(c.req.raw.headers, c.req.param("client") ?? "");
        return c.body(null, 204);
      }),
  });
  route(app, {
    method: "get",
    path: "/v1/me/oauth/grants",
    authorize: async (c) => account(c, "account.read_oauth"),
    handler: async (c) =>
      respond(c, async () => c.json({ items: await service(c).listGrants(c.req.raw.headers) })),
  });
  route(app, {
    method: "delete",
    path: "/v1/me/oauth/grants/:client",
    authorize: async (c) => account(c, "account.manage_oauth"),
    handler: async (c) =>
      respond(c, async () => {
        await service(c).revokeGrant(c.req.raw.headers, c.req.param("client") ?? "");
        return c.body(null, 204);
      }),
  });
  route(app, {
    method: "post",
    path: "/v1/oauth/consent/details",
    body: OAuthConsentRequestSchema,
    authorize: async (c) => account(c, "account.read_oauth"),
    handler: async (c, { body }) =>
      respond(c, async () =>
        c.json(await service(c).consentDetails(c.req.raw.headers, body.oauth_query)),
      ),
  });
  route(app, {
    method: "post",
    path: "/v1/oauth/consent",
    body: DecideOAuthConsentSchema,
    authorize: async (c) => account(c, "account.manage_oauth"),
    handler: async (c, { body }) =>
      respond(c, async () => c.json(await service(c).consent(c.req.raw.headers, body))),
  });
}
