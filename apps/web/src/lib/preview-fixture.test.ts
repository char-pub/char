import {
  ASSEMBLER,
  type ContextAssemblyInput,
  createPreparationCatalog,
  createTokenCounter,
  digestAssemblyMessages,
  estimateCounter,
  fixedSelection,
  prepareContext,
  startSession,
  TOKENIZER_VERSIONS,
} from "@char-pub/assembler";
import {
  type BuildCreationInput,
  type CreationInput,
  canonicalizeCreation,
  createLocalBuildInput,
  sha256Bytes,
} from "@char-pub/core";
import { expect, it } from "vitest";
import { sampleDefaultPolicy } from "@/fixtures/samples";
import { buildTestCreation } from "@/test/build";
import { createPreviewFixture, verifyPreviewFixture } from "./preview-fixture";

const defaultPin = {
  ref: "@examples/preview-policy",
  release: sampleDefaultPolicy.release,
  semantic_digest: sampleDefaultPolicy.semantic_digest,
};
const world: CreationInput = {
  id: "cr_01j00000000000000000000001",
  ref: "@writer/archive",
  type: "world",
  display_name: "Archive",
  meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
  fragments: [
    {
      id: "world",
      stable: true,
      kind: "world",
      content: { type: "text", text: "The city is silent." },
    },
  ],
};
const draftOrigin = {
  kind: "draft-build" as const,
  build_id: "dbld_01j00000000000000000000001",
  revision: "rev_01j00000000000000000000001",
  expires_at: "2026-10-09T00:00:00.000Z",
};
function inputBuild(creation: CreationInput = world): BuildCreationInput {
  return {
    root: { creation, origin: draftOrigin, visibility: "private" },
    dependencies: [sampleDefaultPolicy],
    default_policy: defaultPin,
  };
}
function preview(build: BuildCreationInput): ContextAssemblyInput {
  const artifact = buildTestCreation(build).artifact;
  if (artifact.kind !== "content") throw new Error("Content required");
  return {
    artifact,
    profile: {
      runtime: { name: "fixture capture", version: "1" },
      tokenizer: "estimate",
      mode: "narrator",
      context_window: 8192,
      reserve_for_output: 512,
      capabilities: { system_role: true },
      locale: "en",
    },
    counter: estimateCounter,
    turn: {
      history: [{ role: "user", text: "Where am I?" }],
      bindings: Object.fromEntries(
        artifact.ir.late_slots.map((slot) => [
          slot.key,
          { kind: "persona" as const, display_name: "Sam" },
        ]),
      ),
    },
    diagnostics: "author",
  };
}
function capture(input: ContextAssemblyInput, saveTo: "content" | "preset" = "content") {
  return createPreviewFixture({
    input,
    result: prepareContext(input),
    id: "saved-preview",
    saveTo,
  });
}
function withFixture(
  build: BuildCreationInput,
  fixture: ReturnType<typeof capture>,
): BuildCreationInput {
  return {
    ...build,
    root: {
      ...build.root,
      creation: canonicalizeCreation({
        ...canonicalizeCreation(build.root.creation).creation,
        assembly_tests: [fixture],
      }).creation,
    },
  };
}

it("captures a draft Creative with self root and an exact default-policy pin, then runs the saved test", async () => {
  const build = inputBuild();
  const input = preview(build);
  const fixture = capture(input);
  expect(fixture.root).toBe("self");
  expect(fixture.preset).toEqual(defaultPin);
  expect(fixture.assembler).toEqual(ASSEMBLER);
  expect(fixture.tokenizer).toEqual({ name: "estimate", version: TOKENIZER_VERSIONS.estimate });
  expect(fixture.profile).toEqual(input.profile);
  expect(fixture.expected).toEqual({
    kind: "success",
    messages_digest: digestAssemblyMessages(prepareContext(input).messages),
  });
  expect(JSON.stringify(fixture)).not.toContain("plan_digest");
  expect(JSON.stringify(fixture)).not.toContain("dbld_");
  const verification = await verifyPreviewFixture({ fixture, build: withFixture(build, fixture) });
  expect(verification.ok, JSON.stringify(verification)).toBe(true);
  input.turn.history?.push({ role: "assistant", text: "A later edit" });
  expect(fixture.session.history).toHaveLength(1);
});

