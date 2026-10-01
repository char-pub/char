import { CharError } from "../errors.js";
import {
  type Story,
  type StoryCondition,
  type StoryEffect,
  type StoryJudgment,
  StorySchema,
  type StoryState,
} from "../schema/story.js";
import { checkStory, controlledInformation, setElement, validStoryValue } from "./check.js";
import { assertConditionLimits, assertStoryLimits } from "./limits.js";

export type Truth = boolean | "unknown";

function fail(code: string, subject: string, detail?: string): never {
  throw new CharError({ code: `story.${code}`, subject, ...(detail ? { detail } : {}) });
}

function definition(story: Story, cast: readonly string[]): void {
  assertStoryLimits(story);
  const parsed = StorySchema.safeParse(story);
  if (!parsed.success) fail("invalid_definition", "story", parsed.error.message);
  if (new Set(cast).size !== cast.length) fail("invalid_state", "cast", "Duplicate participant");
  const error = checkStory(story, cast).find((d) => d.severity === "error");
  if (error) throw new CharError(error);
}

function copy(state: StoryState): StoryState {
  return {
    ...state,
    present: [...state.present],
    visited: [...state.visited],
    reached: [...state.reached],
    ended: [...state.ended],
    happened: [...state.happened],
    vars: Object.fromEntries(
      Object.entries(state.vars).map(([key, value]) => [
        key,
        Array.isArray(value) ? [...value] : value,
      ]),
    ),
    knowing: Object.fromEntries(
      Object.entries(state.knowing).map(([key, value]) => [key, [...value]]),
    ),
  };
}

export function validateStoryState(story: Story, cast: readonly string[], state: StoryState): void {
  definition(story, cast);
  const lists: [string, string[], string[]][] = [
    ["present", state.present, [...cast]],
    ["visited", state.visited, story.scenes.map((s) => s.id)],
    ["reached", state.reached, (story.beats ?? []).map((s) => s.id)],
    ["ended", state.ended, (story.endings ?? []).map((s) => s.id)],
    [
      "happened",
      state.happened,
      (story.events ?? []).filter((e) => e.kind === "planned").map((s) => s.id),
    ],
  ];
  for (const [at, values, allowed] of lists) {
    if (
      !Array.isArray(values) ||
      new Set(values).size !== values.length ||
      values.some((v) => !allowed.includes(v))
    )
      fail("invalid_state", at);
  }
  if (!state.visited.includes(state.scene))
    fail("invalid_state", "scene", "Current scene must be visited");
  const starts = story.starts?.map((s) => s.id) ?? ["default"];
  if (!starts.includes(state.start)) fail("invalid_state", "start");
  const variables = story.vars ?? {};
  if (Object.keys(state.vars).length !== Object.keys(variables).length)
    fail("invalid_state", "vars");
  for (const [key, variable] of Object.entries(variables)) {
    const value = state.vars[key];
    if (value === undefined || !validStoryValue(story, variable, value))
      fail("invalid_state", `vars.${key}`);
  }
  const controlled = controlledInformation(story);
  if (Object.keys(state.knowing).length !== controlled.size) fail("invalid_state", "knowing");
  for (const ref of controlled) {
    const keys = state.knowing[ref];
    if (
      !Array.isArray(keys) ||
      new Set(keys).size !== keys.length ||
      keys.some((key) => !cast.includes(key))
    )
      fail("invalid_state", `knowing.${ref}`);
  }
  const shouldStop = (story.endings ?? []).some(
    (e) => state.ended.includes(e.id) && e.after !== "continue",
  );
  if (state.stopped !== shouldStop) fail("invalid_state", "stopped");
}

