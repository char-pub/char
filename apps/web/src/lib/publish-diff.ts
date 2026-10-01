/** Author-definition differences for a fixed publication review, never an IR comparison. */
import {
  type CompositionAddress,
  canonicalizeCreation,
  compositionDigest,
  compositionValue,
  type JSONValue,
} from "@char-pub/core";

const STORY_COLLECTIONS = {
  scene: "scenes",
  beat: "beats",
  choice: "choices",
  ending: "endings",
  plotline: "plotlines",
  timeline: "timelines",
  start: "starts",
  event: "events",
  item: "items",
  var: "vars",
  knowing: "knowing",
} as const;
export type PublishDiffCategory = "body" | "description" | "structure";
export interface PublishDiffEntry {
  category: PublishDiffCategory;
  path: string[];
  object: string;
  field: string;
  change: "added" | "removed" | "changed";
  before?: JSONValue;
  after?: JSONValue;
}
export interface PublishDefinitionDiff {
  entries: PublishDiffEntry[];
  firstRelease: boolean;
}
const LABELS: Record<string, string> = {
  fragments: "Passages",
  content: "Content",
  description: "Description",
  locale: "Translations",
  text: "Text",
  type: "Type",
  title: "Title",
  display_name: "Name",
  story: "Story",
  scenes: "Scenes",
  starts: "Openings",
  beats: "Changes",
  choices: "Choices",
  endings: "Endings",
  plotlines: "Plotlines",
  timelines: "Timelines",
  events: "Events",
  items: "Items",
  vars: "Variables",
  knowing: "Knowledge",
  cast: "Cast",
  groups: "Groups",
  sources: "Reference documents",
  sections: "Sections",
  references: "Dependencies",
  assets: "Assets",
  meta: "Publishing details",
  authors: "Authors",
  provenance: "Origin",
  bootstrap: "Greetings",
  greetings: "Greetings",
  greeting: "Greeting",
  opening: "Opening situation",
  goals: "Goals",
  goal: "Goal",
  part: "Role",
  intent: "Intent",
  policy: "Preset policy",
  prompt_module: "Prompt module",
  blocks: "Blocks",
  assembly: "Locked assembly",
  assembly_tests: "Author tests",
  when: "Condition",
  effects: "Effects",
  all: "All conditions",
  any: "Any condition",
  not: "Not",
  set: "Set",
  add: "Add",
  learn: "Learn",
  reached: "Reached",
  scene: "Scene",
  present: "Present",
  start: "Initially",
  enter: "On entering",
  knows: "Knows",
  min: "Minimum",
  max: "Maximum",
  init: "Initial value",
  values: "Allowed values",
  of: "Elements",
  strength: "Strength",
  reveal: "Reveal",
  after: "After ending",
  priority: "Priority",
  visibility: "Visibility",
  activation: "Activation",
  selectable: "Available for selection",
  perspective: "Perspective",
  outward: "Public description",
  about: "Related objects",
  order: "Order",
  license: "License",
  rating: "Rating",
  content_warnings: "Content warnings",
  default_locale: "Default language",
  tags: "Tags",
  pin: "Exact version",
  use: "Reference",
  digest: "Content digest",
  availability: "Availability",
  anchor: "Anchor",
  locator: "Document location",
  origin: "Source",
  body: "Document bytes",
};
export function publishFieldLabel(key: string): string {
  return LABELS[key] ?? key.replaceAll("_", " ");
}
function record(value: unknown): Record<string, JSONValue> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JSONValue>)
    : undefined;
}
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((value, i) => same(value, b[i]));
  const x = record(a),
    y = record(b);
  return (
    !!x &&
    !!y &&
    Object.keys(x).length === Object.keys(y).length &&
    Object.keys(x).every((key) => Object.hasOwn(y, key) && same(x[key], y[key]))
  );
}
function localized(value: JSONValue | undefined, locale: string): string | undefined {
  if (typeof value === "string") return value;
  const object = record(value);
  const chosen = object?.[locale] ?? Object.values(object ?? {})[0];
  return typeof chosen === "string" ? chosen : undefined;
}
const STORY_LISTS = new Set(Object.values(STORY_COLLECTIONS));
function keyField(path: string[]): string | undefined {
  if (path.length === 1)
    return path[0] === "cast"
      ? "key"
      : path[0] === "assets"
        ? "slot"
        : ["fragments", "references", "groups", "sources"].includes(path[0] ?? "")
          ? "id"
          : undefined;
  if (
    path.length === 2 &&
    path[0] === "story" &&
    STORY_LISTS.has(path[1] as (typeof STORY_COLLECTIONS)[keyof typeof STORY_COLLECTIONS])
  )
    return "id";
  if (path.at(-1) === "sections" && path[0] === "sources") return "id";
  if (path.join(".") === "bootstrap.greetings") return "id";
  if ((path[0] === "policy" || path[0] === "prompt_module") && path.at(-1) === "blocks")
    return "id";
  return undefined;
}
function category(path: string[]): PublishDiffCategory {
  // Stable IDs can themselves be "description", "opening" or "text"; they are not field names.
  if (path.length > 1 && keyField(path.slice(0, -1))) return "structure";
  const parent = path.slice(0, -1);
  if (
    path.at(-1) === "description" &&
    (addressOf(parent) ||
      (parent.length === 2 && ["fragments", "slots", "params"].includes(parent[0] ?? "")) ||
      keyField(parent.slice(0, -1)) ||
      (path.includes("override") && ["set", "fragment"].includes(parent.at(-1) ?? "")))
  )
    return "description";
  if (
    ["cast", "references"].includes(path[0] ?? "") &&
    path.includes("override") &&
    path.at(-1) === "content"
  )
    return "body";
  if (
    path[0] === "fragments" &&
    ((path.length === 3 && path[2] === "content") ||
      (path.length === 5 && path[2] === "locale" && path[4] === "content"))
  )
    return "body";
  if (path[0] === "bootstrap" && ["text", "content", "scenario_hint"].includes(path.at(-1) ?? ""))
    return "body";
  if (path[0] === "story" && ["opening", "greeting", "intent"].includes(path.at(-1) ?? ""))
    return "body";
  if (path[0] === "cast" && ["part", "goal"].includes(path.at(-1) ?? "")) return "body";
  if (path[0] === "story" && path.includes("goals")) return "body";
  if (
    ["policy", "prompt_module"].includes(path[0] ?? "") &&
    path.includes("blocks") &&
    path.at(-1) === "text"
  )
    return "body";
  return "structure";
}

