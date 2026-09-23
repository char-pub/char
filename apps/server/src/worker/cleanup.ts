/**
 * 定期清理任务（`maintenance.cleanup`，每小时一次）：删除已经没有用处的短期记录。
 *
 * | 表                    | 删除条件                                   |
 * |-----------------------|--------------------------------------------|
 * | `guest_verifications` | 已过期（无论是否用过）                     |
 * | `guest_sessions`      | 已过期                                     |
 * | `oidc_jti`            | 已过期（保留期已经包含时钟容忍窗口）       |
 * | `webhook_deliveries`  | 收到超过 30 天                             |
 * | `rate_limits`         | 窗口开始于最长限流窗口之前，计数不再生效   |
 * | `auth_rate_limit`     | 最近一次请求在一天之前（登录限流窗口是分钟级） |
 *
 * webhook 投递记录只用于按 delivery ID 去重。GitHub 只允许重新投递最近几天内的事件，
 * 保留 30 天足以覆盖重投窗口，也留出排查问题的时间。
 *
 * 每张表按主键分批删除（每批最多 1000 行），每批是一个独立的语句，不会形成长事务，
 * 也不会长时间锁住热点表。单次运行每张表最多删除 `maxBatches` 批，剩下的留给下一次运行。
 * 删除条件只依赖时间，重复执行或并发执行都是安全的。这是运维清理，不写审计，
 * 只输出一行结构化日志。
 */
import { inArray, lt, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Executor } from "../db/client.js";
import {
  authRateLimit,
  guestSessions,
  guestVerifications,
  oidcJti,
  rateLimits,
  webhookDeliveries,
} from "../db/schema/index.js";
import { RATE_LIMITS } from "../ops/rate-limit.js";

export const CLEANUP_BATCH_SIZE = 1000;
export const WEBHOOK_DELIVERY_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 最长的应用内限流窗口：窗口开始早于它的计数行一定已经失效。 */
export const LONGEST_RATE_LIMIT_WINDOW_SECONDS = Math.max(
  ...Object.values(RATE_LIMITS).map((r) => r.windowSeconds),
);

export interface CleanupResult {
  guest_verifications: number;
  guest_sessions: number;
  oidc_jti: number;
  webhook_deliveries: number;
  rate_limits: number;
  auth_rate_limit: number;
}

export interface CleanupOptions {
  batchSize?: number;
  maxBatches?: number;
}

interface Target {
  name: keyof CleanupResult;
  table: PgTable;
  key: PgColumn;
  where: (now: Date) => SQL;
}

const TARGETS: readonly Target[] = [
  {
    name: "guest_verifications",
    table: guestVerifications,
    key: guestVerifications.id,
    where: (now) => lt(guestVerifications.expiresAt, now),
  },
  {
    name: "guest_sessions",
    table: guestSessions,
    key: guestSessions.id,
    where: (now) => lt(guestSessions.expiresAt, now),
  },
  {
    name: "oidc_jti",
    table: oidcJti,
    key: oidcJti.jti,
    where: (now) => lt(oidcJti.expiresAt, now),
  },
  {
    name: "webhook_deliveries",
    table: webhookDeliveries,
    key: webhookDeliveries.deliveryId,
    where: (now) =>
      lt(
        webhookDeliveries.receivedAt,
        new Date(now.getTime() - WEBHOOK_DELIVERY_RETENTION_DAYS * DAY_MS),
      ),
  },
  {
    name: "rate_limits",
    table: rateLimits,
    key: rateLimits.key,
    where: (now) =>
      lt(
        rateLimits.windowStart,
        new Date(now.getTime() - LONGEST_RATE_LIMIT_WINDOW_SECONDS * 1000),
      ),
  },
  {
    name: "auth_rate_limit",
    table: authRateLimit,
    key: authRateLimit.id,
    // Better Auth 以毫秒时间戳记录最近一次请求。
    where: (now) => lt(authRateLimit.lastRequest, now.getTime() - DAY_MS),
  },
];

async function deleteInBatches(
  db: Executor,
  target: Target,
  now: Date,
  batchSize: number,
  maxBatches: number,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < maxBatches; i++) {
    const batch = db
      .select({ key: target.key })
      .from(target.table)
      .where(target.where(now))
      .limit(batchSize);
    const res = await db.delete(target.table).where(inArray(target.key, batch));
    const n = res.rowCount ?? 0;
    total += n;
    if (n < batchSize) break;
  }
  return total;
}

export async function runCleanup(
  db: Executor,
  now: Date,
  options: CleanupOptions = {},
): Promise<CleanupResult> {
  const batchSize = Math.min(options.batchSize ?? CLEANUP_BATCH_SIZE, CLEANUP_BATCH_SIZE);
  const maxBatches = options.maxBatches ?? 100;
  const out = {} as CleanupResult;
  for (const target of TARGETS) {
    out[target.name] = await deleteInBatches(db, target, now, batchSize, maxBatches);
  }
  return out;
}

/** 一行 JSON 日志，便于在 Railway 日志里检索。 */
export function cleanupLogLine(at: Date, deleted: CleanupResult): string {
  return `${JSON.stringify({ event: "maintenance.cleanup", at: at.toISOString(), deleted })}\n`;
}
