import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyAuditChain } from "../src/audit/audit.js";
import { authUser } from "../src/db/schema/index.js";
import { ensureSystemActor, promoteFirstOwner } from "../src/processes/bootstrap.js";
import { createTestDatabase, type TestDatabase } from "./helpers.js";

let t: TestDatabase;
const now = new Date("2026-09-22T12:00:00Z");
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.drop();
});

describe("bootstrap", () => {
  it("creates the system actor once", async () => {
    const id = uuidv7();
    expect(await ensureSystemActor(t.app.db, id, now)).toBe(true);
    expect(await ensureSystemActor(t.app.db, id, now)).toBe(false);
    const [u] = await t.app.db.select().from(authUser).where(eq(authUser.id, id));
    expect(u?.email).toBe("system@char.pub");
  });

  it("promotes the first owner only while there is none", async () => {
    const a = uuidv7();
    const b = uuidv7();
    await t.app.db.insert(authUser).values([
      { id: a, email: "first@example.com", name: "First" },
      { id: b, email: "second@example.com", name: "Second", role: "moderator" },
    ]);
    expect(await promoteFirstOwner(t.app.db, "nobody@example.com", now)).toEqual({
      ok: false,
      code: "bootstrap.user_not_found",
    });
    expect(await promoteFirstOwner(t.app.db, "FIRST@example.com", now)).toEqual({
      ok: true,
      user_id: a,
    });
    expect(await promoteFirstOwner(t.app.db, "second@example.com", now)).toEqual({
      ok: false,
      code: "bootstrap.owner_exists",
    });
    const [u] = await t.app.db.select().from(authUser).where(eq(authUser.id, b));
    expect(u?.role).toBe("moderator");
    expect((await verifyAuditChain(t.app.db)).ok).toBe(true);
  });
});
