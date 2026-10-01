/** Object-level author merges use identical pure contracts in Node, browser and workerd. */
import {
  type CompositionAddress,
  type CreationInput,
  canonicalizeCreation,
  compositionDigest,
  compositionValue,
  mergeContribution,
} from "@char-pub/core";
import { expect, it } from "vitest";

function creation(): CreationInput {
  return {
    id: "cr_01j00000000000000000000001",
    ref: "@merge/story",
    type: "scenario",
    display_name: "Case",
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
    cast: ["alice", "bob"].map((key) => ({ key, who: { late: "character" } })),
    fragments: [
      { id: "fact", stable: true, kind: "knowledge", content: { type: "text", text: "A clue" } },
    ],
    groups: [{ id: "facts", title: "Facts", description: "Useful evidence", entries: ["fact"] }],
    story: {
      version: 1,
      scenes: [
        { id: "hall", title: "Hall", beats: ["one", "two", "three"], lore: ["#group/facts"] },
      ],
      beats: ["one", "two", "three", "four"].map((id) => ({ id, title: id, description: id })),
      knowing: { "#fact": { start: { knows: ["alice"] } } },
    },
  };
}
const scene: CompositionAddress = { on: "story", kind: "scene", id: "hall" };
const modify = (
  base: CreationInput,
  address: CompositionAddress,
  patch: Record<string, unknown>,
) => ({
  ...address,
  op: "modify",
  base_digest: compositionDigest(base, address),
  after: { ...(compositionValue(base, address) as Record<string, unknown>), ...patch },
});

it("combines object fields and one-sided reference reordering while preserving the other writer's additions", () => {
  const base = creation(),
    current = structuredClone(base);
  const hall = current.story?.scenes[0];
  if (!hall) throw new Error("scene");
  hall.title = "Owner title";
  hall.beats = ["one", "two", "three", "four"];
  const changes = [
    modify(base, scene, {
      description: "Contribution description",
      beats: ["two", "one", "three"],
    }),
  ];
  const merged = mergeContribution(current, changes, base);
  expect(merged.conflicts).toEqual([]);
  expect(merged.result?.creation.story?.scenes[0]).toMatchObject({
    title: "Owner title",
    description: "Contribution description",
    beats: ["two", "one", "three", "four"],
  });
  if (!merged.result) throw new Error("result");
  const replay = mergeContribution(merged.result.creation, changes, base);
  expect(replay.outcomes[0]?.state).toBe("already_applied");
  expect(replay.result?.semantic_digest).toBe(merged.result.semantic_digest);
});

it("returns field and order conflicts atomically and refuses forged or cross-work baselines", () => {
  const base = creation(),
    current = structuredClone(base);
  const hall = current.story?.scenes[0];
  if (!hall) throw new Error("scene");
  hall.title = "Owner title";
  hall.beats = ["one", "three", "two"];
  const changes = [
    modify(base, scene, { title: "Proposal title", beats: ["two", "one", "three"] }),
  ];
  const merged = mergeContribution(current, changes, base);
  expect(merged.result).toBeNull();
  expect(merged.conflicts[0]?.conflict_fields).toEqual(["title", "beats@order"]);
  expect(() => mergeContribution(current, changes)).toThrow(/contribution.base_required/);
  expect(() =>
    mergeContribution(current, [{ ...changes[0], base_digest: `sha256:${"0".repeat(64)}` }], base),
  ).toThrow(/contribution.base_mismatch/);
  expect(() => mergeContribution(current, changes, { ...base, ref: "@merge/other" })).toThrow(
    /contribution.base_identity_mismatch/,
  );
});

it("rejects dangling local group references and incompatible knowledge after the complete merge", () => {
  const base = creation();
  const group: CompositionAddress = { on: "group", id: "facts" };
  const removed = mergeContribution(
    base,
    [{ ...group, op: "remove", base_digest: compositionDigest(base, group) }],
    base,
  );
  expect(removed.result).toBeNull();
  expect(removed.conflicts[0]?.reason).toBe("invalid_result");
  expect(removed.diagnostics?.some((d) => d.code === "check.local_reference")).toBe(true);
  const current = structuredClone(base);
  if (!current.story?.knowing) throw new Error("knowing");
  current.story.knowing["#fact"] = { start: { knows: ["alice", "bob"] } };
  const knowledge = mergeContribution(
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
  expect(knowledge.result).toBeNull();
  expect(knowledge.conflicts[0]?.reason).toBe("invalid_result");
});

it("creates and removes a complete Story with stable choices and explicit list order", () => {
  const base = creation();
  delete base.story;
  const sceneOrder: CompositionAddress = { on: "story-order", list: "scenes" };
  const choiceOrder: CompositionAddress = { on: "story-order", list: "choices" };
  const added = mergeContribution(
    base,
    [
      {
        on: "story",
        kind: "scene",
        id: "hall",
        op: "add",
        after: { id: "hall", title: "Hall", choices: ["ask"] },
      },
      {
        on: "story",
        kind: "choice",
        id: "ask",
        op: "add",
        after: { id: "ask", label: "Ask", intent: "Ask about the clue" },
      },
      { ...sceneOrder, base_digest: compositionDigest(base, sceneOrder), after: ["hall"] },
      { ...choiceOrder, base_digest: compositionDigest(base, choiceOrder), after: ["ask"] },
    ],
    base,
  );
  expect(added.conflicts).toEqual([]);
  if (!added.result) throw new Error("result");
  const original = added.result.creation;
  const removed = mergeContribution(
    original,
    [
      {
        on: "story",
        kind: "scene",
        id: "hall",
        op: "remove",
        base_digest: compositionDigest(original, { on: "story", kind: "scene", id: "hall" }),
      },
      {
        on: "story",
        kind: "choice",
        id: "ask",
        op: "remove",
        base_digest: compositionDigest(original, { on: "story", kind: "choice", id: "ask" }),
      },
      { ...sceneOrder, base_digest: compositionDigest(original, sceneOrder), after: [] },
      { ...choiceOrder, base_digest: compositionDigest(original, choiceOrder), after: [] },
    ],
    original,
  );
  expect(removed.result?.creation.story).toBeUndefined();
  expect(removed.conflicts).toEqual([]);
  expect(removed.result?.semantic_digest).toBe(canonicalizeCreation(base).semantic_digest);
});
