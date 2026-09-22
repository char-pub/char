/**
 * Release、依赖闭包、反向依赖与内容寻址存储索引。
 *
 * Release 除 status / status_reason 外不可修改。依赖闭包、反向依赖和闭包中的 fragment
 * 都在发布时物化，这样"谁依赖了它"和"下架某个 fragment 会影响哪些 Release"
 * 都能直接查表回答，不需要递归解析。
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  app,
  blobKindEnum,
  blobStatusEnum,
  createdAt,
  edgeModeEnum,
  pk,
  publishStateEnum,
  ratingEnum,
  releaseStatusEnum,
  scanStatusEnum,
  ts,
  updatedAt,
  uploadStatusEnum,
  visibilityEnum,
} from "./common.js";
import { creations, revisions } from "./creations.js";
import { authUser } from "./identity.js";

export const releaseAvailabilityEnum = app.enum("release_availability", ["complete", "linked"]);
export const licenseCheckEnum = app.enum("license_check", ["pass", "warn"]);

export const releases = app.table(
  "releases",
  {
    id: pk(),
    creationId: uuid("creation_id")
      .notNull()
      .references(() => creations.id),
    label: text("label").notNull(),
    visibility: visibilityEnum("visibility").notNull(),
    status: releaseStatusEnum("status").notNull().default("active"),
    statusReason: text("status_reason"),
    /** 发布任务的内部状态；pending / failed 不作为 Release 状态对外暴露。 */
    publishState: publishStateEnum("publish_state").notNull().default("pending"),
    publishReport: jsonb("publish_report"),
    revisionId: uuid("revision_id").references(() => revisions.id),
    source: jsonb("source").notNull(),
    sourceDigest: text("source_digest"),
    semanticDigest: text("semantic_digest").notNull(),
    lockDigest: text("lock_digest"),
    snapshotDigest: text("snapshot_digest"),
    contextIrDigest: text("context_ir_digest"),
    availability: releaseAvailabilityEnum("availability"),
    effectiveRating: ratingEnum("effective_rating"),
    licenseCheck: licenseCheckEnum("license_check"),
    /** 用户 id 或 OIDC claim。 */
    publishedBy: jsonb("published_by").notNull(),
    /** 发布请求的 Idempotency-Key：同一 key 重复请求返回同一结果。 */
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("releases_creation_label_uq").on(t.creationId, t.label),
    index("releases_semantic_idx").on(t.semanticDigest),
    check("releases_label_syntax", sql`${t.label} ~ '^[0-9A-Za-z.+-]{1,64}$'`),
  ],
);

/** 完整依赖闭包。 */
export const releaseLocks = app.table(
  "release_locks",
  {
    releaseId: uuid("release_id")
      .notNull()
      .references(() => releases.id, { onDelete: "cascade" }),
    depCreationId: uuid("dep_creation_id")
      .notNull()
      .references(() => creations.id),
    depReleaseId: uuid("dep_release_id")
      .notNull()
      .references(() => releases.id),
    semanticDigest: text("semantic_digest").notNull(),
    via: jsonb("via").notNull(),
  },
  (t) => [primaryKey({ columns: [t.releaseId, t.depCreationId] })],
);

/** 反向依赖：发布时写入，用来回答"谁用了这个 Creation"。 */
export const reverseEdges = app.table(
  "reverse_edges",
  {
    depCreationId: uuid("dep_creation_id")
      .notNull()
      .references(() => creations.id),
    depReleaseId: uuid("dep_release_id")
      .notNull()
      .references(() => releases.id),
    dependentCreationId: uuid("dependent_creation_id")
      .notNull()
      .references(() => creations.id),
    dependentReleaseId: uuid("dependent_release_id")
      .notNull()
      .references(() => releases.id, { onDelete: "cascade" }),
    mode: edgeModeEnum("mode").notNull(),
    rel: text("rel"),
  },
  (t) => [
    primaryKey({ columns: [t.depReleaseId, t.dependentReleaseId] }),
    index("reverse_edges_dep_creation_idx").on(t.depCreationId),
    index("reverse_edges_dependent_idx").on(t.dependentReleaseId),
  ],
);

/** 闭包中的全部 fragment，下架某个 fragment 时用它找出所有受影响的 Release。 */
export const releaseFragments = app.table(
  "release_fragments",
  {
    releaseId: uuid("release_id")
      .notNull()
      .references(() => releases.id, { onDelete: "cascade" }),
    ownerRef: text("owner_ref").notNull(),
    fragmentId: text("fragment_id").notNull(),
    digest: text("digest").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.releaseId, t.ownerRef, t.fragmentId] }),
    index("release_fragments_digest_idx").on(t.digest),
  ],
);

/** 构建产物缓存；key 由 semantic digest、lock digest、目标格式和编译器版本组成。 */
export const buildArtifacts = app.table("build_artifacts", {
  cacheKey: text("cache_key").primaryKey(),
  target: text("target").notNull(),
  blobDigest: text("blob_digest").notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// 内容寻址存储
// ---------------------------------------------------------------------------

/** 对象存储中每个 blob 的元数据；digest 同时是对象 key。 */
export const blobs = app.table(
  "blobs",
  {
    digest: text("digest").primaryKey(),
    size: bigint("size", { mode: "number" }).notNull(),
    mediaType: text("media_type").notNull(),
    kind: blobKindEnum("kind").notNull(),
    inPublic: boolean("in_public").notNull().default(false),
    inPrivate: boolean("in_private").notNull().default(false),
    status: blobStatusEnum("status").notNull().default("present"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("blobs_digest_syntax", sql`${t.digest} ~ '^sha256:[0-9a-f]{64}$'`)],
);

/** blob 的反向引用：覆盖 Release 闭包中的 fragment、快照、IR、导出物和源上传物。 */
export const blobRefs = app.table(
  "blob_refs",
  {
    digest: text("digest").notNull(),
    releaseId: uuid("release_id")
      .notNull()
      .references(() => releases.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.digest, t.releaseId, t.role] }),
    index("blob_refs_digest_idx").on(t.digest),
    index("blob_refs_release_idx").on(t.releaseId),
  ],
);

/** 被下架内容的哈希黑名单，阻止同样的内容重新上传或发布。 */
export const blockedDigests = app.table("blocked_digests", {
  digest: text("digest").primaryKey(),
  reason: text("reason").notNull(),
  actionId: uuid("action_id"),
  createdAt: createdAt(),
});

/** 上传状态机：只有 ready 的上传可以被 Release 引用。 */
export const uploads = app.table(
  "uploads",
  {
    id: pk(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => authUser.id),
    status: uploadStatusEnum("status").notNull().default("uploaded"),
    declaredType: text("declared_type").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    stagingKey: text("staging_key").notNull(),
    result: jsonb("result"),
    rejectReason: text("reject_reason"),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("uploads_owner_idx").on(t.ownerUserId),
    index("uploads_status_idx").on(t.status, t.expiresAt),
  ],
);

export const assetMeta = app.table("asset_meta", {
  digest: text("digest").primaryKey(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  mediaType: text("media_type").notNull(),
  scanStatus: scanStatusEnum("scan_status").notNull().default("not_scanned"),
  scanProvider: text("scan_provider"),
  scannedAt: ts("scanned_at"),
  createdAt: createdAt(),
});
