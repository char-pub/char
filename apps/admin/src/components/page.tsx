/**
 * 页面框架的小组件：页面标题、“后端接口待接入”提示、错误与空状态、用户内容。
 */
import { AlertTriangle, PlugZap } from "lucide-react";
import type * as React from "react";
import { type ReactNode, useId } from "react";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";

/** 带标签的输入框：label 通过 htmlFor 关联到输入框。 */
export function Field({
  label,
  small,
  ...input
}: { label: string; small?: boolean } & React.ComponentProps<typeof Input>) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1 ${small ? "text-xs text-muted-foreground" : "text-sm"}`}>
      <label htmlFor={id}>{label}</label>
      <Input id={id} {...input} />
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b pb-3">
      <div className="space-y-1">
        <h1 className="text-xl">{title}</h1>
        {description ? (
          <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** 这个页面依赖的后端接口还没有实现，当前显示的是 mock 数据或空结果。 */
export function PendingBackend({ endpoints }: { endpoints: string[] }) {
  return (
    <div
      role="note"
      className="flex items-start gap-2 rounded-md border border-dashed border-signal/60 bg-signal-soft/40 px-3 py-2 text-sm"
    >
      <PlugZap aria-hidden className="mt-0.5 size-4 shrink-0 text-signal-ink" />
      <div>
        <p className="font-medium">Backend endpoint pending</p>
        <p className="text-muted-foreground">
          This page is built against the planned contract:{" "}
          <span className="font-mono">{endpoints.join(", ")}</span>. Until the admin API implements
          it, data comes from the local mock.
        </p>
      </div>
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  const code =
    error instanceof ApiError ? error.code : error instanceof Error ? error.message : String(error);
  const forbidden = error instanceof ApiError && error.status === 403;
  return (
    <p
      role="alert"
      className="flex items-center gap-2 rounded-md border border-danger/50 bg-danger-soft/50 px-3 py-2 text-sm"
    >
      <AlertTriangle aria-hidden className="size-4 text-danger" />
      {forbidden ? "You do not have permission to view this." : "Request failed:"}{" "}
      <code className="font-mono">{code}</code>
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

/** 用户写的文本（举报描述、作品简介）：只按纯文本显示，保留换行，不解释任何标记。 */
export function UserText({ text }: { text: string }) {
  return <span className="whitespace-pre-wrap break-words">{text}</span>;
}

export function Time({ iso }: { iso: string | null | undefined }) {
  if (!iso) return <span className="text-muted-foreground">—</span>;
  return (
    <time dateTime={iso} className="font-mono text-xs tabular-nums" title={iso}>
      {iso.replace("T", " ").replace(/\.\d+Z$/, "Z")}
    </time>
  );
}

export function Tag({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "danger";
}) {
  const cls =
    tone === "ok"
      ? "border-ok/50 bg-ok-soft text-ok"
      : tone === "warn"
        ? "border-signal/60 bg-signal-soft text-signal-ink"
        : tone === "danger"
          ? "border-danger/50 bg-danger-soft text-danger"
          : "border-line text-muted-foreground";
  return <span className={`tag ${cls}`}>{children}</span>;
}
