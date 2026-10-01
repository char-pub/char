import { describe, expect, it } from "vitest";
import { canonicalizeCreation } from "../src/canonical.js";
import { checkCreation } from "../src/check.js";
import {
  checkLocalContentReferences,
  type LocalContentReferencesInput,
} from "../src/content-check.js";
import type { StoryCondition } from "../src/schema/story.js";
import { level0Character } from "./fixtures.js";

describe("local references in unfinished authoring input", () => {
  it("rejects a new Scene's missing lore despite an unrelated unfinished Beat description", () => {
    const working = {
      ...level0Character({ type: "scenario", fragments: [], assets: [], bootstrap: undefined }),
      cast: [{ key: "player", who: { late: "persona" } }],
      story: {
        version: 1,
        scenes: [{ id: "hall", title: "Hall" }],
        beats: [{ id: "unfinished", title: "Untitled" }],
      },
    };
    expect(() => canonicalizeCreation(working)).toThrowError(
      expect.objectContaining({ code: "schema.invalid" }),
    );
    expect(checkLocalContentReferences(working)).toEqual([]);
    const next = {
      ...working,
      story: {
        ...working.story,
        scenes: [...working.story.scenes, { id: "new", title: "New", lore: ["#missing"] }],
      },
    };
    expect(checkLocalContentReferences(next)).toEqual([
      {
        code: "check.local_reference",
        subject: "story.scenes[new].lore",
        severity: "error",
        detail: "Unknown or ambiguous local content reference '#missing'",
      },
    ]);
  });
  it("checks only real reference-bearing fields without inventing body/title/description/digests", () => {
    const input: LocalContentReferencesInput = {
      ref: "@test/work",
      fragments: [{ id: "fact", source: { use: "#source/book/intro" } }],
      cast: [{ key: "player" }],
      groups: [{ id: "places" }],
      sources: [{ id: "book", sections: [{ id: "intro" }] }],
      story: {
        scenes: [
          {
            id: "hall",
            place: "@test/work#fact",
            lore: ["#group/places", "#book/intro"],
            when: { knows: { who: "player", info: "#fact" } },
          },
        ],
        knowing: { "#fact": undefined },
        starts: [{ id: "start", set: [{ learn: { who: "player", info: "#fact" } }] }],
      },
    };
    const copy = structuredClone(input);
    expect(checkLocalContentReferences(input)).toEqual([]);
    expect(input).toEqual(copy);
  });
  it("still rejects ambiguous local aliases and undeclared cast while deferring actual external closure", () => {
    const input: LocalContentReferencesInput = {
      fragments: [{ id: "same" }],
      groups: [{ id: "same" }],
      story: {
        scenes: [{ id: "hall", lore: ["#same", "cast:missing#fact", "@external/work#fact"] }],
      },
    };
    expect(checkLocalContentReferences(input).map((d) => d.detail)).toEqual([
      "Unknown or ambiguous local content reference '#same'",
      "Unknown or ambiguous local content reference 'cast:missing#fact'",
    ]);
  });
  it("reports each occurrence of shared condition objects in author order without recursive traversal", () => {
    const shared: StoryCondition = { knows: { who: "player", info: "#missing" } };
    const input: LocalContentReferencesInput = {
      cast: [{ key: "player" }],
      story: {
        scenes: [{ id: "hall", when: { all: [shared, { not: shared }] } }],
        beats: [{ id: "reward", effects: [{ learn: { who: "player", info: "#secret" } }] }],
      },
    };
    expect(checkLocalContentReferences(input).map((d) => d.subject)).toEqual([
      "story.scenes[hall].when.all[0].knows.info",
      "story.scenes[hall].when.all[1].not.knows.info",
      "story.beats[reward].effects[0].learn",
    ]);
    let deep: StoryCondition = shared;
    for (let i = 0; i < 4000; i++) deep = { not: deep };
    expect(
      checkLocalContentReferences({ story: { scenes: [{ id: "hall", when: deep }] } }),
    ).toHaveLength(1);
  });
  it("retains a condition child’s actual array index when earlier draft entries are unfinished", () => {
    const input = JSON.parse(
      '{"story":{"scenes":[{"id":"hall","when":{"all":[null,{"knows":{"who":"player","info":"#missing"}}]}}]}}',
    );
    expect(checkLocalContentReferences(input).map((diagnostic) => diagnostic.subject)).toEqual([
      "story.scenes[hall].when.all[1].knows.info",
    ]);
  });

  it("is compatible with canonical callers and does not weaken their ordinary validation", () => {
    const canonical = canonicalizeCreation(
      level0Character({
        fragments: [
          {
            id: "description",
            kind: "character",
            stable: true,
            content: { type: "text", text: "A courier" },
            about: ["#missing"],
          },
        ],
      }),
    ).creation;
    const errors = checkLocalContentReferences(canonical);
    expect(errors).toHaveLength(1);
    expect(checkCreation(canonical).diagnostics).toEqual(expect.arrayContaining(errors));
    expect(checkCreation(canonical).ok).toBe(false);
  });
});
