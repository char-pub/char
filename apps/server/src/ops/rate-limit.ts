/**
 * 应用内限流：固定窗口计数，存储在 Postgres（不引入 Redis）。
 *
 * 每次请求用一条 `INSERT … ON CONFLICT DO UPDATE` 原子地累加计数：窗口过期时重置为 1，
 * 否则加 1，并返回累加后的值。并发请求之间不会丢计数，也不需要先读后写。
 *
 * key 由调用方组合，例如 `publish:user:<id>`、`contrib:ns:<id>`、`auth:ip:<hash>`。
 * IP 只以哈希形式出现在 key 中。
 */
import { sql } from "drizzle-orm";
import type { Executor } from "../db/client.js";

export interface RateLimitRule {
  /** 窗口长度（秒）。 */
  windowSeconds: number;
  /** 窗口内允许的最大次数。 */
  max: number;
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  /** 被拒绝时建议的重试等待秒数。 */
  retryAfterSeconds: number;
}

export async function hit(
  db: Executor,
  key: string,
  rule: RateLimitRule,
  now: Date,
): Promise<RateLimitResult> {
  const windowStart = new Date(
    Math.floor(now.getTime() / 1000 / rule.windowSeconds) * rule.windowSeconds * 1000,
  );
  const rows = await db.execute<{ count: number; window_start: Date }>(sql`
    INSERT INTO app.rate_limits AS r (key, count, window_start, updated_at)
    VALUES (${key}, 1, ${windowStart}, ${now})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN r.window_start < ${windowStart} THEN 1 ELSE r.count + 1 END,
      window_start = GREATEST(r.window_start, ${windowStart}),
      updated_at = ${now}
    RETURNING count, window_start
  `);
  const row = rows.rows[0];
  const count = Number(row?.count ?? 1);
  const allowed = count <= rule.max;
  const windowEnd = windowStart.getTime() + rule.windowSeconds * 1000;
  return {
    allowed,
    count,
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((windowEnd - now.getTime()) / 1000)),
  };
}

/** 默认规则。新账号的上限更低，由调用方选择对应规则。 */
export const RATE_LIMITS = {
  publish: { windowSeconds: 3600, max: 30 },
  contributionPerAccount: { windowSeconds: 3600, max: 20 },
  contributionPerNamespace: { windowSeconds: 3600, max: 100 },
  contributionPerGuest: { windowSeconds: 3600, max: 5 },
  upload: { windowSeconds: 86_400, max: 200 },
  uploadNewAccount: { windowSeconds: 86_400, max: 20 },
  tokenCreate: { windowSeconds: 3600, max: 10 },
  /** 访客验证邮件：同一 IP 每小时 10 封，同一邮箱每小时 3 封。 */
  guestVerificationPerIp: { windowSeconds: 3600, max: 10 },
  guestVerificationPerEmail: { windowSeconds: 3600, max: 3 },
  /** 确认验证链接：按 IP 限流。token 本身是 256 位随机数，这里只是挡住无意义的重试。 */
  guestConfirmPerIp: { windowSeconds: 3600, max: 30 },
} as const satisfies Record<string, RateLimitRule>;
