/** Framework invariants run in all three engines; these are not accepted fixture expectations. */

import { createPreparationCatalog, fixedSelection } from "@char-pub/assembler";
import { buildCreation, RuntimeProfileSchema, TurnViewSchema } from "@char-pub/core";
import { expect, it } from "vitest";
import bundled from "./cases.gen.json" with { type: "json" };
import { judge, renderDraft, runCase, validateInput } from "./run.js";
import { runStoryFixture, storyResultJSON } from "./story.js";
import type { Bundle, BundledCase } from "./types.js";

function example(): BundledCase {
  return {
    dir: "synthetic-story",
    meta: {
      id: "synthetic-story",
      title: "Synthetic Story",
      kind: "story",
      expect: "story",
      status: "draft",
      spec_refs: ["story-v1/14.2"],
    },
    input: {
      deps: [],
      story: {
        kind: "evaluation",
        cast: ["alice"],
        story: {
          version: 1,
          scenes: [{ id: "room", title: "Room" }],
          vars: { count: { type: "int", init: 0, min: 0, max: 2, description: "Count" } },
          beats: [
            {
              id: "once",
              title: "Once",
              description: "Reward",
              effects: [{ add: ["var/count", 1] }],
            },
          ],
        },
        operations: [
          { op: "confirm", target: "beat/once" },
          { op: "confirm", target: "beat/once" },
          { op: "condition", condition: { not: { judge: "Player agreed" } } },
          { op: "input", text: "Do something else" },
        ],
      },
    },
    expected: {},
  };
}

it("records exact per-step state and unknown truth while failed operations preserve the prior input", () => {
  const c = example(),
    before = storyResultJSON(c.input);
  const actual = runCase(c);
  expect(validateInput(c)).toEqual([]);
  expect(actual.kind).toBe("story");
  if (actual.kind !== "story" || actual.story.kind !== "evaluation")
    throw new Error("evaluation required");
  expect(actual.story.steps.map((step) => step.state.vars.count)).toEqual([1, 1, 1, 1]);
  expect(actual.story.steps[1]?.error?.code).toBe("story.already_confirmed");
  expect(actual.story.steps[2]?.outcome).toEqual({ truth: "unknown" });
  expect(actual.story.steps[3]?.outcome).toEqual({ input_ignored: true });
  expect(actual.story.steps.every((step) => step.input_unchanged)).toBe(true);
  expect(storyResultJSON(c.input)).toBe(before);
  expect(judge(c, actual).status).toBe("draft");
  expect(renderDraft(actual)?.file).toBe("story");
});

it("requires accepted expected for comparison and rejects mutation violations even on drafts", () => {
  const c = example(),
    actual = runCase(c);
  if (actual.kind !== "story") throw new Error("story required");
  expect(judge(c, { ...actual, violations: ["input changed"] }).status).toBe("fail");
  const reviewed = { ...c, meta: { ...c.meta, status: "reviewed" as const } };
  expect(judge(reviewed, actual)).toMatchObject({
    status: "fail",
    message: "missing expected/story.json",
  });
  // Synthetic in-memory expectation only, never a file or real case status change.
  const expected = structuredClone(actual.story);
  expect(judge({ ...reviewed, expected: { story: expected } }, actual).status).toBe("pass");
  if (expected.kind !== "evaluation") throw new Error("evaluation required");
  const first = expected.steps[0];
  if (!first) throw new Error("step required");
  first.state.vars.count = 2;
  expect(judge({ ...reviewed, expected: { story: expected } }, actual).status).toBe("fail");
});

it("keeps exact strings in portable comparison and fails missing or mismatched fixture kinds", () => {
  expect(storyResultJSON({ text: "e\u0301\r\n " })).not.toBe(storyResultJSON({ text: "é\n" }));
  const c = example();
  delete c.input.story;
  expect(validateInput(c)).toContain("story: missing fixture");
  expect(runCase(c)).toMatchObject({ kind: "error", error: { code: "conformance.invalid_story" } });
  const wrong = example();
  wrong.meta.kind = "resolver";
  expect(validateInput(wrong)).toContain("story input requires story case kind");
});

