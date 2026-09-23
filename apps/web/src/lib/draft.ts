/**
 * 编辑器对草稿（书写形式的 Creation JSON）的读写。所有函数都返回新对象，不修改输入；
 * 草稿里编辑器不认识的字段原样保留。`id`、`ref`、`type` 由服务端决定，这里不改。
 */
import type {
  AssetSlot,
  CreationMeta,
  CreationType,
  Fragment,
  FragmentKind,
  Greeting,
  ReferenceEdge,
} from "@char-pub/core";

export type Working = Record<string, unknown> & {
  display_name?: unknown;
  summary?: unknown;
  fragments?: Fragment[];
  references?: ReferenceEdge[];
  assets?: AssetSlot[];
  bootstrap?: { greetings: Greeting[] };
  meta?: CreationMeta;
};

export const AVATAR_SLOT = "avatar";

/** 编辑器里的单语言文本：可本地化文本只编辑默认语言那一份。 */
function textOf(v: unknown, locale: string): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const r = v as Record<string, string>;
    return r[locale] ?? Object.values(r)[0] ?? "";
  }
  return "";
}

function withText(prev: unknown, locale: string, text: string): unknown {
  if (prev && typeof prev === "object") return { ...(prev as object), [locale]: text };
  return text;
}

export function localeOf(w: Working): string {
  return w.meta?.default_locale ?? "en";
}

export function getName(w: Working): string {
  return textOf(w.display_name, localeOf(w));
}

export function setName(w: Working, name: string): Working {
  return { ...w, display_name: withText(w.display_name, localeOf(w), name) };
}

export function getSummary(w: Working): string {
  return textOf(w.summary, localeOf(w));
}

export function setSummary(w: Working, summary: string): Working {
  if (summary === "") {
    const { summary: _, ...rest } = w;
    return rest;
  }
  return { ...w, summary: withText(w.summary, localeOf(w), summary) };
}

export function getGreeting(w: Working): string {
  return w.bootstrap?.greetings[0]?.text ?? "";
}

/** 第一条问候语是默认问候语；清空时移除它（其余的保留）。 */
export function setGreeting(w: Working, text: string): Working {
  const rest = w.bootstrap?.greetings.slice(1) ?? [];
  const first = w.bootstrap?.greetings[0];
  if (text === "") {
    if (rest.length === 0) {
      const { bootstrap: _, ...others } = w;
      return others;
    }
    return { ...w, bootstrap: { greetings: rest } };
  }
  const greeting: Greeting = first ? { ...first, text } : { id: "default", text };
  return { ...w, bootstrap: { greetings: [greeting, ...rest] } };
}

export interface BlobInfo {
  digest: `sha256:${string}`;
  size: number;
  media_type: string;
}

export function getAvatar(w: Working): AssetSlot | undefined {
  return w.assets?.find((a) => a.slot === AVATAR_SLOT);
}

/** 设置头像：一个只用于展示的 asset slot，默认变体指向上传后的 blob。 */
export function setAvatar(w: Working, blob: BlobInfo | null, alt?: string): Working {
  const others = (w.assets ?? []).filter((a) => a.slot !== AVATAR_SLOT);
  if (!blob) return { ...w, assets: others };
  const slot: AssetSlot = {
    slot: AVATAR_SLOT,
    role: "presentation",
    variants: [
      {
        id: "default",
        blob: { digest: blob.digest, size: blob.size, availability: "mirrored" },
        media_type: blob.media_type,
        ...(alt ? { alt } : {}),
      },
    ],
  };
  return { ...w, assets: [slot, ...others] };
}

export function getFragments(w: Working): Fragment[] {
  return w.fragments ?? [];
}

/**
 * 每种类型至少需要一个对应种类的 fragment（角色需要 character，世界需要 world，
 * 世界书需要 knowledge）。编辑器第一层的“正文”字段就是这个 fragment。
 */
export const MAIN_FRAGMENT: Partial<Record<CreationType, { id: string; kind: FragmentKind }>> = {
  character: { id: "description", kind: "character" },
  world: { id: "world", kind: "world" },
  lorebook: { id: "lore/entry", kind: "knowledge" },
};

function mainIndex(w: Working, type: CreationType): number {
  const main = MAIN_FRAGMENT[type];
  if (!main) return -1;
  const list = getFragments(w);
  const byId = list.findIndex((f) => f.id === main.id);
  return byId >= 0 ? byId : list.findIndex((f) => f.kind === main.kind);
}

export function getMainText(w: Working, type: CreationType): string {
  const f = getFragments(w)[mainIndex(w, type)];
  return f?.content.type === "text" ? f.content.text : "";
}

/** 写入正文；清空时移除这个 fragment（服务端的检查会提示它是必需的）。 */
export function setMainText(w: Working, type: CreationType, text: string): Working {
  const main = MAIN_FRAGMENT[type];
  if (!main) return w;
  const list = [...getFragments(w)];
  const i = mainIndex(w, type);
  const current = list[i];
  if (text === "") {
    if (i >= 0) list.splice(i, 1);
  } else if (current && current.content.type === "text") {
    list[i] = { ...current, content: { ...current.content, text } };
  } else if (i < 0) {
    list.unshift({ ...newFragment(main.id, main.kind), content: { type: "text", text } });
  }
  return setFragments(w, list);
}

export function setFragments(w: Working, fragments: Fragment[]): Working {
  return { ...w, fragments };
}

/** 新 fragment 的默认值：文本内容、总是激活。 */
export function newFragment(id: string, kind: FragmentKind): Fragment {
  return { id, stable: true, kind, content: { type: "text", text: "" } };
}

export function getReferences(w: Working): ReferenceEdge[] {
  return w.references ?? [];
}

export function setReferences(w: Working, references: ReferenceEdge[]): Working {
  return { ...w, references };
}

export function getMeta(w: Working): CreationMeta {
  return (
    w.meta ?? {
      default_locale: "en",
      rating: "general",
      rights: "original",
      license: "LicenseRef-All-Rights-Reserved",
    }
  );
}

export function setMeta(w: Working, patch: Partial<CreationMeta>): Working {
  const next: Record<string, unknown> = { ...getMeta(w), ...patch };
  // 空数组与未设置等价，不写进草稿，避免产生无意义的 digest 变化。
  for (const k of ["tags", "content_warnings"]) {
    const v = next[k];
    if (Array.isArray(v) && v.length === 0) delete next[k];
  }
  if (next.contribution_policy === undefined) delete next.contribution_policy;
  return { ...w, meta: next as CreationMeta };
}

/** 逗号或换行分隔的列表输入。 */
export function splitList(s: string): string[] {
  return s
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** 下一个可用的 fragment ID：`<prefix>`、`<prefix>-2`、`<prefix>-3`…… */
export function nextId(taken: readonly string[], prefix: string): string {
  if (!taken.includes(prefix)) return prefix;
  for (let i = 2; ; i++) {
    const id = `${prefix}-${i}`;
    if (!taken.includes(id)) return id;
  }
}
