/**
 * 数据库 schema 的公共部分：所有业务表都放在 Postgres schema `app` 下，
 * 任务队列（pg-boss）使用独立的 `pgboss` schema。
 *
 * 约定：
 * - 主键是 uuid，值由应用生成（UUIDv7，按时间有序）；对外编码成带前缀的 TypeID。
 * - 所有表都有 created_at；可变的表再加 updated_at。软状态用 status 列，不做物理删除。
 * - 时间一律 timestamptz。
 */
import { sql } from "drizzle-orm";
import { pgSchema, timestamp, uuid } from "drizzle-orm/pg-core";

export const app = pgSchema("app");

export const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** uuid 主键，由应用传入 UUIDv7。 */
export const pk = () => uuid("id").primaryKey();

/** 空数组默认值，用于 text[] 列。 */
export const emptyTextArray = sql`'{}'::text[]`;

// ---------------------------------------------------------------------------
// 枚举
// ---------------------------------------------------------------------------

export const ratingEnum = app.enum("rating", ["general", "teen", "mature", "explicit"]);
export const creationTypeEnum = app.enum("creation_type", [
  "character",
  "world",
  "lorebook",
  "relationship",
  "scenario",
  "persona",
  "style",
  "preset",
]);
export const fragmentKindEnum = app.enum("fragment_kind", [
  "character",
  "persona",
  "relationship",
  "world",
  "scenario",
  "knowledge",
  "style",
  "examples",
  "instruction",
]);
export const visibilityEnum = app.enum("visibility", ["public", "private"]);
export const releaseStatusEnum = app.enum("release_status", ["active", "yanked", "tombstoned"]);
/** 发布任务的内部状态；对外只暴露 Release 的三种状态。 */
export const publishStateEnum = app.enum("publish_state", ["pending", "done", "failed"]);
export const contributionPolicyEnum = app.enum("contribution_policy", [
  "anyone",
  "signed-in",
  "invited",
  "closed",
]);
export const edgeModeEnum = app.enum("edge_mode", ["intrinsic", "default"]);
export const blobKindEnum = app.enum("blob_kind", [
  "fragment",
  "manifest",
  "snapshot",
  "ir",
  "export",
  "asset",
  "thumbnail",
  "upload",
]);
export const blobStatusEnum = app.enum("blob_status", ["present", "withheld", "purged"]);
export const uploadStatusEnum = app.enum("upload_status", [
  "uploaded",
  "processing",
  "ready",
  "rejected",
  "quarantined",
]);
export const scanStatusEnum = app.enum("scan_status", ["not_scanned", "clean", "matched", "error"]);
