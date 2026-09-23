/**
 * Registry 客户端的 React 上下文与常用查询。界面通过 `useRegistry()` 拿到客户端，
 * 测试可以换成假的实现。当前用户用 `useMe()` 读取：未登录时是 null。
 */
import { type QueryClient, queryOptions, useQuery } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext } from "react";
import { createRegistryClient, type RegistryClient } from "./api";

const RegistryContext = createContext<RegistryClient | null>(null);

export function RegistryProvider({
  client,
  children,
}: {
  client: RegistryClient;
  children: ReactNode;
}) {
  return <RegistryContext.Provider value={client}>{children}</RegistryContext.Provider>;
}

let fallback: RegistryClient | undefined;

export function useRegistry(): RegistryClient {
  const c = useContext(RegistryContext);
  if (c) return c;
  fallback ??= createRegistryClient();
  return fallback;
}

/** 查询 key 集中定义，写操作之后按前缀失效。 */
export const keys = {
  me: ["me"] as const,
  myCreations: ["me", "creations"] as const,
  search: (p: object) => ["search", p] as const,
  /** namespace 改名后按 `["namespace"]` 前缀失效，作者主页会重新解析到新名字。 */
  namespace: (slug: string) => ["namespace", slug] as const,
  creation: (ns: string, name: string) => ["creation", ns, name] as const,
  release: (ns: string, name: string, label: string) =>
    ["creation", ns, name, "release", label] as const,
  ir: (ns: string, name: string, label: string) => ["creation", ns, name, "ir", label] as const,
  dependents: (ns: string, name: string) => ["creation", ns, name, "dependents"] as const,
  /** 不放在 `creation` 前缀下：发布后刷新作品数据时不能打断正在编辑的草稿。 */
  draft: (ns: string, name: string) => ["draft", ns, name] as const,
  contributions: (ns: string, name: string, q: object) =>
    ["creation", ns, name, "contributions", q] as const,
  contribution: (ns: string, name: string, n: number) =>
    ["creation", ns, name, "contribution", n] as const,
  contributionInvites: (ns: string, name: string) =>
    ["creation", ns, name, "contribution-invites"] as const,
  source: (ns: string, name: string, label: string) =>
    ["creation", ns, name, "source", label] as const,
  guest: ["guest"] as const,
  import: (id: string) => ["import", id] as const,
};

export function meQuery(client: RegistryClient) {
  return queryOptions({
    queryKey: keys.me,
    queryFn: () => client.me(),
    staleTime: 30_000,
    retry: false,
  });
}

export function useMe() {
  return useQuery(meQuery(useRegistry()));
}

/** 当前的访客会话（经过邮箱验证的访客）；没有时是 null。 */
export function useGuest(enabled = true) {
  const client = useRegistry();
  return useQuery({
    queryKey: keys.guest,
    queryFn: () => client.guestMe(),
    staleTime: 30_000,
    retry: false,
    enabled,
  });
}

/** 登录状态或成人内容设置变化后，个性化的查询都要重新读取。 */
export async function refreshPersonalised(qc: QueryClient): Promise<void> {
  await Promise.all([
    qc.invalidateQueries({ queryKey: keys.me }),
    qc.invalidateQueries({ queryKey: keys.guest }),
    qc.invalidateQueries({ queryKey: ["search"] }),
    qc.invalidateQueries({ queryKey: ["creation"] }),
  ]);
}
