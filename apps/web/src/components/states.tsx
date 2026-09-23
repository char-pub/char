/**
 * 每个数据页面都要有的状态：空、出错、功能暂停、不存在（404）、已移除（410）、渲染出错。
 *
 * 统一的外观是一块居中的面板：图标（浅底圆形）、标题、一句说明、下一步操作。
 * 所有状态都只说“接下来可以做什么”，不暴露内部错误信息。
 */
import { Link, useRouter } from "@tanstack/react-router";
import { ArchiveX, Compass, RefreshCw, SearchX, TriangleAlert, Wrench } from "lucide-react";
import type * as React from "react";
import { isApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "./ui/button";

type Tone = "neutral" | "primary" | "danger" | "warning" | "blue";

const TONE: Record<Tone, string> = {
  neutral: "bg-surface-2 text-text-2",
  primary: "bg-primary-soft text-primary-text",
  danger: "bg-danger-soft text-danger",
  warning: "bg-warning-soft text-warning",
  blue: "bg-blue-soft text-blue-text",
};

export interface StatePanelProps {
  icon?: React.ComponentType<{ className?: string }>;
  tone?: Tone;
  /** 图标位置换成一段等宽大字（例如 404）。 */
  code?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** 按钮、链接等下一步操作。 */
  children?: React.ReactNode;
  /** 整页状态用 1（页面的主标题），页面里的一块区域用 2。 */
  level?: 1 | 2;
  /** 默认是带边框的面板；放进已有卡片里时传 `false`。 */
  bordered?: boolean;
  className?: string | undefined;
}

/** 状态面板的基础组件。页面一般用下面的 EmptyState / ErrorState / NotFound。 */
export function StatePanel({
  icon: Icon,
  tone = "neutral",
  code,
  title,
  description,
  children,
  level = 2,
  bordered = true,
  className,
}: StatePanelProps) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <section
      className={cn(
        "flex flex-col items-center gap-3 px-6 py-10 text-center",
        bordered && "rounded-lg border bg-surface",
        className,
      )}
    >
      {code ? (
        <p aria-hidden className="font-mono text-5xl leading-none font-medium text-border-strong">
          {code}
        </p>
      ) : Icon ? (
        <span
          aria-hidden
          className={cn("flex size-12 items-center justify-center rounded-full", TONE[tone])}
        >
          <Icon className="size-5" />
        </span>
      ) : null}
      <Heading className="max-w-prose text-lg font-bold text-balance">{title}</Heading>
      {description ? (
        <div className="max-w-prose text-sm text-pretty text-text-2">{description}</div>
      ) : null}
      {children ? (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{children}</div>
      ) : null}
    </section>
  );
}

/**
 * 空状态：一句说明加下一步操作（新建、导入、清除筛选、去 Playground）。
 *
 * ```tsx
 * <EmptyState title="No creations yet" description="Start with a character." action={<Button>…</Button>} />
 * ```
 */
export function EmptyState({
  icon = SearchX,
  action,
  ...props
}: Omit<StatePanelProps, "children" | "tone" | "code"> & { action?: React.ReactNode }) {
  return (
    <StatePanel icon={icon} tone="neutral" {...props}>
      {action}
    </StatePanel>
  );
}

/** 服务端关闭了某项功能（kill switch）或全站只读：显示成“暂时不可用”，不是普通错误。 */
export function isPausedError(error: unknown): boolean {
  return isApiError(error, "feature.disabled") || isApiError(error, "feature.read_only");
}

/**
 * 出错状态：说明发生了什么，并提供重试。传入 `error` 时，功能暂停类的错误会自动换成
 * “暂时不可用”的说法；ApiError 的错误码以等宽小字显示，方便用户反馈问题。
 *
 * ```tsx
 * <ErrorState title="Search is unavailable right now" description="Your filters are kept." onRetry={() => q.refetch()} />
 * ```
 */
