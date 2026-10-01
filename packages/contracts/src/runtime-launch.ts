/** A request to open an exact work in an independently authorized Runtime, never a grant. */
import { DigestSchema, DraftBuildOriginSchema, ExactRefSchema } from "@char-pub/core";
import { z } from "zod";

export const MAX_RUNTIME_LAUNCH_BYTES = 16 * 1024;

/** Registry origins have no credentials or paths; unencrypted development is loopback only. */
export const RuntimeRegistryOriginSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    const normalized = z.url({ normalize: true }).safeParse(value);
    if (!normalized.success || normalized.data !== `${value}/`) return false;
    return (
      /^https:\/\/[^/@?#\\\s]+$/.test(value) ||
      /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(value)
    );
  }, "Use an HTTPS origin, or an HTTP loopback origin for local development.");

export const RuntimeLaunchRequestSchema = z.strictObject({
  format: z.literal("char.pub/runtime-launch"),
  version: z.literal(1),
  registry_origin: RuntimeRegistryOriginSchema,
  source: z.union([
    ExactRefSchema,
    z.strictObject({
      ref: ExactRefSchema.shape.ref,
      semantic_digest: DigestSchema,
      origin: DraftBuildOriginSchema,
    }),
  ]),
  lock_digest: DigestSchema,
  locale: z.string().min(1).max(128),
  start: z.string().min(1).max(256).optional(),
  view: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("narrator") }),
    z.strictObject({ mode: z.literal("per-agent"), for_participant: z.string().min(1).max(1024) }),
  ]),
});
export type RuntimeLaunchRequest = z.infer<typeof RuntimeLaunchRequestSchema>;
