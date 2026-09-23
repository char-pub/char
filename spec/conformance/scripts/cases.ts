/**
 * 从磁盘读取用例目录（只在 Node 工具脚本和防漂移测试中使用）。
 *
 * 目录布局：
 *   cases/<dir>/case.json
 *   cases/<dir>/input/root.json            根 Release（可选，ccv3 用例没有）
 *   cases/<dir>/input/deps/*.json          依赖 Release，按文件名排序
 *   cases/<dir>/input/registry.json        发布用例的 Registry 状态
 *   cases/<dir>/input/options.json         其他 Resolver 选项
 *   cases/<dir>/input/assemble.json        assembler 用例的 Profile 与 Session
 *   cases/<dir>/input/card.json            ccv3 用例的输入卡片
 *   cases/<dir>/expected/<kind>.json       经人工审阅的预期输出
 *   cases/<dir>/draft/<kind>.json          实现的当前输出，等待审阅（不提交）
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Bundle, BundledCase, CaseInput, CaseMeta, ExpectedOutput } from "../runner/types.js";

export const CONFORMANCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CASES_DIR = join(CONFORMANCE_ROOT, "cases");
export const BUNDLE_PATH = join(CONFORMANCE_ROOT, "runner", "cases.gen.json");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function readOptional<T>(path: string): T | undefined {
  return existsSync(path) ? readJson<T>(path) : undefined;
}

/** 字符串按 UTF-16 code unit 排序，与运行环境的 locale 无关。 */
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function listCaseDirs(): string[] {
  return readdirSync(CASES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort(byCodeUnit);
}

export function loadCase(dir: string): BundledCase {
  const base = join(CASES_DIR, dir);
  const meta = readJson<CaseMeta>(join(base, "case.json"));
  if (meta.id !== dir) {
    throw new Error(`${dir}/case.json: id must equal the directory name`);
  }
  const inputDir = join(base, "input");
  const depsDir = join(inputDir, "deps");
  const deps = existsSync(depsDir)
    ? readdirSync(depsDir)
        .filter((f) => f.endsWith(".json"))
        .sort(byCodeUnit)
        .map((f) => readJson<CaseInput["deps"][number]>(join(depsDir, f)))
    : [];
  const input: CaseInput = { deps };
  const root = readOptional<CaseInput["root"]>(join(inputDir, "root.json"));
  if (root) input.root = root;
  const registry = readOptional<CaseInput["registry"]>(join(inputDir, "registry.json"));
  if (registry) input.registry = registry;
  const options = readOptional<CaseInput["options"]>(join(inputDir, "options.json"));
  if (options) input.options = options;
  const assemble = readOptional<CaseInput["assemble"]>(join(inputDir, "assemble.json"));
  if (assemble !== undefined) input.assemble = assemble;
  const card = readOptional<unknown>(join(inputDir, "card.json"));
  if (card !== undefined) input.card = card;

  const expected: ExpectedOutput = {};
  const expDir = join(base, "expected");
  const irPath = join(expDir, "context-ir.json");
  if (existsSync(irPath)) expected["context-ir"] = readFileSync(irPath, "utf8");
  const error = readOptional<ExpectedOutput["error"]>(join(expDir, "error.json"));
  if (error) expected.error = error;
  const publish = readOptional<ExpectedOutput["publish"]>(join(expDir, "publish.json"));
  if (publish) expected.publish = publish;
  const trace = readOptional<ExpectedOutput["trace"]>(join(expDir, "trace.json"));
  if (trace) expected.trace = trace;
  const loss = readOptional<ExpectedOutput["loss-report"]>(join(expDir, "loss-report.json"));
  if (loss) expected["loss-report"] = loss;

  return { dir, meta, input, expected };
}

export function buildBundle(): Bundle {
  return { format: 1, cases: listCaseDirs().map(loadCase) };
}

/** bundle 文件的规范文本：两空格缩进，末尾一个换行。 */
export function serializeBundle(bundle: Bundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}
