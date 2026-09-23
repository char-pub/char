/**
 * admin 路由：运行开关（kill switch）与审计日志。
 *
 * - 切换开关需要 `flags.toggle` 能力，必须填写理由；变更与审计记录在同一个事务里写入。
 *   各进程的开关缓存最多 5 秒刷新一次，所以切换后 5 秒内全部生效。
 * - 审计日志：`audit.read_all` 可以查看全部记录并校验哈希链；只有 `audit.read_own`
 *   的员工只能看到自己的操作。
 */
import { and, desc, eq, lt, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import { appendAudit, verifyAuditChain } from "../audit/audit.js";
import { auditLog, featureFlags } from "../db/schema/index.js";
import { problem } from "../http/middleware.js";
import { type AdminEnv, adminRoute } from "./app.js";
import { staffCan } from "./roles.js";

export const FLAG_KEYS = [
  "signups",
  "uploads",
  "publish",
  "contributions",
  "github_sync",
  "guest_access",
  "read_only",
] as const;

const ToggleSchema = z.strictObject({
  enabled: z.boolean(),
  reason: z.string().min(10).max(1000),
});

export function registerFlags(app: Hono<AdminEnv>): void {
  adminRoute(app, {
    method: "get",
    path: "/v1/admin/flags",
    capability: "overview.read",
    handler: async (c) => {
      const rows = await c.var.services.db.select().from(featureFlags);
      const byKey = new Map(rows.map((r) => [r.key, r]));
      return c.json({
        flags: FLAG_KEYS.map((key) => {
          const r = byKey.get(key);
          return {
            key,
            enabled: r?.enabled ?? true,
            reason: r?.reason ?? null,
            updated_at: r?.updatedAt?.toISOString() ?? null,
          };
        }),
      });
    },
  });

  adminRoute(app, {
    method: "put",
    path: "/v1/admin/flags/:key",
    capability: "flags.toggle",
    body: ToggleSchema,
    handler: async (c, { body }) => {
      const key = c.req.param("key") ?? "";
      if (!(FLAG_KEYS as readonly string[]).includes(key)) {
        return problem(c, 404, "not_found");
      }
      const { db, clock } = c.var.services;
      const staff = c.var.staff;
      const now = clock.now();
      await db.transaction(async (tx) => {
        const [before] = await tx.select().from(featureFlags).where(eq(featureFlags.key, key));
        await tx
          .insert(featureFlags)
          .values({
            key,
            enabled: body.enabled,
            reason: body.reason,
            updatedBy: staff.user_id,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: featureFlags.key,
            set: {
              enabled: body.enabled,
              reason: body.reason,
              updatedBy: staff.user_id,
              updatedAt: now,
            },
          });
        await appendAudit(tx, {
          at: now,
          actor: { kind: "staff", id: staff.user_id },
          action: "flag.toggle",
          subject: `flag:${key}`,
          requestId: c.var.requestId,
          before: { enabled: before?.enabled ?? true },
          after: { enabled: body.enabled, reason: body.reason },
        });
      });
      return c.json({ key, enabled: body.enabled });
    },
  });
}

const AuditQuerySchema = z.object({
  before: z.coerce.bigint().optional(),
  subject: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export function registerAudit(app: Hono<AdminEnv>): void {
  adminRoute(app, {
    method: "get",
    path: "/v1/admin/audit",
    capability: "audit.read_own",
    handler: async (c) => {
      const q = AuditQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
      if (!q.success) return problem(c, 422, "request.invalid");
      const staff = c.var.staff;
      const all = staffCan(staff.roles, "audit.read_all");
      const conds = [];
      if (!all)
        conds.push(
          sql`${auditLog.actor} @> ${JSON.stringify({ kind: "staff", id: staff.user_id })}::jsonb`,
        );
      if (q.data.before !== undefined) conds.push(lt(auditLog.id, q.data.before));
      if (q.data.subject) conds.push(eq(auditLog.subject, q.data.subject));
      const rows = await c.var.services.db
        .select()
        .from(auditLog)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(auditLog.id))
        .limit(q.data.limit);
      return c.json({
        items: rows.map((r) => ({
          id: r.id.toString(),
          at: r.at.toISOString(),
          actor: r.actor,
          action: r.action,
          subject: r.subject,
          request_id: r.requestId,
          before: r.before,
          after: r.after,
          hash: r.hash,
        })),
        next_before: rows.length === q.data.limit ? (rows.at(-1)?.id.toString() ?? null) : null,
      });
    },
  });

  adminRoute(app, {
    method: "get",
    path: "/v1/admin/audit/verify",
    capability: "audit.read_all",
    handler: async (c) => {
      const r = await verifyAuditChain(c.var.services.db);
      return c.json(r.ok ? r : { ...r, brokenAt: r.brokenAt.toString() });
    },
  });
}
