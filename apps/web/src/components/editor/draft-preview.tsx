import type { AssembleResult, ContextAssemblyInput } from "@char-pub/assembler";
import { type DraftBuildResponse, MAX_DRAFT_BYTES } from "@char-pub/contracts";
import type { AssemblyFixture } from "@char-pub/core";
import {
  buildIdentityKey,
  type CreationArtifact,
  canonicalizeCreation,
  type JSONValue,
  jcs,
} from "@char-pub/core";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ArtifactPicker } from "@/components/artifact-picker";
import type { SourceSharingAction } from "@/components/author-visibility-checks";
import { allowsMature } from "@/components/creation-context";
import { MatureGate } from "@/components/mature-gate";
import { PolicyContent } from "@/components/policy-artifact";
import { PreviewPanel } from "@/components/preview-panel";
import { RuntimeLaunch } from "@/components/runtime-launch";
import { Button } from "@/components/ui/button";
import { isApiError, type Me } from "@/lib/api";
import { shareAuthorSource } from "@/lib/author-visibility";
import { nextId, type Working } from "@/lib/draft";
import { type BuildPhase, buildSavedDraft } from "@/lib/draft-build";
import { createPreviewFixture } from "@/lib/preview-fixture";
import { keys, useMe, useRegistry } from "@/lib/registry";
import type { SavedDraftSnapshot } from "@/lib/use-draft-editor";

