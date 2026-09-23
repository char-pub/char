/**
 * Context Diff 视图：两个版本之间评级、许可、依赖锁定、内容片段和 token 的变化。
 *
 * 评级与许可的变化放在最上面，除了颜色还有图标和文字说明（“Check these before you upgrade”），
 * 色觉障碍用户和读屏用户也能注意到。传入两边的 IR 时，依赖和片段会带上类型、关系和激活方式。
 */
import type { ContextDiff, ContextIR, IRFragment, JSONValue, Rating } from "@char-pub/core";
import { displayFragmentId } from "@char-pub/core";
import { ChevronRight, Minus, Pencil, Plus, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { dependenciesOf, MODE_LABEL, nodeOf } from "@/lib/creation-graph";
import { cn } from "@/lib/utils";
import { TYPE_STYLE } from "./badges";
import { RATING_LABEL, RatingBadge } from "./rating";
import { UserText } from "./user-content";

/** 这些字段的变化会改变谁能看、谁能用，必须高亮。 */
export const HIGHLIGHT_FIELDS = new Set(["rating", "licenses"]);

const RATINGS = new Set<string>(Object.keys(RATING_LABEL));

const FIELD_NOTE: Record<string, string> = {
  rating:
    "The effective rating changed. This decides who can see the creation and whether it is hidden by default.",
  licenses:
    "A license in the dependency closure changed. Check that the new terms still allow how you use it.",
};

const OTHER_FIELD_LABEL: Record<string, string> = {
  content_warnings: "Content warnings",
  attribution: "Credits",
  contributors: "Contributors",
};

const FRAGMENT_FIELD_LABEL: Record<string, string> = {
  content: "text edited",
  activation: "activation changed",
  visibility: "visibility changed",
  importance: "importance changed",
  placement_hint: "placement changed",
  locales: "translations changed",
};

function formatValue(v: JSONValue): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    if (v.length === 0) return "none";
    return v
      .map((x) => {
        if (x && typeof x === "object" && !Array.isArray(x)) {
          const o = x as Record<string, JSONValue>;
          const main = o.license ?? o.rating ?? o.author ?? o.authors ?? "";
          const who = o.ref ? `${o.ref}${o.asset ? ` · ${o.asset}` : ""}` : "";
          const text = typeof main === "string" ? main : JSON.stringify(main);
          return who ? `${who}: ${text}` : JSON.stringify(x);
        }
        return String(x);
      })
      .join(", ");
  }
  return JSON.stringify(v);
}

/** 许可列表的简写：去重后的 SPDX 表达式，例如 “CC-BY-4.0 + CC-BY-SA-4.0”。 */
function licenseSet(v: JSONValue): string {
  if (!Array.isArray(v)) return formatValue(v);
  const all = v.flatMap((x) =>
    x && typeof x === "object" && !Array.isArray(x) && typeof x.license === "string"
      ? [x.license]
      : [],
  );
  return all.length > 0 ? [...new Set(all)].join(" + ") : "none";
}

/** 哪些作品的许可变了，例如 “@cyberpunk/night-city: CC-BY-4.0 → CC-BY-NC-4.0”。 */
function licenseChanges(from: JSONValue, to: JSONValue): string[] {
  const index = (v: JSONValue) => {
    const m = new Map<string, string>();
    if (!Array.isArray(v)) return m;
    for (const x of v) {
      if (x && typeof x === "object" && !Array.isArray(x) && typeof x.license === "string") {
        m.set(`${String(x.ref)}${x.asset ? ` · ${String(x.asset)}` : ""}`, x.license);
      }
    }
    return m;
  };
  const a = index(from);
  const b = index(to);
  const out: string[] = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    if (a.get(key) === b.get(key)) continue;
    out.push(`${key}: ${a.get(key) ?? "not included"} → ${b.get(key) ?? "no longer included"}`);
  }
  return out;
}

