/**
 * 角色卡导入（PNG / CHARX / JSON）。
 *
 * 一个上传只能导入一次（upload_id 唯一），重复提交返回同一个导入。导入成功后生成一个新的
 * Creation 与它的草稿；Import Report 存在 private 桶中，只有发起人能看到。
 *
 * 卡片不声明评级、权利与许可，导入时只能填保守的占位值，列在 needs_confirmation 里。
 * 发起人确认之前（confirmed_at 为空），这个 Creation 不能发布。
 */
import { sql } from "drizzle-orm";
import { index, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { app, createdAt, emptyTextArray, pk, ts, updatedAt } from "./common.js";
import { creations, namespaces } from "./creations.js";
import { authUser } from "./identity.js";
import { uploads } from "./releases.js";

export const importStatusEnum = app.enum("import_status", [
  "pending",
  "processing",
  "succeeded",
  "failed",
]);

export const imports = app.table(
  "imports",
  {
    id: pk(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => authUser.id),
    uploadId: uuid("upload_id")
      .notNull()
      .references(() => uploads.id),
    namespaceId: uuid("namespace_id")
      .notNull()
      .references(() => namespaces.id),
    /** 要创建的 Creation 的名字。 */
    name: text("name").notNull(),
    status: importStatusEnum("status").notNull().default("pending"),
    /** 失败时的稳定错误码（`import.*`），detail 是解析器给出的具体原因。 */
    errorCode: text("error_code"),
    errorDetail: text("error_detail"),
    creationId: uuid("creation_id").references(() => creations.id),
    /** 作者显式转换并确认的独立 Policy 草稿。 */
    policyPresetId: uuid("policy_preset_id").references(() => creations.id),
    /** 原件的 digest（private 桶）。 */
    sourceDigest: text("source_digest"),
    /** Import Report 的 digest（private 桶，JCS 编码）。 */
    reportDigest: text("report_digest"),
    needsConfirmation: text("needs_confirmation").array().notNull().default(emptyTextArray),
    confirmedAt: ts("confirmed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("imports_upload_uq").on(t.uploadId),
    index("imports_owner_idx").on(t.ownerUserId),
    index("imports_creation_idx").on(t.creationId),
    // 同一个名字同时只能有一个进行中的导入。
    uniqueIndex("imports_pending_name_uq")
      .on(t.namespaceId, t.name)
      .where(sql`${t.status} in ('pending', 'processing')`),
  ],
);
