/**
 * 迁移命令本身：可以重复执行，结果不变。
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { runMigrations } from "../src/db/migrate.js";
import { APP, OWNER } from "./global-setup.js";
import { createTestDatabase, type TestDatabase } from "./helpers.js";

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.drop();
});

async function count(url: string, q: string): Promise<number> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const r = await c.query<{ n: number }>(q);
    return Number(r.rows[0]?.n);
  } finally {
    await c.end();
  }
}

describe("runMigrations", () => {
  it("is idempotent", async () => {
    const tables = "SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = 'app'";
    const queues = "SELECT count(*) AS n FROM pgboss.queue";
    const before = [await count(t.ownerUrl, tables), await count(t.ownerUrl, queues)];
    await runMigrations({ connectionString: t.ownerUrl, appRole: APP.user });
    expect([await count(t.ownerUrl, tables), await count(t.ownerUrl, queues)]).toEqual(before);
    // 重新授权后，应用角色的限制依然有效。
    await expect(count(t.appUrl, "DELETE FROM app.audit_log RETURNING 1")).rejects.toThrow(
      /permission denied/,
    );
  });

  it("rejects an unsafe role name", async () => {
    await expect(
      runMigrations({ connectionString: t.ownerUrl, appRole: "x; DROP TABLE y" }),
    ).rejects.toThrow("invalid app role name");
  });

  it("uses a role that is neither superuser nor able to bypass row security", async () => {
    const c = new pg.Client({
      connectionString: `postgres://${OWNER.user}:${OWNER.password}@${inject("pgHost")}:${inject("pgPort")}/postgres`,
    });
    await c.connect();
    const r = await c.query<{ rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean }>(
      "SELECT rolsuper, rolbypassrls, rolcreaterole FROM pg_roles WHERE rolname = $1",
      [APP.user],
    );
    await c.end();
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false });
  });
});
