/**
 * 检查规则的诊断。`subject` 指向出问题的位置（例如 `meta.license`、
 * `fragments[lore/port].content`），编辑器按前缀把诊断显示在对应的字段旁边。
 */
import type { CheckDiagnostic } from "@char-pub/core";
import { AlertCircle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export function diagnosticsFor(
  all: readonly CheckDiagnostic[],
  ...prefixes: string[]
): CheckDiagnostic[] {
  return all.filter((d) => prefixes.some((p) => d.subject === p || d.subject.startsWith(p)));
}

export function DiagnosticList({
  items,
  className,
}: {
  items: readonly CheckDiagnostic[];
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <ul className={cn("space-y-1", className)}>
      {items.map((d, i) => {
        const Icon = d.severity === "error" ? AlertCircle : AlertTriangle;
        return (
          <li
            // 同一个位置可能有多条相同代码的诊断，用下标区分。
            key={`${d.code}:${d.subject}:${i}`}
            className={cn(
              "flex items-start gap-1.5 text-xs",
              d.severity === "error" ? "text-seal" : "text-foreground",
            )}
            data-severity={d.severity}
          >
            <Icon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <span className="font-mono">{d.code}</span>
              {d.detail ? ` — ${d.detail}` : ""}
              <span className="block font-mono text-[0.7rem] text-muted-foreground">
                {d.subject}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
