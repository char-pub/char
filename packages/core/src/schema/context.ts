import { z } from "zod";
import { DIGEST_RE } from "../ids.js";
import { CatalogRefSchema } from "./catalog.js";
import { SessionOverlaySchema, SessionSchema } from "./session.js";
import { StoryValueSchema } from "./story.js";

const DigestSchema = z.string().regex(DIGEST_RE);

export const TurnStorySchema = z.strictObject({
  start: z.string(),
  visited: z.array(z.string()),
  reached: z.array(z.string()),
  ended: z.array(z.string()),
  happened: z.array(z.string()),
  vars: z.record(z.string(), StoryValueSchema),
  knowing: z.record(z.string(), z.array(z.string())),
  stopped: z.boolean(),
});
export const TurnViewSchema = SessionSchema.extend({
  /** Runtime explicitly projects this overlay for the current participant. */
  visible_overlay: SessionOverlaySchema.optional(),
  present: z.array(z.string()).optional(),
  story: TurnStorySchema.optional(),
  story_guidance: z.boolean().optional(),
  focus: z.string().optional(),
  judgments: z
    .array(
      z.strictObject({
        target: z.string(),
        path: z.string(),
        result: z.enum(["true", "false", "undetermined"]),
        provider: z.strictObject({ name: z.string(), version: z.string() }),
      }),
    )
    .optional(),
});
export type TurnView = z.infer<typeof TurnViewSchema>;
export type TurnViewInput = z.input<typeof TurnViewSchema>;
export const ContextViewSchema = z.strictObject({
  mode: z.enum(["narrator", "per-agent"]),
  for: z.string().optional(),
});
export type ContextView = z.infer<typeof ContextViewSchema>;

export const SelectionPlanSchema = z.strictObject({
  /** Whether the selector received a discovery directory. Required for exact replay. */
  discovery: z.boolean(),
  input: z.strictObject({
    artifact_digest: DigestSchema,
    lock_digest: DigestSchema,
    turn_digest: DigestSchema,
    catalog_digest: DigestSchema,
    policy_digest: DigestSchema,
  }),
  selector: z.strictObject({
    name: z.string().min(1),
    version: z.string().min(1),
    config_digest: DigestSchema.optional(),
  }),
  selected: z.array(
    z.strictObject({
      ref: CatalogRefSchema,
      form: z.enum(["body", "section"]),
      rank: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    }),
  ),
  decisions: z.array(
    z.strictObject({
      ref: CatalogRefSchema,
      action: z.enum(["expand", "select", "reject"]),
      score: z.number().finite().optional(),
      confidence: z.number().min(0).max(1).optional(),
      note: z.string().optional(),
    }),
  ),
  fallback: z.literal("skip").optional(),
});
export type SelectionPlan = z.infer<typeof SelectionPlanSchema>;
