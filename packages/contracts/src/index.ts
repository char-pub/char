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
  SpdxExpressionSchema,
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
  /** 只返回这个 namespace（当前的 slug，不带 `@`）下的作品，用于作者主页。 */
  ns: NamespaceSlugSchema.optional(),
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
  /** 给 Agent 使用：用它提交的 Contribution 一律标记为 agent。 */
  agent: z.boolean().optional(),
});

export const CreateTokenResponseSchema = z.strictObject({
  id: z.string(),
  /** 明文只在创建时返回一次，服务端只保存哈希。 */
  token: z.string().regex(/^cp_pat_[0-9A-Za-z]{43}$/),
  prefix: z.string(),
  expires_at: z.string(),
});

// ---------------------------------------------------------------------------
// 当前用户与账号设置
// ---------------------------------------------------------------------------

export const UserSettingsSchema = z.strictObject({
  /** 是否显示 mature / explicit 内容。开启时必须确认已满 18 岁。 */
  show_mature: z.boolean(),
  /** 确认的时间；关闭后为 null。 */
  mature_confirmed_at: z.string().nullable(),
  locale: z.string().nullable(),
});
export type UserSettings = z.infer<typeof UserSettingsSchema>;

export const MeSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  image: z.string().nullable(),
  /** 当前用户的个人 namespace；还没有注册时为 null。 */
  namespace: NamespaceSlugSchema.nullable(),
  settings: UserSettingsSchema,
});
export type Me = z.infer<typeof MeSchema>;

export const UpdateSettingsRequestSchema = z
  .strictObject({
    show_mature: z.boolean(),
    /** 开启成人内容时必须为 true：用户自我声明已满 18 岁。 */
    confirm_adult: z.boolean().optional(),
  })
  .refine((v) => !v.show_mature || v.confirm_adult === true, {
    message: "turning on mature content requires confirm_adult: true",
    path: ["confirm_adult"],
  });

/** `GET …/dependents` 列表中的一项。 */
export const DependentSchema = z.strictObject({
  ref: UnversionedRefSchema,
  type: CreationTypeSchema,
  display_name: LocalizedTextSchema,
  release: z.strictObject({ id: z.string(), label: LabelSchema }),
  mode: z.enum(["intrinsic", "default"]),
  rel: z.string().optional(),
});
export type Dependent = z.infer<typeof DependentSchema>;

/** 草稿保存的响应：新的版本号、内容 digest 与检查规则给出的警告。 */
export const PutDraftResponseSchema = z.strictObject({
  version: z.number().int(),
  semantic_digest: DigestSchema,
  warnings: z.array(
    z.strictObject({
      code: z.string(),
      subject: z.string(),
      severity: z.enum(["error", "warning", "info"]),
      detail: z.string().optional(),
    }),
  ),
});
export type PutDraftResponse = z.infer<typeof PutDraftResponseSchema>;

/** `GET /v1/me/creations`：当前用户所在 namespace 的全部 Creation，包括还没有发布的草稿。 */
export const MyCreationSchema = z.strictObject({
  ref: UnversionedRefSchema,
  type: CreationTypeSchema,
  display_name: LocalizedTextSchema,
  status: z.enum(["active", "hidden", "suspended"]),
  latest_release: z
    .strictObject({
      label: LabelSchema,
      visibility: z.enum(["public", "private"]),
      status: z.enum(["active", "yanked", "tombstoned"]),
    })
    .nullable(),
  draft_updated_at: z.string().nullable(),
});
export type MyCreation = z.infer<typeof MyCreationSchema>;
export const MyCreationsResponseSchema = z.strictObject({ items: z.array(MyCreationSchema) });

/** `GET …/releases/:label`：Release 的详细信息。 */
export const ReleaseDetailSchema = ReleaseSummarySchema.extend({
  ref: UnversionedRefSchema,
  creation: z.string(),
  lock_digest: DigestSchema.nullable(),
  context_ir_digest: DigestSchema.nullable(),
  license_check: z.enum(["pass", "warn", "fail"]).nullable(),
  availability: z.enum(["complete", "linked"]).nullable(),
  warning: z.string().optional(),
});
export type ReleaseDetail = z.infer<typeof ReleaseDetailSchema>;
// Contribution
// ---------------------------------------------------------------------------

