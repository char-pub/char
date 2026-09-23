/**
 * GitHub Source：App 安装、仓库绑定、webhook 去重与 OIDC 防重放。
 *
 * 绑定一律使用 GitHub 的数字 ID（repository_id / repository_owner_id），仓库名只用于展示。
 * 这样仓库改名后，别人新建的同名仓库无法冒用原绑定发布。
 */
import { bigint, boolean, index, jsonb, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { app, createdAt, pk, ts, updatedAt } from "./common.js";
import { creations } from "./creations.js";

export const githubAccountTypeEnum = app.enum("github_account_type", ["User", "Organization"]);
export const bindingStatusEnum = app.enum("binding_status", ["active", "frozen", "unbound"]);
export const webhookStatusEnum = app.enum("webhook_status", [
  "received",
  "processed",
  "failed",
  "ignored",
]);

export const githubInstallations = app.table("github_installations", {
  installationId: bigint("installation_id", { mode: "bigint" }).primaryKey(),
  accountId: bigint("account_id", { mode: "bigint" }).notNull(),
  accountLogin: text("account_login").notNull(),
  accountType: githubAccountTypeEnum("account_type").notNull(),
  suspendedAt: ts("suspended_at"),
  removedAt: ts("removed_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sourceBindings = app.table(
  "source_bindings",
  {
    id: pk(),
    creationId: uuid("creation_id")
      .notNull()
      .references(() => creations.id),
    repositoryId: bigint("repository_id", { mode: "bigint" }).notNull(),
    repositoryOwnerId: bigint("repository_owner_id", { mode: "bigint" }).notNull(),
    installationId: bigint("installation_id", { mode: "bigint" })
      .notNull()
      .references(() => githubInstallations.installationId),
    path: text("path").notNull(),
    trackedRef: text("tracked_ref").notNull(),
    publishRefs: text("publish_refs").array().notNull(),
    displayFullName: text("display_full_name").notNull(),
    /** 仓库转移给其他 owner 后进入 frozen，等作者确认重新绑定或换用新仓库。 */
    status: bindingStatusEnum("status").notNull().default("active"),
    frozenReason: text("frozen_reason"),
    lastSeenCommit: text("last_seen_commit"),
    /** 最近一次同步时对 char.yaml 的检查结果（诊断列表），只做提示，不会触发发布。 */
    lastCheck: jsonb("last_check"),
    lastCheckedAt: ts("last_checked_at"),
    /** 可选的发布约束：要求 ref 受保护、要求 job 使用某个 environment 或官方 workflow。 */
    requireRefProtected: boolean("require_ref_protected").notNull().default(false),
    environment: text("environment"),
    jobWorkflowRef: text("job_workflow_ref"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("source_bindings_creation_uq").on(t.creationId),
    index("source_bindings_repo_idx").on(t.repositoryId),
  ],
);

/** 按 delivery ID 去重：GitHub 可能重复投递同一事件。 */
export const webhookDeliveries = app.table("webhook_deliveries", {
  deliveryId: text("delivery_id").primaryKey(),
  event: text("event").notNull(),
  receivedAt: createdAt(),
  processedAt: ts("processed_at"),
  status: webhookStatusEnum("status").notNull().default("received"),
});

/** 已使用的 OIDC token jti，保留到过期之后，防止重放。 */
export const oidcJti = app.table("oidc_jti", {
  jti: text("jti").primaryKey(),
  expiresAt: ts("expires_at").notNull(),
});
