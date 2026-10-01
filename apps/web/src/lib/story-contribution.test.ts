import {
  type CreationInput,
  canonicalizeCreation,
  checkCreation,
  compositionDigest,
  mergeContribution,
  type Story,
} from "@char-pub/core";
import { expect, it } from "vitest";
import {
  buildChanges,
  changeAfter,
  contributionBase,
  contributionEditFromWorking,
  contributionWorking,
  describeKey,
  draftValue,
  rawChangeKey,
} from "./contribution";

function creation(): CreationInput {
  return {
    id: "cr_01j00000000000000000000000",
    ref: "@writer/story",
    type: "scenario",
    display_name: "Inn",
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
    cast: [
      { key: "alice", who: { late: "character" }, part: "Host" },
      { key: "bob", who: { late: "persona" } },
    ],
    fragments: [
      {
        id: "clue",
        stable: true,
        kind: "knowledge",
        content: { type: "text", text: "The key opens a hidden room." },
      },
    ],
    groups: [
      {
        id: "rooms",
        title: { en: "Rooms", de: "Zimmer" },
        description: "Inn rooms",
        entries: ["clue"],
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
            blob: { digest: `sha256:${"a".repeat(64)}`, size: 16, availability: "mirrored" },
          },
        ],
      },
    ],
    sources: [
      {
        id: "book",
        title: "Book",
        description: "A visitor's guide",
        asset: "book",
        format: "markdown",
        sections: [{ id: "door", title: "Door", description: "Arrival", anchor: "#Door" }],
        origin: { url: "https://example.test/guide" },
      },
    ],
    story: {
      version: 1,
      scenes: [
        {
          id: "hall",
          title: { en: "Hall", de: "Halle" },
          cast: ["alice", "bob"],
          lore: ["#group/rooms"],
          choices: ["ask"],
        },
        { id: "garden", title: "Garden" },
      ],
      beats: [{ id: "found", title: "Found", description: "The key is found" }],
      choices: [{ id: "ask", label: "Ask", intent: "Ask about the key" }],
      plotlines: [{ id: "search", title: "Search", scenes: ["hall", "garden"] }],
      endings: [{ id: "leave", title: "Leave", description: "Leave the inn" }],
      starts: [{ id: "arrival", scene: "hall" }],
      vars: { ready: { type: "bool", init: false, description: "Ready" } },
      items: [{ id: "key", title: "Key", description: "A small key", lore: ["#clue"] }],
      events: [
        { id: "rain", title: "Rain", kind: "background", description: "Rain fell overnight" },
      ],
      timelines: [{ id: "night", title: "Night", order: ["rain", "scene/hall"] }],
      knowing: { "#clue": { start: { knows: ["alice"], not: ["bob"] } } },
    },
  };
}

it("round-trips all editable objects without changing an immutable canonical base or translations", () => {
  const base = contributionBase(creation());
  expect(checkCreation(base.canonical.creation).ok).toBe(true);
  const original = JSON.stringify(base.canonical);
  const working = contributionWorking(base.canonical, base.edit);
  expect(
    buildChanges(base.canonical, contributionEditFromWorking(base.canonical, working)),
  ).toEqual([]);
  const story = working.story as Story;
  const hall = story.scenes[0];
  if (!hall || typeof hall.title === "string") throw new Error("Expected localized scene");
  hall.title.en = "Changed hall";
  const edit = contributionEditFromWorking(base.canonical, working);
  const returned = contributionWorking(base.canonical, edit);
  expect((returned.story as Story).scenes[0]?.title).toEqual({ en: "Changed hall", de: "Halle" });
  expect(JSON.stringify(base.canonical)).toBe(original);
  expect(buildChanges(base.canonical, edit).map(rawChangeKey)).toEqual(["story:scene:hall"]);
});

