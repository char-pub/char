/**
 * Context Preview 的计算部分：给定 IR 与界面上的 Session 设置，调用参考 Assembler，
 * 得到 Trace 或一个可以展示给用户的错误。与 React 无关，便于单独测试。
 */
import {
  type AssembleResult,
  assemble,
  estimateCounter,
  type LateBindingValue,
  type TokenCounter,
} from "@char-pub/assembler";
import { type ContextIR, isCharError, type ResolvedPreset, USER_LATE_SLOT } from "@char-pub/core";

export interface PreviewSettings {
  locale: string;
  mode: "narrator" | "per-agent";
  contextWindow: number;
  reserveForOutput: number;
  persona: { name: string; description: string };
  /** 每行一条消息，以 `user:` 或 `assistant:` 开头；没有前缀的按 user 处理。 */
  historyText: string;
  manualEnabled: string[];
  lateBindings?: Record<string, { name: string; description: string; kind: string }>;
  forParticipant?: string;
}

export const DEFAULT_SETTINGS: PreviewSettings = {
  locale: "en",
  mode: "narrator",
  contextWindow: 8192,
  reserveForOutput: 1024,
  persona: { name: "Sam", description: "" },
  historyText: "user: Have you heard what Arasaka is planning?",
  manualEnabled: [],
};

export type PreviewOutcome =
  | { ok: true; result: AssembleResult }
  | { ok: false; code: string; title: string; detail: string };

export function parseHistory(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const m = /^(user|assistant)\s*:\s*(.*)$/i.exec(line);
      if (!m) return { role: "user" as const, text: line };
      const role = m[1]?.toLowerCase() === "assistant" ? ("assistant" as const) : ("user" as const);
      return { role, text: m[2] ?? "" };
    });
}

/**
 * 为界面生成 late slot 绑定：隐式用户绑定到界面上填写的 Persona；其他 late slot
 * 必须由用户逐槽填写，不能用同一个 Persona 隐式填满。
 */
export function bindingsFor(
  ir: ContextIR,
  persona: PreviewSettings["persona"],
  bindings: NonNullable<PreviewSettings["lateBindings"]> = {},
): Record<string, LateBindingValue> {
  const out: Record<string, LateBindingValue> = {};
  for (const slot of ir.late_slots) {
    const explicit = bindings[slot.key];
    const selected =
      explicit ?? (slot.key === USER_LATE_SLOT ? { ...persona, kind: "persona" } : undefined);
    if (!selected?.name.trim()) continue;
    out[slot.key] = {
      kind: selected.kind as LateBindingValue["kind"],
      display_name: selected.name.trim(),
      ...(selected.description.trim() ? { description: selected.description.trim() } : {}),
    };
  }
  return out;
}

const FRIENDLY: Record<string, { title: string; hint: string }> = {
  "assemble.pinned_over_budget": {
    title: "Pinned content does not fit",
    hint: "Pinned fragments are never cut. Raise the context window or unpin something.",
  },
  "assemble.late_slot_unbound": {
    title: "A required role is not bound",
    hint: "Fill in a name for each required role in the Session controls.",
  },
  "assemble.late_slot_kind_mismatch": {
    title: "Wrong kind of binding",
    hint: "This slot needs a different kind of character or persona.",
  },
};

export function runPreview(
  ir: ContextIR,
  settings: PreviewSettings,
  counter: TokenCounter = estimateCounter,
  preset?: ResolvedPreset,
): PreviewOutcome {
  try {
    const result = assemble({
      ir,
      counter,
      ...(preset ? { preset } : {}),
      profile: {
        runtime: { name: "char.pub playground", version: "0" },
        tokenizer: counter.tokenizer,
        context_window: settings.contextWindow,
        reserve_for_output: settings.reserveForOutput,
        mode: settings.mode,
        capabilities: { images: false, system_role: true, multiple_system_messages: true },
        locale: settings.locale,
      },
      session: {
        ...(settings.mode === "per-agent" && settings.forParticipant
          ? { for_participant: settings.forParticipant }
          : {}),
        locale: settings.locale,
        bindings: bindingsFor(ir, settings.persona, settings.lateBindings),
        history: parseHistory(settings.historyText),
        manual_enabled: settings.manualEnabled,
      },
    });
    return { ok: true, result };
  } catch (e) {
    if (!isCharError(e)) throw e;
    const friendly = FRIENDLY[e.code];
    return {
      ok: false,
      code: e.code,
      title: friendly?.title ?? "The context could not be assembled",
      detail: friendly
        ? `${friendly.hint}${e.detail ? ` (${e.detail})` : ""}`
        : (e.detail ?? e.subject),
    };
  }
}
