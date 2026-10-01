import { expect, it } from "vitest";
import { canonicalizeCreation, digestOf } from "../src/canonical.js";
import { checkCreation } from "../src/check.js";
import { mergeContribution } from "../src/merge.js";
import type { CreationInput } from "../src/schema/creation.js";
import { ChangeSchema } from "../src/schema/release.js";
import type { Story, StoryScene } from "../src/schema/story.js";
import {
  type CompositionAddress,
  compositionDigest,
  compositionValue,
} from "../src/story-merge.js";

function fixture(): CreationInput {
  return {
    id: "cr_01j00000000000000000000001",
    ref: "@writer/mystery",
    type: "scenario",
    display_name: "Mystery",
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
    cast: ["alice", "bob", "claire", "dave"].map((key) => ({ key, who: { late: "character" } })),
    fragments: ["fact", "second", "third"].map((id) => ({
      id,
      stable: true,
      kind: "knowledge",
      content: { type: "text", text: id },
    })),
    groups: [{ id: "facts", title: "Facts", description: "Facts", entries: ["fact", "second"] }],
    sources: [
      {
        id: "book",
        title: "Book",
        description: "Sources",
        asset: "book",
        format: "markdown",
        sections: [{ id: "chapter", title: "Chapter", anchor: "#Chapter" }],
      },
    ],
    assets: [
      {
        slot: "book",
        role: "context",
        variants: [
          {
            id: "default",
            media_type: "text/markdown",
            blob: { digest: `sha256:${"a".repeat(64)}`, size: 20, availability: "mirrored" },
          },
        ],
      },
    ],
    story: {
      version: 1,
      scenes: [
        {
          id: "hall",
          title: "Hall",
          beats: ["first", "second"],
          choices: ["ask"],
          goals: { alice: "Investigate", bob: "Guard" },
        },
        { id: "cellar", title: "Cellar" },
        { id: "roof", title: "Roof" },
      ],
      beats: ["first", "second", "third", "fourth"].map((id) => ({
        id,
        title: id,
        description: id,
      })),
      choices: [{ id: "ask", label: "Ask", intent: "Ask about the case" }],
      plotlines: [{ id: "case", title: "Case", scenes: ["hall"] }],
      endings: [{ id: "solved", title: "Solved", description: "The case is solved" }],
      starts: [{ id: "arrival", scene: "hall" }],
      vars: { open: { type: "bool", init: false, description: "Door open" } },
      items: [{ id: "key", title: "Key", description: "A key", lore: ["#fact"] }],
      events: [
        { id: "theft", title: "Theft", description: "A theft", kind: "planned", cast: ["alice"] },
      ],
      timelines: [{ id: "past", title: "Past", order: ["scene/hall", "theft"] }],
      knowing: { "#fact": { start: { knows: ["alice"] }, enter: { hall: { knows: ["bob"] } } } },
    },
  };
}
const hall: CompositionAddress = { on: "story", kind: "scene", id: "hall" };
function story(root: CreationInput): Story {
  if (!root.story) throw new Error("story");
  return root.story as Story;
}
function scene(root: CreationInput, id = "hall"): StoryScene {
  const item = story(root).scenes.find((s) => s.id === id);
  if (!item) throw new Error("scene");
  return item;
}
function change(
  base: CreationInput,
  address: CompositionAddress,
  after: unknown,
  op?: "add" | "modify" | "remove",
) {
  const digest = compositionDigest(base, address);
  return {
    ...address,
    op: address.on === "story-order" ? "set" : (op ?? (digest === undefined ? "add" : "modify")),
    ...(digest === undefined ? {} : { base_digest: digest }),
    ...(after === undefined ? {} : { after }),
  };
}
function modify(base: CreationInput, address: CompositionAddress, patch: Record<string, unknown>) {
  return change(base, address, {
    ...(compositionValue(base, address) as Record<string, unknown>),
    ...patch,
  });
}
function merged(base: CreationInput, current: CreationInput, changes: unknown[]) {
  const result = mergeContribution(current, changes, base);
  expect(result.conflicts, JSON.stringify(result)).toEqual([]);
  if (!result.result) throw new Error(JSON.stringify(result));
  expect(checkCreation(result.result.creation).ok).toBe(true);
  return result.result.creation;
}

