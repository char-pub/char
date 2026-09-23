/**
 * 内容安全事件：CSAM 命中（扫描命中或员工手动标记）后的事件工单与证据保全记录。
 *
 * 证据对象存放在独立的 evidence 桶，不登记到 blob_refs，GC 看不到它们。按美国法律，
 * 向 NCMEC 报告后证据要保全 1 年：报告之前 evidence_expires_at 为空（不会被删除），
 * 报告时设为报告日期加 1 年，到期由专门任务删除。
 *
 * 应用角色对这张表只有 SELECT / INSERT / UPDATE，不能 DELETE：事件记录本身永不删除。
 */
import { index, text, uuid } from "drizzle-orm/pg-core";
import { app, createdAt, pk, ts, updatedAt } from "./common.js";
import { authUser } from "./identity.js";
import { uploads } from "./releases.js";

export const incidentStatusEnum = app.enum("incident_status", ["open", "reported", "closed"]);
export const incidentReasonEnum = app.enum("incident_reason", ["csam_scan", "staff_flag"]);

export const csamIncidents = app.table(
  "csam_incidents",
  {
    id: pk(),
    uploadId: uuid("upload_id").references(() => uploads.id),
    /** 涉事内容的 digest（原件或处理后的 blob）。 */
    blobDigest: text("blob_digest").notNull(),
    /** 上传者；锁定的就是这个账号。 */
    userId: uuid("user_id").references(() => authUser.id),
    reason: incidentReasonEnum("reason").notNull(),
    /** 扫描服务给出的匹配编号。 */
    matchId: text("match_id"),
    status: incidentStatusEnum("status").notNull().default("open"),
    ncmecReportId: text("ncmec_report_id"),
    reportedAt: ts("reported_at"),
    /** evidence 桶中的对象 key。 */
    evidenceKey: text("evidence_key").notNull(),
    evidenceExpiresAt: ts("evidence_expires_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("csam_incidents_status_idx").on(t.status, t.createdAt),
    index("csam_incidents_digest_idx").on(t.blobDigest),
  ],
);
