import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { Layout } from "@/components/layout";
import { AppCrash, NotFound } from "@/components/states";
import { Toaster } from "@/components/ui/sonner";

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <>
      <Layout>
        <Outlet />
      </Layout>
      <Toaster />
    </>
  ),
  // 地址不存在，或者页面抛出 notFound()：渲染在顶栏和页脚之间。
  notFoundComponent: () => <NotFound />,
  // 根路由自己出错时顶栏和页脚也没有渲染出来，所以是不依赖 Layout 的整页兜底；
  // 子路由的渲染错误由 main.tsx 里的 defaultErrorComponent 在页面内容区显示。
  errorComponent: AppCrash,
});