function addressOf(path: string[]): CompositionAddress | undefined {
  if (path.length === 2 && path[0] === "cast" && path[1]) return { on: "cast", key: path[1] };
  if (path.length === 2 && (path[0] === "groups" || path[0] === "sources") && path[1])
    return { on: path[0] === "groups" ? "group" : "source", id: path[1] };
  if (path.length === 3 && path[0] === "story" && path[2]) {
    const kind = Object.entries(STORY_COLLECTIONS).find(
      ([, collection]) => collection === path[1],
    )?.[0];
    if (kind)
      return {
        on: "story",
        kind: kind as Extract<CompositionAddress, { on: "story" }>["kind"],
        id: path[2],
      };
  }
  return undefined;
}

/** Full canonical Creation coverage; unknown future fields remain visible as structural changes. */
export function publishDefinitionDiff(
  before: unknown | null,
  after: unknown,
): PublishDefinitionDiff {
  const old = before === null ? null : canonicalizeCreation(before);
  const next = canonicalizeCreation(after);
  const entries: PublishDiffEntry[] = [];
  const locale = next.creation.meta.default_locale;
  const add = (
    path: string[],
    object: string,
    a: JSONValue | undefined,
    b: JSONValue | undefined,
    force?: PublishDiffCategory,
  ) => {
    if (same(a, b)) return;
    entries.push({
      category: force ?? category(path),
      path,
      object,
      field: publishFieldLabel(path.at(-1) ?? "Creation"),
      change: a === undefined ? "added" : b === undefined ? "removed" : "changed",
      ...(a !== undefined ? { before: a } : {}),
      ...(b !== undefined ? { after: b } : {}),
    });
  };
  const walk = (
    a: JSONValue | undefined,
    b: JSONValue | undefined,
    path: string[],
    object: string,
  ) => {
    const address = addressOf(path);
    if (address) {
      if (path[0] === "story" && ["vars", "knowing"].includes(path[1] ?? ""))
        object = `${publishFieldLabel(path[1] ?? "Story")}: ${path[2]}`;
      if (
        old &&
        compositionDigest(old.creation, address) === compositionDigest(next.creation, address)
      )
        return;
      a = old ? compositionValue(old.creation, address) : undefined;
      b = compositionValue(next.creation, address);
    }
    if (same(a, b)) return;
    const group = category(path);
    if (group !== "structure") {
      add(path, object, a, b);
      return;
    }
    const key = keyField(path);
    if (key && (a === undefined || Array.isArray(a)) && (b === undefined || Array.isArray(b))) {
      const left = Array.isArray(a) ? a : [],
        right = Array.isArray(b) ? b : [];
      const ids = (items: JSONValue[]) =>
        items
          .map((value) => record(value)?.[key])
          .filter((id): id is string => typeof id === "string");
      const beforeIDs = ids(left),
        afterIDs = ids(right);
      if (!same(beforeIDs, afterIDs))
        add([...path, "order"], object, beforeIDs, afterIDs, "structure");
      for (const id of new Set([...beforeIDs, ...afterIDs])) {
        const x = left.find((value) => record(value)?.[key] === id),
          y = right.find((value) => record(value)?.[key] === id);
        const title = localized(record(y ?? x)?.title ?? record(y ?? x)?.display_name, locale);
        const owner = `${publishFieldLabel(path.at(-1) ?? "Object")}: ${title ? `${title} (${id})` : id}`;
        if (x === undefined || y === undefined)
          add(
            [...path, id],
            owner,
            x === undefined ? undefined : id,
            y === undefined ? undefined : id,
            "structure",
          );
        walk(x, y, [...path, id], owner);
      }
      return;
    }
    if (
      (a === undefined || Array.isArray(a)) &&
      (b === undefined || Array.isArray(b)) &&
      [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])].some(
        (value) => !!record(value),
      ) &&
      [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])].every(
        (value) => !!record(value),
      )
    ) {
      const left = Array.isArray(a) ? a : [],
        right = Array.isArray(b) ? b : [];
      for (let index = 0; index < Math.max(left.length, right.length); index++)
        walkObject(left[index], right[index], [...path, String(index)], object);
      return;
    }
    if (record(a) || record(b)) {
      walkObject(a, b, path, object);
      return;
    }
    add(path, object, a, b);
  };
  const walkObject = (
    a: JSONValue | undefined,
    b: JSONValue | undefined,
    path: string[],
    object: string,
  ) => {
    const x = record(a),
      y = record(b);
    if ((a !== undefined && !x) || (b !== undefined && !y)) {
      add(path, object, a, b);
      return;
    }
    for (const key of new Set([...Object.keys(x ?? {}), ...Object.keys(y ?? {})])) {
      if (path.length === 2 && path[0] === "fragments" && key === "digest") continue;
      walk(x?.[key], y?.[key], [...path, key], object);
    }
  };
  walkObject(old?.json ?? undefined, next.json, [], "Creation");
  const oldSources = old?.creation.sources ?? [];
  for (const source of next.creation.sources ?? []) {
    const previous = oldSources.find((item) => item.id === source.id);
    if (!previous) continue;
    const digests = (creation: typeof next.creation, slot: string) =>
      creation.assets
        .find((asset) => asset.slot === slot)
        ?.variants.map((variant) => variant.blob.digest) ?? [];
    const a = old ? digests(old.creation, previous.asset) : [],
      b = digests(next.creation, source.asset);
    if (!same(a, b))
      add(
        ["sources", source.id, "body"],
        `Reference documents: ${localized(source.title, locale) ?? source.id}`,
        a,
        b,
        "body",
      );
  }
  return { entries, firstRelease: old === null };
}
