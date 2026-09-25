/**
 * Context IR 的 schema：Resolver 的输出，也是 Runtime 消费 char.pub 作品的唯一格式。
 *
 * IR 不可变、可缓存、可哈希。同一个快照、lock 和 Resolver 版本在任何运行时都必须
 * 生成字节完全相同的 IR（按 JCS 序列化）。Release 当前是否被 yank / tombstone 属于
 * 可变的 Registry 状态，不进入 IR。
 */
import { z } from "zod";
import {
  ActivationSchema,
  AttributionAuthorSchema,
  ContributionIdSchema,
  CreationTypeSchema,
  DigestSchema,
  FragmentIdSchema,
  FragmentKindSchema,
  GuestAuthorSchema,
  JSONValueSchema,
  LocaleSchema,
  LocalizedTextSchema,
  RatingSchema,
  ReleaseIdSchema,
  SegmentSchema,
  SourceLocatorSchema,
  SpdxExpressionSchema,
  UnversionedRefSchema,
  UserIdSchema,
} from "./creation.js";

export const IR_VERSION = "0-draft";
export const IR_MEDIA_TYPE = "application/vnd.char.context-ir+json; version=0-draft";

/** `<creation-ref>#<fragment-id>~<instance-key>`，在整个 IR 内唯一。 */
export const IRFragmentIdSchema = z.string().min(1);
export type IRFragmentId = z.infer<typeof IRFragmentIdSchema>;

export const IRContentSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("text"),
    text: z.string(),
    format: z.enum(["markdown", "plain"]),
  }),
  z.strictObject({
    type: z.literal("dialogue"),
    /** speaker 是 `participant:<key>`。 */
    turns: z.array(z.strictObject({ speaker: z.string(), text: z.string() })),
  }),
  /** asset 是 IRAsset 的 id。 */
  z.strictObject({ type: z.literal("media"), asset: z.string(), caption: z.string().optional() }),
  z.strictObject({ type: z.literal("structured"), schema: z.string(), data: JSONValueSchema }),
]);
export type IRContent = z.infer<typeof IRContentSchema>;

export const IRVisibilitySchema = z.discriminatedUnion("scope", [
  z.strictObject({ scope: z.literal("shared") }),
  /** `to` 是 participant key 列表（已排序）。 */
  z.strictObject({ scope: z.literal("private"), to: z.array(z.string()).min(1) }),
  z.strictObject({ scope: z.literal("scene"), scene: z.string() }),
]);
export type IRVisibility = z.infer<typeof IRVisibilitySchema>;

export const OverriddenBySchema = z.strictObject({
  creation: UnversionedRefSchema,
  edge: SegmentSchema.optional(),
  op: z.enum(["replace", "patch", "add"]),
});

export const OriginSchema = z.strictObject({
  creation: UnversionedRefSchema,
  release: ReleaseIdSchema,
  fragment: FragmentIdSchema,
  /** 从根到这个引用实例的 edge ID 路径。 */
  via: z.array(SegmentSchema),
  /** 根实例是 `root`，其余是 `sha256(JCS(via))`。 */
  instance_key: z.string(),
  /** 按应用顺序列出修改过这个 fragment 的 override。 */
  overridden_by: z.array(OverriddenBySchema).optional(),
  stable: z.boolean(),
});
export type Origin = z.infer<typeof OriginSchema>;

export const IRFragmentSchema = z.strictObject({
  id: IRFragmentIdSchema,
  kind: FragmentKindSchema,
  /** 已完成 early binding、params 替换和 override。 */
  content: IRContentSchema,
  locales: z.record(LocaleSchema, IRContentSchema).optional(),
  activation: ActivationSchema,
  visibility: IRVisibilitySchema,
  importance: z.enum(["pinned", "normal", "opportunistic"]),
  placement_hint: FragmentKindSchema,
  /** 这个 fragment 描述的 participant key。 */
  subject: z.string().optional(),
  /** IRAsset 的 id。 */
  asset_refs: z.array(z.string()).optional(),
  origin: OriginSchema,
  /** 语义字段的 digest（不含 id、origin 和 digest 自身），用于 Context Diff。 */
  digest: DigestSchema,
});
export type IRFragment = z.infer<typeof IRFragmentSchema>;

export const ParticipantSchema = z.strictObject({
  /** 根角色是 `self`；其他参与者是 `p:<hex>`。 */
  key: z.string(),
  ref: UnversionedRefSchema.optional(),
  display_name: LocalizedTextSchema,
  kind: z.enum(["character", "persona"]),
  role: z.enum(["lead", "support", "user"]).optional(),
  /** 由 Session 决定时，指向 late_slots 的 key。 */
  late: z.string().optional(),
  /** IRAsset 的 id。 */
  avatar: z.string().optional(),
});
export type Participant = z.infer<typeof ParticipantSchema>;

