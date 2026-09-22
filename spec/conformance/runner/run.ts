/**
 * 一致性测试集的运行器：纯函数，不读文件、不依赖 Node，可以在 Node、浏览器和 workerd
 * 中原样运行。其他实现也可以照着同样的输入和比较规则验证自己。
 *
 * 比较规则：
 * - Context IR 用例：实现输出的 JCS 字符串必须与 `expected/context-ir.json` 的内容逐字节
 *   相同。预期文件就是一行 JCS 文本，不带尾随换行；比较前只去掉文件末尾可能存在的一个 `\n`。
 * - 错误用例：比较错误的 `code`；预期里写了 `subject` 时也比较 `subject`。
 * - 发布用例：比较 `ok`、error 级问题的 code 列表和 warning 级问题的 code 列表（按报告顺序）。
 *
 * 状态为 draft 的用例只运行、不比较：它们的预期输出还没有经过人工审阅。
 */
import {
  CharError,
  CreationSchema,
  checkPublish,
  isCharError,
  type PublishReport,
  RuntimeProfileSchema,
  resolve,
  sha256Hex,
} from "@char-pub/core";
import type { Bundle, BundledCase, ErrorExpectation, ExpectKind, PublishSummary } from "./types.js";

/** 运行一个用例得到的实际结果，形态与预期文件一一对应。 */
export type Actual =
  | { kind: "context-ir"; text: string; digest: string }
  | { kind: "error"; error: ErrorExpectation; detail?: string }
  | { kind: "publish"; summary: PublishSummary }
  | { kind: "unsupported"; reason: string };

export interface Verdict {
  dir: string;
  status: "pass" | "fail" | "draft" | "todo";
  actual: Actual;
  /** fail 时的说明。 */
  message?: string;
}

