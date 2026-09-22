/**
 * char.pub HTTP API 的请求与响应 schema。server 用它校验输入，web / CLI / Action 用它
 * 构造请求并解析响应，OpenAPI 文档也由它生成。
 *
 * 约定：
 * - 基础路径 `/v1`；错误统一是 `application/problem+json`，带稳定的 `code`。
 * - 列表用 cursor 分页，单页最多 100 条。
 * - 发布接口必须带 `Idempotency-Key` 头；草稿编辑用 `If-Match` 乐观锁。
 */
import {
  CreationTypeSchema,
  DigestSchema,
  GitCommitSchema,
  LabelSchema,
  LocalizedTextSchema,
  NAME_RE,
  NAMESPACE_RE,
  RatingSchema,
  UnversionedRefSchema,
} from "@char-pub/core";
import { z } from "zod";

export const API_VERSION = "v1";

// ---------------------------------------------------------------------------
// 通用
// ---------------------------------------------------------------------------

export const ProblemSchema = z.looseObject({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
  detail: z.string().optional(),
  instance: z.string().optional(),
});
export type Problem = z.infer<typeof ProblemSchema>;

export const PageQuerySchema = z.strictObject({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const pageOf = <T extends z.ZodType>(item: T) =>
  z.strictObject({ items: z.array(item), next_cursor: z.string().nullable() });

export const NamespaceSlugSchema = z.string().regex(NAMESPACE_RE);
export const CreationNameSchema = z.string().regex(NAME_RE);

// ---------------------------------------------------------------------------
// Namespace 与 Creation
// ---------------------------------------------------------------------------

export const CreateNamespaceRequestSchema = z.strictObject({ slug: NamespaceSlugSchema });

export const NamespaceSchema = z.strictObject({
  slug: NamespaceSlugSchema,
  kind: z.enum(["user", "org", "system"]),
  status: z.enum(["active", "suspended"]),
});

export const CreateCreationRequestSchema = z.strictObject({
  name: CreationNameSchema,
  type: CreationTypeSchema,
  display_name: LocalizedTextSchema,
});

export const ReleaseSummarySchema = z.strictObject({
  id: z.string(),
  label: LabelSchema,
  visibility: z.enum(["public", "private"]),
  status: z.enum(["active", "yanked", "tombstoned"]),
  status_reason: z.string().optional(),
  semantic_digest: DigestSchema,
  effective_rating: RatingSchema,
  created_at: z.string(),
});
export type ReleaseSummary = z.infer<typeof ReleaseSummarySchema>;

export const CreationSummarySchema = z.strictObject({
  id: z.string(),
  ref: UnversionedRefSchema,
  type: CreationTypeSchema,
  display_name: LocalizedTextSchema,
  summary: LocalizedTextSchema.optional(),
  rating: RatingSchema,
  /** 最新 public Release 的 effective rating：包含依赖和 asset 后的最高分级。 */
  effective_rating: RatingSchema.optional(),
  tags: z.array(z.string()),
  latest_release: ReleaseSummarySchema.optional(),
});
export type CreationSummary = z.infer<typeof CreationSummarySchema>;

export const CreationDetailSchema = CreationSummarySchema.extend({
  releases: z.array(ReleaseSummarySchema),
  /** 被多少个其他 Creation 的 Release 依赖。 */
  dependents_count: z.number().int().nonnegative(),
  contribution_policy: z.enum(["anyone", "signed-in", "invited", "closed"]),
  /** 当前 Release 被 yank 时附带的提示。 */
  warning: z.string().optional(),
});
export type CreationDetail = z.infer<typeof CreationDetailSchema>;

// ---------------------------------------------------------------------------
// 草稿、Revision、发布
// ---------------------------------------------------------------------------

/** 草稿内容是任意书写形式的 Creation，由服务端 canonicalize 并校验。 */
export const DraftSchema = z.strictObject({
  version: z.number().int().nonnegative(),
  working: z.unknown(),
  base_revision_id: z.string().nullable(),
  updated_at: z.string(),
});
export type Draft = z.infer<typeof DraftSchema>;

export const PutDraftRequestSchema = z.strictObject({ working: z.unknown() });

export const CreateRevisionRequestSchema = z.strictObject({
  message: z.string().max(500).optional(),
});

export const RevisionSchema = z.strictObject({
  id: z.string(),
  semantic_digest: DigestSchema,
  message: z.string().optional(),
  created_at: z.string(),
});

export const PublishRequestSchema = z.strictObject({
  revision: z.string(),
  label: LabelSchema,
  visibility: z.enum(["public", "private"]),
});

export const PublishIssueSchema = z.strictObject({
  code: z.string(),
  subject: z.string(),
  severity: z.enum(["error", "warning"]),
  detail: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

/** 发布是异步的：先占用 label，worker 完成校验和构建后才进入 active。 */
export const PublishResponseSchema = z.strictObject({
  release: z.string(),
  state: z.enum(["pending", "active", "failed"]),
  /** 同一 label 已经发布过相同内容。 */
  idempotent: z.boolean(),
  report: z
    .strictObject({
      issues: z.array(PublishIssueSchema),
      license_check: z.enum(["pass", "warn", "fail"]),
    })
    .optional(),
});
export type PublishResponse = z.infer<typeof PublishResponseSchema>;

// ---------------------------------------------------------------------------
// GitHub OIDC 发布
// ---------------------------------------------------------------------------

/**
 * Action 调用 `/v1/publish/oidc` 时的请求体。认证用 `Authorization: Bearer <GitHub OIDC token>`。
 * Registry 不采信这里的 digest：它会用 GitHub App 在 `commit` 处重新读取源文件并重新计算，
 * 不一致就拒绝发布。
 */
export const OidcPublishRequestSchema = z.strictObject({
  creation: UnversionedRefSchema,
  label: LabelSchema,
  visibility: z.enum(["public", "private"]),
  commit: GitCommitSchema,
  /** 仓库内 char.yaml 的路径。 */
  path: z.string().min(1).max(512),
  /** Action 本地算出的 semantic digest，只用于比对，便于尽早发现不一致。 */
  semantic_digest: DigestSchema,
});
export type OidcPublishRequest = z.infer<typeof OidcPublishRequestSchema>;

// ---------------------------------------------------------------------------
// 上传
// ---------------------------------------------------------------------------

export const UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export const CreateUploadRequestSchema = z.strictObject({
  purpose: z.enum(["asset", "import"]),
  content_type: z.enum([...UPLOAD_TYPES, "application/json", "application/zip"]),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  sha256: DigestSchema,
});

export const CreateUploadResponseSchema = z.strictObject({
  upload: z.string(),
  /** 预签名 PUT URL，10 分钟内有效；必须按声明的长度与类型上传。 */
  put_url: z.string(),
  headers: z.record(z.string(), z.string()),
  expires_at: z.string(),
});

export const UploadStatusSchema = z.strictObject({
  upload: z.string(),
  status: z.enum(["uploaded", "processing", "ready", "rejected", "quarantined"]),
  reject_reason: z.string().optional(),
  /** ready 之后可以在 Creation 中引用的 blob。 */
  blob: z
    .strictObject({ digest: DigestSchema, size: z.number().int(), media_type: z.string() })
    .optional(),
});

// ---------------------------------------------------------------------------
// 搜索
// ---------------------------------------------------------------------------

export const SearchQuerySchema = PageQuerySchema.extend({
  q: z.string().trim().min(1).max(200).optional(),
  type: CreationTypeSchema.optional(),
  tag: z.string().max(64).optional(),
});

// ---------------------------------------------------------------------------
// 个人 Token
// ---------------------------------------------------------------------------

export const TOKEN_SCOPES = [
  "creations:read",
  "creations:write",
  "releases:publish",
  "contributions:write",
] as const;

export const CreateTokenRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.enum(TOKEN_SCOPES)).min(1),
  /** 最长一年。 */
  expires_in_days: z.number().int().min(1).max(365),
});

export const CreateTokenResponseSchema = z.strictObject({
  id: z.string(),
  /** 明文只在创建时返回一次，服务端只保存哈希。 */
  token: z.string().regex(/^cp_pat_[0-9A-Za-z]{43}$/),
  prefix: z.string(),
  expires_at: z.string(),
});
