/**
 * 封禁用户：在同一个事务中标记封禁、删除全部登录会话、吊销全部个人 Token，并写审计。
 *
 * 会话存在数据库里且不在 cookie 中缓存，Token 每次请求都查数据库，所以事务提交后
 * 该用户的下一个请求就会失败，不存在“封禁了但旧会话还能用一段时间”的窗口。
 */
import { and, eq, isNull } from "drizzle-orm";
import { type AuditActor, appendAudit } from "../audit/audit.js";
import type { Executor } from "../db/client.js";
import { apiTokens, authSession, authUser } from "../db/schema/index.js";

export interface BanInput {
  userId: string;
  reason: string;
  /** 缺省为永久封禁。 */
  until?: Date | undefined;
  actor: AuditActor;
  now: Date;
  requestId?: string | undefined;
}

export interface BanResult {
  sessionsRevoked: number;
  tokensRevoked: number;
}

export async function banUser(db: Executor, input: BanInput): Promise<BanResult> {
  const reason = input.reason.trim();
  if (reason.length === 0) throw new Error("ban reason is required");
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(authUser)
      .set({
        banned: true,
        banReason: reason,
        banExpires: input.until ?? null,
        updatedAt: input.now,
      })
      .where(eq(authUser.id, input.userId))
      .returning({ id: authUser.id });
    if (updated.length === 0) throw new Error("user not found");
    const sessions = await tx
      .delete(authSession)
      .where(eq(authSession.userId, input.userId))
      .returning({ id: authSession.id });
    const tokens = await tx
      .update(apiTokens)
      .set({ revokedAt: input.now })
      .where(and(eq(apiTokens.userId, input.userId), isNull(apiTokens.revokedAt)))
      .returning({ id: apiTokens.id });
    await appendAudit(tx, {
      at: input.now,
      actor: input.actor,
      action: "user.ban",
      subject: `user:${input.userId}`,
      requestId: input.requestId ?? null,
      after: {
        reason,
        until: input.until?.toISOString() ?? null,
        sessions_revoked: sessions.length,
        tokens_revoked: tokens.length,
      },
    });
    return { sessionsRevoked: sessions.length, tokensRevoked: tokens.length };
  });
}

/** 解除封禁。已吊销的会话与 Token 不会恢复，用户需要重新登录、重新创建 Token。 */
export async function unbanUser(
  db: Executor,
  input: { userId: string; actor: AuditActor; now: Date; reason: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(authUser)
      .set({ banned: false, banReason: null, banExpires: null, updatedAt: input.now })
      .where(eq(authUser.id, input.userId))
      .returning({ id: authUser.id });
    if (updated.length === 0) throw new Error("user not found");
    await appendAudit(tx, {
      at: input.now,
      actor: input.actor,
      action: "user.unban",
      subject: `user:${input.userId}`,
      after: { reason: input.reason.trim() },
    });
  });
}
