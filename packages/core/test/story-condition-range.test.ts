import { describe, expect, it } from "vitest";
import { canonicalizeCreation } from "../src/canonical.js";
import { checkCreation } from "../src/check.js";
import type { Story, StoryCondition } from "../src/schema/story.js";
import { checkStory } from "../src/story/check.js";
import { evaluateCondition, initStoryState } from "../src/story/evaluate.js";
import { level0Character } from "./fixtures.js";

type Operator = Extract<StoryCondition, { cmp: unknown }>["cmp"][1];
function story(op: Operator, right: number, min = 0, max = 10): Story {
  return {
    version: 1,
    vars: { trust: { type: "int", min, max, init: min, description: "Trust" } },
    scenes: [{ id: "entry", title: "Entry" }],
    beats: [
      {
        id: "proof",
        title: "Proof",
        description: "A condition to review",
        when: { not: { cmp: ["var/trust", op, right] } },
      },
    ],
  };
}
const warnings = (value: Story) =>
  checkStory(value, ["player"]).filter((entry) => entry.code === "story.condition_constant");

describe("constant integer comparisons", () => {
  it.each<[Operator, number, boolean]>([
    ["=", -1, false],
    ["=", 11, false],
    ["!=", -1, true],
    ["!=", 11, true],
    ["<", 0, false],
    ["<", 11, true],
    ["<=", -1, false],
    ["<=", 10, true],
    [">", -1, true],
    [">", 10, false],
    [">=", 0, true],
    [">=", 11, false],
  ])(
    "warns that x %s %s is always %s, without turning it into a validation error",
    (op, right, constant) => {
      const value = story(op, right);
      expect(warnings(value)).toEqual([
        {
          code: "story.condition_constant",
          subject: "story.beats[proof]/when/not",
          severity: "warning",
          detail: expect.stringContaining(
            `var/trust ${op} ${right} is always ${constant} within its declared range [0, 10]`,
          ),
        },
      ]);
      expect(checkStory(value, ["player"]).filter((entry) => entry.severity === "error")).toEqual(
        [],
      );
      const state = initStoryState(value, ["player"]);
      for (let point = 0; point <= 10; point++)
        expect(
          evaluateCondition(
            value,
            ["player"],
            { ...state, vars: { trust: point } },
            { cmp: ["var/trust", op, right] },
          ),
        ).toBe(constant);
    },
  );

  it.each<[Operator, number]>([
    ["=", 0],
    ["=", 5],
    ["=", 10],
    ["!=", 0],
    ["!=", 5],
    ["!=", 10],
    ["<", 1],
    ["<=", 0],
    [">", 9],
    [">=", 10],
  ])("does not mistake matching endpoint results for a constant: x %s %s", (op, right) => {
    expect(warnings(story(op, right))).toEqual([]);
  });

  it.each<[Operator, boolean]>([
    ["=", true],
    ["!=", false],
    ["<", false],
    ["<=", true],
    [">", false],
    [">=", true],
  ])("handles a singleton domain for %s", (op, result) => {
    expect(warnings(story(op, -2147483648, -2147483648, -2147483648))[0]?.detail).toContain(
      `always ${result}`,
    );
  });

  it("handles extreme integers without incrementing or overflowing the boundary", () => {
    expect(warnings(story("<=", 2147483647, -2147483648, 2147483647))[0]?.detail).toContain(
      "always true",
    );
    expect(warnings(story("<", 2147483647, -2147483648, 2147483647))).toEqual([]);
  });

  it("does not invent a constant warning for an invalid variable declaration", () => {
    expect(warnings(story("=", 0, 10, 0))).toEqual([]);
    const value = story("=", 0);
    value.vars = { trust: { type: "bool", init: false, description: "A boolean" } };
    expect(warnings(value)).toEqual([]);
    expect(checkStory(value, ["player"]).map((entry) => entry.code)).toContain(
      "story.type_mismatch",
    );
  });

  it("surfaces warnings through the author check without rejecting the whole creation", () => {
    const value = level0Character({
      type: "scenario",
      cast: [{ key: "player", who: { late: "persona" }, part: "Visitor" }],
      fragments: [
        {
          id: "premise",
          kind: "scenario",
          stable: true,
          content: { type: "text", text: "A trust exercise." },
        },
      ],
      story: story(">", 10),
    });
    const canonical = canonicalizeCreation(value).creation;
    const checked = checkCreation(canonical);
    expect(checked.diagnostics).toContainEqual(
      expect.objectContaining({ code: "story.condition_constant", severity: "warning" }),
    );
    expect(checked.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
    expect(checked.ok).toBe(true);
  });
});
