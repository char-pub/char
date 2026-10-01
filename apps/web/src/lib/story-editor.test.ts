import {
  AssemblyFixtureSchema,
  CastMemberSchema,
  checkStory,
  FragmentSchema,
  lateSlotKey,
  participantKey,
  ReferenceEdgeSchema,
  StoryConditionSchema,
  StorySchema,
} from "@char-pub/core";
import { describe, expect, it } from "vitest";
import type { Working } from "./draft";
import {
  castReferences,
  type StoryObjectKind,
  storyReferences,
  storyRestoreError,
  storyText,
  withStoryText,
} from "./story-editor";

const story = () =>
  StorySchema.parse({
    version: 1,
    scenes: [
      { id: "hall", title: "Hall" },
      { id: "garden", title: "Garden" },
    ],
    beats: [{ id: "reward", title: "Reward", description: "Earn a reward" }],
    endings: [{ id: "escape", title: "Escape", description: "Escape safely" }],
    choices: [{ id: "leave", label: "Leave", intent: "Find the exit" }],
    events: [
      { id: "arrival", title: "Arrival", description: "The guest arrives", kind: "planned" },
    ],
    starts: [{ id: "welcome" }],
  });
const fixture = (extra: Record<string, unknown> = {}) =>
  AssemblyFixtureSchema.parse({
    id: "preview",
    root: "self",
    profile: {
      runtime: { name: "test", version: "1" },
      tokenizer: "estimate",
      context_window: 4096,
      reserve_for_output: 0,
      mode: "narrator",
      capabilities: { system_role: true },
    },
    session: {},
    assembler: { name: "test", version: "1" },
    tokenizer: { name: "estimate", version: "1" },
    expected: { kind: "success", messages_digest: `sha256:${"0".repeat(64)}` },
    ...extra,
  });

