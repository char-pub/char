/**
 * 内容安全事件：CSAM 命中（扫描命中或员工手动标记）后的事件工单与证据保全记录。
 *
 * 证据对象存放在独立的 evidence 桶，不登记到 blob_refs，GC 看不到它们。按美国法律，
 * 向 NCMEC 报告后证据要保全 1 年：报告之前 evidence_expires_at 为空（不会被删除），
 * 报告时设为报告日期加 1 年，到期由专门任务删除。
 *
 * 应用角色对这张表只有 SELECT / INSERT / UPDATE，不能 DELETE：事件记录本身永不删除。
 */
import { index, integer, jsonb, text, uuid } from "drizzle-orm/pg-core";
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

/**
 * 需要两名员工的操作（四眼原则）：第一名员工发起，另一名具备相同能力的员工确认后才执行。
 * 只有一名合格员工时，发起人要等冷静期结束才能自己确认。
 */
export const approvalKindEnum = app.enum("staff_approval_kind", [
  "tombstone.large",
  "unban.csam",
  "staff.remove_owner",
  "namespace.transfer",
]);
export const approvalStatusEnum = app.enum("staff_approval_status", [
  "pending",
  "confirmed",
  "cancelled",
]);

export const staffApprovals = app.table(
  "staff_approvals",
  {
    id: pk(),
    kind: approvalKindEnum("kind").notNull(),
    /** 展示用的操作对象，例如 `user:<id>`、`creation:<id>`。 */
    subject: text("subject").notNull(),
    /** 执行时需要的参数（下架对象与原因代码、目标角色等）。 */
    payload: jsonb("payload").notNull(),
    reason: text("reason").notNull(),
    initiatedBy: uuid("initiated_by")
      .notNull()
      .references(() => authUser.id),
    initiatedAt: ts("initiated_at").notNull(),
    /** 发起时除发起人以外有资格确认的员工数量。 */
    otherEligibleStaff: integer("other_eligible_staff").notNull(),
    status: approvalStatusEnum("status").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => authUser.id),
    decidedAt: ts("decided_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("staff_approvals_status_idx").on(t.status, t.initiatedAt)],
);

/**
 * 下载隔离证据的一次性凭据。凭据本身只在签发时返回一次，这里只存它的 sha256；
 * 只能由签发给的员工在 5 分钟内使用一次，使用后记下时间，过期的由定期清理删除。
 */
export const evidenceDownloadTickets = app.table(
  "evidence_download_tickets",
  {
    tokenHash: text("token_hash").primaryKey(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => csamIncidents.id),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => authUser.id),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdAt: createdAt(),
  },
  (t) => [index("evidence_download_tickets_expires_idx").on(t.expiresAt)],
);