export const RightsAckSchema = z.union([
  z.strictObject({ inbound_equals_outbound: z.literal(true) }),
  z.strictObject({ explicit_grant: z.literal(true) }),
]);

/**
 * 提交 Contribution。`changes` 的每一项按 Canonical Model 的变更格式由服务端解析；
 * 变更是否敏感由服务端按字段计算，客户端提交的 `sensitive` 不被采信。
 */
export const CreateContributionRequestSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20000).optional(),
  base_revision: z.string(),
  changes: z.array(z.unknown()).min(1).max(200),
  rights_ack: RightsAckSchema,
  /** 声明这是 Agent 提交的。Agent Token 提交的一律是 agent，不能改成 false。 */
  agent: z.boolean().optional(),
});

export const ContributionQuerySchema = PageQuerySchema.extend({
  status: z.enum(["open", "accepted", "rejected", "withdrawn"]).optional(),
  agent: z.enum(["true", "false"]).optional(),
});

export const MergePreviewSchema = z.strictObject({
  key: z.string(),
  on: z.enum(["fragment", "edge", "asset", "metadata"]),
  op: z.string(),
  state: z.enum(["applied", "already_applied", "conflict"]),
  sensitive: z.boolean(),
  reason: z.enum(["diverged", "slot_missing"]).optional(),
});

/** 登录用户附带显示名与个人 namespace（`@slug`，有则给），不包含邮箱。 */
export const ContributionAuthorSchema = z.union([
  z.strictObject({
    user: z.string(),
    display_name: z.string().optional(),
    namespace: z.string().optional(),
  }),
  z.strictObject({ guest_id: z.string(), display_name: z.string() }),
]);

export const ContributionSummarySchema = z.strictObject({
  id: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
  status: z.enum(["open", "accepted", "rejected", "withdrawn"]),
  agent: z.boolean(),
  author: ContributionAuthorSchema,
  base_revision: z.string(),
  created_at: z.string(),
  decided_at: z.string().nullable(),
});

export const ContributionDetailSchema = ContributionSummarySchema.extend({
  description: z.string().optional(),
  changes: z.array(z.unknown()),
  /** 与作者当前草稿合并的预览；只有 open 状态才有。 */
  preview: z
    .strictObject({
      mergeable: z.boolean(),
      outcomes: z.array(MergePreviewSchema),
      conflicts: z.array(z.string()),
      /** 接受前必须逐项确认的敏感变更键。 */
      sensitive_keys: z.array(z.string()),
      /** 合并后的内容不合法（例如草稿已被改得与变更不兼容）时的错误码。 */
      error: z.string().optional(),
    })
    .nullable(),
  result_revision: z.string().nullable(),
  /**
   * 作者拒绝时填写的理由。只有 rejected 状态、并且记录了理由时才有；详情只对提交者和
   * 作品所在 namespace 的成员可见，列表不返回这个字段。
   */
  decision_reason: z.string().optional(),
});

export const AcceptContributionRequestSchema = z.strictObject({
  /** 逐项列出确认过的敏感变更键；不接受通配符。 */
  confirm_sensitive: z.array(z.string().min(1).max(300)).max(200).default([]),
});

export const RejectContributionRequestSchema = z.strictObject({
  reason: z.string().trim().min(1).max(2000),
});

/** 作者设置谁可以提交 Contribution。 */
export const ContributionSettingsRequestSchema = z.strictObject({
  policy: z.enum(["anyone", "signed-in", "invited", "closed"]),
});

/** 邀请时填写的个人 namespace：`@slug` 或 `slug`。 */
export const InviteNamespaceSchema = z
  .string()
  .regex(new RegExp(`^@?${NAMESPACE_RE.source.slice(1)}`), "not a namespace");

/**
 * policy 为 invited 时邀请一个用户，二选一：`user` 是用户 ID（`usr_…`），`namespace` 是对方的
 * 个人 namespace（`@slug` 或 `slug`，改过名的旧名同样可以）。按 namespace 邀请只有作品的成员
 * 能用，只会解析出个人 namespace 的 owner；不提供单独的“按名字查用户”接口，免得被用来枚举账号。
 */
