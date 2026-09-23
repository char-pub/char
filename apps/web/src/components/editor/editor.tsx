/**
 * 草稿编辑器。第一层只有名字、简介、问候语和头像；“More options”里是 fragment、
 * 关键词激活、依赖与元信息。修改会自动保存；草稿在别处被改过时提示重新加载。
 */
import type { CreationType } from "@char-pub/core";
import { ChevronDown, ChevronRight, CloudCheck, CloudOff, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Draft } from "@/lib/api";
import { getFragments, getName, getReferences, MAIN_FRAGMENT, type Working } from "@/lib/draft";
import { useRegistry } from "@/lib/registry";
import { type SaveState, useDraftEditor } from "@/lib/use-draft-editor";
import { BasicsFields } from "./basics-fields";
import { DependenciesEditor } from "./dependencies-editor";
import { DiagnosticList } from "./diagnostics";
import { FragmentsEditor } from "./fragments-editor";
import { MetaEditor } from "./meta-editor";
import { PublishPanel } from "./publish-panel";

function SaveStatus({ state }: { state: SaveState }) {
  const text =
    state.kind === "saved"
      ? state.at
        ? "All changes saved"
        : "Draft loaded"
      : state.kind === "dirty"
        ? "Unsaved changes"
        : state.kind === "saving"
          ? "Saving…"
          : state.kind === "conflict"
            ? "Not saved — changed elsewhere"
            : state.kind === "invalid"
              ? "Not saved — fix the errors below"
              : state.message;
  const Icon =
    state.kind === "saving"
      ? Loader2
      : state.kind === "saved" || state.kind === "dirty"
        ? CloudCheck
        : CloudOff;
  return (
    <p
      className="flex items-center gap-1.5 text-sm text-muted-foreground"
      aria-live="polite"
      data-save-state={state.kind}
    >
      <Icon aria-hidden className={`size-4 ${state.kind === "saving" ? "animate-spin" : ""}`} />
      {text}
    </p>
  );
}

export function ConflictNotice({
  onReload,
  working,
}: {
  onReload: () => Promise<void>;
  working: Working;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div
      role="alertdialog"
      aria-labelledby="conflict-h"
      className="catalog-card space-y-2 p-5 pl-8"
    >
      <h2 id="conflict-h" className="font-display text-lg">
        This draft was changed somewhere else
      </h2>
      <p className="text-sm text-muted-foreground">
        Someone — maybe you, in another tab — saved a newer version. Your latest edits here were not
        saved. Reload to continue from the newer version; copy your version first if you want to
        keep it.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onReload().finally(() => setBusy(false));
          }}
        >
          Reload the latest draft
        </Button>
        <Button
          variant="outline"
          onClick={() => void navigator.clipboard?.writeText(JSON.stringify(working, null, 2))}
        >
          Copy my version
        </Button>
      </div>
    </div>
  );
}

/**
 * 草稿里是否已经用到了第一层之外的内容：除第一层的正文之外还有其他 fragment，或者有依赖。
 * 用到了就默认展开“More options”，否则只显示第一层。正文本身也是一个 fragment，不能计入，
 * 否则每个能保存的草稿都会默认展开。
 */
export function hasAdvanced(w: Working, type: CreationType): boolean {
  const main = MAIN_FRAGMENT[type];
  const fragments = getFragments(w);
  const mainId =
    fragments.find((f) => f.id === main?.id)?.id ??
    fragments.find((f) => f.kind === main?.kind)?.id;
  const others = fragments.filter((f) => f.id !== mainId);
  return others.length > 0 || getReferences(w).length > 0;
}

export function Editor({
  ns,
  name,
  type,
  draft,
  existingLabels,
}: {
  ns: string;
  name: string;
  type: CreationType;
  draft: Draft;
  existingLabels: readonly string[];
}) {
  const client = useRegistry();
  const ed = useDraftEditor(client, ns, name, draft);
  const [more, setMore] = useState(() => hasAdvanced(draft.working as Working, type));
  const errors = ed.state.kind === "invalid" ? ed.state.diagnostics : [];
  const diagnostics = [...errors, ...ed.warnings];
  const blocked =
    ed.state.kind === "conflict"
      ? "Reload the draft before publishing."
      : ed.state.kind === "invalid"
        ? "Fix the errors in the draft before publishing."
        : getName(ed.working).trim() === ""
          ? "Give it a name before publishing."
          : null;

  return (
    <div className="max-w-4xl space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-sm text-muted-foreground">
            @{ns}/{name} · {type}
          </p>
          <h1 className="text-4xl">Edit {getName(ed.working) || name}</h1>
        </div>
        <SaveStatus state={ed.state} />
      </header>

      {ed.state.kind === "conflict" ? (
        <ConflictNotice onReload={ed.reload} working={ed.working} />
      ) : null}

      {ed.state.kind === "invalid" ? (
        <div role="alert" className="space-y-2 rounded-sm border border-seal/60 p-4">
          <p className="text-sm font-medium text-seal">
            Not saved yet — the registry only keeps drafts that pass its checks.
            {errors.length === 0 && ed.state.message ? ` ${ed.state.message}` : ""}
          </p>
          <DiagnosticList items={errors} />
        </div>
      ) : null}

      <section aria-labelledby="basics-h" className="space-y-4">
        <h2 id="basics-h" className="text-2xl">
          The basics
        </h2>
        <BasicsFields
          type={type}
          working={ed.working}
          update={ed.update}
          diagnostics={diagnostics}
        />
      </section>

      <section className="space-y-6">
        <button
          type="button"
          aria-expanded={more}
          className="flex items-center gap-1 font-display text-xl"
          onClick={() => setMore((m) => !m)}
        >
          {more ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />} More options
        </button>
        {more ? (
          <div className="space-y-10">
            <section aria-labelledby="frag-h" className="space-y-3">
              <h3 id="frag-h" className="text-xl">
                Fragments
              </h3>
              <FragmentsEditor
                type={type}
                working={ed.working}
                update={ed.update}
                diagnostics={diagnostics}
              />
            </section>
            <section aria-labelledby="deps-h" className="space-y-3">
              <h3 id="deps-h" className="text-xl">
                Dependencies
              </h3>
              <DependenciesEditor
                working={ed.working}
                update={ed.update}
                diagnostics={diagnostics}
              />
            </section>
            <section aria-labelledby="meta-h" className="space-y-3">
              <h3 id="meta-h" className="text-xl">
                Rating, license and more
              </h3>
              <MetaEditor working={ed.working} update={ed.update} diagnostics={diagnostics} />
            </section>
          </div>
        ) : null}
        {ed.warnings.length > 0 ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">Warnings</p>
            <DiagnosticList items={ed.warnings} />
          </div>
        ) : null}
      </section>

      <PublishPanel
        ns={ns}
        name={name}
        existingLabels={existingLabels}
        flush={ed.flush}
        blocked={blocked}
      />
    </div>
  );
}
