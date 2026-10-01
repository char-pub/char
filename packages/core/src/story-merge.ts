/** Field-level three-way composition merging; baseline authority belongs to the caller's Registry. */
import { type CanonicalCreation, canonicalEdge, digestOf, normalizeValue } from "./canonical.js";
import { CharError } from "./errors.js";
import {
  CastMemberSchema,
  ContentGroupSchema,
  type CreationInput,
  type JSONValue,
  KnowledgeSourceSchema,
} from "./schema/creation.js";
import {
  type Change,
  type CompositionChange,
  type StoryKind,
  StoryObjectSchemas,
} from "./schema/release.js";
import { assertConditionLimits } from "./story/limits.js";

export type CompositionAddress =
  | { on: "story"; kind: StoryKind; id: string }
  | { on: "story-order"; list: Extract<CompositionChange, { on: "story-order" }>["list"] }
  | { on: "cast"; key: string }
  | { on: "group" | "source"; id: string };
export const STORY_COLLECTIONS = {
  scene: "scenes",
  beat: "beats",
  plotline: "plotlines",
  ending: "endings",
  start: "starts",
  choice: "choices",
  item: "items",
  event: "events",
  timeline: "timelines",
  var: "vars",
  knowing: "knowing",
} as const;
export function isCompositionChange(change: Change): change is CompositionChange {
  return ["story", "story-order", "cast", "group", "source"].includes(change.on);
}
type ObjectValue = Record<string, JSONValue>;
const own = (value: ObjectValue | undefined, key: string): JSONValue | undefined =>
  value && Object.hasOwn(value, key) ? value[key] : undefined;
export function assertSafeCompositionValue(value: unknown): void {
  const pending: { value: unknown; leave?: boolean }[] = [{ value }];
  const ancestors = new Set<object>();
  while (pending.length) {
    const entry = pending.pop();
    if (!entry?.value || typeof entry.value !== "object") continue;
    if (entry.leave) {
      ancestors.delete(entry.value);
      continue;
    }
    if (ancestors.has(entry.value))
      throw new CharError({
        code: "contribution.invalid_change",
        subject: "after",
        detail: "cyclic object is not JSON",
      });
    ancestors.add(entry.value);
    pending.push({ value: entry.value, leave: true });
    for (const [key, child] of Object.entries(entry.value)) {
      if (key === "__proto__")
        throw new CharError({
          code: "contribution.invalid_change",
          subject: key,
          detail: "reserved object key",
        });
      pending.push({ value: child });
    }
  }
}

/** Individual object canonicalization never requires unrelated unfinished creation fields. */
export function canonicalCompositionValue(address: CompositionAddress, value: unknown): JSONValue {
  if (address.on === "story" && value && typeof value === "object" && "when" in value)
    assertConditionLimits(value.when);
  assertSafeCompositionValue(value);
  const normalized = normalizeValue(value);
  if (address.on === "story-order") return normalized;
  const schema =
    address.on === "story"
      ? StoryObjectSchemas[address.kind]
      : address.on === "cast"
        ? CastMemberSchema
        : address.on === "group"
          ? ContentGroupSchema
          : KnowledgeSourceSchema;
  const parsed = schema.safeParse(normalized);
  if (!parsed.success)
    throw new CharError({
      code: "contribution.invalid_change",
      subject: address.on,
      detail: parsed.error.message,
    });
  if (address.on === "cast") {
    const cast = CastMemberSchema.parse(parsed.data);
    // Reuse the same override normalization used by Creation.cast canonicalization.
    const normalizedEdge = canonicalEdge({
      id: "cast",
      use: "@internal/cast",
      mode: "default",
      ...(cast.override ? { override: cast.override } : {}),
    });
    const { override: _override, ...rest } = cast;
    return normalizeValue({
      ...rest,
      ...(normalizedEdge.override ? { override: normalizedEdge.override } : {}),
    });
  }
  return normalizeValue(parsed.data);
}
/** Reads by stable object ID/key; absent order collections have the canonical value []. */
export function compositionValue(
  creation: CreationInput | CanonicalCreation,
  address: CompositionAddress,
): JSONValue | undefined {
  let value: unknown;
  if (address.on === "story-order")
    value = (creation.story?.[address.list] ?? []).map((item) => item.id);
  else if (address.on === "story") {
    const collection = creation.story?.[STORY_COLLECTIONS[address.kind]];
    value = Array.isArray(collection)
      ? collection.find((item) => item.id === address.id)
      : collection && Object.hasOwn(collection, address.id)
        ? (collection as Record<string, unknown>)[address.id]
        : undefined;
  } else if (address.on === "cast") value = creation.cast?.find((item) => item.key === address.key);
  else
    value = (address.on === "group" ? creation.groups : creation.sources)?.find(
      (item) => item.id === address.id,
    );
  return value === undefined ? undefined : canonicalCompositionValue(address, value);
}
export function compositionDigest(
  creation: CreationInput | CanonicalCreation,
  address: CompositionAddress,
): string | undefined {
  const value = compositionValue(creation, address);
  return value === undefined ? undefined : digestOf(value);
}
const equal = (a: unknown, b: unknown) =>
  a === undefined || b === undefined ? a === b : digestOf(a) === digestOf(b);
