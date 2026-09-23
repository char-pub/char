/**
 * 选择 admin API 的实现：构建时设置 `VITE_ADMIN_MOCK=1` 使用内置 mock；否则按当前
 * 域名选择 admin-api（staging 与 production 分开），也可以用 `VITE_ADMIN_API_BASE` 覆盖。
 */
import type { AdminApi } from "./api";
import { createHttpApi } from "./http-api";
import { createMockApi } from "./mock-api";

export function apiBaseFor(hostname: string, override?: string): string {
  if (override) return override;
  if (hostname === "admin.char.pub") return "https://admin-api.char.pub";
  if (hostname === "staging-admin.char.pub") return "https://staging-admin-api.char.pub";
  // 本地开发：同源，由 vite 的 proxy 转发到本机的 admin 进程。
  return "";
}

export function createApiFromEnv(): AdminApi {
  if (import.meta.env.VITE_ADMIN_MOCK === "1") return createMockApi();
  return createHttpApi(apiBaseFor(window.location.hostname, import.meta.env.VITE_ADMIN_API_BASE));
}
