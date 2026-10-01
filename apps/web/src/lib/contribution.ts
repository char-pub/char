/**
 * 在浏览器里把贡献者的修改变成 Contribution 的变更列表。
 *
 * 基线是贡献者看到的那个 Release 的 canonical Creation。每个变更都带上它在基线里的
 * digest（`base_digest`），服务端据此做三方合并：作者之后改过的其他内容会被保留，
 * 两边改了同一处才算冲突。支持片段、评级、标签、装配配置，以及 Story、角色、
 * 资料分组、Source、依赖和资产；Story 集合顺序使用独立的变更。
 *
 * 变更是否敏感由服务端计算；这里填写的 `sensitive` 只是为了满足请求格式。
 */
import {
  type CanonicalResult,
  CharError,
  type CompositionAddress,
  canonicalAssetSlot,
  canonicalCompositionValue,
  canonicalEdge,
  canonicalFragment,
  canonicalizeCreation,
  compositionDigest,
  compositionValue,
  configurationDigest,
  digestOf,
  type Fragment,
  type JSONValue,
  type Rating,
  SENSITIVE_METADATA_FIELDS,
} from "@char-pub/core";
import type { Working } from "./draft";

export const CONFIGURATION_FIELDS = [
  "policy",
  "prompt_module",
  "assembly",
  "assembly_tests",
] as const;

export const COMPOSITION_FIELDS = [
  "story",
  "cast",
  "groups",
  "sources",
  "references",
  "assets",
] as const;
const STORY_LISTS = {
  scenes: "scene",
  beats: "beat",
  choices: "choice",
  plotlines: "plotline",
  endings: "ending",
  starts: "start",
  items: "item",
  events: "event",
  timelines: "timeline",
} as const;

/** 贡献者可以编辑的内容。 */
export interface ContributionEdit {
  fragments: Fragment[];
  rating: Rating;
  tags: string[];
  configuration?: Record<string, unknown>;
  /** Presence is deliberate: an explicit undefined removes a field; old callers omit it. */
  story?: unknown;
  cast?: unknown;
  groups?: unknown;
  sources?: unknown;
  references?: unknown;
  assets?: unknown;
}

export interface ContributionBase {
  canonical: CanonicalResult;
  edit: ContributionEdit;
}

function metaOf(base: CanonicalResult): Record<string, JSONValue> {
  const json = base.json as Record<string, JSONValue>;
  return (json.meta ?? {}) as Record<string, JSONValue>;
}

function withoutDigest(f: Fragment): Fragment {
  const { digest: _, ...rest } = f;
  return rest;
}

/** 解析基线内容，得到 canonical 形式与可编辑的初始值。 */
export function contributionBase(creation: unknown): ContributionBase {
  const canonical = canonicalizeCreation(creation);
  const meta = canonical.creation.meta;
  return {
    canonical,
    edit: structuredClone({
      fragments: canonical.creation.fragments.map(withoutDigest),
      rating: meta.rating,
      tags: [...(meta.tags ?? [])],
      configuration: Object.fromEntries(
        CONFIGURATION_FIELDS.filter((field) => canonical.creation[field] !== undefined).map(
          (field) => [field, canonical.creation[field]],
        ),
      ),
      ...Object.fromEntries(COMPOSITION_FIELDS.map((field) => [field, canonical.creation[field]])),
    }),
  };
}

/** One working definition for all contribution editors, without validating half-written text. */
export function contributionWorking(base: CanonicalResult, edit: ContributionEdit): Working {
  const working = structuredClone(base.creation) as Working;
  working.fragments = structuredClone(edit.fragments);
  working.meta = {
    ...(working.meta ?? base.creation.meta),
    rating: edit.rating,
    tags: structuredClone(edit.tags),
  };
  if (edit.configuration !== undefined)
    for (const field of CONFIGURATION_FIELDS) {
      const value = edit.configuration[field];
      if (
        value === undefined ||
        (field === "assembly_tests" && Array.isArray(value) && !value.length)
      )
        delete working[field];
      else working[field] = structuredClone(value);
    }
  for (const field of COMPOSITION_FIELDS) {
    if (!Object.hasOwn(edit, field)) continue;
    const value = edit[field];
    if (value === undefined) delete working[field];
    else working[field] = structuredClone(value) as never;
  }
  return working;
}

