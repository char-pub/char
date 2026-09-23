/**
 * 一致性测试：同一个文件分别在 Node、浏览器（Chromium）和 workerd 中运行。
 *
 * - reviewed 用例：严格比较实现输出与人工审阅过的预期结果。
 * - draft 用例：只确认能运行（并满足与审阅无关的硬性要求），比较标记为 todo，等待审阅。
 *
 * 最后一个测试在当前运行时里重新计算每个 reviewed Context IR 用例的 digest，并与
 * case.json 中记录的预期 digest 比较。三个运行时都通过，就说明它们输出的字节完全相同。
 */
import { describe, expect, it } from "vitest";
import bundleJson from "./cases.gen.json" with { type: "json" };
import { judge, runCase, textDigest, validateInput } from "./run.js";
import type { Bundle } from "./types.js";

const bundle = bundleJson as unknown as Bundle;

function runtimeName(): string {
  const ua = globalThis.navigator?.userAgent ?? "";
  if (ua.includes("Cloudflare-Workers")) return "workerd";
  if (typeof globalThis.document !== "undefined") {
    const chrome = /(?:Headless)?Chrome\/[\d.]+/.exec(ua)?.[0];
    return `browser ${chrome ?? ua}`;
  }
  return `node ${globalThis.process?.version ?? ""}`.trim();
}

describe(`conformance suite on ${runtimeName()}`, () => {
  it("bundle is not empty", () => {
    expect(bundle.format).toBe(1);
    expect(bundle.cases.length).toBeGreaterThan(0);
  });

  for (const c of bundle.cases) {
    const { meta } = c;
    const label = `${c.dir}: ${meta.title}`;

    if (meta.status !== "reviewed") {
      it(`${c.dir}: runs without crashing (draft)`, () => {
        expect(validateInput(c)).toEqual([]);
        const actual = runCase(c);
        expect(actual.kind).not.toBe("unsupported");
        const verdict = judge(c, actual);
        expect(verdict.status, verdict.message).toBe("draft");
      });
      it.todo(`${label} (expected output awaiting human review)`);
      continue;
    }

    it(label, () => {
      const verdict = judge(c, runCase(c));
      expect(verdict.status, verdict.message).toBe("pass");
    });
  }

  it("reviewed Context IR cases hash to the recorded digest in this runtime", () => {
    const rows: string[] = [];
    for (const c of bundle.cases) {
      if (c.meta.status !== "reviewed" || c.meta.expect !== "context-ir") continue;
      const actual = runCase(c);
      expect(actual.kind, c.dir).toBe("context-ir");
      if (actual.kind !== "context-ir") continue;
      expect(textDigest(actual.text), c.dir).toBe(c.meta.expected_digest);
      rows.push(`${c.dir} ${actual.digest}`);
    }
    console.log(
      `[${runtimeName()}] reviewed IR digests (${rows.length}):\n${rows.join("\n") || "(none yet)"}`,
    );
  });
});