describe("Story deletion references", () => {
  it.each([
    ["scene", "hall", "in"],
    ["scene", "hall", "visited"],
    ["beat", "reward", "reached"],
    ["ending", "escape", "ended"],
    ["event", "arrival", "happened"],
  ] as const)("finds nested %s conditions using %s/%s grammar", (kind, id, leaf) => {
    const value = story();
    const scene = value.scenes[1];
    if (!scene) throw new Error("missing scene");
    scene.when = StoryConditionSchema.parse({
      all: [{ any: [{ not: { [leaf]: `${kind}/${id}` } }] }],
    });
    const parsed = StorySchema.parse(value);
    expect(storyReferences({ story: parsed }, kind, id)).toEqual([
      `story.scenes[1].when.all[0].any[0].not.${leaf}`,
    ]);
  });

  it("protects scene associations, plotlines, starts and parallel timeline entries", () => {
    const value = story();
    const scene = value.scenes[0];
    if (!scene) throw new Error("missing scene");
    scene.beats = ["reward"];
    scene.choices = ["leave"];
    scene.events = ["arrival"];
    value.plotlines = [{ id: "main", title: "Main", scenes: ["hall"], beats: ["reward"] }];
    value.timelines = [
      { id: "clock", title: "Clock", order: [["scene/hall", "arrival"], "scene/garden"] },
    ];
    value.starts = [{ id: "welcome", scene: "hall", reached: ["reward"] }];
    const parsed = StorySchema.parse(value);
    expect(checkStory(parsed, []).filter((item) => item.severity === "error")).toEqual([]);
    expect(storyReferences({ story: parsed }, "scene", "hall")).toEqual([
      "story.plotlines[0].scenes",
      "story.timelines[0].order",
      "story.starts[0].scene",
    ]);
    expect(storyReferences({ story: parsed }, "beat", "reward")).toEqual([
      "story.scenes[0].beats",
      "story.plotlines[0].beats",
      "story.starts[0].reached",
    ]);
    expect(storyReferences({ story: parsed }, "choice", "leave")).toEqual([
      "story.scenes[0].choices",
    ]);
    expect(storyReferences({ story: parsed }, "event", "arrival")).toEqual([
      "story.scenes[0].events",
      "story.timelines[0].order",
    ]);
    expect(storyReferences({ story: parsed }, "plotline", "main")).toEqual([]);
  });

  it("keeps bare timeline event IDs separate from qualified scene IDs", () => {
    const value = StorySchema.parse({
      version: 1,
      scenes: [{ id: "same", title: "Room" }],
      events: [{ id: "same", title: "Event", description: "Event", kind: "background" }],
      timelines: [{ id: "time", title: "Time", order: [["same"]] }],
    });
    expect(storyReferences({ story: value }, "scene", "same")).toEqual([]);
    expect(storyReferences({ story: value }, "event", "same")).toEqual([
      "story.timelines[0].order",
    ]);
  });

  it("finds knowing.enter, story-scene visibility and Style scope without treating fragment IDs as scenes", () => {
    const value = story();
    value.knowing = {
      "#fact": { start: { not: ["alice"] }, enter: { hall: { knows: ["alice"] } } },
    };
    const fragment = FragmentSchema.parse({
      id: "fact",
      stable: true,
      kind: "knowledge",
      content: { type: "text", text: "Fact" },
      about: ["#scene/hall", "cast:alice", "@test/hall"],
      visibility: { scope: "story-scene", scene: "hall" },
    });
    const style = ReferenceEdgeSchema.parse({
      id: "voice",
      use: "@test/style",
      mode: "default",
      scope: { scene: "hall" },
    });
    const w: Working = {
      story: StorySchema.parse(value),
      fragments: [
        fragment,
        { ...fragment, id: "other", visibility: { scope: "scene", scene: "hall" } },
      ],
      references: [style],
    };
    expect(storyReferences(w, "scene", "hall")).toEqual([
      "story.knowing.#fact.enter.hall",
      "fragments[0].visibility.scene",
      "references[0].scope.scene",
    ]);
  });

  it.each([
    ["scene", "hall", "visited"],
    ["beat", "reward", "reached"],
    ["ending", "escape", "ended"],
    ["event", "arrival", "happened"],
  ] as const)("finds self fixture %s state without scanning foreign roots", (kind, id, list) => {
    const own = fixture({
      session: {
        story: {
          start: "welcome",
          visited: [],
          reached: [],
          ended: [],
          happened: [],
          vars: {},
          knowing: {},
          stopped: false,
          [list]: [id],
        },
      },
    });
    const foreign = fixture({
      ...own,
      root: {
        ref: "@else/story",
        release: "rel_01j00000000000000000000000",
        semantic_digest: `sha256:${"1".repeat(64)}`,
      },
      preset: "self",
    });
    expect(storyReferences({ story: story(), assembly_tests: [foreign, own] }, kind, id)).toEqual([
      `assembly_tests[1].session.story.${list}`,
    ]);
  });

  it("finds self fixture current scene, start, judgment, selection and trace references", () => {
    const own = fixture({
      session: {
        scene: "hall",
        story: {
          start: "welcome",
          visited: [],
          reached: [],
          ended: [],
          happened: [],
          vars: {},
          knowing: {},
          stopped: false,
        },
        judgments: [
          {
            target: "choice/leave",
            path: "/when",
            result: "true",
            provider: { name: "manual", version: "1" },
          },
        ],
      },
      selection: [
        { story: "beat", id: "reward" },
        { story: "ending", id: "escape" },
        { story: "scene", id: "hall" },
      ],
      expected: { kind: "success", trace: [{ source: "story:beat:reward", included: true }] },
    });
    const w = { story: story(), assembly_tests: [own] };
    expect(storyReferences(w, "scene", "hall")).toEqual([
      "assembly_tests[0].session.scene",
      "assembly_tests[0].selection[2]",
    ]);
    expect(storyReferences(w, "start", "welcome")).toEqual([
      "assembly_tests[0].session.story.start",
    ]);
    expect(storyReferences(w, "choice", "leave")).toEqual([
      "assembly_tests[0].session.judgments[0].target",
    ]);
    expect(storyReferences(w, "beat", "reward")).toEqual([
      "assembly_tests[0].selection[0]",
      "assembly_tests[0].expected.trace[0].source",
    ]);
    expect(storyReferences(w, "ending", "escape")).toEqual(["assembly_tests[0].selection[1]"]);
  });

  it.each(["scene", "beat", "ending", "event"] as const)(
    "ignores the removed %s object's own condition",
    (kind) => {
      const items: Record<string, unknown>[] = [
        {
          id: "self",
          title: "Self",
          description: "Self",
          ...(kind === "event" ? { kind: "planned" } : {}),
          when: {
            [kind === "scene"
              ? "in"
              : kind === "beat"
                ? "reached"
                : kind === "ending"
                  ? "ended"
                  : "happened"]: `${kind}/self`,
          },
        },
      ];
      const value = StorySchema.parse({
        version: 1,
        scenes: kind === "scene" ? items : [{ id: "hall", title: "Hall" }],
        ...(kind === "scene" ? {} : { [`${kind}s`]: items }),
      });
      expect(storyReferences({ story: value }, kind, "self")).toEqual([]);
    },
  );

  it("does not mistake localized text, variable values or fixture overlays for references", () => {
    const value = story();
    const scene = value.scenes[1];
    if (!scene) throw new Error("missing scene");
    scene.when = { judge: { en: "Question", in: "scene/hall" } };
    value.vars = {
      reached: {
        type: "set",
        init: ["reward"],
        values: ["reward"],
        description: { in: "scene/hall" },
      },
    };
    const own = fixture({
      session: {
        overlay: { state: { scene: "hall", start: "welcome", target: "beat/reward" } },
        story: {
          start: "elsewhere",
          visited: [],
          reached: [],
          ended: [],
          happened: [],
          vars: { reached: ["reward"] },
          knowing: {},
          stopped: false,
        },
      },
    });
    const w = { story: StorySchema.parse(value), assembly_tests: [own] };
    for (const [kind, id] of [
      ["scene", "hall"],
      ["beat", "reward"],
      ["start", "welcome"],
    ] as [StoryObjectKind, string][])
      expect(storyReferences(w, kind, id)).toEqual([]);
  });
});

