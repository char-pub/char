/**
 * 用户处置：查看概况、封禁、解封、锁定上传、吊销会话与 Token。
 *
 * - 封禁在一个事务中标记封禁、删除全部会话、吊销全部个人 Token 并写审计，
 *   所以被封禁用户的下一个请求就会失败。
 * - 因 CSAM 被锁定的账号（封禁原因为 `csam`）解封需要两名员工：发起后返回待确认请求，
 *   另一名员工确认后才真正解封。
 * - 锁定上传只禁止新的上传与角色卡导入，账号的其他功能不受影响；解锁即恢复。
 * - 吊销会话与 Token 不封禁账号：用户可以重新登录、重新创建 Token。用于账号疑似被盗等场景。
 */
import { and, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import { appendAudit } from "../../audit/audit.js";
import { banUser, unbanUser } from "../../auth/ban.js";
import type { Tx } from "../../db/client.js";
import {
  apiTokens,
  authSession,
  authUser,
  creations,
  moderationActions,
  namespaceMembers,
  namespaces,
  uploadLocks,
} from "../../db/schema/index.js";
import { problem } from "../../http/middleware.js";
import { type AdminContext, type AdminEnv, adminRoute } from "../app.js";
import { createApproval } from "../approvals.js";
import { parseId, publicId, recordAction, staffActor } from "./common.js";

export const CSAM_BAN_REASON = "csam";

type UserRow = typeof authUser.$inferSelect;

async function userView(c: AdminContext, u: UserRow) {
  const db = c.var.services.db;
  const ns = await db
    .select({ slug: namespaces.slug })
    .from(namespaceMembers)
    .innerJoin(namespaces, eq(namespaces.id, namespaceMembers.namespaceId))
    .where(eq(namespaceMembers.userId, u.id));
  const [tokens] = await db
    .select({ n: count() })
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, u.id), isNull(apiTokens.revokedAt)));
  const [sessions] = await db
    .select({ n: count() })
    .from(authSession)
    .where(eq(authSession.userId, u.id));
  const [lock] = await db.select().from(uploadLocks).where(eq(uploadLocks.userId, u.id));
  return {
    id: publicId("user", u.id),
    email: u.email,
    name: u.name,
    namespaces: ns.map((n) => `@${n.slug}`),
    banned: u.banned,
    ban_reason: u.banReason,
    ban_expires: u.banExpires?.toISOString() ?? null,
    csam_locked: u.banned && u.banReason === CSAM_BAN_REASON,
    tokens: tokens?.n ?? 0,
    sessions: sessions?.n ?? 0,
    uploads_locked: lock !== undefined,
    uploads_locked_at: lock?.lockedAt.toISOString() ?? null,
    created_at: u.createdAt.toISOString(),
  };
}

/** 真正解封（直接解封或四眼确认后），同时写处置记录。 */
export async function executeUnban(
  tx: Tx,
  c: AdminContext,
  userId: string,
  reason: string,
): Promise<void> {
  await unbanUser(tx, { userId, actor: staffActor(c), now: c.var.services.clock.now(), reason });
  await recordAction(tx, c, { action: "user.unban", subject: { user: userId }, reason });
}

const BanSchema = z.strictObject({
  reason: z.string().trim().min(10).max(2000),
  until: z.iso.datetime({ offset: true }).optional(),
});
const ReasonOnly = z.strictObject({ reason: z.string().trim().min(10).max(2000) });
const RevokeSchema = z.strictObject({
  sessions: z.boolean().default(true),
  tokens: z.boolean().default(true),
  reason: z.string().trim().min(10).max(2000),
});

