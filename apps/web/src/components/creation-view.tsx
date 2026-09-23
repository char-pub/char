/**
 * 线上作品页：Registry 的 Creation 详情加上所选 Release 的 Context IR。
 *
 * - effective rating 取依赖闭包与 asset 中的最高值，旁边列出每个来源；
 * - 成人内容默认遮挡，账号开启“显示成人内容”后直接显示；
 * - yanked 的版本给出警告，tombstoned 的版本只显示公开的原因代码；
 * - 依赖（锁定到精确 Release）、被谁依赖、署名与贡献者、版本列表、下载。
 */
import type { ContextIR, Rating } from "@char-pub/core";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, GitPullRequestArrow, Pencil } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import type { CreationDetail, Dependent, ReleaseDetail } from "@/lib/api";
import { localized, parseRef } from "@/lib/text";
import { BuiltOn, Credits, IRFragments } from "./creation-page";
import { Downloads } from "./downloads";
import { MatureGate } from "./mature-gate";
import { isAdultRating, RATING_LABEL, RatingBadge, RatingSources } from "./rating";
import { ReleaseList, tombstoneText } from "./release-list";
import { UserText } from "./user-content";

export interface CreationViewProps {
  ns: string;
  name: string;
  detail: CreationDetail;
  label: string | undefined;
  onSelectLabel: (label: string) => void;
  release: ReleaseDetail | undefined;
  /** 所选 Release 已被移除时的原因代码。 */
  tombstoned: { reason: string } | null;
  ir: ContextIR | undefined;
  irState: "loading" | "ready" | "error" | "none";
  dependents: readonly Dependent[] | undefined;
  allowMature: boolean;
  canEdit: boolean;
}

function DependentsList({ items }: { items: readonly Dependent[] | undefined }) {
  return (
    <section aria-labelledby="c-used" className="space-y-2">
      <h2 id="c-used" className="text-xl">
        Used by
      </h2>
      {!items || items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No public creation depends on this yet.</p>
      ) : (
        <ul className="divide-y divide-rule border-y border-rule">
          {items.map((d) => {
            const r = parseRef(d.ref);
            return (
              <li key={`${d.ref}@${d.release.label}`} className="py-2 text-sm">
                {r ? (
                  <Link to="/c/$ns/$name" params={r} className="underline-offset-4 hover:underline">
                    <UserText text={localized(d.display_name)} />
                  </Link>
                ) : (
                  <UserText text={localized(d.display_name)} />
                )}
                <span className="block font-mono text-xs text-muted-foreground">
                  {d.ref}@{d.release.label} · {d.mode}
                  {d.rel ? ` · ${d.rel}` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function CreationView(p: CreationViewProps) {
  const { detail, ir } = p;
  const rating: Rating =
    ir?.meta.rating ?? p.release?.effective_rating ?? detail.effective_rating ?? detail.rating;
  const title = localized(detail.display_name);
  const selected = detail.releases.find((r) => r.label === p.label);
  const warning =
    p.release?.warning ?? (selected?.status === "yanked" ? detail.warning : undefined);
  // 头像只显示作品自己的、有公共地址的图片（public + mirrored）。
  const avatar = ir?.assets.find(
    (a) => a.origin.creation === ir.root.ref && a.origin.slot === "avatar" && a.url,
  );

  return (
    <article className="grid gap-10 lg:grid-cols-[1fr_20rem]">
      <div className="min-w-0 space-y-6">
        <header className="space-y-2">
          {avatar?.url && (!isAdultRating(avatar.rating) || p.allowMature) ? (
            <img
              src={avatar.url}
              alt={avatar.alt ?? ""}
              className="size-28 rounded-sm border border-rule object-cover"
            />
          ) : null}
          <p className="font-mono text-sm text-muted-foreground">
            {detail.ref}
            {p.label ? `@${p.label}` : ""}
          </p>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <h1 className="text-5xl">
              <UserText text={title} />
            </h1>
            <div className="flex flex-wrap gap-2">
              {p.canEdit || detail.latest_release ? (
                <Link
                  to="/c/$ns/$name/contributions"
                  params={{ ns: p.ns, name: p.name }}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  <GitPullRequestArrow aria-hidden /> Contributions
                </Link>
              ) : null}
              {p.canEdit ? (
                <Link
                  to="/c/$ns/$name/edit"
                  params={{ ns: p.ns, name: p.name }}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  <Pencil aria-hidden /> Edit
                </Link>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RatingBadge rating={rating} />
            <span className="stamp border-rule">{detail.type}</span>
            {ir?.meta.content_warnings.map((w) => (
              <span key={w} className="stamp border-amber/60 bg-amber-soft">
                {w}
              </span>
            ))}
          </div>
          {detail.summary ? (
            <p className="max-w-prose text-lg text-muted-foreground">
              <UserText text={localized(detail.summary)} />
            </p>
          ) : null}
        </header>

        {warning ? (
          <p
            role="note"
            className="flex items-start gap-2 rounded-sm border border-amber/60 bg-amber-soft px-4 py-2 text-sm"
          >
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>
              <UserText text={warning} />. Creations that already lock this version keep working,
              but new work should use another one.
            </span>
          </p>
        ) : null}

        {p.tombstoned ? (
          <section className="catalog-card space-y-1 p-6 pl-8" aria-labelledby="c-gone">
            <h2 id="c-gone" className="font-display text-xl">
              This version is no longer available
            </h2>
            <p className="text-sm text-muted-foreground">
              It was {tombstoneText(p.tombstoned.reason)}.{" "}
              <span className="font-mono text-xs">({p.tombstoned.reason})</span>
            </p>
          </section>
        ) : !p.label ? (
          <p className="text-muted-foreground">This creation has no published release yet.</p>
        ) : (
          <MatureGate rating={rating} allowed={p.allowMature}>
            {ir ? (
              <IRFragments ir={ir} />
            ) : p.irState === "error" ? (
              <p role="alert" className="text-sm text-seal">
                The context for this release could not be loaded.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Loading the context…</p>
            )}
          </MatureGate>
        )}
      </div>

      <aside className="space-y-8">
        <section aria-labelledby="c-rating" className="space-y-2">
          <h2 id="c-rating" className="text-xl">
            Why this rating
          </h2>
          {ir ? (
            <RatingSources meta={ir.meta} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Rated {RATING_LABEL[rating]}: the highest rating found in the creation, its
              dependencies and its assets.
            </p>
          )}
        </section>
        {ir ? <BuiltOn ir={ir} /> : null}
        <DependentsList items={p.dependents} />
        {ir ? <Credits ir={ir} /> : null}
        <section aria-labelledby="c-versions" className="space-y-2">
          <h2 id="c-versions" className="text-xl">
            Versions
          </h2>
          <ReleaseList releases={detail.releases} selected={p.label} onSelect={p.onSelectLabel} />
        </section>
        {p.label && !p.tombstoned ? (
          <Downloads
            ns={p.ns}
            name={p.name}
            label={p.label}
            canExportCard={detail.type === "character"}
          />
        ) : null}
      </aside>
    </article>
  );
}
