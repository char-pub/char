import { z } from "zod";
import { NAME_RE, NAMESPACE_RE, SEGMENT_RE } from "../ids.js";
import { DigestSchema, ReleaseIdSchema, SegmentSchema, UnversionedRefSchema } from "./creation.js";
import { ExactRefSchema } from "./identity.js";
import { PresetBlockSchema, PresetPolicySchema } from "./policy.js";
import { LockEntrySchema } from "./release.js";

export const ResolvedBlockIdSchema = z.union([
  SegmentSchema,
  z
    .string()
    .regex(
      new RegExp(
        `^@${NAMESPACE_RE.source.slice(1, -1)}/${NAME_RE.source.slice(1, -1)}#${SEGMENT_RE.source.slice(1, -1)}$`,
      ),
    ),
]);
export const PolicyBlockOriginSchema = ExactRefSchema.extend({
  block: SegmentSchema,
  via: z.array(SegmentSchema),
});
export const ResolvedPolicyBlockSchema = PresetBlockSchema.extend({
  id: ResolvedBlockIdSchema,
  origin: PolicyBlockOriginSchema.optional(),
});
export const ResolvedPolicySchema = z
  .strictObject({ ...PresetPolicySchema.shape, blocks: z.array(ResolvedPolicyBlockSchema) })
  .omit({ imports: true })
  .superRefine((policy, ctx) => {
    if (new Set(policy.layout).size !== policy.layout.length)
      ctx.addIssue({ code: "custom", path: ["layout"], message: "duplicate layout region" });
    if (new Set(policy.blocks.map((b) => b.id)).size !== policy.blocks.length)
      ctx.addIssue({ code: "custom", path: ["blocks"], message: "duplicate block id" });
  });

/** 独立于内容 IR 的策略输入；完整性校验由 resolvePreset 执行。 */
export const ResolvedPresetSchema = z.strictObject({
  ref: UnversionedRefSchema,
  release: ReleaseIdSchema,
  semantic_digest: DigestSchema,
  resolver: z.strictObject({ name: z.string().min(1), version: z.string().min(1) }),
  policy: ResolvedPolicySchema,
  lock: z.array(LockEntrySchema).optional(),
  lock_digest: DigestSchema.optional(),
});
export type ResolvedPreset = z.infer<typeof ResolvedPresetSchema>;

export const PresetIdentitySchema = z.strictObject({
  ref: UnversionedRefSchema,
  release: ReleaseIdSchema,
  semantic_digest: DigestSchema,
});

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
        fields: z.array(z.enum(["text", "position", "enabled"])).min(1),
      }),
    ),
    /** 两侧共有块的相对顺序发生变化；单纯新增或删除不算重排。 */
    order_changed: z.boolean(),
  }),
  policy_changes: z.array(z.enum(["version", "layout", "region_budgets", "requires"])),
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

export const ResolvedPromptModuleSchema = z.strictObject({
  ...ExactRefSchema.shape,
  resolver: z.strictObject({ name: z.string().min(1), version: z.string().min(1) }),
  version: z.literal("0-draft"),
  blocks: z.array(ResolvedPolicyBlockSchema),
  lock: z.array(LockEntrySchema),
  lock_digest: DigestSchema,
});
export type ResolvedPromptModule = z.infer<typeof ResolvedPromptModuleSchema>;
