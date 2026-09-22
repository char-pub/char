/**
 * core 的错误模型。所有可预期的失败都带稳定的 `code`（例如 `publish.diamond_conflict`），
 * 上层直接映射为 problem+json；`subject` 指向出问题的对象 ID 或字段路径。
 */

export interface Diagnostic {
  code: string;
  subject: string;
  severity: "info" | "warning";
  detail?: string;
}

export interface CharErrorInit {
  code: string;
  subject: string;
  detail?: string;
  /** 解释错误来源的补充信息，例如依赖路径。必须是可 JSON 序列化的纯数据。 */
  data?: Record<string, unknown>;
}

export class CharError extends Error {
  readonly code: string;
  readonly subject: string;
  readonly detail: string | undefined;
  readonly data: Record<string, unknown> | undefined;

  constructor(init: CharErrorInit) {
    super(
      init.detail
        ? `${init.code} (${init.subject}): ${init.detail}`
        : `${init.code} (${init.subject})`,
    );
    this.name = "CharError";
    this.code = init.code;
    this.subject = init.subject;
    this.detail = init.detail;
    this.data = init.data;
  }

  toJSON(): CharErrorInit {
    const out: CharErrorInit = { code: this.code, subject: this.subject };
    if (this.detail !== undefined) out.detail = this.detail;
    if (this.data !== undefined) out.data = this.data;
    return out;
  }
}

export function isCharError(e: unknown): e is CharError {
  return e instanceof CharError;
}

/** 按 code、subject 排序，保证诊断输出与输入顺序无关。 */
export function sortDiagnostics<T extends { code: string; subject: string }>(list: T[]): T[] {
  return [...list].sort(
    (a, b) => compareStrings(a.code, b.code) || compareStrings(a.subject, b.subject),
  );
}

/**
 * 按 UTF-16 code unit 比较字符串，与 JCS 的键排序一致。
 * 不能用 localeCompare：它的结果取决于运行环境的 locale，会破坏跨运行时的确定性。
 */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
