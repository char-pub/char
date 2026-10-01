/** A local synthetic preview handoff. Its contents never constitute author approval. */
import { z } from "zod";
import { AssemblyFixtureSchema } from "./assembly.js";
import { TurnStorySchema } from "./context.js";
import { DigestSchema } from "./creation.js";
import { BuildRefSchema } from "./identity.js";
import { RuntimeProfileSchema } from "./runtime.js";
import { HistoryMessageSchema, LateBindingValueSchema, SessionSchema } from "./session.js";

export const MAX_RUNTIME_PREVIEW_BYTES = 1024 * 1024;

export const RuntimePreviewInputSchema = z.strictObject({
  format: z.literal("char.pub/runtime-preview"),
  version: z.literal(1),
  source: z.strictObject({
    root: BuildRefSchema,
    lock_digest: DigestSchema,
    /** Exact JSON snapshot identity, distinct from a Registry artifact's byte digest. */
    artifact_json_digest: DigestSchema,
  }),
  profile: RuntimeProfileSchema,
  preset: BuildRefSchema,
  tokenizer: AssemblyFixtureSchema.shape.tokenizer,
  turn: z.strictObject({
    locale: SessionSchema.shape.locale.unwrap(),
    bindings: z.record(z.string().min(1), LateBindingValueSchema),
    history: z.array(HistoryMessageSchema),
    scene: SessionSchema.shape.scene.unwrap(),
    present: z.array(z.string()),
    story: TurnStorySchema,
    for_participant: SessionSchema.shape.for_participant,
    story_guidance: z.boolean().optional(),
  }),
});
export type RuntimePreviewInput = z.infer<typeof RuntimePreviewInputSchema>;
