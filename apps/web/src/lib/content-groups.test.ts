import { canonicalizeCreation, checkContentCollections, checkCreation } from "@char-pub/core";
import { expect, it } from "vitest";
import { buildTestCreation } from "@/test/build";
import {
  groupRestoreError,
  groupStructureError,
  groupsOf,
  groupTree,
  restoreGroup,
  ungroupedEntries,
  withNestedGroup,
} from "./content-groups";
import type { Working } from "./draft";

const working: Working = {
  id: "cr_01j00000000000000000000001",
  ref: "@writer/archive",
  type: "lorebook",
  display_name: "Archive",
  meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
  fragments: ["door", "case", "loose"].map((id) => ({
    id,
    kind: "knowledge",
    stable: true,
    content: { type: "text", text: `${id} body` },
  })),
  groups: [
    { id: "building", title: "Building", description: "Building facts", entries: ["door"] },
    { id: "history", title: "History", description: "Old events", groups: ["case"] },
    { id: "rumors", title: "Rumors", description: "Possible explanations", groups: ["case"] },
    { id: "case", title: "Case", description: "The case", entries: ["case", "door"] },
  ],
};

it("builds one copy of each fragment while entries have multiple group memberships", () => {
  const creation = canonicalizeCreation(working).creation;
  expect(checkCreation(creation).ok).toBe(true);
  const artifact = buildTestCreation({
    root: { creation, release: "rel_01j00000000000000000000001", visibility: "public" },
  }).artifact;
  if (artifact.kind !== "content") throw new Error("content required");
  expect(artifact.ir.fragments).toHaveLength(3);
  const door = artifact.ir.fragments.find((f) => f.origin.fragment === "door")?.id;
  expect(artifact.catalog_index.groups.find((g) => g.local_id === "building")?.entries).toContain(
    door,
  );
  expect(artifact.catalog_index.groups.find((g) => g.local_id === "case")?.entries).toContain(door);
  expect(ungroupedEntries(working)).toEqual(["loose"]);
  expect(
    groupTree(working)
      .filter((row) => row.id === "case")
      .map((row) => row.repeated),
  ).toEqual([false, true]);
});

it("uses Core constraints to prevent cycles and a fourth group level without requiring completed prose", () => {
  const incomplete: Working = {
    ...working,
    display_name: "",
    groups: ["a", "b", "c", "d"].map((id, i) => ({
      id,
      title: "",
      description: "",
      ...(i < 2 ? { groups: [String.fromCharCode(id.charCodeAt(0) + 1)] } : {}),
    })),
  };
  expect(groupStructureError(incomplete, withNestedGroup(incomplete, "c", "d", true))).toContain(
    "three group levels",
  );
  expect(groupStructureError(incomplete, withNestedGroup(incomplete, "c", "a", true))).toContain(
    "Group cycle",
  );
  expect(groupStructureError(incomplete, withNestedGroup(incomplete, "d", "b", true))).toBeNull();
  const diagnostics = checkContentCollections({
    type: "lorebook",
    fragments: [{ id: "door" }],
    assets: [],
    groups: groupsOf(incomplete),
  });
  expect(diagnostics.some((d) => d.code === "check.description_length")).toBe(true);
  expect(diagnostics.some((d) => d.code === "check.group_depth")).toBe(false);
});

it("exposes invalid imported cycles for repair instead of looping or hiding all groups", () => {
  const invalid = {
    ...working,
    groups: [
      { id: "a", title: "A", description: "A", groups: ["b"] },
      { id: "b", title: "B", description: "B", groups: ["a"] },
    ],
  };
  expect(groupTree(invalid).some((row) => row.issue === "Circular reference")).toBe(true);
  expect(
    groupTree(invalid)
      .filter((row) => !row.repeated)
      .map((row) => row.id),
  ).toEqual(["a", "b"]);
});

it("restores only the deleted group and rejects missing targets or reused identity", () => {
  const group = groupsOf(working)[0];
  if (!group) throw new Error("group required");
  const after = {
    ...working,
    groups: groupsOf(working).filter((g) => g.id !== group.id),
    summary: "A later edit",
  };
  expect(groupRestoreError(after, group, 0)).toBeNull();
  expect(restoreGroup(after, group, 0).summary).toBe("A later edit");
  expect(groupRestoreError(working, group, 0)).toContain("new group already uses");
  expect(groupRestoreError({ ...after, fragments: [] }, group, 0)).toContain("entry door");
});
