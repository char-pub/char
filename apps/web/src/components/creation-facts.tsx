/**
 * Overview 标签右侧的事实栏：评级从哪里来、依赖（Built on）、被谁依赖（Used by）、署名与许可、
 * 当前版本的发布信息。页面必须能解释 effective rating 由哪个依赖决定，并列出依赖与署名。
 */
import type { ContextIR, CreationType } from "@char-pub/core";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Dependent, ReleaseDetail, ReleaseSummary } from "@/lib/api";
import { dependenciesOf, MODE_LABEL, nodeOf, ratingReason, relPhrase } from "@/lib/creation-graph";
import { formatDate, localized, parseRef } from "@/lib/text";
import { cn } from "@/lib/utils";
import { TYPE_STYLE } from "./badges";
import { CopyButton } from "./copy-button";
import { RATING_LABEL, RatingBadge } from "./rating";
import { UserText } from "./user-content";

/** 右侧事实栏的一张卡片：标题做成 region 的名字，方便读屏跳转。 */
export function FactCard({
  id,
  title,
  children,
  className,
}: {
  id: string;
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn("space-y-3 rounded-lg border bg-surface px-5 py-4", className)}
    >
      <h2 id={id} className="text-base font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Dot({ type }: { type: CreationType }) {
  return (
    <span aria-hidden className={cn("block size-2 shrink-0 rounded-full", TYPE_STYLE[type].dot)} />
  );
}

function ModeBadge({ mode }: { mode: "intrinsic" | "default" }) {
  return mode === "intrinsic" ? (
    <Badge variant="ink">{MODE_LABEL.intrinsic}</Badge>
  ) : (
    <Badge variant="neutral">{MODE_LABEL.default}</Badge>
  );
}

/** 一句话说明评级来源，例如“Mature, because a dependency is rated Mature.” */
export function ratingSentence(ir: ContextIR, name: string): string {
  const r = ratingReason(ir);
  const label = RATING_LABEL[r.rating];
  const own = r.own && r.own !== r.rating ? ` ${name} on its own is ${RATING_LABEL[r.own]}.` : "";
  if (r.by === "self") return `${label}, as rated by its author.`;
  if (r.by === "dependency") return `${label}, because a dependency is rated ${label}.${own}`;
  return `${label}, because an image in it is rated ${label}.${own}`;
}

/** 遮挡卡片上的一句话：评级由谁决定，例如“Rated Mature because of @vee/afterlife (World).” */
export function matureReason(ir: ContextIR): string {
  const r = ratingReason(ir);
  const label = RATING_LABEL[r.rating];
  if (r.by === "self") return `Its author rated it ${label}.`;
  const dep = r.decisive.find((s) => !s.asset && s.ref !== ir.root.ref);
  if (dep) {
    const node = nodeOf(ir, dep.ref);
    return `Rated ${label} because of ${dep.ref}${node ? ` (${TYPE_STYLE[node.type].label})` : ""}.`;
  }
  return `Rated ${label} because of an image in it.`;
}

