/**
 * Canonical Model 的 zod schema。所有 Source（Native 编辑器、CCv3 导入、GitHub 仓库）
 * 最终都要产出符合这里定义的数据；Resolver 只读这种形式，不读任何 Source 格式。
 *
 * 约定：
 * - 对象一律 strict：未知字段直接拒绝，否则它们会悄悄进入 digest。
 * - 可省略且有默认值的字段用 optional 表示，默认值由 canonicalize 负责剥离，
 *   保证“写不写默认值”得到同一个 digest。
 * - 数值必须是有限数，整数必须在安全整数范围内，避免不同运行时序列化出不同结果。
 */
import { z } from "zod";
import {
  CAST_KEY_RE,
  DIGEST_RE,
  FRAGMENT_ID_RE,
  idPattern,
  LABEL_RE,
  NAME_RE,
  NAMESPACE_RE,
  PARAM_NAME_RE,
  SEGMENT_RE,
  SLOT_NAME_RE,
} from "../ids.js";
import { PresetPolicySchema } from "./policy.js";

// ---------------------------------------------------------------------------
// 基础类型
// ---------------------------------------------------------------------------

export const DigestSchema = z.string().regex(DIGEST_RE, "expected sha256:<64 hex>");

const REF_BODY = `@${NAMESPACE_RE.source.slice(1, -1)}/${NAME_RE.source.slice(1, -1)}`;
/** 不带版本的公共标识 `@ns/name`。 */
export const UnversionedRefSchema = z.string().regex(new RegExp(`^${REF_BODY}$`));
/** `@ns/name` 或 `@ns/name@label`。 */
export const CreationRefSchema = z
  .string()
  .regex(new RegExp(`^${REF_BODY}(?:@${LABEL_RE.source.slice(1, -1)})?$`));
/** `#fragment_id`。 */
export const LocalRefSchema = z
  .string()
  .regex(new RegExp(`^#${FRAGMENT_ID_RE.source.slice(1, -1)}$`));

export const FragmentIdSchema = z.string().regex(FRAGMENT_ID_RE);
export const SegmentSchema = z.string().regex(SEGMENT_RE);
export const LabelSchema = z.string().regex(LABEL_RE);
export const SlotNameSchema = z.string().regex(SLOT_NAME_RE);
export const ParamNameSchema = z.string().regex(PARAM_NAME_RE);
export const CastKeySchema = z.string().regex(CAST_KEY_RE);

export const CreationIdSchema = z.string().regex(idPattern("creation"));
export const ReleaseIdSchema = z.string().regex(idPattern("release"));
export const RevisionIdSchema = z.string().regex(idPattern("revision"));
export const UserIdSchema = z.string().regex(idPattern("user"));
export const ContributionIdSchema = z.string().regex(idPattern("contribution"));

/** BCP 47 语言标签（只做语法层面的宽松校验）。 */
export const LocaleSchema = z.string().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/);

/** SPDX 表达式，例如 `CC-BY-4.0`、`MIT OR Apache-2.0`、`LicenseRef-All-Rights-Reserved`。 */
export const SpdxExpressionSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9.+\-() :]+$/, "invalid SPDX expression")
  .refine((s) => s.trim() === s, "SPDX expression must not have leading/trailing spaces");

const safeNumber = z
  .number()
  .refine(Number.isFinite, "number must be finite")
  .refine((n) => !Number.isInteger(n) || Number.isSafeInteger(n), "integer out of safe range");

export const ScalarValueSchema = z.union([z.string(), safeNumber, z.boolean()]);
export type ScalarValue = z.infer<typeof ScalarValueSchema>;

export type JSONValue = string | number | boolean | null | JSONValue[] | { [k: string]: JSONValue };
export const JSONValueSchema: z.ZodType<JSONValue> = z.lazy(() =>
  z.union([
    z.string(),
    safeNumber,
    z.boolean(),
    z.null(),
    z.array(JSONValueSchema),
    z.record(z.string(), JSONValueSchema),
  ]),
);

/**
 * 可本地化文本：一个不区分语言的字符串，或者 locale → 文本的映射。
 * 两种写法语义不同（后者声明了语言），canonicalize 不会互相转换。
 */
export const LocalizedTextSchema = z.union([
  z.string().min(1),
  z
    .record(LocaleSchema, z.string().min(1))
    .refine((r) => Object.keys(r).length > 0, "localized text must not be empty"),
]);
export type LocalizedText = z.infer<typeof LocalizedTextSchema>;

export const RATINGS = ["general", "teen", "mature", "explicit"] as const;
export const RatingSchema = z.enum(RATINGS);
export type Rating = z.infer<typeof RatingSchema>;