export const LateSlotSchema = z.strictObject({
  /** 隐式用户是 `user`；其他是 `l:<hex>`。 */
  key: z.string(),
  accepts: z.array(z.enum(["persona", "character"])).min(1),
  required: z.boolean(),
  hint: z.string().optional(),
  /** 含有这个占位符的 IR fragment（已排序）。 */
  used_by: z.array(IRFragmentIdSchema),
});
export type LateSlot = z.infer<typeof LateSlotSchema>;

export const IRBootstrapSchema = z.strictObject({
  greetings: z.array(
    z.strictObject({
      id: z.string(),
      speaker: z.string(),
      /** 可以含有 `{{late:*}}`。 */
      text: z.string(),
      locales: z.record(LocaleSchema, z.string()).optional(),
      scenario_hint: z.string().optional(),
    }),
  ),
});

export const IRAssetSchema = z.strictObject({
  /** `<creation-ref>#asset/<slot>/<variant>~<instance-key>`。 */
  id: z.string(),
  role: z.enum(["presentation", "context"]),
  media_type: z.string(),
  digest: DigestSchema,
  availability: z.enum(["mirrored", "linked"]),
  access: z.enum(["public", "private"]),
  /** 只有 public + mirrored 才有稳定的公共 URL；IR 里永远不放签名 URL。 */
  url: z.string().optional(),
  locator: SourceLocatorSchema.optional(),
  alt: z.string().optional(),
  rating: RatingSchema,
  license: SpdxExpressionSchema,
  origin: z.strictObject({
    creation: UnversionedRefSchema,
    release: ReleaseIdSchema,
    slot: SegmentSchema,
    variant: SegmentSchema,
    instance_key: z.string(),
  }),
});
export type IRAsset = z.infer<typeof IRAssetSchema>;

export const IRContributorSchema = z.strictObject({
  ref: UnversionedRefSchema,
  author: z.union([UserIdSchema, GuestAuthorSchema]),
  contribution: ContributionIdSchema.optional(),
});

export const EffectiveMetaSchema = z.strictObject({
  default_locale: LocaleSchema,
  /** 闭包内所有 fragment 都具备的 locale 的交集。 */
  available_locales: z.array(LocaleSchema),
  /** 闭包中 Creation 与所纳入 Asset 的最高 rating。 */
  rating: RatingSchema,
  rating_sources: z.array(
    z.strictObject({
      ref: UnversionedRefSchema,
      rating: RatingSchema,
      asset: z.string().optional(),
    }),
  ),
  content_warnings: z.array(z.string()),
  licenses: z.array(
    z.strictObject({
      ref: UnversionedRefSchema,
      license: SpdxExpressionSchema,
      asset: z.string().optional(),
    }),
  ),
  attribution: z.array(
    z.strictObject({ ref: UnversionedRefSchema, authors: z.array(AttributionAuthorSchema) }),
  ),
  contributors: z.array(IRContributorSchema),
  /** 导入时省略的源卡 policy 字段，只有字段名。 */
  import_omissions: z.array(
    z.strictObject({ ref: UnversionedRefSchema, fields: z.array(z.string()) }),
  ),
  au: z.boolean(),
  recommended_presets: z.array(UnversionedRefSchema),
});
export type EffectiveMeta = z.infer<typeof EffectiveMetaSchema>;

export const IRGraphSchema = z.strictObject({
  nodes: z.array(
    z.strictObject({
      ref: UnversionedRefSchema,
      release: ReleaseIdSchema,
      type: CreationTypeSchema,
      display_name: z.string(),
    }),
  ),
  instances: z.array(
    z.strictObject({ key: z.string(), ref: UnversionedRefSchema, via: z.array(SegmentSchema) }),
  ),
  edges: z.array(
    z.strictObject({
      from_instance: z.string(),
      to_instance: z.string(),
      id: SegmentSchema,
      rel: z.string().optional(),
      mode: z.enum(["intrinsic", "default"]),
    }),
  ),
  removed: z.array(
    z.strictObject({
      id: IRFragmentIdSchema,
      by: z.strictObject({
        creation: UnversionedRefSchema,
        edge: SegmentSchema.optional(),
        reason: z.enum(["select", "override"]),
      }),
    }),
  ),
});
export type IRGraph = z.infer<typeof IRGraphSchema>;

export const IRDiagnosticSchema = z.strictObject({
  code: z.string(),
  subject: z.string(),
  severity: z.enum(["info", "warning"]),
  detail: z.string().optional(),
});