it("retains the complete initialized opening, Story snapshot, judgments, overlays and participant view", async () => {
  const story: CreationInput = {
    ...world,
    type: "scenario",
    cast: [{ key: "guest", who: { late: "persona" } }],
    story: {
      version: 1,
      scenes: [{ id: "hall", title: "Hall", opening: "The hall is dark." }],
      starts: [{ id: "arrival", greeting: "Welcome, {{user}}." }],
      vars: { clue: { type: "bool", init: false, description: "Clue discovered" } },
      beats: [
        {
          id: "clue",
          title: "Clue",
          description: "Find the clue",
          when: { judge: "Did the guest find it?" },
        },
      ],
    },
  };
  const build = inputBuild(story);
  const input = preview(build);
  if (input.artifact.kind !== "content") throw new Error("content");
  const bindings = Object.fromEntries(
    input.artifact.ir.late_slots.map((slot) => [
      slot.key,
      { kind: "persona" as const, display_name: "Sam" },
    ]),
  );
  const turn = startSession({ artifact: input.artifact, bindings }).turn;
  input.profile = { ...input.profile, mode: "per-agent" };
  const participant = input.artifact.story_refs?.participants.guest;
  if (!participant) throw new Error("guest required");
  input.turn = {
    for_participant: participant,
    ...turn,
    history: [...turn.history, { role: "user", text: "I examine the clue." }],
    judgments: [
      {
        target: "beat/clue",
        path: "when",
        result: "true",
        provider: { name: "manual", version: "1" },
      },
    ],
    visible_overlay: { memory: ["The guest entered alone."] },
    focus: "clue",
    story_guidance: true,
  };
  const fixture = capture(input);
  expect(fixture.session).toEqual(input.turn);
  expect(fixture.session.history[0]?.text).toBe("Welcome, Sam.");
  expect((await verifyPreviewFixture({ fixture, build: withFixture(build, fixture) })).ok).toBe(
    true,
  );
});

it("stores ordered fixed refs instead of a selector Plan and reproduces keyword misses", async () => {
  const creation: CreationInput = {
    ...world,
    fragments: [
      ...(world.fragments ?? []),
      ...["first", "second"].map((id) => ({
        id,
        stable: true,
        kind: "knowledge" as const,
        description: `${id} evidence`,
        selectable: true,
        activation: { mode: "keyword" as const, keys: ["unmentioned"] },
        content: { type: "text" as const, text: `${id} CANDIDATE` },
      })),
    ],
  };
  const build = inputBuild(creation);
  const input = preview(build);
  if (input.artifact.kind !== "content") throw new Error("content");
  const refs = input.artifact.ir.fragments
    .filter((f) => f.origin.fragment !== "world")
    .reverse()
    .map((f) => ({ fragment: f.id }));
  input.plan = fixedSelection(createPreparationCatalog(input), refs);
  // A provider may return its selected array out of rank order.
  input.plan.selected.reverse();
  const fixture = capture(input);
  expect(fixture.selection).toEqual(refs);
  expect((await verifyPreviewFixture({ fixture, build: withFixture(build, fixture) })).ok).toBe(
    true,
  );
});

it("keeps selected Source bytes under their full IR asset IDs through canonical save and runner replay", async () => {
  const text = "\uFEFF# Heading\r\nCafe\u0301  \r\nTail \t\r\n";
  const bytes = new TextEncoder().encode(text);
  const creation: CreationInput = {
    ...world,
    sources: [
      {
        id: "guide",
        title: "Guide",
        description: "Details",
        asset: "guide",
        format: "markdown",
        sections: [{ id: "heading", title: "Heading", anchor: "#Heading" }],
      },
    ],
    assets: [
      {
        slot: "guide",
        role: "context",
        variants: [
          {
            id: "default",
            media_type: "text/markdown",
            blob: { digest: sha256Bytes(bytes), size: bytes.length, availability: "mirrored" },
          },
        ],
      },
    ],
  };
  const build = inputBuild(creation);
  const input = preview(build);
  if (input.artifact.kind !== "content") throw new Error("content");
  const source = input.artifact.catalog_index.sources[0];
  if (!source) throw new Error("source");
  input.plan = fixedSelection(createPreparationCatalog(input), [
    { source: source.id, section: "heading" },
  ]);
  input.source_texts = {
    [source.asset]: text,
    "unused-private-body": "Do not copy this unused body",
  };
  const fixture = capture(input);
  expect(fixture.source_texts).toEqual({ [source.asset]: text });
  const saved = withFixture(build, fixture);
  const canonical = canonicalizeCreation(saved.root.creation).creation;
  expect(canonical.assembly_tests?.[0]?.source_texts?.[source.asset]).toBe(text);
  const verification = await verifyPreviewFixture({
    fixture: canonical.assembly_tests?.[0] ?? fixture,
    build: saved,
  });
  expect(verification.ok, JSON.stringify(verification)).toBe(true);
});

