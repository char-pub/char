/**
 * CSAM 事件的隔离证据：只有具备证据访问权限的员工（legal 与 owner）可以访问。
 *
 * - 默认只返回元数据：digest、大小、类型、保全期限、存储位置。
 * - 下载必须填写理由，先签发一个一次性凭据（5 分钟内、只能由签发给的员工使用一次），
 *   再用它下载。下载经过 admin 进程转发并重新校验内容 digest，不签发存储端的 URL：
 *   存储端的签名 URL 在有效期内谁拿到都能用，也无法限制只用一次。
 * - 响应一律是附件（`Content-Disposition: attachment`，类型 `application/octet-stream`），
 *   浏览器不会在页面里显示内容；admin SPA 也不提供任何预览。
 * - 签发与下载都写审计。
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import { appendAudit } from "../../audit/audit.js";
import { csamIncidents, evidenceDownloadTickets } from "../../db/schema/index.js";
import { problem } from "../../http/middleware.js";
import { CasError, evidenceDigest } from "../../storage/cas.js";
import { type AdminEnv, adminRoute } from "../app.js";
import { isUuid, staffActor } from "./common.js";

export const EVIDENCE_TICKET_TTL_MS = 5 * 60 * 1000;

function hashTicket(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function registerCsamEvidence(app: Hono<AdminEnv>): void {
  adminRoute(app, {
    method: "get",
    path: "/v1/admin/csam-incidents/:id/evidence",
    capability: "csam.evidence",
    handler: async (c) => {
      const id = c.req.param("id");
      if (!isUuid(id)) return problem(c, 404, "not_found");
      const [r] = await c.var.services.db
        .select()
        .from(csamIncidents)
        .where(eq(csamIncidents.id, id));
      if (!r) return problem(c, 404, "not_found");
      const head = await c.var.services.cas.headEvidence(r.evidenceKey);
      return c.json({
        incident_id: r.id,
        evidence_digest: evidenceDigest(r.evidenceKey),
        blob_digest: r.blobDigest,
        size: head?.size ?? null,
        media_type: head?.mediaType ?? null,
        present: head !== null,
        storage: { bucket: "evidence", key: r.evidenceKey },
        /** 报告之前为 null：证据不会被删除。 */
        retain_until: r.evidenceExpiresAt?.toISOString() ?? null,
      });
    },
  });

  adminRoute(app, {
    method: "post",
    path: "/v1/admin/csam-incidents/:id/evidence/download",
    capability: "csam.evidence",
    noLegalRequest: true,
    body: z.strictObject({ reason: z.string().trim().min(10).max(2000) }),
    handler: async (c, { body }) => {
      const id = c.req.param("id");
      if (!isUuid(id)) return problem(c, 404, "not_found");
      const now = c.var.services.clock.now();
      const token = randomBytes(32).toString("base64url");
      const expires = new Date(now.getTime() + EVIDENCE_TICKET_TTL_MS);
      const found = await c.var.services.db.transaction(async (tx) => {
        const [r] = await tx
          .select({ id: csamIncidents.id })
          .from(csamIncidents)
          .where(eq(csamIncidents.id, id));
        if (!r) return false;
        await tx.insert(evidenceDownloadTickets).values({
          tokenHash: hashTicket(token),
          incidentId: id,
          staffId: c.var.staff.user_id,
          expiresAt: expires,
          createdAt: now,
        });
        await appendAudit(tx, {
          at: now,
          actor: staffActor(c),
          action: "csam.evidence_ticket",
          subject: `csam_incident:${id}`,
          requestId: c.var.requestId,
          after: { reason: body.reason, expires_at: expires.toISOString() },
        });
        return true;
      });
      if (!found) return problem(c, 404, "not_found");
      return c.json(
        { url: `/v1/admin/csam-evidence/${token}`, expires_at: expires.toISOString() },
        201,
      );
    },
  });

  adminRoute(app, {
    method: "get",
    path: "/v1/admin/csam-evidence/:ticket",
    capability: "csam.evidence",
    handler: async (c) => {
      const token = c.req.param("ticket") ?? "";
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return problem(c, 404, "evidence.ticket_invalid");
      const now = c.var.services.clock.now();
      const { db, cas } = c.var.services;
      // 用一条条件更新消耗凭据：并发的两次请求只有一次能成功。
      const [used] = await db
        .update(evidenceDownloadTickets)
        .set({ usedAt: now })
        .where(
          and(
            eq(evidenceDownloadTickets.tokenHash, hashTicket(token)),
            eq(evidenceDownloadTickets.staffId, c.var.staff.user_id),
            isNull(evidenceDownloadTickets.usedAt),
            gt(evidenceDownloadTickets.expiresAt, now),
          ),
        )
        .returning({ incidentId: evidenceDownloadTickets.incidentId });
      if (!used) return problem(c, 404, "evidence.ticket_invalid");
      const [r] = await db
        .select()
        .from(csamIncidents)
        .where(eq(csamIncidents.id, used.incidentId));
      if (!r) return problem(c, 404, "not_found");
      let bytes: Uint8Array;
      try {
        bytes = await cas.getEvidence(r.evidenceKey);
      } catch (e) {
        if (e instanceof CasError && e.code === "cas.not_found") {
          return problem(c, 410, "evidence.gone");
        }
        throw e;
      }
      await db.transaction((tx) =>
        appendAudit(tx, {
          at: now,
          actor: staffActor(c),
          action: "csam.evidence_download",
          subject: `csam_incident:${r.id}`,
          requestId: c.var.requestId,
          after: { evidence_digest: evidenceDigest(r.evidenceKey), size: bytes.byteLength },
        }),
      );
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          "content-disposition": `attachment; filename="evidence-${r.id}.bin"`,
          "content-length": String(bytes.byteLength),
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    },
  });
}