function Attention({ changes }: { changes: ContextDiff["meta_changes"] }) {
  return (
    <section
      aria-labelledby="diff-attention"
      className="space-y-3 rounded-lg bg-warning-soft px-5 py-4"
    >
      <h3
        id="diff-attention"
        className="flex items-center gap-2 text-base font-semibold text-warning"
      >
        <TriangleAlert aria-hidden className="size-4" /> Check these before you upgrade
      </h3>
      <ul className="space-y-2">
        {changes.map((m) => (
          <li
            key={m.field}
            data-highlight={m.field}
            className="grid gap-x-4 gap-y-1 rounded-md bg-surface px-4 py-3 text-sm sm:grid-cols-[6rem_1fr]"
          >
            <span className="font-semibold">{m.field === "rating" ? "Rating" : "Licenses"}</span>
            <div className="min-w-0 space-y-1">
              {m.field === "rating" &&
              typeof m.from === "string" &&
              typeof m.to === "string" &&
              RATINGS.has(m.from) &&
              RATINGS.has(m.to) ? (
                <p className="flex flex-wrap items-center gap-2">
                  <RatingBadge rating={m.from as Rating} />
                  <span aria-hidden>→</span>
                  <span className="sr-only">changed to</span>
                  <RatingBadge rating={m.to as Rating} />
                </p>
              ) : (
                <p className="font-mono text-xs break-words">
                  {m.field === "licenses" ? licenseSet(m.from) : formatValue(m.from)}{" "}
                  <span aria-hidden>→</span>
                  <span className="sr-only">changed to</span>{" "}
                  {m.field === "licenses" ? licenseSet(m.to) : formatValue(m.to)}
                </p>
              )}
              <p className="text-text-2">{FIELD_NOTE[m.field]}</p>
              {m.field === "licenses"
                ? licenseChanges(m.from, m.to).map((line) => (
                    <p key={line} className="font-mono text-xs break-words text-text-2">
                      {line}
                    </p>
                  ))
                : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function signed(n: number): string {
  return `${n > 0 ? "+" : ""}${n.toLocaleString("en-US")}`;
}

/** token 变化：一定进入上下文的部分，和关键词全部命中时最多增加的部分。 */
export function TokenDelta({ delta }: { delta: NonNullable<ContextDiff["token_delta"]> }) {
  const estimate = delta.tokenizer === "estimate";
  return (
    <section
      aria-label="Token changes"
      data-testid="token-delta"
      className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-surface px-5 py-3 text-sm"
    >
      <p>
        <span className="font-mono font-semibold tabular-nums">{signed(delta.always)}</span>{" "}
        <span className="text-text-2">Always in context</span>
      </p>
      <p>
        <span className="font-mono font-semibold tabular-nums">{signed(delta.potential)}</span>{" "}
        <span className="text-text-2">When everything is triggered</span>
      </p>
      <p className="font-mono text-xs text-text-3">
        tokenizer: {delta.tokenizer}
        {estimate ? " · approximate" : ""}
      </p>
    </section>
  );
}

function Card({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-surface">
      <div className="flex items-baseline justify-between gap-3 border-b px-5 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-text-3">{summary}</p>
      </div>
      {children}
    </section>
  );
}

const CHANGE_ICON = {
  added: <Plus aria-hidden className="size-3.5 text-success" />,
  removed: <Minus aria-hidden className="size-3.5 text-danger" />,
  modified: <Pencil aria-hidden className="size-3.5 text-blue-text" />,
};

const CHANGE_BG = { added: "bg-success-soft", removed: "bg-danger-soft", modified: "bg-blue-soft" };

function ChangeRow({
  change,
  children,
}: {
  change: "added" | "removed" | "modified";
  children: ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 px-5 py-3 text-sm" data-change={change}>
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded",
          CHANGE_BG[change],
        )}
      >
        {CHANGE_ICON[change]}
        <span className="sr-only">{change}</span>
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">{children}</div>
    </li>
  );
}

function Empty() {
  return <p className="px-5 py-3 text-sm text-text-3">No changes.</p>;
}

function DependencyChanges({
  changes,
  from,
  to,
}: {
  changes: ContextDiff["lock_changes"];
  from?: ContextIR | undefined;
  to?: ContextIR | undefined;
}) {
  const deps = new Map([
    ...(from ? dependenciesOf(from) : []).map((d) => [d.ref, d] as const),
    ...(to ? dependenciesOf(to) : []).map((d) => [d.ref, d] as const),
  ]);
  return (
    <Card
      title="Dependencies"
      summary={`${changes.length} ${changes.length === 1 ? "change" : "changes"}`}
    >
      {changes.length === 0 ? (
        <Empty />
      ) : (
        <ul className="divide-y">
          {changes.map((l) => {
            const d = deps.get(l.ref);
            const kind = !l.from ? "added" : !l.to ? "removed" : "modified";
            const how = [d?.mode ? MODE_LABEL[d.mode] : null, d?.rel?.replace(/_/g, " ")]
              .filter(Boolean)
              .join(" · ");
            return (
              <ChangeRow key={l.ref} change={kind}>
                <span className="flex items-center gap-2 font-mono text-xs">
                  {d ? (
                    <span
                      aria-hidden
                      className={cn("size-2 rounded-full", TYPE_STYLE[d.type].dot)}
                    />
                  ) : null}
                  {l.ref}
                </span>
                <span className="font-mono text-xs">
                  {l.from ?? "—"} → {l.to ?? "removed"}
                </span>
                {how ? <span className="text-xs text-text-3">{how}</span> : null}
              </ChangeRow>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function activationText(f: IRFragment | undefined): string | null {
  if (!f) return null;
  const a = f.activation;
  if (f.importance === "pinned" || a.mode === "always") return "always included";
  if (a.mode === "keyword") return `activates on ${a.keys.map((k) => `“${k}”`).join(", ")}`;
  if (a.mode === "manual") return "enabled by hand";
  return "added when relevant";
}

function PassageChanges({
  fragments,
  to,
}: {
  fragments: ContextDiff["fragments"];
  to?: ContextIR | undefined;
}) {
  const { added, removed, modified } = fragments;
  const find = (ir: ContextIR | undefined, id: string) => ir?.fragments.find((f) => f.id === id);
  const summary = [
    added.length ? `${added.length} added` : null,
    modified.length ? `${modified.length} changed` : null,
    removed.length ? `${removed.length} removed` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const id = (x: string) => (
    <span className="font-mono text-xs font-medium break-all" title={x}>
      {displayFragmentId(x)}
    </span>
  );
  return (
    <Card title="Passages" summary={summary || "no changes"}>
      {added.length + removed.length + modified.length === 0 ? (
        <Empty />
      ) : (
        <ul className="divide-y">
          {added.map((x) => {
            const how = activationText(find(to, x));
            return (
              <ChangeRow key={x} change="added">
                {id(x)}
                <span className="text-xs text-text-2">New{how ? ` — ${how}` : ""}</span>
              </ChangeRow>
            );
          })}
          {modified.map((m) => (
            <ChangeRow key={m.id} change="modified">
              {id(m.id)}
              <span className="text-xs text-text-2">
                {m.fields
                  .map((f) => FRAGMENT_FIELD_LABEL[f] ?? f)
                  .join(", ")
                  .replace(/^./, (c) => c.toUpperCase())}
              </span>
            </ChangeRow>
          ))}
          {removed.map((x) => (
            <ChangeRow key={x} change="removed">
              {id(x)}
              <span className="text-xs text-text-2">Removed</span>
            </ChangeRow>
          ))}
        </ul>
      )}
    </Card>
  );
}

function OtherChanges({
  meta,
  origins,
  to,
}: {
  meta: ContextDiff["meta_changes"];
  origins: ContextDiff["origin_changes"];
  to?: ContextIR | undefined;
}) {
  const count = meta.length + origins.length;
  if (count === 0) return null;
  return (
    <details className="group rounded-lg border bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-sm [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="size-4 text-text-3 transition-transform group-open:rotate-90"
        />
        <span className="font-semibold">Other changes</span>
        <span className="text-xs text-text-3">
          Content warnings, credits, contributors and where passages come from · {count}
        </span>
      </summary>
      <ul className="divide-y border-t">
        {meta.map((m) => (
          <li key={m.field} className="space-y-0.5 px-5 py-3 text-sm">
            <p className="font-medium">{OTHER_FIELD_LABEL[m.field] ?? m.field}</p>
            <p className="font-mono text-xs break-words text-text-2">
              <UserText text={formatValue(m.from)} /> → <UserText text={formatValue(m.to)} />
            </p>
          </li>
        ))}
        {origins.map((o) => {
          const node = to ? nodeOf(to, o.to.creation) : undefined;
          return (
            <li key={o.id} className="space-y-0.5 px-5 py-3 text-sm">
              <p className="font-mono text-xs font-medium break-all">{displayFragmentId(o.id)}</p>
              <p className="text-xs text-text-2">
                Now comes from {node ? <UserText text={node.name} /> : o.to.creation}{" "}
                <span className="font-mono">
                  ({o.from.release} → {o.to.release})
                </span>
              </p>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

export function DiffView({
  diff,
  from,
  to,
  showTokens = true,
}: {
  diff: ContextDiff;
  /** 两边的 IR：给出时依赖和片段显示类型、关系与激活方式。 */
  from?: ContextIR | undefined;
  to?: ContextIR | undefined;
  /** Versions 标签把 token 变化放在标题栏里时传 false。 */
  showTokens?: boolean;
}) {
  const highlighted = diff.meta_changes.filter((m) => HIGHLIGHT_FIELDS.has(m.field));
  const other = diff.meta_changes.filter((m) => !HIGHLIGHT_FIELDS.has(m.field));
  return (
    <div className="space-y-4">
      {highlighted.length > 0 ? <Attention changes={highlighted} /> : null}
      {showTokens && diff.token_delta ? <TokenDelta delta={diff.token_delta} /> : null}
      <DependencyChanges changes={diff.lock_changes} from={from} to={to} />
      <PassageChanges fragments={diff.fragments} to={to} />
      <OtherChanges meta={other} origins={diff.origin_changes} to={to} />
    </div>
  );
}
