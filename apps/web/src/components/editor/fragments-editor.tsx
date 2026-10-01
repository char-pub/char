/**
 * Passages（fragment）编辑：每一段是进入模型上下文的文本，带类型、激活方式和是否稳定。
 * 关键词激活的段落只在最近的对话提到关键词时才加入上下文（世界书条目就是这样）。
 * 对话、媒体、结构化数据与翻译由独立正文编辑器维护，未应用JSON保留在当前卡片。
 *
 * 第一层的默认文本在 The basics 里编辑；其他正文类型和翻译在这里编辑，主条目不能改ID或删除。
 */
import {
  type Activation,
  type CheckDiagnostic,
  type CreationType,
  FRAGMENT_KINDS,
  type Fragment,
  type FragmentKind,
} from "@char-pub/core";
import { Plus, Trash2 } from "lucide-react";
import { useCallback, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

import { contentReferences, contentRestoreError } from "@/lib/content-references";
import { getFragments, newFragment, nextId, setFragments, type Working } from "@/lib/draft";
import { fragmentAnchor, mainFragmentId } from "./anchors";
import { DiagnosticList, diagnosticsFor } from "./diagnostics";
import { type AboutNavigate, FragmentAbout } from "./fragment-about";
import { FragmentContentEditor } from "./fragment-content-editor";
import { FragmentMetadata } from "./fragment-metadata";
import { ListInput } from "./list-input";

const DEFAULT_KIND: Record<string, FragmentKind> = {
  persona: "persona",
  style: "style",
  relationship: "relationship",
  scenario: "scenario",
  character: "character",
  world: "world",
  lorebook: "knowledge",
};

function activationMode(f: Fragment): Activation["mode"] {
  return f.activation?.mode ?? "always";
}

/** 折叠时的一行摘要，例如 “5 passages · 2 activate on keywords”。 */
export function passagesSummary(w: Working, type: CreationType): string {
  const main = mainFragmentId(w, type);
  const list = getFragments(w).filter((f) => f.id !== main);
  if (list.length === 0) return "No extra passages yet";
  const keyword = list.filter((f) => activationMode(f) === "keyword").length;
  const parts = [`${list.length} ${list.length === 1 ? "passage" : "passages"}`];
  if (keyword > 0) parts.push(`${keyword} ${keyword === 1 ? "activates" : "activate"} on keywords`);
  return parts.join(" · ");
}

function FragmentRow({
  fragment,
  working,
  onNavigate,
  index,
  main,
  references,
  onChange,
  onRemove,
  diagnostics,
  hidden,
  onPendingChange,
}: {
  fragment: Fragment;
  hidden?: boolean;
  onPendingChange?: ((key: string, pending: boolean) => void) | undefined;
  working: Working;
  onNavigate?: AboutNavigate | undefined;
  index: number;
  /** 第一层的正文：文字在 The basics 里编辑，这里只调整类型、激活方式和是否稳定。 */
  main: boolean;
  references: string[];
  onChange: (next: Fragment) => void;
  onRemove: () => void;
  diagnostics: readonly CheckDiagnostic[];
}) {
  const [pending, setPending] = useState(false);
  const pendingChange = useCallback(
    (key: string, value: boolean) => {
      setPending(value);
      onPendingChange?.(key, value);
    },
    [onPendingChange],
  );
  const ids = {
    id: useId(),
    kind: useId(),
    mode: useId(),
    keys: useId(),
    stable: useId(),
  };
  const mode = activationMode(fragment);
  const keys = fragment.activation?.mode === "keyword" ? fragment.activation.keys : [];
  const setActivation = (m: Activation["mode"]) => {
    const { activation: _, ...rest } = fragment;
    if (m === "always") onChange(rest);
    else if (m === "keyword") onChange({ ...rest, activation: { mode: "keyword", keys } });
    else if (m === "manual") onChange({ ...rest, activation: { mode: "manual" } });
    else onChange({ ...rest, activation: { mode: "semantic" } });
  };

  return (
    <li
      id={fragmentAnchor(fragment.id)}
      hidden={hidden}
      className="space-y-3 rounded-lg border bg-surface p-4"
      aria-label={`Passage ${index + 1}`}
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
        <div className="space-y-1">
          <label htmlFor={ids.id} className="text-xs font-medium">
            ID
          </label>
          <Input
            id={ids.id}
            className="font-mono"
            value={fragment.id}
            maxLength={255}
            readOnly={main || pending || references.length > 0}
            onChange={(e) => onChange({ ...fragment, id: e.target.value.toLowerCase() })}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={ids.kind} className="text-xs font-medium">
            Kind
          </label>
          <NativeSelect
            id={ids.kind}
            value={fragment.kind}
            onChange={(e) => onChange({ ...fragment, kind: e.target.value as FragmentKind })}
          >
            {FRAGMENT_KINDS.map((k) => (
              <option
                key={k}
                value={k}
                disabled={!!fragment.outward && !["character", "persona", "examples"].includes(k)}
              >
                {k}
              </option>
            ))}
          </NativeSelect>
        </div>
        {main ? (
          <span className="pb-2 text-xs text-text-3">From The basics</span>
        ) : (
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onRemove}>
            <Trash2 aria-hidden /> Remove
          </Button>
        )}
      </div>

      {references.length ? (
        <p className="text-xs text-text-2">
          Referenced by {references.join("; ")}. Remove these links before changing the ID or
          removing this passage.
        </p>
      ) : null}
      <FragmentContentEditor
        working={working}
        fragment={fragment}
        onChange={onChange}
        textInBasics={main}
        onPendingChange={pendingChange}
      />

      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <div className="space-y-1">
          <label htmlFor={ids.mode} className="text-xs font-medium">
            Included
          </label>
          <NativeSelect
            id={ids.mode}
            value={mode}
            onChange={(e) => setActivation(e.target.value as Activation["mode"])}
          >
            <option value="always" disabled={!!fragment.selectable}>
              always
            </option>
            <option value="keyword">on keywords</option>
            <option value="manual" disabled={!!fragment.selectable}>
              when enabled by hand
            </option>
            <option value="semantic" disabled={!!fragment.selectable}>
              by relevance
            </option>
          </NativeSelect>
        </div>
        {mode === "keyword" ? (
          <div className="space-y-1">
            <label htmlFor={ids.keys} className="text-xs font-medium">
              Keywords (comma separated)
            </label>
            <ListInput
              id={ids.keys}
              value={keys}
              placeholder="e.g. harbor, docks"
              aria-invalid={keys.length === 0}
              onChange={(next) =>
                onChange({
                  ...fragment,
                  activation: {
                    ...(fragment.activation?.mode === "keyword" ? fragment.activation : {}),
                    mode: "keyword",
                    keys: next,
                  },
                })
              }
            />
            {keys.length === 0 ? (
              <p className="text-xs text-danger">Add at least one keyword.</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id={ids.stable}
          checked={fragment.stable}
          onCheckedChange={(v) => onChange({ ...fragment, stable: v === true })}
        />
        <label htmlFor={ids.stable} className="text-xs">
          Stable — other creations may build on (override) this passage
        </label>
      </div>
      {fragment.selectable ? (
        <p className="text-xs">Turn off AI selection before changing to another inclusion mode.</p>
      ) : null}
      {fragment.outward ? (
        <p className="text-xs">
          Turn off outward visibility before changing to a non-personal kind.
        </p>
      ) : null}
      <FragmentMetadata working={working} fragment={fragment} onChange={onChange} />
      <FragmentAbout
        working={working}
        fragment={fragment}
        onChange={onChange}
        {...(onNavigate ? { onNavigate } : {})}
      />
      <DiagnosticList items={diagnostics} />
    </li>
  );
}

export function FragmentsEditor({
  type,
  working,
  update,
  diagnostics,
  visibleIds,
  onNavigate,
  onPendingChange,
}: {
  type: CreationType;
  working: Working;
  update: (fn: (w: Working) => Working) => void;
  diagnostics: readonly CheckDiagnostic[];
  visibleIds?: readonly string[];
  onNavigate?: AboutNavigate;
  onPendingChange?: ((key: string, pending: boolean) => void) | undefined;
}) {
  const [removed, setRemoved] = useState<{
    fragment: Fragment;
    index: number;
    baseline: Working;
  } | null>(null);
  const [error, setError] = useState("");
  const fragments = getFragments(working);
  const main = mainFragmentId(working, type);
  const kind = DEFAULT_KIND[type] ?? "knowledge";
  const replace = (i: number, next: Fragment | null) =>
    update((w) => {
      const list = [...getFragments(w)];
      const baseline = fragments[i];
      const actual = baseline ? list.findIndex((f) => f.id === baseline.id) : -1;
      if (actual < 0 || !baseline) return w;
      if (!next && contentReferences(w, "fragment", baseline.id).length) return w;
      if (next && next.id !== baseline.id && contentReferences(w, "fragment", baseline.id).length)
        return w;
      if (next) {
        const current = list[actual];
        if (!current) return w;
        const patched = { ...current };
        for (const key of new Set([...Object.keys(baseline), ...Object.keys(next)])) {
          const field = key as keyof Fragment;
          if (JSON.stringify(baseline[field]) === JSON.stringify(next[field])) continue;
          if (Object.hasOwn(next, field)) Object.assign(patched, { [field]: next[field] });
          else delete patched[field];
        }
        list[actual] = patched;
      } else list.splice(actual, 1);
      return setFragments(w, list);
    });

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-2">
        Passages are the pieces of text that reach the model besides the one in The basics: a
        personality, a scene, a lore entry. Keyword passages only join the context when the chat
        mentions them.
      </p>
      <ul className="space-y-3">
        {fragments.map((f, i) => (
          <FragmentRow
            // 未应用的编辑禁止改ID；其他条目移除不应卸载本条编辑缓冲。
            key={f.id}
            hidden={!!visibleIds && !visibleIds.includes(f.id)}
            index={i}
            fragment={f}
            working={working}
            onNavigate={onNavigate}
            onPendingChange={onPendingChange}
            main={f.id === main}
            references={contentReferences(working, "fragment", f.id)}
            onChange={(next) => replace(i, next)}
            onRemove={() => {
              const refs = contentReferences(working, "fragment", f.id);
              if (refs.length) {
                setError(`Remove references first: ${refs.join("; ")}`);
                return;
              }
              setRemoved({ fragment: f, index: i, baseline: structuredClone(working) });
              setError("");
              replace(i, null);
            }}
            diagnostics={diagnosticsFor(diagnostics, `fragments[${f.id}]`)}
          />
        ))}
      </ul>
      {error ? <p role="alert">{error}</p> : null}
      {removed ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (getFragments(working).some((f) => f.id === removed.fragment.id)) {
              setError("This passage ID is already in use. Undo cannot overwrite it.");
              return;
            }
            const restore = (w: Working) => {
              const list = [...getFragments(w)];
              list.splice(Math.min(removed.index, list.length), 0, removed.fragment);
              return setFragments(w, list);
            };
            const problem = contentRestoreError(working, restore(working), removed.baseline);
            if (problem) {
              setError(problem);
              return;
            }
            if (
              JSON.stringify(working.references) !== JSON.stringify(removed.baseline.references) &&
              (removed.fragment.about?.some((r) => !r.startsWith("#")) ||
                (removed.fragment.source?.use && !removed.fragment.source.use.startsWith("#")))
            ) {
              setError(
                "Dependencies changed. Restore their previous versions before undoing this passage.",
              );
              return;
            }
            update(restore);
            setRemoved(null);
            setError("");
          }}
        >
          Undo passage removal
        </Button>
      ) : null}
      {visibleIds ? (
        <p className="text-xs text-text-2">
          New passages appear under Ungrouped. Add them to any group when ready.
        </p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          update((w) => {
            const list = getFragments(w);
            const prefix =
              kind === "knowledge" ? "lore/entry" : kind === "character" ? "description" : kind;
            const id = nextId(
              list.map((f) => f.id),
              prefix,
            );
            return setFragments(w, [...list, newFragment(id, kind)]);
          })
        }
      >
        <Plus aria-hidden /> Add passage
      </Button>
    </div>
  );
}
