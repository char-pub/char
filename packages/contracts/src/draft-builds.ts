import { DigestSchema, DraftBuildOriginSchema } from "@char-pub/core";
import { z } from "zod";

export const DraftBuildRequestSchema = z.strictObject({});
export const DraftBuildResponseSchema = z.strictObject({
  origin: DraftBuildOriginSchema,
  state: z.enum(["pending", "ready", "failed", "expired", "deleted"]),
  draft_version: z.number().int().positive(),
  semantic_digest: DigestSchema,
  lock_digest: DigestSchema.optional(),
  artifact_digest: DigestSchema.optional(),
  report: z.unknown().optional(),
});
export type DraftBuildResponse = z.infer<typeof DraftBuildResponseSchema>;