export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load this. Check your connection and try again.",
  error,
  onRetry,
  retryLabel = "Try again",
  action,
  ...props
}: Omit<StatePanelProps, "children" | "tone" | "code" | "title"> & {
  title?: React.ReactNode;
  error?: unknown;
  onRetry?: () => void;
  retryLabel?: string;
  /** 重试之外的其他操作。 */
  action?: React.ReactNode;
}) {
  const paused = isPausedError(error);
  const code = isApiError(error) ? error.code : null;
  return (
    <StatePanel
      icon={paused ? Wrench : TriangleAlert}
      tone={paused ? "blue" : "warning"}
      title={paused ? "Temporarily unavailable" : title}
      description={
        <>
          <p>
            {paused
              ? "This part of char.pub is paused for the moment. Everything you can read is still available."
              : description}
          </p>
          {code ? <p className="mt-2 font-mono text-xs text-text-3">{code}</p> : null}
        </>
      }
      {...props}
    >
      {onRetry ? (
        <Button variant="outline" onClick={onRetry}>
          <RefreshCw aria-hidden /> {retryLabel}
        </Button>
      ) : null}
      {action}
    </StatePanel>
  );
}

/**
 * 统一的 404。私有资源和不存在的资源用同一个页面，文案不能暗示“存在但你没有权限”。
 * `what` 是用户要找的东西（例如 `@djj/unknown`），以等宽字体显示。
 */
export function NotFound({
  what,
  description = "It may have moved, or the address is wrong.",
  level = 1,
  className,
}: {
  what?: string;
  description?: React.ReactNode;
  level?: 1 | 2;
  className?: string;
}) {
  return (
    <StatePanel
      code="404"
      level={level}
      className={cn("mx-auto w-full max-w-xl", className)}
      title={
        what ? (
          <>
            Nothing at <span className="font-mono break-all">{what}</span>
          </>
        ) : (
          "Page not found"
        )
      }
      description={description}
    >
      <Link to="/browse" className={buttonVariants({ variant: "outline" })}>
        <Compass aria-hidden /> Explore the registry
      </Link>
    </StatePanel>
  );
}

/**
 * 410：内容已被移除（版本 tombstoned、作品下架）。只显示公开的原因代码（例如 `legal.dmca`），
 * `action` 放“查看其他版本”之类的下一步。
 */
export function RemovedState({
  title = "This version was removed",
  reason,
  action,
  level = 2,
  className,
}: {
  title?: React.ReactNode;
  reason?: string | null;
  action?: React.ReactNode;
  level?: 1 | 2;
  className?: string;
}) {
  return (
    <StatePanel
      icon={ArchiveX}
      tone="danger"
      level={level}
      className={className}
      title={title}
      description={
        <>
          {reason ? (
            <>
              Reason: <span className="font-mono">{reason}</span>.{" "}
            </>
          ) : null}
          Other versions may still be available.
        </>
      }
    >
      {action}
    </StatePanel>
  );
}

/**
 * 路由渲染出错时的兜底（router 的 defaultErrorComponent）：显示在顶栏和页脚之间，
 * 可以重试这一页，也可以整页重新加载。
 */
export function RouteError({ error, reset }: { error: unknown; reset?: () => void }) {
  const router = useRouter();
  return (
    <ErrorState
      level={1}
      className="mx-auto w-full max-w-xl"
      title="This page ran into a problem"
      description="Something broke while showing this page. Try again, or reload the page."
      error={error}
      onRetry={() => {
        reset?.();
        void router.invalidate();
      }}
      action={
        <Button variant="ghost" onClick={() => window.location.reload()}>
          Reload the page
        </Button>
      }
    />
  );
}

/**
 * 根路由出错时的整页兜底：顶栏和页脚本身也没能渲染，所以这里不依赖 Layout、路由上下文
 * 和数据查询，只提供重新加载。
 */
export function AppCrash() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <StatePanel
        level={1}
        className="w-full max-w-md"
        title="char.pub ran into a problem"
        description="Something broke while loading the page. Reloading usually fixes it."
      >
        <Button onClick={() => window.location.reload()}>
          <RefreshCw aria-hidden /> Reload
        </Button>
        {/* 普通链接而不是路由 Link：路由本身可能就是出错的地方。 */}
        <a href="/" className={buttonVariants({ variant: "ghost" })}>
          Go to the home page
        </a>
      </StatePanel>
    </main>
  );
}
