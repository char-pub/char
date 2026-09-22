/** 运行器自身的比较规则测试，用合成的用例，不依赖真实的预期输出。 */
import { describe, expect, it } from "vitest";
import {
  type Actual,
  firstDifference,
  judge,
  normalizeExpectedText,
  renderDraft,
  textDigest,
} from "./run.js";
import type { BundledCase, CaseMeta, ExpectedOutput } from "./types.js";

function mk(meta: Partial<CaseMeta>, expected: ExpectedOutput = {}): BundledCase {
  return {
    dir: "900-synthetic",
    meta: {
      id: "900-synthetic",
      title: "synthetic",
      kind: "resolver",
      spec_refs: ["test"],
      status: "reviewed",
      reviewed_by: "tester",
      reviewed_at: "2026-09-22",
      ...meta,
    },
    input: { deps: [] },
    expected,
  };
}

const ir = (text: string): Actual => ({ kind: "context-ir", text, digest: textDigest(text) });

describe("judge", () => {
  it("compares Context IR byte for byte, ignoring one trailing newline in the file", () => {
    const c = mk({ expect: "context-ir" }, { "context-ir": '{"a":1}\n' });
    expect(judge(c, ir('{"a":1}')).status).toBe("pass");
    const bad = judge(c, ir('{"a":2}'));
    expect(bad.status).toBe("fail");
    expect(bad.message).toContain("offset 5");
    expect(
      judge(mk({ expect: "context-ir" }, { "context-ir": '{"a":1}\n\n' }), ir('{"a":1}')).status,
    ).toBe("fail");
  });

  it("does not compare draft cases", () => {
    const c = mk({ expect: "context-ir", status: "draft" });
    expect(judge(c, ir("anything")).status).toBe("draft");
  });

  it("marks unsupported kinds as todo", () => {
    const c = mk({ kind: "assembler" });
    expect(judge(c, { kind: "unsupported", reason: "later" }).status).toBe("todo");
  });

  it("fails when the result shape differs from the expected shape", () => {
    const c = mk({ expect: "context-ir" }, { "context-ir": "{}" });
    const v = judge(c, { kind: "error", error: { code: "resolve.x", subject: "s" } });
    expect(v.status).toBe("fail");
    expect(v.message).toContain("resolve.x");
    expect(judge(mk({}), ir("{}")).status).toBe("fail");
    expect(judge(mk({ expect: "context-ir" }), ir("{}")).status).toBe("fail");
  });

  it("compares error code, and subject only when the expectation has one", () => {
    const withSubject = mk({ expect: "error" }, { error: { code: "e", subject: "s" } });
    const codeOnly = mk({ expect: "error" }, { error: { code: "e" } });
    const actual: Actual = { kind: "error", error: { code: "e", subject: "other" } };
    expect(judge(withSubject, actual).status).toBe("fail");
    expect(judge(codeOnly, actual).status).toBe("pass");
    expect(judge(codeOnly, { kind: "error", error: { code: "f" } }).status).toBe("fail");
    expect(judge(mk({ expect: "error" }), actual).status).toBe("fail");
  });

  it("compares publish summaries including order", () => {
    const c = mk(
      { kind: "publish", expect: "publish" },
      { publish: { ok: false, errors: ["a", "b"], warnings: [] } },
    );
    const run = (errors: string[]): Actual => ({
      kind: "publish",
      summary: { ok: false, errors, warnings: [] },
    });
    expect(judge(c, run(["a", "b"])).status).toBe("pass");
    expect(judge(c, run(["b", "a"])).status).toBe("fail");
    expect(judge(mk({ kind: "publish", expect: "publish" }), run([])).status).toBe("fail");
  });
});

describe("helpers", () => {
  it("normalizes only a single trailing newline", () => {
    expect(normalizeExpectedText("x\n")).toBe("x");
    expect(normalizeExpectedText("x")).toBe("x");
    expect(normalizeExpectedText("x\n\n")).toBe("x\n");
  });

  it("points at the first difference", () => {
    expect(firstDifference("abc", "abd")).toContain("offset 2");
    expect(firstDifference("ab", "abc")).toContain("offset 2");
  });

  it("renders drafts in the expected file shapes", () => {
    expect(renderDraft(ir("{}"))).toEqual({ file: "context-ir", text: "{}" });
    expect(renderDraft({ kind: "error", error: { code: "e" } })?.file).toBe("error");
    expect(
      renderDraft({ kind: "publish", summary: { ok: true, errors: [], warnings: [] } })?.text,
    ).toContain('"ok": true');
    expect(renderDraft({ kind: "unsupported", reason: "x" })).toBeNull();
  });
});
