/**
 * Passages（fragment）编辑：每一段是进入模型上下文的文本，带类型、激活方式和是否稳定。
 * 关键词激活的段落只在最近的对话提到关键词时才加入上下文（世界书条目就是这样）。
 * 非文本内容（对话示例、媒体、结构化数据）这里只读显示，保留原样。
 *
 * 第一层的正文也是一个 fragment：它的文字在 The basics 里编辑，这里只显示一行精简的设置
 * （类型、激活方式、是否稳定），不能改 ID 或删除。
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { getFragments, newFragment, nextId, setFragments, type Working } from "@/lib/draft";
import { mainFragmentId } from "./anchors";
import { DiagnosticList, diagnosticsFor } from "./diagnostics";
import { ListInput } from "./list-input";

const DEFAULT_KIND: Record<string, FragmentKind> = {
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
  index,
  main,
  onChange,
  onRemove,
  diagnostics,
}: {
  fragment: Fragment;
  index: number;
  /** 第一层的正文：文字在 The basics 里编辑，这里只调整类型、激活方式和是否稳定。 */
  main: boolean;
  onChange: (next: Fragment) => void;
  onRemove: () => void;
  diagnostics: readonly CheckDiagnostic[];
}) {
  const ids = {
    id: useId(),
    kind: useId(),
    text: useId(),
    mode: useId(),
    keys: useId(),
    stable: useId(),
  };
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
    <li className="space-y-3 rounded-lg border bg-surface p-4" aria-label={`Passage ${index + 1}`}>
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
            readOnly={main}
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
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </NativeSelect>
        </div>
        {main ? (
          <span className="pb-2 text-xs text-text-3">From The basics</span>
        ) : (
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
            <Trash2 aria-hidden /> Remove
          </Button>
        )}
      </div>

      {main ? (
        <p className="text-xs text-text-2">The text is edited in The basics above.</p>
      ) : content.type === "text" ? (
        <div className="space-y-1">
          <label htmlFor={ids.text} className="text-xs font-medium">
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
        <p className="text-xs text-text-2">
          {content.type} content — edit it in the source file or the CLI.
        </p>
      )}

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
            <option value="always">always</option>
            <option value="keyword">on keywords</option>
            <option value="manual">when enabled by hand</option>
            <option value="semantic">by relevance</option>
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
  const main = mainFragmentId(working, type);
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
      <p className="text-sm text-text-2">
        Passages are the pieces of text that reach the model besides the one in The basics: a
        personality, a scene, a lore entry. Keyword passages only join the context when the chat
        mentions them.
      </p>
      <ul className="space-y-3">
        {fragments.map((f, i) => (
          <FragmentRow
            // 下标作为 key：ID 本身可以被编辑，不能用来当 key。
            key={i}
            index={i}
            fragment={f}
            main={f.id === main}
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
        <Plus aria-hidden /> Add passage
      </Button>
    </div>
  );
}
