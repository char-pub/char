/** Raw, lossless conflict recovery for unfinished editor drafts; this is not a Contribution merge. */
import type { Working } from "./draft";

export type DraftReapplyChoice = "mine" | "latest";
export interface DraftReapplyValue {
  exists: boolean;
  value?: unknown;
}
type Address =
  | { kind: "field"; path: string[] }
  | { kind: "object"; path: string[]; idKey: string; id: string }
  | { kind: "order"; path: string[]; idKey: string };
export interface DraftReapplyEntry {
  key: string;
  label: string;
  path: string[];
  kind: Address["kind"];
  base: DraftReapplyValue;
  mine: DraftReapplyValue;
  latest: DraftReapplyValue;
  conflict: boolean;
  defaultChoice: DraftReapplyChoice | null;
  address: Address;
}
export interface DraftReapplyPlan {
  base: Working;
  mine: Working;
  latest: Working;
  entries: DraftReapplyEntry[];
}
export interface DraftReapplyResult {
  working: Working | null;
  unresolved: string[];
  stale: boolean;
}
const COLLECTIONS: Record<string, string> = {
  fragments: "id",
  references: "id",
  assets: "slot",
  cast: "key",
  groups: "id",
  sources: "id",
};
const STORY_ARRAYS = new Set([
  "scenes",
  "starts",
  "beats",
  "choices",
  "endings",
  "plotlines",
  "events",
  "items",
  "timelines",
]);
const AUTHORITY = new Set(["id", "ref", "type"]);
const LABELS = new Map([
  ["fragments", "Passage"],
  ["references", "Dependency"],
  ["cast", "Participant"],
  ["groups", "Group"],
  ["sources", "Reference document"],
  ["assets", "Asset"],
  ["story.scenes", "Scene"],
  ["story.starts", "Opening"],
  ["story.beats", "Change"],
  ["story.choices", "Choice"],
  ["story.endings", "Ending"],
  ["story.plotlines", "Plotline"],
  ["story.events", "Event"],
  ["story.items", "Item"],
  ["story.timelines", "Timeline"],
  ["story.vars", "Variable"],
  ["story.knowing", "Knowledge"],
]);
const FIELD_LABELS = new Map([
  ["display_name", "Name"],
  ["summary", "Summary"],
  ["description", "Description"],
  ["meta.rating", "Rating"],
  ["meta.license", "License"],
  ["meta.rights", "Rights"],
  ["meta.tags", "Tags"],
  ["meta.default_locale", "Default language"],
  ["meta.content_warnings", "Content warnings"],
  ["authors", "Authors"],
  ["assembly_tests", "Author tests"],
  ["assembly", "Assembly settings"],
  ["policy", "Preset policy"],
  ["prompt_module", "Prompt module"],
  ["bootstrap", "Opening messages"],
  ["story", "Story"],
  ["meta", "Metadata"],
]);
function entryLabel(address: Address): string {
  const path = address.path.join(".");
  const group = LABELS.get(path);
  if (address.kind === "object" && group) return `${group}: ${address.id}`;
  if (address.kind === "order" && group) {
    const plural =
      group === "Dependency"
        ? "Dependencies"
        : group === "Reference document"
          ? "Reference documents"
          : `${group}s`;
    return `${plural} order`;
  }
  const mapGroup = LABELS.get(address.path.slice(0, -1).join("."));
  if (mapGroup && address.path[0] === "story") return `${mapGroup}: ${address.path.at(-1)}`;
  return FIELD_LABELS.get(path) ?? (group ? `${group}s` : address.path.join(" / "));
}
function record(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}
/** Structural equality without canonical text normalization, schema parsing or key-order sensitivity. */
export function sameDraftValue(a: unknown, b: unknown): boolean {
  const stack: [unknown, unknown][] = [[a, b]];
  const seen = new WeakMap<object, WeakSet<object>>();
  while (stack.length) {
    const pair = stack.pop();
    if (!pair) break;
    const [left, right] = pair;
    if (Object.is(left, right)) continue;
    if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
    if (Array.isArray(left) !== Array.isArray(right)) return false;
    if (!Array.isArray(left) && (!record(left) || !record(right))) return false;
    if (Array.isArray(left) && Array.isArray(right) && left.length !== right.length) return false;
    if (seen.get(left)?.has(right)) continue;
    const matches = seen.get(left) ?? new WeakSet<object>();
    matches.add(right);
    seen.set(left, matches);
    const keys = Object.keys(left);
    if (keys.length !== Object.keys(right).length) return false;
    for (const key of keys) {
      if (!Object.hasOwn(right, key)) return false;
      stack.push([Reflect.get(left, key), Reflect.get(right, key)]);
    }
  }
  return true;
}
function read(root: unknown, path: string[]): DraftReapplyValue {
  let current = root;
  for (const key of path) {
    if (!record(current) || !Object.hasOwn(current, key)) return { exists: false };
    current = current[key];
  }
  return { exists: true, value: current };
}
function equal(a: DraftReapplyValue, b: DraftReapplyValue) {
  return a.exists === b.exists && sameDraftValue(a.value, b.value);
}
function set(root: Working, path: string[], value: DraftReapplyValue) {
  let current: Record<string, unknown> = root;
  for (const key of path.slice(0, -1)) {
    if (!Object.hasOwn(current, key) || !record(current[key])) {
      if (!value.exists) return;
      Object.defineProperty(current, key, {
        value: {},
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    current = current[key] as Record<string, unknown>;
  }
  const key = path.at(-1);
  if (!key) return;
  if (!value.exists) delete current[key];
  else
    Object.defineProperty(current, key, {
      value: structuredClone(value.value),
      writable: true,
      enumerable: true,
      configurable: true,
    });
}
function collection(value: DraftReapplyValue, idKey: string): Map<string, unknown> | undefined {
  if (!value.exists || value.value === undefined) return new Map();
  if (!Array.isArray(value.value)) return undefined;
  const entries = new Map<string, unknown>();
  for (const item of value.value) {
    if (
      !record(item) ||
      typeof item[idKey] !== "string" ||
      !item[idKey] ||
      entries.has(item[idKey])
    )
      return undefined;
    entries.set(item[idKey], item);
  }
  return entries;
}
function member(map: Map<string, unknown>, id: string): DraftReapplyValue {
  return map.has(id) ? { exists: true, value: map.get(id) } : { exists: false };
}

/** Capture three immutable editor snapshots and local changes by stable object identity. */
export function createDraftReapply(
  base: Working,
  mine: Working,
  latest: Working,
): DraftReapplyPlan {
  const plan: DraftReapplyPlan = {
    base: structuredClone(base),
    mine: structuredClone(mine),
    latest: structuredClone(latest),
    entries: [],
  };
  const roots = [plan.base, plan.mine, plan.latest] as const;
  function add(
    address: Address,
    values: readonly [DraftReapplyValue, DraftReapplyValue, DraftReapplyValue],
    orderChoice?: { conflict: boolean; defaultChoice: DraftReapplyChoice },
  ) {
    const [base, mine, latest] = values;
    if (equal(base, mine) || equal(mine, latest)) return;
    const conflict = orderChoice?.conflict ?? !equal(base, latest);
    const path = [...address.path, ...(address.kind === "object" ? [address.id] : [])];
    plan.entries.push({
      key: JSON.stringify(address),
      label: entryLabel(address),
      path,
      kind: address.kind,
      address,
      base,
      mine,
      latest,
      conflict,
      defaultChoice: conflict ? null : (orderChoice?.defaultChoice ?? "mine"),
    });
  }
  function field(path: string[]) {
    add(
      { kind: "field", path },
      roots.map((root) => read(root, path)) as [
        DraftReapplyValue,
        DraftReapplyValue,
        DraftReapplyValue,
      ],
    );
  }
  function list(path: string[], idKey: string) {
    const values = roots.map((root) => read(root, path)) as [
      DraftReapplyValue,
      DraftReapplyValue,
      DraftReapplyValue,
    ];
    const [a, b, c] = values.map((value) => collection(value, idKey));
    if (!a || !b || !c) {
      field(path);
      return;
    }
    for (const id of new Set([...a.keys(), ...b.keys(), ...c.keys()]))
      add({ kind: "object", path, idKey, id }, [member(a, id), member(b, id), member(c, id)]);
    const order = values.map((value, i) => ({
      exists: value.exists,
      ...(value.exists
        ? { value: Array.isArray(value.value) ? [...([a, b, c][i]?.keys() ?? [])] : value.value }
        : {}),
    })) as [DraftReapplyValue, DraftReapplyValue, DraftReapplyValue];
    const retained = new Set([...a.keys()].filter((id) => b.has(id) && c.has(id)));
    const beforeOrder = [...a.keys()].filter((id) => retained.has(id));
    const mineOrder = [...b.keys()].filter((id) => retained.has(id));
    const latestOrder = [...c.keys()].filter((id) => retained.has(id));
    const mineChanged = !sameDraftValue(beforeOrder, mineOrder);
    const latestChanged = !sameDraftValue(beforeOrder, latestOrder);
    // Independently adding/removing members does not itself contest their retained ordering.
    const common = new Set([...b.keys()].filter((id) => c.has(id)));
    const sharedAddition = [...common].some((id) => !a.has(id));
    const sharedOrderDiffers = !sameDraftValue(
      [...b.keys()].filter((id) => common.has(id)),
      [...c.keys()].filter((id) => common.has(id)),
    );
    add({ kind: "order", path, idKey }, order, {
      conflict:
        (mineChanged && latestChanged && !sameDraftValue(mineOrder, latestOrder)) ||
        (sharedAddition && sharedOrderDiffers),
      defaultChoice: !mineChanged && latestChanged ? "latest" : "mine",
    });
  }
  function fields(path: string[]) {
    const values = roots.map((root) => read(root, path));
    // Whole-container deletion or malformed input is one explicit choice, never an invented partial object.
    if (
      values.some((value) => value.exists && !record(value.value)) ||
      (values[0]?.exists && !values[1]?.exists) ||
      (values[0]?.exists && !values[2]?.exists)
    ) {
      field(path);
      return;
    }
    const keys = new Set(
      values.flatMap((value) => (record(value.value) ? Object.keys(value.value) : [])),
    );
    for (const key of keys) {
      const child = [...path, key];
      if (path.length === 1 && path[0] === "story" && STORY_ARRAYS.has(key)) list(child, "id");
      else if (path.length === 1 && path[0] === "story" && ["vars", "knowing"].includes(key))
        fields(child);
      else field(child);
    }
    if (!keys.size) field(path);
  }
  for (const key of new Set(roots.flatMap(Object.keys))) {
    if (AUTHORITY.has(key)) continue;
    const idKey = Object.hasOwn(COLLECTIONS, key) ? COLLECTIONS[key] : undefined;
    if (idKey) list([key], idKey);
    else if (key === "story" || key === "meta") fields([key]);
    else field([key]);
  }
  return plan;
}

/** Reapply explicitly resolved choices only while both reviewed snapshots are still current. No save occurs. */
export function applyDraftReapply(
  plan: DraftReapplyPlan,
  choices: Readonly<Record<string, DraftReapplyChoice>>,
  current: { mine: Working; latest: Working },
): DraftReapplyResult {
  if (!sameDraftValue(current.mine, plan.mine) || !sameDraftValue(current.latest, plan.latest))
    return { working: null, unresolved: [], stale: true };
  const choose = (entry: DraftReapplyEntry) =>
    Object.hasOwn(choices, entry.key) ? choices[entry.key] : entry.defaultChoice;
  const unresolved = plan.entries
    .filter((entry) => !["mine", "latest"].includes(choose(entry) ?? ""))
    .map((entry) => entry.key);
  if (unresolved.length) return { working: null, unresolved, stale: false };
  const working = structuredClone(plan.latest);
  for (const entry of plan.entries.filter((entry) => entry.kind !== "order")) {
    if (choose(entry) !== "mine") continue;
    const address = entry.address;
    if (address.kind === "field") set(working, address.path, entry.mine);
    else if (address.kind === "object") {
      const existing = collection(read(working, address.path), address.idKey);
      if (!existing) return { working: null, unresolved: [entry.key], stale: true };
      if (entry.mine.exists) existing.set(address.id, structuredClone(entry.mine.value));
      else existing.delete(address.id);
      set(working, address.path, { exists: true, value: [...existing.values()] });
    }
  }
  for (const entry of plan.entries.filter((entry) => entry.kind === "order")) {
    const address = entry.address;
    if (address.kind !== "order") continue;
    const value = choose(entry) === "mine" ? entry.mine : entry.latest;
    const existing = collection(read(working, address.path), address.idKey);
    if (!existing) return { working: null, unresolved: [entry.key], stale: true };
    const order = Array.isArray(value.value) ? value.value : [];
    const sorted = new Map<string, unknown>();
    for (const id of order)
      if (typeof id === "string" && existing.has(id)) sorted.set(id, existing.get(id));
    // Newly added or explicitly retained objects survive either ordering choice.
    for (const [id, item] of existing) if (!sorted.has(id)) sorted.set(id, item);
    set(
      working,
      address.path,
      sorted.size || Array.isArray(value.value)
        ? { exists: true, value: [...sorted.values()] }
        : value,
    );
  }
  return { working, unresolved: [], stale: false };
}
