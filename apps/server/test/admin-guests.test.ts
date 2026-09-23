/**
 * admin 的访客管理：列表（不含任何邮箱信息）、停用（立即删除会话、写审计）、恢复，
 * 以及能力要求与封禁用户相同。
 */
import { and, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseGuestId } from "../src/admin/routes/guests.js";
import { createGuestSession, guestPrincipalFromSession, newGuestId } from "../src/auth/guest.js";
import { auditLog, guestSessions, guests, moderationActions } from "../src/db/schema/index.js";
import { type AdminHarness, createAdminHarness } from "./fixtures/admin-harness.js";

let h: AdminHarness;
const REASON = "spam contributions from this guest";

beforeAll(async () => {
  h = await createAdminHarness();
});
afterAll(async () => {
  await h.close();
});

async function seedGuest(name: string, createdAt: Date): Promise<string> {
  const guestId = newGuestId(uuidv7());
  await h.t.app.db.insert(guests).values({
    guestId,
    displayName: name,
    emailHmac: `hmac-${guestId}`,
    verifiedAt: createdAt,
    verificationKind: "email",
    createdAt,
  });
  return guestId;
}

describe("admin guest management", () => {
  let target = "";
  let token = "";

  beforeAll(async () => {
    const base = Date.parse("2026-09-01T00:00:00Z");
    for (let i = 0; i < 3; i++) await seedGuest(`Visitor ${i}`, new Date(base + i * 60_000));
    target = await seedGuest("Noisy visitor", new Date(base + 10 * 60_000));
    ({ token } = await createGuestSession(h.t.app.db, {
      id: uuidv7(),
      guestId: target,
      now: h.now(),
    }));
  });

  it("parses guest IDs and plain UUIDs", () => {
    const uuid = uuidv7();
    expect(parseGuestId(uuid)).toBe(newGuestId(uuid));
    expect(parseGuestId(newGuestId(uuid))).toBe(newGuestId(uuid));
    expect(parseGuestId("usr_01h0000000000000000000000")).toBeNull();
    expect(parseGuestId("nonsense")).toBeNull();
  });

  it("lists guests newest first with a cursor and never exposes email data", async () => {
    const first = await h.call(h.staff.viewer.email, "GET", "/v1/admin/guests?limit=2");
    expect(first.status).toBe(200);
    const items = first.json.items as Record<string, unknown>[];
    expect(items.map((g) => g.display_name)).toEqual(["Noisy visitor", "Visitor 2"]);
    expect(items[0]).toMatchObject({ id: target, disabled: false, sessions: 1, contributions: 0 });
    // `verification_kind` 只说明验证方式；不返回邮箱的 HMAC，也没有任何邮箱字段。
    expect(JSON.stringify(first.json)).not.toContain("hmac-");
    for (const g of items) expect(Object.keys(g).some((k) => /email|hmac/i.test(k))).toBe(false);

    const cursor = encodeURIComponent(String(first.json.next_cursor));
    const second = await h.call(
      h.staff.viewer.email,
      "GET",
      `/v1/admin/guests?limit=2&cursor=${cursor}`,
    );
    expect((second.json.items as { display_name: string }[]).map((g) => g.display_name)).toEqual([
      "Visitor 1",
      "Visitor 0",
    ]);
    expect(second.json.next_cursor).toBeNull();

    const bad = await h.call(h.staff.viewer.email, "GET", "/v1/admin/guests?cursor=garbage");
    expect(bad).toMatchObject({ status: 422, json: { code: "request.invalid" } });
  });

  it("requires the same capability as banning users", async () => {
    const r = await h.call(h.staff.moderator.email, "POST", `/v1/admin/guests/${target}/disable`, {
      reason: REASON,
    });
    expect(r).toMatchObject({ status: 403, json: { code: "admin.forbidden" } });
    const short = await h.call(
      h.staff.trust_safety.email,
      "POST",
      `/v1/admin/guests/${target}/disable`,
      { reason: "spam" },
    );
    expect(short).toMatchObject({ status: 422, json: { code: "admin.reason_required" } });
    const missing = await h.call(
      h.staff.trust_safety.email,
      "POST",
      `/v1/admin/guests/${newGuestId(uuidv7())}/disable`,
      { reason: REASON },
    );
    expect(missing.status).toBe(404);
  });

  it("disabling revokes every session at once and writes the audit trail", async () => {
    expect(await guestPrincipalFromSession(h.t.app.db, token, h.now())).toMatchObject({
      kind: "guest",
      guest_id: target,
    });
    const r = await h.call(
      h.staff.trust_safety.email,
      "POST",
      `/v1/admin/guests/${target}/disable`,
      {
        reason: REASON,
      },
    );
    expect(r).toMatchObject({
      status: 200,
      json: { ok: true, already_disabled: false, sessions_revoked: 1 },
    });
    expect(await guestPrincipalFromSession(h.t.app.db, token, h.now())).toBeNull();
    expect(
      await h.t.app.db.select().from(guestSessions).where(eq(guestSessions.guestId, target)),
    ).toHaveLength(0);
    const [g] = await h.t.app.db.select().from(guests).where(eq(guests.guestId, target));
    expect(g?.disabledAt).not.toBeNull();

    const audit = await h.t.app.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "guest.disable"), eq(auditLog.subject, `guest:${target}`)));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.after).toMatchObject({ sessions_revoked: 1, reason: REASON });
    const actions = await h.t.app.db
      .select()
      .from(moderationActions)
      .where(eq(moderationActions.action, "guest.disable"));
    expect(actions.map((a) => a.subject)).toEqual([{ guest: target }]);

    const view = await h.call(h.staff.viewer.email, "GET", `/v1/admin/guests/${target}`);
    expect(view.json).toMatchObject({ disabled: true, sessions: 0 });
    const disabledOnly = await h.call(
      h.staff.viewer.email,
      "GET",
      "/v1/admin/guests?status=disabled",
    );
    expect((disabledOnly.json.items as { id: string }[]).map((g) => g.id)).toEqual([target]);
  });

  it("disabling again changes nothing and is not audited twice", async () => {
    const r = await h.call(h.staff.admin.email, "POST", `/v1/admin/guests/${target}/disable`, {
      reason: REASON,
    });
    expect(r.json).toMatchObject({ ok: true, already_disabled: true, sessions_revoked: 0 });
    const audit = await h.t.app.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "guest.disable"));
    expect(audit).toHaveLength(1);
  });

  it("enabling restores the guest; the old session stays revoked", async () => {
    const r = await h.call(h.staff.admin.email, "POST", `/v1/admin/guests/${target}/enable`, {
      reason: "appeal accepted after review",
    });
    expect(r.json).toMatchObject({ ok: true, changed: true });
    const [g] = await h.t.app.db.select().from(guests).where(eq(guests.guestId, target));
    expect(g?.disabledAt).toBeNull();
    expect(await guestPrincipalFromSession(h.t.app.db, token, h.now())).toBeNull();
    const audit = await h.t.app.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "guest.enable"));
    expect(audit).toHaveLength(1);

    const again = await h.call(h.staff.admin.email, "POST", `/v1/admin/guests/${target}/enable`, {
      reason: "appeal accepted after review",
    });
    expect(again.json).toMatchObject({ ok: true, changed: false });
  });
});
