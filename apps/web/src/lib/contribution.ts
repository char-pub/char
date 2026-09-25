/**
 * 在浏览器里把贡献者的修改变成 Contribution 的变更列表。
 *
 * 基线是贡献者看到的那个 Release 的 canonical Creation。每个变更都带上它在基线里的
 * digest（`base_digest`），服务端据此做三方合并：作者之后改过的其他内容会被保留，
 * 两边改了同一处才算冲突。这里只生成编辑界面能改的几类变更：文本 fragment 的新增、
 * 修改与删除，以及评级和标签。
 *
 * 变更是否敏感由服务端计算；这里填写的 `sensitive` 只是为了满足请求格式。
 */
import {
  type CanonicalResult,
  canonicalFragment,
  canonicalizeCreation,
  digestOf,
  type Fragment,
  type JSONValue,
  type Rating,
  SENSITIVE_METADATA_FIELDS,
} from "@char-pub/core";

export const CONFIGURATION_FIELDS = [
  "policy",
  "prompt_module",
  "assembly",
  "assembly_tests",
] as const;

/** 贡献者可以编辑的内容。 */
export interface ContributionEdit {
  fragments: Fragment[];
  rating: Rating;
  tags: string[];
  configuration?: Record<string, unknown>;
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
    edit: {
      fragments: canonical.creation.fragments.map(withoutDigest),
      rating: meta.rating,
      tags: [...(meta.tags ?? [])],
      configuration: Object.fromEntries(
        CONFIGURATION_FIELDS.filter((field) => canonical.creation[field] !== undefined).map(
          (field) => [field, canonical.creation[field]],
        ),
      ),
    },
  };
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
  if (edit.configuration !== undefined) {
    const proposed = { ...base.creation } as Record<string, unknown>;
    for (const field of CONFIGURATION_FIELDS) {
      if (
        edit.configuration[field] === undefined ||
        (field === "assembly_tests" &&
          Array.isArray(edit.configuration[field]) &&
          edit.configuration[field].length === 0)
      )
        delete proposed[field];
      else proposed[field] = edit.configuration[field];
    }
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
      if (before !== undefined && after !== undefined && digestOf(before) === digestOf(after))
        continue;
      changes.push({
        on: "configuration",
        field,
        op: after === undefined ? "unset" : "set",
        ...(before === undefined ? {} : { base_digest: digestOf(before) }),
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
