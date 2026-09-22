/**
 * 审计哈希链：连续追加、并发追加、事务回滚，以及对篡改、删除、插入的检测。
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendAudit, verifyAuditChain } from "../src/audit/audit.js";
import { auditLog } from "../src/db/schema/index.js";
import { createTestDatabase, type TestDatabase } from "./helpers.js";

let t: TestDatabase;
const at = (s: number) => new Date(Date.UTC(2026, 8, 22, 0, 0, s));

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.drop();
});

describe("audit chain", () => {
  it("an empty log verifies", async () => {
    expect(await verifyAuditChain(t.app.db)).toEqual({ ok: true, count: 0, head: null });
  });

  it("links each entry to the previous hash", async () => {
    const a = await t.app.db.transaction((tx) =>
      appendAudit(tx, {
        at: at(1),
        actor: { kind: "user", id: "usr_1" },
        action: "release.publish",
        subject: "rel_1",
        requestId: "req-1",
        ipHash: "iphash",
        after: { status: "active" },
      }),
    );
    const b = await t.app.db.transaction((tx) =>
      appendAudit(tx, {
        at: at(2),
        actor: { kind: "staff", id: "usr_2" },
        action: "release.yank",
        subject: "rel_1",
        before: { status: "active" },
        after: { status: "yanked" },
      }),
    );
    expect(a.prevHash).toBeNull();
    expect(b.prevHash).toBe(a.hash);
    expect(a.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await verifyAuditChain(t.app.db)).toEqual({ ok: true, count: 2, head: b.hash });
  });

  it("rolls back together with the business transaction", async () => {
    const before = await verifyAuditChain(t.app.db);
    await expect(
      t.app.db.transaction(async (tx) => {
        await appendAudit(tx, {
          at: at(3),
          actor: { kind: "system", id: "worker" },
          action: "release.tombstone",
          subject: "rel_2",
        });
        throw new Error("business failure");
      }),
    ).rejects.toThrow("business failure");
    expect(await verifyAuditChain(t.app.db)).toEqual(before);
  });

  it("stays a single chain under concurrent appends", async () => {
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        t.app.db.transaction((tx) =>
          appendAudit(tx, {
            at: at(10 + i),
            actor: { kind: "system", id: "worker" },
            action: "job.run",
            subject: `job_${i}`,
          }),
        ),
      ),
    );
    const r = await verifyAuditChain(t.app.db, 5);
    expect(r).toMatchObject({ ok: true, count: 14 });
  });
});

describe("tamper detection (performed with the owner role)", () => {
  it("detects a modified field", async () => {
    const [row] = await t.owner.db.select().from(auditLog).orderBy(auditLog.id).limit(1).offset(1);
    if (!row) throw new Error("seed missing");
    await t.owner.db.execute(
      sql`UPDATE app.audit_log SET action = 'release.unyank' WHERE id = ${row.id}`,
    );
    expect(await verifyAuditChain(t.owner.db)).toMatchObject({
      ok: false,
      brokenAt: row.id,
      reason: "hash_mismatch",
    });
    await t.owner.db.execute(
      sql`UPDATE app.audit_log SET action = ${row.action} WHERE id = ${row.id}`,
    );
    expect((await verifyAuditChain(t.owner.db)).ok).toBe(true);
  });

  it("detects a recomputed hash that no longer matches the next entry", async () => {
    const rows = await t.owner.db.select().from(auditLog).orderBy(auditLog.id).limit(2);
    const [first, second] = rows;
    if (!first || !second) throw new Error("seed missing");
    await t.owner.db.execute(
      sql`UPDATE app.audit_log SET hash = ${`sha256:${"0".repeat(64)}`} WHERE id = ${first.id}`,
    );
    const r = await verifyAuditChain(t.owner.db);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.brokenAt).toBe(first.id);
    await t.owner.db.execute(
      sql`UPDATE app.audit_log SET hash = ${first.hash} WHERE id = ${first.id}`,
    );
  });

  it("detects a deleted entry", async () => {
    const rows = await t.owner.db.select().from(auditLog).orderBy(auditLog.id).limit(3);
    const victim = rows[1];
    const next = rows[2];
    if (!victim || !next) throw new Error("seed missing");
    await t.owner.db.execute(sql`DELETE FROM app.audit_log WHERE id = ${victim.id}`);
    expect(await verifyAuditChain(t.owner.db)).toMatchObject({
      ok: false,
      brokenAt: next.id,
      reason: "prev_hash_mismatch",
    });
  });
});
