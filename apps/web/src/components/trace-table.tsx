/**
 * Assembly Trace：Context Preview 的核心。汇总卡片给出总 token 数（标明 tokenizer，估算时
 * 明确标出）和按来源着色的占比条；表格每一行用一句话回答“这段内容为什么进入（或没有进入）
 * 模型上下文”，展开后说明它来自哪条依赖、为什么是现在、放在哪里、被谁改过。原始的 reason
 * code 只放在展开行里作为次要信息。
 */
import type { AssemblyTrace, ContextIR, IRFragment } from "@char-pub/core";
import { displayFragmentId } from "@char-pub/core";
import { Check, ChevronRight, Info, Minus } from "lucide-react";
import { Fragment, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { nodeOf } from "@/lib/creation-graph";
import {
  fromText,
  overriddenText,
  type TraceEntry,
  whereLong,
  whereShort,
  whyLong,
  whyShort,
} from "@/lib/trace-text";
import { cn } from "@/lib/utils";
import { TYPE_STYLE } from "./badges";
import { UserText } from "./user-content";

/** Session 与对话历史在占比条里用中性色。 */
const SESSION_DOT = "bg-text-3";

function dotFor(ir: ContextIR | undefined, ref: string | undefined): string {
  const node = ir && ref ? nodeOf(ir, ref) : undefined;
  return node ? TYPE_STYLE[node.type].dot : SESSION_DOT;
}

function shortId(id: string): string {
  return id.includes("#") ? displayFragmentId(id) : id;
}

interface Share {
  key: string;
  label: string;
  tokens: number;
  dot: string;
}

/** 已纳入的 token 按来源作品分组；Session 与对话历史合成一组。 */
function sharesOf(trace: AssemblyTrace, ir: ContextIR | undefined): Share[] {
  const map = new Map<string, Share>();
  for (const e of trace.entries) {
    if (e.decision !== "included") continue;
    const ref = e.origin?.creation;
    const key =
      ref ??
      (e.id.startsWith("preset:")
        ? "policy"
        : e.id === "assembly:formatting"
          ? "formatting"
          : "session");
    const prev = map.get(key);
    if (prev) prev.tokens += e.tokens;
    else
      map.set(key, {
        key,
        label:
          ref ??
          (key === "policy"
            ? "Prompt policy"
            : key === "formatting"
              ? "Message formatting"
              : "Session & chat"),
        tokens: e.tokens,
        dot: dotFor(ir, ref),
      });
  }
  return [...map.values()];
}

export function TraceSummary({ trace, ir }: { trace: AssemblyTrace; ir?: ContextIR | undefined }) {
  const shares = sharesOf(trace, ir);
  const skipped = trace.entries.filter((e) => e.decision === "skipped").length;
  const window = trace.profile.context_window;
  return (
    <section
      aria-label="Context size"
      data-testid="trace-summary"
      className="space-y-3 rounded-lg border bg-surface px-5 py-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-3xl font-bold tracking-tight tabular-nums">
            {trace.total_tokens.toLocaleString("en-US")}
          </span>
          <span className="text-sm text-text-2">
            of {window.toLocaleString("en-US")} tokens · {trace.profile.mode}
          </span>
        </p>
        {trace.estimated ? (
          <Badge variant="warning" data-estimate>
            <Info aria-hidden /> Estimated count — tokenizer: {trace.profile.tokenizer}
          </Badge>
        ) : (
          <Badge variant="neutral">Exact count — tokenizer: {trace.profile.tokenizer}</Badge>
        )}
      </div>
      <div aria-hidden className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-surface-2">
        {shares.map((s) => (
          <span
            key={s.key}
            className={cn("h-full", s.dot)}
            style={{ width: `${Math.min(100, (s.tokens / window) * 100)}%` }}
          />
        ))}
      </div>
      <ul
        aria-label="Tokens by source"
        className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-text-2"
      >
        {shares.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span aria-hidden className={cn("size-2 rounded-sm", s.dot)} />
            <span className={s.key === "session" ? "" : "font-mono"}>{s.label}</span>
            <span className="tabular-nums">· {s.tokens.toLocaleString("en-US")}</span>
          </li>
        ))}
        {skipped > 0 ? (
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-sm bg-border-strong" />
            {skipped} {skipped === 1 ? "passage" : "passages"} skipped
          </li>
        ) : null}
      </ul>
    </section>
  );
}

