import { describe, expect, it } from "vitest";
import { canonicalizeCreation } from "../src/canonical.js";
import { checkCreation } from "../src/check.js";
import type { CreationInput } from "../src/schema/creation.js";
import type { Story } from "../src/schema/story.js";
import { checkStory } from "../src/story/check.js";
import { confirm, evaluateCondition, initStoryState } from "../src/story/evaluate.js";
import { tid } from "./fixtures.js";

function example(): Story {
  return {
    version: 1,
    scenes: [{ id: "hall", title: "Hall", beats: ["confession"] }],
    beats: [{ id: "confession", title: "Confession", description: "The truth emerges" }],
    endings: [
      {
        id: "together",
        title: "Leave together",
        description: "The companions leave",
        when: { all: [{ reached: "beat/confess" }] },
      },
    ],
    vars: {
      trust: { type: "bool", init: false, description: "Trust established" },
      score: { type: "int", init: 1, min: 0, max: 10, description: "Evidence score" },
      mood: { type: "enum", values: ["calm", "tense"], init: "calm", description: "Mood" },
      inventory: { type: "set", of: "item", init: [], description: "Inventory" },
    },
    items: [{ id: "letter", title: "Letter", description: "A sealed letter" }],
  };
}
function definition(story: Story): CreationInput {
  return {
    id: tid("cr", 840),
    ref: "@author/diagnostic",
    type: "scenario",
    display_name: "Diagnostic",
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
    cast: [{ key: "player", who: { late: "persona" } }],
    story,
  };
}
function ending(story: Story) {
  const value = story.endings?.[0];
  if (!value) throw new Error("ending required");
  return value;
}
const errors = (story: Story) =>
  checkStory(story, ["player"]).filter((d) => d.severity === "error");

describe("author-readable Story repair guidance", () => {
  it("keeps the published code and condition path and offers an existing repair that works", () => {
    const story = example();
    const original = JSON.stringify(story);
    const checked = checkCreation(canonicalizeCreation(definition(story)).creation);
    const diagnostic = checked.diagnostics.find(
      (d) => d.subject === "story.endings[together]/when/all/0",
    );
    expect(diagnostic).toMatchObject({ code: "story.invalid_reference", severity: "error" });
    expect(diagnostic?.detail).toContain("Choose an existing beat: 'confession'");
    expect(JSON.stringify(story)).toBe(original);
    ending(story).when = { all: [{ reached: "beat/confession" }] };
    expect(checkCreation(canonicalizeCreation(definition(story)).creation).ok).toBe(true);
    const initial = initStoryState(story, ["player"]);
    const reached = confirm(story, ["player"], initial, "beat/confession");
    expect(confirm(story, ["player"], reached, "ending/together").stopped).toBe(true);
  });

  it("suggests an actually declared compatible variable without changing the author's variable type", () => {
    const story = example();
    ending(story).when = { not: { cmp: ["var/trust", ">=", 2] } };
    const diagnostics = errors(story);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: "story.type_mismatch",
      subject: "story.endings[together]/when/not",
    });
    expect(diagnostics[0]?.detail).toContain("it is bool");
    expect(diagnostics[0]?.detail).toContain("Choose a declared int variable: 'var/score'");
    expect(diagnostics[0]?.detail).toContain("use 'is'");
    ending(story).when = { not: { cmp: ["var/score", ">=", 2] } };
    expect(errors(story)).toEqual([]);
    expect(story.vars?.trust?.type).toBe("bool");
    const state = initStoryState(story, ["player"]);
    expect(evaluateCondition(story, ["player"], state, { cmp: ["var/score", ">=", 2] })).toBe(
      false,
    );
  });

  it("provides declared enum/item/range repairs for effects and preserves their exact operation paths", () => {
    const story = example();
    delete ending(story).when;
    ending(story).effects = [
      { set: ["var/mood", "missing"] },
      { put: ["var/inventory", "item/missing"] },
      { set: ["var/score", 20] },
    ];
    const diagnostics = errors(story);
    expect(diagnostics.map((d) => d.subject)).toEqual([
      "story.endings[together]/effects/0",
      "story.endings[together]/effects/1",
      "story.endings[together]/effects/2",
    ]);
    expect(diagnostics[0]?.detail).toContain("'calm', 'tense'");
    expect(diagnostics[1]?.detail).toContain("'letter'");
    expect(diagnostics[2]?.detail).toContain("integer from 0 to 10");
    ending(story).effects = [
      { set: ["var/mood", "tense"] },
      { put: ["var/inventory", "item/letter"] },
      { set: ["var/score", 10] },
    ];
    expect(errors(story)).toEqual([]);
    const final = confirm(story, ["player"], initStoryState(story, ["player"]), "ending/together");
    expect(final.vars).toEqual({ trust: false, score: 10, mood: "tense", inventory: ["letter"] });
  });

  it("explains creating an absent target or typed declaration without inventing IDs", () => {
    const story = example();
    story.beats = [];
    const scene = story.scenes[0];
    if (!scene) throw new Error("scene required");
    delete scene.beats;
    expect(errors(story)[0]?.detail).toContain("Create the intended beat first");
    ending(story).when = { is: "var/ready" };
    delete story.vars;
    const diagnostic = errors(story)[0];
    expect(diagnostic?.code).toBe("story.type_mismatch");
    expect(diagnostic?.detail).toContain("it is not declared");
    expect(diagnostic?.detail).toContain("Declare a bool variable with its initial value");
    story.vars = { ready: { type: "bool", init: true, description: "Ready" } };
    expect(errors(story)).toEqual([]);
  });

  it("identifies a knowledge entry and explains its contradiction without choosing who knows for the author", () => {
    const story = example();
    delete ending(story).when;
    story.knowing = { "#fact": { start: { knows: ["player"], not: ["player"] } } };
    const diagnostic = errors(story)[0];
    expect(diagnostic?.subject).toBe("story.knowing[#fact]");
    expect(diagnostic?.detail).toContain("Choose one initial state");
    expect(story.knowing["#fact"]?.start).toEqual({ knows: ["player"], not: ["player"] });
    story.knowing["#fact"] = { start: { knows: ["player"] } };
    expect(errors(story)).toEqual([]);
    expect(initStoryState(story, ["player"]).knowing["#fact"]).toEqual(["player"]);
  });

  it("does not guess a title locale and bounds declared suggestions while keeping stable object paths", () => {
    const story = example();
    ending(story).title = { ja: "一緒に帰る", en: "Leave together" };
    story.beats = ["h", "g", "f", "e", "d", "c", "b", "a"].map((id) => ({
      id,
      title: id,
      description: id,
    }));
    const diagnostic = errors(story).find((d) => d.subject.endsWith("/when/all/0"));
    expect(diagnostic?.subject).toBe("story.endings[together]/when/all/0");
    expect(diagnostic?.detail).not.toContain("Leave together");
    expect(diagnostic?.detail).not.toContain("一緒に帰る");
    expect(diagnostic?.detail).toContain("'a', 'b', 'c', 'd', 'e', …");
    expect(diagnostic?.detail).not.toContain("'h'");
    ending(story).title = { en: "Leave together", ja: "一緒に帰る" };
    expect(errors(story).find((d) => d.subject.endsWith("/when/all/0"))).toEqual(diagnostic);
  });
});
