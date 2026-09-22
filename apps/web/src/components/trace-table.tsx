/**
 * Assembly Trace 表格：Context Preview 的核心。每一行回答“这段内容为什么进入（或没有
 * 进入）模型上下文、它来自哪条依赖、被谁覆盖过”。
 */
import type { AssemblyTrace, ContextIR, IRFragment } from "@char-pub/core";
import { displayFragmentId } from "@char-pub/core";
import { ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import { cn } from "@/lib/utils";
import { UserText } from "./user-content";

type Entry = AssemblyTrace["entries"][number];

const REASON_TEXT: Record<string, string> = {
  always: "always included",
  pinned: "pinned — never cut",
  semantic: "semantic retrieval not supported here",
  manual: "enabled by hand",
  budget: "did not fit the budget",
  visibility: "hidden from this participant",
  "locale-fallback": "shown in the default language",
  "unsupported-media": "media not supported by this runtime",
  inactive: "not triggered",
};

export function describeReason(reason: string): string {
  if (reason.startsWith("keyword:")) return `keyword “${reason.slice("keyword:".length)}” matched`;
  return REASON_TEXT[reason] ?? reason;
}

function kindOf(entry: Entry, byId: Map<string, IRFragment>): string {
  const f = byId.get(entry.id);
  if (f) return f.kind;
  if (entry.id === "history") return "history";
  if (entry.id.startsWith("session:")) return "session";
  if (entry.id.startsWith("preset:")) return "preset";
  return "—";
}

function shortId(id: string): string {
  return id.includes("#") ? displayFragmentId(id) : id;
}

export function TraceSummary({ trace }: { trace: AssemblyTrace }) {
  const included = trace.entries.filter((e) => e.decision === "included").length;
  return (
    <p className="font-mono text-sm" data-testid="trace-summary">
      <strong className="font-medium">{trace.total_tokens.toLocaleString("en-US")} tokens</strong>
      <span className="text-muted-foreground"> · tokenizer: </span>
      {trace.profile.tokenizer}
      {trace.estimated ? (
        <span
          className="stamp ml-2 border-amber/60 bg-amber-soft"
          title="Token counts are estimates"
        >
          estimate
        </span>
      ) : null}
      <span className="text-muted-foreground">
        {" "}
        · {included}/{trace.entries.length} included · {trace.profile.mode}
      </span>
    </p>
  );
}

export function TraceTable({ trace, ir }: { trace: AssemblyTrace; ir: ContextIR }) {
  const byId = new Map(ir.fragments.map((f) => [f.id, f]));
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">
          Assembly trace: why each fragment was included in or left out of the model context
        </caption>
        <thead>
          <tr className="border-b border-foreground/70 text-left font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground">
            <th scope="col" className="w-8 py-2">
              <span className="sr-only">Details</span>
            </th>
            <th scope="col" className="py-2 pr-3">
              Kind
            </th>
            <th scope="col" className="py-2 pr-3">
              Fragment
            </th>
            <th scope="col" className="py-2 pr-3 text-right">
              Tokens
            </th>
            <th scope="col" className="py-2 pr-3">
              Decision
            </th>
            <th scope="col" className="py-2">
              Reason
            </th>
          </tr>
        </thead>
        <tbody>
          {trace.entries.map((e) => {
            const f = byId.get(e.id);
            const expanded = open.has(e.id);
            const detailsId = `trace-${e.id.replace(/[^A-Za-z0-9]/g, "-")}`;
            const included = e.decision === "included";
            return (
              <Fragment key={e.id}>
                <tr
                  className={cn(
                    "border-b border-rule align-top",
                    !included && "text-muted-foreground",
                  )}
                  data-decision={e.decision}
                >
                  <td className="py-2">
                    {e.origin || f ? (
                      <button
                        type="button"
                        className="rounded-sm p-0.5 hover:bg-muted"
                        aria-expanded={expanded}
                        aria-controls={detailsId}
                        aria-label={`${expanded ? "Hide" : "Show"} details for ${shortId(e.id)}`}
                        onClick={() => toggle(e.id)}
                      >
                        <ChevronRight
                          aria-hidden
                          className={cn("size-4 transition-transform", expanded && "rotate-90")}
                        />
                      </button>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs">{kindOf(e, byId)}</td>
                  <td className="max-w-[18rem] py-2 pr-3 font-mono text-xs break-all" title={e.id}>
                    {shortId(e.id)}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums">
                    {included ? e.tokens.toLocaleString("en-US") : "—"}
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={cn(
                        "stamp",
                        included
                          ? "border-moss/50 bg-moss-soft text-moss"
                          : "border-rule bg-transparent text-muted-foreground",
                      )}
                    >
                      {e.decision}
                    </span>
                  </td>
                  <td className="min-w-[9rem] py-2">
                    <span className="font-mono text-xs break-all">{e.reason}</span>
                    <span className="block text-xs text-muted-foreground">
                      {describeReason(e.reason)}
                    </span>
                  </td>
                </tr>
                {expanded ? (
                  <tr id={detailsId} className="border-b border-rule bg-muted/40">
                    <td />
                    <td colSpan={5} className="py-3 pr-3">
                      <OriginDetails entry={e} fragment={f} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OriginDetails({ entry, fragment }: { entry: Entry; fragment: IRFragment | undefined }) {
  const origin = entry.origin ?? fragment?.origin;
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
      <dt className="text-muted-foreground">Full ID</dt>
      <dd className="break-all font-mono">{entry.id}</dd>
      <dt className="text-muted-foreground">Region</dt>
      <dd className="font-mono">{entry.region}</dd>
      {origin ? (
        <>
          <dt className="text-muted-foreground">From</dt>
          <dd className="font-mono">
            {origin.creation}{" "}
            <span className="text-muted-foreground">release {origin.release}</span>
          </dd>
          <dt className="text-muted-foreground">Via</dt>
          <dd className="font-mono">
            {origin.via.length === 0 ? "root" : ["root", ...origin.via].join(" → ")}
          </dd>
          {origin.overridden_by && origin.overridden_by.length > 0 ? (
            <>
              <dt className="text-muted-foreground">Overridden by</dt>
              <dd className="font-mono">
                {origin.overridden_by
                  .map((o) => `${o.creation}${o.edge ? ` (${o.edge})` : ""} ${o.op}`)
                  .join("; ")}
              </dd>
            </>
          ) : null}
          {!origin.stable ? (
            <>
              <dt className="text-muted-foreground">Stability</dt>
              <dd>unstable ID — cannot be overridden by other creations</dd>
            </>
          ) : null}
        </>
      ) : null}
      {fragment?.content.type === "text" ? (
        <>
          <dt className="text-muted-foreground">Content</dt>
          <dd className="max-w-prose">
            <UserText text={fragment.content.text} />
          </dd>
        </>
      ) : null}
    </dl>
  );
}