export const CREATION_TYPES = [
  "character",
  "world",
  "lorebook",
  "relationship",
  "scenario",
  "persona",
  "style",
  "preset",
] as const;
/** v0 对创作者开放的类型；其余类型只有数据模型与 Resolver 行为。 */
export const OPEN_CREATION_TYPES = ["character", "world", "lorebook"] as const;
export const CreationTypeSchema = z.enum(CREATION_TYPES);
export type CreationType = z.infer<typeof CreationTypeSchema>;

export const FRAGMENT_KINDS = [
  "character",
  "persona",
  "relationship",
  "world",
  "scenario",
  "knowledge",
  "style",
  "examples",
  "instruction",
] as const;
export const FragmentKindSchema = z.enum(FRAGMENT_KINDS);
export type FragmentKind = z.infer<typeof FragmentKindSchema>;

// ---------------------------------------------------------------------------
// 模板文本与说话人
// ---------------------------------------------------------------------------

/** 模板文本：只允许纯替换占位符，占位符合法性由 `char check` 检查。 */
export const TemplateTextSchema = z.string();

/** 说话人：`{{self}}`、`{{user}}`、`{{slot:x}}`、`{{cast:x}}`，或某个 Creation 的公共标识。 */
export const SpeakerRefSchema = z.union([
  z.literal("{{self}}"),
  z.literal("{{user}}"),
  z.string().regex(new RegExp(`^\\{\\{slot:${SLOT_NAME_RE.source.slice(1, -1)}\\}\\}$`)),
  z.string().regex(new RegExp(`^\\{\\{cast:${CAST_KEY_RE.source.slice(1, -1)}\\}\\}$`)),
  UnversionedRefSchema,
]);
export type SpeakerRef = z.infer<typeof SpeakerRefSchema>;

// ---------------------------------------------------------------------------
// Asset
// ---------------------------------------------------------------------------

/** `#asset/<slot>` 或 `#asset/<slot>/<variant>`。 */
export const AssetRefSchema = z
  .string()
  .regex(
    new RegExp(`^#asset/${SEGMENT_RE.source.slice(1, -1)}(?:/${SEGMENT_RE.source.slice(1, -1)})?$`),
  );
export type AssetRef = z.infer<typeof AssetRefSchema>;

/** GitHub 数字 ID 用十进制字符串表示，避免超出 JSON 安全整数范围。 */
export const DecimalIdSchema = z.string().regex(/^[1-9][0-9]{0,19}$/);
export const GitCommitSchema = z.string().regex(/^[0-9a-f]{40}$/);

/**
 * 只接受 https URL。协议检查之外再写一条前缀约束，因为协议检查无法导出到 JSON Schema，
 * 前缀约束会变成 `pattern`，其他语言的实现按 JSON Schema 校验时同样会拒绝 http。
 */
export const HttpsUrlSchema = z.url({ protocol: /^https$/ }).regex(/^https:\/\//);

export const SourceLocatorSchema = z.discriminatedUnion("provider", [
  z.strictObject({
    provider: z.literal("github"),
    repository_id: DecimalIdSchema,
    commit: GitCommitSchema,
    path: z.string().min(1),
  }),
  z.strictObject({ provider: z.literal("http"), url: HttpsUrlSchema }),
]);

export const BlobRefSchema = z.strictObject({
  digest: DigestSchema,
  size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  locator: SourceLocatorSchema.optional(),
  availability: z.enum(["mirrored", "linked"]),
});
export type BlobRef = z.infer<typeof BlobRefSchema>;

export const AssetVariantSchema = z.strictObject({
  id: SegmentSchema,
  blob: BlobRefSchema,
  media_type: z.string().regex(/^[a-z]+\/[a-z0-9.+-]+$/),
  alt: LocalizedTextSchema.optional(),
  /** 缺省继承 Creation 的 license。 */
  license: SpdxExpressionSchema.optional(),
  /** 缺省继承 Creation 的 rating；可以更高，不能更低（由 check 规则检查）。 */
  rating: RatingSchema.optional(),
});
export type AssetVariant = z.infer<typeof AssetVariantSchema>;

export const AssetSlotSchema = z.strictObject({
  slot: SegmentSchema,
  /** presentation 只用于展示；只有 context 可以被 fragment 引用并进入模型。 */
  role: z.enum(["presentation", "context"]),
  variants: z
    .array(AssetVariantSchema)
    .min(1)
    .refine((v) => v.some((x) => x.id === "default"), "asset slot needs a 'default' variant"),
});
export type AssetSlot = z.infer<typeof AssetSlotSchema>;

// ---------------------------------------------------------------------------
// Fragment
// ---------------------------------------------------------------------------

export const TEXT_FORMAT_DEFAULT = "markdown";

export const DialogueTurnSchema = z.strictObject({
  speaker: SpeakerRefSchema,
  text: TemplateTextSchema,
});

export const FragmentContentSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("text"),
    text: TemplateTextSchema,
    /** 缺省为 markdown。 */
    format: z.enum(["markdown", "plain"]).optional(),
  }),
  z.strictObject({ type: z.literal("dialogue"), turns: z.array(DialogueTurnSchema).min(1) }),
  z.strictObject({
    type: z.literal("media"),
    asset: AssetRefSchema,
    caption: TemplateTextSchema.optional(),
  }),
  /** 扩展点：Resolver 原样透传。 */
  z.strictObject({
    type: z.literal("structured"),
    schema: z.string().min(1),
    data: JSONValueSchema,
  }),
]);
export type FragmentContent = z.infer<typeof FragmentContentSchema>;

