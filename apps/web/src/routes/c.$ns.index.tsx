/**
 * 作者主页 `/c/$ns`：namespace 的公开信息和它的全部公开作品。
 *
 * 先用 namespace 接口解析地址里的名字：改过名的旧名会被服务端重定向，返回新名字，这时把地址
 * 换成新名字（replace，不留下旧地址的历史记录）。再用解析出的当前 slug 按 namespace 搜索作品，
 * 搜索的 `ns` 参数只认当前 slug，不跟随旧名。
 *
 * namespace 只有 slug、类型和状态，没有简介和注册时间，页面不显示这些。统计数字只来自已经加载的
 * 搜索结果：全部加载完才显示准确的总数和按类型的计数，还有下一页时只说“多于 N 个”。
 */
import { OPEN_CREATION_TYPES } from "@char-pub/core";
import { type InfiniteData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Compass } from "lucide-react";
import { useEffect, useId, useMemo } from "react";
import { z } from "zod";
import { TYPE_STYLE } from "@/components/badges";
import { LoadMore, OPEN_TYPE_PLURAL, SearchResults } from "@/components/search-results";
import { CardGridSkeleton, PageSkeleton } from "@/components/skeletons";
import { EmptyState, ErrorState, NotFound, StatePanel } from "@/components/states";
import { buttonVariants } from "@/components/ui/button";
import { TabsNav, tabsTriggerVariants } from "@/components/ui/tabs";
import { isApiError, type Namespace, type SearchPage } from "@/lib/api";
import { keys, useMe, useRegistry } from "@/lib/registry";
import { cn } from "@/lib/utils";

const AuthorSearchSchema = z.object({
  type: z.enum(OPEN_CREATION_TYPES).optional().catch(undefined),
});
type AuthorSearch = z.infer<typeof AuthorSearchSchema>;
type OpenType = (typeof OPEN_CREATION_TYPES)[number];

export const Route = createFileRoute("/c/$ns/")({
  validateSearch: (s) => AuthorSearchSchema.parse(s),
  component: AuthorPage,
});

const PAGE_SIZE = 24;

const KIND_LABEL: Record<Namespace["kind"], string> = {
  user: "Personal namespace",
  org: "Organization",
  system: "System namespace",
};

const TABS: { value: OpenType | undefined; label: string }[] = [
  { value: undefined, label: "All creations" },
  ...OPEN_CREATION_TYPES.map((t) => ({ value: t, label: OPEN_TYPE_PLURAL[t] })),
];

function AuthorPage() {
  const { ns } = Route.useParams();
  const search = Route.useSearch();
  const client = useRegistry();
  const navigate = useNavigate();
  const namespace = useQuery({
    queryKey: ["namespace", ns],
    queryFn: () => client.namespace(ns),
  });
  const slug = namespace.data?.slug;
  const renamed = slug !== undefined && slug !== ns;

  // 旧名：服务端已经重定向到新名字，地址栏也换成新名字。
  useEffect(() => {
    if (renamed) {
      void navigate({
        to: "/c/$ns",
        params: { ns: slug },
        search: (prev: AuthorSearch) => prev,
        replace: true,
      });
    }
  }, [renamed, slug, navigate]);

  if (namespace.isPending || renamed) return <PageSkeleton label="Loading namespace…" />;
  if (namespace.isError) {
    if (isApiError(namespace.error) && namespace.error.status === 404) {
      return <NotFound what={`@${ns}`} />;
    }
    return (
      <ErrorState
        level={1}
        className="mx-auto w-full max-w-xl"
        title={`Couldn't load @${ns}`}
        error={namespace.error}
        onRetry={() => void namespace.refetch()}
      />
    );
  }
  return <Author namespace={namespace.data} type={search.type} />;
}