function unsupported(field: string): never {
  throw new CharError({
    code: "contribution.unsupported_edit",
    subject: field,
    detail: `Changes to ${field} cannot be submitted by this editor.`,
  });
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function supportedRemainder(value: Record<string, unknown>) {
  const rest = { ...value };
  for (const field of [...COMPOSITION_FIELDS, ...CONFIGURATION_FIELDS, "fragments"])
    delete rest[field];
  const meta = { ...record(rest.meta) };
  delete meta.rating;
  delete meta.tags;
  rest.meta = meta;
  return rest;
}

/** Convert a UI Working value without canonicalizing incomplete objects or losing other fields. */
export function contributionEditFromWorking(
  base: CanonicalResult,
  working: Working,
): ContributionEdit {
  const before = supportedRemainder(base.creation);
  const after = supportedRemainder(working);
  for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[field] === undefined && after[field] === undefined) continue;
    if (
      before[field] === undefined ||
      after[field] === undefined ||
      digestOf(before[field]) !== digestOf(after[field])
    )
      unsupported(field);
  }
  if (working.story !== undefined) {
    const story = record(working.story);
    if (story.version !== 1) unsupported("story.version");
    for (const field of Object.keys(story))
      if (!["version", "vars", "knowing", ...Object.keys(STORY_LISTS)].includes(field))
        unsupported(`story.${field}`);
  }
  const meta = working.meta ?? base.creation.meta;
  return structuredClone({
    fragments: (working.fragments ?? []).map(withoutDigest),
    rating: meta.rating,
    tags: meta.tags ?? [],
    configuration: Object.fromEntries(
      CONFIGURATION_FIELDS.filter((field) => working[field] !== undefined).map((field) => [
        field,
        working[field],
      ]),
    ),
    ...Object.fromEntries(COMPOSITION_FIELDS.map((field) => [field, working[field]])),
  });
}

function objects(value: unknown, field: string, identity: "id" | "key" | "slot" = "id") {
  if (value === undefined) return new Map<string, Record<string, unknown>>();
  if (!Array.isArray(value))
    throw new CharError({ code: "contribution.invalid_objects", subject: field });
  const out = new Map<string, Record<string, unknown>>();
  for (const item of value) {
    const object = record(item);
    const id = object[identity];
    if (typeof id !== "string" || out.has(id))
      throw new CharError({
        code: "contribution.invalid_objects",
        subject: field,
        detail: "Every object needs a distinct stable ID.",
      });
    out.set(id, object);
  }
  return out;
}
function requireRepresentableOrder(
  before: readonly string[],
  after: readonly string[],
  field: string,
) {
  // Only Story lists have a wire order operation. Other object additions append.
  const expected = [
    ...before.filter((id) => after.includes(id)),
    ...after.filter((id) => !before.includes(id)),
  ];
  if (JSON.stringify(expected) !== JSON.stringify(after))
    throw new CharError({
      code: "contribution.unsupported_order",
      subject: field,
      detail: `Reordering ${field} cannot be submitted by this editor.`,
    });
}

function metadataChange(
  base: CanonicalResult,
  field: "meta.rating" | "meta.tags",
  after: JSONValue | undefined,
): unknown | null {
  const before = metaOf(base)[field.slice("meta.".length)];
  const sensitive = SENSITIVE_METADATA_FIELDS.includes(field);
  if (after === undefined) {
    if (before === undefined) return null;
    return { on: "metadata", field, op: "unset", base_digest: digestOf(before), sensitive };
  }
  if (before !== undefined && digestOf(before) === digestOf(after)) return null;
  return {
    on: "metadata",
    field,
    op: "set",
    ...(before === undefined ? {} : { base_digest: digestOf(before) }),
    after,
    sensitive,
  };
}

