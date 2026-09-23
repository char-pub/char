/**
 * 组件测试的渲染工具：在 QueryClient、假的 Registry 客户端与内存路由中渲染组件，
 * 这样组件里的 `<Link>` 与查询都能正常工作。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Me, RegistryClient } from "@/lib/api";
import { RegistryProvider } from "@/lib/registry";

/** 没有覆盖的方法被调用时直接失败，避免测试悄悄依赖真实网络。 */
export function fakeClient(overrides: Partial<RegistryClient> = {}): RegistryClient {
  return new Proxy(overrides as RegistryClient, {
    get(target, prop: string) {
      if (prop in target) return target[prop as keyof RegistryClient];
      return () => Promise.reject(new Error(`unexpected call: ${prop}`));
    },
  });
}

export const ME: Me = {
  id: "usr_01j00000000000000000000000",
  name: "Test Writer",
  image: null,
  namespace: "writer",
  settings: { show_mature: false, mature_confirmed_at: null, locale: null },
};

export function renderWithApp(
  ui: ReactNode,
  client: RegistryClient = fakeClient(),
): { queryClient: QueryClient; unmount: () => void } {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <>{ui}</> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const result = render(
    <QueryClientProvider client={qc}>
      <RegistryProvider client={client}>
        <RouterProvider router={router} />
      </RegistryProvider>
    </QueryClientProvider>,
  );
  return { queryClient: qc, unmount: result.unmount };
}