/** Strong Kleene logic: negating a missing judgment never proves a refusal. */
function evaluate(
  story: Story,
  state: StoryState,
  cond: StoryCondition,
  judgments: readonly StoryJudgment[],
  target: string,
  path: string,
): Truth {
  if ("all" in cond || "any" in cond) {
    const all = "all" in cond;
    const children = "all" in cond ? cond.all : cond.any;
    const values = children.map((c, i) =>
      evaluate(story, state, c, judgments, target, `${path}/${all ? "all" : "any"}/${i}`),
    );
    if (all && values.includes(false)) return false;
    if (!all && values.includes(true)) return true;
    return values.includes("unknown") ? "unknown" : all;
  }
  if ("not" in cond) {
    const value = evaluate(story, state, cond.not, judgments, target, `${path}/not`);
    return value === "unknown" ? value : !value;
  }
  if ("judge" in cond) {
    const records = judgments.filter((j) => j.target === target && j.path === path);
    if (records.length > 1) fail("duplicate_judgment", `${target}${path}`);
    const result = records[0]?.result;
    return result === "true" ? true : result === "false" ? false : "unknown";
  }
  if ("in" in cond) return state.scene === cond.in.slice(6);
  if ("visited" in cond) return state.visited.includes(cond.visited.slice(6));
  if ("reached" in cond) return state.reached.includes(cond.reached.slice(5));
  if ("ended" in cond) return state.ended.includes(cond.ended.slice(7));
  if ("happened" in cond) {
    const event = story.events?.find((e) => e.id === cond.happened.slice(6));
    return event?.kind === "background" || state.happened.includes(cond.happened.slice(6));
  }
  if ("knows" in cond) return state.knowing[cond.knows.info]?.includes(cond.knows.who) ?? false;
  if ("is" in cond) return state.vars[cond.is.slice(4)] === true;
  if ("eq" in cond) return state.vars[cond.eq[0].slice(4)] === cond.eq[1];
  if ("has" in cond) {
    const key = cond.has[0].slice(4);
    const variable = story.vars?.[key];
    const value = state.vars[key];
    if (!variable || !Array.isArray(value)) fail("invalid_state", key);
    return value.includes(setElement(variable, cond.has[1]));
  }
  const [key, op, right] = cond.cmp;
  const left = state.vars[key.slice(4)];
  if (typeof left !== "number") fail("invalid_state", key);
  switch (op) {
    case "=":
      return left === right;
    case "!=":
      return left !== right;
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    case ">":
      return left > right;
    case ">=":
      return left >= right;
  }
}

export function evaluateCondition(
  story: Story,
  cast: readonly string[],
  state: StoryState,
  cond: StoryCondition,
  judgments: readonly StoryJudgment[] = [],
  target = "",
  path = "/when",
): Truth {
  assertConditionLimits(cond);
  validateStoryState(story, cast, state);
  // Validate external conditions too, rather than silently treating unknown references as false.
  const probe = {
    ...story,
    scenes: story.scenes.map((s, i) => (i === 0 ? { ...s, when: cond } : s)),
  };
  definition(probe, cast);
  return evaluate(story, state, cond, judgments, target, path);
}

function applyEffects(
  story: Story,
  state: StoryState,
  effects: readonly StoryEffect[],
  cast: readonly string[],
): void {
  for (const effect of effects) {
    if ("learn" in effect) {
      const keys = effect.learn.who === "*" ? cast : [effect.learn.who];
      const knowing = state.knowing[effect.learn.info];
      if (!knowing) fail("invalid_state", effect.learn.info);
      for (const key of keys) if (!knowing.includes(key)) knowing.push(key);
    } else if ("set" in effect) {
      const [key, value] = effect.set;
      state.vars[key.slice(4)] = Array.isArray(value) ? [...value] : value;
    } else if ("add" in effect) {
      const [key, delta] = effect.add;
      const variable = story.vars?.[key.slice(4)];
      const current = state.vars[key.slice(4)];
      if (variable?.type !== "int" || typeof current !== "number") fail("invalid_state", key);
      state.vars[key.slice(4)] = Math.max(variable.min, Math.min(variable.max, current + delta));
    } else {
      const [key, value] = "put" in effect ? effect.put : effect.drop;
      const variable = story.vars?.[key.slice(4)];
      const current = state.vars[key.slice(4)];
      if (!variable || !Array.isArray(current)) fail("invalid_state", key);
      const element = setElement(variable, value);
      state.vars[key.slice(4)] =
        "put" in effect
          ? [...new Set([...current, element])]
          : current.filter((v) => v !== element);
    }
  }
}

function requireActive(state: StoryState): void {
  if (state.stopped) fail("stopped", state.scene);
}

function enter(
  story: Story,
  state: StoryState,
  sceneId: string,
  judgments: readonly StoryJudgment[],
  cast: readonly string[],
): void {
  const scene = story.scenes.find((s) => s.id === sceneId);
  if (!scene) fail("unknown_scene", sceneId);
  if (
    scene.when &&
    evaluate(story, state, scene.when, judgments, `scene/${sceneId}`, "/when") !== true
  )
    fail("condition_unsatisfied", `scene/${sceneId}`);
  state.scene = sceneId;
  if (!state.visited.includes(sceneId)) state.visited.push(sceneId);
  state.present = [...(scene.cast ?? cast)];
  for (const [ref, entry] of Object.entries(story.knowing ?? {})) {
    const learns = entry.enter?.[sceneId]?.knows;
    for (const key of learns === "*" ? cast : (learns ?? [])) {
      const known = state.knowing[ref];
      if (known && !known.includes(key)) known.push(key);
    }
  }
}

