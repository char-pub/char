import type { CanonicalCreation } from "./canonical.js";
import type { CheckDiagnostic } from "./diagnostics.js";
import type { LocalizedText } from "./schema/creation.js";
import type { StoryCondition, StoryEffect } from "./schema/story.js";

/** Collection checks need fragment identities, not compiled text or fragment digests. */
export type ContentCollectionsInput = Pick<
  CanonicalCreation,
  "description" | "groups" | "sources" | "type" | "assets"
> & {
  fragments: readonly Pick<CanonicalCreation["fragments"][number], "id">[];
};

/** Checks directory structure and source asset declarations without reading blob contents. */
export function checkContentCollections(creation: ContentCollectionsInput): CheckDiagnostic[] {
  const diagnostics: CheckDiagnostic[] = [];
  const error = (code: string, subject: string, detail: string): void => {
    diagnostics.push({ code, subject, severity: "error", detail });
  };
  const description = (text: LocalizedText | undefined, limit: number, at: string) => {
    if (text === undefined) return;
    for (const value of typeof text === "string" ? [text] : Object.values(text))
      if (!value.trim() || Array.from(value).length > limit)
        error(
          "check.description_length",
          at,
          `Description must contain 1–${limit} Unicode characters`,
        );
  };
  description(creation.description, 300, "description");
  const groups = new Map((creation.groups ?? []).map((group) => [group.id, group]));
  if (groups.size !== creation.groups?.length && creation.groups)
    error("check.duplicate_group", "groups", "Group IDs must be unique");
  const fragments = new Set(creation.fragments.map((f) => f.id));
  for (const group of groups.values()) {
    const at = `groups[${group.id}]`;
    description(group.description, 200, `${at}.description`);
    for (const id of group.entries ?? [])
      if (!fragments.has(id)) error("check.group_entry_missing", at, `Unknown fragment '${id}'`);
    for (const id of group.groups ?? [])
      if (!groups.has(id)) error("check.group_missing", at, `Unknown group '${id}'`);
    const pending = [{ id: group.id, path: [] as string[] }];
    while (pending.length) {
      const item = pending.pop();
      if (!item) break;
      if (item.path.includes(item.id)) {
        error("check.group_cycle", at, `Group cycle at '${item.id}'`);
        break;
      }
      if (item.path.length >= 3) {
        error("check.group_depth", at, "At most three group levels are supported");
        break;
      }
      const child = groups.get(item.id);
      for (const id of child?.groups ?? []) pending.push({ id, path: [...item.path, item.id] });
    }
  }
  if (
    creation.sources?.length &&
    !["world", "lorebook", "character", "scenario"].includes(creation.type)
  )
    error(
      "check.sources_not_allowed",
      "sources",
      "This creation type cannot declare knowledge sources",
    );
  const sources = new Set<string>();
  for (const source of creation.sources ?? []) {
    const at = `sources[${source.id}]`;
    if (sources.has(source.id)) error("check.duplicate_source", at, "Source IDs must be unique");
    sources.add(source.id);
    description(source.description, 200, `${at}.description`);
    const asset = creation.assets.find((a) => a.slot === source.asset);
    if (asset?.role !== "context")
      error("check.source_asset", `${at}.asset`, "Source needs a context asset");
    const defaultVariant = asset?.variants.find((v) => v.id === "default");
    const expected =
      source.format === "markdown" ? ["text/markdown", "text/plain"] : ["text/plain"];
    if (defaultVariant && defaultVariant.blob.availability !== "mirrored")
      error(
        "check.source_not_mirrored",
        at,
        "Source text must be stored so publication can verify its anchors",
      );
    if (defaultVariant && !expected.includes(defaultVariant.media_type))
      error("check.source_media_type", at, "Source format must match the text asset");
    const sections = new Set<string>();
    for (const section of source.sections ?? []) {
      const sat = `${at}.sections[${section.id}]`;
      if (sections.has(section.id))
        error("check.duplicate_source_section", sat, "Section IDs must be unique");
      sections.add(section.id);
      description(section.description, 200, `${sat}.description`);
      if (source.format === "text") {
        const match = /^L([1-9][0-9]*)-L([1-9][0-9]*)$/.exec(section.anchor);
        if (
          !match ||
          Number(match[1]) > Number(match[2]) ||
          !Number.isSafeInteger(Number(match[2]))
        )
          error("check.source_anchor", sat, "Text section needs an inclusive Lstart-Lend range");
      } else if (!section.anchor.startsWith("#") || section.anchor.length < 2)
        error("check.source_anchor", sat, "Markdown section needs a heading anchor");
    }
  }
  return diagnostics;
}

/**
 * Reference-bearing fields only: unfinished prose needs no canonical substitute.
 * The caller owns shape validation; dependency closure is not inferred here.
 */
export interface LocalStoryReferenceObject {
  id?: string | undefined;
  lore?: readonly string[] | undefined;
  place?: string | undefined;
  truth?: string | undefined;
  when?: StoryCondition | undefined;
  effects?: readonly StoryEffect[] | undefined;
  set?: readonly StoryEffect[] | undefined;
}
export interface LocalContentReferencesInput {
  ref?: string | undefined;
  fragments?:
    | readonly {
        id?: string | undefined;
        source?: { use: string } | undefined;
        about?: readonly string[] | undefined;
      }[]
    | undefined;
  cast?: readonly { key?: string | undefined }[] | undefined;
  groups?: readonly { id?: string | undefined }[] | undefined;
  sources?:
    | readonly {
        id?: string | undefined;
        sections?: readonly { id?: string | undefined }[] | undefined;
      }[]
    | undefined;
  story?:
    | {
        scenes?: readonly LocalStoryReferenceObject[] | undefined;
        items?: readonly LocalStoryReferenceObject[] | undefined;
        events?: readonly LocalStoryReferenceObject[] | undefined;
        beats?: readonly LocalStoryReferenceObject[] | undefined;
        endings?: readonly LocalStoryReferenceObject[] | undefined;
        choices?: readonly LocalStoryReferenceObject[] | undefined;
        starts?: readonly LocalStoryReferenceObject[] | undefined;
        knowing?: Readonly<Record<string, unknown>> | undefined;
      }
    | undefined;
}

