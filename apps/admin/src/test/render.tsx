/** 组件测试的渲染工具：注入 mock API 与 QueryClient。 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
  const result = render(
    <ApiProvider api={api}>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </ApiProvider>,
  );
  return { ...result, api };
}
