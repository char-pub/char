/** Inbound authored references only: prose and foreign fixture instances are not links. */
import type {
  AssemblyFixture,
  ContentGroup,
  KnowledgeSource,
  Story,
  StoryCondition,
  StoryEffect,
} from "@char-pub/core";
import type { Working } from "./draft";

export type ContentObjectKind = "fragment" | "group" | "source" | "section";
export function contentReferences(
  w: Working,
  kind: ContentObjectKind,
  id: string,
  sectionId?: string,
): string[] {
  const found = new Set<string>();
  const source = ((w.sources ?? []) as KnowledgeSource[]).find((s) => s.id === id);
  const names =
    kind === "fragment"
      ? [id]
      : kind === "group"
        ? [id, `group/${id}`]
        : kind === "section"
          ? [`${id}/${sectionId}`, `source/${id}/${sectionId}`]
          : [
              id,
              `source/${id}`,
              ...(source?.sections ?? []).flatMap((s) => [`${id}/${s.id}`, `source/${id}/${s.id}`]),
            ];
  const matches = (value: string, allowed: "fragment" | "source" | "content") => {
    if (allowed === "fragment" && kind !== "fragment") return false;
    if (allowed === "source" && kind !== "source" && kind !== "section") return false;
    return names.some(
      (name) => value === `#${name}` || (typeof w.ref === "string" && value === `${w.ref}#${name}`),
    );
  };
  const ref = (
    value: string | undefined,
    path: string,
    allowed: "fragment" | "source" | "content" = "content",
  ) => {
    if (value && matches(value, allowed)) found.add(path);
  };
  for (const group of (w.groups ?? []) as ContentGroup[]) {
    if (kind === "fragment" && group.entries?.includes(id))
      found.add(`groups[${group.id}].entries`);
    if (kind === "group" && group.groups?.includes(id)) found.add(`groups[${group.id}].groups`);
  }
  for (const f of w.fragments ?? []) {
    f.about?.forEach((r, i) => {
      ref(r, `fragments[${f.id}].about[${i}]`, "fragment");
    });
    ref(f.source?.use, `fragments[${f.id}].source.use`, "source");
  }
  const condition = (c: StoryCondition | undefined, path: string): void => {
    if (!c) return;
    if ("all" in c)
      c.all.forEach((v, i) => {
        condition(v, `${path}.all[${i}]`);
      });
    else if ("any" in c)
      c.any.forEach((v, i) => {
        condition(v, `${path}.any[${i}]`);
      });
    else if ("not" in c) condition(c.not, `${path}.not`);
    else if ("knows" in c) ref(c.knows.info, `${path}.knows.info`, "fragment");
  };
  const effects = (es: StoryEffect[] | undefined, path: string) =>
    es?.forEach((e, i) => {
      if ("learn" in e) ref(e.learn.info, `${path}[${i}].learn.info`, "fragment");
    });
  const story = w.story as Story | undefined;
  for (const collection of ["scenes", "beats", "endings", "choices", "events", "items"] as const)
    for (const item of story?.[collection] ?? []) {
      const path = `story.${collection}[${item.id}]`;
      if ("lore" in item)
        item.lore?.forEach((r, i) => {
          ref(r, `${path}.lore[${i}]`);
        });
      if ("place" in item) ref(item.place, `${path}.place`, "fragment");
      if ("truth" in item) ref(item.truth, `${path}.truth`, "fragment");
      if ("when" in item) condition(item.when, `${path}.when`);
      if ("effects" in item) effects(item.effects, `${path}.effects`);
    }
  Object.keys(story?.knowing ?? {}).forEach((r) => {
    ref(r, `story.knowing.${r}`, "fragment");
  });
  story?.starts?.forEach((s) => {
    effects(s.set, `story.starts[${s.id}].set`);
  });
  const compiled = `${String(w.ref)}#${kind === "fragment" ? id : kind === "group" ? `group/${id}` : `source/${id}`}~root`;
  for (const fixture of (w.assembly_tests ?? []) as AssemblyFixture[]) {
    if (fixture.root !== "self") continue;
    const path = `assembly_tests[${fixture.id}]`;
    Object.keys(fixture.session?.story?.knowing ?? {}).forEach((r) => {
      ref(r, `${path}.session.story.knowing.${r}`, "fragment");
    });
    fixture.selection?.forEach((r, i) => {
      const hit =
        kind === "fragment"
          ? "fragment" in r && r.fragment === compiled
          : kind === "group"
            ? "group" in r && r.group === compiled
            : "source" in r &&
              r.source === compiled &&
              (kind === "source" || r.section === sectionId);
      if (hit) found.add(`${path}.selection[${i}]`);
    });
    if (kind === "source" && Object.hasOwn(fixture.source_texts ?? {}, compiled))
      found.add(`${path}.source_texts.${compiled}`);
    if (fixture.expected?.kind === "success")
      fixture.expected.trace?.forEach((a, i) => {
        const key =
          kind === "fragment"
            ? compiled
            : kind === "group"
              ? `group:${compiled}`
              : `source:${compiled}`;
        if (
          kind === "section"
            ? a.source === `${key}/section:${sectionId}`
            : a.source === key || (kind === "source" && a.source.startsWith(`${key}/section:`))
        )
          found.add(`${path}.expected.trace[${i}]`);
      });
  }
  return [...found];
}

/** Restoring authoring objects must not reintroduce targets removed since their baseline. */
export function contentRestoreError(
  before: Working,
  after: Working,
  baseline: Working,
): string | null {
  const targets: { kind: ContentObjectKind; id: string; section?: string; exists: boolean }[] = [
    ...(baseline.fragments ?? []).map((f) => ({
      kind: "fragment" as const,
      id: f.id,
      exists: (after.fragments ?? []).some((v) => v.id === f.id),
    })),
    ...((baseline.groups ?? []) as ContentGroup[]).map((g) => ({
      kind: "group" as const,
      id: g.id,
      exists: ((after.groups ?? []) as ContentGroup[]).some((v) => v.id === g.id),
    })),
    ...((baseline.sources ?? []) as KnowledgeSource[]).flatMap((s) => {
      const current = ((after.sources ?? []) as KnowledgeSource[]).find((v) => v.id === s.id);
      return [
        { kind: "source" as const, id: s.id, exists: !!current },
        ...(s.sections ?? []).map((v) => ({
          kind: "section" as const,
          id: s.id,
          section: v.id,
          exists: !!current?.sections?.some((a) => a.id === v.id),
        })),
      ];
    }),
  ];
  for (const target of targets) {
    if (target.exists) continue;
    const known = new Set(contentReferences(before, target.kind, target.id, target.section));
    const added = contentReferences(after, target.kind, target.id, target.section).filter(
      (r) => !known.has(r),
    );
    if (added.length)
      return `Restore ${target.kind} ${target.id}${target.section ? `/${target.section}` : ""} before undoing: ${added.join("; ")}`;
  }
  return null;
}
