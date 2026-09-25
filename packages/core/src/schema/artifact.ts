import { z } from "zod";
import { AssemblyConfigSchema } from "./assembly.js";
import { DigestSchema } from "./creation.js";
import { ExactRefSchema } from "./identity.js";
import { ContextIRSchema, EffectiveMetaSchema, IRAssetSchema } from "./ir.js";
import { ResolvedPresetSchema, ResolvedPromptModuleSchema } from "./preset.js";
import { LockEntrySchema } from "./release.js";

export const ResolvedAssemblySchema = AssemblyConfigSchema.omit({ preset: true }).extend({
  preset: ResolvedPresetSchema,
});
export type ResolvedAssembly = z.infer<typeof ResolvedAssemblySchema>;
const common = {
  version: z.literal("0-draft"),
  root: ExactRefSchema,
  lock: z.array(LockEntrySchema),
  lock_digest: DigestSchema,
  meta: EffectiveMetaSchema,
  assets: z.array(IRAssetSchema),
};
export const CreationArtifactSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...common,
    kind: z.literal("content"),
    ir: ContextIRSchema,
    assembly: ResolvedAssemblySchema.optional(),
  }),
  z.strictObject({ ...common, kind: z.literal("preset"), preset: ResolvedPresetSchema }),
  z.strictObject({
    ...common,
    kind: z.literal("prompt-module"),
    module: ResolvedPromptModuleSchema,
  }),
]);
export type CreationArtifact = z.infer<typeof CreationArtifactSchema>;