/**
 * keyword 激活：任一主关键词命中即候选；如果给了 secondary，还要求 secondary
 * 按 logic（any：任一命中；all：全部命中）同时满足。
 * 默认值：logic = any，case_sensitive = false，whole_word = false。
 */
export const ActivationSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("always") }),
  z.strictObject({
    mode: z.literal("keyword"),
    keys: z.array(z.string().min(1)).min(1),
    secondary: z.array(z.string().min(1)).optional(),
    logic: z.enum(["any", "all"]).optional(),
    case_sensitive: z.boolean().optional(),
    whole_word: z.boolean().optional(),
    /** 只扫描最近 N 条消息。 */
    scan_depth: z.number().int().min(1).max(1000).optional(),
  }),
  /** 由 Assembler 自行实现检索，结果不保证确定性。 */
  z.strictObject({ mode: z.literal("semantic"), hint: z.string().optional() }),
  /** 只在用户或 Runtime 显式启用时加入。 */
  z.strictObject({ mode: z.literal("manual") }),
]);
export type Activation = z.infer<typeof ActivationSchema>;

export const VisibilitySchema = z.discriminatedUnion("scope", [
  z.strictObject({ scope: z.literal("shared") }),
  /** 只对列出的角色可见。在 narrator 模式下这只是提示，不是安全边界。 */
  z.strictObject({ scope: z.literal("private"), to: z.array(SpeakerRefSchema).min(1) }),
  z.strictObject({ scope: z.literal("scene"), scene: FragmentIdSchema.optional() }),
]);
export type Visibility = z.infer<typeof VisibilitySchema>;

export const ImportanceSchema = z.enum(["pinned", "normal", "opportunistic"]);

/** 其他语言的变体：共享 fragment id、激活方式和可见性，只替换内容与关键词。 */
export const LocaleMapSchema = z.record(
  LocaleSchema,
  z.strictObject({
    content: FragmentContentSchema,
    activation_keys: z.array(z.string().min(1)).optional(),
  }),
);
export type LocaleMap = z.infer<typeof LocaleMapSchema>;

export const FragmentSchema = z.strictObject({
  id: FragmentIdSchema,
  /** false 时可以运行，但不能被其他 Creation 当作 override 目标。 */
  stable: z.boolean(),
  kind: FragmentKindSchema,
  content: FragmentContentSchema,
  locale: LocaleMapSchema.optional(),
  /** 缺省为 always。 */
  activation: ActivationSchema.optional(),
  /** 缺省为 shared。 */
  visibility: VisibilitySchema.optional(),
  /** 缺省为 normal。 */
  importance: ImportanceSchema.optional(),
  /** 只是放置位置的提示，缺省等于 kind。 */
  placement_hint: FragmentKindSchema.optional(),
  asset_refs: z.array(AssetRefSchema).optional(),
  /** 去掉 digest 字段后的 canonical 序列化的 sha256；输入时可省略，canonicalize 会计算。 */
  digest: DigestSchema.optional(),
});
export type Fragment = z.infer<typeof FragmentSchema>;

// ---------------------------------------------------------------------------
// Slot、Param、Binding
// ---------------------------------------------------------------------------

export const SlotDeclSchema = z.strictObject({
  accepts: z.union([CreationTypeSchema, z.array(CreationTypeSchema).min(1)]),
  /** 缺省为 true。 */
  required: z.boolean().optional(),
  description: LocalizedTextSchema.optional(),
});
export type SlotDecl = z.infer<typeof SlotDeclSchema>;

