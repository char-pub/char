/** Pure author-location lookup. It never changes the draft or resolves dependency identities. */
import { localeOf, type Working } from "./draft";

export type StoryEditorView = "scenes" | "plotlines" | "timelines";
export interface EditorLocation {
  anchor: string;
  section?: "passages" | "dependencies" | "meta" | "language";
  storyView?: StoryEditorView;
  contentSelection?: "all" | `group:${string}`;
}
export const storyObjectAnchor = (collection: string, id: string): string =>
  `edit-story-${collection}-${encodeURIComponent(id)}`;
export const storyFieldAnchor = (collection: string, id: string, field: string): string =>
  `${storyObjectAnchor(collection, id)}-${encodeURIComponent(field)}`;
export const storyConditionAnchor = (collection: string, id: string, path: string): string =>
  storyFieldAnchor(collection, id, path);
export const bootstrapGreetingAnchor = (id: string): string =>
  `edit-bootstrap-${encodeURIComponent(id)}`;
export const sourceObjectAnchor = (id: string, section?: string): string =>
  `edit-source-${encodeURIComponent(id)}${section === undefined ? "" : `-section-${encodeURIComponent(section)}`}`;
export const groupObjectAnchor = (id: string): string => `edit-group-${encodeURIComponent(id)}`;

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((v) => {
        const item = object(v);
        return item ? [item] : [];
      })
    : [];
}
function boundary(subject: string, prefix: string): boolean {
  return subject === prefix || [".", "/", "["].some((part) => subject.startsWith(prefix + part));
}
/** Semantic paths name IDs; schema dot-index paths refer to current array positions. */
function identified(
  subject: string,
  prefix: string,
  value: unknown,
): { id: string; suffix: string } | null {
  const values = list(value);
  const named = values.filter(
    (v) => typeof v.id === "string" && boundary(subject, `${prefix}[${v.id}]`),
  );
  if (named.length === 1) {
    const id = String(named[0]?.id);
    return { id, suffix: subject.slice(`${prefix}[${id}]`.length) };
  }
  const match = subject.slice(prefix.length).match(/^\.(0|[1-9]\d*)(?=$|[./])/);
  if (!subject.startsWith(prefix) || !match) return null;
  const raw = Array.isArray(value) ? value[Number(match[1])] : undefined;
  const item = object(raw);
  if (typeof item?.id !== "string" || values.filter((v) => v.id === item.id).length !== 1)
    return null;
  return { id: item.id, suffix: subject.slice(prefix.length + match[0].length) };
}

const storyCollections = {
  scenes: "Scene",
  starts: "Start",
  beats: "Change",
  endings: "Ending",
  choices: "Action",
  events: "Event",
  plotlines: "Plotline",
  timelines: "Timeline",
  items: "Item",
} as const;

/** Match a real condition node, never a similarly named field or a removed branch. */
function conditionPath(value: unknown, suffix: string): string | undefined {
  const path = suffix.startsWith("/when")
    ? suffix
    : suffix.startsWith(".when")
      ? suffix.replaceAll(".", "/")
      : "";
  const parts = path.split("/");
  if (parts.shift() !== "" || parts.shift() !== "when") return;
  let node = object(value);
  while (parts.length && node) {
    const part = parts.shift();
    if (part === "not") node = object(node.not);
    else if (part === "all" || part === "any") {
      const index = parts.shift();
      if (index === undefined || !/^(0|[1-9]\d*)$/.test(index)) return;
      const children = node[part];
      node = Array.isArray(children) ? object(children[Number(index)]) : undefined;
    } else return;
  }
  return node ? path : undefined;
}

