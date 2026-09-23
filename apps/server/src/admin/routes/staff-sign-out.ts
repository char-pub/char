/**
 * 强制员工登出：删除该员工在 www 的全部登录会话，并吊销其 Cloudflare Access 会话。
 * 只有 owner（管理员工的权限）可以操作。
 *
 * 先调用 Access API，再在一个事务里删除应用会话并写处置记录与审计：Access 调用失败时
 * 应用会话照样删除，响应与审计中注明 Access 会话的吊销结果，员工可以重试。
 */
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import { appendAudit } from "../../audit/audit.js";
import { authSession, authUser } from "../../db/schema/index.js";
import { problem } from "../../http/middleware.js";
import type { AccessRevoker } from "../access-revoke.js";
import { type AdminEnv, adminRoute, parseRoles } from "../app.js";
import { parseId, recordAction, staffActor } from "./common.js";

export function registerStaffSignOut(revokeAccess: AccessRevoker | undefined) {
  return (app: Hono<AdminEnv>): void => {
    adminRoute(app, {
      method: "post",
      path: "/v1/admin/staff/:user_id/sign-out",
      capability: "staff.manage",
      body: z.strictObject({ reason: z.string().trim().min(10).max(2000) }),
      handler: async (c, { body }) => {
        const id = parseId("user", c.req.param("user_id"));
        if (!id) return problem(c, 404, "not_found");
        const { db, clock } = c.var.services;
        const [u] = await db.select().from(authUser).where(eq(authUser.id, id));
        if (!u || parseRoles(u.role).length === 0) return problem(c, 404, "not_found");
        const access = revokeAccess ? await revokeAccess(u.email) : "not_configured";
        const now = clock.now();
        const sessions = await db.transaction(async (tx) => {
          const deleted = await tx
            .delete(authSession)
            .where(eq(authSession.userId, id))
            .returning({ id: authSession.id });
          await recordAction(tx, c, {
            action: "staff.sign_out",
            subject: { user: id },
            reason: body.reason,
            params: { sessions: deleted.length, access },
          });
          await appendAudit(tx, {
            at: now,
            actor: staffActor(c),
            action: "staff.sign_out",
            subject: `user:${id}`,
            requestId: c.var.requestId,
            after: { reason: body.reason, sessions_revoked: deleted.length, access },
          });
          return deleted.length;
        });
        return c.json({ sessions_revoked: sessions, access });
      },
    });
  };
}
