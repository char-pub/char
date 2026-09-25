/**
 * Context Preview 的 Session 面板：语言、Runtime 模式、上下文窗口、tokenizer、用户 Persona、
 * 对话历史、手动启用的片段。改动后预览立即重新组装。
 */
import type { TokenizerName } from "@char-pub/assembler";
import { type ContextIR, displayFragmentId, USER_LATE_SLOT } from "@char-pub/core";
import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { PreviewSettings } from "@/lib/preview";
import { localized } from "@/lib/text";

export const TOKENIZER_OPTIONS: { value: TokenizerName; label: string }[] = [
  { value: "estimate", label: "estimate (approximate, fast)" },
  { value: "o200k_base", label: "o200k_base (GPT-4o family)" },
  { value: "cl100k_base", label: "cl100k_base (GPT-4 family)" },
];

/** 常见的上下文窗口；当前值不在里面时也列出来。 */
const WINDOWS = [2048, 4096, 8192, 16_384, 32_768, 128_000, 200_000];

function languageName(code: string): string {
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(code);
    return name && name !== code ? `${name} (${code})` : code;
  } catch {
    return code;
  }
}

const MODES: { value: PreviewSettings["mode"]; label: string }[] = [
  { value: "narrator", label: "Narrator" },
  { value: "per-agent", label: "Per-agent" },
];