/** 比较基线与修改后的内容，生成变更列表；没有改动时返回空数组。 */
export function buildChanges(base: CanonicalResult, edit: ContributionEdit): unknown[] {
  const changes: unknown[] = [];
  const working = contributionWorking(base, edit);
  const edited = new Map(edit.fragments.map((f) => [f.id, f]));
  for (const f of base.creation.fragments) {
    const next = edited.get(f.id);
    if (!next) {
      changes.push({ on: "fragment", op: "remove", id: f.id, base_digest: f.digest });
      continue;
    }
    if (canonicalFragment(next).digest !== f.digest) {
      changes.push({
        on: "fragment",
        op: "modify",
        id: f.id,
        base_digest: f.digest,
        after: withoutDigest(next),
      });
    }
  }
  const existing = new Set(base.creation.fragments.map((f) => f.id));
  for (const f of edit.fragments) {
    if (!existing.has(f.id)) {
      changes.push({ on: "fragment", op: "add", id: f.id, after: withoutDigest(f) });
    }
  }
  const rating = metadataChange(base, "meta.rating", edit.rating);
  if (rating) changes.push(rating);
  // 空的标签列表在 canonical 形式中被省略：清空标签要写成 unset。
  const tags = metadataChange(base, "meta.tags", edit.tags.length > 0 ? edit.tags : undefined);
  if (tags) changes.push(tags);
  const objectChange = (
    address: Exclude<CompositionAddress, { on: "story-order" }>,
    after: unknown,
  ) => {
    const before = compositionValue(base.creation, address);
    const beforeDigest = compositionDigest(base.creation, address);
    if (before === undefined && after === undefined) return;
    if (after === undefined) {
      changes.push({ ...address, op: "remove", base_digest: beforeDigest });
      return;
    }
    let normalized = after;
    try {
      normalized = canonicalCompositionValue(address, after);
    } catch {
      // Incomplete authoring remains editable. The submit path performs full static checks.
    }
    if (beforeDigest !== undefined && digestOf(normalized) === beforeDigest) return;
    changes.push({
      ...address,
      op: before === undefined ? "add" : "modify",
      ...(beforeDigest !== undefined ? { base_digest: beforeDigest } : {}),
      after: structuredClone(after),
    });
  };
  if (Object.hasOwn(edit, "story")) {
    const oldStory = record(base.creation.story),
      nextStory = record(working.story);
    for (const [list, kind] of Object.entries(STORY_LISTS)) {
      const before = objects(oldStory[list], `story.${list}`);
      const after = objects(nextStory[list], `story.${list}`);
      for (const id of new Set([...before.keys(), ...after.keys()]))
        objectChange({ on: "story", kind, id }, after.get(id));
      const previousOrder = [...before.keys()],
        nextOrder = [...after.keys()];
      if (JSON.stringify(previousOrder) !== JSON.stringify(nextOrder)) {
        const address = { on: "story-order" as const, list: list as keyof typeof STORY_LISTS };
        changes.push({
          ...address,
          base_digest: compositionDigest(base.creation, address),
          after: nextOrder,
        });
      }
    }
    for (const [field, kind] of [
      ["vars", "var"],
      ["knowing", "knowing"],
    ] as const) {
      const before = record(oldStory[field]),
        after = record(nextStory[field]);
      for (const id of new Set([...Object.keys(before), ...Object.keys(after)]))
        objectChange({ on: "story", kind, id }, after[id]);
    }
  }
  for (const [field, on, identity] of [
    ["cast", "cast", "key"],
    ["groups", "group", "id"],
    ["sources", "source", "id"],
  ] as const) {
    if (!Object.hasOwn(edit, field)) continue;
    const before = objects(base.creation[field], field, identity);
    const after = objects(working[field], field, identity);
    requireRepresentableOrder([...before.keys()], [...after.keys()], field);
    for (const id of new Set([...before.keys(), ...after.keys()]))
      objectChange(on === "cast" ? { on, key: id } : { on, id }, after.get(id));
  }
  for (const [field, on, identity] of [
    ["references", "edge", "id"],
    ["assets", "asset", "slot"],
  ] as const) {
    if (!Object.hasOwn(edit, field)) continue;
    const before = objects(base.creation[field], field, identity);
    const after = objects(working[field], field, identity);
    requireRepresentableOrder([...before.keys()], [...after.keys()], field);
    const digest = (value: Record<string, unknown>) =>
      digestOf(
        on === "edge"
          ? canonicalEdge(value as Parameters<typeof canonicalEdge>[0])
          : canonicalAssetSlot(value as Parameters<typeof canonicalAssetSlot>[0]),
      );
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const old = before.get(id),
        next = after.get(id);
      const beforeDigest = old ? digest(old) : undefined;
      if (old && next && beforeDigest === digest(next)) continue;
      changes.push({
        on,
        [identity]: id,
        op: !next ? "remove" : old ? "modify" : "add",
        ...(beforeDigest ? { base_digest: beforeDigest } : {}),
        ...(next ? { after: structuredClone(next) } : {}),
      });
    }
  }
  if (edit.configuration !== undefined) {
    const proposed = working;
    let normalized: Record<string, unknown> = proposed;
    try {
      normalized = canonicalizeCreation(proposed).json as Record<string, unknown>;
    } catch {
      /* Incomplete edits remain local; the form validates before submission. */
    }
    for (const field of CONFIGURATION_FIELDS) {
      const before = (base.json as Record<string, JSONValue>)[field];
      const after = normalized[field] as JSONValue | undefined;
      if (before === undefined && after === undefined) continue;
      if (
        before !== undefined &&
        after !== undefined &&
        configurationDigest(field, before) === configurationDigest(field, after)
      )
        continue;
      changes.push({
        on: "configuration",
        field,
        op: after === undefined ? "unset" : "set",
        ...(before === undefined ? {} : { base_digest: configurationDigest(field, before) }),
        ...(after === undefined ? {} : { after }),
      });
    }
  }
  return changes;
}

