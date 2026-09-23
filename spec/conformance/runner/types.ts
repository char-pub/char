/**
 * 一致性测试集的数据格式。用例在仓库里是一个个目录，`conformance:bundle` 把它们打包成
 * 一个 JSON 文件，这样没有文件系统的运行时（浏览器、workerd）也能加载全部用例。
 */
import type { ReleaseInput } from "@char-pub/core";

export type CaseKind = "resolver" | "assembler" | "publish" | "ccv3";

/**
 * 用例期望的结果形态：一份 Context IR、一个错误、一份发布检查报告、Assembler 各场景的
 * Trace 决策，或 CCv3 往返的 Loss Report 摘要。
 */
export type ExpectKind = "context-ir" | "error" | "publish" | "trace" | "loss-report";

export type CaseStatus = "draft" | "reviewed";

export interface CaseMeta {
  id: string;
  title: string;
  kind: CaseKind;
  /** 期望的结果形态。 */
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
  /** assembler 用例：命名的 Runtime Profile + Session 场景。 */
  assemble?: AssembleInput;
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

/** 一个 Assembler 场景：用这个 Profile 和 Session 组装一次。 */
export interface AssembleScenario {
  name: string;
  profile: unknown;
  session: unknown;
}

export interface AssembleInput {
  scenarios: AssembleScenario[];
}

/** Trace 中参与比较的字段。token 数、region 与 origin 不比较。 */
export interface TraceDecision {
  id: string;
  decision: "included" | "skipped";
  reason: string;
}

/** 一个场景的结果：要么是 Trace 决策列表，要么是组装失败的错误。 */
export type ScenarioResult =
  | { name: string; entries: TraceDecision[] }
  | { name: string; error: ErrorExpectation };

export interface TraceExpectation {
  scenarios: ScenarioResult[];
}

/**
 * CCv3 往返中参与比较的部分：导入报告里被省略的策略字段与 lorebook 条目的 ID 派生，
 * 导入后不稳定的 fragment，以及 Loss Report 中不含 token 估算的各项损失。
 */
export interface LossSummary {
  import: {
    omitted_policy_fields: string[];
    lorebook: {
      index: number;
      source_id: string | number | null;
      fragment_id: string | null;
      activation: string;
    }[];
    unstable_fragments: string[];
  };
  loss: {
    flattened_dependencies: { ref: string; fragments: string[]; into: string[] }[];
    activation_downgrades: { subject: string; from: string; to: string }[];
    visibility: string[];
    participants: string[];
    context_assets: string[];
    locales: { dropped: string[]; exported: string };
    policy_fields: { ref: string; fields: string[]; restored: boolean }[];
    other: string[];
  };
  export: { system_prompt_empty: boolean; post_history_instructions_empty: boolean };
}

export interface ExpectedOutput {
  /** 按 JCS 序列化的 Context IR，逐字节比较。 */
  "context-ir"?: string;
  error?: ErrorExpectation;
  publish?: PublishSummary;
  trace?: TraceExpectation;
  "loss-report"?: LossSummary;
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
  trace: "trace.json",
  "loss-report": "loss-report.json",
};
