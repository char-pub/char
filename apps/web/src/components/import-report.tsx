/**
 * Import Report：角色卡导入时每个字段去了哪里（Mapped）、哪些没有导入（Left out）、哪些需要
 * 作者看一眼（Needs a look）。
 *
 * 被省略的策略字段（例如卡片里的 system prompt）只显示字段名，绝不显示内容：这些内容会改写
 * 模型行为，不属于作品本身，它们只留在作者自己的原件里。
 */
import type { ImportReport as Report } from "@char-pub/contracts";
import { ArrowRight, CircleCheck, CircleMinus, Info } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface LoreEntry {
  index: number;
  activation: string;
  notes: string[];
}

interface Placeholder {
  placeholder: string;
  location: string;
}

function asLore(e: Record<string, unknown>): LoreEntry {
  return {
    index: typeof e.index === "number" ? e.index : -1,
    activation: typeof e.activation === "string" ? e.activation : "",
    notes: Array.isArray(e.notes) ? e.notes.filter((n): n is string => typeof n === "string") : [],
  };
}

function asPlaceholder(p: Record<string, unknown>): Placeholder {
  return {
    placeholder: typeof p.placeholder === "string" ? p.placeholder : "",
    location: typeof p.location === "string" ? p.location : "",
  };
}

/** 卡片字段名去掉统一的 `data.` 前缀，读起来更短。 */
function cardField(from: string): string {
  return from.replace(/^data\./, "");
}

/** 导入后的位置换成编辑器里的叫法。 */
export function targetLabel(to: string): string {
  if (to === "display_name") return "Name";
  if (to === "summary") return "Summary";
  if (to === "meta.tags") return "Tags";
  if (to === "authors") return "Authors";
  if (to === "bootstrap.greetings#default") return "Greeting";
  if (to.startsWith("bootstrap.greetings#")) return `Greeting ${to.slice(19)}`;
  if (to === "fragments#examples") return "Example dialogue";
  if (to === "fragments#description") return "Description";
  if (to === "assets#avatar") return "Avatar";
  if (to.startsWith("fragments#")) return `Passage ${to.slice(9)}`;
  if (to.startsWith("assets#")) return `Image ${to.slice(6)}`;
  return to;
}

function Block({
  title,
  icon: Icon,
  tone,
  children,
}: {
  title: string;
  icon: typeof Info;
  tone: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 space-y-3 rounded-lg border bg-surface p-5" aria-label={title}>
      <h3 className="flex items-center gap-2 font-semibold">
        <Icon aria-hidden className={cn("size-4", tone)} />
        {title}
      </h3>
      {children}
    </section>
  );
}

export function ImportReport({
  report,
  unstable,
}: {
  report: Report;
  unstable: readonly string[];
}) {
  const droppedLore = report.lorebook.map(asLore).filter((e) => e.activation === "dropped");
  const placeholders = report.placeholders.map(asPlaceholder);
  const skippedAssets = report.assets.filter((a) => !a.imported);
  const leftOut =
    report.omitted_policy_fields.length +
    report.dropped.length +
    droppedLore.length +
    skippedAssets.length;
  const needsLook = unstable.length + placeholders.length + report.warnings.length;

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-2">
        Read a <span className="font-mono">{report.format}</span> card
        {report.spec_version ? ` (spec ${report.spec_version})` : ""} from a{" "}
        {report.container.toUpperCase()} file.
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        <Block title="Mapped" icon={CircleCheck} tone="text-success">
          {report.mappings.length === 0 ? (
            <p className="text-sm text-text-3">Nothing was mapped.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {report.mappings.map((m) => (
                <li key={`${m.from}->${m.to}`} className="flex flex-wrap items-center gap-x-2">
                  <span className="font-mono text-xs text-text-2 [overflow-wrap:anywhere]">
                    {cardField(m.from)}
                  </span>
                  <ArrowRight aria-label="becomes" className="size-3 shrink-0 text-text-3" />
                  <span>{targetLabel(m.to)}</span>
                </li>
              ))}
            </ul>
          )}
        </Block>

        <Block title="Left out" icon={CircleMinus} tone="text-warning">
          {leftOut === 0 ? (
            <p className="text-sm text-text-3">Everything in the card was kept.</p>
          ) : (
            <>
              {report.omitted_policy_fields.length > 0 ? (
                <>
                  <ul className="space-y-1.5 font-mono text-xs" aria-label="Omitted fields">
                    {report.omitted_policy_fields.map((f) => (
                      <li key={f.field} className="[overflow-wrap:anywhere]">
                        {f.field}
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-text-3">
                    Only field names are shown. Instructions that steer a chat app aren't part of an
                    open character, so they were not imported. Your original file still has them.
                  </p>
                </>
              ) : null}
              {report.dropped.length + droppedLore.length + skippedAssets.length > 0 ? (
                <ul className="space-y-1.5 text-xs" aria-label="Not imported">
                  {report.dropped.map((d) => (
                    <li key={d.field}>
                      <span className="font-mono [overflow-wrap:anywhere]">
                        {cardField(d.field)}
                      </span>
                      <span className="block text-text-3">{d.reason}</span>
                    </li>
                  ))}
                  {droppedLore.map((e) => (
                    <li key={`lore-${e.index}`}>
                      <span className="font-mono">character_book.entries[{e.index}]</span>
                      <span className="block text-text-3">{e.notes.join("; ") || "dropped"}</span>
                    </li>
                  ))}
                  {skippedAssets.map((a) => (
                    <li key={`${a.type}:${a.name}:${a.uri}`}>
                      <span className="font-mono">
                        asset {a.type}/{a.name}
                      </span>
                      <span className="block text-text-3">{a.reason ?? "not imported"}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </Block>

        <Block title="Needs a look" icon={Info} tone="text-blue">
          {needsLook === 0 ? (
            <p className="text-sm text-text-3">Nothing to check.</p>
          ) : (
            <>
              {unstable.length > 0 ? (
                <div className="space-y-1.5">
                  <ul className="flex flex-wrap gap-1.5 font-mono text-xs" aria-label="Unstable">
                    {unstable.map((id) => (
                      <li
                        key={id}
                        className="rounded-sm bg-warning-soft px-1.5 py-0.5 text-warning"
                      >
                        {id}
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-text-3">
                    These entries had no stable identity in the card. They work as usual, but other
                    creations can't build on them until you mark them stable in the editor.
                  </p>
                </div>
              ) : null}
              {placeholders.length > 0 ? (
                <div className="space-y-1.5">
                  <ul className="space-y-1 text-xs" aria-label="Macros kept as text">
                    {placeholders.map((p) => (
                      <li key={`${p.location}:${p.placeholder}`}>
                        <span className="font-mono">{p.placeholder}</span>{" "}
                        <span className="text-text-3">in {targetLabel(p.location)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-text-3">
                    These macros have no open equivalent and were kept as plain text.
                  </p>
                </div>
              ) : null}
              {report.warnings.length > 0 ? (
                <ul className="space-y-1.5 text-xs" aria-label="Warnings">
                  {report.warnings.map((w) => (
                    <li key={`${w.code}:${w.detail}`}>
                      <span className="font-mono">{w.code}</span>
                      <span className="block text-text-3">{w.detail}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </Block>
      </div>
    </div>
  );
}
