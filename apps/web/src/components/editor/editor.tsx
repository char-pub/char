/**
 * 草稿编辑器：整页工作区。
 *
 * - 顶部编辑栏：返回、标题、`@ns/name · draft based on …`、保存状态、Preview context（有已发布
 *   版本时）和 Publish… 主按钮；
 * - 左侧第一层 “The basics”（头像、名字、正文、简介、问候语），下面是 “More options” 的四个
 *   折叠区；
 * - 右侧常驻检查栏 “Before you publish” 和 “Next release”，窄屏时排到表单下方。
 *
 * 修改会自动保存；草稿在别处被改过时停止自动保存，按对象比较并重新应用本地修改。
 */
import type { CreationPermissions, ReleaseSummary } from "@char-pub/contracts";
import type { CreationType } from "@char-pub/core";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useBlocker } from "@tanstack/react-router";
import { ArrowLeft, Rocket, ScanEye } from "lucide-react";
import { type ComponentProps, useCallback, useEffect, useRef, useState } from "react";
import { Container } from "@/components/layout";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import type { Draft, Me } from "@/lib/api";
import { getFragments, getName, getReferences, type Working } from "@/lib/draft";
import { suggestLabel } from "@/lib/publish";
import { keys, useMe, useRegistry } from "@/lib/registry";
import { useDraftEditor } from "@/lib/use-draft-editor";
import {
  ANCHOR,
  type EditorNavigation,
  mainFragmentId,
  type SectionKey,
  scrollToAnchor,
  type Target,
  targetOf,
} from "./anchors";
import { AssemblyEditor, AuthorTestsEditor } from "./assembly-editor";
import { AuthorAssistance } from "./author-assistance";
import { BasicsFields } from "./basics-fields";
import { buildChecks, ChecksPanel, NextRelease } from "./checks-panel";
import { CompositionEditor } from "./composition-editor";
import { ContentGroups } from "./content-groups";
import { DiagnosticList } from "./diagnostics";
import { ConflictNotice } from "./draft-conflict";
import { DraftOrigin } from "./draft-origin";
import { DraftPreview } from "./draft-preview";
import { FragmentsEditor } from "./fragments-editor";
import { MoreOptions } from "./more-options";
import { PolicyEditor } from "./policy-editor";
import { PublishDialog } from "./publish-panel";
import { SaveStatus } from "./save-status";
import { SourcesEditor } from "./sources-editor";
import { StoryWorkspace } from "./story-workspace";

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
  permissions,
}: {
  ns: string;
  name: string;
  type: CreationType;
  draft: Draft;
  existingLabels: readonly string[];
  releases?: readonly ReleaseSummary[];
  /** 最新的 public 版本：Preview context 和已发布头像的预览用它。 */
  latestPublicLabel?: string | undefined;
  permissions?: CreationPermissions | undefined;
}) {
  const client = useRegistry();
  const queryClient = useQueryClient();
  const actor = useMe().data?.id;
  const ed = useDraftEditor(client, ns, name, draft, {
    isCurrent: () => queryClient.getQueryData<Me | null>(keys.me)?.id === actor,
  });
  const [open, setOpen] = useState(() => initialSections(draft.working as Working, type));
  const [navigation, setNavigation] = useState<EditorNavigation>();
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const pendingRef = useRef(pendingKeys);
  pendingRef.current = pendingKeys;
  const onPendingChange = useCallback((key: string, pending: boolean) => {
    setPendingKeys((previous) => {
      if (previous.has(key) === pending) return previous;
      const next = new Set(previous);
      if (pending) next.add(key);
      else next.delete(key);
      pendingRef.current = next;
      return next;
    });
  }, []);
  const pendingReason = pendingKeys.size
    ? "Apply or discard structured-data edits before building, testing or publishing."
    : undefined;
  const saveSnapshot = () => (pendingRef.current.size ? Promise.resolve(null) : ed.flushSnapshot());
  const blocker = useBlocker({
    shouldBlockFn: () => pendingRef.current.size > 0,
    enableBeforeUnload: pendingKeys.size > 0,
    withResolver: true,
  });
  useEffect(() => {
    if (navigation && !navigation.storyView && !navigation.contentSelection)
      scrollToAnchor(navigation.anchor);
  }, [navigation]);
  const [publishOpen, setPublishOpen] = useState(false);
  const errors = ed.state.kind === "invalid" ? ed.state.diagnostics : [];
  const diagnostics = [...errors, ...ed.warnings];
  const references = getReferences(ed.working);
  const displayName = getName(ed.working).trim();
  const newest = newestRelease(releases);
  const blocked =
    pendingReason ??
    (ed.state.kind === "denied"
      ? "Your access changed. Copy your edits before leaving."
      : ed.state.kind === "conflict"
        ? "Resolve the draft changes before publishing."
        : ed.state.kind === "invalid"
          ? "Fix the errors in the draft before publishing."
          : displayName === ""
            ? "Give it a name before publishing."
            : null);
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
    setNavigation((previous) => ({ ...t, request: (previous?.request ?? 0) + 1 }));
  };

  return (
    <div className="flex flex-1 flex-col">
      <AlertDialog open={blocker.status === "blocked"}>
        <AlertDialogContent>
          <AlertDialogTitle>Leave unapplied data edits?</AlertDialogTitle>
          <AlertDialogDescription>
            Your JSON buffer has not been applied to the draft. Leaving discards that buffer.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>Stay and edit</AlertDialogCancel>
            <AlertDialogAction variant="destructive-solid" onClick={() => blocker.proceed?.()}>
              Discard buffer and leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
          {pendingReason ? (
            <p role="status" className="text-xs text-warning">
              Unapplied data edits
            </p>
          ) : null}
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
            {permissions?.publish ? (
              <Button disabled={!!pendingReason} onClick={() => setPublishOpen(true)}>
                <Rocket aria-hidden /> Publish…
              </Button>
            ) : null}
          </div>
        </Container>
      </div>

      <Container className="grid flex-1 gap-6 py-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8 lg:py-8">
        <div className="min-w-0 space-y-6">
          <DraftOrigin working={ed.working} />
          {ed.state.kind === "denied" ? (
            <div role="alert" className="space-y-3 rounded-xl bg-danger-soft p-5">
              <p>
                Saving has stopped because your access changed. Your unsaved edits are kept here.
                Copy them before leaving, then ask the owner to review your access.
              </p>
              <Button
                variant="outline"
                onClick={() =>
                  void navigator.clipboard
                    ?.writeText(JSON.stringify(ed.working, null, 2))
                    .then(() => toast.success("Copied your version."))
                    .catch(() => toast.error("Could not copy your version."))
                }
              >
                Copy my version
              </Button>
            </div>
          ) : null}
          {ed.state.kind === "conflict" ? <ConflictNotice editor={ed} /> : null}
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

          <AuthorAssistance
            working={ed.working}
            update={ed.update}
            blockedReason={
              pendingReason ??
              (ed.state.kind === "denied"
                ? "Your access changed. Keep a copy of your edits before leaving."
                : ed.state.kind === "conflict"
                  ? "Resolve the draft conflict before applying assisted content."
                  : undefined)
            }
          />
          {type === "scenario" ? (
            <StoryWorkspace working={ed.working} update={ed.update} navigation={navigation} />
          ) : null}
          {type === "preset" || type === "prompt-module" ? (
            <PolicyEditor
              working={ed.working}
              update={ed.update}
              module={type === "prompt-module"}
            />
          ) : type === "scenario" ? (
            <details className="rounded-xl border bg-surface p-5">
              <summary className="cursor-pointer text-lg font-semibold">
                Story settings: cast, bindings and presets
              </summary>
              <CompositionEditor type={type} working={ed.working} update={ed.update} />
              <AssemblyEditor working={ed.working} update={ed.update} />
            </details>
          ) : (
            <CompositionEditor type={type} working={ed.working} update={ed.update} />
          )}
          {type !== "prompt-module" ? (
            <AuthorTestsEditor
              ns={ns}
              name={name}
              save={saveSnapshot}
              working={ed.working}
              update={ed.update}
            />
          ) : null}

          {type === "world" || type === "lorebook" ? (
            <div id={ANCHOR.passages}>
              <ContentGroups
                navigation={navigation}
                working={ed.working}
                update={ed.update}
                renderEntries={(ids, onNavigate) => (
                  <FragmentsEditor
                    onPendingChange={onPendingChange}
                    type={type}
                    working={ed.working}
                    update={ed.update}
                    diagnostics={diagnostics}
                    visibleIds={ids}
                    onNavigate={onNavigate}
                  />
                )}
              />
            </div>
          ) : null}
          <SourcesEditor working={ed.working} update={ed.update} />

          {pendingReason ? <p role="status">{pendingReason}</p> : null}
          <DraftPreview
            blockedReason={pendingReason}
            onLocateSource={(subject) => {
              const target = targetOf(subject, type, ed.working);
              if (target) locate(target);
            }}
            ns={ns}
            name={name}
            working={ed.working}
            update={ed.update}
            save={saveSnapshot}
          />

          <MoreOptions
            navigation={navigation}
            onPendingChange={onPendingChange}
            canUpdateSensitive={permissions?.update_sensitive === true}
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
          <ChecksPanel
            items={checks}
            onLocate={locate}
            canPublish={permissions?.publish === true}
          />
          {permissions?.publish ? (
            <NextRelease
              ns={ns}
              name={name}
              suggested={suggestLabel(existingLabels)}
              latest={newest}
            />
          ) : null}
        </aside>
      </Container>

      {permissions?.publish ? (
        <PublishDialog
          open={publishOpen}
          onOpenChange={setPublishOpen}
          ns={ns}
          name={name}
          displayName={displayName}
          existingLabels={existingLabels}
          basedOn={newest?.label}
          releases={releases}
          save={saveSnapshot}
          working={ed.working}
          update={ed.update}
          onLocate={(target) => {
            setPublishOpen(false);
            locate(target);
          }}
          blocked={blocked}
          warnings={ed.warnings}
          references={references}
          onOpenDependencies={() =>
            locate({ anchor: ANCHOR.dependencies, section: "dependencies" })
          }
        />
      ) : null}
    </div>
  );
}
