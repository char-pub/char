/**
 * 审核、法律请求、运维开关与审计日志。
 *
 * audit_log 只允许追加：应用角色对它只有 INSERT / SELECT 权限；每条记录的 hash
 * 覆盖上一条的 hash，形成哈希链，任何篡改或删除都能被校验工具发现。
 */
import { sql } from "drizzle-orm";
import { bigserial, boolean, check, index, jsonb, text, uuid } from "drizzle-orm/pg-core";
import { app, createdAt, pk, ts, updatedAt } from "./common.js";
import { authUser } from "./identity.js";

export const reportStatusEnum = app.enum("report_status", [
  "open",
  "claimed",
  "resolved",
  "dismissed",
]);
export const legalKindEnum = app.enum("legal_kind", ["dmca", "court", "gdpr", "other"]);
export const legalStatusEnum = app.enum("legal_status", [
  "received",
  "reviewing",
  "actioned",
  "rejected",
  "counter_noticed",
  "closed",
]);

export const reports = app.table(
  "reports",
  {
    id: pk(),
    /** 举报人：`{ user }`、`{ guest }` 或 `{ anon: ip_hash }`。 */
    reporter: jsonb("reporter").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    category: text("category").notNull(),
    details: text("details"),
    status: reportStatusEnum("status").notNull().default("open"),
    assignee: uuid("assignee").references(() => authUser.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("reports_status_idx").on(t.status, t.createdAt)],
);

/** 法律请求。requester 与 counter_notice 在应用层加密后存储，只有 legal 角色可读。 */
export const legalRequests = app.table("legal_requests", {
  id: pk(),
  kind: legalKindEnum("kind").notNull(),
  requester: jsonb("requester").notNull(),
  receivedAt: ts("received_at").notNull(),
  subjects: jsonb("subjects").notNull(),
  status: legalStatusEnum("status").notNull().default("received"),
  deadline: ts("deadline"),
  counterNotice: jsonb("counter_notice"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** 每次处置的业务记录（与审计日志互相引用）。 */
export const moderationActions = app.table(
  "moderation_actions",
  {
    id: pk(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => authUser.id),
    action: text("action").notNull(),
    subject: jsonb("subject").notNull(),
    reason: text("reason").notNull(),
    legalRequestId: uuid("legal_request_id").references(() => legalRequests.id),
    params: jsonb("params"),
    blastRadius: jsonb("blast_radius"),
    revertedBy: uuid("reverted_by"),
    createdAt: createdAt(),
  },
  (t) => [check("moderation_reason_len", sql`char_length(${t.reason}) >= 10`)],
);

/** 运行开关（kill switch）。enabled = false 时对应功能关闭。 */
export const featureFlags = app.table("feature_flags", {
  key: text("key").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  reason: text("reason"),
  updatedBy: uuid("updated_by").references(() => authUser.id),
  updatedAt: updatedAt(),
});

export const auditLog = app.table(
  "audit_log",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    at: ts("at").notNull(),
    /** `{ kind: user | staff | system | oidc, id }`。 */
    actor: jsonb("actor").notNull(),
    action: text("action").notNull(),
    subject: text("subject").notNull(),
    requestId: text("request_id"),
    ipHash: text("ip_hash"),
    /** 只记录字段差异，不含正文内容。 */
    before: jsonb("before"),
    after: jsonb("after"),
    prevHash: text("prev_hash"),
    hash: text("hash").notNull(),
  },
  (t) => [index("audit_log_subject_idx").on(t.subject), index("audit_log_at_idx").on(t.at)],
);

/**
 * 任务效果的幂等记录。任务处理函数在产生效果的同一个事务里写入幂等 key；
 * 同一个任务被重复投递时看到 key 已存在，就直接跳过。
 */
export const jobEffects = app.table("job_effects", {
  key: text("key").primaryKey(),
  jobName: text("job_name").notNull(),
  createdAt: createdAt(),
});
