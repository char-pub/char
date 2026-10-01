import { z } from "zod";
import { CharError } from "../errors.js";
import { AssemblyConfigSchema } from "./assembly.js";
import { CapabilitiesSchema } from "./capabilities.js";
import { CatalogIndexSchema, StoryReferencesSchema } from "./catalog.js";
import { DigestSchema } from "./creation.js";
import { BuildRefSchema, type ExactRef, publishedIdentity } from "./identity.js";
import { ContextIRSchema, EffectiveMetaSchema, IRAssetSchema } from "./ir.js";
import {
  PublishedResolvedPresetSchema,
  ResolvedPresetSchema,
  ResolvedPromptModuleSchema,
} from "./preset.js";
import { LockEntrySchema } from "./release.js";
import { StorySchema } from "./story.js";

export const ResolvedAssemblySchema = AssemblyConfigSchema.omit({ preset: true }).extend({
  preset: PublishedResolvedPresetSchema,
});
export type ResolvedAssembly = z.infer<typeof ResolvedAssemblySchema>;
const common = {
  version: z.literal("1-draft"),
  capabilities: CapabilitiesSchema,
  root: BuildRefSchema,
  lock: z.array(LockEntrySchema),
  lock_digest: DigestSchema,
  meta: EffectiveMetaSchema,
  assets: z.array(IRAssetSchema),
};
export const CreationArtifactSchema = z.discriminatedUnion("kind", [
  z
    .strictObject({
      ...common,
      kind: z.literal("content"),
      ir: ContextIRSchema,
      catalog_index: CatalogIndexSchema,
      story: StorySchema.optional(),
      story_refs: StoryReferencesSchema.optional(),
      assembly: ResolvedAssemblySchema.optional(),
      default_policy: PublishedResolvedPresetSchema.optional(),
    })
    .refine(
      (artifact) => !!artifact.assembly || !!artifact.default_policy,
      "content requires a locked assembly or default policy",
    ),
  z.strictObject({ ...common, kind: z.literal("preset"), preset: ResolvedPresetSchema }),
  z.strictObject({
    ...common,
    kind: z.literal("prompt-module"),
    module: ResolvedPromptModuleSchema,
  }),
]);
export type CreationArtifact = z.infer<typeof CreationArtifactSchema>;
export type PublishedCreationArtifact = CreationArtifact & { root: ExactRef };

/** A release endpoint or dependency picker must not accept a draft origin anywhere. */
export function requirePublishedArtifact(
  artifact: CreationArtifact,
  release?: string,
): PublishedCreationArtifact {
  const root = publishedIdentity(artifact.root);
  if (release !== undefined && root.release !== release)
    throw new CharError({ code: "build.release_mismatch", subject: release });
  for (const asset of artifact.assets) publishedIdentity(asset.origin);
  if (artifact.kind === "content") {
    publishedIdentity(artifact.ir.root);
    for (const node of artifact.ir.graph.nodes) publishedIdentity(node);
    for (const fragment of artifact.ir.fragments) publishedIdentity(fragment.origin);
    for (const asset of artifact.ir.assets) publishedIdentity(asset.origin);
  }
  const policies =
    artifact.kind === "preset"
      ? [artifact.preset]
      : artifact.kind === "prompt-module"
        ? [artifact.module]
        : [artifact.assembly?.preset, artifact.default_policy];
  for (const policy of policies) {
    if (!policy) continue;
    publishedIdentity(policy);
    for (const block of "policy" in policy ? policy.policy.blocks : policy.blocks)
      if (block.origin) publishedIdentity(block.origin);
  }
  return artifact as PublishedCreationArtifact;
}