/** 基线的 license 是自定义许可（包括保留所有权利）时，贡献者必须显式授权。 */
export function needsExplicitGrant(license: string): boolean {
  return /(^|[\s(])LicenseRef-/.test(license);
}

/** 变更比较键的可读说明，例如 `fragment:intro` → “Fragment #intro”。 */
export function describeKey(key: string): string {
  const [kind, ...rest] = key.split(":");
  const target = rest.join(":");
  switch (kind) {
    case "fragment":
      return `Fragment #${target}`;
    case "edge":
      return `Dependency ${target}`;
    case "asset":
      return `Asset ${target}`;
    case "cast":
      return `Cast ${target}`;
    case "group":
      return `Group ${target}`;
    case "source":
      return `Source ${target}`;
    case "story-order":
      return `Story order: ${target}`;
    case "story": {
      const separator = target.indexOf(":");
      if (separator < 0) return key;
      const kind = target.slice(0, separator),
        id = target.slice(separator + 1);
      const label =
        kind === "var"
          ? "Variable"
          : kind === "knowing"
            ? "Knowledge"
            : kind[0]?.toUpperCase() + kind.slice(1);
      return `${label} ${id}`;
    }
    case "configuration":
      return `Configuration: ${target.replaceAll("_", " ")}`;
    case "metadata":
      return target.replace(/^meta\./, "").replace(/_/g, " ");
    default:
      return key;
  }
}

/** 服务端返回的原始变更的比较键，用来把合并预览中的每一项对应回变更内容。 */
export function rawChangeKey(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  switch (c.on) {
    case "fragment":
    case "edge":
      return typeof c.id === "string" ? `${c.on}:${c.id}` : null;
    case "group":
    case "source":
      return typeof c.id === "string" ? `${c.on}:${c.id}` : null;
    case "cast":
      return typeof c.key === "string" ? `cast:${c.key}` : null;
    case "story":
      return typeof c.id === "string" &&
        typeof c.kind === "string" &&
        [...Object.values(STORY_LISTS), "var", "knowing"].includes(c.kind)
        ? `story:${c.kind}:${c.id}`
        : null;
    case "story-order":
      return typeof c.list === "string" && Object.hasOwn(STORY_LISTS, c.list)
        ? `story-order:${c.list}`
        : null;
    case "asset":
      if (typeof c.slot !== "string") return null;
      return typeof c.variant === "string" ? `asset:${c.slot}/${c.variant}` : `asset:${c.slot}`;
    case "configuration":
      return typeof c.field === "string" ? `configuration:${c.field}` : null;
    case "metadata":
      return typeof c.field === "string" ? `metadata:${c.field}` : null;
    default:
      return null;
  }
}

export type ChangeValue = { text: string } | { value: string };

function fragmentValue(f: unknown): ChangeValue {
  const content = (f as { content?: { type?: string; text?: string } }).content;
  if (content?.type === "text" && typeof content.text === "string") return { text: content.text };
  return { value: `${content?.type ?? "unknown"} content` };
}

function displayValue(v: unknown): ChangeValue {
  return { value: Array.isArray(v) ? v.join(", ") : typeof v === "string" ? v : JSON.stringify(v) };
}

/** 变更的新内容：文本 fragment 返回正文，其他返回可读的值；删除类变更返回 null。 */
export function changeAfter(raw: unknown): ChangeValue | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as { on?: string; after?: unknown };
  if (c.after === undefined) return null;
  if (c.on === "fragment") return fragmentValue(c.after);
  if (["story", "cast", "group", "source"].includes(c.on ?? ""))
    return { value: JSON.stringify(c.after, null, 2) };
  return displayValue(c.after);
}

