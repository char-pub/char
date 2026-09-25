/**
 * 草稿编辑器：整页工作区。
 *
 * - 顶部编辑栏：返回、标题、`@ns/name · draft based on …`、保存状态、Preview context（有已发布
 *   版本时）和 Publish… 主按钮；
 * - 左侧第一层 “The basics”（头像、名字、正文、简介、问候语），下面是 “More options” 的四个
 *   折叠区；
 * - 右侧常驻检查栏 “Before you publish” 和 “Next release”，窄屏时排到表单下方。
 *
 * 修改会自动保存；草稿在别处被改过时停止自动保存，提示重新加载或复制自己的版本。
 */
import type { ReleaseSummary } from "@char-pub/contracts";
import type { CreationType } from "@char-pub/core";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, GitCompareArrows, Rocket, ScanEye } from "lucide-react";
import { type ComponentProps, useState } from "react";
import { Container } from "@/components/layout";
import { Button, buttonVariants } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import type { Draft } from "@/lib/api";
import { getFragments, getName, getReferences, type Working } from "@/lib/draft";
import { suggestLabel } from "@/lib/publish";
import { useMe, useRegistry } from "@/lib/registry";
import { useDraftEditor } from "@/lib/use-draft-editor";
import { ANCHOR, mainFragmentId, type SectionKey, scrollToAnchor, type Target } from "./anchors";
import { AssemblyEditor, AuthorTestsEditor } from "./assembly-editor";
import { BasicsFields } from "./basics-fields";
import { buildChecks, ChecksPanel, NextRelease } from "./checks-panel";
import { CompositionEditor } from "./composition-editor";
import { DiagnosticList } from "./diagnostics";
import { DraftPreview } from "./draft-preview";
import { MoreOptions } from "./more-options";
import { PolicyEditor } from "./policy-editor";
import { PublishDialog } from "./publish-panel";
import { SaveStatus } from "./save-status";

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
      aria-describedby="conflict-d"
      className="space-y-3 rounded-xl border border-danger/40 bg-danger-soft p-5"
    >
      <h2 id="conflict-h" className="flex items-center gap-2 font-bold text-danger">
        <GitCompareArrows aria-hidden className="size-4" />
        This draft was changed somewhere else
      </h2>
      <p id="conflict-d" className="text-sm text-text">
        Someone — maybe you, in another tab — saved a newer version. Your latest edits here were not
        saved, and saving is paused. Reload to continue from the newer version; copy your version
        first if you want to keep it.
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
          onClick={() => {
            const text = JSON.stringify(working, null, 2);
            void navigator.clipboard
              ?.writeText(text)
              .then(() => toast.success("Copied your version to the clipboard."))
              .catch(() =>
                toast.error("Couldn't copy. Select the text in another editor instead."),
              );
          }}
        >
          Copy my version
        </Button>
      </div>
    </div>
  );
}

/**
 * 草稿里是否已经用到了第一层之外的内容：除第一层的正文之外还有其他 fragment，或者有依赖。
 * 正文本身也是一个 fragment，不能计入，否则每个能保存的草稿都会被当成“用到了”。
 */
export function hasAdvanced(w: Working, type: CreationType): boolean {
  const mainId = mainFragmentId(w, type);
  const others = getFragments(w).filter((f) => f.id !== mainId);
  return others.length > 0 || getReferences(w).length > 0;
}

/** 默认展开已经有内容的折叠区：其他段落、依赖。评级、许可和语言默认收起。 */
function initialSections(w: Working, type: CreationType): Set<SectionKey> {
  const open = new Set<SectionKey>();
  const mainId = mainFragmentId(w, type);
  if (getFragments(w).some((f) => f.id !== mainId)) open.add("passages");
  if (getReferences(w).length > 0) open.add("dependencies");
  return open;
}