export const ParamDeclSchema = z.strictObject({
  type: z.enum(["string", "number", "boolean"]),
  default: ScalarValueSchema.optional(),
  description: LocalizedTextSchema.optional(),
});
export type ParamDecl = z.infer<typeof ParamDeclSchema>;

export const LateBindingSchema = z.strictObject({
  late: z.enum(["persona", "character"]),
  hint: z.string().optional(),
});

/** early：Resolver 绑定的已知对象；late：由 Assembler 在 Session 开始时绑定。 */
export const BindingSchema = z.union([
  z.literal("{{self}}"),
  z.string().regex(new RegExp(`^\\{\\{cast:${CAST_KEY_RE.source.slice(1, -1)}\\}\\}$`)),
  CreationRefSchema,
  LocalRefSchema,
  LateBindingSchema,
]);
export type Binding = z.infer<typeof BindingSchema>;

// ---------------------------------------------------------------------------
// Reference Edge
// ---------------------------------------------------------------------------

/** 引用选择器；支持前缀通配 `lore/*`。 */
export const FragmentPatternSchema = z
  .string()
  .regex(new RegExp(`^(?:${FRAGMENT_ID_RE.source.slice(1, -1)})(?:/\\*)?$|^\\*$`));

export const SelectorSchema = z.union([
  z.strictObject({ include: z.array(FragmentPatternSchema).min(1) }),
  z.strictObject({ exclude: z.array(FragmentPatternSchema).min(1) }),
]);
export type Selector = z.infer<typeof SelectorSchema>;

export const FragmentPatchSchema = z
  .strictObject({
    activation: ActivationSchema.optional(),
    visibility: VisibilitySchema.optional(),
    importance: ImportanceSchema.optional(),
    placement_hint: FragmentKindSchema.optional(),
  })
  .refine((p) => Object.keys(p).length > 0, "patch must set at least one field");

export const FragmentOverrideSchema = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("replace"),
    target: FragmentIdSchema,
    content: FragmentContentSchema,
    /** 缺省为 false。 */
    force: z.boolean().optional(),
  }),
  z.strictObject({
    op: z.literal("remove"),
    target: FragmentIdSchema,
    force: z.boolean().optional(),
  }),
  z.strictObject({ op: z.literal("patch"), target: FragmentIdSchema, set: FragmentPatchSchema }),
  /** 在被引用 Creation 的语境中追加一个 fragment。 */
  z.strictObject({ op: z.literal("add"), fragment: FragmentSchema }),
]);
export type FragmentOverride = z.infer<typeof FragmentOverrideSchema>;

export const ReleasePinSchema = z.union([
  /** 只允许出现在草稿中；发布时必须解析成精确的 Release。 */
  z.strictObject({ follow: z.literal("latest") }),
  z.strictObject({ release: ReleaseIdSchema, semantic_digest: DigestSchema }),
]);
export type ReleasePin = z.infer<typeof ReleasePinSchema>;

export const ReferenceEdgeSchema = z.strictObject({
  /** edge 在本 Creation 内的稳定 ID，参与实例 key 的计算。 */
  id: SegmentSchema,
  /** 只用于展示（lives_in、knows_about……），不改变 resolve 语义。 */
  rel: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,31}$/)
    .optional(),
  use: z.union([CreationRefSchema, LocalRefSchema]),
  pin: ReleasePinSchema.optional(),
  /** intrinsic：身份的一部分；default：推荐值，Scenario 可以替换。 */
  mode: z.enum(["intrinsic", "default"]),
  bind: z.record(SlotNameSchema, BindingSchema).optional(),
  params: z.record(ParamNameSchema, ScalarValueSchema).optional(),
  select: SelectorSchema.optional(),
  override: z.array(FragmentOverrideSchema).optional(),
});
export type ReferenceEdge = z.infer<typeof ReferenceEdgeSchema>;

// ---------------------------------------------------------------------------
// Bootstrap、Meta、Provenance、Cast
// ---------------------------------------------------------------------------

export const GreetingSchema = z.strictObject({
  id: SegmentSchema,
  text: TemplateTextSchema,
  /** 其他语言的问候语；内容必须是 text 类型（由 check 规则检查）。 */
  locale: LocaleMapSchema.optional(),
  scenario_hint: LocalizedTextSchema.optional(),
});
export type Greeting = z.infer<typeof GreetingSchema>;

export const BootstrapSchema = z.strictObject({
  /** 第一项是默认问候语。 */
  greetings: z.array(GreetingSchema).min(1),
});

export const CONTRIBUTION_POLICY_DEFAULT = "signed-in";

