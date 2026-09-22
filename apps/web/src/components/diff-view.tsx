/**
 * Context Diff 视图。rating 与 license 的变化必须醒目：除了颜色，还有图标和文字说明，
 * 色觉障碍用户和屏幕阅读器用户也能注意到。
 */
import type { ContextDiff, JSONValue } from "@char-pub/core";
import { displayFragmentId } from "@char-pub/core";
import { AlertTriangle, Minus, Pencil, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** 这些字段的变化会改变谁能看、谁能用，必须高亮。 */
export const HIGHLIGHT_FIELDS = new Set(["rating", "licenses"]);

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-baseline gap-2 text-lg">
        {title}
        <span className="font-mono text-xs text-muted-foreground">{count}</span>
      </h3>
      {count === 0 ? <p className="text-sm text-muted-foreground">No changes.</p> : children}
    </section>
  );
}

function formatValue(v: JSONValue): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    return v
      .map((x) => {
        if (x && typeof x === "object" && !Array.isArray(x)) {
          const o = x as Record<string, JSONValue>;
          const main = o.license ?? o.rating ?? o.author ?? "";
          const who = o.ref ? `${o.ref}${o.asset ? ` · ${o.asset}` : ""}` : "";
          return who
            ? `${who}: ${typeof main === "string" ? main : JSON.stringify(main)}`
            : JSON.stringify(x);
        }
        return String(x);
      })
      .join(", ");
  }
  return JSON.stringify(v);
}

const FIELD_NOTE: Record<string, string> = {
  rating:
    "The effective rating changed. This decides who can see the creation and whether it is hidden by default.",
  licenses:
    "A license in the dependency closure changed. Check that the new terms still allow how you use it.",
};

export function DiffView({ diff }: { diff: ContextDiff }) {
  const { added, removed, modified } = diff.fragments;
  const highlighted = diff.meta_changes.filter((m) => HIGHLIGHT_FIELDS.has(m.field));
  const other = diff.meta_changes.filter((m) => !HIGHLIGHT_FIELDS.has(m.field));

  return (
    <div className="space-y-8">
      {highlighted.length > 0 ? (
        <section aria-labelledby="diff-attention" className="space-y-3">
          <h3 id="diff-attention" className="text-lg">
            Needs your attention
          </h3>
          {highlighted.map((m) => (
            <div
              key={m.field}
              role="alert"
              data-highlight={m.field}
              className="catalog-card flex gap-3 border-seal/70 bg-seal-soft p-4 pl-7"
            >
              <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-seal" />
              <div className="space-y-1">
                <p className="font-medium">
                  <span className="stamp mr-2 border-seal bg-seal text-primary-foreground">
                    {m.field === "rating" ? "rating changed" : "license changed"}
                  </span>
                </p>
                <p className="text-sm">{FIELD_NOTE[m.field]}</p>
                <p className="font-mono text-xs">
                  <span className="text-muted-foreground">from </span>
                  {formatValue(m.from)}
                </p>
                <p className="font-mono text-xs">
                  <span className="text-muted-foreground">to </span>
                  {formatValue(m.to)}
                </p>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {diff.token_delta ? (
        <section className="grid grid-cols-2 gap-4 sm:max-w-md">
          <Delta label="Always in context" value={diff.token_delta.always} />
          <Delta label="Could be in context" value={diff.token_delta.potential} />
          <p className="col-span-2 font-mono text-xs text-muted-foreground">
            tokenizer: {diff.token_delta.tokenizer}
            {diff.token_delta.tokenizer === "estimate" ? " (estimate)" : ""}
          </p>
        </section>
      ) : null}

      <Section title="Dependencies" count={diff.lock_changes.length}>
        <ul className="divide-y divide-rule border-y border-rule text-sm">
          {diff.lock_changes.map((l) => (
            <li key={l.ref} className="flex justify-between gap-4 py-2 font-mono text-xs">
              <span>{l.ref}</span>
              <span>
                {l.from ?? "—"} → {l.to ?? "removed"}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Fragments" count={added.length + removed.length + modified.length}>
        <ul className="divide-y divide-rule border-y border-rule text-sm">
          {added.map((id) => (
            <FragmentRow
              key={id}
              id={id}
              icon={<Plus aria-hidden className="size-4 text-moss" />}
              label="added"
            />
          ))}
          {removed.map((id) => (
            <FragmentRow
              key={id}
              id={id}
              icon={<Minus aria-hidden className="size-4 text-seal" />}
              label="removed"
            />
          ))}
          {modified.map((m) => (
            <FragmentRow
              key={m.id}
              id={m.id}
              icon={<Pencil aria-hidden className="size-4 text-amber" />}
              label="modified"
              extra={m.fields.join(", ")}
            />
          ))}
        </ul>
      </Section>

      <Section title="Origin changes" count={diff.origin_changes.length}>
        <ul className="divide-y divide-rule border-y border-rule text-xs">
          {diff.origin_changes.map((o) => (
            <li key={o.id} className="py-2 font-mono">
              <span className="block">{displayFragmentId(o.id)}</span>
              <span className="text-muted-foreground">
                release {o.from.release} → {o.to.release}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      {other.length > 0 ? (
        <Section title="Other metadata" count={other.length}>
          <ul className="divide-y divide-rule border-y border-rule text-xs">
            {other.map((m) => (
              <li key={m.field} className="py-2 font-mono">
                <span className="block font-sans text-sm">{m.field.replace("_", " ")}</span>
                {formatValue(m.from)} → {formatValue(m.to)}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}

function Delta({ label, value }: { label: string; value: number }) {
  const sign = value > 0 ? "+" : "";
  return (
    <div className="catalog-card p-3 pl-6">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "font-display text-2xl tabular-nums",
          value > 0 && "text-seal",
          value < 0 && "text-moss",
        )}
      >
        {sign}
        {value.toLocaleString("en-US")}
        <span className="ml-1 font-sans text-xs text-muted-foreground">tokens</span>
      </p>
    </div>
  );
}

function FragmentRow({
  id,
  icon,
  label,
  extra,
}: {
  id: string;
  icon: ReactNode;
  label: string;
  extra?: string;
}) {
  return (
    <li className="flex items-start gap-3 py-2" data-change={label}>
      {icon}
      <span className="flex-1">
        <span className="block font-mono text-xs" title={id}>
          {displayFragmentId(id)}
        </span>
        {extra ? <span className="text-xs text-muted-foreground">changed: {extra}</span> : null}
      </span>
      <span className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
    </li>
  );
}
