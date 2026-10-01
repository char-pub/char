/** Portable Story evaluation, view and prepared-context fixtures using only public pure SDK APIs. */

import {
  createPreparationCatalog,
  createViewContext,
  digestAssemblyMessages,
  fixedSelection,
  noneSelection,
  prepareContext,
  selectorView,
  sourceRequests,
  validateSelectionPlan,
  viewOf,
} from "@char-pub/assembler";
import {
  availableChoices,
  availableTargets,
  buildCreation,
  CastKeySchema,
  CatalogRefSchema,
  CharError,
  confirm,
  digestExactJSON,
  enterScene,
  evaluateCondition,
  initStoryState,
  isCharError,
  type JSONValue,
  jcs,
  RuntimeProfileSchema,
  resolvePreset,
  type SelectionPlan,
  SelectionPlanSchema,
  StoryConditionSchema,
  StorySchema,
  type StoryState,
  setPresent,
  TurnViewSchema,
  validateStoryState,
} from "@char-pub/core";
import type {
  CaseInput,
  ErrorExpectation,
  StoryContextResult,
  StoryEvaluationExpectation,
  StoryEvaluationInput,
  StoryExpectation,
  StoryFixtureOutcome,
  StoryStepOutcome,
  StoryStepResult,
} from "./types.js";

/** Compare exact JSON values without text normalization; key order is not semantic. */
export function storyResultJSON(value: unknown): string {
  return jcs(JSON.parse(JSON.stringify(value)) as JSONValue);
}
function errorOf(error: unknown): ErrorExpectation {
  if (!isCharError(error)) throw error;
  return { code: error.code, subject: error.subject };
}
function evaluation(input: StoryEvaluationInput): StoryEvaluationExpectation {
  const before = storyResultJSON(input);
  const steps: StoryStepResult[] = [];
  let state: StoryState;
  try {
    state = initStoryState(input.story, input.cast, input.start, input.judgments);
  } catch (error) {
    return {
      kind: "evaluation",
      initial: { error: errorOf(error) },
      steps,
      input_unchanged: storyResultJSON(input) === before,
    };
  }
  const initial = { state: structuredClone(state) };
  for (const [index, operation] of input.operations.entries()) {
    const previous = state;
    const previousJSON = storyResultJSON(previous);
    const operationJSON = storyResultJSON(operation);
    let outcome: StoryStepOutcome | undefined;
    let error: ErrorExpectation | undefined;
    try {
      switch (operation.op) {
        case "input":
          outcome = { input_ignored: true };
          break;
        case "condition":
          outcome = {
            truth: evaluateCondition(
              input.story,
              input.cast,
              previous,
              operation.condition,
              operation.judgments,
              operation.target,
              operation.path,
            ),
          };
          break;
        case "confirm":
          state = confirm(input.story, input.cast, previous, operation.target, operation.judgments);
          break;
        case "enter":
          state = enterScene(
            input.story,
            input.cast,
            previous,
            operation.scene,
            operation.judgments,
          );
          break;
        case "present":
          state = setPresent(input.story, input.cast, previous, operation.present);
          break;
        case "available":
          outcome = {
            targets: availableTargets(input.story, input.cast, previous, operation.judgments),
            choices: availableChoices(input.story, input.cast, previous, operation.judgments),
          };
          break;
        case "validate":
          validateStoryState(input.story, input.cast, operation.state);
          outcome = { valid: true };
          break;
        default:
          throw new CharError({ code: "conformance.story_operation", subject: String(index) });
      }
    } catch (caught) {
      error = errorOf(caught);
      state = previous;
    }
    steps.push({
      index,
      op: operation.op,
      state: structuredClone(state),
      ...(outcome ? { outcome } : {}),
      ...(error ? { error } : {}),
      input_unchanged:
        storyResultJSON(previous) === previousJSON &&
        storyResultJSON(operation) === operationJSON &&
        storyResultJSON(input) === before,
    });
  }
  return { kind: "evaluation", initial, steps, input_unchanged: storyResultJSON(input) === before };
}