export const CreationMetaSchema = z.strictObject({
  default_locale: LocaleSchema,
  tags: z.array(z.string().min(1).max(64)).optional(),
  rating: RatingSchema,
  content_warnings: z.array(z.string().min(1).max(64)).optional(),
  rights: z.enum(["original", "fan-work", "licensed"]),
  license: SpdxExpressionSchema,
  /** 只是推荐，不绑定。 */
  recommended_presets: z.array(UnversionedRefSchema).optional(),
  /** 缺省为 signed-in。 */
  contribution_policy: z.enum(["anyone", "signed-in", "invited", "closed"]).optional(),
});
export type CreationMeta = z.infer<typeof CreationMetaSchema>;

export const GuestAuthorSchema = z.strictObject({
  guest_id: z.string().min(1).max(64),
  display_name: z.string().min(1).max(128),
});

export const AttributionAuthorSchema = z.strictObject({
  name: z.string().min(1).max(256),
  user: UserIdSchema.optional(),
  guest_id: z.string().min(1).max(64).optional(),
  contribution: ContributionIdSchema.optional(),
});
export type AttributionAuthor = z.infer<typeof AttributionAuthorSchema>;

export const ContributorSchema = z.strictObject({
  author: z.union([UserIdSchema, GuestAuthorSchema]),
  contribution: ContributionIdSchema.optional(),
});

export const ProvenanceSchema = z.strictObject({
  /** 创作来源，只用于展示，不参与 resolve。 */
  derived_from: z
    .array(
      z.strictObject({ release: ReleaseIdSchema, relation: z.enum(["fork", "remix", "import"]) }),
    )
    .optional(),
  imported_from: z
    .strictObject({
      format: z.string().min(1),
      source_digest: DigestSchema,
      /** 只记录字段名；原值留在导入原件和 Import Report 中。 */
      omitted_policy_fields: z.array(z.string().min(1)).optional(),
    })
    .optional(),
  /** 含有对 intrinsic 依赖的强制 override。缺省为 false。 */
  au: z.boolean().optional(),
  contributors: z.array(ContributorSchema).optional(),
  /** 缺省为 false。 */
  authored_by_agent: z.boolean().optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const CastMemberSchema = z.strictObject({
  key: CastKeySchema,
  who: BindingSchema,
  role: z.enum(["lead", "support", "user"]).optional(),
});
export type CastMember = z.infer<typeof CastMemberSchema>;

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export const CreationSchema = z
  .strictObject({
    id: CreationIdSchema,
    ref: UnversionedRefSchema,
    type: CreationTypeSchema,
    display_name: LocalizedTextSchema,
    summary: LocalizedTextSchema.optional(),
    /** 可归属的原作者；导入时保留源卡的 creator。 */
    authors: z.array(AttributionAuthorSchema).optional(),
    slots: z.record(SlotNameSchema, SlotDeclSchema).optional(),
    params: z.record(ParamNameSchema, ParamDeclSchema).optional(),
    fragments: z.array(FragmentSchema).default([]),
    references: z.array(ReferenceEdgeSchema).default([]),
    assets: z.array(AssetSlotSchema).default([]),
    bootstrap: BootstrapSchema.optional(),
    /** 只在 type 为 scenario 时出现。 */
    cast: z.array(CastMemberSchema).optional(),
    /** Preset 的运行策略，与 Creative 内容分开表达。 */
    policy: PresetPolicySchema.optional(),
    meta: CreationMetaSchema,
    provenance: ProvenanceSchema.default({}),
  })
  .superRefine((creation, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });
    if (creation.type !== "preset") {
      if (creation.policy !== undefined) issue(["policy"], "only a preset may declare policy");
      return;
    }
    if (creation.policy === undefined) issue(["policy"], "a preset requires policy");
    for (const key of ["fragments", "references", "slots", "params", "cast"] as const) {
      const value = creation[key];
      if (value !== undefined && Object.keys(value).length > 0) {
        issue([key], `a preset cannot declare ${key}`);
      }
    }
    if ((creation.bootstrap?.greetings.length ?? 0) > 0) {
      issue(["bootstrap"], "a preset cannot declare bootstrap greetings");
    }
    creation.assets.forEach((asset, i) => {
      if (asset.role === "context")
        issue(["assets", i, "role"], "a preset cannot declare context assets");
    });
  });
/** 解析后的 Creation（默认值已填充）。 */
export type Creation = z.output<typeof CreationSchema>;
/** 输入形式：可以省略有默认值的字段。 */
export type CreationInput = z.input<typeof CreationSchema>;
