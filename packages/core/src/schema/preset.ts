import { z } from "zod";
import { DigestSchema, ReleaseIdSchema, SegmentSchema, UnversionedRefSchema } from "./creation.js";
import { PresetPolicySchema } from "./policy.js";

/** 独立于内容 IR 的策略输入；完整性校验由 resolvePreset 执行。 */
export const ResolvedPresetSchema = z.strictObject({
  ref: UnversionedRefSchema,
  release: ReleaseIdSchema,
  semantic_digest: DigestSchema,
  resolver: z.strictObject({ name: z.string().min(1), version: z.string().min(1) }),
  policy: PresetPolicySchema,
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
    added: z.array(SegmentSchema),
    removed: z.array(SegmentSchema),
    modified: z.array(
      z.strictObject({
        id: SegmentSchema,
        fields: z.array(z.enum(["text", "position", "enabled"])).min(1),
      }),
    ),
    /** 两侧共有块的相对顺序发生变化；单纯新增或删除不算重排。 */
    order_changed: z.boolean(),
  }),
  policy_changes: z.array(z.enum(["version", "layout", "region_budgets", "requires"])),
});
export type PresetDiff = z.infer<typeof PresetDiffSchema>;
