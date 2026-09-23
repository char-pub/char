/**
 * Publish Report：发布检查的结果。错误会阻止发布（label 被释放，可以修改后重试），
 * 警告不阻止发布；许可检查给出 pass / warn / fail。
 */
import { AlertCircle, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import type { PublishReportResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

const LICENSE_TEXT = {
  pass: "Licenses are compatible.",
  warn: "Licenses need attention — see the warnings.",
  fail: "Licenses do not allow this combination.",
} as const;

export function PublishReport({ report }: { report: PublishReportResponse }) {
  const issues = report.report?.issues ?? [];
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const Icon =
    report.state === "active" ? CheckCircle2 : report.state === "failed" ? AlertCircle : Loader2;

  return (
    <section
      aria-label="Publish report"
      className="catalog-card space-y-3 p-5 pl-8"
      data-state={report.state}
    >
      <p className="flex items-center gap-2 font-display text-xl">
        <Icon
          aria-hidden
          className={cn(
            "size-5",
            report.state === "active" ? "text-moss" : "text-seal",
            report.state === "pending" ? "animate-spin" : "",
          )}
        />
        {report.state === "active"
          ? `Published ${report.label}`
          : report.state === "failed"
            ? `Could not publish ${report.label}`
            : `Publishing ${report.label}…`}
      </p>
      {report.state === "pending" ? (
        <p className="text-sm text-muted-foreground">
          The registry is checking dependencies, licenses and images. This usually takes a few
          seconds.
        </p>
      ) : null}
      {report.idempotent && report.state === "active" ? (
        <p className="text-sm text-muted-foreground">
          This version already had exactly this content; nothing changed.
        </p>
      ) : null}
      {report.report ? (
        <p className="text-sm">
          <span className="font-medium">License check:</span>{" "}
          {LICENSE_TEXT[report.report.license_check]}
        </p>
      ) : null}
      {errors.length > 0 || warnings.length > 0 ? (
        <ul className="space-y-1.5">
          {[...errors, ...warnings].map((i, n) => {
            const I = i.severity === "error" ? AlertCircle : AlertTriangle;
            return (
              <li
                key={`${i.code}:${i.subject}:${n}`}
                data-severity={i.severity}
                className={cn(
                  "flex items-start gap-1.5 text-sm",
                  i.severity === "error" ? "text-seal" : "",
                )}
              >
                <I aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>
                  <span className="font-mono text-xs">{i.code}</span>
                  {i.detail ? ` — ${i.detail}` : ""}
                  <span className="block font-mono text-xs text-muted-foreground">{i.subject}</span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : report.state !== "pending" ? (
        <p className="text-sm text-muted-foreground">No issues found.</p>
      ) : null}
    </section>
  );
}
