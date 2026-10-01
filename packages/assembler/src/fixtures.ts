/** Deterministic author tests. No model calls, credentials, or runtime session capture. */
import {
  type AssemblyFixture,
  AssemblyFixtureSchema,
  type BuildCreationInput,
  buildCreation,
  CharError,
  type CreationArtifact,
  CreationArtifactSchema,
  canonicalizeCreation,
  digestExactJSON,
  type ExactRef,
  isCharError,
  type ReleaseInput,
  type SelectionPlan,
  type TurnViewInput,
} from "@char-pub/core";
import { ASSEMBLER, type AssembledMessage, type AssembleResult } from "./assemble.js";
import { createPreparationCatalog, prepareContext } from "./prepare.js";
import { fixedSelection } from "./selection.js";
import { createPinnedTokenCounter } from "./tokens.js";

export function digestAssemblyMessages(messages: readonly AssembledMessage[]): string {
  // Transport URLs differ between local builds, public CDN and private signed reads.
  // The attachment digest remains the content identity under test.
  return digestExactJSON(
    messages.map((message) => ({
      ...message,
      ...(message.attachments
        ? {
            attachments: message.attachments.map(({ url: _url, ...attachment }) => attachment),
          }
        : {}),
    })),
  );
}

function assertAssembler(identity: { name: string; version: string }): void {
  if (identity.name !== ASSEMBLER.name || identity.version !== ASSEMBLER.version)
    throw new CharError({
      code: "assembly.assembler_version_unsupported",
      subject: identity.name,
      detail: identity.version,
    });
}

export async function assembleArtifact(input: {
  artifact: CreationArtifact;
  session: TurnViewInput;
  plan?: SelectionPlan;
  source_texts?: Readonly<Record<string, string>>;
}): Promise<AssembleResult> {
  const parsed = CreationArtifactSchema.safeParse(input.artifact);
  if (!parsed.success)
    throw new CharError({
      code: "schema.invalid",
      subject: "artifact",
      detail: parsed.error.message,
    });
  const artifact = parsed.data;
  if (artifact.kind !== "content" || !artifact.assembly)
    throw new CharError({ code: "assembly.config_missing", subject: artifact.root.ref });
  const config = artifact.assembly;
  assertAssembler(config.assembler);
  if (config.profile.tokenizer !== config.tokenizer.name)
    throw new CharError({ code: "assembly.tokenizer_mismatch", subject: config.tokenizer.name });
  const counter = await createPinnedTokenCounter(config.tokenizer);
  return prepareContext({
    artifact,
    profile: config.profile,
    preset: config.preset,
    turn: input.session,
    ...(input.plan ? { plan: input.plan } : {}),
    ...(input.source_texts ? { source_texts: input.source_texts } : {}),
    counter,
  });
}

export interface AssemblyTestResult {
  id: string;
  ok: boolean;
  messages_digest?: string;
  trace?: AssembleResult["trace"];
  issues: string[];
  error?: { code: string; subject: string; detail?: string };
}

function selectedRelease(ref: ExactRef, inputs: readonly ReleaseInput[]): ReleaseInput {
  const release = inputs.find((item) => item.release === ref.release);
  if (!release) throw new CharError({ code: "assembly.release_missing", subject: ref.ref });
  const canonical = canonicalizeCreation(release.creation);
  if (canonical.creation.ref !== ref.ref || canonical.semantic_digest !== ref.semantic_digest)
    throw new CharError({ code: "assembly.pin_mismatch", subject: ref.ref });
  return release;
}

