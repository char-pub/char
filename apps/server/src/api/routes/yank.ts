/**
 * 作者 yank 自己的 Release：`POST …/releases/:label/yank { reason }`。
 *
 * yank 的 Release 内容仍然可以下载，已经锁定它的依赖方不受影响，只是不再建议新的依赖。
 * tombstoned 的 Release 不能 yank。每次 yank 都写审计日志。
 */
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import { type AuditActor, appendAudit } from "../../audit/audit.js";
import { releases } from "../../db/schema/index.js";
import { problem } from "../../http/middleware.js";
import { findCreation, findRelease, releaseSummary } from "../../registry/read.js";
import { type Env, notFound, route } from "../app.js";
import { CREATION_PATH } from "./read.js";

export const YankRequestSchema = z.strictObject({
  reason: z.string().trim().min(3).max(500),
});

export function register(app: Hono<Env>): void {
  route(app, {
    method: "post",
    path: `${CREATION_PATH}/releases/:label/yank`,
    body: YankRequestSchema,
    authorize: async (c) => {
      const slug = c.req.param("ns")?.slice(1) ?? "";
      const name = c.req.param("name") ?? "";
      const found = await findCreation(c.var.services.db, slug, name, c.var.principal);
      // 写接口不跟随改名重定向：客户端应该使用新地址。
      if (found.kind !== "found") return notFound(c);
      const f = found.value;
      const r = await findRelease(c.var.services.db, f.creation.id, c.req.param("label") ?? "");
      if (!r) return notFound(c);
      return {
        action: "release.yank",
        resource: {
          type: "release",
          id: r.id,
          creation_id: f.creation.id,
          ns: f.ns,
          visibility: r.visibility,
          status: r.status,
          creation_status: f.creation.status,
        },
        loaded: r,
      };
    },
    handler: async (c, { body, loaded: r }) => {
      if (r.status === "yanked") return c.json(releaseSummary(r));
      const { db, clock } = c.var.services;
      const principal = c.var.principal;
      if (principal.kind !== "user") return problem(c, 403, "forbidden");
      const now = clock.now();
      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(releases)
          .set({ status: "yanked", statusReason: body.reason, updatedAt: now })
          .where(eq(releases.id, r.id))
          .returning();
        const actor: AuditActor = { kind: "user", id: principal.user_id };
        await appendAudit(tx, {
          at: now,
          actor,
          action: "release.yank",
          subject: `release:${r.id}`,
          requestId: c.var.requestId,
          before: { status: r.status },
          after: { status: "yanked", reason: body.reason },
        });
        return row;
      });
      return c.json(releaseSummary(updated ?? r));
    },
  });
}