/** Pure local reference checking; shape validation and external closure checks remain separate. */
export function checkLocalContentReferences(
  creation: LocalContentReferencesInput,
): CheckDiagnostic[] {
  const diagnostics: CheckDiagnostic[] = [];
  // Partial editors can retain absent/unfinished collections. These guards do not validate their schema.
  const list = <T>(value: readonly T[] | undefined): readonly NonNullable<T>[] =>
    Array.isArray(value) ? value.filter((item): item is NonNullable<T> => item != null) : [];
  const fragments = list(creation.fragments);
  const groups = list(creation.groups);
  const sources = list(creation.sources);
  const cast = list(creation.cast);
  const problem = (subject: string, ref: string) =>
    diagnostics.push({
      code: "check.local_reference",
      subject,
      severity: "error",
      detail: `Unknown or ambiguous local content reference '${ref}'`,
    });
  const check = (
    ref: string | undefined,
    subject: string,
    kind: "content" | "fragment" | "source" = "content",
  ) => {
    if (typeof ref !== "string") return;
    if (ref.startsWith("cast:")) {
      const key = ref.slice(5).split("#")[0];
      if (!cast.some((member) => member.key === key)) problem(subject, ref);
      return;
    }
    const localRef =
      creation.ref && ref.startsWith(`${creation.ref}#`) ? ref.slice(creation.ref.length) : ref;
    if (!localRef.startsWith("#")) return;
    const local = localRef.slice(1);
    let matches = 0;
    if (kind !== "source") matches += fragments.filter((fragment) => fragment.id === local).length;
    if (kind === "content")
      matches += groups.filter(
        (group) => group.id !== undefined && (local === group.id || local === `group/${group.id}`),
      ).length;
    if (kind !== "fragment") {
      const alias = local.startsWith("source/") ? local.slice(7) : local;
      for (const source of sources) {
        if (!source.id) continue;
        if (alias === source.id) matches++;
        else
          matches += list(source.sections).filter(
            (section) => section.id !== undefined && alias === `${source.id}/${section.id}`,
          ).length;
      }
    }
    if (matches !== 1) problem(subject, ref);
  };
  for (const [i, fragment] of fragments.entries()) {
    const at = `fragments[${fragment.id ?? i}]`;
    if (fragment.source) check(fragment.source.use, `${at}.source`, "source");
    for (const ref of list(fragment.about)) check(ref, `${at}.about`, "fragment");
  }
  const story = creation.story;
  if (!story) return diagnostics;
  for (const [collection, objects] of [
    ["scenes", story.scenes],
    ["items", story.items],
    ["events", story.events],
  ] as const)
    for (const [i, object] of list(objects).entries()) {
      const at = `story.${collection}[${object.id ?? i}]`;
      for (const ref of list(object.lore)) check(ref, `${at}.lore`);
      check(object.place, `${at}.place`, "fragment");
      check(object.truth, `${at}.truth`, "fragment");
    }
  for (const ref of Object.keys(story.knowing ?? {}))
    check(ref, `story.knowing[${ref}]`, "fragment");
  const condition = (value: StoryCondition | undefined, path: string): void => {
    const queue: { value: StoryCondition; path: string; exit?: true }[] = value
      ? [{ value, path }]
      : [];
    const ancestors = new Set<StoryCondition>();
    while (queue.length) {
      const current = queue.pop();
      if (!current?.value || typeof current.value !== "object") continue;
      if (current.exit) {
        ancestors.delete(current.value);
        continue;
      }
      if (ancestors.has(current.value)) continue; // Shape/cycle validation remains the caller's responsibility.
      ancestors.add(current.value);
      queue.push({ ...current, exit: true });
      const node = current.value;
      if ("knows" in node) check(node.knows?.info, `${current.path}.knows.info`, "fragment");
      else if ("not" in node) queue.push({ value: node.not, path: `${current.path}.not` });
      else if ("all" in node || "any" in node) {
        const op = "all" in node ? "all" : "any";
        const children = "all" in node ? node.all : node.any;
        const values = Array.isArray(children) ? children : [];
        for (let index = values.length - 1; index >= 0; index--) {
          const child = values[index];
          if (child) queue.push({ value: child, path: `${current.path}.${op}[${index}]` });
        }
      }
    }
  };
  for (const [collection, objects] of [
    ["scenes", story.scenes],
    ["beats", story.beats],
    ["endings", story.endings],
    ["choices", story.choices],
    ["events", story.events],
    ["starts", story.starts],
  ] as const)
    for (const [i, object] of list(objects).entries()) {
      const at = `story.${collection}[${object.id ?? i}]`;
      condition(object.when, `${at}.when`);
      const effects = object.effects ?? object.set;
      list(effects).forEach((effect, index) => {
        if (typeof effect === "object" && "learn" in effect)
          check(effect.learn?.info, `${at}.effects[${index}].learn`, "fragment");
      });
    }
  return diagnostics;
}
