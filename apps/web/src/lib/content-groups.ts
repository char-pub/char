/** Group navigation and immutable authoring operations; Core owns structural validation. */
import { type ContentGroup, type CreationType, checkContentCollections } from "@char-pub/core";
import type { Working } from "./draft";

export function groupsOf(working: Working): ContentGroup[] {
  return (working.groups as ContentGroup[] | undefined) ?? [];
}
export function ungroupedEntries(working: Working): string[] {
  const grouped = new Set(groupsOf(working).flatMap((group) => group.entries ?? []));
  return (working.fragments ?? [])
    .filter((fragment) => !grouped.has(fragment.id))
    .map((fragment) => fragment.id);
}
export interface GroupTreeRow {
  id: string;
  depth: number;
  repeated: boolean;
  issue?: string;
}
/** Shared children are links after their first expansion. Invalid imported graphs remain repairable. */
export function groupTree(working: Working): GroupTreeRow[] {
  const groups = groupsOf(working);
  const byId = new Map(groups.map((group) => [group.id, group]));
  const nested = new Set(groups.flatMap((group) => group.groups ?? []));
  const expanded = new Set<string>();
  const rows: GroupTreeRow[] = [];
  const visit = (id: string, path: string[]) => {
    const group = byId.get(id);
    const issue = !group
      ? "Missing group"
      : path.includes(id)
        ? "Circular reference"
        : path.length >= 3
          ? "More than three levels"
          : undefined;
    const repeated = expanded.has(id);
    rows.push({ id, depth: path.length, repeated, ...(issue ? { issue } : {}) });
    if (!group || issue || repeated) return;
    expanded.add(id);
    for (const child of group.groups ?? []) visit(child, [...path, id]);
  };
  for (const group of groups) if (!nested.has(group.id)) visit(group.id, []);
  // Cycles can have no root. Do not hide them from the author.
  for (const group of groups) if (!expanded.has(group.id)) visit(group.id, []);
  return rows;
}
function structureErrors(working: Working) {
  // Validate only the collection facts this workspace edits; unrelated unfinished prose stays editable.
  return checkContentCollections({
    type: working.type as CreationType,
    fragments: (working.fragments ?? []).map(({ id }) => ({ id })),
    groups: groupsOf(working),
    assets: working.assets ?? [],
  }).filter(
    (issue) =>
      issue.severity === "error" &&
      (issue.code.startsWith("check.group_") || issue.code === "check.duplicate_group"),
  );
}
/** Only new group-structure failures block an association; existing unrelated diagnostics stay visible. */
export function groupStructureError(before: Working, after: Working): string | null {
  try {
    const known = new Set(structureErrors(before).map((issue) => JSON.stringify(issue)));
    const added = structureErrors(after).filter((issue) => !known.has(JSON.stringify(issue)));
    return added.length ? added.map((issue) => issue.detail ?? issue.code).join("; ") : null;
  } catch {
    return "Repair the existing group structure before nesting groups. Entries are unchanged.";
  }
}
export function withNestedGroup(
  working: Working,
  parent: string,
  child: string,
  included: boolean,
): Working {
  return {
    ...working,
    groups: groupsOf(working).map((group) =>
      group.id !== parent
        ? group
        : {
            ...group,
            groups: included
              ? [...new Set([...(group.groups ?? []), child])]
              : (group.groups ?? []).filter((id) => id !== child),
          },
    ),
  };
}
export function groupRestoreError(
  working: Working,
  group: ContentGroup,
  index: number,
): string | null {
  if (groupsOf(working).some((current) => current.id === group.id))
    return "A new group already uses this ID. Undo cannot replace it.";
  const fragments = new Set((working.fragments ?? []).map((fragment) => fragment.id));
  const groups = new Set(groupsOf(working).map((current) => current.id));
  const missing = [
    ...(group.entries ?? []).filter((id) => !fragments.has(id)).map((id) => `entry ${id}`),
    ...(group.groups ?? []).filter((id) => !groups.has(id)).map((id) => `group ${id}`),
  ];
  if (missing.length)
    return `Restore the missing ${missing.join(", ")} before undoing this group removal.`;
  return groupStructureError(working, restoreGroup(working, group, index));
}
export function restoreGroup(working: Working, group: ContentGroup, index: number): Working {
  const groups = [...groupsOf(working)];
  groups.splice(Math.min(index, groups.length), 0, group);
  return { ...working, groups };
}
