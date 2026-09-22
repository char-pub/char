/**
 * Context Diff：比较同一作品的两份 Context IR，回答“升级之后进入模型的内容变了什么”。
 *
 * fragment 按完整的 IR fragment ID（带 instance key）配对：
 * - 只在新 IR 中出现 → added；只在旧 IR 中出现 → removed；
 * - 两边都有但语义 digest 不同 → modified，并列出具体哪些字段变了；
 * - 两边都有但来源（Release、引用路径、override 链）不同 → origin_changes，即使内容没变。
 *
 * 另外比较依赖锁定（lock_changes）和作品级元数据（meta_changes）。rating 与 license
 * 的变化在 UI 中必须高亮，可以用 `isHighlightedMetaChange` 判断。
 *
 * 所有输出数组都按稳定键排序，同样的两份 IR 在任何运行时都得到同样的 Diff。
 */
import { jcs, normalizeValue } from "./canonical.js";
import { CharError, compareStrings } from "./errors.js";
import type { JSONValue } from "./schema/creation.js";
import type { ContextDiff, ContextIR, IRContent, IRFragment } from "./schema/ir.js";

export type DiffField = ContextDiff["fragments"]["modified"][number]["fields"][number];
export type MetaDiffField = ContextDiff["meta_changes"][number]["field"];

/** modified.fields 的固定输出顺序。 */
export const DIFF_FIELDS: readonly DiffField[] = [
  "content",
  "activation",
  "visibility",
  "importance",
  "placement_hint",
  "locales",
];

/** meta_changes 的固定输出顺序。 */
export const META_DIFF_FIELDS: readonly MetaDiffField[] = [
  "rating",
  "content_warnings",
  "licenses",
  "attribution",
  "contributors",
];

/** 一条依赖锁定：label 只用于展示，比较以 release 为准。 */
export interface LockLabel {
  ref: string;
  release: string;
  label?: string;
}

export interface DiffOptions {
  /**
   * 两边 Release 的依赖锁定。IR 本身只保存 lock 的 digest，所以要显示 label 时由调用方
   * 提供；不提供时改用 IR graph 中各依赖的 release ID 比较。
   */
  locks?: { from: readonly LockLabel[]; to: readonly LockLabel[] };
  /** 提供时计算 token_delta。必须是纯函数。 */
  countTokens?: (text: string) => number;
  /** token_delta 中标注的 tokenizer 名；缺省为 `estimate`。 */
  tokenizer?: string;
}

function canon(value: unknown): string {
  return value === undefined ? "" : jcs(normalizeValue(value));
}

function indexFragments(ir: ContextIR, side: string): Map<string, IRFragment> {
  const map = new Map<string, IRFragment>();
  for (const f of ir.fragments) {
    if (map.has(f.id)) {
      throw new CharError({
        code: "diff.duplicate_fragment",
        subject: f.id,
        detail: `the ${side} IR contains the same fragment id twice`,
      });
    }
    map.set(f.id, f);
  }
  return map;
}

function changedFields(a: IRFragment, b: IRFragment): DiffField[] {
  return DIFF_FIELDS.filter((field) => canon(a[field]) !== canon(b[field]));
}

/** 不提供 locks 时，从 graph.nodes 取依赖（不含根作品本身）。 */
function locksFromGraph(ir: ContextIR): LockLabel[] {
  return ir.graph.nodes
    .filter((n) => n.ref !== ir.root.ref)
    .map((n) => ({ ref: n.ref, release: n.release }));
}

/**
 * 依赖锁定的变化。`from` / `to` 显示 label，没有 label 时显示 release ID；
 * 只有 `to` 表示新增的依赖，只有 `from` 表示移除的依赖。
 */
function diffLocks(
  from: readonly LockLabel[],
  to: readonly LockLabel[],
): ContextDiff["lock_changes"] {
  const toMap = (list: readonly LockLabel[]) => new Map(list.map((l) => [l.ref, l]));
  const a = toMap(from);
  const b = toMap(to);
  const refs = [...new Set([...a.keys(), ...b.keys()])].sort(compareStrings);
  const out: ContextDiff["lock_changes"] = [];
  for (const ref of refs) {
    const x = a.get(ref);
    const y = b.get(ref);
    if (x && y && x.release === y.release) continue;
    const entry: ContextDiff["lock_changes"][number] = { ref };
    if (x) entry.from = x.label ?? x.release;
    if (y) entry.to = y.label ?? y.release;
    out.push(entry);
  }
  return out;
}