export async function runAssemblyFixture(
  input: BuildCreationInput & {
    fixture: AssemblyFixture;
  },
): Promise<AssemblyTestResult> {
  const parsed = AssemblyFixtureSchema.safeParse(input.fixture);
  if (!parsed.success)
    throw new CharError({
      code: "schema.invalid",
      subject: "fixture",
      detail: parsed.error.message,
    });
  const fixture = parsed.data;
  const result: AssemblyTestResult = { id: fixture.id, ok: false, issues: [] };
  // Engine failures must never satisfy an author's expected assembly failure.
  try {
    assertAssembler(fixture.assembler);
    if (fixture.profile.tokenizer !== fixture.tokenizer.name)
      throw new CharError({ code: "assembly.tokenizer_mismatch", subject: fixture.tokenizer.name });
    const counter = await createPinnedTokenCounter(fixture.tokenizer);
    const available = [
      ...("release" in input.root ? [input.root] : []),
      ...(input.dependencies ?? []),
    ];
    const contentRoot =
      fixture.root === "self" ? input.root : selectedRelease(fixture.root, available);
    const content = buildCreation({
      ...input,
      root: contentRoot,
      dependencies: available,
    }).artifact;
    if (content.kind !== "content")
      throw new CharError({ code: "assembly.content_required", subject: content.root.ref });
    const presetRoot =
      fixture.preset === undefined
        ? undefined
        : fixture.preset === "self"
          ? input.root
          : selectedRelease(fixture.preset, available);
    const policy = presetRoot
      ? buildCreation({ ...input, root: presetRoot, dependencies: available }).artifact
      : undefined;
    if (policy && policy.kind !== "preset")
      throw new CharError({ code: "assembly.preset_required", subject: policy.root.ref });
    let assembled: AssembleResult;
    const preparation = {
      artifact: content,
      profile: fixture.profile,
      turn: fixture.session,
      preset: policy?.kind === "preset" ? policy.preset : null,
      counter,
    };
    const plan =
      fixture.selection === undefined
        ? undefined
        : fixedSelection(createPreparationCatalog(preparation), fixture.selection);
    try {
      assembled = prepareContext({
        ...preparation,
        ...(plan ? { plan } : {}),
        ...(fixture.source_texts ? { source_texts: fixture.source_texts } : {}),
        diagnostics: "author",
      });
    } catch (error) {
      if (!isCharError(error)) throw error;
      if (error.code.startsWith("source.") || error.code.startsWith("selection.")) throw error;
      if (error.code.startsWith("catalog.") || error.code.startsWith("story.")) throw error;
      if (error.code === "assembly.default_policy_missing") throw error;
      result.error = error.toJSON();
      result.ok = fixture.expected.kind === "error" && fixture.expected.code === error.code;
      if (!result.ok) result.issues.push(`unexpected error: ${error.code}`);
      return result;
    }
    result.messages_digest = digestAssemblyMessages(assembled.messages);
    result.trace = assembled.trace;
    if (fixture.expected.kind === "error") {
      result.issues.push(`expected error: ${fixture.expected.code}; assembly succeeded`);
      return result;
    }
    if (
      fixture.expected.messages_digest &&
      fixture.expected.messages_digest !== result.messages_digest
    )
      result.issues.push(`messages digest differs: ${result.messages_digest}`);
    for (const assertion of fixture.expected.trace ?? []) {
      const entry = assembled.trace.entries.find((item) => item.id === assertion.source);
      if (!entry) result.issues.push(`trace source missing: ${assertion.source}`);
      else {
        if (
          assertion.included !== undefined &&
          (entry.decision === "included") !== assertion.included
        )
          result.issues.push(`trace inclusion differs: ${assertion.source}`);
        if (assertion.reason !== undefined && entry.reason !== assertion.reason)
          result.issues.push(`trace reason differs: ${assertion.source}`);
      }
    }
    result.ok = result.issues.length === 0;
  } catch (error) {
    if (!isCharError(error)) throw error;
    result.error = error.toJSON();
    result.issues.push(`fixture setup failed: ${error.code}`);
  }
  return result;
}

export async function runAssemblyTests(input: BuildCreationInput): Promise<{
  ok: boolean;
  results: AssemblyTestResult[];
}> {
  const { creation } = canonicalizeCreation(input.root.creation);
  // Validate the complete publication closure even when no fixtures are present.
  buildCreation(input);
  const results: AssemblyTestResult[] = [];
  for (const fixture of creation.assembly_tests ?? [])
    results.push(await runAssemblyFixture({ ...input, fixture }));
  return { ok: results.every((result) => result.ok), results };
}
