/**
 * Locale 选择：按 BCP 47 的 lookup 规则逐级截短语言标签来匹配，
 * 例如 `zh-Hant-TW` 依次尝试 `zh-Hant-TW`、`zh-Hant`、`zh`。比较时不区分大小写。
 */
import { compareStrings, type LocalizedText } from "@char-pub/core";

function sameTag(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** 候选标签：从完整标签开始逐级去掉末尾子标签；单字符子标签（扩展前缀）随后一段一起去掉。 */
export function lookupChain(tag: string): string[] {
  const parts = tag.split("-");
  const out: string[] = [];
  for (let n = parts.length; n > 0; n--) {
    if (n < parts.length && (parts[n - 1]?.length ?? 0) === 1) continue;
    out.push(parts.slice(0, n).join("-"));
  }
  return out;
}

/**
 * 在 available 中找与 wanted 匹配的标签，返回 available 中的原始写法；找不到返回 null。
 */
export function matchLocale(available: readonly string[], wanted: string): string | null {
  for (const candidate of lookupChain(wanted)) {
    const hit = available.find((a) => sameTag(a, candidate));
    if (hit !== undefined) return hit;
  }
  return null;
}

/**
 * 可本地化文本取值：先按目标 locale 匹配，再按默认 locale，最后取键排序后的第一个，
 * 保证结果与对象键的书写顺序无关。
 */
export function localizedString(
  text: LocalizedText,
  locale: string,
  defaultLocale: string,
): string {
  if (typeof text === "string") return text;
  const keys = Object.keys(text).sort(compareStrings);
  const key = matchLocale(keys, locale) ?? matchLocale(keys, defaultLocale) ?? keys[0];
  return key === undefined ? "" : (text[key] ?? "");
}
