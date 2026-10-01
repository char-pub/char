import { describe, expect, it } from "vitest";
import { canonicalizeCreation } from "../src/canonical.js";
import { checkCreation } from "../src/check.js";
import {
  type Story,
  type StoryCondition,
  type StoryJudgment,
  StorySchema,
} from "../src/schema/story.js";
import { checkStory } from "../src/story/check.js";
import {
  availableChoices,
  availableTargets,
  confirm,
  enterScene,
  evaluateCondition,
  initStoryState,
  setPresent,
  toTurnStory,
  validateStoryState,
} from "../src/story/evaluate.js";
import { level0Character, tid } from "./fixtures.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing test fixture value");
  return value;
}

function inn(): Story {
  return StorySchema.parse({
    version: 1,
    scenes: [
      { id: "lobby", title: "大厅", beats: ["trust"], choices: ["hand-over", "keep"] },
      { id: "back-door", title: "后门", cast: ["alice", "guest"], when: { reached: "beat/trust" } },
    ],
    choices: [
      {
        id: "hand-over",
        label: "交出信件",
        intent: "把信交给 Bob",
        when: { has: ["var/inventory", "item/letter"] },
      },
      { id: "keep", label: "自己保留", intent: "保留信件" },
    ],
    vars: {
      trust: { type: "int", min: 0, max: 100, init: 0, description: "信任" },
      mood: { type: "enum", values: ["calm", "tense"], init: "calm", description: "气氛" },
      road_open: { type: "bool", init: false, description: "道路" },
      inventory: { type: "set", of: "item", init: ["letter"], description: "持有物" },
    },
    items: [{ id: "letter", title: "信", description: "密封信件" }],
    knowing: {
      "#secret": {
        start: { knows: ["alice"], not: ["bob", "guest"] },
        enter: { "back-door": { knows: ["guest"] } },
      },
    },
    beats: [
      {
        id: "trust",
        title: "初步信任",
        description: "Alice 放下戒备",
        effects: [{ add: ["var/trust", 20] }],
      },
      {
        id: "refuse",
        title: "拒绝",
        description: "拒绝交信",
        when: { not: { judge: "玩家同意交信" } },
        effects: [{ set: ["var/mood", "tense"] }],
      },
    ],
    events: [
      { id: "old-case", kind: "background", title: "旧案", description: "过去的事" },
      {
        id: "snow-ends",
        kind: "planned",
        title: "雪停",
        description: "道路恢复",
        effects: [{ set: ["var/road_open", true] }],
      },
    ],
    endings: [
      {
        id: "leave",
        title: "离开",
        description: "离开旅馆",
        when: { is: "var/road_open" },
        priority: 3,
      },
      { id: "stay", title: "留下", description: "继续生活", after: "continue" },
    ],
  });
}
const cast = ["alice", "bob", "guest"];
const judgment = (result: StoryJudgment["result"]): StoryJudgment => ({
  target: "beat/refuse",
  path: "/when/not",
  result,
  provider: { name: "fixed", version: "1" },
});

