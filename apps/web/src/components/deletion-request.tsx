import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { isApiError } from "@/lib/api";
import { useRegistry } from "@/lib/registry";
import { formatDate } from "@/lib/text";

const REQUESTS_KEY = ["deletion-requests"] as const;
export function DeletionRequestButton({ creation }: { creation?: string }) {
  const client = useRegistry();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await client.requestDeletion({
        ...(creation ? { creation } : {}),
        reason,
        confirm: true,
      });
      setReceipt(result.id);
      await qc.invalidateQueries({ queryKey: REQUESTS_KEY });
    } catch (e) {
      setError(
        isApiError(e, "deletion.unavailable")
          ? "Requests are temporarily unavailable. Please try again later."
          : isApiError(e, "rate_limited")
            ? "Too many requests. Please try again tomorrow."
            : "The request could not be sent. Your content has not been changed. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        {creation ? "Request removal…" : "Request account deletion…"}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!busy) setOpen(v);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {creation ? `Request removal of ${creation}?` : "Request account deletion?"}
            </DialogTitle>
            <DialogDescription>
              Our team reviews requests before taking action. Submitting this form does not delete
              anything immediately.
            </DialogDescription>
          </DialogHeader>
          {receipt ? (
            <div role="status" className="space-y-3">
              <p>Request received. You can follow its status in Settings → Your data.</p>
              <p className="break-all font-mono text-xs">Reference: {receipt}</p>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (confirmed && reason.trim().length >= 10) void submit();
              }}
            >
              <p className="text-sm text-text-2">
                {creation
                  ? "Removing published content may also remove releases that depend on it. Removal cannot be undone. To discourage new use while keeping existing links working, yank the version instead."
                  : "Account deletion removes personal account data and private content. Public releases normally remain with anonymized attribution so other creations can continue to use them. Request creation removal separately if needed."}
              </p>
              <label htmlFor={`${id}-reason`} className="block space-y-2">
                <span className="text-sm font-medium">Reason</span>
                <Textarea
                  id={`${id}-reason`}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  minLength={10}
                  maxLength={2000}
                  required
                />
              </label>
              <div className="flex items-start gap-2">
                <Checkbox
                  id={id}
                  checked={confirmed}
                  onCheckedChange={(v) => setConfirmed(v === true)}
                />
                <label htmlFor={id} className="text-sm">
                  I understand the consequences and want the team to review this request.
                </label>
              </div>
              {error ? (
                <p role="alert" className="text-sm text-danger">
                  {error}
                </p>
              ) : null}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive-solid"
                  disabled={busy || !confirmed || reason.trim().length < 10}
                >
                  {busy ? "Sending…" : "Send request"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
export function DeletionRequests() {
  const client = useRegistry();
  const requests = useQuery({ queryKey: REQUESTS_KEY, queryFn: () => client.deletionRequests() });
  return (
    <div className="space-y-4">
      <DeletionRequestButton />
      {requests.isPending ? (
        <p role="status">Loading requests…</p>
      ) : requests.isError ? (
        <p role="alert">
          Requests could not be loaded.{" "}
          <Button variant="link" onClick={() => void requests.refetch()}>
            Try again
          </Button>
        </p>
      ) : requests.data.items.length ? (
        <ul aria-label="Deletion requests" className="space-y-2">
          {requests.data.items.map((r) => (
            <li key={r.id} className="rounded-md border p-3 text-sm">
              <p>
                {r.status} · {formatDate(r.created_at)}
              </p>
              <p className="break-all font-mono text-xs">Reference: {r.id}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
