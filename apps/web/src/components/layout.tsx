/**
 * 全局框架：顶栏、全站提示条、主内容区、页脚，以及唯一的登录对话框。
 *
 * 主内容区默认最大宽度 1200（`max-w-[75rem]`），左右边距桌面 32、移动端 16，上下留白。
 *
 * 需要全宽的页面（例如首页的通栏区块）在路由上声明 `staticData: { fullBleed: true }`：
 *
 * ```tsx
 * export const Route = createFileRoute("/")({ staticData: { fullBleed: true }, component: Home });
 * ```
 *
 * 这时 main 不加宽度限制和内边距，页面自己用 `<Container>` 包住需要对齐内容宽度的部分：
 *
 * ```tsx
 * <section className="bg-ink text-on-ink"><Container className="py-16">…</Container></section>
 * ```
 */
import { useMatches } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { GlobalNotices } from "./notices";
import { SignInProvider } from "./sign-in";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** 页面自己控制宽度和边距（见 layout.tsx 的说明）。 */
    fullBleed?: boolean;
  }
}

/** 和主内容区同样的最大宽度与左右边距。全宽页面用它对齐内容。 */
export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("mx-auto w-full max-w-[75rem] px-4 md:px-8", className)}>{children}</div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const fullBleed = useMatches({ select: (ms) => ms.some((m) => m.staticData?.fullBleed) });
  return (
    <SignInProvider>
      <div className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-lg"
        >
          Skip to content
        </a>
        <SiteHeader />
        <GlobalNotices />
        <main
          id="main"
          className={cn(
            "flex-1",
            !fullBleed && "mx-auto w-full max-w-[75rem] px-4 py-8 md:px-8 md:py-10",
          )}
        >
          {children}
        </main>
        <SiteFooter />
      </div>
    </SignInProvider>
  );
}
