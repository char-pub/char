/**
 * 一致性测试集的数据格式。用例在仓库里是一个个目录，`conformance:bundle` 把它们打包成
 * 一个 JSON 文件，这样没有文件系统的运行时（浏览器、workerd）也能加载全部用例。
 */
import type { ReleaseInput } from "@char-pub/core";

export type CaseKind = "resolver" | "assembler" | "publish" | "ccv3";

/** 用例期望的结果形态：一份 Context IR、一个错误，或一份发布检查报告。 */
export type ExpectKind = "context-ir" | "error" | "publish";

export type CaseStatus = "draft" | "reviewed";

export interface CaseMeta {
  id: string;
  title: string;
  kind: CaseKind;
  /** resolver 与 publish 用例必填；assembler 与 ccv3 用例暂时没有可比较的输出。 */
  expect?: ExpectKind;
  /** 这个用例验证的规范条款或决策，便于追溯。 */
  spec_refs: string[];
  status: CaseStatus;
  reviewed_by?: string;
  /** `YYYY-MM-DD`。 */
  reviewed_at?: string;
  /** Context IR 用例的预期 digest：预期文件内容的 sha256。 */
  expected_digest?: string;
  notes?: string;
}

/** 发布用例的 Registry 状态与本次发布的 label。 */
export interface RegistryInput {
  label: string;
  existingLabels: Record<string, string>;
  assetStatus: Record<string, "ready" | "processing" | "rejected" | "quarantined">;
  blockedDigests: string[];
  ownerNamespaces: string[];
}

export interface CaseInput {
  /** 根 Release。ccv3 用例没有根 Release，输入是一张卡片。 */
  root?: ReleaseInput;
  /** 依赖闭包，按文件名排序。 */
  deps: ReleaseInput[];
  registry?: RegistryInput;
  options?: { publicAssetBaseUrl?: string };
  /** assembler 用例：Runtime Profile 与 Session 场景。 */
  assemble?: unknown;
  /** ccv3 用例：输入卡片。 */
  card?: unknown;
}

export interface ErrorExpectation {
  code: string;
  subject?: string;
}

export interface PublishSummary {
  ok: boolean;
  /** error 级问题的 code，按报告顺序。 */
  errors: string[];
  /** warning 级问题的 code，按报告顺序。 */
  warnings: string[];
}

export interface ExpectedOutput {
  /** 按 JCS 序列化的 Context IR，逐字节比较。 */
  "context-ir"?: string;
  error?: ErrorExpectation;
  publish?: PublishSummary;
}

export interface BundledCase {
  /** 用例目录名，例如 `001-level0-character`。 */
  dir: string;
  meta: CaseMeta;
  input: CaseInput;
  expected: ExpectedOutput;
}

export interface Bundle {
  format: 1;
  cases: BundledCase[];
}

/** 每种期望形态在 `expected/` 与 `draft/` 目录里对应的文件名。 */
export const EXPECTED_FILES: Record<ExpectKind, string> = {
  "context-ir": "context-ir.json",
  error: "error.json",
  publish: "publish.json",
};
