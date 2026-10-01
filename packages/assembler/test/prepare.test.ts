import {
  AssemblyTraceSchema,
  type CreationInput,
  canonicalizeCreation,
  initStoryState,
  PRESET_REGIONS,
  sha256Bytes,
  toTurnStory,
} from "@char-pub/core";
import { describe, expect, it } from "vitest";
import { buildTestCreation, withTestDefault } from "../../core/test/build.js";
import { tid } from "../../core/test/fixtures.js";
import { ASSEMBLER } from "../src/assemble.js";
import { selectorCatalog } from "../src/catalog.js";
import { assembleArtifact, runAssemblyFixture } from "../src/fixtures.js";
import { assemble, sourceRequests } from "../src/index.js";
import { createPreparationCatalog, initialStoryTurn, prepareContext } from "../src/prepare.js";
import { fixedSelection, noneSelection } from "../src/selection.js";
import { estimateCounter, TOKENIZER_VERSIONS } from "../src/tokens.js";

function fixture() {
  const text = "PUBLIC_SECTION\nUNSELECTED_REFERENCE_BODY";
  const creation: CreationInput = {
    id: tid("cr", 101),
    ref: "@djj/inn",
    type: "scenario",
    display_name: "Inn",
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
    cast: [
      { key: "alice", who: { late: "character" }, part: "Host", goal: "PRIVATE_ALICE_GOAL" },
      { key: "bob", who: { late: "character" }, part: "Detective", goal: "Find the guest" },
    ],
    fragments: [
      {
        id: "secret",
        stable: true,
        kind: "knowledge",
        importance: "pinned",
        content: { type: "text", text: "PRIVATE_SECRET_BODY" },
      },
      {
        id: "public",
        stable: true,
        kind: "knowledge",
        perspective: { claim: "{{cast:alice}}" },
        content: { type: "text", text: "PUBLIC_CLAIM" },
      },
      {
        id: "irrelevant",
        stable: true,
        kind: "knowledge",
        activation: { mode: "manual" },
        content: { type: "text", text: "UNSELECTED_MANUAL_BODY" },
      },
      {
        id: "first",
        stable: true,
        kind: "knowledge",
        activation: { mode: "semantic" },
        description: "First candidate",
        content: { type: "text", text: "FIRST_BODY" },
      },
      {
        id: "second",
        stable: true,
        kind: "knowledge",
        activation: { mode: "semantic" },
        description: "Second candidate",
        content: { type: "text", text: "SECOND_BODY" },
      },
    ],
    sources: [
      {
        id: "book",
        title: "Book",
        description: "Guide",
        asset: "book",
        format: "text",
        visibility: { scope: "shared" },
        sections: [{ id: "first", title: "First", anchor: "L1-L1" }],
      },
    ],
    assets: [
      {
        slot: "book",
        role: "context",
        variants: [
          {
            id: "default",
            media_type: "text/plain",
            blob: {
              digest: sha256Bytes(new TextEncoder().encode(text)),
              size: new TextEncoder().encode(text).length,
              availability: "mirrored",
            },
          },
        ],
      },
    ],
    story: {
      version: 1,
      scenes: [
        {
          id: "lobby",
          title: "Lobby",
          opening: "{{cast:bob}} meets {{user}}.",
          lore: ["#book/first"],
        },
      ],
      knowing: { "#secret": { start: { knows: ["alice"], not: ["bob"] } } },
    },
  };
  const { artifact } = buildTestCreation({
    root: { creation, release: tid("rel", 101), visibility: "public" },
  });
  if (artifact.kind !== "content" || !artifact.story) throw new Error("Bad fixture");
  const state = initStoryState(artifact.story, ["alice", "bob"]);
  const bindings = Object.fromEntries(
    artifact.ir.late_slots.map((slot) => {
      const actor = artifact.ir.participants.find((p) => p.late === slot.key);
      const key = actor?.cast_key;
      return [
        slot.key,
        {
          kind: key ? ("character" as const) : ("persona" as const),
          display_name: key === "alice" ? "Alice" : key === "bob" ? "Bob" : "Player",
          ...(key
            ? {
                description: `PRIVATE_BINDING_${key.toUpperCase()}`,
                outward_description: `${key} wears a coat`,
              }
            : {}),
        },
      ];
    }),
  );
  const source = artifact.catalog_index.sources[0];
  if (!source) throw new Error("No source");
  const input = {
    artifact,
    profile: {
      runtime: { name: "test", version: "1" },
      tokenizer: "characters",
      context_window: 4000,
      reserve_for_output: 0,
      mode: "per-agent" as const,
      capabilities: { system_role: true, multiple_system_messages: true },
    },
    turn: {
      scene: state.scene,
      present: ["alice", "bob"],
      story: toTurnStory(state),
      for_participant: "bob",
      bindings,
      overlay: { state: { secret: "PRIVATE_GLOBAL_OVERLAY" } },
      visible_overlay: { memory: ["PUBLIC_MEMORY"] },
      history: [],
    },
    counter: { tokenizer: "characters", estimated: true, count: (s: string) => s.length },
    source_texts: { [source.asset]: text },
    selection: { catalog_budget: 4000, max_depth: 4 },
  };
  return { input, artifact, creation, source };
}

