/**
 * Assembler 用例的运行与比较。纯函数，可以在 Node、浏览器和 workerd 中运行。
 *
 * 一个用例有若干命名场景（Runtime Profile + Session）。每个场景先用 Resolver 得到 IR，再用
 * 参考 Assembler 组装一次，结果只保留 Trace 中每个 entry 的 `id`、`decision`、`reason`：
 * token 数取决于 tokenizer，region 取决于 layout，都不属于规范要求。组装失败时记录错误码。
 *
 * 另有一条与 Trace 无关的硬性要求：组装成功时，发给模型的消息里不能残留 `{{late:*}}`
 * 占位符。违反时整个用例直接失败，与预期是否审阅无关。
 */
import { assemble } from "@char-pub/assembler";
import { type ContextIR, isCharError } from "@char-pub/core";
import type { AssembleInput, ScenarioResult, TraceDecision, TraceExpectation } from "./types.js";

export interface AssembleOutcome {
  expectation: TraceExpectation;
  /** 违反硬性要求的场景说明；为空表示没有违反。 */
  violations: string[];
}

export function runAssembleScenarios(ir: ContextIR, input: AssembleInput): AssembleOutcome {
  const scenarios: ScenarioResult[] = [];
  const violations: string[] = [];
  for (const s of input.scenarios) {
    try {
      const out = assemble({
        ir,
        profile: s.profile as Parameters<typeof assemble>[0]["profile"],
        session: s.session as Parameters<typeof assemble>[0]["session"],
      });
      const entries: TraceDecision[] = out.trace.entries.map((e) => ({
        id: e.id,
        decision: e.decision,
        reason: e.reason,
      }));
      scenarios.push({ name: s.name, entries });
      for (const m of out.messages) {
        if (m.content.includes("{{late:")) {
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