export function WhyThisRating({ ir, name }: { ir: ContextIR; name: string }) {
  const r = ratingReason(ir);
  const deps = new Map(dependenciesOf(ir).map((d) => [d.ref, d]));
  return (
    <FactCard id="c-rating" title="Why this rating">
      <p className="text-sm text-text-2">{ratingSentence(ir, name)}</p>
      <ul className="space-y-3">
        {ir.meta.rating_sources.map((s) => {
          const node = nodeOf(ir, s.ref);
          const dep = deps.get(s.ref);
          const self = s.ref === ir.root.ref;
          const decisive = s.rating === r.rating;
          return (
            <li key={`${s.ref}:${s.asset ?? ""}`} className="flex items-start gap-2.5 text-sm">
              {node ? (
                <span className="mt-1.5">
                  <Dot type={node.type} />
                </span>
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-xs break-all">{s.ref}</span>
                <span className="block text-xs text-text-3">
                  {s.asset
                    ? `Image · ${s.asset}`
                    : self
                      ? "This creation"
                      : [
                          node ? TYPE_STYLE[node.type].label : null,
                          dep?.mode ? MODE_LABEL[dep.mode] : dep && !dep.direct ? "Indirect" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                  {decisive ? (
                    <>
                      <span aria-hidden> · </span>
                      <span className="font-semibold text-text-2">sets the rating</span>
                    </>
                  ) : null}
                </span>
              </span>
              <RatingBadge rating={s.rating} className="shrink-0" />
            </li>
          );
        })}
      </ul>
    </FactCard>
  );
}

/** 依赖闭包里的其他作品；`labels` 把锁定的 Release ID 换成版本号（查不到时显示 ID）。 */
export function BuiltOn({
  ir,
  labels,
}: {
  ir: ContextIR;
  labels?: ReadonlyMap<string, string> | undefined;
}) {
  const deps = dependenciesOf(ir);
  return (
    <FactCard id="c-deps" title="Built on">
      {deps.length === 0 ? (
        <p className="text-sm text-text-2">Nothing: this creation stands on its own.</p>
      ) : (
        <ul className="space-y-3">
          {deps.map((d) => {
            const label = labels?.get(d.release);
            const r = parseRef(d.ref);
            const name = relPhrase(d.rel, d.name);
            return (
              <li key={d.ref} className="flex items-start gap-2.5 text-sm">
                <span className="mt-1.5">
                  <Dot type={d.type} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {r ? (
                      <Link to="/c/$ns/$name" params={r} className="hover:underline">
                        <UserText text={name} />
                      </Link>
                    ) : (
                      <UserText text={name} />
                    )}
                  </span>
                  <span className="block font-mono text-xs break-all text-text-3">
                    {d.ref}
                    {label ? `@${label}` : ""}
                  </span>
                  {label ? null : (
                    <span
                      className="block truncate font-mono text-[0.7rem] text-text-3"
                      title={d.release}
                    >
                      locked to {d.release}
                    </span>
                  )}
                </span>
                {d.mode ? (
                  <ModeBadge mode={d.mode} />
                ) : (
                  <Badge variant="outline" title="Pulled in by another dependency">
                    Indirect
                  </Badge>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </FactCard>
  );
}

/** 先显示这么多个依赖者。 */
const FIRST_DEPENDENTS = 5;

/**
 * 被谁依赖。接口一次最多返回 50 条，`total` 是作品详情里的总数：超过时如实说明只显示了一部分。
 */
export function UsedBy({
  items,
  total,
  state,
  expanded,
  onExpand,
}: {
  items: readonly Dependent[] | undefined;
  total: number;
  state: "loading" | "error" | "ready";
  expanded: boolean;
  onExpand: () => void;
}) {
  const list = items ?? [];
  const shown = expanded ? list : list.slice(0, FIRST_DEPENDENTS);
  return (
    <FactCard id="c-used" title={total > 0 ? `Used by · ${total}` : "Used by"}>
      {state === "loading" ? (
        <p className="text-sm text-text-3">Loading…</p>
      ) : state === "error" ? (
        <p className="text-sm text-text-2">The list of creations that use this couldn't load.</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-text-2">No public creation depends on this yet.</p>
      ) : (
        <>
          <ul className="space-y-3">
            {shown.map((d) => {
              const r = parseRef(d.ref);
              return (
                <li
                  key={`${d.ref}@${d.release.label}`}
                  className="flex items-start gap-2.5 text-sm"
                >
                  <span className="mt-1.5">
                    <Dot type={d.type} />
                  </span>
                  <span className="min-w-0 flex-1">
                    {r ? (
                      <Link
                        to="/c/$ns/$name"
                        params={r}
                        className="block font-medium hover:underline"
                      >
                        <UserText text={localized(d.display_name)} />
                      </Link>
                    ) : (
                      <UserText text={localized(d.display_name)} />
                    )}
                    <span className="block font-mono text-xs break-all text-text-3">
                      {d.ref}@{d.release.label}
                    </span>
                  </span>
                  <ModeBadge mode={d.mode} />
                </li>
              );
            })}
          </ul>
          {list.length > shown.length ? (
            <Button variant="link" size="sm" onClick={onExpand}>
              See all {list.length}
            </Button>
          ) : null}
          {expanded && total > list.length ? (
            <p className="text-xs text-text-3">
              Showing the first {list.length} of {total}.
            </p>
          ) : null}
        </>
      )}
    </FactCard>
  );
}

/** 没有写明作者时显示发布它的 namespace，例如 `@alice/luna` → `@alice`。 */
function publisherOf(ref: string): string {
  return ref.split("/")[0] ?? ref;
}

function contributorName(c: ContextIR["meta"]["contributors"][number]): string {
  return typeof c.author === "string" ? c.author : `guest · ${c.author.display_name}`;
}

/** 署名与许可：自身和每个依赖分开列，贡献者与原作者分开。 */
export function Credits({ ir }: { ir: ContextIR }) {
  const assets = ir.meta.licenses.filter((l) => l.asset);
  return (
    <FactCard id="c-attr" title="Credits & licenses">
      <ul className="space-y-3">
        {ir.meta.attribution.map((a) => {
          const license = ir.meta.licenses.find((l) => l.ref === a.ref && !l.asset);
          const node = nodeOf(ir, a.ref);
          const authors =
            a.authors.length > 0 ? a.authors.map((x) => x.name).join(", ") : publisherOf(a.ref);
          return (
            <li key={a.ref} className="flex items-start justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="block font-medium">
                  <UserText text={authors} />
                </span>
                <span className="block text-xs text-text-3">
                  {a.ref === ir.root.ref ? "Author" : "Author of"}{" "}
                  <UserText text={node?.name ?? a.ref} />
                </span>
              </span>
              {license ? (
                <span className="shrink-0 font-mono text-xs text-text-2">{license.license}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {assets.length > 0 ? (
        <div className="space-y-1 border-t pt-3">
          <h3 className="text-xs font-semibold text-text-2">Images with their own license</h3>
          <ul className="space-y-1 text-xs">
            {assets.map((l) => (
              <li key={`${l.ref}:${l.asset}`} className="flex justify-between gap-3">
                <span className="min-w-0 truncate font-mono text-text-3">{l.asset}</span>
                <span className="shrink-0 font-mono text-text-2">{l.license}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {ir.meta.contributors.length > 0 ? (
        <div className="space-y-1 border-t pt-3">
          <h3 className="text-xs font-semibold text-text-2">Contributors</h3>
          <ul className="space-y-1 text-xs">
            {ir.meta.contributors.map((c) => (
              <li
                key={`${c.ref}:${typeof c.author === "string" ? c.author : c.author.guest_id}:${c.contribution ?? ""}`}
                className="flex justify-between gap-3"
              >
                <span className="min-w-0 font-mono break-all">
                  <UserText text={contributorName(c)} />
                </span>
                <span className="shrink-0 font-mono text-text-3">{c.ref}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {ir.meta.import_omissions.length > 0 ? (
        <p className="border-t pt-3 text-xs text-text-3">
          Imported from a character card; these fields were left out:{" "}
          {ir.meta.import_omissions.flatMap((o) => o.fields).join(", ")}.
        </p>
      ) : null}
    </FactCard>
  );
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-text-3">{term}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

function shortDigest(d: string): string {
  const [algo, hex] = d.split(":");
  return hex && hex.length > 12 ? `${algo}:${hex.slice(0, 4)}…${hex.slice(-4)}` : d;
}

/** 当前版本的发布信息。 */
export function ReleaseFacts({
  ns,
  summary,
  detail,
}: {
  ns: string;
  summary: ReleaseSummary;
  detail: ReleaseDetail | undefined;
}) {
  return (
    <FactCard
      id="c-release"
      title={
        <>
          Release <span className="font-mono">{summary.label}</span>
        </>
      }
    >
      <dl className="space-y-2 text-sm">
        <Row term="Published">
          {formatDate(summary.created_at)} by @{ns}
        </Row>
        <Row term="Visibility">{summary.visibility === "private" ? "Private" : "Public"}</Row>
        {detail?.license_check ? (
          <Row term="License check">
            {detail.license_check === "pass" ? "Passed" : "Passed with warnings"}
          </Row>
        ) : null}
        {detail?.availability === "linked" ? (
          <Row term="Files">Some are linked, not stored here</Row>
        ) : null}
        <Row term="Digest">
          <span className="inline-flex items-center gap-1">
            <span className="font-mono text-xs" title={summary.semantic_digest}>
              {shortDigest(summary.semantic_digest)}
            </span>
            <CopyButton text={summary.semantic_digest} label="Copy the digest" />
          </span>
        </Row>
      </dl>
    </FactCard>
  );
}