interface Props {
  blockedReason?: string | undefined;
  onLocateSource?: ((subject: string) => void) | undefined;
  working: Working;
  ns: string;
  name: string;
  save: () => Promise<SavedDraftSnapshot | null>;
  update?: (fn: (w: Working) => Working) => void;
}
export function DraftPreview(props: Props) {
  const me = useMe();
  if (me.isPending) return <p role="status">Loading your account…</p>;
  if (!me.data) return <p role="alert">Sign in to build a private draft preview.</p>;
  return (
    <DraftPreviewSession
      key={`${me.data?.id ?? "anonymous"}:${props.ns}:${props.name}`}
      {...props}
    />
  );
}
function DraftPreviewSession({
  working,
  ns,
  name,
  save,
  update,
  blockedReason,
  onLocateSource,
}: Props) {
  const client = useRegistry();
  const queryClient = useQueryClient();
  const me = useMe();
  const [snapshot, setSnapshot] = useState<{ working: Working; artifact: CreationArtifact } | null>(
    null,
  );
  const [content, setContent] = useState<CreationArtifact | null>(null);
  const [phase, setPhase] = useState<BuildPhase | null>(null);
  const [receipt, setReceipt] = useState<DraftBuildResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runtimeRequested, setRuntimeRequested] = useState(false);
  const request = useRef<AbortController | null>(null);
  const latest = useRef(working);
  latest.current = working;
  const capturing = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => () => request.current?.abort(), []);
  const busy = phase !== null;
  const cancel = () => {
    request.current?.abort();
    request.current = null;
    setPhase(null);
    setError("Stopped waiting. Your saved draft is safe; the server build may still finish.");
  };
  const run = async (openRuntime = false) => {
    if (blockedReason) return;
    setRuntimeRequested(openRuntime);
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const actor = me.data?.id;
    const current = () =>
      request.current === controller &&
      !controller.signal.aborted &&
      queryClient.getQueryData<Me | null>(keys.me)?.id === actor;
    setError(null);
    setSnapshot(null);
    setReceipt(null);
    setPhase("saving");
    try {
      const result = await buildSavedDraft({
        client,
        ns,
        name,
        save,
        signal: controller.signal,
        isCurrent: current,
        onPhase: (p) => {
          if (current()) setPhase(p);
        },
        onReceipt: (r) => {
          if (current()) setReceipt(r);
        },
      });
      if (!current()) return;
      if (result.receipt.state !== "ready") {
        setError(
          result.receipt.state === "failed"
            ? "The draft could not be built. Review the checks, edit the draft, then try again."
            : "This preview has expired or was deleted. Build a new preview.",
        );
        return;
      }
      setPhase("loading");
      const artifact = await client.draftArtifact(result.receipt, controller.signal);
      if (current()) setSnapshot({ working: result.snapshot.working, artifact });
    } catch (e) {
      if (current())
        setError(
          isApiError(e, "draft_build.default_policy_unavailable")
            ? "This service has no available default context preset. Ask the administrator to configure it, then try again. Your saved draft is safe; editing it will not fix this service configuration."
            : e instanceof Error
              ? e.message
              : "Could not build the draft preview.",
        );
    } finally {
      if (current()) setPhase(null);
    }
  };
  const artifact = snapshot?.artifact;
  const shareSource = (id: string): SourceSharingAction => {
    const actor = me.data?.id;
    const live = () =>
      mounted.current && queryClient.getQueryData<Me | null>(keys.me)?.id === actor;
    if (
      blockedReason ||
      busy ||
      !update ||
      !snapshot ||
      snapshot.artifact.kind !== "content" ||
      !live() ||
      latest.current !== snapshot.working
    )
      throw new Error("Build the current draft before sharing a document.");
    const origin = "origin" in snapshot.artifact.root ? snapshot.artifact.root.origin : undefined;
    if (origin?.kind === "draft-build" && Date.parse(origin.expires_at) <= Date.now())
      throw new Error("This preview expired. Build it again before sharing a document.");
    const change = shareAuthorSource(snapshot.working, snapshot.artifact, id);
    let applied = false;
    update((current) => {
      if (!live() || current !== snapshot.working)
        throw new Error("The draft changed. Build it again before sharing.");
      applied = true;
      return change.working;
    });
    if (!applied)
      throw new Error("The draft cannot be edited now. Resolve its save state before sharing.");
    return {
      undo: () => {
        let restored = false;
        update((current) => {
          if (!live())
            throw new Error("The account or work changed. Reopen this draft before editing.");
          const next = change.undo(current);
          restored = true;
          return next;
        });
        if (!restored)
          throw new Error("The draft cannot be edited now. Resolve its save state before undoing.");
      },
    };
  };
  const capture = async (input: ContextAssemblyInput, result: AssembleResult): Promise<string> => {
    const actor = me.data?.id;
    const live = () =>
      mounted.current && queryClient.getQueryData<Me | null>(keys.me)?.id === actor;
    if (
      blockedReason ||
      !update ||
      !snapshot ||
      !live() ||
      latest.current !== snapshot.working ||
      capturing.current
    )
      throw new Error("Build the current draft before saving a test.");
    const origin = "origin" in snapshot.artifact.root ? snapshot.artifact.root.origin : undefined;
    if (origin?.kind === "draft-build" && Date.parse(origin.expires_at) <= Date.now())
      throw new Error("This draft preview has expired. Build a new preview before saving a test.");
    capturing.current = true;
    try {
      const tests = (latest.current.assembly_tests ?? []) as AssemblyFixture[];
      const fixture = createPreviewFixture({
        input,
        result,
        id: nextId(
          tests.map((t) => t.id),
          "preview",
        ),
        saveTo: snapshot.artifact.kind === "preset" ? "preset" : "content",
      });
      const candidate = { ...snapshot.working, assembly_tests: [...tests, fixture] };
      if (
        new TextEncoder().encode(JSON.stringify({ working: candidate })).byteLength >
        MAX_DRAFT_BYTES
      )
        throw new Error(
          "This test would exceed the 5 MiB draft limit because it includes complete reference documents. No test was added. Use a smaller reference document or a preview without it.",
        );
      const expected = canonicalizeCreation(candidate).creation.assembly_tests?.find(
        (t) => t.id === fixture.id,
      );
      if (!expected) throw new Error("Could not prepare the saved test.");
      update((w) => {
        if (!live() || w !== snapshot.working)
          throw new Error("The draft changed. Build it again before saving a test.");
        return {
          ...w,
          assembly_tests: [...((w.assembly_tests ?? []) as AssemblyFixture[]), expected],
        };
      });
      const saved = await save();
      if (!live()) throw new Error("The account or work changed while saving.");
      if (
        !saved ||
        !((saved.working.assembly_tests ?? []) as AssemblyFixture[]).some(
          (t) =>
            t.id === fixture.id &&
            jcs(t as unknown as JSONValue) === jcs(expected as unknown as JSONValue),
        )
      )
        throw new Error(
          "The test was added locally but could not be confirmed saved. Resolve the draft save issue before running it.",
        );
      return `Saved author test ${fixture.id}. Run author tests to verify it against a new build.`;
    } finally {
      capturing.current = false;
    }
  };
  const captureProps = update
    ? {
        onSaveTest: capture,
        testDisabledReason:
          blockedReason ??
          (busy || snapshot?.working !== working
            ? "Build the current draft before saving another test."
            : undefined),
      }
    : {};
  return (
    <section id="edit-draft-preview" className="space-y-4 rounded-xl border bg-surface p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-bold">Preview this draft</h2>
        <Button
          type="button"
          variant="outline"
          disabled={busy || !!blockedReason}
          onClick={() => void run()}
        >
          {phase === "saving"
            ? "Saving…"
            : phase === "loading"
              ? "Loading preview…"
              : busy
                ? "Building…"
                : "Build draft preview"}
        </Button>
        {working.type !== "preset" && working.type !== "prompt-module" ? (
          <Button
            type="button"
            variant="outline"
            disabled={busy || !!blockedReason}
            onClick={() => void run(true)}
          >
            Try draft in Runtime
          </Button>
        ) : null}
        {busy ? (
          <Button type="button" variant="ghost" onClick={cancel}>
            Stop waiting
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-text-2">
        Saves your current edits and checks locked dependencies before preparing a private preview.
        Nothing is published and no model is called.
      </p>
      {blockedReason ? <p role="status">{blockedReason}</p> : null}
      {busy ? (
        <p role="status">
          {phase === "saving"
            ? "Saving the draft…"
            : phase === "building"
              ? "Checking the draft and its reference documents…"
              : "Loading the completed preview…"}
        </p>
      ) : null}
      {receipt?.state === "failed" && receipt.report ? (
        <details>
          <summary>Build checks</summary>
          <pre className="overflow-auto whitespace-pre-wrap text-xs">
            {JSON.stringify(receipt.report, null, 2)}
          </pre>
        </details>
      ) : null}
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
          identity={me.data?.id}
          key={buildIdentityKey(artifact.root)}
          rating={artifact.meta.rating}
          allowed={allowsMature(me.data)}
          signedIn={!!me.data}
        >
          {artifact.kind === "content" ? (
            <>
              <RuntimeLaunch
                artifact={artifact}
                label="Open this build in Runtime"
                initiallyOpen={runtimeRequested}
                disabledReason={
                  blockedReason ??
                  (busy || snapshot?.working !== working
                    ? "Build the current draft before playing it."
                    : undefined)
                }
                isCurrent={() => snapshot?.working === latest.current && !blockedReason && !busy}
              />
              <PreviewPanel
                authorDiagnostics
                key={buildIdentityKey(artifact.root)}
                artifact={artifact}
                onShareSource={update ? shareSource : undefined}
                sourceSharingDisabledReason={
                  blockedReason ??
                  (busy || snapshot?.working !== working
                    ? "Build the current draft before sharing a document."
                    : undefined)
                }
                onLocateSource={
                  onLocateSource
                    ? (subject) => {
                        if (snapshot?.working === latest.current) onLocateSource(subject);
                      }
                    : undefined
                }
                locateDisabledReason={
                  snapshot?.working !== working
                    ? "Build the current draft before locating its source."
                    : undefined
                }
                {...captureProps}
              />
            </>
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
                      authorDiagnostics
                      key={`${artifact.root.semantic_digest}:${buildIdentityKey(content.root)}`}
                      artifact={content}
                      preset={artifact.preset}
                      {...captureProps}
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