export function registerUsers(app: Hono<AdminEnv>): void {
  adminRoute(app, {
    method: "get",
    path: "/v1/admin/users",
    capability: "overview.read",
    handler: async (c) => {
      const q = (new URL(c.req.url).searchParams.get("query") ?? "").trim().slice(0, 200);
      const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
      const rows = await c.var.services.db
        .select()
        .from(authUser)
        .where(q ? or(ilike(authUser.email, like), ilike(authUser.name, like)) : undefined)
        .orderBy(desc(authUser.createdAt))
        .limit(50);
      return c.json({ items: await Promise.all(rows.map((u) => userView(c, u))) });
    },
  });

  adminRoute(app, {
    method: "get",
    path: "/v1/admin/users/:id",
    capability: "overview.read",
    handler: async (c) => {
      const id = parseId("user", c.req.param("id"));
      if (!id) return problem(c, 404, "not_found");
      const db = c.var.services.db;
      const [u] = await db.select().from(authUser).where(eq(authUser.id, id));
      if (!u) return problem(c, 404, "not_found");
      const [creationCount] = await db
        .select({ n: count() })
        .from(creations)
        .innerJoin(namespaceMembers, eq(namespaceMembers.namespaceId, creations.namespaceId))
        .where(eq(namespaceMembers.userId, id));
      const recent = await db
        .select()
        .from(moderationActions)
        .where(sql`${moderationActions.subject} @> ${JSON.stringify({ user: id })}::jsonb`)
        .orderBy(desc(moderationActions.createdAt))
        .limit(20);
      return c.json({
        ...(await userView(c, u)),
        creations: creationCount?.n ?? 0,
        recent_actions: recent.map((a) => ({
          id: a.id,
          action: a.action,
          reason: a.reason,
          created_at: a.createdAt.toISOString(),
        })),
      });
    },
  });

  adminRoute(app, {
    method: "post",
    path: "/v1/admin/users/:id/ban",
    capability: "users.ban",
    body: BanSchema,
    handler: async (c, { body }) => {
      const id = parseId("user", c.req.param("id"));
      if (!id) return problem(c, 404, "not_found");
      if (id === c.var.staff.user_id) return problem(c, 422, "admin.cannot_ban_self");
      const now = c.var.services.clock.now();
      const until = body.until ? new Date(body.until) : undefined;
      if (until && until <= now) return problem(c, 422, "admin.ban_until_in_past");
      const out = await c.var.services.db.transaction(async (tx) => {
        const [u] = await tx.select().from(authUser).where(eq(authUser.id, id)).for("update");
        if (!u) return null;
        // 不能用普通封禁覆盖 CSAM 锁定，否则解封就绕过了四眼确认。
        if (u.banReason === CSAM_BAN_REASON) return "csam" as const;
        const r = await banUser(tx, {
          userId: id,
          reason: body.reason,
          until,
          actor: staffActor(c),
          now,
          requestId: c.var.requestId,
        });
        await recordAction(tx, c, {
          action: "user.ban",
          subject: { user: id },
          reason: body.reason,
          params: { until: body.until ?? null },
        });
        return r;
      });
      if (out === null) return problem(c, 404, "not_found");
      if (out === "csam") return problem(c, 409, "admin.csam_locked");
      return c.json({
        ok: true,
        sessions_revoked: out.sessionsRevoked,
        tokens_revoked: out.tokensRevoked,
      });
    },
  });

  adminRoute(app, {
    method: "post",
    path: "/v1/admin/users/:id/unban",
    capability: "users.ban",
    body: ReasonOnly,
    handler: async (c, { body }) => {
      const id = parseId("user", c.req.param("id"));
      if (!id) return problem(c, 404, "not_found");
      const now = c.var.services.clock.now();
      return c.var.services.db.transaction(async (tx) => {
        const [u] = await tx.select().from(authUser).where(eq(authUser.id, id)).for("update");
        if (!u) return problem(c, 404, "not_found");
        if (!u.banned) return c.json({});
        if (u.banReason === CSAM_BAN_REASON) {
          const approval = await createApproval(tx, {
            id: c.var.services.ids.uuid(),
            kind: "unban.csam",
            capability: "users.ban",
            subject: `user:${publicId("user", id)}`,
            payload: { user_id: id },
            reason: body.reason,
            staff: c.var.staff,
            now,
            requestId: c.var.requestId,
          });
          return c.json({ approval }, 202);
        }
        await executeUnban(tx, c, id, body.reason);
        return c.json({});
      });
    },
  });

  adminRoute(app, {
    method: "post",
    path: "/v1/admin/users/:id/revoke",
    capability: "users.ban",
    body: RevokeSchema,
    handler: async (c, { body }) => {
      const id = parseId("user", c.req.param("id"));
      if (!id) return problem(c, 404, "not_found");
      if (!body.sessions && !body.tokens) return problem(c, 422, "admin.nothing_to_revoke");
      const now = c.var.services.clock.now();
      const out = await c.var.services.db.transaction(async (tx) => {
        const [u] = await tx.select({ id: authUser.id }).from(authUser).where(eq(authUser.id, id));
        if (!u) return null;
        const sessions = body.sessions
          ? await tx
              .delete(authSession)
              .where(eq(authSession.userId, id))
              .returning({ id: authSession.id })
          : [];
        const tokens = body.tokens
          ? await tx
              .update(apiTokens)
              .set({ revokedAt: now })
              .where(and(eq(apiTokens.userId, id), isNull(apiTokens.revokedAt)))
              .returning({ id: apiTokens.id })
          : [];
        await recordAction(tx, c, {
          action: "user.revoke_credentials",
          subject: { user: id },
          reason: body.reason,
          params: { sessions: sessions.length, tokens: tokens.length },
        });
        await appendAudit(tx, {
          at: now,
          actor: staffActor(c),
          action: "user.revoke_credentials",
          subject: `user:${id}`,
          requestId: c.var.requestId,
          after: {
            reason: body.reason,
            sessions_revoked: sessions.length,
            tokens_revoked: tokens.length,
          },
        });
        return { sessions: sessions.length, tokens: tokens.length };
      });
      if (!out) return problem(c, 404, "not_found");
      return c.json({ sessions_revoked: out.sessions, tokens_revoked: out.tokens });
    },
  });

  adminRoute(app, {
    method: "post",
    path: "/v1/admin/users/:id/upload-lock",
    capability: "users.ban",
    body: z.strictObject({ locked: z.boolean(), reason: z.string().trim().min(10).max(2000) }),
    handler: async (c, { body }) => {
      const id = parseId("user", c.req.param("id"));
      if (!id) return problem(c, 404, "not_found");
      const now = c.var.services.clock.now();
      const found = await c.var.services.db.transaction(async (tx) => {
        const [u] = await tx.select({ id: authUser.id }).from(authUser).where(eq(authUser.id, id));
        if (!u) return false;
        const [existing] = await tx
          .select()
          .from(uploadLocks)
          .where(eq(uploadLocks.userId, id))
          .for("update");
        // 状态没有变化时不写记录，重复提交是安全的。
        if (body.locked === (existing !== undefined)) return true;
        if (body.locked) {
          await tx.insert(uploadLocks).values({
            userId: id,
            lockedBy: c.var.staff.user_id,
            reason: body.reason,
            lockedAt: now,
          });
        } else {
          await tx.delete(uploadLocks).where(eq(uploadLocks.userId, id));
        }
        const action = body.locked ? "user.lock_uploads" : "user.unlock_uploads";
        await recordAction(tx, c, { action, subject: { user: id }, reason: body.reason });
        await appendAudit(tx, {
          at: now,
          actor: staffActor(c),
          action,
          subject: `user:${id}`,
          requestId: c.var.requestId,
          before: { uploads_locked: existing !== undefined },
          after: { uploads_locked: body.locked, reason: body.reason },
        });
        return true;
      });
      return found ? c.json({ uploads_locked: body.locked }) : problem(c, 404, "not_found");
    },
  });
}