export function SessionControls({
  ir,
  settings,
  onChange,
  tokenizer,
  onTokenizer,
  tokenizerStatus,
  locked = false,
}: {
  ir: ContextIR;
  settings: PreviewSettings;
  onChange: (next: PreviewSettings) => void;
  tokenizer: TokenizerName;
  onTokenizer: (t: TokenizerName) => void;
  tokenizerStatus: "ready" | "loading" | "error";
  locked?: boolean;
}) {
  const ids = {
    locale: useId(),
    mode: useId(),
    window: useId(),
    tokenizer: useId(),
    tokenizerStatus: useId(),
    persona: useId(),
    personaDesc: useId(),
    history: useId(),
    historyHint: useId(),
  };
  const set = (patch: Partial<PreviewSettings>) => onChange({ ...settings, ...patch });
  const locales = [
    ...new Set([ir.meta.default_locale, ...ir.meta.available_locales, "ja", "en"]),
  ].sort();
  const windows = [...new Set([...WINDOWS, settings.contextWindow])].sort((a, b) => a - b);
  const manual = ir.fragments.filter(
    (f) => f.activation.mode === "manual" || f.activation.mode === "semantic",
  );

  return (
    <form className="space-y-5" onSubmit={(e) => e.preventDefault()} aria-label="Session settings">
      <fieldset disabled={locked} className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor={ids.locale}>Language</Label>
          <NativeSelect
            id={ids.locale}
            value={settings.locale}
            onChange={(e) => set({ locale: e.target.value })}
          >
            {locales.map((l) => (
              <option key={l} value={l}>
                {languageName(l)}
              </option>
            ))}
          </NativeSelect>
        </div>

        <fieldset className="space-y-1.5">
          <legend id={ids.mode} className="text-sm font-medium">
            Runtime mode
          </legend>
          <div className="grid grid-cols-2 gap-1 rounded-md bg-surface-2 p-1">
            {MODES.map((m) => (
              <Label
                key={m.value}
                className="cursor-pointer rounded-sm px-3 py-1.5 text-center text-sm font-medium text-text-2 transition-colors has-[:checked]:bg-surface has-[:checked]:text-text has-[:checked]:shadow-sm has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/40"
              >
                <input
                  type="radio"
                  name={ids.mode}
                  value={m.value}
                  className="sr-only"
                  checked={settings.mode === m.value}
                  onChange={() => set({ mode: m.value })}
                />
                {m.label}
              </Label>
            ))}
          </div>
          <p className="text-xs text-text-3">
            {settings.mode === "narrator"
              ? "One model voices everyone; private passages are only a hint."
              : "Each character gets its own context; private passages stay private."}
          </p>
        </fieldset>

        <div className="space-y-1.5">
          <Label htmlFor={ids.window}>Context window</Label>
          <NativeSelect
            id={ids.window}
            className="font-mono"
            value={String(settings.contextWindow)}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              if (Number.isFinite(n) && n > 0) set({ contextWindow: n });
            }}
          >
            {windows.map((w) => (
              <option key={w} value={w}>
                {w.toLocaleString("en-US")} tokens
              </option>
            ))}
          </NativeSelect>
          <p className="text-xs text-text-3">
            {settings.reserveForOutput.toLocaleString("en-US")} tokens are kept free for the reply.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={ids.tokenizer}>Tokenizer</Label>
          <NativeSelect
            id={ids.tokenizer}
            value={tokenizer}
            onChange={(e) => onTokenizer(e.target.value as TokenizerName)}
            aria-describedby={ids.tokenizerStatus}
          >
            {TOKENIZER_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </NativeSelect>
          <p id={ids.tokenizerStatus} className="text-xs text-text-3" aria-live="polite">
            {tokenizerStatus === "loading"
              ? "Loading the tokenizer… counts are estimates until it is ready."
              : tokenizerStatus === "error"
                ? "Could not load this tokenizer; showing estimates."
                : tokenizer === "estimate"
                  ? "Counts are estimates."
                  : "Exact counts for this encoding."}
          </p>
        </div>
      </fieldset>
      {settings.mode === "per-agent" ? (
        <Label className="block text-sm">
          Speaking participant
          <NativeSelect
            value={settings.forParticipant ?? ""}
            onChange={(e) => set({ forParticipant: e.target.value })}
          >
            <option value="">Choose a participant</option>
            {ir.participants
              .filter((p) => p.key !== "user")
              .map((p) => (
                <option key={p.key} value={p.key}>
                  {typeof p.display_name === "string" ? p.display_name : p.key}
                </option>
              ))}
          </NativeSelect>
        </Label>
      ) : null}
      {ir.late_slots
        .filter((s) => s.key !== USER_LATE_SLOT)
        .map((slot, index) => {
          const binding = settings.lateBindings?.[slot.key] ?? {
            name: "",
            description: "",
            kind: slot.accepts[0] ?? "persona",
          };
          const change = (patch: Partial<typeof binding>) =>
            set({
              lateBindings: { ...settings.lateBindings, [slot.key]: { ...binding, ...patch } },
            });
          return (
            <fieldset key={slot.key} className="space-y-2 rounded border p-3">
              <legend className="px-1 text-sm" title={slot.key}>
                Role{" "}
                {localized(
                  ir.participants.find((participant) => participant.late === slot.key)
                    ?.display_name,
                  settings.locale,
                ) ||
                  slot.hint ||
                  index + 1}
              </legend>
              <Label className="block text-xs">
                Kind
                <NativeSelect
                  value={binding.kind}
                  onChange={(e) => change({ kind: e.target.value })}
                >
                  {slot.accepts.map((kind) => (
                    <option key={kind}>{kind}</option>
                  ))}
                </NativeSelect>
              </Label>
              <Label className="block text-xs">
                Name
                <Input value={binding.name} onChange={(e) => change({ name: e.target.value })} />
              </Label>
              <Label className="block text-xs">
                Description
                <Textarea
                  rows={2}
                  value={binding.description}
                  onChange={(e) => change({ description: e.target.value })}
                />
              </Label>
            </fieldset>
          );
        })}
      <fieldset className="space-y-3 border-t pt-4">
        <legend className="float-left mb-3 w-full text-sm font-semibold">
          You, in this session
        </legend>
        <div className="clear-both space-y-1.5">
          <Label htmlFor={ids.persona}>Persona name</Label>
          <Input
            id={ids.persona}
            value={settings.persona.name}
            onChange={(e) => set({ persona: { ...settings.persona, name: e.target.value } })}
            placeholder="Required to fill in {{user}}"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={ids.personaDesc}>Persona description</Label>
          <Textarea
            id={ids.personaDesc}
            rows={2}
            value={settings.persona.description}
            onChange={(e) => set({ persona: { ...settings.persona, description: e.target.value } })}
          />
        </div>
      </fieldset>

      <div className="space-y-1.5 border-t pt-4">
        <Label htmlFor={ids.history}>Chat history</Label>
        <Textarea
          id={ids.history}
          rows={4}
          aria-describedby={ids.historyHint}
          value={settings.historyText}
          onChange={(e) => set({ historyText: e.target.value })}
        />
        <p id={ids.historyHint} className="text-xs text-text-3">
          One message per line, starting with <code className="font-mono">user:</code> or{" "}
          <code className="font-mono">assistant:</code>. Keywords here can switch passages on.
        </p>
      </div>

      {manual.length > 0 ? (
        <fieldset className="space-y-2 border-t pt-4">
          <legend className="float-left mb-2 w-full text-sm font-semibold">
            Enable passages by hand
          </legend>
          <div className="clear-both space-y-2">
            {manual.map((f) => {
              const checked = settings.manualEnabled.includes(f.id);
              const id = `manual-${f.id.replace(/[^A-Za-z0-9]/g, "-")}`;
              return (
                <div key={f.id} className="flex items-center gap-2">
                  <Checkbox
                    id={id}
                    checked={checked}
                    onCheckedChange={() =>
                      set({
                        manualEnabled: checked
                          ? settings.manualEnabled.filter((x) => x !== f.id)
                          : [...settings.manualEnabled, f.id],
                      })
                    }
                  />
                  <Label htmlFor={id} className="font-mono text-xs font-normal break-all">
                    {displayFragmentId(f.id)}
                  </Label>
                </div>
              );
            })}
          </div>
        </fieldset>
      ) : null}
    </form>
  );
}
