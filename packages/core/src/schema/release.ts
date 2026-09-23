/**
 * Release 与 Contribution 的 schema。
 *
 * Release 是不可变快照：内容和依赖闭包在发布时锁定，之后只有状态（active / yanked /
 * tombstoned）和状态原因可以改变。
 */
import { z } from "zod";
import {
  AssetSlotSchema,
  AssetVariantSchema,
  AttributionAuthorSchema,
  BlobRefSchema,
  ContributionIdSchema,
  CreationIdSchema,
  DecimalIdSchema,
  DigestSchema,
  FragmentIdSchema,
  FragmentSchema,
  GitCommitSchema,
  GuestAuthorSchema,
  HttpsUrlSchema,
  JSONValueSchema,
  LabelSchema,
  ProvenanceSchema,
  RatingSchema,
  ReferenceEdgeSchema,
  ReleaseIdSchema,
  RevisionIdSchema,
  SegmentSchema,
  UnversionedRefSchema,
  UserIdSchema,
} from "./creation.js";

export const VisibilityLevelSchema = z.enum(["public", "private"]);
export const ReleaseStatusSchema = z.enum(["active", "yanked", "tombstoned"]);

/** 可以是 ISO 8601 UTC 时间戳。core 不读时钟，时间由调用方传入。 */
export const TimestampSchema = z.iso.datetime({ offset: false });

/** 从根到某个依赖实例经过的 edge ID 列表。根实例是空列表。 */
export const EdgePathSchema = z.array(SegmentSchema);

export const LockEntrySchema = z.strictObject({
  ref: UnversionedRefSchema,
  release: ReleaseIdSchema,
  semantic_digest: DigestSchema,
  /** 第一次遇到这个依赖时经过的 edge 路径，用于 Preview 解释。 */
  via: EdgePathSchema,
});
export type LockEntry = z.infer<typeof LockEntrySchema>;

export const SourceRecordSchema = z.discriminatedUnion("provider", [
  z.strictObject({ provider: z.literal("native"), revision: RevisionIdSchema }),
  z.strictObject({
    provider: z.literal("github"),
    repository_id: DecimalIdSchema,
    repository_owner_id: DecimalIdSchema,
    commit: GitCommitSchema,
    path: z.string().min(1),
  }),
  z.strictObject({
    provider: z.literal("import"),
    format: z.string().min(1),
    upload: BlobRefSchema,
  }),
  z.strictObject({
    provider: z.literal("http"),
    url: HttpsUrlSchema,
    fetched_at: TimestampSchema,
  }),
]);
export type SourceRecord = z.infer<typeof SourceRecordSchema>;

/**
 * 通过 GitHub OIDC 发布时保存的 claim。ID 类 claim 在 token 里本来就是字符串，
 * 这里保持十进制字符串，避免超出 JSON 安全整数范围。
 */
export const GitHubOIDCClaimsSchema = z.strictObject({
  repository_id: DecimalIdSchema,
  repository_owner_id: DecimalIdSchema,
  sha: GitCommitSchema,
  ref: z.string().min(1),
  workflow_ref: z.string().min(1),
  job_workflow_ref: z.string().min(1),
  run_id: DecimalIdSchema,
  run_attempt: DecimalIdSchema,
  actor_id: DecimalIdSchema,
  event_name: z.enum(["push", "workflow_dispatch", "release"]),
  jti: z.string().min(1),
});
export type GitHubOIDCClaims = z.infer<typeof GitHubOIDCClaimsSchema>;

export const ReleaseContributorSchema = z.strictObject({
  ref: UnversionedRefSchema,
  author: z.union([UserIdSchema, GuestAuthorSchema]),
  contribution: ContributionIdSchema.optional(),
});

