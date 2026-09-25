import { buildCreation, type CreationArtifact } from "@char-pub/core";
import { useState } from "react";
import { ArtifactPicker } from "@/components/artifact-picker";
import { allowsMature } from "@/components/creation-context";
import { MatureGate } from "@/components/mature-gate";
import { PolicyContent } from "@/components/policy-artifact";
import { PreviewPanel } from "@/components/preview-panel";
import { Button } from "@/components/ui/button";
import { loadAssemblyInput } from "@/lib/assembly-input";
import type { Working } from "@/lib/draft";
import { useMe, useRegistry } from "@/lib/registry";

export function DraftPreview({ working }: { working: Working }) {
  const me = useMe();
  return <DraftPreviewSession key={me.data?.id ?? "anonymous"} working={working} />;
}
function DraftPreviewSession({ working }: { working: Working }) {
  const client = useRegistry();
  const me = useMe();
  const [snapshot, setSnapshot] = useState<{ working: Working; artifact: CreationArtifact } | null>(
    null,
  );
  const [content, setContent] = useState<CreationArtifact | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const input = await loadAssemblyInput(client, working);
      setSnapshot({ working, artifact: buildCreation(input).artifact });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the draft");
    } finally {
      setBusy(false);
    }
  };
  const artifact = snapshot?.artifact;
  return (
    <section className="space-y-4 rounded-xl border bg-surface p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-bold">Preview this draft</h2>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void run()}>
          {busy ? "Building…" : "Build draft preview"}
        </Button>
      </div>
      <p className="text-xs text-text-2">
        Uses your current local edits and locked dependency versions. Nothing is published. Resolve
        validation errors before building.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {snapshot && snapshot.working !== working ? (
        <p role="status" className="text-sm text-warning">
          This preview is from earlier edits. Build it again to review the current draft.
        </p>
      ) : null}
      {artifact ? (
        <MatureGate
          key={artifact.root.semantic_digest}
          rating={artifact.meta.rating}
          allowed={allowsMature(me.data)}
          signedIn={!!me.data}
        >
          {artifact.kind === "content" ? (
            <PreviewPanel
              key={artifact.root.semantic_digest}
              ir={artifact.ir}
              artifact={artifact}
            />
          ) : artifact ? (
            <>
              <PolicyContent artifact={artifact} />
              {artifact.kind === "preset" ? (
                <>
                  <ArtifactPicker
                    label="Content for draft preview"
                    types={[
                      "character",
                      "scenario",
                      "world",
                      "lorebook",
                      "style",
                      "persona",
                      "relationship",
                    ]}
                    onPick={({ artifact: selected }) => setContent(selected)}
                  />
                  {content?.kind === "content" ? (
                    <PreviewPanel
                      key={`${artifact.root.semantic_digest}:${content.root.release}`}
                      ir={content.ir}
                      preset={artifact.preset}
                    />
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}
        </MatureGate>
      ) : null}
    </section>
  );
}
