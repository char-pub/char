/**
 * 公开发布的 JSON Schema。其他语言的实现可以直接用它们校验 char.pub 的数据。
 *
 * schema 从 zod 定义生成，写入 `spec/schema/`。提交的文件必须与生成结果一致，
 * 单元测试会检查这一点；修改 schema 后运行 `pnpm schema:export` 重新生成。
 *
 * 主要的子结构（Fragment、ReferenceEdge 等）以有名字的 `$defs` 出现，便于阅读和引用。
 *
 * 说明：zod 的 refine（例如“asset slot 必须有 default variant”“整数必须在安全范围内”）
 * 无法表达为 JSON Schema，只存在于 zod 校验中；JSON Schema 描述的是结构与字段格式。
 */
import { type ZodType, z } from "zod";
import * as C from "./schema/creation.js";
import * as IR from "./schema/ir.js";
import * as P from "./schema/policy.js";
import * as PR from "./schema/preset.js";
import * as R from "./schema/release.js";

export const SCHEMA_BASE_URL = "https://char.pub/schema/v0-draft";

export const PUBLISHED_SCHEMAS = {
  creation: { schema: C.CreationSchema, title: "char.pub Creation (Canonical Model)" },
  release: { schema: R.ReleaseSchema, title: "char.pub Release" },
  contribution: { schema: R.ContributionSchema, title: "char.pub Contribution" },
  "context-ir": { schema: IR.ContextIRSchema, title: "char.pub Context IR" },
  "resolved-preset": { schema: PR.ResolvedPresetSchema, title: "char.pub Resolved Preset" },
  "preset-diff": { schema: PR.PresetDiffSchema, title: "char.pub Preset Diff" },
  "assembly-trace": { schema: IR.AssemblyTraceSchema, title: "char.pub Assembly Trace" },
} as const;

export type PublishedSchemaName = keyof typeof PUBLISHED_SCHEMAS;

/** 在 `$defs` 中使用的名字。只有被引用的定义才会出现在输出里。 */
const NAMED_DEFS: [ZodType, string][] = [
  [C.DigestSchema, "Digest"],
  [C.UnversionedRefSchema, "UnversionedRef"],
  [C.CreationRefSchema, "CreationRef"],
  [C.FragmentIdSchema, "FragmentId"],
  [C.LocaleSchema, "Locale"],
  [C.SpdxExpressionSchema, "SpdxExpression"],
  [C.LocalizedTextSchema, "LocalizedText"],
  [C.RatingSchema, "Rating"],
  [C.CreationTypeSchema, "CreationType"],
  [C.FragmentKindSchema, "FragmentKind"],
  [C.JSONValueSchema, "JSONValue"],
  [C.SpeakerRefSchema, "SpeakerRef"],
  [C.BlobRefSchema, "BlobRef"],
  [C.SourceLocatorSchema, "SourceLocator"],
  [C.AssetVariantSchema, "AssetVariant"],
  [C.AssetSlotSchema, "AssetSlot"],
  [C.FragmentContentSchema, "FragmentContent"],
  [C.ActivationSchema, "Activation"],
  [C.VisibilitySchema, "Visibility"],
  [C.LocaleMapSchema, "LocaleMap"],
  [C.FragmentSchema, "Fragment"],
  [C.SlotDeclSchema, "SlotDecl"],
  [C.ParamDeclSchema, "ParamDecl"],
  [C.BindingSchema, "Binding"],
  [C.SelectorSchema, "Selector"],
  [C.FragmentOverrideSchema, "FragmentOverride"],
  [C.ReleasePinSchema, "ReleasePin"],
  [C.ReferenceEdgeSchema, "ReferenceEdge"],
  [C.GreetingSchema, "Greeting"],
  [C.CreationMetaSchema, "CreationMeta"],
  [C.AttributionAuthorSchema, "AttributionAuthor"],
  [C.GuestAuthorSchema, "GuestAuthor"],
  [C.ProvenanceSchema, "Provenance"],
  [C.CastMemberSchema, "CastMember"],
  [P.PresetBlockSchema, "PresetBlock"],
  [P.PresetPolicySchema, "PresetPolicy"],
  [PR.PresetIdentitySchema, "PresetIdentity"],
  [R.LockEntrySchema, "LockEntry"],
  [R.SourceRecordSchema, "SourceRecord"],
  [R.GitHubOIDCClaimsSchema, "GitHubOIDCClaims"],
  [R.ChangeSchema, "Change"],
  [IR.IRContentSchema, "IRContent"],
  [IR.IRVisibilitySchema, "IRVisibility"],
  [IR.OriginSchema, "Origin"],
  [IR.IRFragmentSchema, "IRFragment"],
  [IR.ParticipantSchema, "Participant"],
  [IR.LateSlotSchema, "LateSlot"],
  [IR.IRAssetSchema, "IRAsset"],
  [IR.EffectiveMetaSchema, "EffectiveMeta"],
  [IR.IRGraphSchema, "IRGraph"],
];

function registryFor(root: ZodType) {
  const reg = z.registry<{ id: string }>();
  for (const [schema, id] of NAMED_DEFS) if (schema !== root) reg.add(schema, { id });
  return reg;
}

/**
 * 生成某个 schema 的 JSON Schema 文档。
 * Creation 描述的是书写形式（有默认值的字段可以省略），其余描述的是完整输出形式。
 */
export function buildJsonSchema(name: PublishedSchemaName): Record<string, unknown> {
  const { schema, title } = PUBLISHED_SCHEMAS[name];
  const body = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io: name === "creation" ? "input" : "output",
    unrepresentable: "any",
    metadata: registryFor(schema),
    // 字符串上叠加的 regex 会覆盖掉 URL 的 format，这里补回来，让两条约束都出现在输出里。
    override: (ctx) => {
      if (ctx.zodSchema === C.HttpsUrlSchema) ctx.jsonSchema.format = "uri";
      if (ctx.zodSchema === P.PresetPolicySchema) {
        ctx.jsonSchema.allOf = [{ properties: { layout: { uniqueItems: true } } }];
      }
      if (ctx.zodSchema === P.PresetBlockSchema) {
        ctx.jsonSchema.allOf = [{ properties: { text: { pattern: "\\S" } } }];
      }
      if (ctx.zodSchema === C.CreationSchema) {
        ctx.jsonSchema.allOf = [
          {
            if: { properties: { type: { const: "preset" } }, required: ["type"] },
            // biome-ignore lint/suspicious/noThenProperty: JSON Schema 的条件关键字，不是 Promise。
            then: {
              required: ["policy"],
              not: { required: ["bootstrap"] },
              properties: {
                fragments: { maxItems: 0 },
                references: { maxItems: 0 },
                cast: { maxItems: 0 },
                slots: { maxProperties: 0 },
                params: { maxProperties: 0 },
                assets: { items: { properties: { role: { const: "presentation" } } } },
              },
            },
            else: { not: { required: ["policy"] } },
          },
        ];
      }
    },
  }) as Record<string, unknown>;
  const { $schema, ...rest } = body;
  return { $schema, $id: `${SCHEMA_BASE_URL}/${name}.schema.json`, title, ...rest };
}

/** 生成文件的文本内容：两空格缩进，末尾换行，便于 review diff。 */
export function renderJsonSchema(name: PublishedSchemaName): string {
  return `${JSON.stringify(buildJsonSchema(name), null, 2)}\n`;
}