it("generates distinct object changes and a complete story order, then merges different fields", () => {
  const base = contributionBase(creation());
  const working = contributionWorking(base.canonical, base.edit);
  const story = working.story as Story;
  const hall = story.scenes[0];
  if (!hall) throw new Error("Expected hall");
  hall.title = { en: "Grand hall", de: "Halle" };
  story.scenes.unshift({ id: "porch", title: "Porch" });
  if (story.choices?.[0]) story.choices[0].intent = "Ask quietly";
  if (story.vars?.ready?.type === "bool") story.vars.ready.init = true;
  story.knowing = { "#clue": { start: { knows: ["alice", "bob"] } } };
  const cast = working.cast as NonNullable<CreationInput["cast"]>;
  if (cast[0]) cast[0].part = "New host role";
  const groups = working.groups as NonNullable<CreationInput["groups"]>;
  if (groups[0]) groups[0].description = "All the rooms";
  const sources = working.sources as NonNullable<CreationInput["sources"]>;
  if (sources[0]) sources[0].description = "The updated guide";
  const changes = buildChanges(
    base.canonical,
    contributionEditFromWorking(base.canonical, working),
  );
  expect(changes.map(rawChangeKey)).toEqual(
    expect.arrayContaining([
      "story:scene:hall",
      "story:scene:porch",
      "story-order:scenes",
      "story:choice:ask",
      "story:var:ready",
      "story:knowing:#clue",
      "cast:alice",
      "group:rooms",
      "source:book",
    ]),
  );
  expect(changes.find((item) => rawChangeKey(item) === "story-order:scenes")).toMatchObject({
    base_digest: compositionDigest(base.canonical.creation, { on: "story-order", list: "scenes" }),
    after: ["porch", "hall", "garden"],
  });
  const current = structuredClone(base.canonical.creation);
  if (current.story?.scenes[0]) current.story.scenes[0].time = "The author changed the time";
  if (current.cast?.[0]) current.cast[0].goal = "The author changed the goal";
  const merged = mergeContribution(current, changes, base.canonical.creation);
  expect(merged.conflicts).toEqual([]);
  expect(merged.result?.creation.story?.scenes.map((scene) => scene.id)).toEqual([
    "porch",
    "hall",
    "garden",
  ]);
  expect(merged.result?.creation.story?.scenes.find((scene) => scene.id === "hall")).toMatchObject({
    title: { en: "Grand hall", de: "Halle" },
    time: "The author changed the time",
  });
  expect(merged.result?.creation.cast?.[0]).toMatchObject({
    part: "New host role",
    goal: "The author changed the goal",
  });
  expect(merged.result?.creation.sources?.[0]?.origin).toEqual({
    url: "https://example.test/guide",
  });
  expect(merged.result && checkCreation(merged.result.creation).ok).toBe(true);
});

it("adds a complete Story through object changes without a whole-story configuration replacement", () => {
  const { story, ...withoutStory } = creation();
  const base = contributionBase(withoutStory);
  const working = contributionWorking(base.canonical, base.edit);
  working.story = story;
  const changes = buildChanges(
    base.canonical,
    contributionEditFromWorking(base.canonical, working),
  );
  expect(changes.map(rawChangeKey)).toContain("story:scene:hall");
  expect(changes.map(rawChangeKey)).toContain("story:choice:ask");
  expect(changes.map(rawChangeKey)).not.toContain("configuration:story");
  const merged = mergeContribution(base.canonical.creation, changes, base.canonical.creation);
  expect(merged.conflicts).toEqual([]);
  expect(merged.result?.creation.story).toEqual(canonicalizeCreation(creation()).creation.story);
});

it("keeps temporary unfinished object text editable but requires static validation before submit", () => {
  const base = contributionBase(creation());
  const working = contributionWorking(base.canonical, base.edit);
  const hall = (working.story as Story).scenes[0];
  if (!hall) throw new Error("Expected hall");
  hall.title = "";
  const edit = contributionEditFromWorking(base.canonical, working);
  expect(() => buildChanges(base.canonical, edit)).not.toThrow();
  expect(() => canonicalizeCreation(contributionWorking(base.canonical, edit))).toThrow();
});

