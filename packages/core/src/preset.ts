import { z } from "zod";
import { canonicalizeCreation } from "./canonical.js";
import { checkCreation } from "./check.js";
import { CharError } from "./errors.js";
import { DigestSchema, ReleaseIdSchema } from "./schema/creation.js";
import { type ResolvedPreset, ResolvedPresetSchema } from "./schema/preset.js";
import { RESOLVER } from "./version.js";

export interface ResolvePresetInput {
  creation: unknown;
  release: string;
  semantic_digest: string;
}

const InputSchema = z.strictObject({
  creation: z.unknown(),
  release: ReleaseIdSchema,
  semantic_digest: DigestSchema,
});

/** 纯计算完整快照的摘要；Registry 的可见性与发布状态检查由调用方负责。 */
export function resolvePreset(input: ResolvePresetInput): ResolvedPreset {
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CharError({
      code: "schema.invalid",
      subject: "preset",
      detail: parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; "),
    });
  }
  const { creation, semantic_digest } = canonicalizeCreation(parsed.data.creation);
  if (creation.type !== "preset" || creation.policy === undefined) {
    throw new CharError({ code: "resolve.not_preset", subject: creation.ref });
  }
  const checked = checkCreation(creation);
  if (!checked.ok) {
    throw new CharError({
      code: "resolve.invalid_preset",
      subject: creation.ref,
      data: { diagnostics: checked.diagnostics },
    });
  }
  if (parsed.data.semantic_digest !== semantic_digest) {
    throw new CharError({
      code: "resolve.semantic_digest_mismatch",
      subject: parsed.data.release,
      detail: `stored ${parsed.data.semantic_digest}, computed ${semantic_digest}`,
    });
  }
  return ResolvedPresetSchema.parse({
    ref: creation.ref,
    release: parsed.data.release,
    semantic_digest,
    resolver: RESOLVER,
    policy: creation.policy,
  });
}
