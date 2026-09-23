/**
 * 员工与角色管理，只有 owner 可以操作。
 *
 * - 员工账号就是普通的 `auth_user`，`role` 字段保存逗号分隔的员工角色。
 * - 移除某人的 owner 角色需要两名 owner：发起后返回待确认请求。系统里必须始终
 *   至少保留一名 owner。
 * - 员工角色只在 admin 进程中生效；在公开站点上员工没有任何管理权限。
 */
import { eq, isNotNull } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import { appendAudit } from "../../audit/audit.js";
import type { Tx } from "../../db/client.js";
import { authUser } from "../../db/schema/index.js";
import { problem } from "../../http/middleware.js";
import { type AdminContext, type AdminEnv, adminRoute, parseRoles } from "../app.js";
import { createApproval } from "../approvals.js";
import { STAFF_ROLES, type StaffRole } from "../roles.js";
import { parseId, publicId, recordAction, staffActor } from "./common.js";

/** 真正修改角色（直接修改或四眼确认后）。 */
export async function executeRoleChange(
  tx: Tx,
  c: AdminContext,
  userId: string,
  roles: readonly string[],
  reason: string,
): Promise<{ ok: true } | { ok: false; code: string }> {
  const [u] = await tx.select().from(authUser).where(eq(authUser.id, userId)).for("update");
  if (!u) return { ok: false, code: "not_found" };
  const before = parseRoles(u.role);
  const next = parseRoles(roles.join(","));
  if (before.includes("owner") && !next.includes("owner")) {
    const owners = await tx
      .select({ id: authUser.id, role: authUser.role })
      .from(authUser)
      .where(isNotNull(authUser.role));
    const remaining = owners.filter((o) => o.id !== userId && parseRoles(o.role).includes("owner"));
    if (remaining.length === 0) return { ok: false, code: "admin.last_owner" };
  }
  const now = c.var.services.clock.now();
  await tx
    .update(authUser)
    .set({ role: next.length > 0 ? next.join(",") : null, updatedAt: now })
    .where(eq(authUser.id, userId));
  await recordAction(tx, c, {
    action: "staff.set_roles",
    subject: { user: userId },
    reason,
    params: { before, after: next },
  });
  await appendAudit(tx, {
    at: now,
    actor: staffActor(c),
    action: "staff.set_roles",
    subject: `user:${userId}`,
    requestId: c.var.requestId,
    before: { roles: before },
    after: { roles: next, reason },
  });
  return { ok: true };
}

const RolesSchema = z.strictObject({
  roles: z.array(z.enum(STAFF_ROLES)).max(STAFF_ROLES.length),
  reason: z.string().trim().min(10).max(2000),
});

export function registerStaff(app: Hono<AdminEnv>): void {
  adminRoute(app, {
    method: "get",
    path: "/v1/admin/staff",
    capability: "staff.manage",
    handler: async (c) => {
      const rows = await c.var.services.db
        .select({
          id: authUser.id,
          email: authUser.email,
          name: authUser.name,
          role: authUser.role,
        })
        .from(authUser)
        .where(isNotNull(authUser.role));
      return c.json({
        items: rows
          .map((r) => ({
            id: publicId("user", r.id),
            email: r.email,
            name: r.name,
            roles: parseRoles(r.role),
          }))
          .filter((r) => r.roles.length > 0),
      });
    },
  });

  adminRoute(app, {
    method: "put",
    path: "/v1/admin/staff/:user_id",
    capability: "staff.manage",
    body: RolesSchema,
    handler: async (c, { body }) => {
      const id = parseId("user", c.req.param("user_id"));
      if (!id) return problem(c, 404, "not_found");
      const roles = [...new Set(body.roles)] as StaffRole[];
      return c.var.services.db.transaction(async (tx) => {
        const [u] = await tx.select().from(authUser).where(eq(authUser.id, id));
        if (!u) return problem(c, 404, "not_found");
        const removingOwner = parseRoles(u.role).includes("owner") && !roles.includes("owner");
        if (removingOwner) {
          const approval = await createApproval(tx, {
            id: c.var.services.ids.uuid(),
            kind: "staff.remove_owner",
            capability: "staff.manage",
            subject: `user:${publicId("user", id)}`,
            payload: { user_id: id, roles },
            reason: body.reason,
            staff: c.var.staff,
            now: c.var.services.clock.now(),
            requestId: c.var.requestId,
          });
          return c.json({ approval }, 202);
        }
        const done = await executeRoleChange(tx, c, id, roles, body.reason);
        return done.ok
          ? c.json({ ok: true, roles })
          : problem(c, done.code === "not_found" ? 404 : 409, done.code);
      });
    },
  });
}