const array = (value: JSONValue | undefined): string[] | undefined =>
  Array.isArray(value) && value.every((v) => typeof v === "string") ? value : undefined;
function commonOrder(base: string[], current: string[], after: string[]) {
  const common = new Set(base.filter((id) => current.includes(id) && after.includes(id)));
  const b = base.filter((id) => common.has(id)),
    c = current.filter((id) => common.has(id)),
    a = after.filter((id) => common.has(id));
  return { common, b, c, a, changedCurrent: !equal(b, c), changedAfter: !equal(b, a) };
}
function references(
  base: JSONValue | undefined,
  current: JSONValue | undefined,
  after: JSONValue | undefined,
  path: string,
  conflicts: string[],
  absenceIsAll = false,
): JSONValue | undefined {
  if (equal(current, after) || equal(after, base)) return current;
  // Undefined Scene.cast means all participants, and '*' is not an empty audience.
  if (
    (absenceIsAll && [base, current, after].includes(undefined)) ||
    [base, current, after].some((v) => v !== undefined && !Array.isArray(v))
  )
    return scalar(base, current, after, path, conflicts);
  const b = array(base) ?? [],
    c = array(current) ?? [],
    a = array(after) ?? [];
  const order = commonOrder(b, c, a);
  if (order.changedCurrent && order.changedAfter && !equal(order.c, order.a)) {
    conflicts.push(`${path}@order`);
    return current;
  }
  const removed = new Set(b.filter((id) => !a.includes(id)));
  const result = [...new Set([...c, ...a.filter((id) => !b.includes(id))])].filter(
    (id) => !removed.has(id),
  );
  if (order.changedAfter && !order.changedCurrent) {
    let i = 0;
    for (let j = 0; j < result.length; j++)
      if (order.common.has(result[j] ?? "")) result[j] = order.a[i++] as string;
  }
  return result;
}
function scalar(
  base: JSONValue | undefined,
  current: JSONValue | undefined,
  after: JSONValue | undefined,
  path: string,
  conflicts: string[],
): JSONValue | undefined {
  if (equal(current, after) || equal(after, base)) return current;
  if (equal(current, base)) return after;
  conflicts.push(path);
  return current;
}
function record(value: JSONValue | undefined): ObjectValue | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}
function mergeMap(
  base: JSONValue | undefined,
  current: JSONValue | undefined,
  after: JSONValue | undefined,
  path: string,
  _conflicts: string[],
  merge: (
    b: JSONValue | undefined,
    c: JSONValue | undefined,
    a: JSONValue | undefined,
    p: string,
  ) => JSONValue | undefined,
): JSONValue | undefined {
  if (equal(current, after) || equal(after, base)) return current;
  const b = record(base),
    c = record(current),
    a = record(after);
  const out: ObjectValue = {};
  for (const key of new Set([
    ...Object.keys(b ?? {}),
    ...Object.keys(c ?? {}),
    ...Object.keys(a ?? {}),
  ])) {
    const value = merge(own(b, key), own(c, key), own(a, key), path ? `${path}.${key}` : key);
    if (value !== undefined)
      Object.defineProperty(out, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
  }
  return Object.keys(out).length ? out : undefined;
}
export interface CompositionMerge {
  value: JSONValue | undefined;
  conflict_fields: string[];
}
export function mergeCompositionObject(
  change: CompositionChange,
  base: JSONValue | undefined,
  current: JSONValue | undefined,
): CompositionMerge {
  const after =
    change.after === undefined ? undefined : canonicalCompositionValue(change, change.after);
  const conflicts: string[] = [];
  if (change.op !== "modify" || !base || !current || !after)
    return {
      value: scalar(base, current, after, "$object", conflicts),
      conflict_fields: conflicts,
    };
  const b = record(base),
    c = record(current),
    a = record(after);
  const setFields =
    change.on === "group"
      ? ["entries", "groups"]
      : change.on === "story"
        ? ((
            {
              scene: ["cast", "beats", "choices", "lore", "items", "events"],
              plotline: ["scenes", "beats"],
              item: ["lore"],
              event: ["cast", "lore"],
            } as Partial<Record<StoryKind, string[]>>
          )[change.kind] ?? [])
        : [];
  const value = mergeMap(b, c, a, "", conflicts, (bv, cv, av, path) => {
    if (setFields.includes(path))
      return references(
        bv,
        cv,
        av,
        path,
        conflicts,
        change.on === "story" && change.kind === "scene" && path === "cast",
      );
    if (change.on === "story" && change.kind === "scene" && path === "goals")
      return mergeMap(bv, cv, av, path, conflicts, (x, y, z, p) => scalar(x, y, z, p, conflicts));
    if (change.on === "story" && change.kind === "knowing") {
      if (path === "start")
        return (
          mergeMap(bv, cv, av, path, conflicts, (x, y, z, p) =>
            references(x, y, z, p, conflicts),
          ) ?? {}
        );
      if (path === "enter")
        return mergeMap(bv, cv, av, path, conflicts, (x, y, z, p) =>
          mergeMap(x, y, z, p, conflicts, (k, l, m, q) => references(k, l, m, q, conflicts)),
        );
    }
    return scalar(bv, cv, av, path, conflicts);
  });
  return { value, conflict_fields: conflicts };
}

/** Mutable only inside one merge attempt; caller discards the entire copy on any conflict. */
export function applyComposition(
  working: Record<string, unknown>,
  address: CompositionAddress,
  value: JSONValue | undefined,
): void {
  if (address.on === "story-order") throw new Error("order is applied after object membership");
  let holder = working;
  const collection =
    address.on === "story"
      ? STORY_COLLECTIONS[address.kind]
      : address.on === "cast"
        ? "cast"
        : address.on === "group"
          ? "groups"
          : "sources";
  if (address.on === "story") {
    if (!working.story) {
      if (value === undefined) return;
      working.story = { version: 1, scenes: [] };
    }
    holder = working.story as Record<string, unknown>;
  }
  const id = address.on === "cast" ? address.key : address.id;
  if (address.on === "story" && (address.kind === "var" || address.kind === "knowing")) {
    holder[collection] ??= {};
    const map = holder[collection] as Record<string, unknown>;
    if (value === undefined) delete map[id];
    else
      Object.defineProperty(map, id, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    if (!Object.keys(map).length) delete holder[collection];
    return;
  }
  holder[collection] ??= [];
  const list = holder[collection] as Record<string, unknown>[];
  const identity = address.on === "cast" ? "key" : "id";
  const index = list.findIndex((item) => item[identity] === id);
  if (value === undefined) {
    if (index >= 0) list.splice(index, 1);
  } else if (index < 0) list.push(value as ObjectValue);
  else list[index] = value as ObjectValue;
  if (!list.length && collection !== "scenes") delete holder[collection];
}
export function removeEmptyStory(working: Record<string, unknown>): void {
  const story = working.story as Record<string, unknown> | undefined;
  if (
    story &&
    Object.entries(story).every(([key, value]) => {
      if (key === "version") return true;
      if (Array.isArray(value)) return value.length === 0;
      return value !== null && typeof value === "object" && Object.keys(value).length === 0;
    })
  )
    delete working.story;
}
/** Order changes do not create/delete objects; membership must be provided by object operations. */
export function mergeCompositionOrder(
  base: string[],
  current: string[],
  after: string[],
  members: string[],
): CompositionMerge {
  const conflicts: string[] = [];
  const order = commonOrder(base, current, after);
  if (order.changedCurrent && order.changedAfter && !equal(order.c, order.a))
    conflicts.push("@order");
  const preferred = order.changedAfter || equal(base, current) ? after : current;
  const value = [...new Set([...preferred, ...members])].filter((id) => members.includes(id));
  return { value, conflict_fields: conflicts };
}
export function applyCompositionOrder(
  working: Record<string, unknown>,
  change: Extract<CompositionChange, { on: "story-order" }>,
  ids: string[],
): void {
  const story = working.story as Record<string, unknown> | undefined;
  if (!story) return;
  const list = (story[change.list] ?? []) as { id: string }[];
  story[change.list] = ids
    .map((id) => list.find((item) => item.id === id))
    .filter((item) => item !== undefined);
  if (!ids.length && change.list !== "scenes") delete story[change.list];
}
