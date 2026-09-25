/**
 * “More options”：Passages、Dependencies、Rating, license & tags、Language 四个折叠区。
 * 折叠时每一项显示一行摘要，作者不用展开就知道里面有什么；展开的状态由编辑器管理，检查栏
 * 和发布对话框定位问题时会打开对应的一项。
 */
import type { CheckDiagnostic, CreationType } from "@char-pub/core";
import { ChevronDown, FileText, Languages, Network, Shield } from "lucide-react";
import type { ReactNode } from "react";
import type { Working } from "@/lib/draft";
import { cn } from "@/lib/utils";
import { ANCHOR, type SectionKey } from "./anchors";
import { DependenciesEditor, dependenciesSummary } from "./dependencies-editor";
import { FragmentsEditor, passagesSummary } from "./fragments-editor";
import { LanguageEditor, languageSummary, MetaEditor, metaSummary } from "./meta-editor";

function OptionSection({
  id,
  title,
  summary,
  icon: Icon,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  summary: string;
  icon: typeof FileText;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const panel = `${id}-panel`;
  return (
    <section id={id} aria-labelledby={`${id}-t`} className="scroll-mt-24">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panel}
          // 按钮的名字只取标题，摘要作为补充说明读出来。
          aria-labelledby={`${id}-t`}
          aria-describedby={`${id}-s`}
          className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-surface-2/60 focus-visible:bg-surface-2 focus-visible:outline-none sm:px-6"
          onClick={onToggle}
        >
          <Icon aria-hidden className="size-4 shrink-0 text-text-2" />
          <span className="min-w-0 flex-1">
            <span id={`${id}-t`} className="block font-semibold">
              {title}
            </span>
            <span id={`${id}-s`} className="block truncate text-xs font-normal text-text-2">
              {summary}
            </span>
          </span>
          <ChevronDown
            aria-hidden
            className={cn("size-4 shrink-0 text-text-3 transition-transform", open && "rotate-180")}
          />
        </button>
      </h3>
      {open ? (
        <div id={panel} className="px-5 pb-5 sm:px-6">
          {children}
        </div>
      ) : null}
    </section>
  );
}

export function MoreOptions({
  self,
  type,
  working,
  update,
  diagnostics,
  open,
  onToggle,
}: {
  self: string;
  type: CreationType;
  working: Working;
  update: (fn: (w: Working) => Working) => void;
  diagnostics: readonly CheckDiagnostic[];
  open: ReadonlySet<SectionKey>;
  onToggle: (key: SectionKey) => void;
}) {
  return (
    <section aria-labelledby="more-h" className="overflow-hidden rounded-xl border bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b px-5 py-4 sm:px-6">
        <h2 id="more-h" className="text-lg font-bold tracking-tight">
          More options
        </h2>
        <p className="text-xs text-text-2">Passages, dependencies, rating and license</p>
      </div>
      <div className="divide-y">
        {type !== "preset" && type !== "prompt-module" ? (
          <>
            <OptionSection
              id={ANCHOR.passages}
              title="Passages"
              summary={passagesSummary(working, type)}
              icon={FileText}
              open={open.has("passages")}
              onToggle={() => onToggle("passages")}
            >
              <FragmentsEditor
                type={type}
                working={working}
                update={update}
                diagnostics={diagnostics}
              />
            </OptionSection>
            <OptionSection
              id={ANCHOR.dependencies}
              title="Dependencies"
              summary={dependenciesSummary(working)}
              icon={Network}
              open={open.has("dependencies")}
              onToggle={() => onToggle("dependencies")}
            >
              <DependenciesEditor
                self={self}
                working={working}
                update={update}
                diagnostics={diagnostics}
              />
            </OptionSection>
          </>
        ) : null}
        <OptionSection
          id={ANCHOR.meta}
          title="Rating, license & tags"
          summary={metaSummary(working)}
          icon={Shield}
          open={open.has("meta")}
          onToggle={() => onToggle("meta")}
        >
          <MetaEditor working={working} update={update} diagnostics={diagnostics} />
        </OptionSection>
        <OptionSection
          id={ANCHOR.language}
          title="Language"
          summary={languageSummary(working)}
          icon={Languages}
          open={open.has("language")}
          onToggle={() => onToggle("language")}
        >
          <LanguageEditor working={working} update={update} diagnostics={diagnostics} />
        </OptionSection>
      </div>
    </section>
  );
}