export const ContributionInviteRequestSchema = z.union([
  z.strictObject({ user: z.string().min(1).max(64) }),
  z.strictObject({ namespace: InviteNamespaceSchema }),
]);

/** 邀请或取消邀请的结果：被邀请人的用户 ID 与个人 namespace（`@slug`，没有时为 null）。 */
export const ContributionInviteResponseSchema = z.strictObject({
  user: z.string(),
  namespace: z.string().nullable(),
  invited: z.boolean(),
});
export type ContributionInviteResult = z.infer<typeof ContributionInviteResponseSchema>;

// ---------------------------------------------------------------------------
// 经验证的访客
// ---------------------------------------------------------------------------

/** 访客的显示名：不能包含控制字符和双向文本控制符（防止把名字伪装成别的样子）。 */
export const GuestDisplayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[^\p{Cc}\u200E\u200F\u202A-\u202E\u2066-\u2069]+$/u, "contains control characters");

/**
 * 申请访客验证：通过 Turnstile 之后，服务端给这个邮箱发一封带一次性链接的邮件。
 * 无论这个邮箱以前是否验证过，响应都一样。
 */
export const GuestVerificationRequestSchema = z.strictObject({
  /** 首尾空白会被去掉；大小写不影响识别为同一个访客。 */
  email: z.string().trim().max(254).pipe(z.email()),
  display_name: GuestDisplayNameSchema,
  turnstile_token: z.string().min(1).max(2048),
});

export const GuestVerificationResponseSchema = z.strictObject({
  status: z.literal("sent"),
  /** 链接的有效期（秒）。 */
  expires_in: z.number().int().positive(),
});

/** 打开邮件里的链接后，前端把 fragment 中的 token 提交上来，换取访客会话 cookie。 */
export const GuestConfirmRequestSchema = z.strictObject({
  token: z.string().min(1).max(128),
});

export const GuestSchema = z.strictObject({
  /** 访客 ID，形如 `gst_…`。 */
  id: z.string(),
  display_name: z.string(),
  verified_at: z.string(),
});
export type Guest = z.infer<typeof GuestSchema>;

export const GuestSessionResponseSchema = z.strictObject({
  guest: GuestSchema,
  session_expires_at: z.string(),
});

// ---------------------------------------------------------------------------
// 举报
// ---------------------------------------------------------------------------

/**
 * 举报原因。内容政策定稿之前先用这六类，取值与 admin 举报队列的分类一致：涉及未成年人的
 * 性内容、版权或商标、评级不对、骚扰或涉及真实人物、违法或有害内容、垃圾信息或恶意软件。
 */
export const REPORT_CATEGORIES = [
  "sexual_minors",
  "copyright",
  "rating",
  "harassment",
  "illegal",
  "spam",
] as const;
export const ReportCategorySchema = z.enum(REPORT_CATEGORIES);
export type ReportCategory = z.infer<typeof ReportCategorySchema>;

/** 举报说明的最大长度（字符）。 */
export const MAX_REPORT_DETAILS = 2000;

/**
 * 举报一个作品（`POST /v1/creations/@ns/name/reports`）或它的某个版本
 * （`POST /v1/creations/@ns/name/releases/:label/reports`）。登录用户与经验证访客不需要
 * Turnstile；匿名举报必须带 `turnstile_token`（widget 的 action 是 `report`）。
 * 说明可以换行，但不能包含其他控制字符。
 */
export const CreateReportRequestSchema = z.strictObject({
  category: ReportCategorySchema,
  details: z
    .string()
    .trim()
    .max(MAX_REPORT_DETAILS)
    .refine((s) => !/\p{Cc}/u.test(s.replace(/[\n\r\t]/g, "")), "contains control characters")
    .optional(),
  turnstile_token: z.string().min(1).max(2048).optional(),
});
export type CreateReportRequest = z.infer<typeof CreateReportRequestSchema>;

