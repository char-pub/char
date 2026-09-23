/**
 * Yank 一个版本：作者填写公开理由（3–500 字）。yank 之后已经锁定这个版本的作品仍然能读到
 * 内容，但页面会提示，新的依赖也不应再选它；这一步不能撤销。要彻底移除版本只能请员工处理。
 */
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Archive } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";
import { isApiError } from "@/lib/api";
import { isReadOnlyError } from "@/lib/read-only";
import { useRegistry } from "@/lib/registry";
import { refreshCreation } from "./creation-context";

export const YANK_REASON_MIN = 3;
export const YANK_REASON_MAX = 500;

function yankError(e: unknown): string {
  if (isReadOnlyError(e)) return "char.pub is read-only for maintenance. Try again later.";
  if (isApiError(e, "rate_limited")) return "Too many changes in a short time. Try again later.";
  if (isApiError(e) && (e.status === 403 || e.status === 404)) {
    return "You can't yank this version. Only members of this namespace can.";
  }
  if (isApiError(e) && e.status === 422) {
    return `The reason was not accepted${e.detail ? `: ${e.detail}` : "."}`;
  }
  return "The version could not be yanked. Try again.";
}

export function YankDialog({
  ns,
  name,
  label,
  open,
  onOpenChange,
}: {
  ns: string;
  name: string;
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const client = useRegistry();
  const qc = useQueryClient();
  const reasonId = useId();
  const hintId = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = reason.trim();
  const valid = trimmed.length >= YANK_REASON_MIN && trimmed.length <= YANK_REASON_MAX;

  const change = (next: boolean) => {
    if (busy) return;
    if (!next) {
      setReason("");
      setError(null);
    }
    onOpenChange(next);
  };

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await client.yankRelease(ns, name, label, trimmed);
      await refreshCreation(qc, ns, name);
      toast.success(`Yanked ${label}`);
      setReason("");
      onOpenChange(false);
    } catch (e) {
      setError(yankError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent>
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Yank {label}?</DialogTitle>
            <DialogDescription>
              Yanked versions still resolve for anyone who pinned them, but they are flagged and
              left out of new picks. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={reasonId}>Reason (shown publicly)</Label>
            <Textarea
              id={reasonId}
              rows={3}
              value={reason}
              maxLength={YANK_REASON_MAX}
              aria-describedby={hintId}
              aria-invalid={error ? true : undefined}
              placeholder="e.g. The greeting prints a broken placeholder in some runtimes."
              onChange={(e) => setReason(e.target.value)}
            />
            <p id={hintId} className="flex justify-between gap-3 text-xs text-text-3">
              <span>At least {YANK_REASON_MIN} characters. Everyone can read it.</span>
              <span className="tabular-nums">
                {trimmed.length}/{YANK_REASON_MAX}
              </span>
            </p>
            <p className="text-xs text-text-2">
              To remove a version completely,{" "}
              <Link to="/policy" className="text-blue-text underline-offset-4 hover:underline">
                ask us to remove it
              </Link>{" "}
              instead.
            </p>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant="destructive-solid" disabled={!valid || busy}>
              <Archive aria-hidden /> {busy ? "Yanking…" : `Yank ${label}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
