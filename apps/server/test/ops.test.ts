import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { featureFlags } from "../src/db/schema/index.js";
import { FlagCache } from "../src/ops/flags.js";
import { hit, RATE_LIMITS } from "../src/ops/rate-limit.js";
import { createTestDatabase, type TestDatabase } from "./helpers.js";

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.drop();
});

describe("rate limiting in Postgres", () => {
  const rule = { windowSeconds: 60, max: 3 };
  const at = (s: number) => new Date(Date.UTC(2026, 8, 22, 12, 0, s));

  it("allows up to max hits per window and then rejects with a retry hint", async () => {
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await hit(t.app.db, "test:a", rule, at(10 + i)));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false, false]);
    expect(results.map((r) => r.count)).toEqual([1, 2, 3, 4, 5]);
    // 第 4 次请求在第 13 秒，窗口在第 60 秒结束。
    expect(results[3]?.retryAfterSeconds).toBe(47);
  });

  it("resets in the next window and keeps keys independent", async () => {
    expect((await hit(t.app.db, "test:a", rule, at(0 + 60))).count).toBe(1);
    expect((await hit(t.app.db, "test:b", rule, at(20))).count).toBe(1);
  });

  it("does not lose counts under concurrency", async () => {
    const now = at(30);
    const out = await Promise.all(
      Array.from({ length: 20 }, () =>
        hit(t.app.db, "test:concurrent", { windowSeconds: 60, max: 100 }, now),
      ),
    );
    expect(out.map((r) => r.count).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
  });

  it("has sane default rules", () => {
    for (const r of Object.values(RATE_LIMITS)) {
      expect(r.max).toBeGreaterThan(0);
      expect(r.windowSeconds).toBeGreaterThan(0);
    }
    expect(RATE_LIMITS.uploadNewAccount.max).toBeLessThan(RATE_LIMITS.upload.max);
  });
});

describe("feature flag cache", () => {
  it("picks up a switched-off flag within the refresh interval, and ignores unknown keys", async () => {
    let now = 0;
    const cache = new FlagCache(t.app.db, () => now, 5000);
    expect([...(await cache.current())]).toEqual([]);

    await t.app.db.insert(featureFlags).values([
      { key: "uploads", enabled: false, reason: "incident" },
      { key: "not-a-flag", enabled: false },
    ]);
    now = 4999;
    expect([...(await cache.current())]).toEqual([]);
    now = 5000;
    expect([...(await cache.current())]).toEqual(["uploads"]);
  });

  it("keeps the last known value when the database is unavailable", async () => {
    let now = 0;
    const broken = {
      select: () => ({
        from: () => Promise.reject(new Error("db down")),
      }),
    } as unknown as ConstructorParameters<typeof FlagCache>[0];
    const cache = new FlagCache(broken, () => now, 5000);
    expect([...(await cache.current())]).toEqual([]);
    now = 10_000;
    expect([...(await cache.current())]).toEqual([]);
  });
});