it("pins the actual tokenizer implementation and rejects a result from stale preview input", async () => {
  const build = inputBuild();
  const input = preview(build);
  input.counter = await createTokenCounter("cl100k_base");
  input.profile = { ...input.profile, tokenizer: "cl100k_base" };
  const fixture = capture(input);
  expect(fixture.tokenizer).toEqual({
    name: "cl100k_base",
    version: TOKENIZER_VERSIONS.cl100k_base,
  });
  expect((await verifyPreviewFixture({ fixture, build })).ok).toBe(true);
  const result = prepareContext(input);
  input.turn = { ...input.turn, history: [{ role: "user", text: "Changed since preview" }] };
  expect(() => createPreviewFixture({ input, result, id: "stale", saveTo: "content" })).toThrow(
    /preview_fixture.stale_result/,
  );
});

it("keeps the original expectation when a subsequent run changes", async () => {
  const build = inputBuild();
  const fixture = capture(preview(build));
  const expected = structuredClone(fixture.expected);
  const changed = {
    ...world,
    fragments: [
      {
        id: "world",
        stable: true,
        kind: "world" as const,
        content: { type: "text" as const, text: "A completely different world." },
      },
    ],
  };
  const verification = await verifyPreviewFixture({ fixture, build: inputBuild(changed) });
  expect(verification.ok).toBe(false);
  expect(verification.issues.join(" ")).toContain("digest differs");
  expect(fixture.expected).toEqual(expected);
});

it("uses self for an edited Preset and exact published content; ephemeral cross-work roots and policies are rejected", async () => {
  const contentBuild: BuildCreationInput = {
    ...inputBuild(),
    root: { creation: world, release: "rel_01j00000000000000000000001", visibility: "public" },
  };
  const input = preview(contentBuild);
  const policyCreation: CreationInput = {
    ...(sampleDefaultPolicy.creation as CreationInput),
    id: "cr_01j00000000000000000000002",
    ref: "@writer/policy",
  };
  const build: BuildCreationInput = {
    root: { creation: policyCreation, origin: draftOrigin, visibility: "private" },
    dependencies: [
      ...(contentBuild.dependencies ?? []),
      contentBuild.root as Extract<BuildCreationInput["root"], { release: string }>,
    ],
    default_policy: defaultPin,
  };
  const policy = buildTestCreation(build).artifact;
  if (policy.kind !== "preset") throw new Error("preset");
  input.preset = policy.preset;
  const fixture = capture(input, "preset");
  expect(fixture.preset).toBe("self");
  expect(fixture.root).toEqual(input.artifact.root);
  const verification = await verifyPreviewFixture({ fixture, build: withFixture(build, fixture) });
  expect(verification.ok, JSON.stringify(verification)).toBe(true);
  expect(() => capture(input, "content")).toThrow(/preview_fixture.release_required/);
  const draftInput = preview(inputBuild());
  draftInput.preset = policy.preset;
  expect(() => capture(draftInput, "preset")).toThrow(/preview_fixture.release_required/);
});

it("permits a real local content build as self without pretending it is a Registry release", async () => {
  const build = createLocalBuildInput({
    root: { creation: world },
    dependencies: [sampleDefaultPolicy],
    default_policy: defaultPin,
  });
  const fixture = capture(preview(build));
  expect(fixture.root).toBe("self");
  expect(JSON.stringify(fixture)).not.toContain("local-build");
  const saved = createLocalBuildInput({
    root: { creation: { ...world, assembly_tests: [fixture] } },
    dependencies: [sampleDefaultPolicy],
    default_policy: defaultPin,
  });
  expect(saved.root.origin.input_digest).not.toBe(build.root.origin.input_digest);
  const verification = await verifyPreviewFixture({ fixture, build: saved });
  expect(verification.ok, JSON.stringify(verification)).toBe(true);
});