it("requires a trusted baseline and validates its identity and each supplied object digest", () => {
  const base = fixture(),
    proposal = modify(base, hall, { title: "New hall" });
  expect(() => mergeContribution(base, [proposal])).toThrow(/contribution.base_required/);
  expect(() =>
    mergeContribution(base, [{ ...proposal, base_digest: `sha256:${"0".repeat(64)}` }], base),
  ).toThrow(/contribution.base_mismatch/);
  expect(() => mergeContribution(base, [proposal], { ...base, ref: "@other/mystery" })).toThrow(
    /contribution.base_identity_mismatch/,
  );
});

it("merges independent fields and localized structures atomically, with stable repeated application", () => {
  const base = fixture(),
    current = structuredClone(base);
  scene(current).time = "Midnight";
  const changes = [modify(base, hall, { title: { en: "Entrance", ja: "玄関" } })];
  const result = merged(base, current, changes);
  expect(scene(result)).toMatchObject({ time: "Midnight", title: { en: "Entrance", ja: "玄関" } });
  const replay = mergeContribution(result, changes, base);
  expect(replay.outcomes[0]?.state).toBe("already_applied");
  expect(replay.result?.semantic_digest).toBe(canonicalizeCreation(result).semantic_digest);
  const conflict = structuredClone(base);
  scene(conflict).title = { en: "Hall", ja: "広間" };
  expect(mergeContribution(conflict, changes, base).conflicts[0]?.conflict_fields).toContain(
    "title",
  );
});

it("reports exact scalar and structural condition/effect conflicts without a partial result", () => {
  const base = fixture(),
    current = structuredClone(base);
  scene(current).title = "Owner title";
  scene(current).when = { is: "var/open" };
  const result = mergeContribution(
    current,
    [
      modify(base, hall, { title: "Proposal title", when: { not: { is: "var/open" } } }),
      modify(
        base,
        { on: "story", kind: "beat", id: "first" },
        { description: "Independent change" },
      ),
    ],
    base,
  );
  expect(result.result).toBeNull();
  expect(result.conflicts[0]?.conflict_fields).toEqual(["title", "when"]);
  expect(story(current).beats?.[0]?.description).toBe("first");
});

it("merges reference additions/removals in current order and appends proposal additions", () => {
  const base = fixture(),
    current = structuredClone(base);
  scene(current).beats = ["second", "third"];
  const result = merged(base, current, [
    modify(base, hall, { beats: ["first", "second", "fourth"] }),
  ]);
  expect(scene(result).beats).toEqual(["second", "third", "fourth"]);
});

it("honors one-sided shared-element reorders and conflicts on incompatible two-sided reorders", () => {
  const base = fixture();
  scene(base).beats = ["first", "second", "third"];
  const current = structuredClone(base);
  scene(current).beats = ["first", "second", "third", "fourth"];
  const proposal = modify(base, hall, { beats: ["second", "first", "third"] });
  expect(scene(merged(base, current, [proposal])).beats).toEqual([
    "second",
    "first",
    "third",
    "fourth",
  ]);
  scene(current).beats = ["first", "third", "second"];
  const result = mergeContribution(current, [proposal], base);
  expect(result.result).toBeNull();
  expect(result.conflicts[0]?.conflict_fields).toContain("beats@order");
});

it("does not turn inherited scene cast into an empty reference set", () => {
  const base = fixture(),
    current = structuredClone(base);
  scene(current).cast = ["alice"];
  const result = mergeContribution(current, [modify(base, hall, { cast: ["bob"] })], base);
  expect(result.result).toBeNull();
  expect(result.conflicts[0]?.conflict_fields).toContain("cast");
});

it("merges scene goals per cast key and preserves independent nested knowing collections", () => {
  const base = fixture(),
    current = structuredClone(base);
  scene(current).goals = { alice: "Find proof", bob: "Guard" };
  const knowing = story(current).knowing?.["#fact"];
  if (!knowing) throw new Error("knowing");
  knowing.start.knows = ["alice", "claire"];
  knowing.enter = { hall: { knows: ["bob", "claire"] } };
  const result = merged(base, current, [
    modify(base, hall, { goals: { alice: "Investigate", bob: "Watch the window" } }),
    modify(
      base,
      { on: "story", kind: "knowing", id: "#fact" },
      {
        start: { knows: ["alice", "dave"] },
        enter: { hall: { knows: ["bob", "dave"] }, cellar: { knows: ["alice"] } },
      },
    ),
  ]);
  expect(scene(result).goals).toEqual({ alice: "Find proof", bob: "Watch the window" });
  expect(result.story?.knowing?.["#fact"]).toEqual({
    start: { knows: ["alice", "claire", "dave"] },
    enter: { hall: { knows: ["bob", "claire", "dave"] }, cellar: { knows: ["alice"] } },
  });
});