/** Current author labels are advisory; the exact diagnostic path remains visible separately. */
export function describeEditorSubject(
  working: Working,
  subject: string,
): { objectLabel: string; path: string } | null {
  const story = object(working.story);
  for (const [collection, kind] of Object.entries(storyCollections)) {
    const prefix = `story.${collection}`;
    if (!boundary(subject, prefix)) continue;
    const target = identified(subject, prefix, story?.[collection]);
    if (!target) return null;
    const item = list(story?.[collection]).find((entry) => entry.id === target.id);
    const raw = item?.title ?? item?.label;
    const localized = object(raw);
    const title = typeof raw === "string" ? raw : localized?.[localeOf(working)];
    return {
      objectLabel:
        typeof title === "string" && title.trim()
          ? `${kind} “${title}” (${target.id})`
          : `${kind} (${target.id})`,
      path: target.suffix,
    };
  }
  return null;
}

/** Resolve only objects that still exist uniquely in the current unsaved Working definition. */
export function editorLocation(working: Working, subject: string): EditorLocation | null {
  const story = object(working.story);
  if (boundary(subject, "story")) {
    for (const collection of [
      "scenes",
      "starts",
      "beats",
      "endings",
      "choices",
      "events",
      "plotlines",
      "timelines",
      "items",
    ]) {
      const prefix = `story.${collection}`;
      if (!boundary(subject, prefix)) continue;
      const target = identified(subject, prefix, story?.[collection]);
      const storyView =
        collection === "plotlines" || collection === "timelines" ? collection : "scenes";
      if (!target)
        return { anchor: collection === "items" ? "edit-story-state" : "edit-story", storyView };
      const item = list(story?.[collection]).find((entry) => entry.id === target.id);
      const condition = ["scenes", "beats", "endings", "choices", "events"].includes(collection)
        ? conditionPath(item?.when, target.suffix)
        : undefined;
      if (condition)
        return { anchor: storyConditionAnchor(collection, target.id, condition), storyView };
      const field =
        collection === "starts" && boundary(target.suffix, ".greeting")
          ? "greeting"
          : collection === "scenes" && boundary(target.suffix, ".opening")
            ? "opening"
            : undefined;
      return {
        anchor: field
          ? storyFieldAnchor(collection, target.id, field)
          : storyObjectAnchor(collection, target.id),
        storyView,
      };
    }
    for (const collection of ["vars", "knowing"]) {
      const values = object(story?.[collection]);
      const prefix = `story.${collection}`;
      if (!boundary(subject, prefix)) continue;
      const ids = Object.keys(values ?? {}).filter((id) =>
        boundary(subject, collection === "vars" ? `${prefix}.${id}` : `${prefix}[${id}]`),
      );
      return {
        anchor:
          ids.length === 1 && ids[0] !== undefined
            ? storyObjectAnchor(collection, ids[0])
            : "edit-story-state",
      };
    }
    return { anchor: "edit-story", storyView: "scenes" };
  }
  if (boundary(subject, "fragments")) {
    const target = identified(subject, "fragments", working.fragments);
    return {
      anchor: target ? `edit-fragment-${encodeURIComponent(target.id)}` : "edit-passages",
      section: "passages",
      contentSelection: "all",
    };
  }
  if (boundary(subject, "groups")) {
    const target = identified(subject, "groups", working.groups);
    return {
      anchor: target ? groupObjectAnchor(target.id) : "edit-content-groups",
      section: "passages",
      contentSelection: target ? `group:${target.id}` : "all",
    };
  }
  if (boundary(subject, "sources")) {
    const target = identified(subject, "sources", working.sources);
    if (!target) return { anchor: "edit-sources" };
    const source = list(working.sources).find((s) => s.id === target.id);
    const section = identified(target.suffix, ".sections", source?.sections);
    return { anchor: sourceObjectAnchor(target.id, section?.id) };
  }
  if (boundary(subject, "bootstrap")) {
    const target = identified(subject, "bootstrap.greetings", working.bootstrap?.greetings);
    // Greeting editors use the same stable IDs, including legacy alternatives.
    return target ? { anchor: bootstrapGreetingAnchor(target.id) } : { anchor: "edit-greeting" };
  }
  return null;
}
