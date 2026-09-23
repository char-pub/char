/**
 * 审计日志导出：按条件导出为 NDJSON（每行一条记录，按 id 从新到旧），每次最多 10000 条。
 * 超过时响应头 `x-next-before` 给出下一批的起点，用它再导出一次即可。
 *
 * 导出需要查看全部审计日志的权限，必须填写理由；导出本身写一条审计记录（包括过滤条件与条数）。
 * 审计记录里本来就不含申请人信息等个人数据，所以这里不需要额外脱敏。
 */
import { and, desc, eq, gte, lt, lte, type SQL, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import { appendAudit } from "../../audit/audit.js";
import { auditLog } from "../../db/schema/index.js";
import { type AdminEnv, adminRoute } from "../app.js";
import { parseId, staffActor } from "./common.js";

export const AUDIT_EXPORT_LIMIT = 10_000;

const ExportSchema = z.strictObject({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  action: z.string().trim().min(1).max(100).optional(),
  subject: z.string().trim().min(1).max(300).optional(),
  /** 执行者的用户 ID（`usr_…` 或 UUID）。 */
  actor: z.string().trim().min(1).max(100).optional(),
  /** 只导出 id 小于它的记录，用于分批导出。 */
  before: z
    .string()
    .regex(/^\d{1,19}$/)
    .optional(),
  reason: z.string().trim().min(10).max(2000),
});

export function registerAuditExport(app: Hono<AdminEnv>): void {
  adminRoute(app, {
    method: "post",
    path: "/v1/admin/audit/export",
    capability: "audit.read_all",
    body: ExportSchema,
    handler: async (c, { body }) => {
      const conds: SQL[] = [];
      if (body.from) conds.push(gte(auditLog.at, new Date(body.from)));
      if (body.to) conds.push(lte(auditLog.at, new Date(body.to)));
      if (body.action) conds.push(eq(auditLog.action, body.action));
      if (body.subject) conds.push(eq(auditLog.subject, body.subject));
      if (body.actor) {
        const id = parseId("user", body.actor) ?? body.actor;
        conds.push(sql`${auditLog.actor}->>'id' = ${id}`);
      }
      if (body.before) conds.push(lt(auditLog.id, BigInt(body.before)));
      const now = c.var.services.clock.now();
      const rows = await c.var.services.db.transaction(async (tx) => {
        const found = await tx
          .select()
          .from(auditLog)
          .where(conds.length ? and(...conds) : undefined)
          .orderBy(desc(auditLog.id))
          .limit(AUDIT_EXPORT_LIMIT + 1);
        const { reason, ...filters } = body;
        await appendAudit(tx, {
          at: now,
          actor: staffActor(c),
          action: "audit.export",
          subject: "audit_log",
          requestId: c.var.requestId,
          after: { reason, filters, count: Math.min(found.length, AUDIT_EXPORT_LIMIT) },
        });
        return found;
      });
      const page = rows.slice(0, AUDIT_EXPORT_LIMIT);
      const lines = page.map((r) =>
        JSON.stringify({
          id: r.id.toString(),
          at: r.at.toISOString(),
          actor: r.actor,
          action: r.action,
          subject: r.subject,
          request_id: r.requestId,
          before: r.before,
          after: r.after,
          prev_hash: r.prevHash,
          hash: r.hash,
        }),
      );
      const headers: Record<string, string> = {
        "content-type": "application/x-ndjson; charset=utf-8",
        "content-disposition": `attachment; filename="audit-${now.toISOString().slice(0, 10)}.ndjson"`,
        "cache-control": "no-store",
      };
      if (rows.length > AUDIT_EXPORT_LIMIT) {
        headers["x-next-before"] = page.at(-1)?.id.toString() ?? "";
      }
      return new Response(lines.length ? `${lines.join("\n")}\n` : "", { status: 200, headers });
    },
  });
}
