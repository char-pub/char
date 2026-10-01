import {
  type AssembleResult,
  assembleArtifact,
  type ContentArtifact,
  type ContextAssemblyInput,
  catalogKey,
  createPinnedTokenCounter,
  type OpeningMessage,
  prepareContext,
  type TokenizerName,
  validateRuntimePreviewInput,
} from "@char-pub/assembler";
import type { CatalogRef, Rating, ResolvedPreset, RuntimePreviewInput } from "@char-pub/core";
import { buildIdentityKey } from "@char-pub/core";
import { useQueryClient } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { type ComponentProps, useEffect, useId, useMemo, useRef, useState } from "react";
import { ArtifactPicker } from "@/components/artifact-picker";
import {
  AuthorVisibilityChecks,
  type SourceSharingAction,
} from "@/components/author-visibility-checks";
import { allowsMature } from "@/components/creation-context";
import { MatureGate } from "@/components/mature-gate";
import { PreviewCatalog } from "@/components/preview-catalog";
import { PreviewOpening } from "@/components/preview-opening";
import { PreviewRelatedLinks } from "@/components/preview-related-links";
import { highestRating } from "@/components/rating";
import { RuntimePreviewImport } from "@/components/runtime-preview-import";
import { SessionControls } from "@/components/session-controls";
import { StoryRehearsalPanel } from "@/components/story-rehearsal";
import { TraceSummary, TraceTable } from "@/components/trace-table";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import type { Me } from "@/lib/api";
import { CAPABILITY_NAMES } from "@/lib/capabilities";
import {
  DEFAULT_SETTINGS,
  loadPreviewSources,
  type PreviewOutcome,
  type PreviewSettings,
  type PreviewSourceChoice,
  previewFailure,
  previewFragmentChoices,
  previewPreparation,
  previewSourceChoices,
  selectPreviewInput,
} from "@/lib/preview";
import { keys, useMe, useRegistry } from "@/lib/registry";
import { localized } from "@/lib/text";
import { useTokenCounter } from "@/lib/use-token-counter";

export function PreviewPanel(props: ComponentProps<typeof PreviewSession>) {
  const me = useMe();
  if (me.isPending) return <p role="status">Preparing preview…</p>;
  return (
    <PreviewSession
      key={`${me.data?.id ?? "anonymous"}:${buildIdentityKey(props.artifact.root)}:${props.artifact.root.semantic_digest}`}
      {...props}
    />
  );
}

