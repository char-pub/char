/**
 * 新建 Creation。v0 只对创作者开放 character、world、lorebook 三种类型；
 * 其余类型的数据模型已经存在，但还没有创作界面，暂不允许新建。
 */
import { CreateCreationRequestSchema } from "@char-pub/contracts";
import { OPEN_CREATION_TYPES } from "@char-pub/core";
import { and, eq } from "drizzle-orm";
import type { Hono } from "hono";
import { appendAudit } from "../../audit/audit.js";
import { creationDrafts, creationRedirects, creations } from "../../db/schema/index.js";
import { problem } from "../../http/middleware.js";
import { auditActor, param, requestIdOf, userIdOf } from "../../registry/context.js";
import { initialDraft } from "../../registry/drafts.js";
import { encodeId } from "../../registry/ids.js";
import { lookupNamespace } from "../../registry/lookup.js";
import { type Env, notFound, route } from "../app.js";

const OPEN: ReadonlySet<string> = new Set(OPEN_CREATION_TYPES);

export function register(app: Hono<Env>): void {
  route(app, {
    method: "post",
    path: "/v1/namespaces/:slug/creations",
    body: CreateCreationRequestSchema,
    authorize: async (c) => {
      const found = await lookupNamespace(c.var.services.db, param(c, "slug"), c.var.principal);
      if (found.kind !== "found") return notFound(c);
      return {
        action: "creation.create",
        resource: { type: "namespace", ns: found.ctx },
        loaded: found.ns,
      };
    },
    handler: async (c, { body, loaded: ns }) => {
      const { db, ids, clock } = c.var.services;
      if (!OPEN.has(body.type)) {
        return problem(c, 422, "creation.type_not_open", `'${body.type}' cannot be created yet`);
      }
      const [taken] = await db
        .select({ id: creations.id })
        .from(creations)
        .where(and(eq(creations.namespaceId, ns.id), eq(creations.name, body.name)))
        .limit(1);
      const [redirected] = await db
        .select({ id: creationRedirects.creationId })
        .from(creationRedirects)
        .where(
          and(eq(creationRedirects.namespaceId, ns.id), eq(creationRedirects.oldName, body.name)),
        )
        .limit(1);
      if (taken || redirected) {
        return problem(c, 409, "creation.taken", `@${ns.slug}/${body.name} already exists`);
      }
      const id = ids.uuid();
      const userId = userIdOf(c.var.principal);
      const ref = `@${ns.slug}/${body.name}`;
      const working = initialDraft({
        id: encodeId("creation", id),
        ref,
        type: body.type,
        display_name: body.display_name,
      });
      await db.transaction(async (tx) => {
        await tx.insert(creations).values({
          id,
          namespaceId: ns.id,
          name: body.name,
          type: body.type,
          displayName: body.display_name,
          rating: "general",
        });
        await tx.insert(creationDrafts).values({ creationId: id, working, updatedBy: userId });
        await appendAudit(tx, {
          at: clock.now(),
          actor: auditActor(c.var.principal),
          action: "creation.create",
          subject: `creation:${id}`,
          requestId: requestIdOf(c),
          after: { ref, type: body.type },
        });
      });
      return c.json({ id: encodeId("creation", id), ref, type: body.type }, 201);
    },
  });
}