/** Validate fixture envelopes before execution; semantic failure remains an explicit expected result. */
export function validateStoryFixture(input: CaseInput): string[] {
  const fixture = input.story;
  if (!fixture) return ["story: missing fixture"];
  const issues: string[] = [];
  if (fixture.kind === "evaluation") {
    if (!StorySchema.safeParse(fixture.story).success)
      issues.push("story: invalid definition schema");
    if (
      !Array.isArray(fixture.cast) ||
      fixture.cast.some((key) => !CastKeySchema.safeParse(key).success) ||
      new Set(fixture.cast).size !== fixture.cast.length
    )
      issues.push("story: invalid cast keys");
    if (!Array.isArray(fixture.operations)) issues.push("story: missing operations");
    else
      for (const [index, operation] of fixture.operations.entries()) {
        if (
          !operation ||
          !["input", "condition", "confirm", "enter", "present", "available", "validate"].includes(
            operation.op,
          )
        ) {
          issues.push("story: invalid operation");
          continue;
        }
        let valid = true;
        switch (operation.op) {
          case "input":
            valid = typeof operation.text === "string";
            break;
          case "condition":
            valid =
              StoryConditionSchema.safeParse(operation.condition).success &&
              (operation.target === undefined || typeof operation.target === "string") &&
              (operation.path === undefined || typeof operation.path === "string");
            break;
          case "confirm":
            valid = typeof operation.target === "string" && operation.target.length > 0;
            break;
          case "enter":
            valid = typeof operation.scene === "string" && operation.scene.length > 0;
            break;
          case "present":
            valid =
              Array.isArray(operation.present) &&
              operation.present.every((key) => typeof key === "string");
            break;
          case "available":
            break;
          case "validate": {
            const state = operation.state;
            valid =
              !!state &&
              typeof state === "object" &&
              typeof state.scene === "string" &&
              typeof state.start === "string" &&
              typeof state.stopped === "boolean" &&
              [state.present, state.visited, state.reached, state.ended, state.happened].every(
                (value) => Array.isArray(value) && value.every((key) => typeof key === "string"),
              ) &&
              !!state.vars &&
              typeof state.vars === "object" &&
              !Array.isArray(state.vars) &&
              !!state.knowing &&
              typeof state.knowing === "object" &&
              !Array.isArray(state.knowing) &&
              Object.values(state.knowing).every(
                (keys) => Array.isArray(keys) && keys.every((key) => typeof key === "string"),
              );
            break;
          }
        }
        if (
          "judgments" in operation &&
          !TurnViewSchema.shape.judgments.safeParse(operation.judgments).success
        )
          valid = false;
        if (!valid) issues.push(`story: invalid operation ${index} fields`);
      }
    if (fixture.start !== undefined && typeof fixture.start !== "string")
      issues.push("story: invalid start");
    if (!TurnViewSchema.shape.judgments.safeParse(fixture.judgments).success)
      issues.push("story: invalid initial judgments");
  } else if (fixture.kind === "view" || fixture.kind === "context") {
    if (!input.root) issues.push("story: missing root");
    if (!Array.isArray(fixture.scenarios) || !fixture.scenarios.length)
      return ["story: missing scenarios"];
    const names = new Set<string>();
    for (const scenario of fixture.scenarios) {
      if (!scenario || typeof scenario !== "object") {
        issues.push("story: invalid scenario");
        continue;
      }
      if (!scenario.name || names.has(scenario.name))
        issues.push("story: missing/duplicate scenario name");
      if (
        scenario.plan_from !== undefined &&
        (fixture.kind !== "context" ||
          typeof scenario.plan_from !== "string" ||
          !names.has(scenario.plan_from))
      )
        issues.push(`${scenario.name}: plan_from must name an earlier context scenario`);
      names.add(scenario.name);
      if (!RuntimeProfileSchema.safeParse(scenario.profile).success)
        issues.push(`${scenario.name}: invalid profile`);
      if (!TurnViewSchema.safeParse(scenario.turn).success)
        issues.push(`${scenario.name}: invalid turn schema`);
      if (
        scenario.selection !== undefined &&
        (!Array.isArray(scenario.selection) ||
          scenario.selection.some((ref) => !CatalogRefSchema.safeParse(ref).success))
      )
        issues.push(`${scenario.name}: invalid selection schema`);
      if (scenario.plan !== undefined && !SelectionPlanSchema.safeParse(scenario.plan).success)
        issues.push(`${scenario.name}: invalid plan schema`);
      if (scenario.discovery !== undefined && typeof scenario.discovery !== "boolean")
        issues.push(`${scenario.name}: invalid discovery flag`);
      if (scenario.fallback !== undefined && scenario.fallback !== "skip")
        issues.push(`${scenario.name}: invalid fallback`);
      if (
        scenario.source_texts !== undefined &&
        (!scenario.source_texts ||
          typeof scenario.source_texts !== "object" ||
          Array.isArray(scenario.source_texts) ||
          Object.values(scenario.source_texts).some((text) => typeof text !== "string"))
      )
        issues.push(`${scenario.name}: invalid source texts`);
      if (
        scenario.plan_from !== undefined &&
        (scenario.selection !== undefined || scenario.plan !== undefined)
      )
        issues.push(`${scenario.name}: plan_from, plan and selection are mutually exclusive`);
      if (scenario.selection !== undefined && scenario.plan !== undefined)
        issues.push(`${scenario.name}: plan and selection are mutually exclusive`);
    }
  } else issues.push("story: unsupported fixture kind");
  return issues;
}