describe("prepared context reaches final model messages", () => {
  it("does not activate or disclose a secret through a visible fragment's about link", () => {
    const { input, creation } = fixture();
    const publicFragment = creation.fragments?.find((f) => f.id === "public");
    if (!publicFragment) throw new Error("Missing public fragment");
    publicFragment.about = ["#secret"];
    const { artifact } = buildTestCreation({
      root: { creation, release: tid("rel", 101), visibility: "public" },
    });
    if (artifact.kind !== "content") throw new Error("Wrong artifact");
    expect(artifact.catalog_index.about).toHaveLength(1);
    const prepared = { ...input, artifact };
    const directory = selectorCatalog(createPreparationCatalog(prepared).catalog);
    expect(directory.view).toEqual({ mode: "per-agent", for: "bob", scene: "lobby" });
    expect(directory.candidates.length).toBeGreaterThan(0);
    const discovery = JSON.stringify(directory);
    const result = prepareContext(prepared);
    expect(JSON.stringify(result.messages)).toContain("PUBLIC_CLAIM");
    expect(JSON.stringify(result.messages)).not.toContain("PRIVATE_SECRET_BODY");
    expect(discovery).not.toContain("PRIVATE_SECRET_BODY");
    expect(discovery).not.toContain("#secret");
  });

  it("routes the public assemble API through projection and exact selection", () => {
    const { input } = fixture();
    const catalog = createPreparationCatalog(input);
    const selected = input.artifact.ir.fragments.find((f) => f.origin.fragment === "second");
    if (!selected) throw new Error("Missing selection fixture");
    const plan = fixedSelection(catalog, [{ fragment: selected.id }]);
    const result = assemble({ ...input, plan });
    expect(result).toEqual(prepareContext({ ...input, plan }));
    const serialized = JSON.stringify(result);
    expect(serialized).toContain("SECOND_BODY");
    expect(serialized).not.toContain("FIRST_BODY");
    expect(serialized).not.toContain("PRIVATE_SECRET_BODY");
    expect(serialized).not.toContain("PRIVATE_GLOBAL_OVERLAY");
    expect(result.trace.selection).toBeDefined();
    expect(() =>
      assemble({
        // @ts-expect-error Raw IR is no longer a public assembly input.
        ir: input.artifact.ir,
        profile: input.profile,
        session: input.turn,
      }),
    ).toThrow(/assemble.invalid_input/);
  });
  it("consumes the published default policy when no explicit preset is supplied or null is chosen", () => {
    const { input, creation } = fixture();
    const policy: CreationInput = {
      id: tid("cr", 105),
      ref: "@commons/default-preset",
      type: "preset",
      display_name: "Default",
      meta: creation.meta,
      policy: {
        version: "1-draft",
        blocks: [{ id: "base", text: "LOCKED_DEFAULT_POLICY", default_at: "main" }],
        layout: [...PRESET_REGIONS],
        requires: { system_role: true },
      },
    };
    const snapshot = { creation: policy, release: tid("rel", 105), visibility: "public" as const };
    const default_policy = {
      ref: policy.ref,
      release: snapshot.release,
      semantic_digest: canonicalizeCreation(policy).semantic_digest,
    };
    const { artifact } = buildTestCreation({
      root: { creation, release: tid("rel", 101), visibility: "public" },
      dependencies: [snapshot],
      default_policy,
    });
    const inherited = prepareContext({ ...input, artifact });
    const explicitDefault = prepareContext({ ...input, artifact, preset: null });
    expect(inherited).toEqual(explicitDefault);
    expect(inherited.messages[0]?.content).toBe("LOCKED_DEFAULT_POLICY");
    expect(inherited.trace.preset).toMatchObject({ release: snapshot.release });
  });
  it("applies preset selection ceilings and custom labels to the actual prepared messages", () => {
    const { input, creation: sourceCreation } = fixture();
    const policy = buildTestCreation({
      root: {
        release: tid("rel", 103),
        visibility: "public",
        creation: {
          id: tid("cr", 103),
          ref: "@djj/labels",
          type: "preset",
          display_name: "Labels",
          meta: sourceCreation.meta,
          policy: {
            version: "1-draft",
            blocks: [],
            layout: [...PRESET_REGIONS],
            requires: { system_role: true },
            selection: { catalog_budget: 0, max_depth: 1 },
            render: {
              "perspective.claim": "Account from {{speaker}}:",
              "sources.notice": "REFERENCE ONLY",
              "knowing.narrator": "Known: {{knows}}; unknown: {{unknown}}",
            },
          },
        },
      },
    }).artifact;
    if (policy.kind !== "preset") throw new Error("Expected preset");
    const selected = {
      ...input,
      preset: policy.preset,
      selection: { catalog_budget: 9000, max_depth: 9 },
    };
    expect(() => createPreparationCatalog(selected)).toThrow("catalog.directory_over_budget");
    const build = createPreparationCatalog(selected, false);
    expect(build.selection).toEqual({ catalog_budget: 0, max_depth: 1 });
    const output = prepareContext({ ...selected, profile: { ...input.profile, mode: "narrator" } });
    const text = output.messages.map((m) => m.content).join("\n");
    expect(text).toContain("Account from Alice:");
    expect(text).toContain("REFERENCE ONLY");
    expect(text).toContain("Known: Alice; unknown: Bob");
    expect(text).not.toContain("{{speaker}}");
    const defaultDepth = { ...policy.preset, policy: { ...policy.preset.policy, selection: {} } };
    expect(
      createPreparationCatalog({ ...selected, preset: defaultDepth }, false).selection.max_depth,
    ).toBe(4);
    const explicitDepth = {
      ...defaultDepth,
      policy: { ...defaultDepth.policy, selection: { max_depth: 4 } },
    };
    expect(
      createPreparationCatalog({ ...selected, preset: explicitDepth }, false).selection.max_depth,
    ).toBe(4);
  });
  it("uses the full preparation path for a published locked assembly", async () => {
    const { input, creation } = fixture();
    const preset: CreationInput = {
      id: tid("cr", 102),
      ref: "@djj/story-policy",
      type: "preset",
      display_name: "Story policy",
      meta: creation.meta,
      policy: {
        version: "1-draft",
        blocks: [{ id: "locked", text: "LOCKED_POLICY", default_at: "main" }],
        layout: [...PRESET_REGIONS],
        requires: { system_role: true },
      },
    };
    const profile = { ...input.profile, tokenizer: "estimate" };
    const pin = {
      ref: preset.ref,
      release: tid("rel", 102),
      semantic_digest: canonicalizeCreation(preset).semantic_digest,
    };
    creation.assembly = {
      version: "1-draft",
      preset: pin,
      profile,
      assembler: ASSEMBLER,
      tokenizer: { name: "estimate", version: TOKENIZER_VERSIONS.estimate },
    };
    const { artifact } = buildTestCreation({
      root: { creation, release: tid("rel", 101), visibility: "public" },
      dependencies: [
        {
          creation: preset,
          release: pin.release,
          semantic_digest: pin.semantic_digest,
          visibility: "public",
        },
      ],
    });
    const output = await assembleArtifact({
      artifact,
      session: input.turn,
      source_texts: input.source_texts,
    });
    const text = output.messages.map((m) => m.content).join("\n");
    expect(text).toContain("Bob meets Player.");
    expect(text).toContain("PUBLIC_SECTION");
    expect(text).not.toContain("PRIVATE_SECRET_BODY");
    expect(text).toContain("LOCKED_POLICY");
    expect(() =>
      prepareContext({ ...input, artifact, profile, counter: estimateCounter, preset: null }),
    ).toThrow("assembly.default_policy_missing");
    const fixtureResult = await runAssemblyFixture(
      withTestDefault({
        root: { creation, release: tid("rel", 101), visibility: "public" },
        dependencies: [{ creation: preset, release: pin.release, visibility: "public" }],
        fixture: {
          id: "default-layout",
          root: "self",
          session: input.turn,
          profile,
          source_texts: input.source_texts,
          assembler: ASSEMBLER,
          tokenizer: { name: "estimate", version: TOKENIZER_VERSIONS.estimate },
          expected: {
            kind: "success",
            trace: [{ source: "story:scene:lobby", included: true, reason: "required" }],
          },
        },
      }),
    );
    expect(fixtureResult.ok).toBe(false);
    expect(fixtureResult.issues).toEqual(["fixture setup failed: assembly.default_policy_missing"]);
  });

  it("initializes a fresh opening explicitly, without silently repairing a partial runtime snapshot", () => {
    const { artifact, input } = fixture();
    const initial = initialStoryTurn(artifact);
    expect(initial.scene).toBe("lobby");
    expect(initial.story?.visited).toEqual(["lobby"]);
    expect(initial.present).toEqual(["alice", "bob"]);
    expect(() => initialStoryTurn(artifact, "missing")).toThrowError(
      expect.objectContaining({ code: "story.unknown_start" }),
    );
    const { story: _story, ...partial } = input.turn;
    expect(() => prepareContext({ ...input, turn: partial })).toThrowError(
      expect.objectContaining({ code: "catalog.story_state_required" }),
    );
  });

  it.each(["narrator", "per-agent"] as const)(
    "does not inject absent late-role descriptions in %s mode",
    (mode) => {
      const { input } = fixture();
      const output = prepareContext({
        ...input,
        profile: { ...input.profile, mode },
        turn: { ...input.turn, present: ["bob"] },
      });
      const text = output.messages.map((m) => m.content).join("\n");
      expect(text).not.toContain("PRIVATE_BINDING_ALICE");
      expect(text).not.toContain("alice wears a coat");
      expect(text).toContain("PRIVATE_BINDING_BOB");
    },
  );

  it("replays a no-discovery plan even with zero directory budget", () => {
    const { input } = fixture();
    const preparation = { ...input, selection: { catalog_budget: 0, max_depth: 4 } };
    const plan = noneSelection(createPreparationCatalog(preparation, false));
    expect(prepareContext({ ...preparation, plan })).toEqual(prepareContext(preparation));
    const fallback = { ...plan, fallback: "skip" as const };
    expect(prepareContext({ ...preparation, plan: fallback })).toEqual(
      prepareContext({ ...preparation, fallback: "skip" }),
    );
  });

  it("rejects invalid story setup even when an author expects that error", async () => {
    const { input, creation } = fixture();
    const { story: _story, ...partial } = input.turn;
    const result = await runAssemblyFixture(
      withTestDefault({
        root: { creation, release: tid("rel", 101), visibility: "public" },
        fixture: {
          id: "bad-state",
          root: "self",
          session: partial,
          profile: { ...input.profile, tokenizer: "estimate" },
          assembler: ASSEMBLER,
          tokenizer: { name: "estimate", version: TOKENIZER_VERSIONS.estimate },
          expected: { kind: "error", code: "catalog.story_state_required" },
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(["fixture setup failed: catalog.story_state_required"]);
  });

  it("compiles authored fixed choices after building the enclosing artifact", async () => {
    const { input, artifact, creation } = fixture();
    const selected = artifact.ir.fragments.find((f) => f.origin.fragment === "second");
    if (!selected) throw new Error("Missing fragment");
    const authored = {
      id: "selected-fact",
      root: "self" as const,
      profile: { ...input.profile, tokenizer: "estimate" },
      session: input.turn,
      selection: [{ fragment: selected.id }],
      source_texts: input.source_texts,
      assembler: ASSEMBLER,
      tokenizer: { name: "estimate", version: TOKENIZER_VERSIONS.estimate },
      expected: {
        kind: "success" as const,
        trace: [{ source: selected.id, included: true, reason: "selected" }],
      },
    };
    creation.assembly_tests = [authored];
    const result = await runAssemblyFixture(
      withTestDefault({
        root: { creation, release: tid("rel", 101), visibility: "public" },
        fixture: authored,
      }),
    );
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });
  it("uses exact selection, story templates, private projections and verified source sections", () => {
    const { input, artifact } = fixture();
    const build = createPreparationCatalog(input);
    const selected = artifact.ir.fragments.find((f) => f.origin.fragment === "second");
    if (!selected) throw new Error("Missing fragment");
    const plan = fixedSelection(build, [{ fragment: selected.id }]);
    const output = prepareContext({ ...input, plan });
    const messages = output.messages.map((m) => m.content).join("\n");
    expect(messages).toContain("Bob meets Player.");
    expect(messages).toContain("PUBLIC_SECTION");
    expect(messages).toContain("Alice 的说法：");
    expect(messages).toContain("SECOND_BODY");
    expect(messages).toContain("PRIVATE_BINDING_BOB");
    expect(messages).toContain("alice wears a coat");
    expect(messages).toContain("PUBLIC_MEMORY");
    for (const hidden of [
      "PRIVATE_SECRET_BODY",
      "PRIVATE_ALICE_GOAL",
      "PRIVATE_BINDING_ALICE",
      "PRIVATE_GLOBAL_OVERLAY",
      "FIRST_BODY",
      "UNSELECTED_MANUAL_BODY",
      "UNSELECTED_REFERENCE_BODY",
    ])
      expect(messages).not.toContain(hidden);
    expect(output.trace.entries.some((entry) => entry.id.includes("#secret~"))).toBe(false);
    expect(output.trace.entries.find((entry) => entry.id === selected.id)?.reason).toBe("selected");
    expect(AssemblyTraceSchema.safeParse(output.trace).success).toBe(true);
    expect(prepareContext({ ...input, plan })).toEqual(output);
  });

  it("skips model discovery without letting a tiny directory budget block required/direct content", () => {
    const { input } = fixture();
    const output = prepareContext({
      ...input,
      selection: { catalog_budget: 0, max_depth: 4 },
      fallback: "skip",
    });
    const text = output.messages.map((m) => m.content).join("\n");
    expect(text).toContain("PUBLIC_SECTION");
    expect(text).not.toContain("SECOND_BODY");
    expect(output.trace.entries.some((e) => e.reason === "fallback")).toBe(true);
  });

  it("requests only visible direct or selected source bodies and validates the plan first", () => {
    const { input, source } = fixture();
    const request = {
      source: source.id,
      asset: source.asset,
      digest: input.artifact.assets.find((a) => a.id === source.asset)?.digest,
    };
    expect(sourceRequests({ ...input, source_texts: {} })).toEqual([request]);
    const artifact = structuredClone(input.artifact);
    if (!artifact.story?.scenes[0]) throw new Error("Missing scene");
    artifact.story.scenes[0].lore = [];
    const idle = { ...input, artifact };
    expect(sourceRequests(idle)).toEqual([]);
    const plan = fixedSelection(createPreparationCatalog(idle), [
      { source: source.id, section: "first" },
    ]);
    expect(sourceRequests({ ...idle, plan })).toEqual([request]);
    expect(() => sourceRequests({ ...input, plan })).toThrowError(
      expect.objectContaining({ code: "selection.input_mismatch" }),
    );
    const privateSource = artifact.catalog_index.sources[0];
    if (!privateSource) throw new Error("Missing source");
    privateSource.shared = false;
    expect(sourceRequests({ ...input, artifact })).toEqual([]);
  });

  it("validates source bytes and refuses missing bodies instead of rendering a partial excerpt", () => {
    const { input, source } = fixture();
    expect(() => prepareContext({ ...input, source_texts: {} })).toThrowError(
      expect.objectContaining({ code: "source.body_unavailable" }),
    );
    expect(() =>
      prepareContext({ ...input, source_texts: { [source.asset]: "changed" } }),
    ).toThrowError(expect.objectContaining({ code: "source.asset_mismatch" }));
  });

  it("keeps narrator knowledge annotations and author-only diagnostics separate", () => {
    const { input } = fixture();
    const output = prepareContext({ ...input, profile: { ...input.profile, mode: "narrator" } });
    const text = output.messages.map((m) => m.content).join("\n");
    expect(text).toContain("知道此事：Alice");
    expect(text).toContain("不知道：Bob");
    expect(text).toContain("PRIVATE_SECRET_BODY");
    const author = prepareContext({ ...input, diagnostics: "author" });
    expect(author.trace.entries.find((e) => e.id.includes("#secret~"))?.reason).toBe("withheld");
  });

  it("counts final formatting and required story content against the same global budget", () => {
    const { input } = fixture();
    const output = prepareContext(input);
    const counted = output.messages.reduce((sum, m) => sum + input.counter.count(m.content), 0);
    expect(output.trace.total_tokens).toBeGreaterThanOrEqual(counted);
    expect(output.trace.total_tokens).toBe(
      output.trace.entries
        .filter((e) => e.decision === "included")
        .reduce((sum, e) => sum + e.tokens, 0),
    );
    const projectedCost = output.trace.entries
      .filter((e) => e.decision === "included" && e.reason === "required")
      .reduce((sum, e) => sum + e.tokens, 0);
    expect(projectedCost).toBeGreaterThan(0);
    expect(() =>
      prepareContext({
        ...input,
        profile: { ...input.profile, context_window: 1 },
        turn: {
          ...input.turn,
          bindings: Object.fromEntries(
            Object.entries(input.turn.bindings).map(([key, value]) => [
              key,
              { ...value, description: undefined, outward_description: undefined },
            ]),
          ),
          visible_overlay: undefined,
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "assemble.required_over_budget" }));
  });
});
