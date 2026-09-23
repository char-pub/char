/**
 * 个人访问 Token 的管理：创建、列出、吊销。
 *
 * 只能用浏览器会话操作，Token 不能用来创建或管理 Token，所以泄露的 Token 无法给自己续命
 * 或扩大权限。明文只在创建时返回一次，数据库只保存哈希。
 */
import { CreateTokenRequestSchema } from "@char-pub/contracts";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Hono } from "hono";
import { appendAudit } from "../../audit/audit.js";
import { displayPrefix, generateToken, hashToken } from "../../auth/tokens.js";
import { apiTokens } from "../../db/schema/index.js";
import { problem } from "../../http/middleware.js";
import { auditActor, param, requestIdOf, userIdOf } from "../../registry/context.js";
import { type AppContext, type Env, notFound, route } from "../app.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * `/v1/me/*` 指向当前登录用户自己的账号：没有登录时直接 401，其余交给 authorize
 * 判断（例如用 Token 管理 Token 会被拒绝）。
 */
function account(c: AppContext) {
  const p = c.var.principal;
  if (p.kind !== "user") return problem(c, 401, "auth.required");
  return {
    action: "account.manage_tokens" as const,
    resource: { type: "account" as const, user_id: p.user_id },
    loaded: null,
  };
}

export function register(app: Hono<Env>): void {
  route(app, {
    method: "post",
    path: "/v1/me/tokens",
    body: CreateTokenRequestSchema,
    authorize: async (c) => account(c),
    handler: async (c, { body }) => {
      const { db, ids, clock } = c.var.services;
      const userId = userIdOf(c.var.principal);
      const token = generateToken();
      const now = clock.now();
      const expiresAt = new Date(now.getTime() + body.expires_in_days * DAY_MS);
      const id = ids.uuid();
      await db.transaction(async (tx) => {
        await tx.insert(apiTokens).values({
          id,
          userId,
          name: body.name,
          prefix: displayPrefix(token),
          tokenHash: hashToken(token),
          scopes: body.scopes,
          agent: body.agent ?? false,
          expiresAt,
          createdAt: now,
        });
        await appendAudit(tx, {
          at: now,
          actor: auditActor(c.var.principal),
          action: "token.create",
          subject: `user:${userId}`,
          requestId: requestIdOf(c),
          after: {
            token: id,
            scopes: body.scopes,
            agent: body.agent ?? false,
            expires_at: expiresAt.toISOString(),
          },
        });
      });
      return c.json(
        { id, token, prefix: displayPrefix(token), expires_at: expiresAt.toISOString() },
        201,
      );
    },
  });

  route(app, {
    method: "get",
    path: "/v1/me/tokens",
    authorize: async (c) => account(c),
    handler: async (c) => {
      const rows = await c.var.services.db
        .select({
          id: apiTokens.id,
          name: apiTokens.name,
          prefix: apiTokens.prefix,
          scopes: apiTokens.scopes,
          agent: apiTokens.agent,
          expiresAt: apiTokens.expiresAt,
          lastUsedAt: apiTokens.lastUsedAt,
          createdAt: apiTokens.createdAt,
        })
        .from(apiTokens)
        .where(and(eq(apiTokens.userId, userIdOf(c.var.principal)), isNull(apiTokens.revokedAt)))
        .orderBy(desc(apiTokens.createdAt));
      return c.json({
        items: rows.map((r) => ({
          id: r.id,
          name: r.name,
          prefix: r.prefix,
          scopes: r.scopes,
          agent: r.agent,
          expires_at: r.expiresAt?.toISOString() ?? null,
          last_used_at: r.lastUsedAt?.toISOString() ?? null,
          created_at: r.createdAt.toISOString(),
        })),
      });
    },
  });

  route(app, {
    method: "delete",
    path: "/v1/me/tokens/:id",
    authorize: async (c) => account(c),
    handler: async (c) => {
      const { db, clock } = c.var.services;
      const userId = userIdOf(c.var.principal);
      const id = param(c, "id");
      // Token id 是内部 uuid；格式不对时直接当作不存在。
      if (!UUID_RE.test(id)) return notFound(c);
      const now = clock.now();
      const revoked = await db.transaction(async (tx) => {
        const rows = await tx
          .update(apiTokens)
          .set({ revokedAt: now })
          .where(
            and(eq(apiTokens.id, id), eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)),
          )
          .returning({ id: apiTokens.id });
        if (rows.length === 0) return false;
        await appendAudit(tx, {
          at: now,
          actor: auditActor(c.var.principal),
          action: "token.revoke",
          subject: `user:${userId}`,
          requestId: requestIdOf(c),
          after: { token: id },
        });
        return true;
      });
      return revoked ? c.body(null, 204) : notFound(c);
    },
  });
}
