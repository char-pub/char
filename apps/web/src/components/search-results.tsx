/**
 * 作品卡片网格：探索页、首页的最新作品、作者主页共用。窄屏 1 列，平板 2 列，桌面 3 到 4 列，
 * 和 `CardGridSkeleton` 的列数一致，加载前后布局不跳动。
 * 成人内容由服务端按账号设置过滤，这里不再做任何判断。
 */
import type { OPEN_CREATION_TYPES } from "@char-pub/core";
import { ChevronsDown } from "lucide-react";
import type * as React from "react";
import type { CreationSummary } from "@/lib/api";
import { cn } from "@/lib/utils";
import { CreationCard } from "./creation-card";
import { EmptyState } from "./states";
import { Button } from "./ui/button";

/** 开放创作的三种类型的复数名称，用于类型筛选（All / Characters / Worlds / Lorebooks）。 */
export const OPEN_TYPE_PLURAL: Record<(typeof OPEN_CREATION_TYPES)[number], string> = {
  character: "Characters",
  world: "Worlds",
  lorebook: "Lorebooks",
};

export const CARD_GRID_CLASS = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

export function SearchResults({
  items,
  label = "Search results",
  empty,
  className,
}: {
  items: readonly CreationSummary[];
  /** 列表的无障碍名称。 */
  label?: string;
  /** 没有结果时显示的内容；默认是一句通用说明。 */
  empty?: React.ReactNode;
  className?: string;
}) {
  if (items.length === 0) {
    return (
      empty ?? (
        <EmptyState
          title="Nothing matches yet"
          description="Try a shorter query or remove a filter."
        />
      )
    );
  }
  return (
    <ul className={cn(CARD_GRID_CLASS, className)} aria-label={label}>
      {items.map((c) => (
        <li key={c.id} className="min-w-0">
          <CreationCard item={c} />
        </li>
      ))}
    </ul>
  );
}

/**
 * 网格下方的“加载更多”。没有下一页时不显示；加载下一页失败时在按钮上方说明，
 * 已经加载的结果保留，再点一次就是重试。参数直接传 `useInfiniteQuery` 的结果。
 */
export function LoadMore({
  query,
  className,
}: {
  query: {
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    isFetchNextPageError: boolean;
    fetchNextPage: () => Promise<unknown>;
  };
  className?: string;
}) {
  if (!query.hasNextPage) return null;
  return (
    <div className={cn("flex flex-col items-center gap-2 pt-4", className)}>
      {query.isFetchNextPageError ? (
        <p role="alert" className="text-sm text-danger">
          Couldn't load more. Try again.
        </p>
      ) : null}
      <Button
        variant="outline"
        disabled={query.isFetchingNextPage}
        onClick={() => void query.fetchNextPage()}
      >
        <ChevronsDown aria-hidden />
        {query.isFetchingNextPage ? "Loading…" : "Load more"}
      </Button>
    </div>
  );
}
