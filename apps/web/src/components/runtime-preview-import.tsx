import { type ContentArtifact, validateRuntimePreviewInput } from "@char-pub/assembler";
import {
  buildIdentityKey,
  MAX_RUNTIME_PREVIEW_BYTES,
  type RuntimePreviewInput,
} from "@char-pub/core";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function unexpired(input: RuntimePreviewInput): void {
  const root = input.source.root;
  if (
    "origin" in root &&
    root.origin.kind === "draft-build" &&
    Date.parse(root.origin.expires_at) <= Date.now()
  ) {
    throw new Error(
      "This draft build has expired. The input cannot be silently moved to a new build.",
    );
  }
}

/** Reading this file stays local. Neither a file field nor its checksum can grant user consent. */
export function RuntimePreviewImport({
  artifact,
  active,
  onApply,
  onExit,
  isCurrent = () => true,
}: {
  artifact: ContentArtifact;
  active: RuntimePreviewInput | null;
  onApply: (input: RuntimePreviewInput) => void;
  onExit: () => void;
  isCurrent?: () => boolean;
}) {
  const inputId = useId();
  const [review, setReview] = useState<RuntimePreviewInput | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const epoch = useRef(0);
  const current = useRef(artifact);
  current.current = artifact;
  useEffect(() => {
    epoch.current++;
    setReview(null);
    setConfirmed(false);
    setReading(false);
    setError("");
    return () => {
      epoch.current++;
    };
  }, [artifact]);
  return (
    <section aria-label="Import runtime preview" className="space-y-3 rounded border p-4">
      <h3 className="font-semibold">Import runtime preview</h3>
      <p className="text-xs text-text-2">
        Review a local synthetic snapshot for this exact build. Loading it does not save a draft or
        author test. Selected reference documents are fetched only after you load the preview.
      </p>
      <Label htmlFor={inputId}>Runtime preview file</Label>
      <Input
        id={inputId}
        type="file"
        accept="application/json,.json"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          const request = ++epoch.current;
          setReview(null);
          setConfirmed(false);
          setError("");
          setReading(false);
          if (!file) return;
          setReading(true);
          try {
            if (file.size > MAX_RUNTIME_PREVIEW_BYTES)
              throw new Error("Preview files must be at most 1 MiB.");
            const bytes = await file.arrayBuffer();
            if (epoch.current !== request || current.current !== artifact || !isCurrent()) return;
            if (bytes.byteLength > MAX_RUNTIME_PREVIEW_BYTES)
              throw new Error("Preview files must be at most 1 MiB.");
            const raw: unknown = JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(bytes),
            );
            const parsed = validateRuntimePreviewInput(artifact, raw);
            unexpired(parsed);
            setReview(parsed);
          } catch (cause) {
            if (epoch.current === request && current.current === artifact && isCurrent())
              setError(
                cause instanceof Error ? cause.message : "The preview file could not be read.",
              );
          } finally {
            if (epoch.current === request && current.current === artifact && isCurrent())
              setReading(false);
          }
        }}
      />
      {reading ? <p role="status">Reading preview file locally…</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error} Open the matching version or build before importing; no version is remapped
          automatically.
        </p>
      ) : null}
      {review ? (
        <section aria-label="Review runtime preview" className="space-y-3">
          <p className="break-all text-sm">
            {review.source.root.ref} · {buildIdentityKey(review.source.root)}
          </p>
          <p className="text-xs">
            {review.profile.mode} · {review.turn.locale} · {review.profile.context_window} tokens ·{" "}
            {review.tokenizer.name} {review.tokenizer.version}
          </p>
          <p className="text-xs text-text-2">
            The complete state, including variables and knowledge, may be private. Inspect all
            fields below. These are synthetic inputs, not a replay of the original model response.
            Optional selections and model judgments are not imported.
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-sm">
            <dt>Scene</dt>
            <dd>{review.turn.scene}</dd>
            <dt>Present</dt>
            <dd>{review.turn.present.join(", ") || "No participants"}</dd>
            <dt>Perspective</dt>
            <dd>{review.turn.for_participant ?? "Narrator"}</dd>
          </dl>
          <section aria-label="Synthetic messages" className="space-y-2">
            <h4 className="font-semibold">Synthetic messages</h4>
            {review.turn.history.length ? (
              <ol className="space-y-2">
                {review.turn.history.map((message, index) => (
                  <li key={index} className="rounded border p-2 text-sm">
                    <p className="font-semibold">
                      {message.role}
                      {message.speaker ? ` · ${message.speaker}` : ""}
                    </p>
                    <p className="whitespace-pre-wrap">{message.text}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-xs">No synthetic messages.</p>
            )}
          </section>
          <section aria-label="Synthetic role bindings" className="space-y-2">
            <h4 className="font-semibold">Synthetic role bindings</h4>
            {Object.entries(review.turn.bindings).map(([key, binding]) => (
              <div key={key} className="rounded border p-2 text-sm">
                <p>
                  {key} · {binding.kind} · {binding.display_name}
                </p>
                {binding.description ? (
                  <p className="whitespace-pre-wrap">{binding.description}</p>
                ) : null}
                {binding.outward_description ? (
                  <p className="whitespace-pre-wrap">{binding.outward_description}</p>
                ) : null}
              </div>
            ))}
          </section>
          <details>
            <summary className="cursor-pointer text-sm">Full state and input fields</summary>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-2 p-3 text-xs">
              {JSON.stringify(review, null, 2)}
            </pre>
          </details>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I reviewed the state, synthetic messages and role bindings.
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!confirmed || reading}
              onClick={() => {
                try {
                  const parsed = validateRuntimePreviewInput(artifact, review);
                  unexpired(parsed);
                  onApply(parsed);
                  setReview(null);
                  setConfirmed(false);
                  setError("");
                } catch (cause) {
                  setError(
                    cause instanceof Error ? cause.message : "The preview can no longer be loaded.",
                  );
                }
              }}
            >
              Load into preview
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                epoch.current++;
                setReview(null);
                setConfirmed(false);
                setError("");
              }}
            >
              Discard imported file
            </Button>
          </div>
        </section>
      ) : null}
      {active ? (
        <section aria-label="Imported preview input" className="space-y-2">
          <p role="status" className="text-sm">
            Using the imported synthetic state and profile. No opening message was added.
          </p>
          <p className="text-xs">
            Optional content can still be selected below. Saving an author test is a separate action
            and may include complete reference documents.
          </p>
          <details>
            <summary className="cursor-pointer text-xs">View active imported input</summary>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">
              {JSON.stringify(active, null, 2)}
            </pre>
          </details>
          <Button variant="outline" onClick={onExit}>
            Exit imported preview
          </Button>
        </section>
      ) : null}
    </section>
  );
}
