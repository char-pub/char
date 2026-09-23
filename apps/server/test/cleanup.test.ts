/**
 * 定期清理任务：只删除过期或超过保留期的记录，分批删除，重复执行安全；
 * 由应用角色执行（worker 使用的就是这个角色）。
 */
import { sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newGuestId } from "../src/auth/guest.js";
import {
  authRateLimit,
  authUser,
  csamIncidents,
  evidenceDownloadTickets,
  guestSessions,
  guests,
  guestVerifications,
  oidcJti,
  rateLimits,
  webhookDeliveries,
} from "../src/db/schema/index.js";
import {
  cleanupLogLine,
  LONGEST_RATE_LIMIT_WINDOW_SECONDS,
  runCleanup,
  WEBHOOK_DELIVERY_RETENTION_DAYS,
} from "../src/worker/cleanup.js";
import { createTestDatabase, type TestDatabase } from "./helpers.js";

let t: TestDatabase;
const NOW = new Date("2026-09-22T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const later = (ms: number) => new Date(NOW.getTime() + ms);

beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.drop();
});

async function countOf(table: string): Promise<number> {
  const r = await t.owner.db.execute<{ n: string }>(
    sql`SELECT count(*)::text AS n FROM ${sql.raw(`app.${table}`)}`,
  );
  return Number(r.rows[0]?.n ?? 0);
}

async function reset(): Promise<void> {
  await t.owner.db.execute(
    sql`TRUNCATE app.guest_sessions, app.guest_verifications, app.guests, app.oidc_jti,
        app.webhook_deliveries, app.rate_limits, app.auth_rate_limit,
        app.evidence_download_tickets CASCADE`,
  );
}

async function seedGuest(): Promise<string> {
  const guestId = newGuestId(uuidv7());
  await t.app.db.insert(guests).values({ guestId, displayName: "Visitor", verifiedAt: NOW });
  return guestId;
}

async function seedVerifications(expired: number, fresh: number): Promise<void> {
  const rows = [
    ...Array.from({ length: expired }, () => ago(60_000)),
    ...Array.from({ length: fresh }, () => later(60_000)),
  ].map((expiresAt) => ({
    id: uuidv7(),
    tokenHash: uuidv7(),
    emailHmac: "h",
    displayName: "Visitor",
    expiresAt,
  }));
  if (rows.length > 0) await t.app.db.insert(guestVerifications).values(rows);
}

describe("maintenance cleanup", () => {
  beforeEach(reset);

  it("deletes only expired or out-of-retention rows in every table", async () => {
    await seedVerifications(2, 1);
    const guestId = await seedGuest();
    await t.app.db.insert(guestSessions).values([
      { id: uuidv7(), guestId, tokenHash: "s-old", expiresAt: ago(1000) },
      { id: uuidv7(), guestId, tokenHash: "s-new", expiresAt: later(DAY) },
    ]);
    await t.app.db.insert(oidcJti).values([
      { jti: "old", expiresAt: ago(1000) },
      { jti: "new", expiresAt: later(1000) },
    ]);
    await t.app.db.insert(webhookDeliveries).values([
      {
        deliveryId: "d-old",
        event: "push",
        receivedAt: ago((WEBHOOK_DELIVERY_RETENTION_DAYS + 1) * DAY),
        status: "processed",
      },
      {
        deliveryId: "d-new",
        event: "push",
        receivedAt: ago((WEBHOOK_DELIVERY_RETENTION_DAYS - 1) * DAY),
        status: "processed",
      },
    ]);
    await t.app.db.insert(rateLimits).values([
      {
        key: "publish:user:old",
        count: 3,
        windowStart: ago((LONGEST_RATE_LIMIT_WINDOW_SECONDS + 60) * 1000),
      },
      { key: "publish:user:new", count: 3, windowStart: ago(60_000) },
    ]);
    await t.app.db.insert(authRateLimit).values([
      { id: uuidv7(), key: "ip:old", count: 1, lastRequest: NOW.getTime() - 2 * DAY },
      { id: uuidv7(), key: "ip:new", count: 1, lastRequest: NOW.getTime() - 60_000 },
    ]);

    const deleted = await runCleanup(t.app.db, NOW);
    expect(deleted).toEqual({
      guest_verifications: 2,
      guest_sessions: 1,
      oidc_jti: 1,
      webhook_deliveries: 1,
      rate_limits: 1,
      auth_rate_limit: 1,
      evidence_download_tickets: 0,
    });
    for (const table of [
      "guest_verifications",
      "guest_sessions",
      "oidc_jti",
      "webhook_deliveries",
      "rate_limits",
      "auth_rate_limit",
    ]) {
      expect(await countOf(table), table).toBe(1);
    }
    // 访客本身不受影响。
    expect(await countOf("guests")).toBe(1);

    // 重复执行不会再删除任何东西。
    expect(Object.values(await runCleanup(t.app.db, NOW)).every((n) => n === 0)).toBe(true);
  });

  it("deletes expired evidence download tickets and keeps live ones", async () => {
    const staffId = uuidv7();
    await t.app.db
      .insert(authUser)
      .values({ id: staffId, email: `s-${staffId}@char.pub`, name: "s" });
    const incidentId = uuidv7();
    await t.app.db.insert(csamIncidents).values({
      id: incidentId,
      blobDigest: `sha256:${"a".repeat(64)}`,
      reason: "staff_flag",
      evidenceKey: `evidence/cas/sha256/aa/${"a".repeat(64)}`,
    });
    await t.app.db.insert(evidenceDownloadTickets).values([
      { tokenHash: "old", incidentId, staffId, expiresAt: ago(60_000) },
      { tokenHash: "live", incidentId, staffId, expiresAt: later(60_000) },
    ]);
    expect((await runCleanup(t.app.db, NOW)).evidence_download_tickets).toBe(1);
    expect(await countOf("evidence_download_tickets")).toBe(1);
  });

  it("a live rate-limit window is kept even when its counter is old", async () => {
    // 按天计数的上传限流：窗口开始于 23 小时前，仍然有效。
    await t.app.db
      .insert(rateLimits)
      .values({ key: "upload:user:x", count: 150, windowStart: ago(23 * 60 * 60 * 1000) });
    expect((await runCleanup(t.app.db, NOW)).rate_limits).toBe(0);
    expect(await countOf("rate_limits")).toBe(1);
  });

  it("deletes in batches and leaves the remainder for the next run", async () => {
    await seedVerifications(5, 1);
    expect(
      (await runCleanup(t.app.db, NOW, { batchSize: 2, maxBatches: 1 })).guest_verifications,
    ).toBe(2);
    expect(await countOf("guest_verifications")).toBe(4);
    expect((await runCleanup(t.app.db, NOW, { batchSize: 2 })).guest_verifications).toBe(3);
    expect(await countOf("guest_verifications")).toBe(1);
  });

  it("writes one structured log line with the counts", () => {
    const line = cleanupLogLine(NOW, {
      guest_verifications: 1,
      guest_sessions: 0,
      oidc_jti: 0,
      webhook_deliveries: 0,
      rate_limits: 0,
      auth_rate_limit: 0,
      evidence_download_tickets: 0,
    });
    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line)).toEqual({
      event: "maintenance.cleanup",
      at: NOW.toISOString(),
      deleted: expect.objectContaining({ guest_verifications: 1 }),
    });
  });
});
