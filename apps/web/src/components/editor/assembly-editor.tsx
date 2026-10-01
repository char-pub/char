import { ASSEMBLER, TOKENIZER_VERSIONS } from "@char-pub/assembler";
import {
  type AssemblyConfig,
  type AssemblyFixture,
  publishedIdentity,
  type RuntimeProfile,
  SessionSchema,
} from "@char-pub/core";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ArtifactPicker } from "@/components/artifact-picker";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { Me } from "@/lib/api";
import { nextId, type Working } from "@/lib/draft";
import { authorTestResults, buildSavedDraft } from "@/lib/draft-build";
import { parseHistory } from "@/lib/preview";
import { keys, useMe, useRegistry } from "@/lib/registry";
import type { SavedDraftSnapshot } from "@/lib/use-draft-editor";
import { Field } from "./policy-editor";

export const DEFAULT_PROFILE: RuntimeProfile = {
  runtime: { name: "char.pub", version: "0.0.0" },
  tokenizer: "estimate",
  context_window: 8192,
  reserve_for_output: 1024,
  mode: "narrator",
  capabilities: { system_role: true, multiple_system_messages: true, images: false },
};
export function ProfileFields({
  profile,
  onChange,
}: {
  profile: RuntimeProfile;
  onChange: (p: RuntimeProfile) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field
        label="Context window"
        type="number"
        value={profile.context_window}
        onChange={(v) => onChange({ ...profile, context_window: Number(v) })}
      />
      <Field
        label="Output token reserve"
        type="number"
        value={profile.reserve_for_output}
        onChange={(v) => onChange({ ...profile, reserve_for_output: Number(v) })}
      />
      <Label className="text-sm">
        Perspective
        <NativeSelect
          value={profile.mode}
          onChange={(e) => onChange({ ...profile, mode: e.target.value as RuntimeProfile["mode"] })}
        >
          <option value="narrator">Narrator</option>
          <option value="per-agent">Per agent</option>
        </NativeSelect>
      </Label>
      <Label className="text-sm">
        Tokenizer
        <NativeSelect
          value={profile.tokenizer}
          onChange={(e) => onChange({ ...profile, tokenizer: e.target.value })}
        >
          {Object.keys(TOKENIZER_VERSIONS).map((key) => (
            <option key={key}>{key}</option>
          ))}
        </NativeSelect>
      </Label>
      <Label className="flex gap-2 text-sm">
        <input
          type="checkbox"
          checked={profile.capabilities.system_role === true}
          onChange={(e) =>
            onChange({
              ...profile,
              capabilities: { ...profile.capabilities, system_role: e.target.checked },
            })
          }
        />
        System messages
      </Label>
      <Label className="flex gap-2 text-sm">
        <input
          type="checkbox"
          checked={profile.capabilities.multiple_system_messages === true}
          onChange={(e) =>
            onChange({
              ...profile,
              capabilities: { ...profile.capabilities, multiple_system_messages: e.target.checked },
            })
          }
        />
        Multiple system messages
      </Label>
    </div>
  );
}
const tokenizerIdentity = (name: string) => ({
  name,
  version: TOKENIZER_VERSIONS[name as keyof typeof TOKENIZER_VERSIONS] ?? "unsupported",
});

export function AssemblyEditor({
  working,
  update,
}: {
  working: Working;
  update: (fn: (w: Working) => Working) => void;
}) {
  const assembly = working.assembly as AssemblyConfig | undefined;
  return (
    <section id="edit-assembly" className="space-y-4 rounded-xl border bg-surface p-5">
      <h2 className="text-xl font-bold">Reproducible assembly</h2>
      <p className="text-sm text-text-2">
        Lock a preset and execution settings. Real conversation history and private session state
        are never stored here.
      </p>
      {assembly ? (
        <>
          <p className="font-mono text-xs break-all">
            {assembly.preset.ref} · {assembly.preset.release}
          </p>
          <ProfileFields
            profile={assembly.profile}
            onChange={(profile) =>
              update((w) => ({
                ...w,
                assembly: { ...assembly, profile, tokenizer: tokenizerIdentity(profile.tokenizer) },
              }))
            }
          />
          <p className="text-xs">
            Assembler {assembly.assembler.name} {assembly.assembler.version} · tokenizer{" "}
            {assembly.tokenizer.version}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              update((w) => {
                const { assembly: _, ...rest } = w;
                return rest;
              })
            }
          >
            Remove locked assembly
          </Button>
        </>
      ) : (
        <p className="text-sm">No locked assembly. Recommended presets remain suggestions.</p>
      )}
      <ArtifactPicker
        label={assembly ? "Replace the locked preset" : "Lock a preset"}
        types={["preset"]}
        onPick={({ artifact }) =>
          update((w) => ({
            ...w,
            assembly: {
              version: "1-draft",
              preset: artifact.root,
              profile: assembly?.profile ?? DEFAULT_PROFILE,
              assembler: ASSEMBLER,
              tokenizer: tokenizerIdentity(assembly?.profile.tokenizer ?? "estimate"),
            },
          }))
        }
      />
    </section>
  );
}

