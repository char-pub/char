import type { ContentArtifact } from "@char-pub/assembler";
import type { LateBindingValue } from "@char-pub/core";
import { useMemo, useState } from "react";
import { authorVisibilityChecks } from "@/lib/author-visibility";
import { Button } from "./ui/button";

export interface SourceSharingAction {
  undo: () => void;
}

/** Render only inside an authenticated author view and its existing rating gate. */
export function AuthorVisibilityChecks({
  artifact,
  bindings,
  onLocateSource,
  onShareSource,
  disabledReason,
}: {
  artifact: ContentArtifact;
  bindings?: Readonly<Record<string, LateBindingValue>> | undefined;
  onLocateSource?: ((subject: string) => void) | undefined;
  onShareSource?: ((id: string) => SourceSharingAction) | undefined;
  disabledReason?: string | undefined;
}) {
  const checks = useMemo(() => authorVisibilityChecks(artifact, bindings), [artifact, bindings]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [undo, setUndo] = useState<SourceSharingAction | null>(null);
  return (
    <details className="space-y-3 rounded border p-3">
      <summary className="cursor-pointer font-semibold">
        Checks for individual character views
      </summary>
      <p className="text-xs text-text-2">
        Review what other characters can see before publishing. These suggestions do not block
        publishing or send content to a model.
      </p>
      {checks.length ? (
        <ul className="space-y-3" aria-label="Character visibility checks">
          {checks.map((check) => (
            <li key={`${check.kind}:${check.id}`} className="space-y-1">
              <p className="text-sm font-medium">{check.title}</p>
              <p className="text-xs text-text-2">{check.detail}</p>
              {check.subject && onLocateSource ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!!disabledReason}
                  onClick={() => {
                    if (check.subject) onLocateSource(check.subject);
                  }}
                >
                  Locate {check.title}
                </Button>
              ) : null}
              {check.shareSource && onShareSource ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!!disabledReason}
                  onClick={() => {
                    if (!check.shareSource) return;
                    setError("");
                    try {
                      setUndo(onShareSource(check.shareSource));
                      setNotice(
                        `Shared ${check.title} with all characters in this draft. Build again to review the updated view.`,
                      );
                    } catch (cause) {
                      setError(
                        cause instanceof Error ? cause.message : "Could not change this document.",
                      );
                    }
                  }}
                >
                  Share {check.title} with all characters
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-text-2">
          No additional character visibility suggestions for this build.
        </p>
      )}
      {disabledReason ? <p className="text-xs text-text-2">{disabledReason}</p> : null}
      {notice ? (
        <p role="status" className="text-xs">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {undo ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setError("");
            try {
              undo.undo();
              setUndo(null);
              setNotice("Restored the document's earlier visibility in this draft.");
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Could not undo sharing.");
            }
          }}
        >
          Undo sharing
        </Button>
      ) : null}
    </details>
  );
}