export const ContextIRSchema = z.strictObject({
  ir_version: z.literal(IR_VERSION),
  root: z.strictObject({
    ref: UnversionedRefSchema,
    release: ReleaseIdSchema,
    semantic_digest: DigestSchema,
  }),
  lock_digest: DigestSchema,
  resolver: z.strictObject({ name: z.string(), version: z.string() }),
  meta: EffectiveMetaSchema,
  participants: z.array(ParticipantSchema),
  late_slots: z.array(LateSlotSchema),
  fragments: z.array(IRFragmentSchema),
  bootstrap: IRBootstrapSchema,
  assets: z.array(IRAssetSchema),
  graph: IRGraphSchema,
  diagnostics: z.array(IRDiagnosticSchema),
});
export type ContextIR = z.infer<typeof ContextIRSchema>;

// ---------------------------------------------------------------------------
// Runtime Profile 与 Assembly Trace（Assembler 的输入与输出，不属于 IR）
// ---------------------------------------------------------------------------

export const RuntimeProfileSchema = z.strictObject({
  runtime: z.strictObject({ name: z.string(), version: z.string() }),
  model: z.string().optional(),
  /** 具体 tokenizer 名，或 `estimate` 表示只做估算。 */
  tokenizer: z.string(),
  context_window: z.number().int().positive(),
  reserve_for_output: z.number().int().nonnegative(),
  /** per-agent 模式下 private visibility 是隔离边界；narrator 模式下只是提示。 */
  mode: z.enum(["narrator", "per-agent"]),
  capabilities: z.strictObject({
    images: z.boolean().optional(),
    system_role: z.boolean().optional(),
    multiple_system_messages: z.boolean().optional(),
  }),
  locale: LocaleSchema.optional(),
});
export type RuntimeProfile = z.infer<typeof RuntimeProfileSchema>;

export const TRACE_REASONS = [
  "always",
  "pinned",
  "semantic",
  "manual",
  "budget",
  "visibility",
  "locale-fallback",
  "unsupported-media",
  "inactive",
] as const;

/** `keyword:<命中的关键词>` 或固定原因之一。 */
export const TraceReasonSchema = z.union([z.enum(TRACE_REASONS), z.string().regex(/^keyword:.+$/)]);

export const AssemblyTraceSchema = z.strictObject({
  ir: z.strictObject({ root: UnversionedRefSchema, lock_digest: DigestSchema }),
  /** 实际采用的运行策略身份；推荐列表不构成已选用的 Preset。 */
  preset: z
    .strictObject({
      ref: UnversionedRefSchema,
      release: ReleaseIdSchema,
      semantic_digest: DigestSchema,
      resolver: z.strictObject({ name: z.string(), version: z.string() }),
    })
    .optional(),
  /** 可选以兼容旧 Trace；参考 Assembler 的新输出始终携带。 */
  assembler: z
    .strictObject({
      name: z.string(),
      version: z.string(),
      layout: z.enum(["default-v1", "preset-v1"]),
    })
    .optional(),
  profile: z.strictObject({ tokenizer: z.string(), context_window: z.number(), mode: z.string() }),
  total_tokens: z.number(),
  estimated: z.boolean(),
  entries: z.array(
    z.strictObject({
      id: z.string(),
      region: z.string(),
      tokens: z.number(),
      decision: z.enum(["included", "skipped"]),
      reason: TraceReasonSchema,
      origin: OriginSchema.optional(),
    }),
  ),
});
export type AssemblyTrace = z.infer<typeof AssemblyTraceSchema>;

export const ContextDiffSchema = z.strictObject({
  from: z.strictObject({ root: UnversionedRefSchema, lock_digest: DigestSchema }),
  to: z.strictObject({ root: UnversionedRefSchema, lock_digest: DigestSchema }),
  lock_changes: z.array(
    z.strictObject({
      ref: UnversionedRefSchema,
      from: z.string().optional(),
      to: z.string().optional(),
    }),
  ),
  fragments: z.strictObject({
    added: z.array(IRFragmentIdSchema),
    removed: z.array(IRFragmentIdSchema),
    modified: z.array(
      z.strictObject({
        id: IRFragmentIdSchema,
        fields: z.array(
          z.enum([
            "content",
            "activation",
            "visibility",
            "importance",
            "placement_hint",
            "locales",
          ]),
        ),
      }),
    ),
  }),
  origin_changes: z.array(
    z.strictObject({ id: IRFragmentIdSchema, from: OriginSchema, to: OriginSchema }),
  ),
  /** rating 与 licenses 的变化在 UI 中必须高亮。 */
  meta_changes: z.array(
    z.strictObject({
      field: z.enum(["rating", "content_warnings", "licenses", "attribution", "contributors"]),
      from: JSONValueSchema,
      to: JSONValueSchema,
    }),
  ),
  token_delta: z
    .strictObject({ tokenizer: z.string(), always: z.number(), potential: z.number() })
    .optional(),
});
export type ContextDiff = z.infer<typeof ContextDiffSchema>;