it("treats wildcard knowledge as an explicit structure and rejects combined knows/not contradictions", () => {
  const base = fixture(),
    current = structuredClone(base);
  const knowing = story(current).knowing?.["#fact"];
  if (!knowing) throw new Error("knowing");
  knowing.start.knows = ["alice", "bob"];
  const result = mergeContribution(
    current,
    [modify(base, { on: "story", kind: "knowing", id: "#fact" }, { start: { knows: "*" } })],
    base,
  );
  expect(result.result).toBeNull();
  expect(result.conflicts[0]?.conflict_fields).toContain("start.knows");
  const contradiction = mergeContribution(
    current,
    [
      modify(
        base,
        { on: "story", kind: "knowing", id: "#fact" },
        { start: { knows: ["alice"], not: ["bob"] } },
      ),
    ],
    base,
  );
  expect(contradiction.result).toBeNull();
  expect(contradiction.conflicts[0]?.reason).toBe("invalid_result");
  expect(contradiction.diagnostics?.length).toBeGreaterThan(0);
});

it("merges cast/group/source by fields while sections and timelines remain structural", () => {
  const base = fixture(),
    current = structuredClone(base);
  const cast = current.cast?.[0],
    group = current.groups?.[0],
    source = current.sources?.[0];
  if (!cast || !group || !source) throw new Error("fixture");
  cast.part = "Investigator";
  group.entries = ["second", "third"];
  source.title = "Owner handbook";
  const result = merged(base, current, [
    modify(base, { on: "cast", key: "alice" }, { goal: "Find the thief" }),
    modify(
      base,
      { on: "group", id: "facts" },
      { entries: ["fact", "second"], description: "Relevant evidence" },
    ),
    modify(base, { on: "source", id: "book" }, { description: "A reliable reference" }),
  ]);
  expect(result.cast?.[0]).toMatchObject({ part: "Investigator", goal: "Find the thief" });
  expect(result.groups?.[0]).toMatchObject({
    entries: ["second", "third"],
    description: "Relevant evidence",
  });
  expect(result.sources?.[0]).toMatchObject({
    title: "Owner handbook",
    description: "A reliable reference",
  });
  source.sections = [{ id: "chapter", title: "Owner chapter", anchor: "#Chapter" }];
  const collision = mergeContribution(
    current,
    [
      modify(
        base,
        { on: "source", id: "book" },
        { sections: [{ id: "chapter", title: "Proposal chapter", anchor: "#Chapter" }] },
      ),
    ],
    base,
  );
  expect(collision.conflicts[0]?.conflict_fields).toContain("sections");
  const timeline = story(current).timelines?.[0];
  if (!timeline) throw new Error("timeline");
  timeline.order = ["theft", "scene/hall"];
  expect(
    mergeContribution(
      current,
      [
        modify(
          base,
          { on: "story", kind: "timeline", id: "past" },
          { order: [["scene/hall", "theft"]] },
        ),
      ],
      base,
    ).conflicts[0]?.conflict_fields,
  ).toContain("order");
});

it("supports choice objects and scene choice membership without replacing the story", () => {
  const base = fixture(),
    current = structuredClone(base);
  scene(current).where = "Lobby";
  const result = merged(base, current, [
    change(
      base,
      { on: "story", kind: "choice", id: "inspect" },
      { id: "inspect", label: "Inspect", intent: "Inspect the door" },
    ),
    modify(base, hall, { choices: ["ask", "inspect"] }),
    change(base, { on: "story-order", list: "choices" }, ["inspect", "ask"]),
  ]);
  expect(scene(result)).toMatchObject({ where: "Lobby", choices: ["ask", "inspect"] });
  expect(result.story?.choices?.map((c) => c.id)).toEqual(["inspect", "ask"]);
});

