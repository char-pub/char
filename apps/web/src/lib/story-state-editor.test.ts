import type { Story } from "@char-pub/core";
import { expect, it } from "vitest";
import type { Working } from "./draft";
import {
  knowledgeRemovalReferences,
  stateInformationRestoreError,
  variableOfType,
} from "./story-state-editor";

it("blocks local information lost after removal while allowing an unchanged pre-existing error", () => {
  const baseline: Working = {
    fragments: [
      { id: "fact", stable: true, kind: "knowledge", content: { type: "text", text: "Fact" } },
    ],
    story: {
      version: 1,
      scenes: [{ id: "hall", title: "Hall" }],
      items: [{ id: "letter", title: "Letter", description: "", lore: ["#fact"] }],
    },
  };
  const before = {
    ...baseline,
    fragments: [],
    story: { version: 1, scenes: [{ id: "hall", title: "Hall" }] },
  };
  const after = { ...before, story: baseline.story };
  expect(stateInformationRestoreError(before, after, baseline)).toContain(
    "missing local information",
  );
  expect(stateInformationRestoreError(before, after, after)).toBeNull();
  expect(
    stateInformationRestoreError(
      before,
      { ...after, fragments: baseline.fragments ?? [] },
      baseline,
    ),
  ).toBeNull();
});
it("supports actual local group/source/section aliases for item lore and rejects missing cast keys", () => {
  const baseline = {
    groups: [{ id: "facts" }],
    sources: [{ id: "guide", sections: [{ id: "intro" }] }],
    cast: [{ key: "alice" }],
    story: {
      version: 1,
      scenes: [{ id: "hall", title: "Hall" }],
      items: [
        {
          id: "letter",
          title: "Letter",
          description: "",
          lore: ["#group/facts", "#source/guide/intro", "cast:alice#fact"],
        },
      ],
    },
  };
  const before = {
    ...baseline,
    cast: [],
    story: { version: 1, scenes: [{ id: "hall", title: "Hall" }] },
  };
  expect(
    stateInformationRestoreError(before, { ...before, story: baseline.story }, baseline),
  ).toContain("missing cast member");
  expect(stateInformationRestoreError(before, baseline, baseline)).toBeNull();
});
it("refuses to assume an external closure after its exact dependency changed", () => {
  const edge = {
    id: "world",
    use: "@test/world",
    mode: "default" as const,
    pin: { release: "rel_01j00000000000000000000000", semantic_digest: `sha256:${"0".repeat(64)}` },
  };
  const baseline: Working = {
    references: [edge],
    story: {
      version: 1,
      scenes: [{ id: "hall", title: "Hall" }],
      knowing: { "@test/world#fact": { start: { knows: [] } } },
    },
  };
  const before = {
    ...baseline,
    references: [],
    story: { version: 1, scenes: [{ id: "hall", title: "Hall" }] },
  };
  expect(
    stateInformationRestoreError(before, { ...before, story: baseline.story }, baseline),
  ).toContain("Dependencies changed");
  expect(
    stateInformationRestoreError({ ...before, references: [edge] }, baseline, baseline),
  ).toBeNull();
});
it("keeps self fixture knowledge controlled while foreign fixtures do not block removal", () => {
  const after: Story = { version: 1, scenes: [{ id: "hall", title: "Hall" }] };
  const w = {
    assembly_tests: [
      { root: "self", session: { story: { knowing: { "#fact": [] } } } },
      { root: { ref: "@test/foreign" }, session: { story: { knowing: { "#fact": [] } } } },
    ],
  };
  expect(knowledgeRemovalReferences(w, "#fact", after)).toEqual([
    "assembly_tests[0].session.story.knowing.#fact",
  ]);
  after.beats = [
    {
      id: "learn",
      title: "Learn",
      description: "Learn",
      effects: [{ learn: { who: "*", info: "#fact" } }],
    },
  ];
  expect(knowledgeRemovalReferences(w, "#fact", after)).toEqual([]);
});
it("drops only old variable type fields during an explicit type switch", () => {
  expect(
    variableOfType("bool", {
      type: "int",
      min: 0,
      max: 5,
      init: 2,
      description: { en: "Count", ja: "数" },
    }),
  ).toEqual({ type: "bool", init: false, description: { en: "Count", ja: "数" } });
});
