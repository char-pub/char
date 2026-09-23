/** Self-service intake; deletion is performed by staff after reviewing its consequences. */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import { appendAudit } from "../../audit/audit.js";
import { authorize } from "../../authz/authorize.js";
import { authUser, legalRequests } from "../../db/schema/index.js";
import { problem } from "../../http/middleware.js";
import { encryptJson } from "../../moderation/legal-crypto.js";
import { hit } from "../../ops/rate-limit.js";
import { auditActor, requestIdOf } from "../../registry/context.js";
import { encodeId } from "../../registry/ids.js";
import { lookupCreation } from "../../registry/lookup.js";
import { type AppContext, type Env, notFound, route } from "../app.js";

const RequestSchema = z.strictObject({
  creation: z
    .string()
    .regex(/^@[a-z0-9-]+\/[a-z0-9-]+$/)
    .optional(),
  reason: z.string().trim().min(10).max(2000),
  confirm: z.literal(true),
});
function self(c: AppContext, write = false) {
  const p = c.var.principal;
  if (p.kind !== "user") return problem(c, 401, "auth.required");
  if (p.scopes) return problem(c, 403, "token.not_allowed");
  return {
    action: write ? ("account.update_settings" as const) : ("account.read" as const),
    resource: { type: "account" as const, user_id: p.user_id },
    loaded: p.user_id,
  };
}
function summary(row: typeof legalRequests.$inferSelect) {
  return {
    id: row.id,
    status: row.status,
    created_at: row.receivedAt.toISOString(),
    subjects: row.subjects as string[],
  };
}
export function register(app: Hono<Env>): void {
  route(app, {
    method: "get",
    path: "/v1/me/deletion-requests",
    authorize: async (c) => self(c),
    handler: async (c, { loaded: uid }) => {
      c.header("cache-control", "private, no-store");
      const rows = await c.var.services.db
        .select()
        .from(legalRequests)
        .where(sql`${legalRequests.requester}->>'owner_user_id' = ${uid}`)
        .orderBy(desc(legalRequests.receivedAt))
        .limit(100);
      return c.json({ items: rows.map(summary) });
    },
  });
  route(app, {
    method: "post",
    path: "/v1/me/deletion-requests",
    body: RequestSchema,
    authorize: async (c) => self(c, true),
    handler: async (c, { body, loaded: uid }) => {
      const { db, clock, ids, legalKey } = c.var.services;
      if (!legalKey) return problem(c, 503, "deletion.unavailable");
      let subject = encodeId("user", uid);
      if (body.creation) {
        const [ns, name] = body.creation.slice(1).split("/");
        const ctx = await lookupCreation(db, ns ?? "", name ?? "", c.var.principal);
        if (!ctx) return notFound(c);
        const d = authorize(c.var.principal, "creation.edit", ctx.resource, {
          disabled: await c.var.services.flags(),
        });
        if (!d.allow) return problem(c, d.status, d.code);
        subject = encodeId("creation", ctx.creation.id);
      }
      const now = clock.now();
      const quota = await hit(db, `deletion:${uid}`, { max: 10, windowSeconds: 86400 }, now);
      if (!quota.allowed) return problem(c, 429, "rate_limited");
      const row = await db.transaction(async (tx) => {
        await tx
          .select({ id: authUser.id })
          .from(authUser)
          .where(eq(authUser.id, uid))
          .for("update");
        const [pending] = await tx
          .select()
          .from(legalRequests)
          .where(
            and(
              sql`${legalRequests.requester}->>'owner_user_id' = ${uid}`,
              sql`${legalRequests.subjects} = ${JSON.stringify([subject])}::jsonb`,
              inArray(legalRequests.status, ["received", "reviewing"]),
            ),
          )
          .limit(1);
        if (pending) return pending;
        const id = ids.uuid();
        const [created] = await tx
          .insert(legalRequests)
          .values({
            id,
            kind: "gdpr",
            requester: {
              ...encryptJson(legalKey, {
                name: encodeId("user", uid),
                user: encodeId("user", uid),
                reason: body.reason,
                request: body.creation ? "creation_removal" : "account_deletion",
              }),
              owner_user_id: uid,
            },
            subjects: [subject],
            receivedAt: now,
            status: "received",
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        await appendAudit(tx, {
          at: now,
          actor: auditActor(c.var.principal),
          action: "deletion.request",
          subject: `legal_request:${id}`,
          requestId: requestIdOf(c),
          after: { subject },
        });
        return created;
      });
      c.header("cache-control", "private, no-store");
      return row ? c.json(summary(row), 202) : problem(c, 500, "internal");
    },
  });
}
