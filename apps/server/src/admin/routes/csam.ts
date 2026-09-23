/**
 * CSAM 事件：查看事件工单、员工手动标记、登记已向 NCMEC 报告。
 *
 * - 手动标记与扫描命中走同一条处置路径：隔离、证据保全、锁定上传者、写黑名单、
 *   创建事件工单；内容已被 Release 引用时入队下架。
 * - 登记报告后，证据的保全期限设为报告日期加 1 年，到期由专门任务删除。
 * - 事件记录永不删除。
 */
import { desc, eq } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import { appendAudit } from "../../audit/audit.js";
import { csamIncidents } from "../../db/schema/index.js";
import { problem } from "../../http/middleware.js";
import { CsamHitError, handleCsamHit } from "../../moderation/csam.js";
import { type AdminEnv, adminRoute } from "../app.js";
import { isUuid, staffActor } from "./common.js";

const EVIDENCE_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
const Reason = z.string().trim().min(10).max(2000);

export function registerCsam(app: Hono<AdminEnv>): void {
  adminRoute(app, {
    method: "get",
    path: "/v1/admin/csam-incidents",
    capability: "csam.read",
    handler: async (c) => {
      const rows = await c.var.services.db
        .select()
        .from(csamIncidents)
        .orderBy(desc(csamIncidents.createdAt))
        .limit(100);
      return c.json({
        items: rows.map((r) => ({
          id: r.id,
          upload_id: r.uploadId,
          blob_digest: r.blobDigest,
          reason: r.reason,
          status: r.status,
          ncmec_report_id: r.ncmecReportId,
          created_at: r.createdAt.toISOString(),
          evidence_expires_at: r.evidenceExpiresAt?.toISOString() ?? null,
        })),
      });
    },
  });

  // 手动标记需要能处置严重违规或法律事务的员工；只读查看事件的员工不能发起。
  adminRoute(app, {
    method: "post",
    path: "/v1/admin/csam/flag",
    capability: ["tombstone.policy", "legal.manage"],
    noLegalRequest: true,
    body: z.strictObject({
      blob_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
      reason: Reason,
    }),
    handler: async (c, { body }) => {
      const { db, cas, queue, ids, clock } = c.var.services;
      try {
        const out = await handleCsamHit(db, cas, queue, () => ids.uuid(), {
          blobDigest: body.blob_digest,
          reason: "staff_flag",
          actorId: c.var.staff.user_id,
          actorKind: "staff",
          now: clock.now(),
        });
        return c.json(
          {
            incident_id: out.incidentId,
            affected_releases: out.affectedReleases.length,
            blocked: out.blockedDigests.length,
          },
          201,
        );
      } catch (e) {
        if (e instanceof CsamHitError) return problem(c, 404, e.code);
        throw e;
      }
    },
  });

  adminRoute(app, {
    method: "post",
    path: "/v1/admin/csam-incidents/:id/report",
    capability: "csam.report",
    noLegalRequest: true,
    body: z.strictObject({ ncmec_report_id: z.string().trim().min(1).max(100), reason: Reason }),
    handler: async (c, { body }) => {
      const id = c.req.param("id");
      if (!isUuid(id)) return problem(c, 404, "not_found");
      const now = c.var.services.clock.now();
      const out = await c.var.services.db.transaction(async (tx) => {
        const [r] = await tx
          .select()
          .from(csamIncidents)
          .where(eq(csamIncidents.id, id))
          .for("update");
        if (!r) return 404 as const;
        if (r.status !== "open") return 409 as const;
        const expires = new Date(now.getTime() + EVIDENCE_RETENTION_MS);
        await tx
          .update(csamIncidents)
          .set({
            status: "reported",
            ncmecReportId: body.ncmec_report_id,
            reportedAt: now,
            evidenceExpiresAt: expires,
            updatedAt: now,
          })
          .where(eq(csamIncidents.id, id));
        await appendAudit(tx, {
          at: now,
          actor: staffActor(c),
          action: "csam.reported",
          subject: `csam_incident:${id}`,
          requestId: c.var.requestId,
          before: { status: r.status },
          after: {
            status: "reported",
            ncmec_report_id: body.ncmec_report_id,
            evidence_expires_at: expires.toISOString(),
          },
        });
        return 200 as const;
      });
      if (out === 404) return problem(c, 404, "not_found");
      if (out === 409) return problem(c, 409, "csam.already_reported");
      return c.json({ ok: true });
    },
  });
}
