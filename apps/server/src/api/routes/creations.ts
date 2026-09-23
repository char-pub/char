/**
 * 新建 Creation。v0 只对创作者开放 character、world、lorebook 三种类型；
 * 其余类型的数据模型已经存在，但还没有创作界面，暂不允许新建。
 */
import { CreateCreationRequestSchema } from "@char-pub/contracts";
import { OPEN_CREATION_TYPES } from "@char-pub/core";
import { and, eq } from "drizzle-orm";
import type { Hono } from "hono";
import { appendAudit } from "../../audit/audit.js";
import type { Db } from "../../db/client.js";
import {
  creationDrafts,
  creationRedirects,
  creations,
  namespaceMembers,
  namespaces,
} from "../../db/schema/index.js";
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
        author: { name: `@${await authorHandle(db, ns, userId)}`, user: encodeId("user", userId) },
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

/**
 * 默认作者署名用的公开名字：新建者的个人 namespace。不使用登录提供方给的显示名，因为那可能是
 * 真实姓名，而署名会随 Release 永久公开；作者想署真名可以自己在编辑器里改。
 */
async function authorHandle(db: Db, ns: { slug: string; kind: string }, userId: string) {
  if (ns.kind === "user") return ns.slug;
  const [own] = await db
    .select({ slug: namespaces.slug })
    .from(namespaceMembers)
    .innerJoin(namespaces, eq(namespaces.id, namespaceMembers.namespaceId))
    .where(and(eq(namespaceMembers.userId, userId), eq(namespaces.kind, "user")))
    .limit(1);
  return own?.slug ?? ns.slug;
}