describe("open story state", () => {
  it("supports an open scene without variables, conditions or starts", () => {
    const story = StorySchema.parse({ version: 1, scenes: [{ id: "room", title: "房间" }] });
    expect(initStoryState(story, cast)).toMatchObject({
      start: "default",
      scene: "room",
      present: cast,
      vars: {},
      stopped: false,
    });
  });

  it("allows Bob to follow into a scene without rewriting the authored cast", () => {
    const story = inn();
    const initial = initStoryState(story, cast);
    expect(() => enterScene(story, cast, initial, "back-door")).toThrow();
    const trusted = confirm(story, cast, initial, "beat/trust");
    const back = enterScene(story, cast, trusted, "back-door");
    const joined = setPresent(story, cast, back, cast);
    expect(joined.present).toEqual(cast);
    expect(back.present).toEqual(["alice", "guest"]);
    expect(story.scenes[1]?.cast).toEqual(["alice", "guest"]);
    expect(joined.knowing["#secret"]).toEqual(["alice", "guest"]);
    expect(setPresent(story, cast, joined, []).present).toEqual([]);
    expect(() => setPresent(story, cast, joined, ["unknown"])).toThrow();
  });

  it("offers choices without confirming actions and permits independent free actions", () => {
    const story = inn();
    const state = initStoryState(story, cast);
    const before = JSON.stringify(state);
    expect(availableChoices(story, cast, state)).toEqual(["hand-over", "keep"]);
    expect(JSON.stringify(state)).toBe(before);
    expect(() => confirm(story, cast, state, "choice/keep")).toThrow();
    expect(confirm(story, cast, state, "event/snow-ends").vars.road_open).toBe(true);
  });

  it("confirms once, does not mutate input and does not repeat effects", () => {
    const story = inn();
    const before = initStoryState(story, cast);
    const after = confirm(story, cast, before, "beat/trust");
    expect(after.vars.trust).toBe(20);
    expect(before.vars.trust).toBe(0);
    expect(() => confirm(story, cast, after, "beat/trust")).toThrow();
    expect(after.vars.trust).toBe(20);
    expect(availableTargets(story, cast, after)).not.toContain("beat/trust");
    expect(() => confirm(story, cast, before, "beat/trust/extra")).toThrow();
    expect(before.vars.trust).toBe(0);
  });

  it("enforces stop while allowing queries and an explicit new game", () => {
    const story = inn();
    const state = confirm(story, cast, initStoryState(story, cast), "event/snow-ends");
    const stopped = confirm(story, cast, state, "ending/leave");
    expect(stopped.stopped).toBe(true);
    expect(availableTargets(story, cast, stopped)).toEqual([]);
    expect(() => enterScene(story, cast, stopped, "lobby")).toThrow();
    expect(() => confirm(story, cast, stopped, "ending/stay")).toThrow();
    expect(() => setPresent(story, cast, stopped, [])).toThrow();
    expect(initStoryState(story, cast).stopped).toBe(false);
    expect(confirm(story, cast, state, "ending/stay").stopped).toBe(false);
  });

  it("checks entry judgments at initialization before enter effects", () => {
    const story = inn();
    required(story.scenes[0]).when = { judge: "准许进入" };
    expect(() => initStoryState(story, cast)).toThrow();
    const state = initStoryState(story, cast, undefined, [
      { ...judgment("true"), target: "scene/lobby", path: "/when" },
    ]);
    expect(state.scene).toBe("lobby");
  });

  it("initializes a later start without replaying reached Beat effects", () => {
    const story = inn();
    story.starts = [
      { id: "later", scene: "back-door", reached: ["trust"], set: [{ set: ["var/trust", 70] }] },
    ];
    const state = initStoryState(story, cast);
    expect(state.vars.trust).toBe(70);
    expect(state.reached).toEqual(["trust"]);
    const snapshot = toTurnStory(state);
    snapshot.vars.trust = 0;
    expect(state.vars.trust).toBe(70);
  });

  it("clamps integer increments and applies set operations in order", () => {
    const story = inn();
    required(story.beats?.[0]).effects = [
      { add: ["var/trust", 2147483647] },
      { drop: ["var/inventory", "item/letter"] },
      { put: ["var/inventory", "item/letter"] },
    ];
    const state = confirm(story, cast, initStoryState(story, cast), "beat/trust");
    expect(state.vars.trust).toBe(100);
    expect(state.vars.inventory).toEqual(["letter"]);
  });
});

describe("judgment semantics", () => {
  it("does not interpret an unknown agreement as refusal", () => {
    const story = inn();
    const state = initStoryState(story, cast);
    const condition = required(story.beats?.[1]?.when);
    expect(evaluateCondition(story, cast, state, condition, [], "beat/refuse")).toBe("unknown");
    expect(() => confirm(story, cast, state, "beat/refuse")).toThrow();
    expect(confirm(story, cast, state, "beat/refuse", [judgment("false")]).vars.mood).toBe("tense");
    expect(() => confirm(story, cast, state, "beat/refuse", [judgment("true")])).toThrow();
    expect(() =>
      confirm(story, cast, state, "beat/refuse", [judgment("false"), judgment("false")]),
    ).toThrow();
  });

  it.each<[StoryCondition, boolean | "unknown"]>([
    [{ all: [] }, true],
    [{ any: [] }, false],
    [{ all: [{ judge: "未知" }, { any: [] }] }, false],
    [{ any: [{ judge: "未知" }, { all: [] }] }, true],
    [{ not: { judge: "未知" } }, "unknown"],
    [{ all: [{ judge: "未知" }, { all: [] }] }, "unknown"],
  ])("combines %j as %s", (condition, expected) => {
    const story = inn();
    expect(evaluateCondition(story, cast, initStoryState(story, cast), condition)).toBe(expected);
  });
});