function PassageCell({
  entry,
  fragment,
  ir,
}: {
  entry: TraceEntry;
  fragment: IRFragment | undefined;
  ir: ContextIR;
}) {
  const origin = entry.origin ?? fragment?.origin;
  if (!origin) {
    return (
      <span className="flex items-center gap-2">
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", SESSION_DOT)} />
        <span className="font-mono text-xs">
          {entry.id === "history" ? "chat history" : entry.id}
        </span>
      </span>
    );
  }
  return (
    <span className="flex items-start gap-2" title={entry.id}>
      <span
        aria-hidden
        className={cn("mt-1.5 size-2 shrink-0 rounded-full", dotFor(ir, origin.creation))}
      />
      <span className="min-w-0">
        <span className="block font-mono text-xs font-medium [overflow-wrap:anywhere] text-text">
          #{origin.fragment}
        </span>
        <span className="block font-mono text-[0.7rem] [overflow-wrap:anywhere] text-text-3">
          {origin.creation}
        </span>
      </span>
    </span>
  );
}

function Details({
  entry,
  fragment,
  ir,
}: {
  entry: TraceEntry;
  fragment: IRFragment | undefined;
  ir: ContextIR;
}) {
  const overridden = overriddenText(ir, entry, fragment);
  const origin = entry.origin ?? fragment?.origin;
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm">
      <dt className="font-medium text-text-2">From</dt>
      <dd>
        <UserText text={fromText(ir, entry, fragment)} />
      </dd>
      <dt className="font-medium text-text-2">Why now</dt>
      <dd>
        <UserText text={whyLong(ir, entry, fragment)} />
      </dd>
      <dt className="font-medium text-text-2">Placed</dt>
      <dd>{whereLong(entry.region)}</dd>
      {overridden ? (
        <>
          <dt className="font-medium text-text-2">Overridden by</dt>
          <dd>
            <UserText text={overridden} />
          </dd>
        </>
      ) : null}
      {origin && !origin.stable ? (
        <>
          <dt className="font-medium text-text-2">Stability</dt>
          <dd>Its ID isn't stable, so other creations can't override it.</dd>
        </>
      ) : null}
      {fragment?.content.type === "text" ? (
        <>
          <dt className="font-medium text-text-2">Text</dt>
          <dd className="max-w-prose text-text-2">
            <UserText text={fragment.content.text} />
          </dd>
        </>
      ) : null}
      <dt className="font-medium text-text-3">Code</dt>
      <dd className="font-mono text-xs break-all text-text-3">
        {entry.reason} · region {entry.region} · {entry.id}
      </dd>
    </dl>
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
  const th = "px-3 py-2.5 text-left text-[0.7rem] font-bold tracking-wider text-text-2 uppercase";

  return (
    <div className="overflow-x-auto rounded-lg border bg-surface">
      <table className="w-full min-w-[40rem] border-collapse text-sm">
        <caption className="sr-only">
          Assembly trace: why each passage was included in or left out of the model context
        </caption>
        <thead className="bg-surface-2">
          <tr>
            <th scope="col" className="w-10 py-2.5 pl-3">
              <span className="sr-only">Details</span>
            </th>
            <th scope="col" className={cn(th, "pl-0")}>
              Passage
            </th>
            <th scope="col" className={th}>
              Where
            </th>
            <th scope="col" className={cn(th, "text-right")}>
              Tokens
            </th>
            <th scope="col" className={th}>
              Result
            </th>
            <th scope="col" className={th}>
              Why
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
                  className={cn("border-t align-top", expanded && "bg-surface-2")}
                  data-decision={e.decision}
                  data-id={e.id}
                >
                  <td className="py-3 pl-3">
                    <button
                      type="button"
                      className="rounded-sm p-0.5 text-text-3 hover:bg-surface-2 hover:text-text focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
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
                  </td>
                  <td className="max-w-[18rem] min-w-[11rem] py-3 pr-3">
                    <PassageCell entry={e} fragment={f} ir={ir} />
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-text-2">
                    {whereShort(e.region)}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-xs tabular-nums">
                    {included ? e.tokens.toLocaleString("en-US") : "—"}
                  </td>
                  <td className="px-3 py-3">
                    {included ? (
                      <Badge variant="success">
                        <Check aria-hidden /> Included
                      </Badge>
                    ) : (
                      <Badge variant="neutral">
                        <Minus aria-hidden /> Skipped
                      </Badge>
                    )}
                  </td>
                  <td
                    className={cn(
                      "min-w-[12rem] px-3 py-3",
                      included ? "text-text" : "text-text-2",
                    )}
                  >
                    <UserText text={whyShort(ir, e, f)} />
                  </td>
                </tr>
                {expanded ? (
                  <tr id={detailsId} className="bg-surface-2">
                    <td />
                    <td colSpan={5} className="pr-3 pb-4">
                      <Details entry={e} fragment={f} ir={ir} />
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