export const ReleaseSchema = z.strictObject({
  id: ReleaseIdSchema,
  creation: CreationIdSchema,
  label: LabelSchema,
  visibility: VisibilityLevelSchema,
  status: ReleaseStatusSchema,
  status_reason: z.string().optional(),

  source: SourceRecordSchema,
  source_digest: DigestSchema,
  semantic_digest: DigestSchema,
  /** 自身与所有依赖的原作者署名。 */
  attribution: z.array(
    z.strictObject({ ref: UnversionedRefSchema, authors: z.array(AttributionAuthorSchema) }),
  ),
  /** 贡献者与原作者分开展示。 */
  contributors: z.array(ReleaseContributorSchema),
  provenance: ProvenanceSchema,

  /** 完整依赖闭包。 */
  lock: z.array(LockEntrySchema),
  /** canonical Creation 加闭包文本的快照。 */
  snapshot: BlobRefSchema,
  /** 由快照、lock 和 Resolver 版本确定性生成，可以按需生成后缓存。 */
  context_ir: BlobRefSchema.optional(),

  availability: z.enum(["complete", "linked"]),
  effective_rating: RatingSchema,
  /** 许可检查失败的内容不能发布，所以这里只有 pass / warn。 */
  license_check: z.enum(["pass", "warn"]),
  created_at: TimestampSchema,
  published_by: z.union([UserIdSchema, z.strictObject({ oidc: GitHubOIDCClaimsSchema })]),
});
export type Release = z.infer<typeof ReleaseSchema>;

// ---------------------------------------------------------------------------
// Contribution
// ---------------------------------------------------------------------------

/** 可以通过 Contribution 修改的 metadata 字段。 */
export const METADATA_FIELDS = [
  "display_name",
  "summary",
  "meta.default_locale",
  "meta.tags",
  "meta.rating",
  "meta.content_warnings",
  "meta.rights",
  "meta.license",
  "meta.recommended_presets",
  "meta.contribution_policy",
] as const;
export const MetadataFieldSchema = z.enum(METADATA_FIELDS);
export type MetadataField = z.infer<typeof MetadataFieldSchema>;

/** 这些字段的变更必须由作者单独确认，不能和普通变更一起一键接受。 */
export const SENSITIVE_METADATA_FIELDS: readonly MetadataField[] = [
  "meta.rating",
  "meta.license",
  "meta.content_warnings",
];

/** 这些字段是必填的，不能 unset。 */
export const REQUIRED_METADATA_FIELDS: readonly MetadataField[] = [
  "display_name",
  "meta.default_locale",
  "meta.rating",
  "meta.rights",
  "meta.license",
];

const changeOp = z.enum(["add", "modify", "remove"]);

export const ChangeSchema = z.discriminatedUnion("on", [
  z.strictObject({
    on: z.literal("fragment"),
    op: changeOp,
    id: FragmentIdSchema,
    base_digest: DigestSchema.optional(),
    after: FragmentSchema.optional(),
  }),
  z.strictObject({
    on: z.literal("edge"),
    op: changeOp,
    id: SegmentSchema,
    base_digest: DigestSchema.optional(),
    after: ReferenceEdgeSchema.optional(),
  }),
  z.strictObject({
    on: z.literal("asset"),
    op: changeOp,
    slot: SegmentSchema,
    /** 省略时表示整个 slot。 */
    variant: SegmentSchema.optional(),
    base_digest: DigestSchema.optional(),
    after: z.union([AssetSlotSchema, AssetVariantSchema]).optional(),
  }),
  z.strictObject({
    on: z.literal("metadata"),
    field: MetadataFieldSchema,
    op: z.enum(["set", "unset"]),
    base_digest: DigestSchema.optional(),
    after: JSONValueSchema.optional(),
    /** 由服务端按字段计算；客户端提交的值不被信任。 */
    sensitive: z.boolean(),
  }),
]);
export type Change = z.infer<typeof ChangeSchema>;

export const ContributionSchema = z.strictObject({
  id: ContributionIdSchema,
  target: CreationIdSchema,
  base: z.strictObject({ revision: RevisionIdSchema, semantic_digest: DigestSchema }),
  author: z.union([UserIdSchema, GuestAuthorSchema]),
  /** Agent 提交的 Contribution 必须标记，作者可以单独过滤。 */
  agent: z.boolean().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(20000).optional(),
  status: z.enum(["open", "accepted", "rejected", "withdrawn"]),
  transport: z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("native") }),
    z.strictObject({
      type: z.literal("github-pr"),
      repository_id: DecimalIdSchema,
      number: z.number().int().positive(),
    }),
  ]),
  changes: z.array(ChangeSchema).min(1),
  /** 默认按目标 Creation 的 license 授权；目标是保留所有权利时需要显式授权。 */
  rights_ack: z.union([
    z.strictObject({ inbound_equals_outbound: z.literal(true) }),
    z.strictObject({ explicit_grant: z.literal(true) }),
  ]),
});
export type Contribution = z.infer<typeof ContributionSchema>;