it("preserves exact synthetic session text through canonical save instead of changing its first expectation", async () => {
  const build = inputBuild();
  const input = preview(build);
  input.turn = {
    ...input.turn,
    history: [{ role: "user", text: "Cafe\u0301  \r\nAre you there?\t" }],
    bindings: {
      user: { kind: "persona", display_name: "Sam", description: "Player e\u0301 \r\n" },
    },
    overlay: { memory: ["Remember e\u0301  \r\n"] },
  };
  const fixture = capture(input);
  const saved = withFixture(build, fixture);
  const persisted = canonicalizeCreation(saved.root.creation).creation.assembly_tests?.[0];
  expect(persisted?.session).toEqual(fixture.session);
  const result = await verifyPreviewFixture({ fixture: persisted ?? fixture, build: saved });
  expect(result.ok, JSON.stringify(result)).toBe(true);
});

it("does not let canonical saving activate a keyword that was absent in the preview", async () => {
  const creation: CreationInput = {
    ...world,
    fragments: [
      ...(world.fragments ?? []),
      {
        id: "keyword",
        stable: true,
        kind: "knowledge",
        activation: { mode: "keyword", keys: ["go\nnow"] },
        content: { type: "text", text: "KEYWORD_MATCH" },
      },
    ],
  };
  const build = inputBuild(creation);
  const input = preview(build);
  input.turn = { ...input.turn, history: [{ role: "user", text: "go\r\nnow" }] };
  const fixture = capture(input);
  const saved = withFixture(build, fixture);
  const persisted = canonicalizeCreation(saved.root.creation).creation.assembly_tests?.[0];
  const result = await verifyPreviewFixture({ fixture: persisted ?? fixture, build: saved });
  expect(result.ok, JSON.stringify(result)).toBe(true);
});

it("captures a locked Scenario's precise policy and honors an explicit published override", async () => {
  const unlocked = preview(inputBuild());
  const creation: CreationInput = {
    ...world,
    type: "scenario",
    cast: [{ key: "guest", who: { late: "persona" } }],
    assembly: {
      version: "1-draft",
      preset: defaultPin,
      profile: unlocked.profile,
      assembler: ASSEMBLER,
      tokenizer: { name: "estimate", version: TOKENIZER_VERSIONS.estimate },
    },
  };
  const build = inputBuild(creation);
  const input = preview(build);
  const locked = capture(input);
  expect(locked.preset).toEqual(defaultPin);
  const alternateCreation: CreationInput = {
    ...(sampleDefaultPolicy.creation as CreationInput),
    id: "cr_01j00000000000000000000003",
    ref: "@writer/alternate",
  };
  const alternate = {
    creation: alternateCreation,
    release: "rel_01j00000000000000000000003",
    semantic_digest: canonicalizeCreation(alternateCreation).semantic_digest,
    visibility: "public" as const,
  };
  const policy = buildTestCreation({ root: alternate }).artifact;
  if (policy.kind !== "preset") throw new Error("preset");
  input.preset = policy.preset;
  const fixture = capture(input);
  expect(fixture.preset).toEqual({
    ref: "@writer/alternate",
    release: alternate.release,
    semantic_digest: alternate.semantic_digest,
  });
  const verification = await verifyPreviewFixture({
    fixture,
    build: withFixture(
      { ...build, dependencies: [...(build.dependencies ?? []), alternate] },
      fixture,
    ),
  });
  expect(verification.ok, JSON.stringify(verification)).toBe(true);
});

it("refuses unversioned custom counters rather than inventing an engine version", () => {
  const input = preview(inputBuild());
  input.counter = { ...estimateCounter, tokenizer: "private-counter" };
  input.profile = { ...input.profile, tokenizer: "private-counter" };
  expect(() => capture(input)).toThrow(/assembly.tokenizer_version_unsupported/);
});
