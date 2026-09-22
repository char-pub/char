/**
 * 激活判定：决定一个 fragment 这一轮是否成为候选。
 *
 * - always：总是候选。
 * - keyword：扫描最近若干条对话，主关键词任一命中即可；如果写了 secondary，还要按
 *   logic 满足 secondary（any：至少一个命中；all：全部命中）。
 * - semantic：参考实现不做语义检索，按 manual 处理（显式启用才加入）。
 * - manual：只有 Session 显式启用时才加入。
 *
 * importance 为 pinned 的 fragment 不管激活方式如何，总是候选。
 */
import type { Activation } from "@char-pub/core";
import type { HistoryMessage } from "./session.js";

/**
 * keyword 默认只扫描最近 2 条消息。这与 SillyTavern World Info 的默认扫描深度一致，
 * 从 CCv3 导入的 lorebook 因此能保持原来的触发行为。
 */
export const DEFAULT_SCAN_DEPTH = 2;

export type ActivationResult =
  | { active: true; reason: "always" | "pinned" | "manual" | `keyword:${string}` }
  | { active: false; reason: "inactive" | "semantic" };

type KeywordActivation = Extract<Activation, { mode: "keyword" }>;

/** 取最近 depth 条消息的文本，做 NFC 归一，按时间顺序用换行拼接。 */
export function scanWindow(history: readonly HistoryMessage[], depth: number): string {
  const start = Math.max(0, history.length - depth);
  return history
    .slice(start)
    .map((m) => m.text.normalize("NFC"))
    .join("\n");
}

/** 字母或数字。whole_word 模式下，关键词两侧不能紧贴这类字符。 */
const WORD_CHAR = /[\p{L}\p{N}_]/u;

/**
 * 判断 key 是否出现在 text 中。大小写不敏感时两边都转小写（toLowerCase 与运行环境的
 * locale 无关，保证各运行时结果一致）。
 *
 * whole_word 按“两侧不是字母或数字”判断边界。中文、日文没有空格分词，开启 whole_word
 * 后通常匹配不到，这和 SillyTavern 的行为一致；这类语言应保持默认的 whole_word = false。
 */
export function containsKey(
  text: string,
  key: string,
  opts: { caseSensitive: boolean; wholeWord: boolean },
): boolean {
  const needle = opts.caseSensitive ? key.normalize("NFC") : key.normalize("NFC").toLowerCase();
  const hay = opts.caseSensitive ? text : text.toLowerCase();
  if (needle.length === 0) return false;
  let from = 0;
  for (;;) {
    const i = hay.indexOf(needle, from);
    if (i < 0) return false;
    if (!opts.wholeWord) return true;
    const before = i === 0 ? "" : (hay[i - 1] ?? "");
    const after = hay[i + needle.length] ?? "";
    if (!WORD_CHAR.test(before) && !WORD_CHAR.test(after)) return true;
    from = i + 1;
  }
}

/** keyword 激活命中时返回第一个命中的主关键词（按声明顺序），否则返回 null。 */
export function matchKeyword(
  a: KeywordActivation,
  history: readonly HistoryMessage[],
): string | null {
  const text = scanWindow(history, a.scan_depth ?? DEFAULT_SCAN_DEPTH);
  if (text.length === 0) return null;
  const opts = { caseSensitive: a.case_sensitive ?? false, wholeWord: a.whole_word ?? false };
  const hit = a.keys.find((k) => containsKey(text, k, opts));
  if (hit === undefined) return null;
  const secondary = a.secondary ?? [];
  if (secondary.length > 0) {
    const matches = secondary.map((k) => containsKey(text, k, opts));
    const ok = (a.logic ?? "any") === "all" ? matches.every(Boolean) : matches.some(Boolean);
    if (!ok) return null;
  }
  return hit;
}

export function evaluateActivation(
  activation: Activation,
  pinned: boolean,
  manuallyEnabled: boolean,
  history: readonly HistoryMessage[],
): ActivationResult {
  if (pinned) return { active: true, reason: "pinned" };
  switch (activation.mode) {
    case "always":
      return { active: true, reason: "always" };
    case "keyword": {
      const hit = matchKeyword(activation, history);
      return hit === null
        ? { active: false, reason: "inactive" }
        : { active: true, reason: `keyword:${hit}` };
    }
    case "semantic":
      // 不支持语义检索：显式启用时按 manual 加入；否则跳过，并用 semantic 说明原因。
      return manuallyEnabled
        ? { active: true, reason: "manual" }
        : { active: false, reason: "semantic" };
    case "manual":
      return manuallyEnabled
        ? { active: true, reason: "manual" }
        : { active: false, reason: "inactive" };
  }
}
