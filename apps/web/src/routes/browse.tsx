import { OPEN_CREATION_TYPES } from "@char-pub/core";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff, Plus, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { z } from "zod";
import { TYPE_STYLE } from "@/components/badges";
import { LoadMore, OPEN_TYPE_PLURAL, SearchResults } from "@/components/search-results";
import { SignInButton } from "@/components/sign-in";
import { CardGridSkeleton } from "@/components/skeletons";
import { EmptyState, ErrorState } from "@/components/states";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CreationSummary, Me } from "@/lib/api";
import { keys, useMe, useRegistry } from "@/lib/registry";
import { cn } from "@/lib/utils";

const BrowseSearchSchema = z.object({
  q: z.string().max(200).optional().catch(undefined),
  type: z.enum(OPEN_CREATION_TYPES).optional().catch(undefined),
  tag: z.string().max(64).optional().catch(undefined),
});
type BrowseSearch = z.infer<typeof BrowseSearchSchema>;

export const Route = createFileRoute("/browse")({
  validateSearch: (s) => BrowseSearchSchema.parse(s),
  component: Browse,
});

const PAGE_SIZE = 24;
/** tag 行最多列出几个建议 tag。 */
const MAX_TAG_SUGGESTIONS = 8;

const TYPE_FILTERS: { value: BrowseSearch["type"]; label: string }[] = [
  { value: undefined, label: "All" },
  ...OPEN_CREATION_TYPES.map((t) => ({ value: t, label: OPEN_TYPE_PLURAL[t] })),
];

/**
 * 建议的 tag：统计已加载结果里出现最多的 tag（次数相同按字母序）。服务端没有“热门 tag”接口，
 * 这里只从当前结果里取，点击后替换当前的 tag 筛选（一次只按一个 tag 筛选）。
 */
function suggestTags(items: readonly CreationSummary[], selected: string | undefined): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const t of item.tags) if (t !== selected) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_TAG_SUGGESTIONS)
    .map(([t]) => t);
}

/**
 * 结果计数。搜索接口不返回总数，所以还有下一页时只说“已显示前 N 个”，不编造总数。
 */
function resultCount(n: number, more: boolean, search: BrowseSearch): string {
  let text = more ? `Showing the first ${n} results` : `${n} ${n === 1 ? "result" : "results"}`;
  const q = search.q?.trim();
  if (q) text += ` for “${q}”`;
  if (search.tag) text += ` tagged “${search.tag}”`;
  return text;
}

/** 没有结果时的建议，例如 “Try using fewer words, removing the “Worlds” filter, or checking the spelling.” */
function emptyHint(search: BrowseSearch): string {
  const q = search.q?.trim();
  const parts: string[] = [];
  if (q) parts.push("using fewer words");
  if (search.type) parts.push(`removing the “${OPEN_TYPE_PLURAL[search.type]}” filter`);
  if (search.tag) parts.push(`removing the “${search.tag}” tag`);
  if (q) parts.push("checking the spelling");
  if (parts.length <= 2) return `Try ${parts.join(" or ")}.`;
  return `Try ${parts.slice(0, -1).join(", ")}, or ${parts.at(-1)}.`;
}

