/**
 * 个人访问 Token：给 CLI 和 Agent 使用。
 *
 * 格式 `cp_pat_<43 位 base62>`，约 256 位随机数。数据库只存 sha256 哈希和前 12 个字符
 * （用于在界面上辨认），明文只在创建时返回一次。Token 有 scope 和过期时间，可随时吊销；
 * 最后使用时间只精确到小时，避免每个请求都写数据库。
 */
import { randomBytes } from "node:crypto";
import { sha256Hex } from "@char-pub/core";
import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import type { Principal, Scope } from "../authz/authorize.js";
import type { Executor } from "../db/client.js";
import { apiTokens, authUser } from "../db/schema/index.js";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const TOKEN_PREFIX = "cp_pat_";
export const TOKEN_RE = /^cp_pat_[0-9A-Za-z]{43}$/;

/** 生成一个 Token。用拒绝采样保证每个字符均匀分布。 */
export function generateToken(random: (n: number) => Uint8Array = (n) => randomBytes(n)): string {
  let out = "";
  while (out.length < 43) {
    for (const b of random(64)) {
      if (b < 248 && out.length < 43) out += BASE62[b % 62];
    }
  }
  return TOKEN_PREFIX + out;
}

export function hashToken(token: string): string {
  return sha256Hex(token);
}

export function displayPrefix(token: string): string {
  return token.slice(0, TOKEN_PREFIX.length + 5);
}

/** 从 `Authorization: Bearer cp_pat_…` 解析 principal。格式不对或无效时返回 null。 */
export async function principalFromToken(
  db: Executor,
  token: string,
  now: Date,
): Promise<Principal | null> {
  if (!TOKEN_RE.test(token)) return null;
  const rows = await db
    .select({
      id: apiTokens.id,
      userId: apiTokens.userId,
      scopes: apiTokens.scopes,
      agent: apiTokens.agent,
      lastUsedAt: apiTokens.lastUsedAt,
      banned: authUser.banned,
      banExpires: authUser.banExpires,
    })
    .from(apiTokens)
    .innerJoin(authUser, eq(authUser.id, apiTokens.userId))
    .where(
      and(
        eq(apiTokens.tokenHash, hashToken(token)),
        isNull(apiTokens.revokedAt),
        or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, now)),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  if (!row.lastUsedAt || row.lastUsedAt < hourAgo) {
    await db
      .update(apiTokens)
      .set({ lastUsedAt: now })
      .where(
        and(
          eq(apiTokens.id, row.id),
          or(isNull(apiTokens.lastUsedAt), lt(apiTokens.lastUsedAt, hourAgo)),
        ),
      );
  }
  const banned = row.banned && (!row.banExpires || row.banExpires > now);
  return {
    kind: "user",
    user_id: row.userId,
    banned,
    scopes: row.scopes as Scope[],
    ...(row.agent ? { agent: true } : {}),
  };
}
