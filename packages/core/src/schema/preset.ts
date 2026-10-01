import { z } from "zod";
import { NAME_RE, NAMESPACE_RE, SEGMENT_RE } from "../ids.js";
import { DigestSchema, SegmentSchema, UnversionedRefSchema } from "./creation.js";
import { BuildRefSchema, withBuildIdentity } from "./identity.js";
import {
  PolicyPlacementSchema,
  PolicyPositionSchema,
  PresetBlockSchema,
  PresetPolicySchema,
} from "./policy.js";
import { LockEntrySchema } from "./release.js";

export const ResolvedDefinitionIdSchema = z.union([
  SegmentSchema,
  z
    .string()
    .regex(
      new RegExp(
        `^@${NAMESPACE_RE.source.slice(1, -1)}/${NAME_RE.source.slice(1, -1)}#${SEGMENT_RE.source.slice(1, -1)}$`,
      ),
    ),
]);
const segment = SEGMENT_RE.source.slice(1, -1);
const definitionId = `(?:${segment}|@${NAMESPACE_RE.source.slice(1, -1)}/${NAME_RE.source.slice(1, -1)}#${segment})`;
export const ResolvedBlockIdSchema = z
  .string()
  .regex(new RegExp(`^${definitionId}(?:~(?:main|after-history)~${segment})?$`));
export const PolicyBlockOriginSchema = withBuildIdentity({
  ref: UnversionedRefSchema,
  semantic_digest: DigestSchema,
  block: SegmentSchema,
  via: z.array(SegmentSchema),
});
export const ResolvedModuleBlockSchema = PresetBlockSchema.extend({
  id: ResolvedDefinitionIdSchema,
  origin: PolicyBlockOriginSchema.optional(),
});
export const ResolvedPolicyBlockSchema = ResolvedModuleBlockSchema.omit({
  default_at: true,
}).extend({
  id: ResolvedBlockIdSchema,
  position: PolicyPositionSchema,
  placement: PolicyPlacementSchema.optional(),
});
export const ResolvedPolicySchema = z
  .strictObject({ ...PresetPolicySchema.shape, blocks: z.array(ResolvedPolicyBlockSchema) })
  .omit({ imports: true, placements: true })
  .superRefine((policy, ctx) => {
    if (new Set(policy.layout).size !== policy.layout.length)
      ctx.addIssue({ code: "custom", path: ["layout"], message: "duplicate layout region" });
    if (new Set(policy.blocks.map((b) => b.id)).size !== policy.blocks.length)
      ctx.addIssue({ code: "custom", path: ["blocks"], message: "duplicate block id" });
  });

/** 独立于内容 IR 的策略输入；完整性校验由 resolvePreset 执行。 */
export const ResolvedPresetSchema = withBuildIdentity({
  ref: UnversionedRefSchema,
  semantic_digest: DigestSchema,
  resolver: z.strictObject({ name: z.string().min(1), version: z.string().min(1) }),
  policy: ResolvedPolicySchema,
  lock: z.array(LockEntrySchema).optional(),
  lock_digest: DigestSchema.optional(),
});
export type ResolvedPreset = z.infer<typeof ResolvedPresetSchema>;
export const PublishedResolvedPresetSchema = ResolvedPresetSchema.options[0].extend({
  policy: ResolvedPolicySchema.safeExtend({
    blocks: z.array(
      ResolvedPolicyBlockSchema.extend({
        origin: PolicyBlockOriginSchema.options[0].optional(),
      }),
    ),
  }),
});

export const PresetIdentitySchema = BuildRefSchema;

/** 只比较 Policy；作品 metadata 变化仅反映在快照身份中。 */
export const PresetDiffSchema = z.strictObject({
  from: PresetIdentitySchema,
  to: PresetIdentitySchema,
  blocks: z.strictObject({
    added: z.array(ResolvedBlockIdSchema),
    removed: z.array(ResolvedBlockIdSchema),
    modified: z.array(
      z.strictObject({
        id: ResolvedBlockIdSchema,
        fields: z.array(z.enum(["text", "position", "enabled", "purpose"])).min(1),
      }),
    ),
    /** 两侧共有块的相对顺序发生变化；单纯新增或删除不算重排。 */
    order_changed: z.boolean(),
  }),
  policy_changes: z.array(
    z.enum(["version", "layout", "region_budgets", "requires", "selection", "render"]),
  ),
  lock_changes: z
    .array(
      z.strictObject({
        ref: UnversionedRefSchema,
        from: LockEntrySchema.optional(),
        to: LockEntrySchema.optional(),
      }),
    )
    .optional(),
  origin_changes: z
    .array(
      z.strictObject({
        id: ResolvedBlockIdSchema,
        from: PolicyBlockOriginSchema.optional(),
        to: PolicyBlockOriginSchema.optional(),
      }),
    )
    .optional(),
});
export type PresetDiff = z.infer<typeof PresetDiffSchema>;

export const ResolvedPromptModuleSchema = withBuildIdentity({
  ref: UnversionedRefSchema,
  semantic_digest: DigestSchema,
  resolver: z.strictObject({ name: z.string().min(1), version: z.string().min(1) }),
  version: z.literal("1-draft"),
  blocks: z.array(ResolvedModuleBlockSchema),
  lock: z.array(LockEntrySchema),
  lock_digest: DigestSchema,
});
export type ResolvedPromptModule = z.infer<typeof ResolvedPromptModuleSchema>;
