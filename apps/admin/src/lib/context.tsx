/**
 * 全局依赖：admin API 客户端与当前员工。
 *
 * 客户端通过 React context 注入，组件测试可以换成 mock。能力检查只用来决定界面上
 * 显示哪些操作；真正的权限以后端为准，按钮被隐藏不代表操作被禁止，反之亦然。
 */
import { useQuery } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext } from "react";
import type { AdminApi, Me, StaffCapability } from "./api";

const ApiContext = createContext<AdminApi | null>(null);

export function ApiProvider({ api, children }: { api: AdminApi; children: ReactNode }) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function useApi(): AdminApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error("ApiProvider is missing");
  return api;
}

export function useMe(): {
  me: Me | undefined;
  can: (c: StaffCapability) => boolean;
  error: unknown;
} {
  const api = useApi();
  const q = useQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: 5 * 60_000 });
  return {
    me: q.data,
    can: (c) => q.data?.capabilities.includes(c) ?? false,
    error: q.error,
  };
}