/**
 * 草稿（书写形式的 Creation）里某个变更键现在的值，审阅时作为“改之前”显示。只认文本
 * fragment 和 `meta.*` 字段；草稿里没有这一项、或者是别的种类时返回 null。
 */
export function draftValue(working: unknown, key: string): ChangeValue | null {
  if (!working || typeof working !== "object") return null;
  const w = working as { fragments?: unknown; meta?: unknown };
  const [kind, ...rest] = key.split(":");
  const target = rest.join(":");
  if (kind === "story-order") {
    if (!Object.hasOwn(STORY_LISTS, target)) return null;
    const items = record((working as Working).story)[target];
    return { value: (Array.isArray(items) ? items.map((item) => record(item).id) : []).join(", ") };
  }
  if (kind === "story") {
    const split = target.indexOf(":");
    if (split < 0) return null;
    const type = target.slice(0, split),
      id = target.slice(split + 1);
    const story = record((working as Working).story);
    const list = Object.entries(STORY_LISTS).find(([, value]) => value === type)?.[0];
    const items = list ? story[list] : undefined;
    const value =
      type === "var"
        ? record(story.vars)[id]
        : type === "knowing"
          ? record(story.knowing)[id]
          : Array.isArray(items)
            ? items.find((item) => record(item).id === id)
            : undefined;
    return value === undefined ? null : { value: JSON.stringify(value, null, 2) };
  }
  if (["cast", "group", "source"].includes(kind ?? "")) {
    const list = (working as Working)[
      kind === "cast" ? "cast" : kind === "group" ? "groups" : "sources"
    ];
    const value = Array.isArray(list)
      ? list.find((item) => record(item)[kind === "cast" ? "key" : "id"] === target)
      : undefined;
    return value === undefined ? null : { value: JSON.stringify(value, null, 2) };
  }
  if (kind === "configuration") {
    const v = (working as Record<string, unknown>)[target];
    return v === undefined ? null : { value: JSON.stringify(v, null, 2) };
  }
  if (kind === "fragment") {
    if (!Array.isArray(w.fragments)) return null;
    const f = w.fragments.find((x) => (x as { id?: unknown } | null)?.id === target);
    return f ? fragmentValue(f) : null;
  }
  if (kind === "metadata" && target.startsWith("meta.")) {
    if (!w.meta || typeof w.meta !== "object") return null;
    const v = (w.meta as Record<string, unknown>)[target.slice("meta.".length)];
    return v === undefined ? null : displayValue(v);
  }
  return null;
}
