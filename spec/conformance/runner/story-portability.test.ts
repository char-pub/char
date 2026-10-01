/** Hand-authored semantic assertions; these do not accept portable expected outputs. */
import {
  createPreparationCatalog,
  fixedSelection,
  prepareContext,
  selectorCatalog,
  TOKENIZER_VERSIONS,
  validateRuntimePreviewInput,
  validateSelectionPlan,
} from "@char-pub/assembler";
import {
  buildCreation,
  buildIdentity,
  CreationSchema,
  checkStory,
  digestExactJSON,
  RuntimePreviewInputSchema,
  RuntimeProfileSchema,
  TurnViewSchema,
} from "@char-pub/core";
import { describe, expect, it } from "vitest";
import bundleJSON from "./cases.gen.json" with { type: "json" };
import { runCase, validateInput } from "./run.js";
import type { Bundle } from "./types.js";

const bundle = bundleJSON as Bundle;
interface EvaluationAssertions {
  initial: object;
  steps: { index: number; state?: object; outcome?: object; error?: object }[];
}
interface ScenarioAssertion {
  name: string;
  fragments?: Record<string, object>;
  messages_include?: string[];
  messages_exclude?: string[];
  selector_include?: string[];
  selector_exclude?: string[];
  plan_expands?: object[];
  source_requests?: object[];
  error?: { code: string; subject?: string };
  plan_equals?: string;
  messages_equal?: string;
}
interface ContextAssertions {
  scenarios: ScenarioAssertion[];
}
const ids = [
  "201-open-story",
  "202-story-lifecycle",
  "203-story-view",
  "204-story-context",
  "205-progressive-source",
  "206-exact-plan-replay",
];

function runtimePreview() {
  const fixture = bundle.cases.find((candidate) => candidate.meta.id === "206-exact-plan-replay");
  if (!fixture?.input.root || fixture.input.story?.kind !== "context")
    throw new Error("Portable context fixture required");
  const scenario = fixture.input.story.scenarios[0];
  if (!scenario) throw new Error("Context scenario required");
  const { artifact } = buildCreation({
    root: fixture.input.root,
    dependencies: fixture.input.deps,
    ...fixture.input.options,
  });
  if (artifact.kind !== "content" || !artifact.default_policy) throw new Error("Content required");
  const turn = TurnViewSchema.parse(scenario.turn);
  const preset = artifact.default_policy;
  const payload = RuntimePreviewInputSchema.parse({
    format: "char.pub/runtime-preview",
    version: 1,
    source: {
      root: artifact.root,
      lock_digest: artifact.lock_digest,
      artifact_json_digest: digestExactJSON(artifact),
    },
    profile: { ...RuntimeProfileSchema.parse(scenario.profile), locale: "en" },
    preset: { ref: preset.ref, semantic_digest: preset.semantic_digest, ...buildIdentity(preset) },
    tokenizer: { name: "estimate", version: TOKENIZER_VERSIONS.estimate },
    turn: {
      locale: "en",
      bindings: turn.bindings,
      history: [{ role: "user", text: "Synthetic Cafe\u0301\r\nkeep  " }],
      scene: turn.scene,
      present: turn.present,
      story: turn.story,
      for_participant: turn.for_participant,
    },
  });
  return { artifact, payload };
}

describe("portable Runtime synthetic preview input", () => {
  it("accepts the same exact source and complete Story state without normalizing synthetic text", () => {
    const { artifact, payload } = runtimePreview();
    const before = JSON.stringify({ artifact, payload });
    const parsed = validateRuntimePreviewInput(artifact, payload);
    expect(parsed).toEqual(payload);
    expect(parsed.turn.history[0]?.text).toBe("Synthetic Cafe\u0301\r\nkeep  ");
    expect(parsed.turn.story.knowing).toEqual({ "#secret": ["alice"] });
    expect(JSON.stringify({ artifact, payload })).toBe(before);
  });

  it("rejects self-approved files, private payload additions and a different source identity", () => {
    const { artifact, payload } = runtimePreview();
    for (const value of [
      { ...payload, reviewed: true },
      { ...payload, source_texts: { private: "Body" } },
      { ...payload, turn: { ...payload.turn, overlay: { memory: ["Runtime private memory"] } } },
    ])
      expect(() => validateRuntimePreviewInput(artifact, value)).toThrowError(
        expect.objectContaining({ code: "runtime_preview.invalid_input" }),
      );
    expect(() =>
      validateRuntimePreviewInput(artifact, {
        ...payload,
        source: { ...payload.source, artifact_json_digest: `sha256:${"a".repeat(64)}` },
      }),
    ).toThrowError(expect.objectContaining({ code: "runtime_preview.source_mismatch" }));
  });
});

