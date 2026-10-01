import {
  AcceptCollaborationRequestSchema,
  InviteCollaboratorRequestSchema,
} from "@char-pub/contracts";
import { canonicalizeCreation } from "@char-pub/core";
import { and, eq, ne, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { appendAudit } from "../../audit/audit.js";
import { authorize } from "../../authz/authorize.js";
import {
  authUser,
  creationCollaborators,
  creationDrafts,
  creations,
  namespaceMembers,
  namespaces,
} from "../../db/schema/index.js";
import { problem } from "../../http/middleware.js";
import { grantDraftAssets } from "../../registry/asset-ownership.js";
import { auditActor, param, requestIdOf, userIdOf } from "../../registry/context.js";
import { buildCreationContext } from "../../registry/draft-builds.js";
import { decodeId, encodeId } from "../../registry/ids.js";
import { lookupCreation } from "../../registry/lookup.js";
import { type AppContext, type Env, notFound, route } from "../app.js";
import { CREATION_PATH } from "./drafts.js";

const load = (c: AppContext) =>
  lookupCreation(c.var.services.db, param(c, "ns").slice(1), param(c, "name"), c.var.principal);
export function register(app: Hono<Env>): void {
  route(app, {
    method: "get",
    path: `${CREATION_PATH}/collaborators`,
    authorize: async (c) => {
      const ctx = await load(c);
      return ctx
        ? { action: "creation.manage_collaborators", resource: ctx.resource, loaded: ctx }
        : notFound(c);
    },
    handler: async (c, { loaded }) => {
      const rows = await c.var.services.db
        .select({
          row: creationCollaborators,
          currentLicense: sql<string>`${creationDrafts.working}->'meta'->>'license'`,
          namespace: sql<
            string | null
          >`(select n.slug from app.namespaces n join app.namespace_members m on m.namespace_id=n.id where m.user_id=${creationCollaborators.userId} and m.role='owner' and n.kind='user' limit 1)`,
        })
        .from(creationCollaborators)
        .innerJoin(creationDrafts, eq(creationDrafts.creationId, creationCollaborators.creationId))
        .where(eq(creationCollaborators.creationId, loaded.creation.id));
      return c.json({
        items: rows.map(({ row, namespace, currentLicense }) => ({
          user_id: encodeId("user", row.userId),
          name: namespace ? `@${namespace}` : encodeId("user", row.userId),
          namespace,
          status: row.acceptedAt && row.license === currentLicense ? "active" : "pending",
          license: row.license,
          invited_at: row.createdAt.toISOString(),
          accepted_at: row.acceptedAt?.toISOString() ?? null,
        })),
      });
    },
  });
  route(app, {
    method: "post",
    path: `${CREATION_PATH}/collaborators`,
    body: InviteCollaboratorRequestSchema,
    authorize: async (c) => {
      const ctx = await load(c);
      return ctx
        ? { action: "creation.manage_collaborators", resource: ctx.resource, loaded: ctx }
        : notFound(c);
    },
    handler: async (c, { body, loaded }) => {
      const { db, clock } = c.var.services;
      const actor = userIdOf(c.var.principal);
      return db.transaction(async (tx) => {
        await tx
          .select({ id: creations.id })
          .from(creations)
          .where(eq(creations.id, loaded.creation.id))
          .for("update");
        const fresh = await lookupCreation(
          tx,
          loaded.ns.slug,
          loaded.creation.name,
          c.var.principal,
        );
        if (!fresh) return notFound(c);
        const decision = authorize(
          c.var.principal,
          "creation.manage_collaborators",
          fresh.resource,
          { disabled: await c.var.services.flags() },
        );
        if (!decision.allow) return problem(c, decision.status, decision.code);
        const [target] = await tx
          .select({ id: authUser.id, banned: authUser.banned })
          .from(namespaces)
          .innerJoin(
            namespaceMembers,
            and(
              eq(namespaceMembers.namespaceId, namespaces.id),
              eq(namespaceMembers.role, "owner"),
            ),
          )
          .innerJoin(authUser, eq(authUser.id, namespaceMembers.userId))
          .where(
            and(
              eq(namespaces.slug, body.namespace),
              eq(namespaces.kind, "user"),
              eq(namespaces.status, "active"),
            ),
          )
          .limit(1);
        if (!target || target.banned || target.id === actor)
          return problem(
            c,
            422,
            "collaboration.invalid_target",
            "Choose another active personal namespace.",
          );
        const [draft] = await tx
          .select()
          .from(creationDrafts)
          .where(eq(creationDrafts.creationId, loaded.creation.id))
          .for("update");
        if (!draft) return notFound(c);
        const license = canonicalizeCreation(draft.working).creation.meta.license;
        await grantDraftAssets(tx, loaded.creation.id, actor, draft.working, clock.now());
        await tx
          .insert(creationCollaborators)
          .values({
            creationId: loaded.creation.id,
            userId: target.id,
            invitedBy: actor,
            license,
            createdAt: clock.now(),
            updatedAt: clock.now(),
          })
          .onConflictDoUpdate({
            target: [creationCollaborators.creationId, creationCollaborators.userId],
            set: { license, acceptedAt: null, invitedBy: actor, updatedAt: clock.now() },
            setWhere: ne(creationCollaborators.license, license),
          });
        await appendAudit(tx, {
          at: clock.now(),
          actor: auditActor(c.var.principal),
          action: "collaboration.invite",
          subject: `creation:${loaded.creation.id}`,
          requestId: requestIdOf(c),
          after: { user_id: target.id, license },
        });
        return c.json({ status: "invited" }, 201);
      });
    },
  });
  route(app, {
    method: "delete",
    path: `${CREATION_PATH}/collaborators/:user`,
    authorize: async (c) => {
      const ctx = await load(c);
      return ctx
        ? { action: "creation.manage_collaborators", resource: ctx.resource, loaded: ctx }
        : notFound(c);
    },
    handler: async (c, { loaded }) => {
      const user = decodeId("user", param(c, "user"));
      if (!user) return notFound(c);
      const { db, clock } = c.var.services;
      return db.transaction(async (tx) => {
        await tx
          .select({ id: creations.id })
          .from(creations)
          .where(eq(creations.id, loaded.creation.id))
          .for("update");
        const fresh = await lookupCreation(
          tx,
          loaded.ns.slug,
          loaded.creation.name,
          c.var.principal,
        );
        if (!fresh) return notFound(c);
        const decision = authorize(
          c.var.principal,
          "creation.manage_collaborators",
          fresh.resource,
          { disabled: await c.var.services.flags() },
        );
        if (!decision.allow) return problem(c, decision.status, decision.code);
        await tx
          .delete(creationCollaborators)
          .where(
            and(
              eq(creationCollaborators.creationId, loaded.creation.id),
              eq(creationCollaborators.userId, user),
            ),
          );
        await appendAudit(tx, {
          at: clock.now(),
          actor: auditActor(c.var.principal),
          action: "collaboration.revoke",
          subject: `creation:${loaded.creation.id}`,
          requestId: requestIdOf(c),
          after: { user_id: user },
        });
        return c.body(null, 204);
      });
    },
  });
  route(app, {
    method: "get",
    path: "/v1/me/collaborations",
    authorize: async (c) => ({
      action: "account.read_collaborations",
      loaded: null,
      resource: {
        type: "account",
        user_id: c.var.principal.kind === "user" ? c.var.principal.user_id : "",
      },
    }),
    handler: async (c) => {
      const rows = await c.var.services.db
        .select({
          row: creationCollaborators,
          work: creations,
          ns: namespaces,
          currentLicense: sql<string>`${creationDrafts.working}->'meta'->>'license'`,
        })
        .from(creationCollaborators)
        .innerJoin(creations, eq(creations.id, creationCollaborators.creationId))
        .innerJoin(creationDrafts, eq(creationDrafts.creationId, creations.id))
        .innerJoin(namespaces, eq(namespaces.id, creations.namespaceId))
        .where(
          and(
            eq(creationCollaborators.userId, userIdOf(c.var.principal)),
            eq(creations.status, "active"),
            eq(namespaces.status, "active"),
          ),
        );
      return c.json({
        items: rows.map(({ row, work, ns, currentLicense }) => ({
          creation: encodeId("creation", work.id),
          ref: `@${ns.slug}/${work.name}`,
          display_name: work.displayName,
          license: row.license,
          status: row.acceptedAt && row.license === currentLicense ? "active" : "pending",
        })),
      });
    },
  });
  route(app, {
    method: "post",
    path: `${CREATION_PATH}/collaborators/accept`,
    body: AcceptCollaborationRequestSchema,
    authorize: async (c) => ({
      action: "account.update_settings",
      loaded: null,
      resource: {
        type: "account",
        user_id: c.var.principal.kind === "user" ? c.var.principal.user_id : "",
      },
    }),
    handler: async (c, { body }) => {
      const { db, clock } = c.var.services;
      const actor = userIdOf(c.var.principal);
      return db.transaction(async (tx) => {
        const found = await lookupCreation(
          tx,
          param(c, "ns").slice(1),
          param(c, "name"),
          c.var.principal,
        );
        if (!found) return notFound(c);
        await tx
          .select({ id: creations.id })
          .from(creations)
          .where(eq(creations.id, found.creation.id))
          .for("update");
        const { context: fresh, principal } = await buildCreationContext(
          tx,
          found.creation.id,
          c.var.principal,
          clock.now(),
        );
        const decision = authorize(
          principal,
          "account.update_settings",
          { type: "account", user_id: actor },
          { disabled: await c.var.services.flags() },
        );
        if (!decision.allow) return problem(c, decision.status, decision.code);
        const [invite] = await tx
          .select()
          .from(creationCollaborators)
          .where(
            and(
              eq(creationCollaborators.creationId, found.creation.id),
              eq(creationCollaborators.userId, actor),
            ),
          );
        if (!invite) return notFound(c);
        const [draft] = await tx
          .select()
          .from(creationDrafts)
          .where(eq(creationDrafts.creationId, found.creation.id));
        if (!draft || fresh.creation.status !== "active" || fresh.ns.status !== "active")
          return notFound(c);
        const license = canonicalizeCreation(draft.working).creation.meta.license;
        if (body.license !== license || invite.license !== license)
          return problem(
            c,
            409,
            "collaboration.license_changed",
            "Review the current invitation license before accepting.",
          );
        await tx
          .update(creationCollaborators)
          .set({ acceptedAt: invite.acceptedAt ?? clock.now(), updatedAt: clock.now() })
          .where(
            and(
              eq(creationCollaborators.creationId, found.creation.id),
              eq(creationCollaborators.userId, actor),
            ),
          );
        await appendAudit(tx, {
          at: clock.now(),
          actor: auditActor(c.var.principal),
          action: "collaboration.accept",
          subject: `creation:${found.creation.id}`,
          requestId: requestIdOf(c),
          after: { license },
        });
        return c.json({ status: "active" });
      });
    },
  });
}