it("makes referenced-object deletion a rejected merge rather than silently dropping the reference", () => {
  const base = contributionBase(creation());
  const working = contributionWorking(base.canonical, base.edit);
  working.groups = [];
  const changes = buildChanges(
    base.canonical,
    contributionEditFromWorking(base.canonical, working),
  );
  expect(changes.map(rawChangeKey)).toEqual(["group:rooms"]);
  // The individual objects remain schema-valid; the merged local reference graph must reject it.
  expect(() => canonicalizeCreation(working)).not.toThrow();
  const merged = mergeContribution(base.canonical.creation, changes, base.canonical.creation);
  expect(merged.result).toBeNull();
  expect(merged.conflicts.length).toBeGreaterThan(0);
});

it("round-trips source assets and cast dependencies through existing edge/full-asset changes", () => {
  const base = contributionBase(creation());
  const working = contributionWorking(base.canonical, base.edit);
  working.references = [
    { id: "world", use: "@writer/world", mode: "default", pin: { follow: "latest" } },
  ];
  const asset = working.assets?.[0];
  if (!asset) throw new Error("Expected asset");
  asset.variants[0] = {
    id: "default",
    media_type: "text/markdown",
    blob: { digest: `sha256:${"b".repeat(64)}`, size: 24, availability: "mirrored" },
  };
  const edit = contributionEditFromWorking(base.canonical, working);
  const changes = buildChanges(base.canonical, edit);
  expect(changes.map(rawChangeKey)).toEqual(["edge:world", "asset:book"]);
  const merged = mergeContribution(base.canonical.creation, changes, base.canonical.creation);
  expect(merged.conflicts).toEqual([]);
  expect(merged.result?.creation.references).toMatchObject(working.references);
  expect(merged.result?.creation.assets[0]?.variants[0]?.blob.digest).toBe(
    `sha256:${"b".repeat(64)}`,
  );
  expect(contributionWorking(base.canonical, edit).sources).toEqual(working.sources);
});

it("reports unsupported fields and non-Story list reorders instead of losing them", () => {
  const base = contributionBase(creation());
  const working = contributionWorking(base.canonical, base.edit);
  expect(() =>
    contributionEditFromWorking(base.canonical, {
      ...working,
      slots: { narrator: { accepts: ["character"] } },
    }),
  ).toThrowError(
    expect.objectContaining({ code: "contribution.unsupported_edit", subject: "slots" }),
  );
  expect(() =>
    contributionEditFromWorking(base.canonical, {
      ...working,
      bootstrap: { greetings: [{ id: "hello", text: "Hi" }] },
    }),
  ).toThrowError(
    expect.objectContaining({ code: "contribution.unsupported_edit", subject: "bootstrap" }),
  );
  const edit = contributionEditFromWorking(base.canonical, {
    ...working,
    cast: [...(base.canonical.creation.cast ?? [])].reverse(),
  });
  expect(() => buildChanges(base.canonical, edit)).toThrowError(
    expect.objectContaining({ code: "contribution.unsupported_order", subject: "cast" }),
  );
});

it("renders object keys, knowing references containing colons, and order values for review", () => {
  const working = creation();
  expect(describeKey("story:scene:hall")).toBe("Scene hall");
  expect(describeKey("story:var:ready")).toBe("Variable ready");
  expect(describeKey("story:knowing:cast:alice#secret")).toBe("Knowledge cast:alice#secret");
  expect(rawChangeKey({ on: "story", kind: "knowing", id: "cast:alice#secret" })).toBe(
    "story:knowing:cast:alice#secret",
  );
  expect(rawChangeKey({ on: "story", kind: "unsupported", id: "x" })).toBeNull();
  expect(rawChangeKey({ on: "story-order", list: "choices" })).toBe("story-order:choices");
  expect(draftValue(working, "story-order:scenes")).toEqual({ value: "hall, garden" });
  expect(draftValue(working, "cast:alice")).toEqual({
    value: JSON.stringify(working.cast?.[0], null, 2),
  });
  expect(draftValue(working, "source:missing")).toBeNull();
  expect(changeAfter({ on: "group", op: "modify", after: working.groups?.[0] })).toEqual({
    value: JSON.stringify(working.groups?.[0], null, 2),
  });
  expect(changeAfter({ on: "story", kind: "var", id: "ready", op: "remove" })).toBeNull();
});