describe("Story localized text", () => {
  it("edits only the requested language without mutating other translations", () => {
    const text = { en: "Hello", ja: "こんにちは" };
    expect(storyText(text, "en")).toBe("Hello");
    expect(storyText(text, "de")).toBe("");
    expect(withStoryText(text, "en", "Welcome")).toEqual({ en: "Welcome", ja: "こんにちは" });
    expect(withStoryText(text, "de", "Hallo")).toEqual({ ...text, de: "Hallo" });
    expect(text).toEqual({ en: "Hello", ja: "こんにちは" });
    expect(withStoryText("Hello", "en", "Welcome")).toBe("Welcome");
  });
});

describe("Cast deletion references", () => {
  const cast = [
    CastMemberSchema.parse({
      key: "alice",
      who: { late: "character" },
      part: "Alice leads",
      goal: "Find the exit",
    }),
  ];
  it("protects explicit Story cast, goals, knowledge, nested knows and learn effects", () => {
    const value = StorySchema.parse({
      version: 1,
      scenes: [
        {
          id: "hall",
          title: "Hall",
          cast: ["alice"],
          goals: { alice: "Exit" },
          when: { all: [{ not: { knows: { who: "alice", info: "#fact" } } }] },
        },
      ],
      events: [
        {
          id: "alarm",
          title: "Alarm",
          description: "Alarm sounds",
          kind: "planned",
          cast: ["alice"],
          effects: [{ learn: { who: "alice", info: "#fact" } }],
        },
      ],
      knowing: { "#fact": { start: { not: ["alice"] }, enter: { hall: { knows: ["alice"] } } } },
    });
    expect(checkStory(value, ["alice"]).filter((item) => item.severity === "error")).toEqual([]);
    expect(castReferences({ story: value, cast }, "alice")).toEqual([
      "story.scenes[0].cast",
      "story.scenes[0].goals.alice",
      "story.scenes[0].when.all[0].not.knows.who",
      "story.events[0].effects[0].learn.who",
      "story.events[0].cast",
      "story.knowing.#fact.start.not",
      "story.knowing.#fact.enter.hall.knows",
    ]);
  });
  it("keeps implicit everyone, wildcard knowledge and author prose free of false references", () => {
    const value = StorySchema.parse({
      version: 1,
      scenes: [{ id: "hall", title: "alice", opening: "{{{{cast:alice}}" }],
      knowing: { "#fact": { start: { knows: "*" }, enter: { hall: { knows: "*" } } } },
    });
    expect(
      castReferences(
        {
          story: value,
          cast,
          assembly_tests: [
            fixture({
              session: {
                history: [{ role: "user", text: "{{cast:alice}}" }],
                overlay: { state: { actor: "alice" } },
              },
            }),
          ],
        },
        "alice",
      ),
    ).toEqual([]);
  });
  it("finds templates through Core tokenization, private speakers, info refs and Style binding/scope", () => {
    const fragment = FragmentSchema.parse({
      id: "fact",
      stable: true,
      kind: "examples",
      content: {
        type: "dialogue",
        turns: [{ speaker: "{{cast:alice}}", text: "Hello {{cast:alice}}" }],
      },
      locale: { ja: { content: { type: "text", text: "{{cast:alice}}さん" } } },
      visibility: { scope: "private", to: ["{{cast:alice}}"] },
      perspective: { belief: "{{cast:alice}}" },
      about: ["cast:alice", "cast:alice#memory"],
      source: { use: "cast:alice#source/notes" },
    });
    const value = StorySchema.parse({
      version: 1,
      scenes: [
        {
          id: "hall",
          title: "Hall",
          opening: { en: "Welcome {{cast:alice}}", ja: "{{cast:alice}}さん" },
          place: "cast:alice#home",
          lore: ["cast:alice#notes"],
        },
      ],
      starts: [{ id: "welcome", greeting: "{{cast:alice}} arrives" }],
    });
    const references = [
      ReferenceEdgeSchema.parse({
        id: "style",
        use: "@test/style",
        mode: "default",
        scope: { cast: "alice" },
        bind: { actor: "{{cast:alice}}" },
      }),
    ];
    const found = castReferences(
      { story: value, cast, fragments: [fragment], references },
      "alice",
    );
    expect(found).toEqual(
      expect.arrayContaining([
        "story.scenes[0].opening.en",
        "story.scenes[0].opening.ja",
        "story.scenes[0].place",
        "story.scenes[0].lore[0]",
        "story.starts[0].greeting",
        "fragments[0].visibility.to",
        "fragments[0].perspective.belief",
        "fragments[0].about[0]",
        "fragments[0].about[1]",
        "fragments[0].source.use",
        "fragments[0].content.turns[0].speaker",
        "fragments[0].content.turns[0].text",
        "fragments[0].locale.ja.content.text",
        "references[0].scope.cast",
        "references[0].bind.actor",
      ]),
    );
    expect(
      castReferences({ story: value, cast, fragments: [fragment], references }, "ali"),
    ).toEqual([]);
  });
  it("protects self fixtures' real participant/late keys and knowledge but not foreign fixtures", () => {
    const own = fixture({
      session: {
        for_participant: "alice",
        present: [participantKey("root", "alice")],
        bindings: { [lateSlotKey("root", "alice")]: { kind: "character", display_name: "Alice" } },
        history: [{ role: "assistant", speaker: participantKey("root", "alice"), text: "Hello" }],
        story: {
          start: "welcome",
          visited: [],
          reached: [],
          ended: [],
          happened: [],
          knowing: { "#fact": ["alice"] },
          vars: {},
          stopped: false,
        },
      },
      selection: [{ story: "goal", id: "alice" }],
      expected: { kind: "success", trace: [{ source: "story:part:alice", included: true }] },
    });
    const foreign = fixture({
      ...own,
      root: {
        ref: "@other/story",
        release: "rel_01j00000000000000000000000",
        semantic_digest: `sha256:${"1".repeat(64)}`,
      },
      preset: "self",
    });
    expect(castReferences({ cast, assembly_tests: [foreign] }, "alice")).toEqual([]);
    expect(castReferences({ cast, assembly_tests: [foreign, own] }, "alice")).toEqual([
      "assembly_tests[1].session.for_participant",
      "assembly_tests[1].session.present[0]",
      "assembly_tests[1].session.history[0].speaker",
      `assembly_tests[1].session.bindings.${lateSlotKey("root", "alice")}`,
      "assembly_tests[1].session.story.knowing.#fact",
      "assembly_tests[1].selection[0]",
      "assembly_tests[1].expected.trace[0].source",
    ]);
  });
  it("does not interpret foreign override macros in the root cast scope", () => {
    const reference = ReferenceEdgeSchema.parse({
      id: "child",
      use: "@other/story",
      mode: "default",
      override: [
        { op: "replace", target: "fact", content: { type: "text", text: "{{cast:alice}}" } },
      ],
    });
    expect(castReferences({ cast, references: [reference] }, "alice")).toEqual([]);
  });
  it("tolerates incomplete author fixtures while retaining already-entered references", () => {
    const working = {
      cast,
      assembly_tests: [
        null,
        { root: "self" },
        { root: "self", session: { scene: "hall", for_participant: "alice" } },
      ],
    };
    expect(storyReferences(working, "scene", "hall")).toEqual(["assembly_tests[2].session.scene"]);
    expect(castReferences(working, "alice")).toEqual(["assembly_tests[2].session.for_participant"]);
  });
});

