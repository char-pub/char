import { assembleArtifact, type TokenizerName } from "@char-pub/assembler";
import {
  type ContextIR,
  type CreationArtifact,
  isCharError,
  type Rating,
  type ResolvedPreset,
} from "@char-pub/core";
import { TriangleAlert } from "lucide-react";
import { type ComponentProps, useEffect, useMemo, useState } from "react";
import { ArtifactPicker } from "@/components/artifact-picker";
import { allowsMature } from "@/components/creation-context";
import { MatureGate } from "@/components/mature-gate";
import { highestRating } from "@/components/rating";
import { SessionControls } from "@/components/session-controls";
import { TraceSummary, TraceTable } from "@/components/trace-table";
import {
  bindingsFor,
  DEFAULT_SETTINGS,
  type PreviewOutcome,
  type PreviewSettings,
  parseHistory,
  runPreview,
} from "@/lib/preview";
import { useMe } from "@/lib/registry";
import { useTokenCounter } from "@/lib/use-token-counter";

export function PreviewPanel(props: ComponentProps<typeof PreviewSession>) {
  const me = useMe();
  return <PreviewSession key={me.data?.id ?? "anonymous"} {...props} />;
}

function PreviewSession({
  ir,
  headingLevel = 2,
  initialSettings = DEFAULT_SETTINGS,
  note = "Nothing here is sent anywhere — the context is assembled in your browser.",
  preset: initialPreset,
  artifact,
}: {
  ir: ContextIR;
  headingLevel?: 2 | 3;
  initialSettings?: PreviewSettings;
  note?: string;
  preset?: ResolvedPreset;
  artifact?: CreationArtifact | undefined;
}) {
  const me = useMe();
  const [selectedRating, setSelectedRating] = useState<Rating>("general");
  const [settings, setSettings] = useState<PreviewSettings>(initialSettings);
  const [tokenizer, setTokenizer] = useState<TokenizerName>("estimate");
  const [preset, setPreset] = useState<ResolvedPreset | undefined>(initialPreset);
  const hasLocked = artifact?.kind === "content" && !!artifact.assembly;
  const [lockPreference, setLockPreference] = useState<boolean | null>(null);
  const locked = hasLocked && (lockPreference ?? true);
  const lockedConfig = artifact?.kind === "content" ? artifact.assembly : undefined;
  const activeSettings =
    locked && lockedConfig
      ? {
          ...settings,
          mode: lockedConfig.profile.mode,
          contextWindow: lockedConfig.profile.context_window,
          reserveForOutput: lockedConfig.profile.reserve_for_output,
        }
      : settings;
  const [lockedOutcome, setLockedOutcome] = useState<PreviewOutcome | null>(null);
  const { counter, status } = useTokenCounter(tokenizer);
  const localOutcome = useMemo(
    () => runPreview(ir, settings, counter, preset),
    [ir, settings, counter, preset],
  );
  useEffect(() => {
    if (!locked || !artifact || artifact.kind !== "content" || !artifact.assembly) return;
    let active = true;
    setLockedOutcome(null);
    void assembleArtifact({
      artifact,
      session: {
        locale: settings.locale,
        bindings: bindingsFor(ir, settings.persona, settings.lateBindings),
        history: parseHistory(settings.historyText),
        manual_enabled: settings.manualEnabled,
        ...(lockedConfig?.profile.mode === "per-agent" && settings.forParticipant
          ? { for_participant: settings.forParticipant }
          : {}),
      },
    })
      .then((result) => {
        if (active) setLockedOutcome({ ok: true, result });
      })
      .catch((error: unknown) => {
        if (active)
          setLockedOutcome({
            ok: false,
            code: isCharError(error) ? error.code : "assembly.failed",
            title: "The locked setup could not be assembled",
            detail: error instanceof Error ? error.message : String(error),
          });
      });
    return () => {
      active = false;
    };
  }, [locked, artifact, ir, settings]);
  const outcome = locked ? lockedOutcome : localOutcome;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[20rem_1fr]">
      <section
        aria-labelledby="pv-session"
        className="h-fit space-y-4 rounded-lg border bg-surface px-5 py-4"
      >
        <Heading id="pv-session" className="font-semibold">
          Session
        </Heading>
        {hasLocked ? (
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={locked}
              onChange={(e) => setLockPreference(e.target.checked)}
            />
            Use the author's locked setup
          </label>
        ) : null}
        {locked && artifact?.kind === "content" && artifact.assembly ? (
          <p className="text-xs">
            Locked: {artifact.assembly.preset.ref} · {artifact.assembly.profile.context_window}{" "}
            tokens · {artifact.assembly.tokenizer.name} {artifact.assembly.tokenizer.version}.
            Session inputs below stay local.
          </p>
        ) : null}
        {!locked ? (
          <div className="space-y-2">
            <p className="text-xs font-mono break-all">
              {preset ? `${preset.ref} · ${preset.release}` : "Default layout — no preset selected"}
            </p>
            {preset ? (
              <button
                type="button"
                className="text-xs underline"
                onClick={() => {
                  setPreset(undefined);
                  setSelectedRating("general");
                }}
              >
                Use default layout
              </button>
            ) : null}
            <ArtifactPicker
              label="Choose a preset"
              types={["preset"]}
              onPick={({ artifact: selected }) => {
                if (selected.kind === "preset") {
                  setPreset(selected.preset);
                  setSelectedRating(selected.meta.rating);
                }
              }}
            />
          </div>
        ) : null}
        <SessionControls
          ir={ir}
          settings={activeSettings}
          onChange={setSettings}
          tokenizer={
            locked && lockedConfig ? (lockedConfig.tokenizer.name as TokenizerName) : tokenizer
          }
          onTokenizer={setTokenizer}
          tokenizerStatus={status}
          locked={locked}
        />
      </section>
      <section aria-labelledby="pv-trace" className="min-w-0 space-y-4">
        <Heading id="pv-trace" className="sr-only">
          Context Preview
        </Heading>
        <MatureGate
          identity={me.data?.id}
          key={`${me.data?.id}:${ir.root.release}:${preset?.semantic_digest}:${artifact?.root.semantic_digest}`}
          rating={highestRating(ir.meta.rating, artifact?.meta.rating, selectedRating)}
          allowed={allowsMature(me.data)}
          signedIn={!!me.data}
        >
          {!outcome ? (
            <p role="status">Assembling the locked setup…</p>
          ) : outcome.ok ? (
            <>
              <TraceSummary trace={outcome.result.trace} ir={ir} />
              {outcome.result.trace.preset ? (
                <p className="rounded border p-3 text-xs font-mono break-all">
                  Policy: {outcome.result.trace.preset.ref} · {outcome.result.trace.preset.release}{" "}
                  · {outcome.result.trace.preset.semantic_digest}
                </p>
              ) : null}
              <section className="space-y-2">
                <h3 className="font-semibold">Messages sent to the model, in order</h3>
                <ol aria-label="Assembled messages" className="space-y-3">
                  {outcome.result.messages.map((message, index) => (
                    <li key={index} className="rounded-lg border bg-surface p-3">
                      <p className="mb-2 text-xs font-semibold uppercase">
                        {index + 1}. {message.role}
                      </p>
                      <pre className="whitespace-pre-wrap break-words font-sans text-sm">
                        {message.content}
                      </pre>
                      {message.attachments?.length ? (
                        <p className="mt-2 text-xs">{message.attachments.length} attachment(s)</p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </section>
              <TraceTable trace={outcome.result.trace} ir={ir} />
            </>
          ) : (
            <PreviewProblem title={outcome.title} detail={outcome.detail} code={outcome.code} />
          )}
        </MatureGate>
        <p className="text-xs text-text-3">{note}</p>
      </section>
    </div>
  );
}
export function PreviewProblem({
  title,
  detail,
  code,
}: {
  title: string;
  detail: string;
  code?: string;
}) {
  return (
    <div role="alert" className="flex gap-3 rounded-lg bg-danger-soft px-5 py-4">
      <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-danger" />
      <div className="space-y-0.5">
        <p className="font-semibold">{title}</p>
        <p className="text-sm text-text-2">{detail}</p>
        {code ? <p className="mt-1 font-mono text-xs text-text-3">{code}</p> : null}
      </div>
    </div>
  );
}