function PreviewSession({
  headingLevel = 2,
  initialSettings = DEFAULT_SETTINGS,
  note = "Context assembly stays in your browser. Selected reference documents are fetched from the registry; your role bindings and sample messages are not sent.",
  preset: initialPreset,
  artifact,
  onSaveTest,
  testDisabledReason,
  sourceTexts,
  onLocateSource,
  locateDisabledReason,
  authorDiagnostics = false,
  onShareSource,
  sourceSharingDisabledReason,
}: {
  authorDiagnostics?: boolean;
  onShareSource?: ((id: string) => SourceSharingAction) | undefined;
  sourceSharingDisabledReason?: string | undefined;
  headingLevel?: 2 | 3;
  onLocateSource?: ((subject: string) => void) | undefined;
  locateDisabledReason?: string | undefined;
  initialSettings?: PreviewSettings;
  note?: string;
  preset?: ResolvedPreset;
  artifact: ContentArtifact;
  onSaveTest?: (input: ContextAssemblyInput, result: AssembleResult) => Promise<string>;
  testDisabledReason?: string | undefined;
  sourceTexts?: Readonly<Record<string, string>> | undefined;
}) {
  const ir = artifact.ir;
  const client = useRegistry();
  const queryClient = useQueryClient();
  const startId = useId();
  const me = useMe();
  const [selectedRating, setSelectedRating] = useState<Rating>("general");
  const [settings, setSettings] = useState<PreviewSettings>(initialSettings);
  const [imported, setImported] = useState<RuntimePreviewInput | null>(null);
  const [importedSelection, setImportedSelection] = useState<CatalogRef[]>([]);
  const selection = imported ? importedSelection : settings.selection;
  const selectContent = (next: CatalogRef[]) => {
    if (imported) setImportedSelection(next);
    else setSettings((current) => ({ ...current, selection: next }));
  };
  const [tokenizer, setTokenizer] = useState<TokenizerName>("estimate");
  const [preset, setPreset] = useState<ResolvedPreset | undefined>(
    initialPreset ?? artifact.assembly?.preset,
  );
  const hasLocked = artifact?.kind === "content" && !!artifact.assembly;
  const [lockPreference, setLockPreference] = useState<boolean | null>(null);
  const locked = !imported && hasLocked && (lockPreference ?? !initialPreset);
  const lockedConfig = artifact?.kind === "content" ? artifact.assembly : undefined;
  const activeSettings =
    locked && lockedConfig
      ? {
          ...settings,
          mode: lockedConfig.profile.mode,
          locale: lockedConfig.profile.locale ?? settings.locale,
          images: lockedConfig.profile.capabilities.images ?? false,
          contextWindow: lockedConfig.profile.context_window,
          reserveForOutput: lockedConfig.profile.reserve_for_output,
        }
      : settings;
  const { counter, status } = useTokenCounter(tokenizer);
  const [retry, setRetry] = useState(0);
  const [savingTest, setSavingTest] = useState(false);
  const [testNotice, setTestNotice] = useState("");
  const [testError, setTestError] = useState("");
  const job = useMemo(
    () => ({
      artifact,
      settings,
      counter,
      preset,
      locked,
      client,
      retry,
      sourceTexts,
      imported,
      selection,
    }),
    [artifact, settings, counter, preset, locked, client, retry, sourceTexts, imported, selection],
  );
  const latestJob = useRef(job);
  latestJob.current = job;
  const saveMounted = useRef(true);
  useEffect(() => {
    saveMounted.current = true;
    return () => {
      saveMounted.current = false;
    };
  }, []);
  useEffect(() => {
    setTestNotice("");
    setTestError("");
  }, [job]);
  const [preview, setPreview] = useState<{
    job: typeof job;
    outcome: PreviewOutcome | null;
    sources: PreviewSourceChoice[];
    directoryError?: string;
    input?: ContextAssemblyInput;
    fragments?: ReturnType<typeof previewFragmentChoices>;
    fixtureInput?: ContextAssemblyInput;
    opening?: OpeningMessage | null;
  } | null>(null);
  useEffect(() => {
    let active = true;
    const actor = me.data?.id;
    const live = () => active && queryClient.getQueryData<Me | null>(keys.me)?.id === actor;
    const controller = new AbortController();
    void (async () => {
      const config = locked ? artifact.assembly : undefined;
      const handoff = imported ? validateRuntimePreviewInput(artifact, imported) : null;
      const selectedCounter = handoff
        ? await createPinnedTokenCounter(handoff.tokenizer)
        : config
          ? await createPinnedTokenCounter(config.tokenizer)
          : counter;
      if (!live()) return;
      const settingsForInput = handoff
        ? { ...settings, turn: handoff.turn }
        : config
          ? {
              ...settings,
              mode: config.profile.mode,
              locale: config.profile.locale ?? settings.locale,
              images: config.profile.capabilities.images ?? false,
              contextWindow: config.profile.context_window,
              reserveForOutput: config.profile.reserve_for_output,
            }
          : settings;
      const initialized = previewPreparation(
        artifact,
        settingsForInput,
        selectedCounter,
        handoff
          ? (artifact.assembly?.preset ?? artifact.default_policy)
          : (config?.preset ?? preset),
      );
      const base = initialized.input;
      // Author inspection has its own panel; final Trace always uses the consumer projection.
      delete base.diagnostics;
      if (handoff) base.profile = handoff.profile;
      else if (config) base.profile = config.profile;
      let sources: PreviewSourceChoice[] = [];
      let fragments: ReturnType<typeof previewFragmentChoices> = [];
      let directoryError: string | undefined;
      try {
        sources = previewSourceChoices(base);
        fragments = previewFragmentChoices(base);
      } catch (error) {
        directoryError = previewFailure(error).detail;
      }
      const snapshot = {
        job,
        sources,
        fragments,
        input: base,
        opening: initialized.opening,
        ...(directoryError ? { directoryError } : {}),
      };
      setPreview({ ...snapshot, outcome: null });
      const input = selectPreviewInput(base, selection);
      const source_texts =
        sourceTexts ?? (await loadPreviewSources(client, input, controller.signal));
      if (!live()) return;
      const result = config
        ? await assembleArtifact({
            artifact,
            session: input.turn,
            ...(input.plan ? { plan: input.plan } : {}),
            source_texts,
          })
        : prepareContext({ ...input, source_texts });
      if (live())
        setPreview({
          ...snapshot,
          fixtureInput: { ...input, source_texts },
          outcome: { ok: true, result },
        });
    })().catch((error: unknown) => {
      if (live())
        setPreview((previous) => ({
          ...(previous?.job === job ? previous : { job, sources: [] }),
          outcome: previewFailure(error),
        }));
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [job, locked, artifact, settings, counter, preset, client, sourceTexts, imported, selection]);
  const current = preview?.job === job ? preview : null;
  const outcome = current?.outcome ?? null;
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
        {artifact.story && !imported ? (
          <div className="space-y-2 text-sm">
            <label htmlFor={startId} className="block space-y-1">
              <span>Story opening</span>
              <NativeSelect
                id={startId}
                value={settings.start ?? artifact.story.starts?.[0]?.id ?? "default"}
                disabled={!!settings.turn}
                onChange={(e) => {
                  const { rehearsal: _r, judgments: _j, ...rest } = settings;
                  setSettings({ ...rest, start: e.target.value });
                }}
              >
                {artifact.story.starts ? (
                  artifact.story.starts.map((start) => (
                    <option key={start.id} value={start.id}>
                      {localized(start.title, settings.locale) || start.id}
                    </option>
                  ))
                ) : (
                  <option value="default">Default opening</option>
                )}
              </NativeSelect>
            </label>
            <p className="text-xs text-text-2">
              {settings.turn
                ? "Previewing the supplied story snapshot."
                : "Previews the opening scene. Changing the opening resets story state; your role bindings and sample messages stay in place."}
            </p>
          </div>
        ) : null}
        {hasLocked && !imported ? (
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
        {!locked && !imported ? (
          <div className="space-y-2">
            <p className="text-xs font-mono break-all">
              {preset
                ? `${preset.ref} · ${buildIdentityKey(preset)}`
                : artifact.default_policy
                  ? `Default: ${artifact.default_policy.ref} · ${artifact.default_policy.release}`
                  : "Default layout — no preset selected"}
            </p>
            {preset && artifact.default_policy ? (
              <button
                type="button"
                className="text-xs underline"
                onClick={() => {
                  setPreset(undefined);
                  setSelectedRating("general");
                }}
              >
                {artifact.default_policy
                  ? "Use the release's default preset"
                  : "Use default layout"}
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
        <section className="space-y-1 text-xs" aria-label="Required runtime capabilities">
          <h3 className="font-semibold">Required runtime capabilities</h3>
          <p className="text-text-2">
            Your runtime must support these features or explain its limitations.
          </p>
          <ul className="list-disc pl-4">
            {artifact.capabilities.map((capability) => (
              <li key={capability.id}>
                {CAPABILITY_NAMES[capability.id] ?? capability.id}
                {capability.experimental ? " (experimental)" : ""}
              </li>
            ))}
          </ul>
        </section>
        {imported ? (
          <p className="text-sm text-text-2">
            Imported state and profile are active. Exit the imported preview to use the normal
            session controls.
          </p>
        ) : (
          <SessionControls
            ir={ir}
            templateLocales={[
              ...Object.values(artifact.story_refs?.templates ?? {}),
              ...ir.bootstrap.greetings,
            ].flatMap((template) => Object.keys(template.locales ?? {}))}
            settings={activeSettings}
            onChange={setSettings}
            tokenizer={
              locked && lockedConfig ? (lockedConfig.tokenizer.name as TokenizerName) : tokenizer
            }
            onTokenizer={setTokenizer}
            tokenizerStatus={status}
            locked={locked}
          />
        )}
      </section>
      <section aria-labelledby="pv-trace" className="min-w-0 space-y-4">
        <Heading id="pv-trace" className="sr-only">
          Context Preview
        </Heading>
        <MatureGate
          identity={me.data?.id}
          key={`${me.data?.id}:${buildIdentityKey(ir.root)}:${preset?.semantic_digest}:${artifact?.root.semantic_digest}`}
          rating={highestRating(ir.meta.rating, artifact?.meta.rating, selectedRating)}
          allowed={allowsMature(me.data)}
          signedIn={!!me.data}
        >
          {artifact.story ? (
            <RuntimePreviewImport
              artifact={artifact}
              isCurrent={() => queryClient.getQueryData<Me | null>(keys.me)?.id === me.data?.id}
              active={imported}
              onApply={(input) => {
                setImported(input);
                setImportedSelection([]);
              }}
              onExit={() => {
                setImported(null);
                setImportedSelection([]);
              }}
            />
          ) : null}
          {!imported ? (
            <StoryRehearsalPanel
              artifact={artifact}
              settings={activeSettings}
              onChange={setSettings}
            />
          ) : null}
          {current?.sources.length ? (
            <fieldset className="space-y-2 text-sm">
              <legend className="font-semibold">Reference documents</legend>
              <p className="text-xs text-text-2">
                Browse descriptions locally. Only included documents are downloaded.
              </p>
              {current.sources.map((source) => {
                const key = catalogKey(source.ref);
                const checked =
                  source.required || selection?.some((ref) => catalogKey(ref) === key) || false;
                return (
                  <label key={key} className="flex gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={source.required}
                      onChange={(event) =>
                        selectContent(
                          event.target.checked
                            ? [
                                ...(selection ?? []).filter(
                                  (ref) =>
                                    !("source" in ref) ||
                                    ref.source !== source.ref.source ||
                                    !!(
                                      ref.section &&
                                      source.ref.section &&
                                      ref.section !== source.ref.section
                                    ),
                                ),
                                source.ref,
                              ]
                            : (selection ?? []).filter((ref) => catalogKey(ref) !== key),
                        )
                      }
                    />
                    <span>
                      {source.title}
                      {source.required ? " (included by the story)" : ""}
                      {source.description ? (
                        <span className="block text-xs text-text-2">{source.description}</span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </fieldset>
          ) : null}
          {selection?.length ? (
            <button type="button" className="text-xs underline" onClick={() => selectContent([])}>
              Clear selected content
            </button>
          ) : null}
          {current?.directoryError ? (
            <p role="status" className="text-xs text-text-2">
              Reference directory unavailable: {current.directoryError}
            </p>
          ) : null}
          {current?.fragments?.length ? (
            <fieldset className="space-y-2 rounded border p-3 text-sm">
              <legend className="font-semibold">Optional entries</legend>
              <p className="text-xs text-text-2">
                Read descriptions first, then choose entries for this preview. This simulates
                selection and does not change the work.
              </p>
              {current.fragments.map((item) => {
                const key = catalogKey(item.ref);
                return (
                  <label key={key} className="flex gap-2">
                    <input
                      type="checkbox"
                      checked={selection?.some((r) => catalogKey(r) === key) ?? false}
                      onChange={(event) =>
                        selectContent(
                          event.target.checked
                            ? [...(selection ?? []).filter((r) => catalogKey(r) !== key), item.ref]
                            : (selection ?? []).filter((r) => catalogKey(r) !== key),
                        )
                      }
                    />
                    <span>
                      {item.title}
                      {item.description ? (
                        <span className="block text-xs text-text-2">{item.description}</span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </fieldset>
          ) : null}
          {authorDiagnostics && current?.input ? <PreviewCatalog input={current.input} /> : null}
          {authorDiagnostics && current?.input?.profile.mode === "per-agent" ? (
            <AuthorVisibilityChecks
              artifact={artifact}
              bindings={current.input.turn.bindings}
              onLocateSource={onLocateSource}
              onShareSource={onShareSource}
              disabledReason={sourceSharingDisabledReason ?? locateDisabledReason}
            />
          ) : null}
          {current?.input ? <PreviewRelatedLinks input={current.input} /> : null}
          {!outcome ? (
            <p role="status">Preparing context and selected reference documents…</p>
          ) : outcome.ok ? (
            <>
              {onSaveTest ? (
                <section
                  className="space-y-2 rounded border p-3"
                  aria-label="Save preview as a test"
                >
                  <p className="text-xs text-text-2">
                    Save these synthetic messages, bindings, state, choices and complete loaded
                    reference documents with this work, including unselected sections. They may be
                    published. The current messages become the expected result; running the test
                    later will not update it.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={savingTest || !!testDisabledReason || !current?.fixtureInput}
                    onClick={async () => {
                      if (!current?.fixtureInput || !outcome.ok || savingTest || testDisabledReason)
                        return;
                      const actor = me.data?.id;
                      if (queryClient.getQueryData<Me | null>(keys.me)?.id !== actor) return;
                      setSavingTest(true);
                      setTestError("");
                      setTestNotice("");
                      try {
                        const message = await onSaveTest(current.fixtureInput, outcome.result);
                        if (
                          saveMounted.current &&
                          latestJob.current === job &&
                          queryClient.getQueryData<Me | null>(keys.me)?.id === actor
                        )
                          setTestNotice(message);
                      } catch (error) {
                        if (
                          saveMounted.current &&
                          latestJob.current === job &&
                          queryClient.getQueryData<Me | null>(keys.me)?.id === actor
                        )
                          setTestError(
                            error instanceof Error ? error.message : "Could not save this test.",
                          );
                      } finally {
                        if (saveMounted.current) setSavingTest(false);
                      }
                    }}
                  >
                    {savingTest ? "Saving author test…" : "Save preview as author test"}
                  </Button>
                  {testDisabledReason ? <p className="text-xs">{testDisabledReason}</p> : null}
                  {testNotice ? <p role="status">{testNotice}</p> : null}
                  {testError ? <p role="alert">{testError}</p> : null}
                </section>
              ) : null}
              <PreviewOpening
                opening={current?.opening ?? null}
                supplied={!!settings.turn || !!imported}
                onLocate={onLocateSource}
                disabledReason={locateDisabledReason}
              />
              {onLocateSource &&
              current?.input?.turn.scene &&
              artifact.story?.scenes.some((scene) => scene.id === current.input?.turn.scene) ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!!locateDisabledReason}
                  onClick={() =>
                    onLocateSource(`story.scenes[${current.input?.turn.scene}].opening`)
                  }
                >
                  Edit scene context source
                </Button>
              ) : null}
              <TraceSummary trace={outcome.result.trace} ir={ir} />
              {outcome.result.trace.preset ? (
                <p className="rounded border p-3 text-xs font-mono break-all">
                  Policy: {outcome.result.trace.preset.ref} ·{" "}
                  {buildIdentityKey(outcome.result.trace.preset)} ·{" "}
                  {outcome.result.trace.preset.semantic_digest}
                </p>
              ) : null}
              <section className="space-y-2">
                <h3 className="font-semibold">Prepared model messages, in order</h3>
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
                        <ul
                          aria-label="Prepared image attachments"
                          className="mt-2 space-y-2 text-xs"
                        >
                          {message.attachments.map((attachment, attachmentIndex) => (
                            <li key={attachmentIndex} className="rounded border p-2">
                              <p>{attachment.alt || "Image without alternative text"}</p>
                              <p>
                                {attachment.media_type} · {attachment.asset}
                              </p>
                              <details>
                                <summary>Attachment identity</summary>
                                <code className="break-all">{attachment.digest}</code>
                              </details>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </section>
              <TraceTable trace={outcome.result.trace} ir={ir} />
            </>
          ) : (
            <>
              <PreviewProblem title={outcome.title} detail={outcome.detail} code={outcome.code} />
              <button
                type="button"
                className="text-sm underline"
                onClick={() => setRetry((value) => value + 1)}
              >
                Retry preview
              </button>
            </>
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
