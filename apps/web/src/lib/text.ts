/** 展示用的小工具：可本地化文本、`@ns/name` 解析、时间格式。 */
import type { LocalizedText } from "@char-pub/core";

/** 取可本地化文本在当前语言下的值；没有对应语言时取第一个。 */
export function localized(text: LocalizedText | undefined, locale?: string): string {
  if (text === undefined) return "";
  if (typeof text === "string") return text;
  const lang = locale ?? (typeof navigator === "undefined" ? "en" : navigator.language);
  const base = lang.split("-")[0] ?? lang;
  return text[lang] ?? text[base] ?? Object.values(text)[0] ?? "";
}

export function parseRef(ref: string): { ns: string; name: string } | null {
  const m = /^@([a-z0-9-]+)\/([a-z0-9][a-z0-9-]*)$/.exec(ref);
  return m?.[1] && m[2] ? { ns: m[1], name: m[2] } : null;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/** 从显示名推导 URL 用的 slug：小写 ASCII、数字与连字符；推导不出时返回空字符串。 */
export function slugify(text: string, max = 64): string {
  return text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}
