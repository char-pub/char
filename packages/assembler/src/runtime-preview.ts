/** Validate a synthetic local handoff without loading Source bodies or initializing a new session. */
import {
  buildIdentity,
  CharError,
  type CreationArtifact,
  CreationArtifactSchema,
  digestExactJSON,
  MAX_RUNTIME_PREVIEW_BYTES,
  type RuntimePreviewInput,
  RuntimePreviewInputSchema,
} from "@char-pub/core";
import { checkLateBindings } from "./assemble.js";
import { createPreparationCatalog } from "./prepare.js";
import { estimateCounter, isTokenizerName, TOKENIZER_VERSIONS } from "./tokens.js";
import { parseOrThrow } from "./validation.js";

function fail(reason: string, subject: string): never {
  throw new CharError({ code: `runtime_preview.${reason}`, subject });
}

/**
 * Bind an explicitly reviewed synthetic payload to an already acquired artifact.
 * This checks structure and identity only, not user consent, draft expiry or final token budgets.
 */
export function validateRuntimePreviewInput(
  artifact: CreationArtifact,
  raw: unknown,
): RuntimePreviewInput {
  let json: string | undefined;
  try {
    json = JSON.stringify(raw);
  } catch {
    fail("invalid_input", "input");
  }
  if (json === undefined) fail("invalid_input", "input");
  let bytes = 0;
  for (const character of json) {
    const point = character.codePointAt(0) ?? 0;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes > MAX_RUNTIME_PREVIEW_BYTES) fail("too_large", "input");
  }
  try {
    // Reject non-JSON data that JSON.stringify may otherwise erase or silently coerce.
    digestExactJSON(raw);
  } catch {
    fail("invalid_input", "input");
  }
  const value = parseOrThrow(
    RuntimePreviewInputSchema,
    raw,
    "input",
    "runtime_preview.invalid_input",
  );
  const content = parseOrThrow(
    CreationArtifactSchema,
    artifact,
    "artifact",
    "runtime_preview.invalid_input",
  );
  if (content.kind !== "content" || !content.story || !content.story_refs)
    fail("story_required", "artifact");
  if (
    digestExactJSON(value.source.root) !== digestExactJSON(content.root) ||
    value.source.lock_digest !== content.lock_digest ||
    value.source.artifact_json_digest !== digestExactJSON(artifact)
  )
    fail("source_mismatch", "source");
  const preset = content.assembly?.preset ?? content.default_policy;
  if (!preset) fail("preset_required", "preset");
  const identity = {
    ref: preset.ref,
    semantic_digest: preset.semantic_digest,
    ...buildIdentity(preset),
  };
  if (digestExactJSON(value.preset) !== digestExactJSON(identity))
    fail("preset_mismatch", "preset");
  if (
    !isTokenizerName(value.tokenizer.name) ||
    TOKENIZER_VERSIONS[value.tokenizer.name] !== value.tokenizer.version
  )
    fail("tokenizer_unsupported", "tokenizer");
  if (value.profile.tokenizer !== value.tokenizer.name)
    fail("tokenizer_mismatch", "profile.tokenizer");
  if (value.profile.locale !== value.turn.locale) fail("locale_mismatch", "profile.locale");
  const slots = new Set(content.ir.late_slots.map((slot) => slot.key));
  for (const key of Object.keys(value.turn.bindings))
    if (!slots.has(key)) fail("unknown_binding", `turn.bindings.${key}`);
  checkLateBindings(content.ir, value.turn);
  const participants = new Set(content.ir.participants.map((participant) => participant.key));
  for (const [index, message] of value.turn.history.entries())
    if (message.speaker !== undefined && !participants.has(message.speaker))
      fail("unknown_speaker", `turn.history.${index}.speaker`);
  // No directory is exposed and no token budget is evaluated here. An estimated structural
  // counter avoids asynchronously importing encoding tables; real preview loads the pinned counter.
  createPreparationCatalog(
    {
      artifact: content,
      profile: value.profile,
      preset,
      turn: value.turn,
      counter: { ...estimateCounter, tokenizer: value.tokenizer.name },
    },
    false,
  );
  return value;
}