/** Execute one portable fixture; hard mutation violations fail even while expected remains unreviewed. */
export function runStoryFixture(input: CaseInput): StoryFixtureOutcome {
  const fixture = input.story;
  if (!fixture) throw new CharError({ code: "conformance.missing_story", subject: "story" });
  const before = storyResultJSON(input);
  let expectation: StoryExpectation;
  if (fixture.kind === "evaluation") expectation = evaluation(fixture);
  else {
    if (!input.root) throw new CharError({ code: "conformance.missing_root", subject: "story" });
    const { artifact } = buildCreation({
      root: input.root,
      dependencies: input.deps,
      ...input.options,
    });
    if (artifact.kind !== "content")
      throw new CharError({ code: "assembly.content_required", subject: artifact.root.ref });
    const scenarios: StoryContextResult[] = [];
    const priorPlans = new Map<string, SelectionPlan>();
    for (const scenario of fixture.scenarios) {
      const output: StoryContextResult = {
        name: scenario.name,
        stage: fixture.kind === "view" ? "view" : "catalog",
        input_unchanged: true,
      };
      try {
        const profile = RuntimeProfileSchema.parse(scenario.profile);
        const turn = TurnViewSchema.parse(scenario.turn);
        if (fixture.kind === "view") {
          const context = createViewContext(artifact, turn, {
            mode: profile.mode,
            ...(turn.for_participant ? { for: turn.for_participant } : {}),
          });
          const items: NonNullable<StoryContextResult["items"]> = [
            ...artifact.ir.fragments.map((value) => ({
              ref: { fragment: value.id },
              result: viewOf({ kind: "fragment", value }, context),
            })),
            ...artifact.catalog_index.sources.map((value) => ({
              ref: { source: value.id },
              result: viewOf({ kind: "source", value }, context),
            })),
          ];
          if (artifact.story) {
            if (turn.scene)
              items.push({
                ref: { story: "scene", id: turn.scene },
                result: viewOf({ kind: "story", role: "scene" }, context),
              });
            for (const [cast, participant] of Object.entries(context.participants))
              for (const role of ["part", "goal"] as const)
                items.push({
                  ref: { story: role, id: cast },
                  result: viewOf({ kind: "story", role, participant }, context),
                });
            for (const role of ["beat", "ending"] as const)
              for (const entry of (role === "beat"
                ? artifact.story.beats
                : artifact.story.endings) ?? [])
                items.push({
                  ref: { story: role, id: entry.id },
                  result: viewOf({ kind: "story", role }, context),
                });
          }
          output.items = items;
        } else {
          if (
            [scenario.plan, scenario.plan_from, scenario.selection].filter(
              (value) => value !== undefined,
            ).length > 1
          )
            throw new CharError({ code: "conformance.selection_conflict", subject: scenario.name });
          const reused =
            scenario.plan_from === undefined ? undefined : priorPlans.get(scenario.plan_from);
          if (scenario.plan_from !== undefined && !reused)
            throw new CharError({
              code: "conformance.plan_source_unavailable",
              subject: scenario.plan_from,
            });
          const suppliedPlan = scenario.plan ?? reused;
          const preparation = {
            artifact,
            profile,
            turn,
            ...(scenario.preset ? { preset: resolvePreset(scenario.preset) } : {}),
          };
          const build = createPreparationCatalog(
            preparation,
            scenario.discovery ?? suppliedPlan?.discovery ?? scenario.fallback !== "skip",
          );
          output.catalog = build.catalog;
          output.catalog_digest = build.input.catalog_digest;
          output.selector_view = selectorView(build.context);
          output.stage = "plan";
          output.plan_valid = false;
          output.plan =
            suppliedPlan ??
            (scenario.selection !== undefined
              ? fixedSelection(build, scenario.selection)
              : noneSelection(build));
          output.plan_valid = false;
          validateSelectionPlan(build, output.plan);
          output.plan_valid = true;
          output.plan_digest = digestExactJSON(output.plan);
          const planned = {
            ...preparation,
            plan: output.plan,
            ...(scenario.source_texts ? { source_texts: scenario.source_texts } : {}),
            ...(scenario.fallback ? { fallback: scenario.fallback } : {}),
          };
          output.stage = "source";
          output.source_requests = sourceRequests(planned);
          output.stage = "prepare";
          const result = prepareContext(planned);
          output.messages = result.messages;
          output.messages_digest = digestAssemblyMessages(result.messages);
          output.trace = result.trace;
        }
        output.stage = "complete";
        if (output.plan && output.plan_valid)
          priorPlans.set(scenario.name, structuredClone(output.plan));
      } catch (error) {
        output.error = errorOf(error);
      }
      output.input_unchanged = storyResultJSON(input) === before;
      scenarios.push(output);
    }
    expectation = {
      kind: fixture.kind,
      scenarios,
      input_unchanged: storyResultJSON(input) === before,
    };
  }
  const violations: string[] = [];
  if (!expectation.input_unchanged || storyResultJSON(input) !== before)
    violations.push("Story fixture input mutated");
  if (expectation.kind === "evaluation")
    for (const step of expectation.steps) {
      if (!step.input_unchanged) violations.push(`Story step ${step.index} mutated its input`);
    }
  else
    for (const scenario of expectation.scenarios) {
      if (!scenario.input_unchanged)
        violations.push(`Story scenario ${scenario.name} mutated its input`);
    }
  return { expectation, violations };
}
