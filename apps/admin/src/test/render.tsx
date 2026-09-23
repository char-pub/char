/** 组件测试的渲染工具：注入 mock API、QueryClient 与一个内存路由（组件中的 Link 需要路由上下文）。 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { type RenderResult, render } from "@testing-library/react";
import type { ReactElement } from "react";
import type { AdminApi } from "@/lib/api";
import { ApiProvider } from "@/lib/context";
import { createMockApi, type MockOptions } from "@/lib/mock-api";

export function renderWithApi(
  ui: ReactElement,
  opts: MockOptions & { api?: AdminApi } = {},
): RenderResult & { api: AdminApi } {
  const api = opts.api ?? createMockApi(opts);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree: createRootRoute({ component: () => ui }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const result = render(
    <ApiProvider api={api}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ApiProvider>,
  );
  return { ...result, api };
}
