/**
 * 搜索结果列表。每一项显示名字、`@ns/name`、类型、effective rating 与简介。
 * 成人内容由服务端按账号设置过滤，这里不再做任何判断。
 */
import { Link } from "@tanstack/react-router";
import type { CreationSummary } from "@/lib/api";
import { localized, parseRef } from "@/lib/text";
import { RatingBadge } from "./rating";
import { UserText } from "./user-content";

export function SearchResults({ items }: { items: readonly CreationSummary[] }) {
  if (items.length === 0) {
    return (
      <p className="py-10 text-center text-muted-foreground">
        Nothing matches yet. Try a shorter query or remove a filter.
      </p>
    );
  }
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Search results">
      {items.map((c) => {
        const r = parseRef(c.ref);
        const title = localized(c.display_name);
        return (
          <li key={c.id} className="catalog-card flex flex-col gap-2 p-4 pl-8">
            <div className="flex items-start justify-between gap-2">
              {r ? (
                <Link
                  to="/c/$ns/$name"
                  params={r}
                  className="font-display text-xl leading-tight underline-offset-4 hover:underline"
                >
                  <UserText text={title} />
                </Link>
              ) : (
                <span className="font-display text-xl">
                  <UserText text={title} />
                </span>
              )}
              <RatingBadge rating={c.effective_rating ?? c.rating} />
            </div>
            <p className="font-mono text-xs text-muted-foreground">
              {c.ref}
              {c.latest_release ? ` · ${c.latest_release.label}` : ""}
            </p>
            {c.summary ? (
              <p className="line-clamp-3 text-sm text-muted-foreground">
                <UserText text={localized(c.summary)} />
              </p>
            ) : null}
            <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
              <span className="stamp border-rule">{c.type}</span>
              {c.tags.slice(0, 4).map((t) => (
                <Link
                  key={t}
                  to="/browse"
                  search={{ tag: t }}
                  className="stamp border-rule text-muted-foreground hover:text-foreground"
                >
                  #{t}
                </Link>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