describe("portable Story input semantics", () => {
  for (const id of ids) {
    it(id, () => {
      const fixture = bundle.cases.find((candidate) => candidate.meta.id === id);
      if (!fixture) throw new Error(`Missing bundled Story fixture: ${id}`);
      expect(validateInput(fixture)).toEqual([]);
      const inputBefore = JSON.stringify(fixture.input);
      const actual = runCase(fixture);
      expect(actual.kind, JSON.stringify(actual)).toBe("story");
      if (actual.kind !== "story") throw new Error("Story runner did not execute");
      expect(actual.violations).toEqual([]);
      expect(actual.story.input_unchanged).toBe(true);
      expect(JSON.stringify(fixture.input)).toBe(inputBefore);
      if (actual.story.kind === "evaluation") {
        const assertions = fixture.input.assertions as EvaluationAssertions;
        expect(actual.story.initial).toMatchObject(assertions.initial);
        expect(actual.story.steps).toHaveLength(assertions.steps.length);
        for (const expected of assertions.steps) {
          const step = actual.story.steps[expected.index];
          expect(step, `step ${expected.index}`).toMatchObject(expected);
          expect(step?.input_unchanged).toBe(true);
          if (!expected.error)
            expect(step?.error, `unexpected error at ${expected.index}`).toBeUndefined();
        }
        if (id === "202-story-lifecycle") {
          const input = fixture.input.story;
          if (input?.kind !== "evaluation") throw new Error("Missing evaluation definition");
          expect(checkStory(input.story, input.cast)).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ code: "story.condition_constant", severity: "warning" }),
            ]),
          );
          // The body of a free action is deliberately not a Runtime interpreter.
          expect(actual.story.steps[0]?.state).toEqual(
            "state" in actual.story.initial ? actual.story.initial.state : undefined,
          );
          expect(actual.story.steps[9]?.state.reached).toEqual(["copy"]);
          expect(actual.story.steps[9]?.state.vars.trust).toBe(0);
        }
      } else {
        const assertions = fixture.input.assertions as ContextAssertions;
        expect(actual.story.scenarios).toHaveLength(assertions.scenarios.length);
        for (const expected of assertions.scenarios) {
          const scenario = actual.story.scenarios.find(
            (candidate) => candidate.name === expected.name,
          );
          if (!scenario) throw new Error(`Missing result: ${expected.name}`);
          if (expected.plan_equals) {
            const prior = actual.story.scenarios.find(
              (candidate) => candidate.name === expected.plan_equals,
            );
            expect(prior?.plan).toBeDefined();
            expect(scenario.plan).toEqual(prior?.plan);
          }
          if (expected.error) {
            expect(scenario.error).toEqual(expected.error);
            expect(scenario.stage).toBe("plan");
            expect(scenario.plan_valid).toBe(false);
            expect(scenario.messages).toBeUndefined();
            expect(scenario.input_unchanged).toBe(true);
            continue;
          }
          expect(scenario.error, JSON.stringify(scenario.error)).toBeUndefined();
          if (expected.messages_equal) {
            const prior = actual.story.scenarios.find(
              (candidate) => candidate.name === expected.messages_equal,
            );
            expect(prior?.messages).toBeDefined();
            expect(scenario.messages).toEqual(prior?.messages);
            expect(scenario.messages_digest).toBe(prior?.messages_digest);
          }
          expect(scenario.input_unchanged).toBe(true);
          for (const [id, result] of Object.entries(expected.fragments ?? {})) {
            const item = scenario.items?.find(
              (item) => "fragment" in item.ref && item.ref.fragment === id,
            );
            expect(item?.result, id).toMatchObject(result);
          }
          if (actual.story.kind === "view") {
            const bobPart = scenario.items?.find(
              (item) => "story" in item.ref && item.ref.story === "part" && item.ref.id === "bob",
            );
            expect(bobPart?.result).toMatchObject(
              expected.name === "bob-not-present"
                ? { status: "excluded", reason: "view.absent" }
                : { status: "visible" },
            );
            continue;
          }
          expect(scenario.plan_valid).toBe(true);
          expect(scenario.messages_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
          const messages = scenario.messages?.map((message) => message.content).join("\n") ?? "";
          // Only public Selector surfaces; never inspect trusted engine maps as provider payloads.
          const selector = JSON.stringify({
            view: scenario.selector_view,
            candidates: scenario.catalog?.candidates,
          });
          for (const text of expected.messages_include ?? []) expect(messages).toContain(text);
          for (const text of expected.messages_exclude ?? []) expect(messages).not.toContain(text);
          for (const text of expected.selector_include ?? []) expect(selector).toContain(text);
          for (const text of expected.selector_exclude ?? []) expect(selector).not.toContain(text);
          if (expected.source_requests)
            expect(scenario.source_requests).toEqual(expected.source_requests);
          if (expected.plan_expands)
            expect(
              scenario.plan?.decisions
                .filter((decision) => decision.action === "expand")
                .map((decision) => decision.ref),
            ).toEqual(expected.plan_expands);
          if (expected.name === "bob-skip-discovery") {
            expect(scenario.catalog?.candidates).toEqual([]);
            expect(scenario.plan?.selected).toEqual([]);
          }
        }
      }
    });
  }
});

