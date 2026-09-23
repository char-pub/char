/**
 * Namespace：注册、查看、改名。
 *
 * 改名后旧名写入重定向表并永久占用：读取旧名得到 301，旧名不能被任何人重新注册。
 */
import { CreateNamespaceRequestSchema, NamespaceSlugSchema } from "@char-pub/contracts";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import { appendAudit } from "../../audit/audit.js";
import { namespaceMembers, namespaceRedirects, namespaces } from "../../db/schema/index.js";
import { problem } from "../../http/middleware.js";
import { auditActor, param, requestIdOf, userIdOf } from "../../registry/context.js";
import { lookupNamespace } from "../../registry/lookup.js";
import {
  MAX_USER_NAMESPACES,
  ownedUserNamespaces,
  slugAvailability,
} from "../../registry/namespaces.js";
import { type AppContext, type Env, notFound, route } from "../app.js";

const RenameNamespaceRequestSchema = z.strictObject({ new_slug: NamespaceSlugSchema });

function namespaceJson(ns: { slug: string; kind: string; status: string }) {
  return { slug: ns.slug, kind: ns.kind, status: ns.status };
}

async function unavailable(c: AppContext, slug: string): Promise<Response | null> {
  const a = await slugAvailability(c.var.services.db, slug);
  if (a === "reserved") return problem(c, 409, "namespace.reserved", `'${slug}' is reserved`);
  if (a === "taken") return problem(c, 409, "namespace.taken", `'${slug}' is already taken`);
  return null;
}

export function register(app: Hono<Env>): void {
  route(app, {
    method: "post",
    path: "/v1/namespaces",
    body: CreateNamespaceRequestSchema,
    authorize: async () => ({
      action: "namespace.create",
      resource: { type: "system" },
      loaded: null,
    }),
    handler: async (c, { body }) => {
      const { db, ids, clock } = c.var.services;
      const userId = userIdOf(c.var.principal);
      if ((await ownedUserNamespaces(db, userId)) >= MAX_USER_NAMESPACES) {
        return problem(c, 409, "namespace.limit", "each account can own one personal namespace");
      }
      const blocked = await unavailable(c, body.slug);
      if (blocked) return blocked;
      const id = ids.uuid();
      await db.transaction(async (tx) => {
        await tx
          .insert(namespaces)
          .values({ id, slug: body.slug, kind: "user", createdBy: userId });
        await tx.insert(namespaceMembers).values({ namespaceId: id, userId, role: "owner" });
        await appendAudit(tx, {
          at: clock.now(),
          actor: auditActor(c.var.principal),
          action: "namespace.create",
          subject: `namespace:${id}`,
          requestId: requestIdOf(c),
          after: { slug: body.slug },
        });
      });
      return c.json(namespaceJson({ slug: body.slug, kind: "user", status: "active" }), 201);
    },
  });

  route(app, {
    method: "get",
    path: "/v1/namespaces/:slug",
    authorize: async (c) => {
      const found = await lookupNamespace(c.var.services.db, param(c, "slug"), c.var.principal);
      if (found.kind === "missing") return notFound(c);
      if (found.kind === "redirect") {
        return c.redirect(`/v1/namespaces/${found.to}`, 301);
      }
      return { public: true, loaded: found.ns };
    },
    handler: async (c, { loaded }) => c.json(namespaceJson(loaded)),
  });

  route(app, {
    method: "patch",
    path: "/v1/namespaces/:slug",
    body: RenameNamespaceRequestSchema,
    authorize: async (c) => {
      const found = await lookupNamespace(c.var.services.db, param(c, "slug"), c.var.principal);
      if (found.kind !== "found") return notFound(c);
      return {
        action: "namespace.rename",
        resource: { type: "namespace", ns: found.ctx },
        loaded: found.ns,
      };
    },
    handler: async (c, { body, loaded }) => {
      const { db, clock } = c.var.services;
      if (body.new_slug === loaded.slug) return c.json(namespaceJson(loaded));
      const blocked = await unavailable(c, body.new_slug);
      if (blocked) return blocked;
      await db.transaction(async (tx) => {
        await tx
          .insert(namespaceRedirects)
          .values({ oldSlug: loaded.slug, namespaceId: loaded.id });
        await tx
          .update(namespaces)
          .set({ slug: body.new_slug, updatedAt: clock.now() })
          .where(eq(namespaces.id, loaded.id));
        await appendAudit(tx, {
          at: clock.now(),
          actor: auditActor(c.var.principal),
          action: "namespace.rename",
          subject: `namespace:${loaded.id}`,
          requestId: requestIdOf(c),
          before: { slug: loaded.slug },
          after: { slug: body.new_slug },
        });
      });
      return c.json(namespaceJson({ ...loaded, slug: body.new_slug }));
    },
  });
}