describe("Undo with unfinished prose", () => {
  const baseline = (): Working => ({
    id: "cr_01j00000000000000000000001",
    ref: "@test/story",
    type: "scenario",
    display_name: "Story",
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
    cast: [{ key: "alice", who: { late: "character" } }],
    slots: { guide: { accepts: "character" } },
    params: { town: { type: "string" } },
    bootstrap: { greetings: [{ id: "hello", text: "Hello" }] },
    story: {
      version: 1,
      scenes: [{ id: "hall", title: "Hall" }],
      starts: [{ id: "start", greeting: { ref: "hello" } }],
    },
  });
  it("rejects restoring a missing bootstrap greeting despite an empty unrelated title", () => {
    const original = baseline();
    if (!original.bootstrap) throw new Error("missing bootstrap");
    const { bootstrap: _removed, ...rest } = original;
    const before = {
      ...rest,
      display_name: "",
      story: { version: 1, scenes: [{ id: "hall", title: "Hall" }] },
    };
    const after = { ...before, story: original.story };
    expect(storyRestoreError(before, after, original)).toContain(
      "missing bootstrap greeting 'hello'",
    );
    expect(
      storyRestoreError(before, { ...after, bootstrap: original.bootstrap }, original),
    ).toBeNull();
    expect(before.display_name).toBe("");
  });
  it.each([
    ["cast", "alice", "cast"],
    ["slot", "guide", "slots"],
    ["param", "town", "params"],
  ] as const)(
    "checks missing %s inputs in localized scene and start templates",
    (kind, name, field) => {
      for (const inScene of [true, false]) {
        const original = baseline();
        const template = { en: `Hello {{${kind}:${name}}}`, ja: `ようこそ {{${kind}:${name}}}` };
        original.story = StorySchema.parse({
          version: 1,
          scenes: [{ id: "hall", title: "Hall", ...(inScene ? { opening: template } : {}) }],
          ...(!inScene ? { starts: [{ id: "start", greeting: template }] } : {}),
        });
        const { [field]: _removed, ...rest } = original;
        const before = {
          ...rest,
          display_name: "",
          story: { version: 1, scenes: [{ id: "hall", title: "Hall" }] },
        };
        expect(storyRestoreError(before, { ...before, story: original.story }, original)).toContain(
          `missing ${kind} '${name}'`,
        );
        expect(
          storyRestoreError(
            before,
            { ...before, [field]: original[field], story: original.story },
            original,
          ),
        ).toBeNull();
      }
    },
  );
  it("accepts escaped literal placeholders and does not inspect ordinary title text", () => {
    const before = {
      ...baseline(),
      display_name: "",
      cast: [],
      slots: {},
      params: {},
      story: { version: 1, scenes: [{ id: "hall", title: "Hall" }] },
    };
    const after = {
      ...before,
      story: StorySchema.parse({
        version: 1,
        scenes: [
          {
            id: "hall",
            title: "{{cast:missing}}",
            opening: "{{{{cast:missing}} {{{{slot:missing}} {{{{param:missing}}",
          },
        ],
        starts: [{ id: "start", greeting: { en: "{{{{cast:missing}}" } }],
      }),
    };
    expect(storyRestoreError(before, after, before)).toBeNull();
  });
  it("allows unchanged missing references from the baseline while rejecting newly introduced ones", () => {
    const original = {
      ...baseline(),
      display_name: "",
      cast: [],
      story: StorySchema.parse({
        version: 1,
        scenes: [{ id: "hall", title: "Hall", opening: "{{cast:old}}" }],
      }),
    };
    const before = { ...original, story: { version: 1, scenes: [{ id: "hall", title: "Hall" }] } };
    expect(storyRestoreError(before, original, original)).toBeNull();
    const after = {
      ...original,
      story: StorySchema.parse({
        version: 1,
        scenes: [{ id: "hall", title: "Hall", opening: "{{cast:new}}" }],
      }),
    };
    expect(storyRestoreError(before, after, original)).toContain("missing cast 'new'");
  });
});