describe("static and runtime validation", () => {
  it("rejects unknown references, untyped variables and contradictory knowledge", () => {
    const story = inn();
    required(story.beats?.[0]).when = { cmp: ["var/mood", ">", 2] };
    required(story.knowing?.["#secret"]).start.not = ["alice"];
    required(story.scenes[0]).beats = ["missing"];
    expect(checkStory(story, cast).map((d) => d.code)).toContain("story.type_mismatch");
    expect(
      checkStory(story, cast).filter((d) => d.severity === "error").length,
    ).toBeGreaterThanOrEqual(3);
    expect(() => initStoryState(story, cast)).toThrow();
  });

  it("rejects invalid full snapshots instead of filling in missing state", () => {
    const story = inn();
    const state = initStoryState(story, cast);
    expect(() =>
      validateStoryState(story, cast, { ...state, vars: { ...state.vars, trust: 101 } }),
    ).toThrow();
    expect(() => validateStoryState(story, cast, { ...state, knowing: {} })).toThrow();
    expect(() => evaluateCondition(story, cast, state, { visited: "scene/missing" })).toThrow();
    expect(() => validateStoryState(story, cast, { ...state, present: ["new-npc"] })).toThrow();
    expect(() =>
      validateStoryState(story, cast, {
        ...state,
        knowing: { "#secret": ["new-npc"] },
      }),
    ).toThrow();
  });

  it("bounds recursive and cyclic conditions before schema parsing", () => {
    const story = inn();
    const state = initStoryState(story, cast);
    let condition: StoryCondition = { judge: "unknown" };
    for (let i = 0; i < 5000; i++) condition = { not: condition };
    expect(() => evaluateCondition(story, cast, state, condition)).toThrowError(
      expect.objectContaining({ code: "story.condition_limit" }),
    );
    const cycle: StoryCondition = { all: [] };
    cycle.all.push(cycle);
    expect(() => evaluateCondition(story, cast, state, cycle)).toThrowError(
      expect.objectContaining({ code: "story.condition_limit" }),
    );
  });

  it("keeps instance-qualified secrets distinct", () => {
    const story = inn();
    story.knowing = {
      "cast:alice#secret": { start: { knows: ["alice"] } },
      "cast:bob#secret": { start: { knows: ["bob"] } },
    };
    const state = initStoryState(story, cast);
    expect(
      evaluateCondition(story, cast, state, { knows: { who: "bob", info: "cast:alice#secret" } }),
    ).toBe(false);
    expect(
      evaluateCondition(story, cast, state, { knows: { who: "bob", info: "cast:bob#secret" } }),
    ).toBe(true);
  });

  it("round-trips story in canonical identity and checks creation-local references", () => {
    const input = {
      ...level0Character(),
      id: tid("cr", 42),
      type: "scenario",
      fragments: [
        {
          id: "secret",
          stable: true,
          kind: "knowledge",
          content: { type: "text", text: "The local secret referenced by the Story." },
        },
      ],
      cast: cast.map((key) => ({ key, who: { late: "character" }, part: key })),
      story: inn(),
    };
    const canonical = canonicalizeCreation(input);
    expect(checkCreation(canonical.creation).ok).toBe(true);
    expect(canonicalizeCreation(canonical.json).semantic_digest).toBe(canonical.semantic_digest);
    const changed = structuredClone(input);
    required(changed.story.choices?.[0]).label = "另一种行动";
    expect(canonicalizeCreation(changed).semantic_digest).not.toBe(canonical.semantic_digest);
    expect(() => canonicalizeCreation({ ...input, type: "character" })).toThrow();
  });
});
