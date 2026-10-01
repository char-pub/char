/** Small authoring operations; Core remains the authority for Story state and build validation. */
import {
  type AssemblyFixture,
  controlledInformation,
  type Story,
  type StoryVariable,
} from "@char-pub/core";
import type { Working } from "./draft";

export function variableOfType(
  type: StoryVariable["type"],
  previous?: StoryVariable,
): StoryVariable {
  const {
    type: _type,
    init: _init,
    min: _min,
    max: _max,
    of: _of,
    values: _values,
    ...retained
  } = (previous ?? { description: "" }) as Record<string, unknown>;
  const description = previous?.description ?? "";
  const common = { ...retained, description };
  switch (type) {
    case "bool":
      return { ...common, type, init: false };
    case "int":
      return { ...common, type, init: 0, min: 0, max: 100 };
    case "enum":
      return { ...common, type, init: "value", values: ["value"] };
    case "set":
      return { ...common, type, init: [], of: "item" };
  }
}

/** An authored fixture keeps a reference to controlled information, even without a knows condition. */
export function knowledgeRemovalReferences(w: Working, ref: string, after: Story): string[] {
  if (controlledInformation(after).has(ref)) return [];
  const found: string[] = [];
  if (Array.isArray(w.assembly_tests))
    (w.assembly_tests as AssemblyFixture[]).forEach((fixture, i) => {
      if (fixture?.root === "self" && Object.hasOwn(fixture.session?.story?.knowing ?? {}, ref))
        found.push(`assembly_tests[${i}].session.story.knowing.${ref}`);
    });
  return found;
}

/** Undo checks locally visible targets; changed external dependencies require an explicit rebuild. */
export function stateInformationRestoreError(
  before: Working,
  after: Working,
  baseline: Working,
): string | null {
  const references = (w: Working) => {
    const story = w.story as Story | undefined;
    return [
      ...Object.keys(story?.knowing ?? {}).map((ref) => ({
        ref,
        kind: "fragment" as const,
        at: `knowing.${ref}`,
      })),
      ...(story?.items ?? []).flatMap((item) =>
        (item.lore ?? []).map((ref) => ({
          ref,
          kind: "content" as const,
          at: `items.${item.id}.lore.${ref}`,
        })),
      ),
    ];
  };
  const localErrors = (w: Working) => {
    const groups = (w.groups as { id: string }[] | undefined) ?? [];
    const sources = (w.sources as { id: string; sections?: { id: string }[] }[] | undefined) ?? [];
    const cast = (w.cast as { key: string }[] | undefined) ?? [];
    return references(w).flatMap(({ ref, kind, at }) => {
      if (
        ref.startsWith("cast:") &&
        !cast.some((person) => person.key === ref.slice(5).split("#")[0])
      )
        return [`${at}: missing cast member`];
      if (!ref.startsWith("#")) return [];
      const name = ref.slice(1);
      let matches = (w.fragments ?? []).filter((fragment) => fragment.id === name).length;
      if (kind === "content") {
        matches += groups.filter(
          (group) => group.id === name || `group/${group.id}` === name,
        ).length;
        for (const source of sources) {
          const local = name.startsWith("source/") ? name.slice(7) : name;
          if (local === source.id) matches++;
          else
            matches += (source.sections ?? []).filter(
              (section) => local === `${source.id}/${section.id}`,
            ).length;
        }
      }
      return matches === 1 ? [] : [`${at}: ${matches ? "ambiguous" : "missing"} local information`];
    });
  };
  const known = new Set([...localErrors(before), ...localErrors(baseline)]);
  const added = localErrors(after).filter((error) => !known.has(error));
  if (added.length) return `Cannot restore yet: ${added.join("; ")}`;
  const oldRefs = new Set(references(before).map((entry) => `${entry.at}:${entry.ref}`));
  const externalRestored = references(after).some(
    (entry) => !entry.ref.startsWith("#") && !oldRefs.has(`${entry.at}:${entry.ref}`),
  );
  if (
    externalRestored &&
    (baseline.references ?? []).some(
      (previous) =>
        !(before.references ?? []).some(
          (current) => JSON.stringify(current) === JSON.stringify(previous),
        ),
    )
  )
    return "Dependencies changed. Restore their previous versions before undoing this reference, or add it again and build to verify it.";
  return null;
}