export function initStoryState(
  story: Story,
  cast: readonly string[],
  startId?: string,
  judgments: readonly StoryJudgment[] = [],
): StoryState {
  definition(story, cast);
  const start = startId ? story.starts?.find((s) => s.id === startId) : story.starts?.[0];
  if (startId && !start && (startId !== "default" || story.starts)) fail("unknown_start", startId);
  const state: StoryState = {
    start: start?.id ?? "default",
    scene: "",
    present: [],
    visited: [],
    reached: [...new Set(start?.reached ?? [])],
    ended: [],
    happened: [],
    stopped: false,
    vars: Object.fromEntries(
      Object.entries(story.vars ?? {}).map(([key, value]) => [
        key,
        Array.isArray(value.init) ? [...value.init] : value.init,
      ]),
    ),
    knowing: Object.fromEntries(
      [...controlledInformation(story)].map((ref) => {
        const known = story.knowing?.[ref]?.start.knows;
        return [ref, [...(known === "*" ? cast : (known ?? []))]];
      }),
    ),
  };
  applyEffects(story, state, start?.set ?? [], cast);
  const scene = start?.scene ?? story.scenes[0]?.id;
  if (!scene) fail("unknown_scene", "start");
  enter(story, state, scene, judgments, cast);
  validateStoryState(story, cast, state);
  return state;
}

export function enterScene(
  story: Story,
  cast: readonly string[],
  state: StoryState,
  sceneId: string,
  judgments: readonly StoryJudgment[] = [],
): StoryState {
  validateStoryState(story, cast, state);
  requireActive(state);
  const next = copy(state);
  enter(story, next, sceneId, judgments, cast);
  validateStoryState(story, cast, next);
  return next;
}

/** A player's action can change who is present without rewriting the authored scene. */
export function setPresent(
  story: Story,
  cast: readonly string[],
  state: StoryState,
  present: readonly string[],
): StoryState {
  validateStoryState(story, cast, state);
  requireActive(state);
  const next = { ...copy(state), present: [...present] };
  validateStoryState(story, cast, next);
  return next;
}

export function confirm(
  story: Story,
  cast: readonly string[],
  state: StoryState,
  target: string,
  judgments: readonly StoryJudgment[] = [],
): StoryState {
  validateStoryState(story, cast, state);
  requireActive(state);
  if (!/^(beat|ending|event)\/[a-z0-9][a-z0-9_-]*$/.test(target)) fail("unknown_target", target);
  const [kind, id] = target.split("/");
  const object =
    kind === "beat"
      ? story.beats?.find((s) => s.id === id)
      : kind === "ending"
        ? story.endings?.find((s) => s.id === id)
        : kind === "event"
          ? story.events?.find((s) => s.id === id && s.kind === "planned")
          : undefined;
  if (!object || !id) fail("unknown_target", target);
  const collection = kind === "beat" ? "reached" : kind === "ending" ? "ended" : "happened";
  if (state[collection].includes(id)) fail("already_confirmed", target);
  if (object.when && evaluate(story, state, object.when, judgments, target, "/when") !== true)
    fail("condition_unsatisfied", target);
  const next = copy(state);
  next[collection].push(id);
  applyEffects(story, next, object.effects ?? [], cast);
  if (kind === "ending" && (!("after" in object) || object.after !== "continue"))
    next.stopped = true;
  validateStoryState(story, cast, next);
  return next;
}

export function availableTargets(
  story: Story,
  cast: readonly string[],
  state: StoryState,
  judgments: readonly StoryJudgment[] = [],
): string[] {
  validateStoryState(story, cast, state);
  if (state.stopped) return [];
  const candidates = [
    ...story.scenes.map((s) => ({ ...s, target: `scene/${s.id}` })),
    ...(story.beats ?? [])
      .filter((s) => !state.reached.includes(s.id))
      .map((s) => ({ ...s, target: `beat/${s.id}` })),
    ...(story.events ?? [])
      .filter((s) => s.kind === "planned" && !state.happened.includes(s.id))
      .map((s) => ({ ...s, target: `event/${s.id}` })),
    ...(story.endings ?? [])
      .filter((s) => !state.ended.includes(s.id))
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
      .map((s) => ({ ...s, target: `ending/${s.id}` })),
  ];
  return candidates
    .filter((s) => !s.when || evaluate(story, state, s.when, judgments, s.target, "/when") === true)
    .map((s) => s.target);
}

/** Querying an authored suggestion does not confirm any narrative action. */
export function availableChoices(
  story: Story,
  cast: readonly string[],
  state: StoryState,
  judgments: readonly StoryJudgment[] = [],
): string[] {
  validateStoryState(story, cast, state);
  if (state.stopped) return [];
  const ids = story.scenes.find((s) => s.id === state.scene)?.choices ?? [];
  return ids.filter((id) => {
    const choice = story.choices?.find((c) => c.id === id);
    return (
      choice &&
      (!choice.when ||
        evaluate(story, state, choice.when, judgments, `choice/${id}`, "/when") === true)
    );
  });
}

export function toTurnStory(state: StoryState): Omit<StoryState, "present" | "scene"> {
  const { present: _present, scene: _scene, ...snapshot } = copy(state);
  return snapshot;
}
