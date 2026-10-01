import { type CreationInput, canonicalizeCreation } from "@char-pub/core";
import { describe, expect, it } from "vitest";
import { buildTestCreation } from "../../core/test/build.js";
import { tid } from "../../core/test/fixtures.js";
import { createPreparationCatalog, initialStoryTurn, prepareContext } from "../src/prepare.js";
import { fixedSelection } from "../src/selection.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing fixture value");
  return value;
}

function fixture(semantic = false) {
  const meta = {
    default_locale: "en",
    rating: "general",
    rights: "original",
    license: "CC0-1.0",
  } as const;
  const definitions = [
    { id: "a-cast", text: "CAST", scope: { cast: "alice" } },
    { id: "b-scene", text: "SCENE", scope: { scene: "lobby" } },
    { id: "z-first", text: "FIRST", scope: "narration" },
    { id: "c-second", text: "SECOND", scope: "narration" },
    { id: "d-away", text: "AWAY", scope: { scene: "away" } },
  ] as const;
  const dependencies = definitions.map((item, i) => {
    const creation: CreationInput = {
      id: tid("cr", 801 + i),
      ref: `@test/${item.id}`,
      type: "style",
      display_name: item.text,
      meta,
      fragments: ["one", "two"].map((id) => ({
        id,
        stable: true,
        kind: "style",
        description: `${item.text} ${id}`,
        activation: { mode: semantic ? "semantic" : "always" },
        content: { type: "text", text: `${item.text}_${id}` },
      })),
    };
    return {
      creation,
      release: tid("rel", 801 + i),
      visibility: "public" as const,
      semantic_digest: canonicalizeCreation(creation).semantic_digest,
    };
  });
  const creation: CreationInput = {
    id: tid("cr", 800),
    ref: "@test/story",
    type: "scenario",
    display_name: "Story",
    meta,
    cast: [
      { key: "alice", who: { late: "character" } },
      { key: "bob", who: { late: "character" } },
    ],
    references: definitions.map((item, i) => ({
      id: item.id,
      use: required(dependencies[i]).creation.ref,
      mode: "default",
      scope: item.scope,
      pin: {
        release: required(dependencies[i]).release,
        semantic_digest: required(dependencies[i]).semantic_digest,
      },
    })),
    story: {
      version: 1,
      scenes: [
        { id: "lobby", title: "Lobby" },
        { id: "away", title: "Away" },
      ],
      starts: [{ id: "start", scene: "lobby" }],
    },
  };
  const build = () => {
    const { artifact } = buildTestCreation({
      root: { creation, release: tid("rel", 800), visibility: "public" },
      dependencies,
    });
    if (artifact.kind !== "content") throw new Error("Missing content");
    const bindings = Object.fromEntries(
      artifact.ir.late_slots.map((s) => [
        s.key,
        {
          kind: required(s.accepts[0]),
          display_name:
            artifact.ir.participants.find((p) => p.late === s.key)?.cast_key ?? "Player",
        },
      ]),
    );
    return {
      artifact,
      turn: { ...initialStoryTurn(artifact), bindings, history: [] },
      profile: {
        runtime: { name: "test", version: "1" },
        tokenizer: "characters",
        context_window: 10000,
        reserve_for_output: 0,
        mode: "narrator" as const,
        capabilities: { system_role: true, multiple_system_messages: true },
      },
      counter: { tokenizer: "characters", estimated: true, count: (text: string) => text.length },
      selection: { catalog_budget: 10000, max_depth: 4 },
    };
  };
  return { build, creation, dependencies, meta };
}

function styleText(result: ReturnType<typeof prepareContext>) {
  return result.messages.find((message) => message.content.includes("FIRST_one"))?.content;
}

function nestedFixture(replace = false) {
  const fixtureData = fixture();
  const { dependencies, creation, meta } = fixtureData;
  const nested = ["NESTED_FIRST", "NESTED_SECOND"].map((text, i) => {
    const creation: CreationInput = {
      id: tid("cr", 820 + i),
      ref: `@test/nested-${i}`,
      type: "style",
      display_name: text,
      meta,
      fragments: [{ id: "tone", stable: true, kind: "style", content: { type: "text", text } }],
    };
    return {
      creation,
      release: tid("rel", 820 + i),
      visibility: "public" as const,
      semantic_digest: canonicalizeCreation(creation).semantic_digest,
    };
  });
  dependencies.push(...nested);
  const outer = required(dependencies[0]);
  outer.creation.references = nested.map((dep, i) => ({
    id: i === 0 ? "z-first" : "a-second",
    use: dep.creation.ref,
    mode: "default",
    ...(replace && i === 1 ? { combine: "replace" as const } : {}),
    pin: { release: dep.release, semantic_digest: dep.semantic_digest },
  }));
  outer.semantic_digest = canonicalizeCreation(outer.creation).semantic_digest;
  required(creation.references?.[0]).pin = {
    release: outer.release,
    semantic_digest: outer.semantic_digest,
  };
  return fixtureData;
}

