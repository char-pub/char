import "./styles.css";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouteError } from "./components/states";
import { ApiError, createRegistryClient } from "./lib/api";
import { noteApiError, noteWriteSucceeded } from "./lib/read-only";
import { RegistryProvider } from "./lib/registry";
import { routeTree } from "./routeTree.gen";

const queryClient = new QueryClient({
  // 全站只读时（`feature.read_only`）顶部显示提示条；写操作成功说明只读已经解除。
  queryCache: new QueryCache({ onError: noteApiError }),
  mutationCache: new MutationCache({ onError: noteApiError, onSuccess: noteWriteSucceeded }),
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      // 4xx 是确定的结果（不存在、没有权限、已下架），重试没有意义。
      retry: (count, e) =>
        !(e instanceof ApiError && e.status >= 400 && e.status < 500) && count < 1,
    },
  },
});
const registry = createRegistryClient();

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  scrollRestoration: true,
  // 页面渲染出错时在内容区显示兜底（顶栏和页脚照常可用）。
  defaultErrorComponent: RouteError,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RegistryProvider client={registry}>
        <RouterProvider router={router} />
      </RegistryProvider>
    </QueryClientProvider>
  </StrictMode>,
);