/** 按 namespace（和可选的类型）分页搜索作品。结果因人而异（成人内容设置），key 里带上用户。 */
function useCreations(ns: string, type: OpenType | undefined, enabled: boolean) {
  const client = useRegistry();
  const me = useMe();
  return useInfiniteQuery<
    SearchPage,
    Error,
    InfiniteData<SearchPage, string | undefined>,
    readonly unknown[],
    string | undefined
  >({
    queryKey: keys.search({ ns, type, user: me.data?.id ?? null }),
    queryFn: ({ pageParam }) => client.search({ ns, type, cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: enabled && !me.isPending,
  });
}

function Author({ namespace, type }: { namespace: Namespace; type: OpenType | undefined }) {
  const { slug } = namespace;
  const active = namespace.status === "active";
  const me = useMe();
  const ids = { list: useId() };
  // 统计总是来自不带类型筛选的列表；选了类型时另外查一份筛选后的列表来显示。
  const all = useCreations(slug, undefined, active);
  const filtered = useCreations(slug, type, active && type !== undefined);
  const shown = type ? filtered : all;

  const allItems = useMemo(() => all.data?.pages.flatMap((p) => p.items) ?? [], [all.data]);
  const items = useMemo(
    () => (type ? (filtered.data?.pages.flatMap((p) => p.items) ?? []) : allItems),
    [type, filtered.data, allItems],
  );
  const complete = all.data !== undefined && !all.hasNextPage;
  const byType = useMemo(() => {
    const counts = new Map<OpenType, number>();
    for (const item of allItems) {
      const t = item.type as OpenType;
      if (OPEN_CREATION_TYPES.includes(t)) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return counts;
  }, [allItems]);
  const showsMature = me.data?.settings.show_mature ?? false;

  const total = allItems.length;
  const totalText = !all.data
    ? null
    : complete
      ? `${total} public ${total === 1 ? "creation" : "creations"}`
      : `More than ${total} public creations`;

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-1.5 text-sm text-text-2">
          <li>
            <Link to="/browse" className="hover:text-text hover:underline underline-offset-4">
              Explore
            </Link>
          </li>
          <li aria-hidden>
            <ChevronRight className="size-3.5 text-text-3" />
          </li>
          <li aria-current="page" className="font-medium break-all text-text">
            @{slug}
          </li>
        </ol>
      </nav>

      <header className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <span
          aria-hidden
          className="flex size-16 shrink-0 items-center justify-center rounded-full bg-purple-soft text-2xl font-bold text-purple-text md:size-20 md:text-3xl"
        >
          {[...slug][0]?.toUpperCase()}
        </span>
        <div className="min-w-0 space-y-1.5">
          <h1 className="font-mono text-3xl font-semibold tracking-normal break-all md:text-4xl">
            @{slug}
          </h1>
          <p className="text-sm text-text-2">
            {KIND_LABEL[namespace.kind]}
            {totalText ? <> · {totalText}</> : null}
          </p>
        </div>
      </header>

      {!active ? (
        <StatePanel
          title={`@${slug} is suspended`}
          description="Creations from this namespace aren't listed while it is suspended."
        >
          <Link to="/browse" className={buttonVariants({ variant: "outline" })}>
            <Compass aria-hidden /> Explore the registry
          </Link>
        </StatePanel>
      ) : (
        <>
          {complete && byType.size > 0 ? (
            <ul aria-label="Creations by type" className="flex flex-wrap gap-2">
              {OPEN_CREATION_TYPES.filter((t) => byType.has(t)).map((t) => {
                const n = byType.get(t) ?? 0;
                return (
                  <li
                    key={t}
                    className="inline-flex items-center gap-2 rounded-md border bg-surface px-3 py-1.5 text-sm"
                  >
                    <span aria-hidden className={cn("size-2 rounded-full", TYPE_STYLE[t].dot)} />
                    <span className="font-bold">{n}</span>
                    <span className="text-text-2">
                      {n === 1 ? TYPE_STYLE[t].label : OPEN_TYPE_PLURAL[t]}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}

          <section aria-labelledby={ids.list} className="space-y-6">
            <h2 id={ids.list} className="sr-only">
              Creations
            </h2>
            <TabsNav aria-label="Filter by type">
              {TABS.map((t) => (
                <Link
                  key={t.label}
                  to="/c/$ns"
                  params={{ ns: slug }}
                  search={t.value ? { type: t.value } : {}}
                  activeOptions={{ exact: true, includeSearch: true }}
                  className={tabsTriggerVariants()}
                >
                  {t.label}
                </Link>
              ))}
            </TabsNav>

            {shown.isPending ? (
              <CardGridSkeleton count={8} label="Loading creations…" />
            ) : !shown.data ? (
              <ErrorState
                title="Couldn't load these creations"
                description="The registry didn't respond. Try again in a moment."
                error={shown.error}
                onRetry={() => void shown.refetch()}
              />
            ) : (
              <SearchResults
                items={items}
                label={`Creations by @${slug}`}
                empty={
                  type ? (
                    <EmptyState
                      title={`No ${OPEN_TYPE_PLURAL[type].toLowerCase()} from @${slug}`}
                      description="Try another type, or look at everything they've published."
                      action={
                        <Link
                          to="/c/$ns"
                          params={{ ns: slug }}
                          search={{}}
                          className={buttonVariants({ variant: "outline" })}
                        >
                          Show all creations
                        </Link>
                      }
                    />
                  ) : (
                    <EmptyState
                      title={`No public creations from @${slug} yet`}
                      description={
                        showsMature
                          ? "Public releases from this namespace will show up here."
                          : "Public releases from this namespace will show up here. Mature and explicit creations stay hidden unless you turn them on."
                      }
                      action={
                        <Link to="/browse" className={buttonVariants({ variant: "outline" })}>
                          <Compass aria-hidden /> Explore the registry
                        </Link>
                      }
                    />
                  )
                }
              />
            )}
            <LoadMore query={shown} />
          </section>
        </>
      )}
    </div>
  );
}