it("validates an explicit Plan against the same actual artifact and refuses stale or conflicting selection input", () => {
  const cases = (bundled as unknown as Bundle).cases;
  const original = cases.find((c) => c.dir === "204-story-context");
  if (!original?.input.root || original.input.story?.kind !== "context")
    throw new Error("portable context fixture required");
  const c = structuredClone(original);
  if (c.input.story?.kind !== "context") throw new Error("context required");
  const scenario = c.input.story.scenarios[0];
  if (!scenario) throw new Error("scenario required");
  const { artifact } = buildCreation({
    root: original.input.root,
    dependencies: c.input.deps,
    ...c.input.options,
  });
  const preparation = {
    artifact,
    profile: RuntimeProfileSchema.parse(scenario.profile),
    turn: TurnViewSchema.parse(scenario.turn),
  };
  const plan = fixedSelection(createPreparationCatalog(preparation), []);
  delete scenario.selection;
  scenario.plan = plan;
  scenario.turn = { ...preparation.turn, focus: "Changed after the plan was made" };
  const result = runStoryFixture(c.input);
  if (result.expectation.kind !== "context") throw new Error("context result required");
  expect(result.expectation.scenarios[0]).toMatchObject({
    plan_valid: false,
    error: { code: "selection.input_mismatch" },
    input_unchanged: true,
  });
  expect(result.expectation.scenarios[0]?.catalog).toBeDefined();
  expect(result.expectation.scenarios[0]?.messages).toBeUndefined();
  scenario.selection = [];
  expect(validateInput(c)).toContain(`${scenario.name}: plan and selection are mutually exclusive`);
});

it.each([
  { op: "input" },
  { op: "confirm", target: 3 },
  { op: "present", present: "alice" },
  { op: "condition", condition: { cmp: ["var/count", "BAD", 1] } },
  { op: "validate", state: {} },
])("rejects malformed operation envelopes before they become expected errors: %j", (operation) => {
  const c = example();
  if (c.input.story?.kind !== "evaluation") throw new Error("evaluation required");
  c.input.story.operations = JSON.parse(JSON.stringify([operation]));
  expect(validateInput(c)).toContain("story: invalid operation 0 fields");
  expect(runCase(c)).toMatchObject({ kind: "error", error: { code: "conformance.invalid_story" } });
});

it("rejects duplicate cast identity in portable input", () => {
  const c = example();
  if (c.input.story?.kind !== "evaluation") throw new Error("evaluation required");
  c.input.story.cast = ["alice", "alice"];
  expect(validateInput(c)).toContain("story: invalid cast keys");
});

function planReuseExample(): BundledCase {
  const original = (bundled as unknown as Bundle).cases.find((c) => c.dir === "204-story-context");
  if (original?.input.story?.kind !== "context") throw new Error("context fixture required");
  const c = structuredClone(original);
  if (c.input.story?.kind !== "context") throw new Error("context fixture required");
  const first = c.input.story.scenarios[0];
  if (!first) throw new Error("first scenario required");
  first.name = "original";
  delete first.selection;
  const second = { ...structuredClone(first), name: "replay", plan_from: "original" };
  c.input.story.scenarios = [first, second];
  return c;
}

it("reuses an earlier successful Plan unchanged instead of regenerating it for the replay scenario", () => {
  const c = planReuseExample();
  expect(validateInput(c)).toEqual([]);
  const result = runStoryFixture(c.input);
  if (result.expectation.kind !== "context") throw new Error("context result required");
  const [first, second] = result.expectation.scenarios;
  expect(first?.stage).toBe("complete");
  expect(first?.plan).toBeDefined();
  expect(second?.stage).toBe("complete");
  expect(second?.plan).toEqual(first?.plan);
  expect(second?.messages).toEqual(first?.messages);
  expect(result.violations).toEqual([]);
});

