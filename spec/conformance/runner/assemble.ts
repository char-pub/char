/**
 * Assembler 用例的运行与比较。纯函数，可以在 Node、浏览器和 workerd 中运行。
 *
 * 一个用例有若干命名场景（Runtime Profile + Session）。每个场景先用 Resolver 得到 IR，再用
 * 参考 Assembler 组装一次，结果只保留 Trace 中每个 entry 的 `id`、`decision`、`reason`：
 * token 数取决于 tokenizer，region 取决于 layout，都不属于规范要求。组装失败时记录错误码。
 *
 * 另有一条与 Trace 无关的硬性要求：组装成功时，Creative / Session 消息里不能残留
 * `{{late:*}}` 占位符。Policy 是字面文本，按实际 source 边界排除，不能跳过整条合并消息。
 * 违反时整个用例直接失败，与预期是否审阅无关。
 */
import { type AssembledMessage, assemble } from "@char-pub/assembler";
import { type ContextIR, isCharError, type ResolvedPreset, resolvePreset } from "@char-pub/core";
import type { AssembleInput, ScenarioResult, TraceDecision, TraceExpectation } from "./types.js";

export interface AssembleOutcome {
  expectation: TraceExpectation;
  /** 违反硬性要求的场景说明；为空表示没有违反。 */
  violations: string[];
}

/**
 * 首版 Policy 只在消息序列的开头与末尾加入；合并 system 后仍是已知的前缀或后缀。
 * 逐个 source 验证字节与分隔符后剥离，保留中间 Creative / Session 内容供门禁检查。
 * 不能全局替换文本：正文可能恰好包含和 Policy 完全相同的未替换占位符。
 */
function nonPolicyText(message: AssembledMessage, preset: ResolvedPreset | undefined): string {
  if (!preset) return message.content;
  const literals = new Map(
    preset.policy.blocks
      .filter((block) => block.enabled !== false)
      .map((block) => [`preset:${block.id}`, block.text]),
  );
  const sources = [...message.source];
  let text = message.content;
  while (sources.length > 0) {
    const literal = literals.get(sources[0] as string);
    if (literal === undefined) break;
    if (!text.startsWith(literal)) return message.content;
    text = text.slice(literal.length);
    sources.shift();
    if (sources.length > 0) {
      if (!text.startsWith("\n\n")) return message.content;
      text = text.slice(2);
    }
  }
  while (sources.length > 0) {
    const literal = literals.get(sources.at(-1) as string);
    if (literal === undefined) break;
    if (!text.endsWith(literal)) return message.content;
    text = text.slice(0, -literal.length);
    sources.pop();
    if (sources.length > 0) {
      if (!text.endsWith("\n\n")) return message.content;
      text = text.slice(0, -2);
    }
  }
  return text;
}

export function runAssembleScenarios(ir: ContextIR, input: AssembleInput): AssembleOutcome {
  const scenarios: ScenarioResult[] = [];
  const violations: string[] = [];
  for (const s of input.scenarios) {
    try {
      const preset = s.preset ? resolvePreset(s.preset) : undefined;
      const out = assemble({
        ir,
        profile: s.profile as Parameters<typeof assemble>[0]["profile"],
        session: s.session as Parameters<typeof assemble>[0]["session"],
        ...(preset ? { preset } : {}),
      });
      const entries: TraceDecision[] = out.trace.entries.map((e) => ({
        id: e.id,
        decision: e.decision,
        reason: e.reason,
      }));
      scenarios.push({ name: s.name, entries });
      for (const m of out.messages) {
        if (nonPolicyText(m, preset).includes("{{late:")) {
          violations.push(`${s.name}: a {{late:*}} placeholder reached the model messages`);
          break;
        }
      }
    } catch (e) {
      if (!isCharError(e)) throw e;
      scenarios.push({ name: s.name, error: { code: e.code } });
    }
  }
  return { expectation: { scenarios }, violations };
}

/** 比较两份 Trace 预期；返回第一处不同的说明，相同时返回 null。 */
export function compareTraces(expected: TraceExpectation, actual: TraceExpectation): string | null {
  if (expected.scenarios.length !== actual.scenarios.length) {
    return `expected ${expected.scenarios.length} scenarios, got ${actual.scenarios.length}`;
  }
  for (let i = 0; i < expected.scenarios.length; i++) {
    const want = expected.scenarios[i];
    const got = actual.scenarios[i];
    if (!want || !got) continue;
    if (want.name !== got.name) return `scenario ${i}: expected "${want.name}", got "${got.name}"`;
    if ("error" in want || "error" in got) {
      const w = "error" in want ? want.error.code : "a trace";
      const g = "error" in got ? got.error.code : "a trace";
      if (w !== g) return `${want.name}: expected ${w}, got ${g}`;
      continue;
    }
    if (want.entries.length !== got.entries.length) {
      return `${want.name}: expected ${want.entries.length} entries, got ${got.entries.length}`;
    }
    for (let j = 0; j < want.entries.length; j++) {
      const a = want.entries[j];
      const b = got.entries[j];
      if (!a || !b) continue;
      if (a.id !== b.id || a.decision !== b.decision || a.reason !== b.reason) {
        return `${want.name} entry ${j}: expected ${a.id} ${a.decision}/${a.reason}, got ${b.id} ${b.decision}/${b.reason}`;
      }
    }
  }
  return null;
}
