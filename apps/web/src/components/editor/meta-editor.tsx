/**
 * 元信息：评级、内容警告、权利与许可、贡献策略、标签。评级只能如实填写：依赖或图片的
 * 评级更高时，作品页显示的 effective rating 会自动取最高值。
 */
import type { CheckDiagnostic, CreationMeta, Rating } from "@char-pub/core";
import { useId } from "react";
import { Input } from "@/components/ui/input";
import { getMeta, setMeta, type Working } from "@/lib/draft";
import { DiagnosticList, diagnosticsFor } from "./diagnostics";
import { ListInput } from "./list-input";

const selectClass =
  "h-9 w-full rounded-sm border border-input bg-card px-2 text-sm focus-visible:outline-2 focus-visible:outline-seal";

export const LICENSE_PRESETS = [
  { id: "LicenseRef-All-Rights-Reserved", label: "All rights reserved" },
  { id: "CC-BY-4.0", label: "CC BY 4.0 — reuse with credit" },
  { id: "CC-BY-SA-4.0", label: "CC BY-SA 4.0 — reuse with credit, share alike" },
  { id: "CC-BY-NC-4.0", label: "CC BY-NC 4.0 — non-commercial reuse with credit" },
  { id: "CC0-1.0", label: "CC0 — public domain" },
] as const;

const RATINGS: { id: Rating; label: string }[] = [
  { id: "general", label: "General — suitable for everyone" },
  { id: "teen", label: "Teen — mild violence or themes" },
  { id: "mature", label: "Mature — adults only" },
  { id: "explicit", label: "Explicit — sexual or graphic content" },
];

type Policy = NonNullable<CreationMeta["contribution_policy"]>;

export function MetaEditor({
  working,
  update,
  diagnostics,
}: {
  working: Working;
  update: (fn: (w: Working) => Working) => void;
  diagnostics: readonly CheckDiagnostic[];
}) {
  const meta = getMeta(working);
  const ids = {
    rating: useId(),
    warnings: useId(),
    rights: useId(),
    license: useId(),
    custom: useId(),
    policy: useId(),
    tags: useId(),
    locale: useId(),
  };
  const set = (patch: Partial<CreationMeta>) => update((w) => setMeta(w, patch));
  const preset = LICENSE_PRESETS.some((l) => l.id === meta.license) ? meta.license : "custom";

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1">
        <label htmlFor={ids.rating} className="text-sm">
          Rating
        </label>
        <select
          id={ids.rating}
          className={selectClass}
          value={meta.rating}
          onChange={(e) => set({ rating: e.target.value as Rating })}
        >
          {RATINGS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <DiagnosticList items={diagnosticsFor(diagnostics, "meta.rating")} />
      </div>
      <div className="space-y-1">
        <label htmlFor={ids.warnings} className="text-sm">
          Content warnings
        </label>
        <ListInput
          id={ids.warnings}
          value={meta.content_warnings ?? []}
          placeholder="e.g. violence, grief"
          onChange={(next) => set({ content_warnings: next })}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={ids.rights} className="text-sm">
          Rights
        </label>
        <select
          id={ids.rights}
          className={selectClass}
          value={meta.rights}
          onChange={(e) => set({ rights: e.target.value as CreationMeta["rights"] })}
        >
          <option value="original">Original — I created it</option>
          <option value="fan-work">Fan work — based on someone else's world</option>
          <option value="licensed">Licensed — I have permission</option>
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor={ids.license} className="text-sm">
          License
        </label>
        <select
          id={ids.license}
          className={selectClass}
          value={preset}
          onChange={(e) => {
            if (e.target.value !== "custom") set({ license: e.target.value });
          }}
        >
          {LICENSE_PRESETS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
          <option value="custom">Other SPDX expression…</option>
        </select>
        {preset === "custom" ? (
          <Input
            id={ids.custom}
            aria-label="SPDX license expression"
            className="font-mono"
            value={meta.license}
            onChange={(e) => set({ license: e.target.value })}
          />
        ) : null}
        <DiagnosticList items={diagnosticsFor(diagnostics, "meta.license", "meta.rights")} />
      </div>
      <div className="space-y-1">
        <label htmlFor={ids.policy} className="text-sm">
          Who can suggest changes
        </label>
        <select
          id={ids.policy}
          className={selectClass}
          value={meta.contribution_policy ?? "signed-in"}
          onChange={(e) => set({ contribution_policy: e.target.value as Policy })}
        >
          <option value="anyone">Anyone, including guests</option>
          <option value="signed-in">Anyone signed in</option>
          <option value="invited">Only people I invite</option>
          <option value="closed">Nobody</option>
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor={ids.tags} className="text-sm">
          Tags
        </label>
        <ListInput
          id={ids.tags}
          value={meta.tags ?? []}
          placeholder="e.g. cyberpunk, courier"
          onChange={(next) => set({ tags: next })}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={ids.locale} className="text-sm">
          Language
        </label>
        <Input
          id={ids.locale}
          className="font-mono"
          value={meta.default_locale}
          maxLength={35}
          onChange={(e) => set({ default_locale: e.target.value })}
        />
        <DiagnosticList items={diagnosticsFor(diagnostics, "meta.default_locale")} />
      </div>
    </div>
  );
}