it("merges story order independently and rejects unmentioned or missing object IDs", () => {
  const base = fixture(),
    current = structuredClone(base);
  story(current).scenes.reverse();
  const result = mergeContribution(
    current,
    [change(base, { on: "story-order", list: "scenes" }, ["cellar", "hall", "roof"])],
    base,
  );
  expect(result.result).toBeNull();
  expect(result.conflicts[0]?.conflict_fields).toContain("@order");
  expect(() =>
    mergeContribution(
      base,
      [change(base, { on: "story-order", list: "scenes" }, ["hall", "cellar"])],
      base,
    ),
  ).toThrow(/order must name/);
  expect(() =>
    mergeContribution(
      base,
      [change(base, { on: "story-order", list: "scenes" }, ["hall", "cellar", "roof", "phantom"])],
      base,
    ),
  ).toThrow(/order must name/);
  expect(
    ChangeSchema.parse({ on: "story-order", list: "scenes", base_digest: digestOf([]), after: [] })
      .op,
  ).toBe("set");
});

it("creates Story v1 from object additions and removes it only when every object is removed", () => {
  const base = fixture();
  delete base.story;
  const added = merged(base, base, [
    change(base, { on: "story", kind: "scene", id: "one" }, { id: "one", title: "One" }),
    change(base, { on: "story-order", list: "scenes" }, ["one"]),
  ]);
  expect(added.story).toEqual({ version: 1, scenes: [{ id: "one", title: "One" }] });
  const remove = change(added, { on: "story", kind: "scene", id: "one" }, undefined, "remove");
  expect(merged(added, added, [remove]).story).toBeUndefined();
  const current = structuredClone(added);
  story(current).beats = [{ id: "new", title: "New", description: "Concurrent addition" }];
  const conflict = mergeContribution(current, [remove], added);
  expect(conflict.result).toBeNull();
  expect(conflict.conflicts[0]?.reason).toBe("invalid_result");
});

it("returns static dangling-reference and type failures as atomic conflicts, including legacy changes", () => {
  const base = fixture();
  const remove = change(base, { on: "story", kind: "scene", id: "hall" }, undefined, "remove");
  const result = mergeContribution(
    base,
    [
      remove,
      modify(
        base,
        { on: "story", kind: "beat", id: "first" },
        { description: "Would otherwise apply" },
      ),
    ],
    base,
  );
  expect(result.result).toBeNull();
  expect(result.conflicts).toHaveLength(2);
  expect(result.conflicts.every((c) => c.reason === "invalid_result")).toBe(true);
  expect(
    result.diagnostics?.some((d) => d.subject.includes("case") || d.subject.includes("arrival")),
  ).toBe(true);
  const fragment = canonicalizeCreation(base).creation.fragments.find((f) => f.id === "fact");
  if (!fragment) throw new Error("fragment");
  const legacy = mergeContribution(base, [
    { on: "fragment", op: "remove", id: "fact", base_digest: fragment.digest },
  ]);
  expect(legacy.result).toBeNull();
  expect(legacy.conflicts[0]?.reason).toBe("invalid_result");
});

it("rejects spoofed object identities, arbitrary payloads and prototype-bearing input", () => {
  const base = fixture();
  expect(() => mergeContribution(base, [modify(base, hall, { id: "cellar" })], base)).toThrow(
    /contribution.invalid_change/,
  );
  expect(() => mergeContribution(base, [modify(base, hall, { invented: "field" })], base)).toThrow(
    /contribution.invalid_change/,
  );
  expect(() =>
    mergeContribution(
      base,
      [
        {
          on: "story",
          kind: "var",
          op: "add",
          id: "__proto__",
          after: { type: "bool", init: true, description: "Bad" },
        },
      ],
      base,
    ),
  ).toThrow(/contribution.invalid_change/);
  const malformed = JSON.parse(
    '{"on":"story","kind":"scene","op":"modify","id":"hall","after":{"id":"hall","title":"Hall","goals":{"__proto__":"bad"}}}',
  );
  expect(() =>
    mergeContribution(base, [{ ...malformed, base_digest: compositionDigest(base, hall) }], base),
  ).toThrow();
});

it("keeps valid constructor/prototype identities safe in keyed story maps", () => {
  const base = fixture();
  base.cast?.push(
    { key: "constructor", who: { late: "character" } },
    { key: "prototype", who: { late: "character" } },
  );
  const current = structuredClone(base);
  scene(current).goals = { ...scene(current).goals, constructor: "Owner goal" };
  const result = merged(base, current, [
    change(
      base,
      { on: "story", kind: "var", id: "constructor" },
      { type: "bool", init: true, description: "A valid variable" },
    ),
    modify(base, hall, { goals: { ...scene(base).goals, prototype: "Missing role" } }),
  ]);
  expect(result.story?.vars?.constructor).toMatchObject({ type: "bool", init: true });
  expect(scene(result).goals).toMatchObject({
    constructor: "Owner goal",
    prototype: "Missing role",
  });
});