/**
 * IR 内容的纯文本形式，用于估算 token。dialogue 按 `说话人: 文本` 逐行拼接；
 * media 只计算说明文字；structured 按 canonical JSON 计算。
 */
export function irContentText(content: IRContent): string {
  switch (content.type) {
    case "text":
      return content.text;
    case "dialogue":
      return content.turns.map((t) => `${t.speaker}: ${t.text}`).join("\n");
    case "media":
      return content.caption ?? "";
    case "structured":
      return jcs(normalizeValue(content.data));
  }
}

function isAlwaysIncluded(f: IRFragment): boolean {
  return f.importance === "pinned" || f.activation.mode === "always";
}

/**
 * - always：一定会进入模型的 fragment（always 激活或 pinned）的 token 变化。
 * - potential：所有 fragment 的 token 变化，也就是最坏情况下（关键词全部命中、
 *   semantic 与 manual 都被启用）可能进入模型的内容的上界变化。
 * 只统计默认 locale 的内容。
 */
function tokenDelta(
  from: ContextIR,
  to: ContextIR,
  count: (text: string) => number,
  tokenizer: string,
): NonNullable<ContextDiff["token_delta"]> {
  const sum = (ir: ContextIR, pick: (f: IRFragment) => boolean) =>
    ir.fragments.filter(pick).reduce((n, f) => n + count(irContentText(f.content)), 0);
  return {
    tokenizer,
    always: sum(to, isAlwaysIncluded) - sum(from, isAlwaysIncluded),
    potential: sum(to, () => true) - sum(from, () => true),
  };
}

export function diffContextIR(from: ContextIR, to: ContextIR, opts: DiffOptions = {}): ContextDiff {
  const a = indexFragments(from, "from");
  const b = indexFragments(to, "to");

  const added = [...b.keys()].filter((id) => !a.has(id)).sort(compareStrings);
  const removed = [...a.keys()].filter((id) => !b.has(id)).sort(compareStrings);
  const common = [...a.keys()].filter((id) => b.has(id)).sort(compareStrings);

  const modified: ContextDiff["fragments"]["modified"] = [];
  const origin_changes: ContextDiff["origin_changes"] = [];
  for (const id of common) {
    const x = a.get(id) as IRFragment;
    const y = b.get(id) as IRFragment;
    if (x.digest !== y.digest) modified.push({ id, fields: changedFields(x, y) });
    if (canon(x.origin) !== canon(y.origin)) {
      origin_changes.push({ id, from: x.origin, to: y.origin });
    }
  }

  const meta_changes: ContextDiff["meta_changes"] = [];
  for (const field of META_DIFF_FIELDS) {
    if (canon(from.meta[field]) !== canon(to.meta[field])) {
      meta_changes.push({
        field,
        from: normalizeValue(from.meta[field]) as JSONValue,
        to: normalizeValue(to.meta[field]) as JSONValue,
      });
    }
  }

  const locks = opts.locks ?? { from: locksFromGraph(from), to: locksFromGraph(to) };
  const diff: ContextDiff = {
    from: { root: from.root.ref, lock_digest: from.lock_digest },
    to: { root: to.root.ref, lock_digest: to.lock_digest },
    lock_changes: diffLocks(locks.from, locks.to),
    fragments: { added, removed, modified },
    origin_changes,
    meta_changes,
  };
  if (opts.countTokens) {
    diff.token_delta = tokenDelta(from, to, opts.countTokens, opts.tokenizer ?? "estimate");
  }
  return diff;
}

/** rating 与 license 的变化必须在 UI 中高亮，不能和普通变化混在一起。 */
export function isHighlightedMetaChange(change: ContextDiff["meta_changes"][number]): boolean {
  return change.field === "rating" || change.field === "licenses";
}
