/**
 * Playground 的 Session 控制面板：语言、模式、预算、tokenizer、用户 Persona、对话历史、
 * 手动启用的 fragment。
 */
import type { TokenizerName } from "@char-pub/assembler";
import { type ContextIR, displayFragmentId } from "@char-pub/core";
import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { PreviewSettings } from "@/lib/preview";

export const TOKENIZER_OPTIONS: { value: TokenizerName; label: string }[] = [
  { value: "estimate", label: "Estimate (fast, approximate)" },
  { value: "o200k_base", label: "o200k_base (GPT-4o family)" },
  { value: "cl100k_base", label: "cl100k_base (GPT-4 family)" },
];

const selectClass =
  "h-9 w-full rounded-sm border border-input bg-card px-2 text-sm focus-visible:outline-2 focus-visible:outline-seal";

export function SessionControls({
  ir,
  settings,
  onChange,
  tokenizer,
  onTokenizer,
  tokenizerStatus,
}: {
  ir: ContextIR;
  settings: PreviewSettings;
  onChange: (next: PreviewSettings) => void;
  tokenizer: TokenizerName;
  onTokenizer: (t: TokenizerName) => void;
  tokenizerStatus: "ready" | "loading" | "error";
}) {
  const ids = {
    locale: useId(),
    mode: useId(),
    window: useId(),
    tokenizer: useId(),
    persona: useId(),
    personaDesc: useId(),
    history: useId(),
  };
  const set = (patch: Partial<PreviewSettings>) => onChange({ ...settings, ...patch });
  const locales = [
    ...new Set([ir.meta.default_locale, ...ir.meta.available_locales, "ja", "en"]),
  ].sort();
  const manual = ir.fragments.filter(
    (f) => f.activation.mode === "manual" || f.activation.mode === "semantic",
  );

  return (
    <form className="space-y-5" onSubmit={(e) => e.preventDefault()} aria-label="Session settings">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={ids.locale}>Language</Label>
          <select
            id={ids.locale}
            className={selectClass}
            value={settings.locale}
            onChange={(e) => set({ locale: e.target.value })}
          >
            {locales.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={ids.mode}>Runtime mode</Label>
          <select
            id={ids.mode}
            className={selectClass}
            value={settings.mode}
            onChange={(e) => set({ mode: e.target.value as PreviewSettings["mode"] })}
          >
            <option value="narrator">narrator</option>
            <option value="per-agent">per-agent</option>
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={ids.window}>Context window (tokens)</Label>
        <Input
          id={ids.window}
          type="number"
          min={64}
          max={2_000_000}
          step={64}
          value={settings.contextWindow}
          onChange={(e) => {
            const n = Number.parseInt(e.target.value, 10);
            if (Number.isFinite(n) && n > 0) set({ contextWindow: n });
          }}
        />
        <p className="text-xs text-muted-foreground">
          {settings.reserveForOutput.toLocaleString("en-US")} tokens are kept free for the reply.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={ids.tokenizer}>Tokenizer</Label>
        <select
          id={ids.tokenizer}
          className={selectClass}
          value={tokenizer}
          onChange={(e) => onTokenizer(e.target.value as TokenizerName)}
          aria-describedby={`${ids.tokenizer}-status`}
        >
          {TOKENIZER_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <p
          id={`${ids.tokenizer}-status`}
          className="text-xs text-muted-foreground"
          aria-live="polite"
        >
          {tokenizerStatus === "loading"
            ? "Loading tokenizer… counts are estimates until it is ready."
            : tokenizerStatus === "error"
              ? "Could not load this tokenizer; showing estimates."
              : tokenizer === "estimate"
                ? "Counts are estimates."
                : "Exact counts for this encoding."}
        </p>
      </div>

      <fieldset className="space-y-3 border-t border-rule pt-4">
        <legend className="font-display text-base">You, in this session</legend>
        <div className="space-y-1.5">
          <Label htmlFor={ids.persona}>Persona name</Label>
          <Input
            id={ids.persona}
            value={settings.persona.name}
            onChange={(e) => set({ persona: { ...settings.persona, name: e.target.value } })}
            placeholder="Required to bind {{user}}"
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

      <div className="space-y-1.5 border-t border-rule pt-4">
        <Label htmlFor={ids.history}>Chat history</Label>
        <Textarea
          id={ids.history}
          rows={4}
          className="font-mono text-xs"
          value={settings.historyText}
          onChange={(e) => set({ historyText: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          One message per line, starting with <code>user:</code> or <code>assistant:</code>. Keyword
          lore is triggered by recent messages.
        </p>
      </div>

      {manual.length > 0 ? (
        <fieldset className="space-y-2 border-t border-rule pt-4">
          <legend className="font-display text-base">Enable by hand</legend>
          {manual.map((f) => {
            const checked = settings.manualEnabled.includes(f.id);
            return (
              <label key={f.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-[var(--seal)]"
                  checked={checked}
                  onChange={() =>
                    set({
                      manualEnabled: checked
                        ? settings.manualEnabled.filter((x) => x !== f.id)
                        : [...settings.manualEnabled, f.id],
                    })
                  }
                />
                <span className="font-mono text-xs">{displayFragmentId(f.id)}</span>
              </label>
            );
          })}
        </fieldset>
      ) : null}
    </form>
  );
}
