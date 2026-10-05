import { describe, expect, it } from "vitest";
import { buildTestCreation } from "../../core/test/build.js";
import { level0Character, tid } from "../../core/test/fixtures.js";
import { createPreparationCatalog, fixedSelection, validateSelectionPlan } from "../src/index.js";
import { profile } from "./fixtures/ir.js";

function fixture() {
  const artifact = buildTestCreation({
    root: {
      creation: level0Character({
        fragments: [
          {
            id: "near",
            stable: true,
            kind: "character",
            description: "Near",
            activation: { mode: "semantic" },
            content: { type: "text", text: "Near body" },
          },
          {
            id: "far",
            stable: true,
            kind: "knowledge",
            description: "Far",
            activation: { mode: "semantic" },
            content: { type: "text", text: "Far body" },
          },
        ],
        groups: [{ id: "more", title: "More", description: "More information", entries: ["far"] }],
      }),
      release: tid("rel", 932),
      visibility: "public",
    },
  }).artifact;
  if (artifact.kind !== "content") throw new Error("Content required");
  const ref = (local: string) => {
    const fragment = artifact.ir.fragments.find((f) => f.origin.fragment === local);
    if (!fragment) throw new Error("Fragment missing");
    return { fragment: fragment.id };
  };
  const build = createPreparationCatalog({
    artifact,
    profile: profile(),
    turn: { bindings: { user: { kind: "persona", display_name: "User" } } },
  });
  return { build, near: ref("near"), far: ref("far") };
}

describe("selection decision consistency", () => {
  it("rejects a selected body whose final explicit decision rejects it", () => {
    const { build, near } = fixture();
    const plan = fixedSelection(build, [near]);
    expect(() =>
      validateSelectionPlan(build, { ...plan, decisions: [{ ref: near, action: "reject" }] }),
    ).toThrowError(expect.objectContaining({ code: "selection.decision_mismatch" }));
    expect(() =>
      validateSelectionPlan(build, {
        ...plan,
        decisions: [...plan.decisions, { ref: near, action: "reject" }],
      }),
    ).toThrowError(expect.objectContaining({ code: "selection.decision_mismatch" }));
    expect(() =>
      validateSelectionPlan(build, {
        ...plan,
        decisions: [{ ref: near, action: "reject" }, ...plan.decisions],
      }),
    ).not.toThrow();
  });

  it("retains selected-only legacy plans and partial expansion decisions", () => {
    const { build, near, far } = fixture();
    const simple = fixedSelection(build, [near]);
    expect(validateSelectionPlan(build, { ...simple, decisions: [] }).selected).toEqual(
      simple.selected,
    );
    const expanded = fixedSelection(build, [near, far]);
    expect(expanded.decisions.some((d) => d.action === "expand")).toBe(true);
    expect(() => validateSelectionPlan(build, { ...expanded, selected: [] })).not.toThrow();
  });

  it("retains preliminary select records when the final result explicitly falls back to skip", () => {
    const { build, near } = fixture();
    const plan = fixedSelection(build, [near]);
    expect(validateSelectionPlan(build, { ...plan, selected: [], fallback: "skip" })).toMatchObject(
      { selected: [], fallback: "skip", decisions: plan.decisions },
    );
  });
});