it.each(["missing", "replay", "later"])(
  "rejects unknown, self or forward Plan references: %s",
  (name) => {
    const c = planReuseExample();
    if (c.input.story?.kind !== "context") throw new Error("context required");
    const second = c.input.story.scenarios[1];
    if (!second) throw new Error("second scenario required");
    second.plan_from = name;
    c.input.story.scenarios.push({
      ...structuredClone(second),
      name: "later",
      plan_from: "original",
    });
    expect(validateInput(c)).toContain("replay: plan_from must name an earlier context scenario");
    expect(runCase(c)).toMatchObject({
      kind: "error",
      error: { code: "conformance.invalid_story" },
    });
  },
);

it("refuses plan_from combined with selection or an explicit Plan", () => {
  const c = planReuseExample();
  if (c.input.story?.kind !== "context") throw new Error("context required");
  const second = c.input.story.scenarios[1];
  if (!second) throw new Error("second scenario required");
  second.selection = [];
  expect(validateInput(c)).toContain(
    "replay: plan_from, plan and selection are mutually exclusive",
  );
  delete second.selection;
  const result = runStoryFixture(c.input);
  if (result.expectation.kind !== "context") throw new Error("context result required");
  const firstPlan = result.expectation.scenarios[0]?.plan;
  if (!firstPlan) throw new Error("successful Plan required");
  second.plan = firstPlan;
  expect(validateInput(c)).toContain(
    "replay: plan_from, plan and selection are mutually exclusive",
  );
});

it("does not reuse a Plan from a failed scenario", () => {
  const c = planReuseExample();
  if (c.input.story?.kind !== "context") throw new Error("context required");
  const first = c.input.story.scenarios[0];
  if (!first) throw new Error("first scenario required");
  first.turn = { ...TurnViewSchema.parse(first.turn), for_participant: "unknown-role" };
  expect(validateInput(c)).toEqual([]);
  const result = runStoryFixture(c.input);
  if (result.expectation.kind !== "context") throw new Error("context result required");
  expect(result.expectation.scenarios[0]?.error?.code).toBe("catalog.participant_missing");
  expect(result.expectation.scenarios[1]?.error).toEqual({
    code: "conformance.plan_source_unavailable",
    subject: "original",
  });
  expect(result.expectation.scenarios[1]?.plan).toBeUndefined();
  expect(result.violations).toEqual([]);
});

it("does not reuse a validated Plan when its originating context failed to load required Source bytes", () => {
  const original = (bundled as unknown as Bundle).cases.find(
    (c) => c.dir === "205-progressive-source",
  );
  if (original?.input.story?.kind !== "context") throw new Error("source context fixture required");
  const c = structuredClone(original);
  if (c.input.story?.kind !== "context") throw new Error("context required");
  const first = c.input.story.scenarios.find(
    (scenario) => scenario.name === "selected-door-section",
  );
  if (!first) throw new Error("selected source scenario required");
  first.name = "original";
  const second = { ...structuredClone(first), name: "replay", plan_from: "original" };
  delete second.selection;
  delete first.source_texts;
  c.input.story.scenarios = [first, second];
  expect(validateInput(c)).toEqual([]);
  const result = runStoryFixture(c.input);
  if (result.expectation.kind !== "context") throw new Error("context result required");
  expect(result.expectation.scenarios[0]?.plan_valid).toBe(true);
  expect(result.expectation.scenarios[0]?.error?.code).toBe("source.body_unavailable");
  expect(result.expectation.scenarios[1]?.error).toEqual({
    code: "conformance.plan_source_unavailable",
    subject: "original",
  });
  expect(result.expectation.scenarios[1]?.messages).toBeUndefined();
});