describe("Style final message order", () => {
  it("renders narration, current scene and cast in order, with authored edge and fragment order", () => {
    const input = fixture().build();
    const result = prepareContext(input);
    expect(styleText(result)).toBe(
      "FIRST_one\n\nFIRST_two\n\nSECOND_one\n\nSECOND_two\n\nSCENE_one\n\nSCENE_two\n\nalice 的说话方式：\nCAST_one\n\nalice 的说话方式：\nCAST_two",
    );
    const sources = required(
      result.messages.find((message) => message.content === styleText(result)),
    ).source;
    expect(
      sources.map((id) => input.artifact.ir.fragments.find((f) => f.id === id)?.content),
    ).toEqual(
      [
        "FIRST_one",
        "FIRST_two",
        "SECOND_one",
        "SECOND_two",
        "SCENE_one",
        "SCENE_two",
        "CAST_one",
        "CAST_two",
      ].map((text) => ({ type: "text", format: "markdown", text })),
    );
    expect(JSON.stringify(result.messages)).not.toContain("AWAY");
  });

  it("uses the same order after per-agent visibility filtering", () => {
    const input = fixture().build();
    const alice = prepareContext({
      ...input,
      profile: { ...input.profile, mode: "per-agent" },
      turn: { ...input.turn, for_participant: "alice" },
    });
    expect(styleText(alice)).toBe(
      "FIRST_one\n\nFIRST_two\n\nSECOND_one\n\nSECOND_two\n\nSCENE_one\n\nSCENE_two\n\nCAST_one\n\nCAST_two",
    );
    const bob = prepareContext({
      ...input,
      profile: { ...input.profile, mode: "per-agent" },
      turn: { ...input.turn, for_participant: "bob" },
    });
    expect(styleText(bob)).toBe(
      "FIRST_one\n\nFIRST_two\n\nSECOND_one\n\nSECOND_two\n\nSCENE_one\n\nSCENE_two",
    );
  });

  it("does not confuse selector rank with Style presentation order", () => {
    const input = fixture(true).build();
    const catalog = createPreparationCatalog(input);
    const refs = input.artifact.ir.fragments
      .filter((f) => f.origin.fragment === "one" && !f.origin.creation.endsWith("d-away"))
      .map((f) => ({ fragment: f.id }));
    const plan = fixedSelection(catalog, refs);
    const result = prepareContext({ ...input, plan });
    expect(styleText(result)).toBe(
      "FIRST_one\n\nSECOND_one\n\nSCENE_one\n\nalice 的说话方式：\nCAST_one",
    );
    expect(JSON.stringify(result.messages)).not.toContain("_two");
  });

  it("applies replace before ordering without replacing other scopes", () => {
    const { build, creation } = fixture();
    required(creation.references?.[3]).combine = "replace";
    const result = prepareContext(build());
    const text = result.messages.map((m) => m.content).join("\n");
    expect(text).not.toContain("FIRST_");
    expect(text.indexOf("SECOND_one")).toBeLessThan(text.indexOf("SCENE_one"));
    expect(text.indexOf("SCENE_one")).toBeLessThan(text.indexOf("CAST_one"));
  });

  it("preserves selector rank as budget priority even when narration renders first", () => {
    const input = fixture(true).build();
    const cast = required(
      input.artifact.ir.fragments.find(
        (f) => f.origin.creation.endsWith("a-cast") && f.origin.fragment === "one",
      ),
    );
    const narration = required(
      input.artifact.ir.fragments.find(
        (f) => f.origin.creation.endsWith("z-first") && f.origin.fragment === "one",
      ),
    );
    const catalog = createPreparationCatalog(input);
    const onlyCast = prepareContext({
      ...input,
      plan: fixedSelection(catalog, [{ fragment: cast.id }]),
    });
    const bounded = {
      ...input,
      profile: { ...input.profile, context_window: onlyCast.trace.total_tokens },
    };
    const plan = fixedSelection(createPreparationCatalog(bounded), [
      { fragment: cast.id },
      { fragment: narration.id },
    ]);
    const result = prepareContext({ ...bounded, plan });
    const text = result.messages.map((m) => m.content).join("\n");
    expect(text).toContain("CAST_one");
    expect(text).not.toContain("FIRST_one");
    expect(result.trace.entries.find((e) => e.id === narration.id)?.reason).toBe("budget");
  });

  it("keeps Character-owned voice when Scenario replaces that cast's added Style", () => {
    const { build, creation, dependencies, meta } = fixture();
    const voice = required(dependencies[2]);
    const character: CreationInput = {
      id: tid("cr", 810),
      ref: "@test/alice",
      type: "character",
      display_name: "Alice",
      meta,
      fragments: [
        {
          id: "identity",
          stable: true,
          kind: "character",
          content: { type: "text", text: "Alice" },
        },
      ],
      references: [
        {
          id: "voice",
          use: voice.creation.ref,
          mode: "intrinsic",
          pin: { release: voice.release, semantic_digest: voice.semantic_digest },
        },
      ],
    };
    const dep = {
      creation: character,
      release: tid("rel", 810),
      semantic_digest: canonicalizeCreation(character).semantic_digest,
      visibility: "public" as const,
    };
    dependencies.push(dep);
    required(creation.cast?.[0]).who = character.ref;
    required(creation.references).push({
      id: "alice",
      use: character.ref,
      mode: "default",
      pin: { release: dep.release, semantic_digest: dep.semantic_digest },
    });
    required(creation.references?.[0]).combine = "replace";
    const input = build();
    const result = prepareContext(input);
    const ownVoice = required(
      input.artifact.ir.fragments.find(
        (f) =>
          f.style_use?.owner !== "root" &&
          f.content.type === "text" &&
          f.content.text === "FIRST_one",
      ),
    );
    expect(result.messages.flatMap((m) => m.source)).toContain(ownVoice.id);
    expect(result.messages.map((m) => m.content).join("\n")).toContain("CAST_one");
  });

  it("inherits cast scope through nested Styles and preserves their declaration order", () => {
    const input = nestedFixture().build();
    const alice = prepareContext({
      ...input,
      profile: { ...input.profile, mode: "per-agent" },
      turn: { ...input.turn, for_participant: "alice" },
    });
    const text = alice.messages.map((m) => m.content).join("\n");
    expect(text).toContain("CAST_two\n\nNESTED_FIRST\n\nNESTED_SECOND");
    const bob = prepareContext({
      ...input,
      profile: { ...input.profile, mode: "per-agent" },
      turn: { ...input.turn, for_participant: "bob" },
    });
    expect(JSON.stringify(bob.messages)).not.toContain("NESTED_");
  });

  it("replaces an outer Style together with all of its nested Styles", () => {
    const { build, creation } = nestedFixture();
    const replacement = required(creation.references?.[3]);
    replacement.scope = { cast: "alice" };
    replacement.combine = "replace";
    const text = JSON.stringify(prepareContext(build()).messages);
    expect(text).toContain("SECOND_one");
    expect(text).not.toContain("NESTED_");
    expect(text).not.toContain("CAST_one");
  });

  it("applies nested replace within its own composition without replacing the parent", () => {
    const text = JSON.stringify(prepareContext(nestedFixture(true).build()).messages);
    expect(text).not.toContain("NESTED_FIRST");
    expect(text).toContain("NESTED_SECOND");
    expect(text).toContain("CAST_one");
    expect(text).toContain("FIRST_one");
  });

  it("keeps a root Style's own prose outside the replacement domain of its child edges", () => {
    const { dependencies } = nestedFixture(true);
    const root = required(dependencies[0]);
    const { artifact } = buildTestCreation({ root, dependencies });
    if (artifact.kind !== "content") throw new Error("Missing content");
    expect(artifact.capabilities).toContainEqual({ id: "style.scope" });
    const input = fixture().build();
    const result = prepareContext({
      ...input,
      artifact,
      turn: { history: [], bindings: { user: { kind: "persona", display_name: "Player" } } },
    });
    const text = JSON.stringify(result.messages);
    expect(text).toContain("CAST_one");
    expect(text).toContain("NESTED_SECOND");
    expect(text).not.toContain("NESTED_FIRST");
  });
});