describe("portable visible selection metadata", () => {
  it("exposes resolved visible relations and rumor hints without copying a hidden target or activating a linked body", () => {
    const fixture = bundle.cases.find((candidate) => candidate.meta.id === "204-story-context");
    if (!fixture?.input.root || fixture.input.story?.kind !== "context")
      throw new Error("context fixture required");
    const scenario = fixture.input.story.scenarios[0];
    if (!scenario) throw new Error("scenario required");
    const creation = CreationSchema.parse(fixture.input.root.creation);
    creation.fragments.push(
      {
        id: "visible-topic",
        kind: "knowledge",
        stable: true,
        description: "A visible topic",
        activation: { mode: "semantic" },
        content: { type: "text", text: "VISIBLE_LINK_TARGET_BODY" },
      },
      {
        id: "rumor-link",
        kind: "knowledge",
        stable: true,
        description: "A related rumor",
        activation: { mode: "keyword", keys: ["never-matched"] },
        selectable: true,
        perspective: "rumor",
        about: ["#visible-topic", "#secret"],
        content: { type: "text", text: "SELECTED_RUMOR_BODY" },
      },
    );
    const { semantic_digest: _digest, ...root } = fixture.input.root;
    const { artifact } = buildCreation({
      root: { ...root, creation },
      dependencies: fixture.input.deps,
      ...fixture.input.options,
    });
    if (artifact.kind !== "content") throw new Error("content required");
    const input = {
      artifact,
      profile: RuntimeProfileSchema.parse(scenario.profile),
      turn: TurnViewSchema.parse(scenario.turn),
    };
    const build = createPreparationCatalog(input);
    const directory = JSON.stringify(selectorCatalog(build.catalog));
    expect(directory).toContain('"perspective":"rumor"');
    expect(directory).toContain('"activation_hint":"keyword"');
    expect(directory).toContain('"about":["@portable/door#visible-topic~root"]');
    expect(directory).not.toContain("#secret");
    expect(directory).not.toContain("VISIBLE_LINK_TARGET_BODY");
    const plan = fixedSelection(build, [{ fragment: "@portable/door#rumor-link~root" }]);
    expect(validateSelectionPlan(build, plan)).toEqual(plan);
    const prepared = prepareContext({ ...input, plan });
    expect(JSON.stringify(prepared.messages)).toContain("SELECTED_RUMOR_BODY");
    expect(JSON.stringify(prepared.messages)).not.toContain("VISIBLE_LINK_TARGET_BODY");
    expect(JSON.stringify(prepared.messages)).not.toContain("SECRET_KNOWN_BODY");
  });
});
