/**
 * 元信息：评级、内容警告、权利与许可、标签，以及默认语言。评级只能如实填写：依赖或图片的
 * 评级更高时，作品页显示的 effective rating 会自动取最高值。
 *
 * 谁可以提交修改（贡献开放度）只在作品设置里改，这里不再提供入口，避免两处的值对不上。
 * 草稿里已有的 `contribution_policy` 原样保留，编辑器不读也不改它。
 */
import type { CheckDiagnostic, CreationMeta, Rating } from "@char-pub/core";
import { type ReactNode, useId } from "react";
import { RATING_LABEL } from "@/components/rating";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { getMeta, setMeta, type Working } from "@/lib/draft";
import { DiagnosticList, diagnosticsFor } from "./diagnostics";
import { ListInput } from "./list-input";
import {
  LICENSE_HELP,
  LICENSE_PRESETS,
  licenseShort,
  RATING_OPTIONS,
  RIGHTS_OPTIONS,
} from "./options";

/** 折叠时的一行摘要，例如 “Teen · CC-BY-4.0 · 4 tags”。 */
export function metaSummary(w: Working): string {
  const meta = getMeta(w);
  const tags = meta.tags?.length ?? 0;
  const parts = [RATING_LABEL[meta.rating], licenseShort(meta.license)];
  if (tags > 0) parts.push(`${tags} ${tags === 1 ? "tag" : "tags"}`);
  return parts.join(" · ");
}

/** 语言代码的英文名字，例如 `en` → English；认不出时原样返回。 */
export function languageName(locale: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(locale) ?? locale;
  } catch {
    return locale;
  }
}

export function languageSummary(w: Working): string {
  const locale = getMeta(w).default_locale;
  return `${languageName(locale)} (${locale})`;
}

function Field({
  id,
  label,
  help,
  children,
}: {
  id: string;
  label: string;
  help?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {help ? <p className="text-xs text-text-3">{help}</p> : null}
    </div>
  );
}

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
    tags: useId(),
  };
  const set = (patch: Partial<CreationMeta>) => update((w) => setMeta(w, patch));
  const preset = LICENSE_PRESETS.some((l) => l.id === meta.license) ? meta.license : "custom";

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="space-y-1">
        <Field
          id={ids.rating}
          label="Rating"
          help="Be honest: a dependency with a higher rating raises it anyway."
        >
          <NativeSelect
            id={ids.rating}
            value={meta.rating}
            onChange={(e) => set({ rating: e.target.value as Rating })}
          >
            {RATING_OPTIONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label} — {r.hint}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <DiagnosticList items={diagnosticsFor(diagnostics, "meta.rating")} />
      </div>
      <Field id={ids.warnings} label="Content warnings" help="Comma separated.">
        <ListInput
          id={ids.warnings}
          value={meta.content_warnings ?? []}
          placeholder="e.g. violence, grief"
          onChange={(next) => set({ content_warnings: next })}
        />
      </Field>
      <Field
        id={ids.rights}
        label="Rights"
        help={RIGHTS_OPTIONS.find((r) => r.id === meta.rights)?.note}
      >
        <NativeSelect
          id={ids.rights}
          value={meta.rights}
          onChange={(e) => set({ rights: e.target.value as CreationMeta["rights"] })}
        >
          {RIGHTS_OPTIONS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label} — {r.hint}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <div className="space-y-1">
        <Field id={ids.license} label="License" help={LICENSE_HELP}>
          <NativeSelect
            id={ids.license}
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
          </NativeSelect>
          {preset === "custom" ? (
            <Input
              id={ids.custom}
              aria-label="SPDX license expression"
              className="font-mono"
              value={meta.license}
              onChange={(e) => set({ license: e.target.value })}
            />
          ) : null}
        </Field>
        <DiagnosticList items={diagnosticsFor(diagnostics, "meta.license", "meta.rights")} />
      </div>
      <div className="sm:col-span-2">
        <Field id={ids.tags} label="Tags" help="Comma separated. Used by Explore and search.">
          <ListInput
            id={ids.tags}
            value={meta.tags ?? []}
            placeholder="e.g. cyberpunk, courier"
            onChange={(next) => set({ tags: next })}
          />
        </Field>
      </div>
    </div>
  );
}

export function LanguageEditor({
  working,
  update,
  diagnostics,
}: {
  working: Working;
  update: (fn: (w: Working) => Working) => void;
  diagnostics: readonly CheckDiagnostic[];
}) {
  const id = useId();
  const locale = getMeta(working).default_locale;
  return (
    <div className="max-w-sm space-y-1">
      <Field
        id={id}
        label="Language"
        help={`A language code such as en, ja or pt-BR. Now: ${languageName(locale)}.`}
      >
        <Input
          id={id}
          className="font-mono"
          value={locale}
          maxLength={35}
          onChange={(e) => update((w) => setMeta(w, { default_locale: e.target.value }))}
        />
      </Field>
      <DiagnosticList items={diagnosticsFor(diagnostics, "meta.default_locale")} />
    </div>
  );
}