/** 去掉预期文件末尾可能存在的一个换行。 */
export function normalizeExpectedText(text: string): string {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

/** 预期 Context IR 的 digest：`sha256:` + 预期文本的 sha256。 */
export function textDigest(text: string): string {
  return `sha256:${sha256Hex(text)}`;
}

export function summarizePublish(r: PublishReport): PublishSummary {
  return {
    ok: r.ok,
    errors: r.issues.filter((i) => i.severity === "error").map((i) => i.code),
    warnings: r.issues.filter((i) => i.severity === "warning").map((i) => i.code),
  };
}

function toError(e: unknown): Actual {
  if (!isCharError(e)) throw e;
  const out: Actual = { kind: "error", error: { code: e.code, subject: e.subject } };
  if (e.detail !== undefined) out.detail = e.detail;
  return out;
}

/** 按用例声明的形态运行实现。不会抛出 CharError；其他异常说明实现有 bug，原样抛出。 */
export function runCase(c: BundledCase): Actual {
  const { meta, input } = c;
  if (meta.kind === "assembler" || meta.kind === "ccv3") {
    return {
      kind: "unsupported",
      reason: `${meta.kind} cases are not wired to an implementation yet`,
    };
  }
  if (!input.root) {
    return toError(new CharError({ code: "conformance.missing_root", subject: c.dir }));
  }
  if (meta.kind === "publish") {
    const reg = input.registry;
    if (!reg)
      return toError(new CharError({ code: "conformance.missing_registry", subject: c.dir }));
    const report = checkPublish({
      release: input.root.release,
      label: reg.label,
      visibility: input.root.visibility,
      creation: input.root.creation,
      dependencies: input.deps,
      registry: {
        existingLabels: reg.existingLabels,
        assetStatus: reg.assetStatus,
        blockedDigests: new Set(reg.blockedDigests),
        ownerNamespaces: new Set(reg.ownerNamespaces),
      },
      ...(input.options?.publicAssetBaseUrl
        ? { publicAssetBaseUrl: input.options.publicAssetBaseUrl }
        : {}),
    });
    return { kind: "publish", summary: summarizePublish(report) };
  }
  try {
    const out = resolve({
      root: input.root,
      dependencies: input.deps,
      ...(input.options?.publicAssetBaseUrl
        ? { publicAssetBaseUrl: input.options.publicAssetBaseUrl }
        : {}),
    });
    return { kind: "context-ir", text: out.json, digest: textDigest(out.json) };
  } catch (e) {
    return toError(e);
  }
}

/**
 * 只校验输入的形状，用于还没有接入实现的 assembler / ccv3 用例：
 * 输入里的 Creation 都要符合 schema，assembler 用例的 Runtime Profile 也要合法。
 * 返回问题列表，空列表表示输入合法。
 */
export function validateInput(c: BundledCase): string[] {
  const problems: string[] = [];
  const releases = [...(c.input.root ? [c.input.root] : []), ...c.input.deps];
  for (const r of releases) {
    const parsed = CreationSchema.safeParse(r.creation);
    if (!parsed.success) {
      problems.push(`${r.release}: ${parsed.error.issues[0]?.message ?? "invalid creation"}`);
    }
  }
  const assemble = c.input.assemble as { profile?: unknown; profiles?: unknown[] } | undefined;
  if (assemble) {
    const profiles = [
      ...(assemble.profile ? [assemble.profile] : []),
      ...(assemble.profiles ?? []),
    ];
    if (profiles.length === 0) problems.push("assemble: no runtime profile");
    for (const p of profiles) {
      const parsed = RuntimeProfileSchema.safeParse(p);
      if (!parsed.success) problems.push(`profile: ${parsed.error.issues[0]?.message}`);
    }
  }
  if (c.meta.kind === "ccv3" && c.input.card === undefined) problems.push("ccv3: missing card");
  return problems;
}

function sameError(actual: ErrorExpectation, expected: ErrorExpectation): boolean {
  if (actual.code !== expected.code) return false;
  return expected.subject === undefined || actual.subject === expected.subject;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** 比较实际结果与预期。draft 用例不比较。 */
export function judge(c: BundledCase, actual: Actual): Verdict {
  const base = { dir: c.dir, actual };
  if (actual.kind === "unsupported") return { ...base, status: "todo", message: actual.reason };
  if (c.meta.status !== "reviewed") return { ...base, status: "draft" };
  const want = c.meta.expect as ExpectKind | undefined;
  if (!want) return { ...base, status: "fail", message: "reviewed case has no `expect` kind" };
  if (actual.kind !== want) {
    return {
      ...base,
      status: "fail",
      message: `expected a ${want} result, got ${actual.kind}${
        actual.kind === "error" ? ` (${actual.error.code})` : ""
      }`,
    };
  }
  switch (actual.kind) {
    case "context-ir": {
      const expected = c.expected["context-ir"];
      if (expected === undefined)
        return { ...base, status: "fail", message: "missing expected/context-ir.json" };
      const text = normalizeExpectedText(expected);
      if (actual.text === text) return { ...base, status: "pass" };
      return { ...base, status: "fail", message: firstDifference(text, actual.text) };
    }
    case "error": {
      const expected = c.expected.error;
      if (!expected) return { ...base, status: "fail", message: "missing expected/error.json" };
      if (sameError(actual.error, expected)) return { ...base, status: "pass" };
      return {
        ...base,
        status: "fail",
        message: `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual.error)}`,
      };
    }
    case "publish": {
      const expected = c.expected.publish;
      if (!expected) return { ...base, status: "fail", message: "missing expected/publish.json" };
      const s = actual.summary;
      if (
        s.ok === expected.ok &&
        sameList(s.errors, expected.errors) &&
        sameList(s.warnings, expected.warnings)
      ) {
        return { ...base, status: "pass" };
      }
      return {
        ...base,
        status: "fail",
        message: `expected ${JSON.stringify(expected)}, got ${JSON.stringify(s)}`,
      };
    }
  }
}

/** 指出两段文本第一个不同的位置，附带前后各 40 个字符。 */
export function firstDifference(expected: string, actual: string): string {
  const n = Math.min(expected.length, actual.length);
  let i = 0;
  while (i < n && expected[i] === actual[i]) i += 1;
  const from = Math.max(0, i - 40);
  return `differs at offset ${i}: expected …${expected.slice(from, i + 40)}… got …${actual.slice(from, i + 40)}…`;
}

export function runBundle(bundle: Bundle): Verdict[] {
  return bundle.cases.map((c) => judge(c, runCase(c)));
}

/** 把实际结果转成预期文件的内容（供 draft 工具使用）。 */
export function renderDraft(actual: Actual): { file: ExpectKind; text: string } | null {
  switch (actual.kind) {
    case "context-ir":
      return { file: "context-ir", text: actual.text };
    case "error":
      return { file: "error", text: `${JSON.stringify(actual.error, null, 2)}\n` };
    case "publish":
      return { file: "publish", text: `${JSON.stringify(actual.summary, null, 2)}\n` };
    case "unsupported":
      return null;
  }
}