describe("typed variable and inventory deletion references", () => {
  it("finds nested variable rules, ordered effects, initial values and only self fixture snapshots", () => {
    const value = StorySchema.parse({
      version: 1,
      scenes: [{ id: "hall", title: "Hall", items: ["key"] }],
      vars: {
        trust: { type: "int", min: 0, max: 5, init: 0, description: "Trust" },
        bag: { type: "set", of: "item", init: ["key"], description: "Inventory" },
      },
      items: [{ id: "key", title: "Key", description: "A brass key" }],
      beats: [
        {
          id: "reward",
          title: "Reward",
          description: "Earn a key",
          when: { all: [{ cmp: ["var/trust", ">=", 1] }, { has: ["var/bag", "item/key"] }] },
          effects: [{ add: ["var/trust", 1] }, { put: ["var/bag", "key"] }],
        },
      ],
      starts: [{ id: "welcome", set: [{ set: ["var/bag", ["key"]] }] }],
    });
    const snapshot = fixture({
      session: {
        story: {
          start: "welcome",
          visited: ["hall"],
          reached: [],
          ended: [],
          happened: [],
          vars: { trust: 1, bag: ["key"] },
          knowing: {},
          stopped: false,
        },
      },
    });
    const working = {
      story: value,
      assembly_tests: [
        snapshot,
        {
          ...snapshot,
          root: {
            ref: "@other/story",
            release: "rel_01j00000000000000000000001",
            semantic_digest: `sha256:${"1".repeat(64)}`,
          },
        },
      ],
    };
    expect(storyReferences(working, "var", "trust")).toEqual([
      "story.beats[0].when.all[0].cmp",
      "story.beats[0].effects[0].add",
      "assembly_tests[0].session.story.vars.trust",
    ]);
    expect(storyReferences(working, "item", "key")).toEqual(
      expect.arrayContaining([
        "story.beats[0].when.all[1].has",
        "story.beats[0].effects[1].put",
        "story.scenes[0].items",
        "story.starts[0].set[0].set",
        "story.vars.bag.init",
        "assembly_tests[0].session.story.vars.bag",
      ]),
    );
    expect(
      storyReferences(working, "item", "key").some((path) => path.includes("assembly_tests[1]")),
    ).toBe(false);
  });
  it("does not mistake enum or ordinary set values for item identities", () => {
    const value = StorySchema.parse({
      version: 1,
      scenes: [{ id: "hall", title: "Hall" }],
      vars: {
        choices: { type: "set", values: ["key"], init: ["key"], description: "Labels" },
        mood: { type: "enum", values: ["key"], init: "key", description: "Mood" },
      },
      items: [{ id: "key", title: "Key", description: "A brass key" }],
      beats: [
        {
          id: "reward",
          title: "Reward",
          description: "Labels",
          when: { any: [{ has: ["var/choices", "key"] }, { eq: ["var/mood", "key"] }] },
          effects: [{ put: ["var/choices", "key"] }],
        },
      ],
    });
    expect(storyReferences({ story: value }, "item", "key")).toEqual([]);
    expect(storyReferences({ story: value }, "var", "choices")).toHaveLength(2);
  });
});