it("rebases an order change across current additions and removals without resurrecting deleted objects", () => {
  const base = fixture(),
    current = structuredClone(base);
  story(current).scenes = story(current).scenes.filter((s) => s.id !== "roof");
  story(current).scenes.push({ id: "attic", title: "Attic" });
  const proposal = change(base, { on: "story-order", list: "scenes" }, ["roof", "cellar", "hall"]);
  const result = merged(base, current, [proposal]);
  expect(result.story?.scenes.map((s) => s.id)).toEqual(["cellar", "hall", "attic"]);
  expect(mergeContribution(result, [proposal], base).outcomes[0]?.state).toBe("already_applied");
});

it("rejects dangling local lore, provenance and section links without claiming external closure resolution", () => {
  const base = fixture();
  scene(base).lore = ["#group/facts", "#source/book/chapter"];
  const group = mergeContribution(
    base,
    [change(base, { on: "group", id: "facts" }, undefined, "remove")],
    base,
  );
  expect(group.result).toBeNull();
  expect(group.diagnostics?.some((d) => d.code === "check.local_reference")).toBe(true);
  const section = mergeContribution(
    base,
    [modify(base, { on: "source", id: "book" }, { sections: [] })],
    base,
  );
  expect(section.result).toBeNull();
  expect(section.diagnostics?.some((d) => d.subject.includes("lore"))).toBe(true);
  scene(base).lore = ["@external/archive#group/rooms"];
  expect(
    merged(base, base, [modify(base, hall, { where: "Courtyard" })]).story?.scenes[0]?.where,
  ).toBe("Courtyard");
});

it("normalizes cast override defaults once and treats canonical no-ops consistently", () => {
  const base = fixture();
  const cast = base.cast?.[0];
  if (!cast) throw new Error("cast");
  cast.override = [];
  const address: CompositionAddress = { on: "cast", key: "alice" };
  const canonical = canonicalizeCreation(base).creation;
  expect(compositionDigest(base, address)).toBe(compositionDigest(canonical, address));
  expect(() =>
    mergeContribution(base, [change(base, address, compositionValue(canonical, address))], base),
  ).toThrow(/contribution.noop_change/);
  const result = merged(base, base, [modify(base, address, { goal: "Discover the truth" })]);
  expect(result.cast?.[0]?.override).toBeUndefined();
});

it("preserves an explicit empty knowing audience after independent removals", () => {
  const base = fixture();
  story(base).knowing = { "#fact": { start: { knows: ["alice"], not: ["bob"] } } };
  const current = structuredClone(base);
  story(current).knowing = { "#fact": { start: { not: ["bob"] } } };
  const result = merged(base, current, [
    modify(base, { on: "story", kind: "knowing", id: "#fact" }, { start: { knows: ["alice"] } }),
  ]);
  expect(result.story?.knowing?.["#fact"]?.start).toEqual({ not: [] });
});

it("runs local references through public checkCreation and guards recursive conditions before normalization", () => {
  const base = fixture();
  scene(base).lore = ["#group/missing"];
  expect(
    checkCreation(canonicalizeCreation(base).creation).diagnostics.some(
      (d) => d.code === "check.local_reference",
    ),
  ).toBe(true);
  scene(base).lore = ["@writer/mystery#source/missing"];
  expect(
    checkCreation(canonicalizeCreation(base).creation).diagnostics.some(
      (d) => d.code === "check.local_reference",
    ),
  ).toBe(true);
  let when: unknown = { is: "var/open" };
  for (let i = 0; i < 5000; i++) when = { not: when };
  expect(() =>
    mergeContribution(fixture(), [modify(fixture(), hall, { when })], fixture()),
  ).toThrow(/story.condition_limit/);
});

it("rejects cyclic non-condition payloads before recursive normalization", () => {
  const base = fixture();
  const extra: Record<string, unknown> = {};
  extra.self = extra;
  expect(() => mergeContribution(base, [modify(base, hall, { extra })], base)).toThrow(
    /contribution.invalid_change/,
  );
});
