/** Object-by-object recovery for a paused optimistic draft save. */
import { GitCompareArrows } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import type { Working } from "@/lib/draft";
import {
  applyDraftReapply,
  createDraftReapply,
  type DraftReapplyPlan,
  type DraftReapplyValue,
} from "@/lib/draft-reapply";
import type { DraftConflict, DraftEditor } from "@/lib/use-draft-editor";

const valueText = (value: DraftReapplyValue) =>
  value.exists ? (JSON.stringify(value.value, null, 2) ?? "Not set") : "Not present";

export function ConflictNotice({
  editor,
}: {
  editor: Pick<DraftEditor, "working" | "reload" | "reviewConflict" | "reapplyConflict">;
}) {
  const groupId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{ snapshot: DraftConflict; plan: DraftReapplyPlan } | null>(
    null,
  );
  const [choices, setChoices] = useState<Record<string, "mine" | "latest">>({});
  const unresolved =
    review?.plan.entries.filter((entry) => !(choices[entry.key] ?? entry.defaultChoice)).length ??
    0;

  async function compare() {
    setBusy(true);
    setError(null);
    setReview(null);
    setChoices({});
    try {
      const snapshot = await editor.reviewConflict();
      if (snapshot)
        setReview({
          snapshot,
          plan: createDraftReapply(snapshot.base, snapshot.local, snapshot.latest),
        });
    } catch {
      setError("Could not read the latest draft. Your edits are still here. Try comparing again.");
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!review) return;
    setError(null);
    const prepared = applyDraftReapply(review.plan, choices, {
      mine: review.snapshot.local,
      latest: review.snapshot.latest,
    });
    if (!prepared.working || prepared.stale) {
      setError("The comparison changed. Compare again before applying your choices.");
      return;
    }
    setBusy(true);
    try {
      if (!(await editor.reapplyConflict(review.snapshot, prepared.working)))
        setError("The draft could not be saved. Your edits are kept; compare again if it changed.");
    } catch {
      setError("Could not save your choices. Your edits are still here.");
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    setBusy(true);
    setError(null);
    setReview(null);
    try {
      await editor.reload();
    } catch {
      setError("Could not reload the draft. Your edits have not been discarded.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="conflict-h"
      aria-describedby="conflict-d"
      className="space-y-4 rounded-xl border border-danger/40 bg-danger-soft p-5"
    >
      <h2 id="conflict-h" className="flex items-center gap-2 font-bold text-danger">
        <GitCompareArrows aria-hidden className="size-4" />
        This draft was changed somewhere else
      </h2>
      <p id="conflict-d" role="status" className="text-sm text-text">
        Your edits are kept here and saving is paused. Compare with the latest draft, choose which
        changes to keep, then save. Objects you did not edit keep their latest version.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant={review ? "outline" : "default"}
          disabled={busy}
          onClick={() => void compare()}
        >
          {busy ? "Working…" : review ? "Refresh comparison" : "Compare changes"}
        </Button>
        <Button variant="destructive" disabled={busy} onClick={() => void reload()}>
          Discard my edits and reload
        </Button>
        <CopyDraft working={editor.working} />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {review ? (
        <section aria-label="Changes to review" className="space-y-4">
          <p className="text-sm">
            Comparing your edits with saved version {review.snapshot.version}. Choosing your version
            replaces that whole object, including any changes made to it elsewhere.
          </p>
          {review.plan.entries.length === 0 ? (
            <p className="text-sm">Your edits already match the latest draft.</p>
          ) : null}
          {review.plan.entries.map((entry) => (
            <fieldset
              key={entry.key}
              disabled={busy}
              className="min-w-0 space-y-3 rounded-lg border bg-surface p-4"
            >
              <legend className="px-1 font-semibold">{entry.label}</legend>
              <p className="text-sm text-text-2">
                {entry.conflict
                  ? "Changed in both versions. Choose which to keep."
                  : "Your change can be reapplied."}
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                {(["mine", "latest"] as const).map((choice) => (
                  <label key={choice} className="min-w-0 space-y-2 rounded-md border p-3">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <input
                        type="radio"
                        aria-label={choice === "mine" ? "Use my version" : "Keep latest version"}
                        name={`${groupId}-${encodeURIComponent(entry.key)}`}
                        checked={(choices[entry.key] ?? entry.defaultChoice) === choice}
                        onChange={() =>
                          setChoices((values) => ({ ...values, [entry.key]: choice }))
                        }
                      />
                      {choice === "mine" ? "Use my version" : "Keep latest version"}
                    </span>
                    <pre className="max-h-64 overflow-auto text-xs whitespace-pre-wrap break-words">
                      {valueText(entry[choice])}
                    </pre>
                  </label>
                ))}
              </div>
              <details>
                <summary className="cursor-pointer text-sm text-text-2">
                  Version before your edits
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto text-xs whitespace-pre-wrap break-words">
                  {valueText(entry.base)}
                </pre>
              </details>
            </fieldset>
          ))}
          {unresolved ? (
            <p role="status" className="text-sm">
              Choose a version for {unresolved} remaining changes.
            </p>
          ) : null}
          <Button disabled={busy || unresolved > 0} onClick={() => void apply()}>
            Apply choices and save
          </Button>
        </section>
      ) : null}
    </section>
  );
}

function CopyDraft({ working }: { working: Working }) {
  return (
    <Button
      variant="outline"
      onClick={() => {
        if (!navigator.clipboard) {
          toast.error("Clipboard is unavailable. Keep this page open to preserve your edits.");
          return;
        }
        void navigator.clipboard
          .writeText(JSON.stringify(working, null, 2))
          .then(() => toast.success("Copied your version to the clipboard."))
          .catch(() => toast.error("Could not copy. Keep this page open to preserve your edits."));
      }}
    >
      Copy my version
    </Button>
  );
}
