/** Capture a reproducible author fixture from one successful, already loaded preview. */
import {
  ASSEMBLER,
  type AssembleResult,
  type AssemblyTestResult,
  type ContextAssemblyInput,
  catalogKey,
  createPreparationCatalog,
  digestAssemblyMessages,
  estimateCounter,
  fixedSelection,
  isTokenizerName,
  prepareContext,
  runAssemblyFixture,
  sourceRequests,
  TOKENIZER_VERSIONS,
} from "@char-pub/assembler";
import {
  type AssemblyFixture,
  AssemblyFixtureSchema,
  type BuildCreationInput,
  type BuildRef,
  CharError,
  compareStrings,
  type ExactRef,
  ExactRefSchema,
} from "@char-pub/core";

export interface PreviewFixtureCapture {
  /** Exactly the final preparation input, including fetched Source bodies and actual counter. */
  input: ContextAssemblyInput;
  result: AssembleResult;
  id: string;
  /** Content owns root:self; a Preset owns preset:self and needs a published content root. */
  saveTo: "content" | "preset";
}
function exact(value: BuildRef, subject: string): ExactRef {
  if (!("release" in value))
    throw new CharError({
      code: "preview_fixture.release_required",
      subject,
      detail: "Draft and local builds cannot be saved as a cross-work release pin.",
    });
  return ExactRefSchema.parse({
    ref: value.ref,
    release: value.release,
    semantic_digest: value.semantic_digest,
  });
}

/**
 * Uses this preview only to establish a NEW expectation. Re-running an existing test must use
 * runAssemblyFixture; it must never replace expected with a newer preview digest automatically.
 * No build snapshots, private URLs, Plan digests or enclosing artifact identities are fabricated.
 */
export function createPreviewFixture(capture: PreviewFixtureCapture): AssemblyFixture {
  const { input, result, id, saveTo } = capture;
  const artifact = input.artifact;
  if (artifact.kind !== "content")
    throw new CharError({ code: "assembly.content_required", subject: artifact.root.ref });
  const counter = input.counter ?? estimateCounter;
  if (!isTokenizerName(counter.tokenizer))
    throw new CharError({
      code: "assembly.tokenizer_version_unsupported",
      subject: counter.tokenizer,
      detail: "Use a tokenizer provided by this SDK to save a reproducible test.",
    });
  const current = prepareContext(input);
  if (JSON.stringify(current) !== JSON.stringify(result))
    throw new CharError({
      code: "preview_fixture.stale_result",
      subject: id,
      detail: "Run the current preview again before saving it as a test.",
    });
  const preset =
    input.preset === undefined
      ? (artifact.assembly?.preset ?? artifact.default_policy)
      : (input.preset ?? artifact.default_policy);
  if (!preset)
    throw new CharError({ code: "assembly.default_policy_missing", subject: artifact.root.ref });
  if (saveTo === "preset" && !input.preset)
    throw new CharError({
      code: "preview_fixture.preset_required",
      subject: id,
      detail: "Preview the edited Preset explicitly before saving its test.",
    });
  const root = saveTo === "content" ? "self" : exact(artifact.root, "fixture.root");
  const presetRef = saveTo === "preset" ? "self" : exact(preset, "fixture.preset");
  const build = createPreparationCatalog(input, input.plan?.discovery ?? false);
  const session = {
    ...build.context.turn,
    locale: build.context.turn.locale ?? artifact.ir.meta.default_locale,
  };
  // Rank is part of admission order. Fixed selection preserves that order without storing a Plan
  // whose artifact digest would change as soon as the fixture is added to the owning creation.
  const selection = [...(input.plan?.selected ?? [])]
    .sort((a, b) => a.rank - b.rank || compareStrings(catalogKey(a.ref), catalogKey(b.ref)))
    .map((item) => item.ref);
  const sourceTexts: Record<string, string> = {};
  for (const request of sourceRequests(input)) {
    const text = input.source_texts?.[request.asset];
    if (text === undefined)
      throw new CharError({ code: "source.text_missing", subject: request.asset });
    sourceTexts[request.asset] = text;
  }
  const replay: ContextAssemblyInput = {
    artifact,
    profile: input.profile,
    preset,
    turn: session,
    counter,
    ...(Object.keys(sourceTexts).length ? { source_texts: sourceTexts } : {}),
  };
  if (selection.length) replay.plan = fixedSelection(createPreparationCatalog(replay), selection);
  const expectedDigest = digestAssemblyMessages(result.messages);
  if (digestAssemblyMessages(prepareContext(replay).messages) !== expectedDigest)
    throw new CharError({
      code: "preview_fixture.not_reproducible",
      subject: id,
      detail: "Fixed choices did not reproduce this preview. Run a fixed-selection preview first.",
    });
  // Parsing produces independent objects, so later UI edits cannot mutate the saved expectation.
  return AssemblyFixtureSchema.parse({
    id,
    root,
    preset: presetRef,
    profile: input.profile,
    session,
    ...(selection.length ? { selection } : {}),
    ...(Object.keys(sourceTexts).length ? { source_texts: sourceTexts } : {}),
    assembler: { ...ASSEMBLER },
    tokenizer: { name: counter.tokenizer, version: TOKENIZER_VERSIONS[counter.tokenizer] },
    expected: { kind: "success", messages_digest: expectedDigest },
  });
}

/**
 * Full verification needs original root/dependency snapshots. A browser preview artifact does
 * not contain them; callers without those snapshots must run the Registry draft builder.
 */
export function verifyPreviewFixture({
  fixture,
  build,
}: {
  fixture: AssemblyFixture;
  build: BuildCreationInput;
}): Promise<AssemblyTestResult> {
  return runAssemblyFixture({ ...build, fixture });
}
