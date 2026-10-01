import { z } from "zod";
import { SEGMENT_RE } from "../ids.js";
import { PolicyImportSchema } from "./identity.js";

/** 默认布局顺序；显式 Preset 必须完整列出这些区域，每个恰好一次。 */
export const PRESET_REGIONS = [
  "system:character",
  "system:cast",
  "session:bindings",
  "system:persona",
  "system:world",
  "system:scenario",
  "system:scene",
  "system:story",
  "system:sources",
  "system:relationship",
  "system:knowledge",
  "system:style",
  "system:instruction",
  "system:examples",
  "session:memory",
  "session:state",
  "session:variants",
  "history",
] as const;
export type PresetRegion = (typeof PRESET_REGIONS)[number];

/** 区域上限仅适用于 Creative 内容，不能裁剪历史或 Session。 */
export const CREATIVE_REGIONS = [
  "system:character",
  "system:cast",
  "system:persona",
  "system:world",
  "system:scenario",
  "system:scene",
  "system:story",
  "system:sources",
  "system:relationship",
  "system:knowledge",
  "system:style",
  "system:instruction",
  "system:examples",
] as const;
export type CreativeRegion = (typeof CREATIVE_REGIONS)[number];

const nonblank = z
  .string()
  .min(1)
  .refine((text) => text.trim().length > 0, "expected nonblank text");
export const PolicyPositionSchema = z.enum(["main", "after-history"]);
export const PresetBlockSchema = z.strictObject({
  id: z.string().regex(SEGMENT_RE),
  /** 字面文本：不解释模板、脚本或变量。 */
  text: z
    .string()
    .min(1)
    .refine((text) => text.trim().length > 0, "expected nonblank text"),
  default_at: PolicyPositionSchema,
  purpose: nonblank.optional(),
  /** 缺省为 true；canonical 形式省略显式 true。 */
  enabled: z.boolean().optional(),
});
export type PresetBlock = z.infer<typeof PresetBlockSchema>;

export const PolicyPlacementSchema = z.strictObject({
  block: z
    .string()
    .regex(
      new RegExp(`^${SEGMENT_RE.source.slice(1, -1)}(?:/${SEGMENT_RE.source.slice(1, -1)})*$`),
    ),
  at: PolicyPositionSchema,
  as: z.string().regex(SEGMENT_RE).optional(),
});
export const PolicySelectionSchema = z.strictObject({
  catalog_budget: z.number().int().nonnegative().safe().optional(),
  max_depth: z.number().int().min(1).max(32).optional(),
  on_unavailable: z.literal("skip").optional(),
});
export const PolicyRenderSchema = z.strictObject({
  "perspective.rumor": nonblank.optional(),
  "perspective.claim": nonblank.optional(),
  "perspective.belief": nonblank.optional(),
  "knowing.narrator": nonblank.optional(),
  "sources.notice": nonblank.optional(),
});

export const PresetPolicySchema = z
  .strictObject({
    version: z.literal("1-draft"),
    blocks: z.array(PresetBlockSchema),
    imports: z.array(PolicyImportSchema).optional(),
    placements: z.array(PolicyPlacementSchema).optional(),
    selection: PolicySelectionSchema.optional(),
    render: PolicyRenderSchema.optional(),
    layout: z.array(z.enum(PRESET_REGIONS)).length(PRESET_REGIONS.length),
    region_budgets: z
      .partialRecord(z.enum(CREATIVE_REGIONS), z.number().int().nonnegative().safe())
      .optional(),
    requires: z.strictObject({
      system_role: z.literal(true),
      multiple_system_messages: z.literal(true).optional(),
    }),
  })
  .superRefine((policy, ctx) => {
    const placements = new Set<string>();
    policy.placements?.forEach((item, i) => {
      const key = JSON.stringify([item.block, item.at, item.as ?? item.at]);
      if (placements.has(key))
        ctx.addIssue({ code: "custom", path: ["placements", i], message: "duplicate placement" });
      placements.add(key);
    });
    const imports = new Set<string>();
    policy.imports?.forEach((item, i) => {
      if (imports.has(item.id))
        ctx.addIssue({
          code: "custom",
          path: ["imports", i, "id"],
          message: "duplicate import id",
        });
      imports.add(item.id);
    });
    const seen = new Set<string>();
    policy.blocks.forEach((block, i) => {
      if (seen.has(block.id)) {
        ctx.addIssue({ code: "custom", path: ["blocks", i, "id"], message: "duplicate block id" });
      }
      seen.add(block.id);
    });
    if (new Set(policy.layout).size !== PRESET_REGIONS.length) {
      ctx.addIssue({
        code: "custom",
        path: ["layout"],
        message: "layout must contain every supported region exactly once",
      });
    }
  });
export type PresetPolicy = z.infer<typeof PresetPolicySchema>;

export const PromptModuleSchema = z
  .strictObject({
    version: z.literal("1-draft"),
    blocks: z.array(PresetBlockSchema),
    imports: z.array(PolicyImportSchema).optional(),
  })
  .superRefine((module, ctx) => {
    for (const field of ["blocks", "imports"] as const) {
      const seen = new Set<string>();
      module[field]?.forEach((item, i) => {
        if (seen.has(item.id))
          ctx.addIssue({
            code: "custom",
            path: [field, i, "id"],
            message: `duplicate ${field} id`,
          });
        seen.add(item.id);
      });
    }
  });
export type PromptModule = z.infer<typeof PromptModuleSchema>;
