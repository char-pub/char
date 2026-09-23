/**
 * Fragment 编辑：每个 fragment 是一段进入模型上下文的文本，带类型、激活方式和是否稳定。
 * 关键词激活的 fragment 只在最近的对话提到关键词时才加入上下文（世界书条目就是这样）。
 * 非文本内容（对话示例、媒体、结构化数据）这里只读显示，保留原样。
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
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getFragments, newFragment, nextId, setFragments, type Working } from "@/lib/draft";
import { DiagnosticList, diagnosticsFor } from "./diagnostics";
import { ListInput } from "./list-input";

const selectClass =
  "h-9 rounded-sm border border-input bg-card px-2 text-sm focus-visible:outline-2 focus-visible:outline-seal";

const DEFAULT_KIND: Record<string, FragmentKind> = {
  character: "character",
  world: "world",
  lorebook: "knowledge",
};

function activationMode(f: Fragment): Activation["mode"] {
  return f.activation?.mode ?? "always";
}

function FragmentRow({
  fragment,
  index,
  onChange,
  onRemove,
  diagnostics,
}: {
  fragment: Fragment;
  index: number;
  onChange: (next: Fragment) => void;
  onRemove: () => void;
  diagnostics: readonly CheckDiagnostic[];
}) {
  const ids = { id: useId(), kind: useId(), text: useId(), mode: useId(), keys: useId() };
  const mode = activationMode(fragment);
  const content = fragment.content;
  const keys = fragment.activation?.mode === "keyword" ? fragment.activation.keys : [];
  const setActivation = (m: Activation["mode"]) => {
    const { activation: _, ...rest } = fragment;
    if (m === "always") onChange(rest);
    else if (m === "keyword") onChange({ ...rest, activation: { mode: "keyword", keys } });
    else if (m === "manual") onChange({ ...rest, activation: { mode: "manual" } });
    else onChange({ ...rest, activation: { mode: "semantic" } });
  };

  return (
    <li className="catalog-card space-y-3 p-4 pl-8" aria-label={`Fragment ${index + 1}`}>
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
        <div className="space-y-1">
          <label htmlFor={ids.id} className="text-xs">
            ID
          </label>
          <Input
            id={ids.id}
            className="font-mono"
            value={fragment.id}
            maxLength={255}
            onChange={(e) => onChange({ ...fragment, id: e.target.value.toLowerCase() })}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={ids.kind} className="text-xs">
            Kind
          </label>
          <select
            id={ids.kind}
            className={`${selectClass} w-full`}
            value={fragment.kind}
            onChange={(e) => onChange({ ...fragment, kind: e.target.value as FragmentKind })}
          >
            {FRAGMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          <Trash2 aria-hidden /> Remove
        </Button>
      </div>

      {content.type === "text" ? (
        <div className="space-y-1">
          <label htmlFor={ids.text} className="text-xs">
            Text
          </label>
          <Textarea
            id={ids.text}
            rows={4}
            value={content.text}
            onChange={(e) =>
              onChange({ ...fragment, content: { ...content, text: e.target.value } })
            }
          />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {content.type} content — edit it in the source file or the CLI.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <div className="space-y-1">
          <label htmlFor={ids.mode} className="text-xs">
            Included
          </label>
          <select
            id={ids.mode}
            className={`${selectClass} w-full`}
            value={mode}
            onChange={(e) => setActivation(e.target.value as Activation["mode"])}
          >
            <option value="always">always</option>
            <option value="keyword">on keywords</option>
            <option value="manual">when enabled by hand</option>
            <option value="semantic">by relevance</option>
          </select>
        </div>
        {mode === "keyword" ? (
          <div className="space-y-1">
            <label htmlFor={ids.keys} className="text-xs">
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
              <p className="text-xs text-seal">Add at least one keyword.</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          className="accent-[var(--seal)]"
          checked={fragment.stable}
          onChange={(e) => onChange({ ...fragment, stable: e.target.checked })}
        />
        Stable — other creations may build on (override) this fragment
      </label>
      <DiagnosticList items={diagnostics} />
    </li>
  );
}

export function FragmentsEditor({
  type,
  working,
  update,
  diagnostics,
}: {
  type: CreationType;
  working: Working;
  update: (fn: (w: Working) => Working) => void;
  diagnostics: readonly CheckDiagnostic[];
}) {
  const fragments = getFragments(working);
  const kind = DEFAULT_KIND[type] ?? "knowledge";
  const replace = (i: number, next: Fragment | null) =>
    update((w) => {
      const list = [...getFragments(w)];
      if (next) list[i] = next;
      else list.splice(i, 1);
      return setFragments(w, list);
    });

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Fragments are the pieces of text that reach the model: a description, a personality, a lore
        entry. Keyword fragments only join the context when the chat mentions them.
      </p>
      <ul className="space-y-3">
        {fragments.map((f, i) => (
          <FragmentRow
            // 下标作为 key：ID 本身可以被编辑，不能用来当 key。
            key={i}
            index={i}
            fragment={f}
            onChange={(next) => replace(i, next)}
            onRemove={() => replace(i, null)}
            diagnostics={diagnosticsFor(diagnostics, `fragments[${f.id}]`)}
          />
        ))}
      </ul>
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
        <Plus aria-hidden /> Add fragment
      </Button>
    </div>
  );
}
