/**
 * 员工写操作的通用表单：理由（至少 10 个字符）、可选的法律请求关联、二次确认。
 *
 * 每个写操作都要写理由，理由进入审计日志；法律类操作（法律依据的 tombstone、处理法律请求）
 * 还必须选择关联的法律请求。提交按钮在条件满足前保持禁用，后端也会再检查一次。
 */
import { type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, type LegalRequest, MIN_REASON_LENGTH, type WithReason } from "@/lib/api";

export interface ReasonFormProps {
  /** 提交按钮上的文字，例如 "Disable uploads"。 */
  submitLabel: string;
  danger?: boolean;
  /** 需要关联法律请求时传入可选的法律请求列表。 */
  legalRequests?: LegalRequest[];
  /** 额外的确认文字：用户必须勾选才能提交。 */
  confirmText?: string;
  children?: ReactNode;
  onSubmit: (input: WithReason) => Promise<void>;
}

export function reasonIsValid(reason: string): boolean {
  return reason.trim().length >= MIN_REASON_LENGTH;
}

export function ReasonForm({
  submitLabel,
  danger,
  legalRequests,
  confirmText,
  children,
  onSubmit,
}: ReasonFormProps) {
  const [reason, setReason] = useState("");
  const [legalId, setLegalId] = useState("");
  const [confirmed, setConfirmed] = useState(!confirmText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasonId = useId();
  const hintId = useId();
  const legalNeeded = legalRequests !== undefined;
  const ready = reasonIsValid(reason) && confirmed && (!legalNeeded || legalId !== "") && !busy;
  const remaining = Math.max(0, MIN_REASON_LENGTH - reason.trim().length);

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready) return;
        setBusy(true);
        setError(null);
        try {
          await onSubmit({
            reason: reason.trim(),
            ...(legalNeeded ? { legal_request_id: legalId } : {}),
          });
        } catch (err) {
          setError(err instanceof ApiError ? err.code : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
      {legalNeeded ? (
        <div className="space-y-1">
          <Label htmlFor={`${reasonId}-legal`}>Legal request</Label>
          <select
            id={`${reasonId}-legal`}
            className="h-8 w-full rounded-md border bg-transparent px-2 text-sm"
            value={legalId}
            onChange={(e) => setLegalId(e.target.value)}
          >
            <option value="">Select the legal request this action is based on…</option>
            {legalRequests.map((l) => (
              <option key={l.id} value={l.id}>
                {l.id} · {l.kind} · {l.subjects.join(", ")}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="space-y-1">
        <Label htmlFor={reasonId}>Reason (recorded in the audit log)</Label>
        <Textarea
          id={reasonId}
          aria-describedby={hintId}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why are you doing this? At least 10 characters."
          rows={3}
        />
        <p id={hintId} className="text-xs text-muted-foreground">
          {remaining > 0
            ? `${remaining} more character${remaining === 1 ? "" : "s"} required.`
            : "Looks good."}
        </p>
      </div>
      {confirmText ? (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>{confirmText}</span>
        </label>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          Failed: <code className="font-mono">{error}</code>
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button
          type="submit"
          size="sm"
          variant={danger ? "destructive" : "default"}
          disabled={!ready}
        >
          {busy ? "Working…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
