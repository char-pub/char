/**
 * `GET /v1/admin/me`：当前员工的邮箱、角色与能力。admin SPA 据此决定显示哪些操作；
 * 这只影响界面，权限以每个路由自己的检查为准。
 */
import type { Hono } from "hono";
import { type AdminEnv, adminRoute } from "../app.js";
import { capabilitiesOf, STAFF_CAPABILITIES } from "../roles.js";

export function registerMe(app: Hono<AdminEnv>): void {
  adminRoute(app, {
    method: "get",
    path: "/v1/admin/me",
    capability: "overview.read",
    handler: async (c) => {
      const s = c.var.staff;
      const caps = capabilitiesOf(s.roles);
      return c.json({
        email: s.email,
        roles: s.roles,
        capabilities: STAFF_CAPABILITIES.filter((x) => caps.has(x)),
      });
    },
  });
}
