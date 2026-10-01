export type CheckSeverity = "error" | "warning" | "info";

/** Author-facing location and stable machine code for a static content check. */
export interface CheckDiagnostic {
  code: string;
  subject: string;
  severity: CheckSeverity;
  detail?: string;
}
