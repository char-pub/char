import { z } from "zod";
import { DIGEST_RE, SEGMENT_RE } from "../ids.js";
import { EngineIdentitySchema, ExactRefSchema } from "./identity.js";
import { RuntimeProfileSchema } from "./runtime.js";
import { SessionSchema } from "./session.js";

export const AssemblyConfigSchema = z.strictObject({
  version: z.literal("0-draft"),
  preset: ExactRefSchema,
  profile: RuntimeProfileSchema,
  assembler: EngineIdentitySchema,
  tokenizer: EngineIdentitySchema,
});
export type AssemblyConfig = z.infer<typeof AssemblyConfigSchema>;

export const AssemblyTraceAssertionSchema = z.strictObject({
  source: z.string().min(1),
  included: z.boolean().optional(),
  reason: z.string().min(1).optional(),
});
export const AssemblySuccessExpectationSchema = z
  .strictObject({
    kind: z.literal("success"),
    messages_digest: z.string().regex(DIGEST_RE).optional(),
    trace: z.array(AssemblyTraceAssertionSchema).min(1).optional(),
  })
  .refine(
    (value) => value.messages_digest !== undefined || value.trace !== undefined,
    "success needs a message digest or trace assertion",
  );

export const AssemblyFixtureSchema = z.strictObject({
  id: z.string().regex(SEGMENT_RE),
  root: z.union([z.literal("self"), ExactRefSchema]),
  preset: z.union([z.literal("self"), ExactRefSchema]).optional(),
  profile: RuntimeProfileSchema,
  session: SessionSchema,
  assembler: EngineIdentitySchema,
  tokenizer: EngineIdentitySchema,
  expected: z.discriminatedUnion("kind", [
    AssemblySuccessExpectationSchema,
    z.strictObject({ kind: z.literal("error"), code: z.string().min(1) }),
  ]),
});
export type AssemblyFixture = z.infer<typeof AssemblyFixtureSchema>;
export type AssemblyFixtureInput = z.input<typeof AssemblyFixtureSchema>;