/** 举报的响应只说明“已收到”，不透露是否重复、会不会处理或处理结果。 */
export const ReportReceivedResponseSchema = z.strictObject({ status: z.literal("received") });

// ---------------------------------------------------------------------------
// 角色卡导入
// ---------------------------------------------------------------------------

/**
 * 从一个已完成的上传（purpose 为 import）导入角色卡，生成一个新的 Creation 草稿。
 * 导入是异步的：返回 202，之后轮询 `GET /v1/imports/:id`。同一个上传重复提交返回同一个导入。
 */
export const CreateImportRequestSchema = z.strictObject({
  upload: z.string().min(1).max(64),
  namespace: NamespaceSlugSchema,
  name: CreationNameSchema,
});

export const IMPORT_CONFIRMATION_FIELDS = ["meta.rating", "meta.rights", "meta.license"] as const;

/** Import Report：原卡片的哪些字段映射到了哪里、哪些被省略或丢弃、哪些需要作者确认。 */
export const ImportReportSchema = z.looseObject({
  container: z.enum(["png", "charx", "json"]),
  format: z.string(),
  spec: z.string(),
  spec_version: z.string().nullable(),
  source_digest: DigestSchema,
  mappings: z.array(z.strictObject({ from: z.string(), to: z.string() })),
  /** 被省略的策略字段（例如 system_prompt）及原值。报告只有发起人能看到。 */
  omitted_policy_fields: z.array(z.strictObject({ field: z.string(), value: z.string() })),
  placeholders: z.array(z.looseObject({})),
  lorebook: z.array(z.looseObject({})),
  assets: z.array(
    z.looseObject({
      type: z.string(),
      name: z.string(),
      uri: z.string(),
      imported: z.boolean(),
      reason: z.string().optional(),
    }),
  ),
  dropped: z.array(z.strictObject({ field: z.string(), reason: z.string() })),
  needs_confirmation: z.array(z.enum(IMPORT_CONFIRMATION_FIELDS)),
  warnings: z.array(z.strictObject({ code: z.string(), detail: z.string() })),
});
export type ImportReport = z.infer<typeof ImportReportSchema>;

export const ImportStatusSchema = z.strictObject({
  import: z.string(),
  status: z.enum(["pending", "processing", "succeeded", "failed"]),
  error_code: z.string().optional(),
  error_detail: z.string().optional(),
  /** 导入成功后生成的 Creation。 */
  creation: UnversionedRefSchema.optional(),
  /** 发布前必须由作者确认的字段；确认后为空数组。 */
  needs_confirmation: z.array(z.enum(IMPORT_CONFIRMATION_FIELDS)),
  confirmed_at: z.string().nullable(),
  report: ImportReportSchema.optional(),
  created_at: z.string(),
});
export type ImportStatus = z.infer<typeof ImportStatusSchema>;

/** 作者在导入向导里确认评级、权利与许可。确认之前导入生成的 Creation 不能发布。 */
export const ConfirmImportRequestSchema = z.strictObject({
  rating: RatingSchema,
  rights: z.enum(["original", "fan-work", "licensed"]),
  license: SpdxExpressionSchema,
});

// ---------------------------------------------------------------------------
// Release 的源内容与邀请名单
// ---------------------------------------------------------------------------

/**
 * `GET …/releases/:label/source`：Release 对应的 Revision 与 canonical Creation。
 * 提交 Contribution 时在这份内容上修改，`base_revision` 取这里的 `revision`。
 */
export const ReleaseSourceSchema = z.strictObject({
  revision: z.string(),
  semantic_digest: DigestSchema,
  creation: z.unknown(),
  /** Release 被 yank 时附带的提示。 */
  warning: z.string().optional(),
});
export type ReleaseSource = z.infer<typeof ReleaseSourceSchema>;

/** `GET …/contribution-invites`：只有作者可见。 */
export const ContributionInvitesResponseSchema = z.strictObject({
  items: z.array(
    z.strictObject({
      user: z.string(),
      display_name: z.string().nullable(),
      namespace: z.string().nullable(),
      invited_at: z.string(),
    }),
  ),
});
export type ContributionInvite = z.infer<typeof ContributionInvitesResponseSchema>["items"][number];
