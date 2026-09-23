/**
 * 选择 admin API 的实现：构建时设置 `VITE_ADMIN_MOCK=1` 使用内置 mock；否则按当前
 * 域名选择 admin-api，也可以用 `VITE_ADMIN_API_BASE` 覆盖。
 *
 * mock 模式下可以切换扮演的员工角色（保存在 localStorage，页面顶部有切换器），用于检查
 * 各角色看到的界面；也可以让 mock 后端按另一组角色判断权限，模拟页面打开之后角色被收回。
 */
import type { AdminApi, StaffRole } from "./api";
import { createHttpApi } from "./http-api";
import { createMockApi, meFor } from "./mock-api";
import { MOCK_ENFORCE_ROLES_KEY, MOCK_ROLES_KEY } from "./mock-keys";
import { parseRoles } from "./roles";

export const isMockBuild = (): boolean => import.meta.env.VITE_ADMIN_MOCK === "1";

export function apiBaseFor(hostname: string, override?: string): string {
  if (override) return override;
  if (hostname === "admin.char.pub") return "https://admin-api.char.pub";
  // 本地开发：同源，由 vite 的 proxy 转发到本机的 admin 进程。
  return "";
}

/** mock 模式下扮演的角色；没有设置或无法解析时是 owner。 */
export function mockRoles(storage: Pick<Storage, "getItem">): StaffRole[] {
  const roles = parseRoles(storage.getItem(MOCK_ROLES_KEY));
  return roles.length > 0 ? roles : ["owner"];
}

export function createApiFromEnv(): AdminApi {
  if (isMockBuild()) {
    const enforce = parseRoles(window.localStorage.getItem(MOCK_ENFORCE_ROLES_KEY));
    return createMockApi({
      me: meFor(mockRoles(window.localStorage)),
      ...(enforce.length > 0 ? { enforceRoles: enforce } : {}),
    });
  }
  return createHttpApi(apiBaseFor(window.location.hostname, import.meta.env.VITE_ADMIN_API_BASE));
}