export function AuthorTestsEditor({
  working,
  update,
  ns,
  name,
  save,
}: {
  working: Working;
  update: (fn: (w: Working) => Working) => void;
  ns?: string;
  name?: string;
  save?: () => Promise<SavedDraftSnapshot | null>;
}) {
  const client = useRegistry();
  const actor = useMe().data?.id;
  const queryClient = useQueryClient();
  const current = useRef(working);
  current.current = working;
  const request = useRef(0);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    request.current += 1;
    abort.current?.abort();
    setResults(null);
    setBusy(false);
    setError(null);
    return () => {
      abort.current?.abort();
    };
  }, [working]);
  const fixtures = (working.assembly_tests as AssemblyFixture[] | undefined) ?? [];
  const lockedPreset = (working.assembly as AssemblyConfig | undefined)?.preset;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<
    { id: string; ok: boolean; issues: string[]; messages_digest?: string | undefined }[] | null
  >(null);
  const set = (next: AssemblyFixture[]) => {
    setResults(null);
    update((w) => {
      if (next.length) return { ...w, assembly_tests: next };
      const { assembly_tests: _, ...rest } = w;
      return rest;
    });
  };
  const change = (index: number, patch: Partial<AssemblyFixture>) =>
    set(fixtures.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  const run = async () => {
    if (!ns || !name || !save) return;
    const snapshot = working;
    const sequence = ++request.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const valid = () =>
      current.current === snapshot &&
      request.current === sequence &&
      !controller.signal.aborted &&
      queryClient.getQueryData<Me | null>(keys.me)?.id === actor;
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const { receipt } = await buildSavedDraft({
        client,
        ns,
        name,
        save,
        signal: controller.signal,
        isCurrent: valid,
      });
      if (valid()) setResults(authorTestResults(receipt));
    } catch (e) {
      if (valid()) setError(e instanceof Error ? e.message : "Could not execute the tests");
    } finally {
      if (valid()) setBusy(false);
    }
  };
  return (
    <section id="edit-tests" className="space-y-4 rounded-xl border bg-surface p-5">
      <h2 className="text-xl font-bold">Author assembly tests</h2>
      <p className="text-sm text-text-2">
        Write synthetic examples that may be published with this creation. Tests run against a saved
        private build and never call a model. Do not paste private conversations.
      </p>
      {fixtures.map((fixture, i) => (
        <fieldset key={i} className="space-y-3 rounded-lg border p-4">
          <legend className="px-1 font-medium">{fixture.id}</legend>
          <Field label="Test ID" value={fixture.id} onChange={(id) => change(i, { id })} />
          <p className="font-mono text-xs">
            Content:{" "}
            {typeof fixture.root === "string"
              ? fixture.root
              : `${fixture.root.ref} · ${fixture.root.release}`}
          </p>
          {working.type === "scenario" ? (
            <Button type="button" variant="outline" onClick={() => change(i, { root: "self" })}>
              Use this scenario
            </Button>
          ) : null}
          <ArtifactPicker
            label="Test content"
            types={["character", "scenario"]}
            onPick={({ artifact }) =>
              change(i, {
                root: artifact.root,
                ...(!fixture.preset && artifact.kind === "content" && artifact.assembly
                  ? {
                      preset: {
                        ref: artifact.assembly.preset.ref,
                        ...publishedIdentity(artifact.assembly.preset),
                        semantic_digest: artifact.assembly.preset.semantic_digest,
                      },
                    }
                  : {}),
              })
            }
          />
          <p className="font-mono text-xs">
            Preset:{" "}
            {fixture.preset === "self"
              ? "this preset"
              : (fixture.preset?.ref ?? "locked default preset")}
          </p>
          <div className="flex gap-2">
            {working.type === "preset" ? (
              <Button type="button" variant="outline" onClick={() => change(i, { preset: "self" })}>
                Use this preset
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              disabled={fixture.root === "self" && !!lockedPreset}
              title={
                fixture.root === "self" && lockedPreset
                  ? "This work locks a preset. Choose an exact preset for its tests."
                  : undefined
              }
              onClick={() =>
                set(
                  fixtures.map((item, index) => {
                    if (index !== i) return item;
                    const { preset: _, ...rest } = item;
                    return rest;
                  }),
                )
              }
            >
              Use locked default preset
            </Button>
          </div>
          <ArtifactPicker
            label="Test preset"
            types={["preset"]}
            onPick={({ artifact }) => change(i, { preset: artifact.root })}
          />
          <ProfileFields
            profile={fixture.profile}
            onChange={(profile) =>
              change(i, { profile, tokenizer: tokenizerIdentity(profile.tokenizer) })
            }
          />
          <Field
            label="Synthetic conversation"
            multiline
            value={fixture.session.history.map((m) => `${m.role}: ${m.text}`).join("\n")}
            onChange={(history) =>
              change(i, { session: { ...fixture.session, history: parseHistory(history) } })
            }
          />
          <Field
            label="Synthetic persona name"
            value={
              fixture.session.bindings?.user?.display_name &&
              typeof fixture.session.bindings.user.display_name === "string"
                ? fixture.session.bindings.user.display_name
                : ""
            }
            onChange={(name) =>
              change(i, {
                session: {
                  ...fixture.session,
                  bindings: {
                    ...fixture.session.bindings,
                    user: { kind: "persona", display_name: name },
                  },
                },
              })
            }
          />
          <Label className="text-sm">
            Expected outcome
            <NativeSelect
              value={fixture.expected.kind}
              onChange={(e) =>
                change(i, {
                  expected:
                    e.target.value === "error"
                      ? { kind: "error", code: "assemble.pinned_over_budget" }
                      : { kind: "success", trace: [{ source: "history", included: true }] },
                })
              }
            >
              <option value="success">Successful assembly</option>
              <option value="error">A specific error</option>
            </NativeSelect>
          </Label>
          {fixture.expected.kind === "error" ? (
            <Field
              label="Expected error code"
              value={fixture.expected.code}
              onChange={(code) => change(i, { expected: { kind: "error", code } })}
            />
          ) : (
            <>
              <Field
                label="Expected message digest (optional)"
                value={fixture.expected.messages_digest ?? ""}
                onChange={(value) => {
                  if (fixture.expected.kind !== "success") return;
                  const { messages_digest: _, ...expected } = fixture.expected;
                  change(i, {
                    expected: { ...expected, ...(value ? { messages_digest: value } : {}) },
                  });
                }}
              />
              {(fixture.expected.trace ?? []).map((assertion, n) => (
                <div key={n} className="flex flex-wrap items-end gap-2">
                  <div className="flex-1">
                    <Field
                      label={`Trace source ${n + 1}`}
                      value={assertion.source}
                      onChange={(source) => {
                        if (fixture.expected.kind === "success")
                          change(i, {
                            expected: {
                              ...fixture.expected,
                              trace: fixture.expected.trace?.map((a, j) =>
                                j === n ? { ...a, source } : a,
                              ),
                            },
                          });
                      }}
                    />
                  </div>
                  <Label className="text-sm">
                    <input
                      type="checkbox"
                      checked={assertion.included !== false}
                      onChange={(e) => {
                        if (fixture.expected.kind === "success")
                          change(i, {
                            expected: {
                              ...fixture.expected,
                              trace: fixture.expected.trace?.map((a, j) =>
                                j === n ? { ...a, included: e.target.checked } : a,
                              ),
                            },
                          });
                      }}
                    />
                    Included
                  </Label>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      if (fixture.expected.kind === "success") {
                        const { trace: _, ...expected } = fixture.expected;
                        const trace = fixture.expected.trace?.filter((_, j) => j !== n);
                        change(i, {
                          expected: { ...expected, ...(trace?.length ? { trace } : {}) },
                        });
                      }
                    }}
                  >
                    Remove assertion
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (fixture.expected.kind === "success")
                    change(i, {
                      expected: {
                        ...fixture.expected,
                        trace: [
                          ...(fixture.expected.trace ?? []),
                          { source: "history", included: true },
                        ],
                      },
                    });
                }}
              >
                Add trace assertion
              </Button>
            </>
          )}
          <details>
            <summary className="cursor-pointer text-sm">Advanced synthetic Session JSON</summary>
            <SessionJson value={fixture.session} onChange={(session) => change(i, { session })} />
          </details>
          {fixture.selection?.length || Object.keys(fixture.source_texts ?? {}).length ? (
            <details className="space-y-2">
              <summary className="cursor-pointer text-sm">Saved choices and reference text</summary>
              <p className="text-xs text-text-2">
                These fixed choices and complete documents are saved with the test and may be
                published, including sections that were not selected. Save a new preview to capture
                different choices.
              </p>
              {fixture.selection?.length ? (
                <pre className="overflow-auto whitespace-pre-wrap text-xs">
                  {JSON.stringify(fixture.selection, null, 2)}
                </pre>
              ) : null}
              {Object.entries(fixture.source_texts ?? {}).map(([asset, body]) => (
                <details key={asset} className="rounded border p-2">
                  <summary className="break-all text-xs">{asset}</summary>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">{body}</pre>
                </details>
              ))}
            </details>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            onClick={() => set(fixtures.filter((_, n) => n !== i))}
          >
            Remove test
          </Button>
        </fieldset>
      ))}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            set([
              ...fixtures,
              {
                id: nextId(
                  fixtures.map((f) => f.id),
                  "example",
                ),
                root: "self",
                ...(working.type === "preset"
                  ? { preset: "self" as const }
                  : lockedPreset
                    ? { preset: lockedPreset }
                    : {}),
                profile: DEFAULT_PROFILE,
                session: {
                  history: [{ role: "user", text: "A synthetic example." }],
                  bindings: { user: { kind: "persona", display_name: "Reader" } },
                },
                assembler: ASSEMBLER,
                tokenizer: tokenizerIdentity("estimate"),
                expected: { kind: "success", trace: [{ source: "history", included: true }] },
              },
            ])
          }
        >
          Add author test
        </Button>
        <Button
          type="button"
          disabled={busy || !fixtures.length || !save}
          onClick={() => void run()}
        >
          {busy ? "Running…" : "Run author tests"}
        </Button>
      </div>
      {!save ? (
        <p className="text-sm text-text-2">
          Save these changes in a work you can edit to run its author tests.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {results ? (
        <ul aria-label="Author test results" className="space-y-2">
          {results.map((result) => (
            <li key={result.id} className="rounded border p-3">
              <strong>
                {result.ok ? "Passed" : "Failed"}: {result.id}
              </strong>
              {result.issues.map((issue, i) => (
                <p key={i} className="text-sm">
                  {issue}
                </p>
              ))}
              {result.messages_digest ? (
                <p className="mt-1 break-all font-mono text-xs">
                  Observed messages: {result.messages_digest}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
function SessionJson({
  value,
  onChange,
}: {
  value: AssemblyFixture["session"];
  onChange: (value: AssemblyFixture["session"]) => void;
}) {
  const [text, setText] = useState(JSON.stringify(value, null, 2));
  const [error, setError] = useState("");
  useEffect(() => {
    setText(JSON.stringify(value, null, 2));
    setError("");
  }, [value]);
  return (
    <div className="space-y-2">
      <Textarea
        aria-label="Synthetic session JSON"
        value={text}
        rows={8}
        onChange={(e) => setText(e.target.value)}
      />
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          try {
            const parsed = SessionSchema.safeParse(JSON.parse(text));
            if (!parsed.success) {
              setError(
                parsed.error.issues
                  .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                  .join("; "),
              );
              return;
            }
            onChange(parsed.data);
            setError("");
          } catch {
            setError("Enter valid JSON.");
          }
        }}
      >
        Apply session JSON
      </Button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
