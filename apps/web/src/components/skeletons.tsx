/**
 * 常用的加载骨架。骨架要保持最终布局（卡片网格、列表、详情页），不再只显示一行 “Loading…”。
 * 每个骨架都是 `role="status"`，读屏会读出 `label`（默认 “Loading…”）。
 */
import type * as React from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "./ui/skeleton";

function Status({
  label = "Loading…",
  className,
  children,
}: {
  label?: string | undefined;
  className?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** 一张作品卡片的骨架：头像、名字、ref、两行简介、徽章。 */
export function CreationCardSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("space-y-4 rounded-lg border bg-surface p-4", className)}>
      <div className="flex items-center gap-3">
        <Skeleton className="size-12 rounded-md" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <div className="space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
    </div>
  );
}

/** 作品卡片网格（首页、探索页、作者主页）。列数和真实网格一致：窄屏 1 列，最多 4 列。 */
export function CardGridSkeleton({
  count = 8,
  label,
  className,
}: {
  count?: number;
  label?: string;
  className?: string;
}) {
  return (
    <Status
      label={label}
      className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4", className)}
    >
      {Array.from({ length: count }, (_, i) => (
        <CreationCardSkeleton key={i} />
      ))}
    </Status>
  );
}

/** 列表的骨架（我的作品、贡献、版本、Token）：每行一个图标位加两行文字。 */
export function ListSkeleton({
  rows = 3,
  label,
  className,
}: {
  rows?: number;
  label?: string;
  className?: string;
}) {
  return (
    <Status label={label} className={cn("space-y-3", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          aria-hidden
          className="flex items-center gap-4 rounded-lg border bg-surface p-4"
        >
          <Skeleton className="size-10 shrink-0 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </Status>
  );
}

/** 详情页的骨架（作品页、设置页）：标题区加一块内容卡片。 */
export function PageSkeleton({ label, className }: { label?: string; className?: string }) {
  return (
    <Status label={label} className={cn("space-y-8", className)}>
      <div aria-hidden className="flex items-start gap-4">
        <Skeleton className="size-20 shrink-0 rounded-lg" />
        <div className="flex-1 space-y-3 pt-1">
          <Skeleton className="h-7 w-1/3" />
          <Skeleton className="h-4 w-1/4" />
          <div className="flex gap-2">
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </div>
      </div>
      <div aria-hidden className="space-y-3 rounded-lg border bg-surface p-5">
        <Skeleton className="h-4 w-1/4" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-11/12" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    </Status>
  );
}
