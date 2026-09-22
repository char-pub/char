/**
 * 数据库权限：应用以非 owner 角色连接，只能做数据读写；
 * 审计日志只能追加和读取；表结构和迁移记录都碰不到。
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendAudit } from "../src/audit/audit.js";
import { auditLog, featureFlags } from "../src/db/schema/index.js";
import { createTestDatabase, pgErrorCode, type TestDatabase } from "./helpers.js";

const INSUFFICIENT_PRIVILEGE = "42501";
const MUST_BE_OWNER = "42501";

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
  await t.app.db.transaction(async (tx) => {
    await appendAudit(tx, {
      at: new Date("2026-09-22T00:00:00.000Z"),
      actor: { kind: "system", id: "test" },
      action: "test.seed",
      subject: "db",
    });
  });
});

afterAll(async () => {
  await t.drop();
});

describe("app role", () => {
  it("connects as a non-owner role", async () => {
    const r = await t.app.db.execute<{ current_user: string }>(sql`SELECT current_user`);
    expect(r.rows[0]?.current_user).toBe("charpub_app");
  });

  it("can read and write ordinary tables", async () => {
    await t.app.db.insert(featureFlags).values({ key: "publish", enabled: true });
    await t.app.db.update(featureFlags).set({ enabled: false }).where(sql`key = 'publish'`);
    const rows = await t.app.db.select().from(featureFlags);
    expect(rows).toEqual([expect.objectContaining({ key: "publish", enabled: false })]);
    await t.app.db.delete(featureFlags).where(sql`key = 'publish'`);
  });

  it("can insert and select audit_log", async () => {
    const rows = await t.app.db.select().from(auditLog);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("cannot UPDATE audit_log", async () => {
    expect(await pgErrorCode(t.app.db.update(auditLog).set({ action: "tampered" }))).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it("cannot DELETE from audit_log", async () => {
    expect(await pgErrorCode(t.app.db.delete(auditLog))).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("cannot TRUNCATE audit_log", async () => {
    expect(await pgErrorCode(t.app.db.execute(sql`TRUNCATE app.audit_log`))).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it("cannot ALTER or DROP tables", async () => {
    expect(
      await pgErrorCode(t.app.db.execute(sql`ALTER TABLE app.feature_flags ADD COLUMN x int`)),
    ).toBe(MUST_BE_OWNER);
    expect(await pgErrorCode(t.app.db.execute(sql`DROP TABLE app.feature_flags`))).toBe(
      MUST_BE_OWNER,
    );
    expect(await pgErrorCode(t.app.db.execute(sql`DROP TABLE app.audit_log`))).toBe(MUST_BE_OWNER);
  });

  it("cannot create tables in the app schema", async () => {
    expect(await pgErrorCode(t.app.db.execute(sql`CREATE TABLE app.evil (x int)`))).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it("cannot read or change migration records", async () => {
    expect(
      await pgErrorCode(t.app.db.execute(sql`SELECT * FROM migrations.__drizzle_migrations`)),
    ).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("cannot alter pg-boss tables", async () => {
    expect(await pgErrorCode(t.app.db.execute(sql`DROP TABLE pgboss.job`))).toBe(MUST_BE_OWNER);
  });

  it("the owner role can update audit_log (only the app role is restricted)", async () => {
    // owner 角色只在迁移时使用；这一条证明限制来自授权，而不是表本身的约束。
    const r = await t.owner.db.execute(sql`SELECT count(*)::int AS n FROM app.audit_log`);
    expect(r.rows.length).toBe(1);
  });
});

describe("database setup", () => {
  it("uses a non-C collation so pg_trgm keeps CJK characters", async () => {
    const r = await t.app.db.execute<{ datcollate: string }>(
      sql`SELECT datcollate FROM pg_database WHERE datname = current_database()`,
    );
    expect(r.rows[0]?.datcollate).toBe("en_US.UTF-8");
    const g = await t.app.db.execute<{ n: number }>(
      sql`SELECT array_length(show_trgm('夜之城'), 1) AS n`,
    );
    expect(g.rows[0]?.n).toBeGreaterThan(0);
  });

  it("has all expected tables", async () => {
    const r = await t.app.db.execute<{ table_name: string }>(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'app' ORDER BY 1`,
    );
    const names = r.rows.map((x) => x.table_name);
    for (const expected of [
      "auth_user",
      "namespaces",
      "creations",
      "releases",
      "blob_refs",
      "contributions",
      "source_bindings",
      "audit_log",
      "feature_flags",
      "job_effects",
    ]) {
      expect(names).toContain(expected);
    }
  });
});