/** 最新的一个版本（任意可见性），编辑栏里说明草稿基于哪个版本。 */
function newestRelease(releases: readonly ReleaseSummary[]): ReleaseSummary | undefined {
  return [...releases].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

export function Editor(props: ComponentProps<typeof EditorSession>) {
  const me = useMe();
  if (me.isPending) return <p role="status">Loading your editor…</p>;
  return (
    <EditorSession key={`${me.data?.id ?? "anonymous"}:${props.ns}:${props.name}`} {...props} />
  );
}
function EditorSession({
  ns,
  name,
  type,
  draft,
  existingLabels,
  releases = [],
  latestPublicLabel,
}: {
  ns: string;
  name: string;
  type: CreationType;
  draft: Draft;
  existingLabels: readonly string[];
  releases?: readonly ReleaseSummary[];
  /** 最新的 public 版本：Preview context 和已发布头像的预览用它。 */
  latestPublicLabel?: string | undefined;
}) {
  const client = useRegistry();
  const ed = useDraftEditor(client, ns, name, draft);
  const [open, setOpen] = useState(() => initialSections(draft.working as Working, type));
  const [publishOpen, setPublishOpen] = useState(false);
  const errors = ed.state.kind === "invalid" ? ed.state.diagnostics : [];
  const diagnostics = [...errors, ...ed.warnings];
  const references = getReferences(ed.working);
  const displayName = getName(ed.working).trim();
  const newest = newestRelease(releases);
  const blocked =
    ed.state.kind === "conflict"
      ? "Reload the draft before publishing."
      : ed.state.kind === "invalid"
        ? "Fix the errors in the draft before publishing."
        : displayName === ""
          ? "Give it a name before publishing."
          : null;
  const checks = buildChecks({
    type,
    working: ed.working,
    state: ed.state,
    warnings: ed.warnings,
    references,
  });

  const toggle = (key: SectionKey) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const locate = (t: Target) => {
    const section = t.section;
    if (section) setOpen((s) => new Set(s).add(section));
    scrollToAnchor(t.anchor);
  };

  return (
    <div className="flex flex-1 flex-col">
      {draft.unconfirmed_import ? (
        <Container className="py-4">
          <div role="status" className="rounded-lg bg-warning-soft p-4 text-sm">
            Confirm the imported card’s rating, rights and license before publishing.{" "}
            <Link
              to="/create/import"
              search={{ resume: draft.unconfirmed_import }}
              className="font-semibold underline"
            >
              Review and confirm the import
            </Link>
          </div>
        </Container>
      ) : null}
      <div className="sticky top-0 z-30 border-b bg-surface">
        <Container className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
          <Link
            to="/c/$ns/$name"
            params={{ ns, name }}
            aria-label="Back to the creation page"
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
          >
            <ArrowLeft aria-hidden />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold tracking-tight">
              Editing {displayName || name}
            </h1>
            <p className="truncate font-mono text-xs text-text-3">
              @{ns}/{name} · {newest ? `draft based on ${newest.label}` : "not published yet"}
            </p>
          </div>
          <SaveStatus state={ed.state} />
          <div className="flex items-center gap-2">
            {latestPublicLabel ? (
              <Link
                to="/c/$ns/$name/preview"
                params={{ ns, name }}
                search={{ v: latestPublicLabel }}
                className={buttonVariants({ variant: "outline" })}
              >
                <ScanEye aria-hidden /> Preview context
              </Link>
            ) : null}
            <Button onClick={() => setPublishOpen(true)}>
              <Rocket aria-hidden /> Publish…
            </Button>
          </div>
        </Container>
      </div>

      <Container className="grid flex-1 gap-6 py-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8 lg:py-8">
        <div className="min-w-0 space-y-6">
          {ed.state.kind === "conflict" ? (
            <ConflictNotice onReload={ed.reload} working={ed.working} />
          ) : null}
          {ed.state.kind === "invalid" ? (
            <div role="alert" className="space-y-2 rounded-xl bg-warning-soft p-4">
              <p className="text-sm font-medium text-warning">
                Not saved yet — the registry only keeps drafts that pass its checks.
                {errors.length === 0 && ed.state.message ? ` ${ed.state.message}` : ""}
              </p>
              <DiagnosticList items={errors} />
            </div>
          ) : null}

          <section
            aria-labelledby="basics-h"
            className="space-y-6 rounded-xl border bg-surface p-5 sm:p-7"
          >
            <div className="space-y-1">
              <h2 id="basics-h" className="text-xl font-bold tracking-tight">
                The basics
              </h2>
              <p className="text-sm text-text-2">Enough to publish. Everything else is optional.</p>
            </div>
            <BasicsFields
              ns={ns}
              name={name}
              type={type}
              working={ed.working}
              update={ed.update}
              diagnostics={diagnostics}
              latestLabel={latestPublicLabel}
            />
          </section>

          {type === "preset" || type === "prompt-module" ? (
            <PolicyEditor
              working={ed.working}
              update={ed.update}
              module={type === "prompt-module"}
            />
          ) : (
            <CompositionEditor type={type} working={ed.working} update={ed.update} />
          )}
          {type === "scenario" ? <AssemblyEditor working={ed.working} update={ed.update} /> : null}
          {type === "scenario" || type === "preset" ? (
            <AuthorTestsEditor working={ed.working} update={ed.update} />
          ) : null}

          <DraftPreview working={ed.working} />

          <MoreOptions
            self={`@${ns}/${name}`}
            type={type}
            working={ed.working}
            update={ed.update}
            diagnostics={diagnostics}
            open={open}
            onToggle={toggle}
          />
        </div>

        <aside aria-label="Checks" className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <ChecksPanel items={checks} onLocate={locate} />
          <NextRelease
            ns={ns}
            name={name}
            suggested={suggestLabel(existingLabels)}
            latest={newest}
          />
        </aside>
      </Container>

      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        ns={ns}
        name={name}
        displayName={displayName}
        existingLabels={existingLabels}
        basedOn={newest?.label}
        flush={ed.flush}
        blocked={blocked}
        warnings={ed.warnings}
        references={references}
        onOpenDependencies={() => locate({ anchor: ANCHOR.dependencies, section: "dependencies" })}
      />
    </div>
  );
}