function Browse() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/browse" });
  const client = useRegistry();
  const me = useMe();
  const [q, setQ] = useState(search.q ?? "");
  const ids = { q: useId(), results: useId() };
  useEffect(() => setQ(search.q ?? ""), [search.q]);

  const set = (patch: Partial<BrowseSearch>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }) });
  const clearFilters = () => {
    setQ("");
    void navigate({ search: {} });
  };

  const results = useInfiniteQuery({
    queryKey: keys.search({ ...search, user: me.data?.id ?? null }),
    queryFn: ({ pageParam }) =>
      client.search({
        q: search.q?.trim() || undefined,
        type: search.type,
        tag: search.tag,
        cursor: pageParam,
        limit: PAGE_SIZE,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: !me.isPending,
  });
  const items = useMemo(() => results.data?.pages.flatMap((p) => p.items) ?? [], [results.data]);
  const tags = useMemo(() => suggestTags(items, search.tag), [items, search.tag]);
  const hasFilters = Boolean(search.q?.trim() || search.type || search.tag);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-4xl">Explore</h1>
        <p className="max-w-2xl text-text-2">
          Characters, worlds and lorebooks published on char.pub.
        </p>
      </header>

      <div className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <search aria-label="Creations" className="relative block min-w-0 flex-1">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void set({ q: q.trim() || undefined });
              }}
            >
              <label htmlFor={ids.q} className="sr-only">
                Search creations
              </label>
              <Search
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-text-3"
              />
              <Input
                id={ids.q}
                type="search"
                value={q}
                maxLength={200}
                enterKeyHint="search"
                placeholder="Name, summary, tag or @namespace"
                className="h-12 pl-11 md:text-base"
                onChange={(e) => setQ(e.target.value)}
              />
            </form>
          </search>
          <TypeFilter value={search.type} onChange={(type) => void set({ type })} />
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          {search.tag || tags.length > 0 ? (
            <fieldset>
              <legend className="sr-only">Filter by tag</legend>
              <div className="flex flex-wrap items-center gap-1.5">
                <span aria-hidden className="mr-1 text-sm text-text-2">
                  Tags
                </span>
                {search.tag ? (
                  <span className="inline-flex max-w-full items-center gap-1 rounded-sm bg-ink py-0.5 pr-1 pl-2 text-xs font-medium text-on-ink">
                    <span className="truncate">{search.tag}</span>
                    <button
                      type="button"
                      aria-label={`Remove the tag filter “${search.tag}”`}
                      className="flex size-4 items-center justify-center rounded-sm hover:bg-on-ink/20"
                      onClick={() => void set({ tag: undefined })}
                    >
                      <X aria-hidden className="size-3" />
                    </button>
                  </span>
                ) : null}
                {tags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="inline-flex max-w-full items-center truncate rounded-sm bg-surface-2 px-2 py-0.5 text-xs font-medium text-text-2 transition-colors hover:bg-border hover:text-text"
                    onClick={() => void set({ tag: t })}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}
          <MatureNote me={me.data ?? null} pending={me.isPending} className="ml-auto" />
        </div>
      </div>

      <section aria-labelledby={ids.results} className="space-y-4">
        <h2 id={ids.results} className="sr-only">
          Results
        </h2>
        {results.data && items.length > 0 ? (
          <p aria-live="polite" className="text-sm text-text-2">
            {resultCount(items.length, results.hasNextPage, search)}
          </p>
        ) : null}

        {results.isPending ? (
          <CardGridSkeleton count={8} label="Searching…" />
        ) : !results.data ? (
          <ErrorState
            title="Search is unavailable right now"
            description="We couldn't reach the registry. Your filters are kept."
            error={results.error}
            onRetry={() => void results.refetch()}
          />
        ) : (
          <SearchResults
            items={items}
            empty={
              hasFilters ? (
                <EmptyState
                  title={
                    search.q?.trim()
                      ? `No results for “${search.q.trim()}”`
                      : "Nothing matches these filters"
                  }
                  description={emptyHint(search)}
                  action={
                    <Button variant="outline" onClick={clearFilters}>
                      <X aria-hidden /> Clear filters
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  title="Nothing published yet"
                  description="Be the first to publish a character, world or lorebook."
                  action={
                    <Link to="/create" className={buttonVariants()}>
                      <Plus aria-hidden /> Start creating
                    </Link>
                  }
                />
              )
            }
          />
        )}

        <LoadMore query={results} />
      </section>
    </div>
  );
}

/** 类型分段切换：All / Characters / Worlds / Lorebooks，选中项白底。 */
function TypeFilter({
  value,
  onChange,
}: {
  value: BrowseSearch["type"];
  onChange: (type: BrowseSearch["type"]) => void;
}) {
  return (
    <fieldset className="min-w-0 shrink-0">
      <legend className="sr-only">Creation type</legend>
      <div className="flex gap-1 overflow-x-auto rounded-md bg-surface-2 p-1 [scrollbar-width:none]">
        {TYPE_FILTERS.map((f) => {
          const active = f.value === value;
          return (
            <button
              key={f.label}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(f.value)}
              className={cn(
                "inline-flex h-10 shrink-0 grow items-center justify-center gap-1.5 rounded-sm border border-transparent px-2 text-sm font-medium whitespace-nowrap transition-colors sm:gap-2 sm:px-3 lg:grow-0",
                active ? "border-border bg-surface text-text" : "text-text-2 hover:text-text",
              )}
            >
              {f.value ? (
                <span aria-hidden className={cn("size-2 rounded-full", TYPE_STYLE[f.value].dot)} />
              ) : null}
              {f.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * 成人内容说明：默认隐藏 mature / explicit，并告诉用户去哪里开启。登录用户链接到设置页；
 * 未登录时直接给登录入口，因为只有登录并确认满 18 岁的账号才能开启。
 */
function MatureNote({
  me,
  pending,
  className,
}: {
  me: Me | null;
  pending: boolean;
  className?: string;
}) {
  if (pending) return null;
  const shown = me?.settings.show_mature ?? false;
  const Icon = shown ? Eye : EyeOff;
  return (
    <p className={cn("flex flex-wrap items-center gap-x-1.5 text-sm text-text-2", className)}>
      <Icon aria-hidden className="size-4 text-text-3" />
      {shown
        ? "Mature and explicit creations are shown."
        : "Mature and explicit creations are hidden."}
      {me ? (
        <Link
          to="/settings"
          className="font-medium text-blue-text underline-offset-4 hover:underline"
        >
          Change in settings
        </Link>
      ) : (
        <SignInButton variant="link" className="h-auto p-0 font-medium">
          Sign in to turn them on
        </SignInButton>
      )}
    </p>
  );
}
