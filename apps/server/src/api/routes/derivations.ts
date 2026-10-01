import { DeriveCreationRequestSchema } from "@char-pub/contracts";
import type { Hono } from "hono";
import { param, requestIdOf } from "../../registry/context.js";
import { createDerivation } from "../../registry/derivations.js";
import { lookupNamespace } from "../../registry/lookup.js";
import { type Env, notFound, route } from "../app.js";

export function register(app: Hono<Env>) {
  route(app, {
    method: "post",
    path: "/v1/namespaces/:slug/derivations",
    body: DeriveCreationRequestSchema,
    authorize: async (c) => {
      const ns = await lookupNamespace(c.var.services.db, param(c, "slug"), c.var.principal);
      if (ns.kind !== "found") return notFound(c);
      return {
        action: "creation.create",
        resource: { type: "namespace", ns: ns.ctx },
        loaded: ns.ns.slug,
      };
    },
    handler: async (c, { body, loaded: slug }) =>
      c.json(
        await createDerivation(c.var.services, c.var.principal, slug, body, requestIdOf(c)),
        201,
      ),
  });
}
