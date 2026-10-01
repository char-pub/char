import type { CreationArtifact } from "@char-pub/core";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import type { Me } from "@/lib/api";
import { buildProposalPreview, proposalSourceTexts } from "@/lib/proposal-preview";
import { keys, useMe, useRegistry } from "@/lib/registry";
import { allowsMature } from "./creation-context";
import { MatureGate } from "./mature-gate";
import { PolicyContent } from "./policy-artifact";
import { PreviewPanel } from "./preview-panel";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
export function ProposalPreview({ working }: { working: unknown }) {
  const client = useRegistry();
  const qc = useQueryClient();
  const me = useMe();
  const actor = me.data?.id ?? null;
  const latest = useRef(working);
  latest.current = working;
  const serial = useRef(0);
  const fileSerial = useRef(0);
  const fileId = useId();
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [localTexts, setLocalTexts] = useState<Record<string, string>>({});
  const [built, setBuilt] = useState<{
    input: string;
    actor: string | null;
    artifact: CreationArtifact;
  }>();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      serial.current++;
    };
  }, []);
  const input = JSON.stringify(working);
  const run = async () => {
    if (busy) return;
    const job = ++serial.current;
    const current = () =>
      mounted.current &&
      serial.current === job &&
      (qc.getQueryData<Me | null>(keys.me)?.id ?? null) === actor;
    const check = () => {
      if (!current() || JSON.stringify(latest.current) !== input)
        throw new Error("The proposal or account changed. Preview the latest edits again.");
    };
    setBusy(true);
    setError("");
    setBuilt(undefined);
    setLocalTexts({});
    try {
      const artifact = await buildProposalPreview(client, working, check);
      check();
      setBuilt({ input, actor, artifact });
    } catch (cause) {
      if (current())
        setError(cause instanceof Error ? cause.message : "The proposal could not be previewed.");
    } finally {
      if (current()) setBusy(false);
    }
  };
  const artifact = built?.input === input && built.actor === actor ? built.artifact : undefined;
  return (
    <section aria-label="Proposal preview" className="space-y-4 rounded-lg border p-5">
      <h3 className="font-semibold">Try these changes</h3>
      <p className="text-sm text-text-2">
        Preview this proposal locally. The author's draft is changed only after they accept it.
      </p>
      <Button type="button" disabled={busy} onClick={() => void run()}>
        {busy ? "Building proposal preview…" : "Preview proposed changes"}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {built && !artifact ? <p role="status">The proposal changed. Build a new preview.</p> : null}
      {artifact?.assets.some(
        (a) => a.role === "context" && ["text/plain", "text/markdown"].includes(a.media_type),
      ) ? (
        <label htmlFor={fileId} className="block space-y-2 text-sm">
          <span>Local reference files for this preview</span>
          <Input
            id={fileId}
            type="file"
            multiple
            accept=".txt,.md,.markdown,text/plain,text/markdown"
            onChange={async (event) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = "";
              const job = serial.current;
              const fileJob = ++fileSerial.current;
              try {
                if (files.reduce((total, file) => total + file.size, 0) > 5 * 1024 * 1024)
                  throw new Error("Choose reference files totaling at most 5 MiB.");
                const texts: Record<string, string> = {};
                for (const file of files)
                  Object.assign(
                    texts,
                    proposalSourceTexts(artifact, new Uint8Array(await file.arrayBuffer())),
                  );
                if (
                  mounted.current &&
                  serial.current === job &&
                  fileSerial.current === fileJob &&
                  JSON.stringify(latest.current) === input &&
                  (qc.getQueryData<Me | null>(keys.me)?.id ?? null) === actor
                ) {
                  setLocalTexts(texts);
                  setError("");
                }
              } catch (cause) {
                if (
                  mounted.current &&
                  serial.current === job &&
                  fileSerial.current === fileJob &&
                  (qc.getQueryData<Me | null>(keys.me)?.id ?? null) === actor
                )
                  setError(cause instanceof Error ? cause.message : "Could not read these files.");
              }
            }}
          />
          <span className="block text-xs text-text-2">
            Choose the matching original files together. They stay in this browser; their bytes are
            checked before selected sections enter the preview.
          </span>
        </label>
      ) : null}
      {artifact?.kind === "content" ? (
        <PreviewPanel
          authorDiagnostics
          sourceTexts={localTexts}
          artifact={artifact}
          headingLevel={3}
          note="This is a local proposal preview. No target draft, Release or session has been created."
        />
      ) : artifact ? (
        <MatureGate
          identity={actor ?? undefined}
          rating={artifact.meta.rating}
          allowed={allowsMature(me.data)}
          signedIn={!!actor}
          remember={artifact.root.ref}
        >
          <PolicyContent artifact={artifact} />
        </MatureGate>
      ) : null}
    </section>
  );
}
