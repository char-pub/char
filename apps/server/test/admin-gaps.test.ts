/**
 * admin 功能清单中补齐的部分：锁定上传、吊销会话与 Token、namespace 转让（四眼确认）、
 * DMCA 停止访问 / 反通知 / 恢复 / 案件导出、审计导出、隔离证据的一次性下载、强制员工登出、
 * admin API 的跨域预检。每个测试结束后审计链仍然完整。
 */
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { register as registerImports } from "../src/api/routes/imports.js";
import { register as registerUploads } from "../src/api/routes/uploads.js";
import { createApi } from "../src/api/server.js";
import { verifyAuditChain } from "../src/audit/audit.js";
import type { Principal } from "../src/authz/authorize.js";
import {
  apiTokens,
  auditLog,
  authSession,
  authUser,
  creations,
  csamIncidents,
  legalRequests,
  moderationActions,
  namespaceMembers,
  namespaces,
  staffApprovals,
  uploadLocks,
} from "../src/db/schema/index.js";
import { type AdminHarness, createAdminHarness, ORIGIN } from "./fixtures/admin-harness.js";
import { createNamespace, createUser, publishRelease } from "./fixtures/published.js";

let h: AdminHarness;
beforeAll(async () => {
  h = await createAdminHarness();
});
afterAll(async () => {
  await h.close();
});
afterEach(async () => {
  expect((await verifyAuditChain(h.t.app.db)).ok).toBe(true);
});

const REASON = "documented moderation decision";
const MINUTE = 60 * 1000;

async function auditActions(subject: string): Promise<string[]> {
  const rows = await h.t.app.db
    .select({ action: auditLog.action })
    .from(auditLog)
    .where(eq(auditLog.subject, subject));
  return rows.map((r) => r.action);
}

async function addSessions(userId: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await h.t.app.db.insert(authSession).values({
      id: uuidv7(),
      userId,
      token: randomBytes(16).toString("hex"),
      expiresAt: new Date(h.now().getTime() + 24 * 60 * MINUTE),
    });
  }
}

async function publishCharacter(slug: string, name: string) {
  const owner = await createUser(h.t.app.db, { name: slug });
  const ns = await createNamespace(h.t.app.db, slug, owner);
  const r = await publishRelease({
    db: h.t.app.db,
    cas: h.services.cas,
    namespaceId: ns,
    creation: {
      ref: `@${slug}/${name}`,
      type: "character",
      display_name: name,
      fragments: [
        {
          id: "description",
          stable: true,
          kind: "character",
          content: { type: "text", text: `{{self}} is ${name}.` },
        },
      ],
      meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
    },
    label: "1.0.0",
    publicAssetBaseUrl: h.services.publicAssetBaseUrl,
  });
  return { ...r, owner, ns };
}

async function creationStatus(id: string): Promise<string | undefined> {
  const [row] = await h.t.app.db
    .select({ status: creations.status })
    .from(creations)
    .where(eq(creations.id, id));
  return row?.status;
}

describe("upload lock", () => {
  const WWW = "https://www.char.pub";
  const publicApi = () =>
    createApi({
      services: h.services,
      originSecrets: [],
      allowedOrigins: [WWW],
      sessionPrincipal: async (req): Promise<Principal | null> => {
        const id = req.headers.get("x-test-user");
        return id ? { kind: "user", user_id: id, banned: false } : null;
      },
      modules: [registerUploads, registerImports],
    });
  const post = (api: ReturnType<typeof publicApi>, path: string, user: string, body: unknown) =>
    api.request(path, {
      method: "POST",
      headers: { origin: WWW, "content-type": "application/json", "x-test-user": user },
      body: JSON.stringify(body),
    });
  const uploadBody = {
    purpose: "asset",
    content_type: "image/png",
    size: 1024,
    sha256: `sha256:${"b".repeat(64)}`,
  };

  it("blocks new uploads and imports until unlocked, and records both changes", async () => {
    const user = await createUser(h.t.app.db, { name: "locked" });
    await createNamespace(h.t.app.db, "locked-ns", user);
    const api = publicApi();

    const lock = await h.call(
      h.staff.trust_safety.email,
      "POST",
      `/v1/admin/users/${user}/upload-lock`,
      { locked: true, reason: REASON },
    );
    expect(lock).toMatchObject({ status: 200, json: { uploads_locked: true } });

    const up = await post(api, "/v1/uploads", user, uploadBody);
    expect(up.status).toBe(403);
    expect(((await up.json()) as { code: string }).code).toBe("upload.locked");
    const imp = await post(api, "/v1/imports", user, {
      upload: uuidv7(),
      namespace: "locked-ns",
      name: "card",
    });
    expect(imp.status).toBe(403);
    expect(((await imp.json()) as { code: string }).code).toBe("upload.locked");

    const detail = await h.call(h.staff.viewer.email, "GET", `/v1/admin/users/${user}`);
    expect(detail.json).toMatchObject({ uploads_locked: true });

    // 重复锁定不产生新的记录。
    await h.call(h.staff.trust_safety.email, "POST", `/v1/admin/users/${user}/upload-lock`, {
      locked: true,
      reason: REASON,
    });
    expect(await auditActions(`user:${user}`)).toEqual(["user.lock_uploads"]);

    await h.call(h.staff.admin.email, "POST", `/v1/admin/users/${user}/upload-lock`, {
      locked: false,
      reason: REASON,
    });
    expect(await h.t.app.db.select().from(uploadLocks).where(eq(uploadLocks.userId, user))).toEqual(
      [],
    );
    const again = await post(api, "/v1/uploads", user, uploadBody);
    expect(again.status).toBe(201);
    expect(await auditActions(`user:${user}`)).toEqual([
      "user.lock_uploads",
      "user.unlock_uploads",
    ]);
  });

  it("moderators cannot lock uploads", async () => {
    const user = await createUser(h.t.app.db);
    const r = await h.call(h.staff.moderator.email, "POST", `/v1/admin/users/${user}/upload-lock`, {
      locked: true,
      reason: REASON,
    });
    expect(r).toMatchObject({ status: 403, json: { code: "admin.forbidden" } });
  });
});

describe("revoke sessions and tokens", () => {
  it("signs the user out everywhere without banning the account", async () => {
    const user = await createUser(h.t.app.db);
    await addSessions(user, 2);
    await h.t.app.db.insert(apiTokens).values({
      id: uuidv7(),
      userId: user,
      name: "cli",
      prefix: "cp_pat_x",
      tokenHash: randomBytes(32).toString("hex"),
    });
    const r = await h.call(h.staff.trust_safety.email, "POST", `/v1/admin/users/${user}/revoke`, {
      reason: REASON,
    });
    expect(r).toMatchObject({ status: 200, json: { sessions_revoked: 2, tokens_revoked: 1 } });
    expect(await h.t.app.db.select().from(authSession).where(eq(authSession.userId, user))).toEqual(
      [],
    );
    const [token] = await h.t.app.db.select().from(apiTokens).where(eq(apiTokens.userId, user));
    expect(token?.revokedAt).not.toBeNull();
    const [u] = await h.t.app.db.select().from(authUser).where(eq(authUser.id, user));
    expect(u?.banned).toBe(false);
    expect(await auditActions(`user:${user}`)).toEqual(["user.revoke_credentials"]);

    const nothing = await h.call(
      h.staff.trust_safety.email,
      "POST",
      `/v1/admin/users/${user}/revoke`,
      { sessions: false, tokens: false, reason: REASON },
    );
    expect(nothing).toMatchObject({ status: 422, json: { code: "admin.nothing_to_revoke" } });
  });
});

describe("namespace transfer", () => {
  async function member(ns: string, user: string) {
    const [m] = await h.t.app.db
      .select()
      .from(namespaceMembers)
      .where(and(eq(namespaceMembers.namespaceId, ns), eq(namespaceMembers.userId, user)));
    return m?.role ?? null;
  }

  it("needs a second staff member and then moves ownership", async () => {
    const from = await createUser(h.t.app.db);
    const ns = await createNamespace(h.t.app.db, "xfer-a", from);
    const to = await createUser(h.t.app.db);
    const [target] = await h.t.app.db.select().from(authUser).where(eq(authUser.id, to));

    const req = await h.call(h.staff.admin.email, "POST", "/v1/admin/namespaces/xfer-a/transfer", {
      to: target?.email,
      reason: REASON,
    });
    expect(req.status).toBe(202);
    const approval = req.json.approval as { id: string; kind: string };
    expect(approval.kind).toBe("namespace.transfer");
    // 请求发出后、确认之前，所有权不变。
    expect(await member(ns, from)).toBe("owner");

    const dup = await h.call(h.staff.owner.email, "POST", "/v1/admin/namespaces/xfer-a/transfer", {
      to,
      reason: REASON,
    });
    expect(dup).toMatchObject({ status: 409, json: { code: "namespace.transfer_pending" } });

    const self = await h.call(
      h.staff.admin.email,
      "POST",
      `/v1/admin/approvals/${approval.id}/confirm`,
      { reason: REASON },
    );
    expect(self).toMatchObject({ status: 403, json: { code: "admin.four_eyes_required" } });

    const ok = await h.call(
      h.staff.owner.email,
      "POST",
      `/v1/admin/approvals/${approval.id}/confirm`,
      { reason: REASON },
    );
    expect(ok).toMatchObject({ status: 200, json: { kind: "namespace.transfer" } });
    expect(await member(ns, from)).toBeNull();
    expect(await member(ns, to)).toBe("owner");
    expect(await auditActions(`namespace:${ns}`)).toContain("namespace.transfer");
  });

  it("rejects targets that already own a personal namespace, system namespaces and no-ops", async () => {
    const c = await createUser(h.t.app.db);
    await createNamespace(h.t.app.db, "xfer-c", c);
    const d = await createUser(h.t.app.db);
    await createNamespace(h.t.app.db, "xfer-d", d);
    const limit = await h.call(
      h.staff.admin.email,
      "POST",
      "/v1/admin/namespaces/xfer-d/transfer",
      {
        to: c,
        reason: REASON,
      },
    );
    expect(limit).toMatchObject({ status: 409, json: { code: "namespace.limit" } });

    const same = await h.call(h.staff.admin.email, "POST", "/v1/admin/namespaces/xfer-d/transfer", {
      to: d,
      reason: REASON,
    });
    expect(same).toMatchObject({ status: 422, json: { code: "namespace.same_owner" } });

    await h.t.app.db.insert(namespaces).values({ id: uuidv7(), slug: "xfer-sys", kind: "system" });
    const sys = await h.call(
      h.staff.admin.email,
      "POST",
      "/v1/admin/namespaces/xfer-sys/transfer",
      { to: await createUser(h.t.app.db), reason: REASON },
    );
    expect(sys).toMatchObject({ status: 422, json: { code: "namespace.not_transferable" } });

    const nobody = await h.call(
      h.staff.admin.email,
      "POST",
      "/v1/admin/namespaces/xfer-d/transfer",
      { to: "nobody@example.test", reason: REASON },
    );
    expect(nobody).toMatchObject({
      status: 422,
      json: { code: "namespace.transfer_target_not_found" },
    });
  });

  it("refuses to execute when the owner changed after the request", async () => {
    const e = await createUser(h.t.app.db);
    const ns = await createNamespace(h.t.app.db, "xfer-e", e);
    const f = await createUser(h.t.app.db);
    const req = await h.call(h.staff.admin.email, "POST", "/v1/admin/namespaces/xfer-e/transfer", {
      to: f,
      reason: REASON,
    });
    const id = (req.json.approval as { id: string }).id;
    const g = await createUser(h.t.app.db);
    await h.t.owner.db
      .update(namespaceMembers)
      .set({ userId: g })
      .where(eq(namespaceMembers.namespaceId, ns));
    const r = await h.call(h.staff.owner.email, "POST", `/v1/admin/approvals/${id}/confirm`, {
      reason: REASON,
    });
    expect(r).toMatchObject({ status: 422, json: { code: "approval.stale" } });
    const [a] = await h.t.app.db.select().from(staffApprovals).where(eq(staffApprovals.id, id));
    expect(a?.status).toBe("pending");
    expect(await member(ns, g)).toBe("owner");
  });
});

describe("DMCA counter-notice", () => {
  async function registerDmca(subject: string): Promise<string> {
    const r = await h.call(h.staff.legal.email, "POST", "/v1/admin/legal-requests", {
      kind: "dmca",
      requester: { name: "Rights Holder", email: "rights@example.com" },
      received_at: h.now().toISOString(),
      subjects: [subject],
      reason: REASON,
    });
    expect(r.status).toBe(201);
    return r.json.id as string;
  }
  const counterNotice = {
    counter_notice: {
      name: "Original Author",
      email: "author@example.com",
      address: "1 Example Street",
      statement: "I have a good faith belief the material was removed by mistake.",
    },
    reason: REASON,
  };

  it("hides, registers the counter-notice, and restores only inside the window", async () => {
    const start = h.now();
    const pub = await publishCharacter("dmca-a", "song");
    const lr = await registerDmca("@dmca-a/song");

    const early = await h.call(
      h.staff.legal.email,
      "POST",
      `/v1/admin/legal-requests/${lr}/counter-notice`,
      { ...counterNotice, received_at: start.toISOString() },
    );
    expect(early).toMatchObject({ status: 409, json: { code: "legal.not_actioned" } });

    const hide = await h.call(
      h.staff.legal.email,
      "POST",
      `/v1/admin/legal-requests/${lr}/disable-access`,
      { creations: ["@dmca-a/song"], reason: REASON },
    );
    expect(hide).toMatchObject({ status: 200, json: { hidden: 1 } });
    expect(await creationStatus(pub.creationId)).toBe("hidden");

    // 2026-09-22 是星期二：第 12 个工作日是 10 月 8 日，第 14 个是 10 月 12 日。
    const cn = await h.call(
      h.staff.legal.email,
      "POST",
      `/v1/admin/legal-requests/${lr}/counter-notice`,
      { ...counterNotice, received_at: start.toISOString() },
    );
    expect(cn).toMatchObject({
      status: 200,
      json: {
        restore_not_before: "2026-10-08T12:00:00.000Z",
        restore_deadline: "2026-10-12T12:00:00.000Z",
      },
    });
    const [row] = await h.t.app.db.select().from(legalRequests).where(eq(legalRequests.id, lr));
    // 反通知的申请人信息只以密文保存。
    expect(JSON.stringify(row?.counterNotice)).not.toContain("Original Author");

    const tooSoon = await h.call(
      h.staff.legal.email,
      "POST",
      `/v1/admin/legal-requests/${lr}/restore`,
      {
        reason: REASON,
      },
    );
    expect(tooSoon).toMatchObject({
      status: 409,
      json: { code: "legal.restore_window_not_open" },
    });

    h.setNow(new Date("2026-10-08T12:00:00Z"));
    try {
      const restored = await h.call(
        h.staff.legal.email,
        "POST",
        `/v1/admin/legal-requests/${lr}/restore`,
        { reason: REASON },
      );
      expect(restored).toMatchObject({
        status: 200,
        json: { kept_hidden: [], not_restorable: 0, late: false },
      });
      expect((restored.json.restored as string[]).length).toBe(1);
      expect(await creationStatus(pub.creationId)).toBe("active");
      const detail = await h.call(h.staff.legal.email, "GET", `/v1/admin/legal-requests/${lr}`);
      expect(detail.json).toMatchObject({
        status: "closed",
        restored_at: "2026-10-08T12:00:00.000Z",
        counter_notice: { name: "Original Author" },
      });
      expect(await auditActions(`legal_request:${lr}`)).toEqual([
        "legal.register",
        "legal.disable_access",
        "legal.counter_notice",
        "legal.restore",
        "legal.view",
      ]);
    } finally {
      h.setNow(start);
    }
  });

  it("keeps content hidden for other reasons and blocks restore after a court action", async () => {
    const start = h.now();
    const pub = await publishCharacter("dmca-b", "tune");
    await h.call(
      h.staff.moderator.email,
      "POST",
      `/v1/admin/creations/${pub.creationId}/visibility`,
      {
        hidden: true,
        reason: REASON,
      },
    );
    const lr = await registerDmca("@dmca-b/tune");
    await h.call(h.staff.legal.email, "POST", `/v1/admin/legal-requests/${lr}/disable-access`, {
      creations: [pub.creationId],
      reason: REASON,
    });
    await h.call(h.staff.legal.email, "POST", `/v1/admin/legal-requests/${lr}/counter-notice`, {
      ...counterNotice,
      received_at: start.toISOString(),
    });
    h.setNow(new Date("2026-10-09T12:00:00Z"));
    try {
      const r = await h.call(
        h.staff.legal.email,
        "POST",
        `/v1/admin/legal-requests/${lr}/restore`,
        {
          reason: REASON,
        },
      );
      expect(r.status).toBe(200);
      expect((r.json.kept_hidden as string[]).length).toBe(1);
      expect(await creationStatus(pub.creationId)).toBe("hidden");
      // 法律请求的隐藏记录已撤销，版主的隐藏记录仍然有效。
      const open = await h.t.app.db
        .select({ legal: moderationActions.legalRequestId, reverted: moderationActions.revertedBy })
        .from(moderationActions)
        .where(eq(moderationActions.action, "creation.hide"));
      const mine = open.filter((a) => a.legal === lr);
      expect(mine.every((a) => a.reverted !== null)).toBe(true);
    } finally {
      h.setNow(start);
    }

    const pub2 = await publishCharacter("dmca-c", "beat");
    const lr2 = await registerDmca("@dmca-c/beat");
    await h.call(h.staff.legal.email, "POST", `/v1/admin/legal-requests/${lr2}/disable-access`, {
      creations: ["@dmca-c/beat"],
      reason: REASON,
    });
    await h.call(h.staff.legal.email, "POST", `/v1/admin/legal-requests/${lr2}/counter-notice`, {
      ...counterNotice,
      received_at: start.toISOString(),
    });
    const court = await h.call(
      h.staff.legal.email,
      "POST",
      `/v1/admin/legal-requests/${lr2}/court-action`,
      { reason: REASON },
    );
    expect(court.status).toBe(200);
    h.setNow(new Date("2026-10-09T12:00:00Z"));
    try {
      const r = await h.call(
        h.staff.legal.email,
        "POST",
        `/v1/admin/legal-requests/${lr2}/restore`,
        {
          reason: REASON,
        },
      );
      expect(r).toMatchObject({ status: 409, json: { code: "legal.court_action_filed" } });
      expect(await creationStatus(pub2.creationId)).toBe("hidden");
    } finally {
      h.setNow(start);
    }
  });

  it("counter-notices only apply to DMCA requests; disable-access is all or nothing", async () => {
    const r = await h.call(h.staff.legal.email, "POST", "/v1/admin/legal-requests", {
      kind: "court",
      requester: { name: "Court" },
      received_at: h.now().toISOString(),
      subjects: ["@x/y"],
      reason: REASON,
    });
    const id = r.json.id as string;
    const cn = await h.call(
      h.staff.legal.email,
      "POST",
      `/v1/admin/legal-requests/${id}/counter-notice`,
      {
        ...counterNotice,
        received_at: h.now().toISOString(),
      },
    );
    expect(cn).toMatchObject({ status: 422, json: { code: "legal.counter_notice_dmca_only" } });

    const pub = await publishCharacter("dmca-d", "loop");
    const bad = await h.call(
      h.staff.legal.email,
      "POST",
      `/v1/admin/legal-requests/${id}/disable-access`,
      {
        creations: ["@dmca-d/loop", "@nobody/missing"],
        reason: REASON,
      },
    );
    expect(bad).toMatchObject({ status: 422, json: { code: "legal.subject_not_found" } });
    expect(await creationStatus(pub.creationId)).toBe("active");
  });

  it("exports the case record with decrypted requester data, only for legal staff", async () => {
    await publishCharacter("dmca-e", "hum");
    const lr = await registerDmca("@dmca-e/hum");
    await h.call(h.staff.legal.email, "POST", `/v1/admin/legal-requests/${lr}/disable-access`, {
      creations: ["@dmca-e/hum"],
      reason: REASON,
    });
    const denied = await h.call(
      h.staff.admin.email,
      "POST",
      `/v1/admin/legal-requests/${lr}/export`,
      {
        reason: REASON,
      },
    );
    expect(denied).toMatchObject({ status: 403, json: { code: "admin.forbidden" } });

    const res = await h.raw(h.staff.legal.email, "POST", `/v1/admin/legal-requests/${lr}/export`, {
      reason: REASON,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const record = (await res.json()) as {
      format: string;
      request: { requester: { email: string }; status: string };
      actions: { action: string }[];
      audit: { action: string }[];
    };
    expect(record.format).toBe("char-pub.legal-case/1");
    expect(record.request.requester.email).toBe("rights@example.com");
    expect(record.actions.map((a) => a.action)).toEqual(["creation.hide"]);
    expect(record.audit.map((a) => a.action)).toEqual(["legal.register", "legal.disable_access"]);
    expect(await auditActions(`legal_request:${lr}`)).toContain("legal.export");
  });
});

describe("audit export", () => {
  it("exports matching entries as NDJSON and audits the export", async () => {
    await h.call(h.staff.legal.email, "POST", "/v1/admin/legal-requests", {
      kind: "other",
      requester: { name: "Someone" },
      received_at: h.now().toISOString(),
      subjects: ["@a/b"],
      reason: REASON,
    });
    const res = await h.raw(h.staff.admin.email, "POST", "/v1/admin/audit/export", {
      action: "legal.register",
      reason: REASON,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    expect(res.headers.get("x-next-before")).toBeNull();
    const lines = (await res.text())
      .trim()
      .split("\n")
      .map(
        (l) =>
          JSON.parse(l) as {
            id: string;
            action: string;
            after: Record<string, unknown>;
          },
      );
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.action === "legal.register")).toBe(true);
    // 审计里本来就没有申请人信息。
    expect(JSON.stringify(lines)).not.toContain("Someone");

    const oldest = lines.at(-1)?.id ?? "0";
    const before = await h.raw(h.staff.admin.email, "POST", "/v1/admin/audit/export", {
      action: "legal.register",
      before: oldest,
      reason: REASON,
    });
    const rest = (await before.text()).trim();
    expect(
      rest === "" || rest.split("\n").every((l) => BigInt(JSON.parse(l).id) < BigInt(oldest)),
    ).toBe(true);
    expect(await auditActions("audit_log")).toContain("audit.export");

    const viewer = await h.call(h.staff.viewer.email, "POST", "/v1/admin/audit/export", {
      reason: REASON,
    });
    expect(viewer).toMatchObject({ status: 403, json: { code: "admin.forbidden" } });
  });
});

describe("quarantined evidence", () => {
  async function incident() {
    // 合成的测试字节，不是任何真实素材。
    const bytes = new TextEncoder().encode(`synthetic evidence ${uuidv7()}`);
    const ev = await h.services.cas.putEvidence(bytes, "image/png");
    const id = uuidv7();
    await h.t.app.db.insert(csamIncidents).values({
      id,
      blobDigest: ev.digest,
      reason: "staff_flag",
      evidenceKey: ev.key,
    });
    return { id, bytes, digest: ev.digest };
  }

  it("shows metadata to legal only and serves a one-time attachment download", async () => {
    const inc = await incident();
    const ts = await h.call(
      h.staff.trust_safety.email,
      "GET",
      `/v1/admin/csam-incidents/${inc.id}/evidence`,
    );
    expect(ts).toMatchObject({ status: 403, json: { code: "admin.forbidden" } });

    const meta = await h.call(
      h.staff.legal.email,
      "GET",
      `/v1/admin/csam-incidents/${inc.id}/evidence`,
    );
    expect(meta).toMatchObject({
      status: 200,
      json: {
        evidence_digest: inc.digest,
        size: inc.bytes.byteLength,
        media_type: "image/png",
        present: true,
        retain_until: null,
      },
    });

    const noReason = await h.call(
      h.staff.legal.email,
      "POST",
      `/v1/admin/csam-incidents/${inc.id}/evidence/download`,
      {},
    );
    expect(noReason).toMatchObject({ status: 422, json: { code: "admin.reason_required" } });

    const ticket = await h.call(
      h.staff.legal.email,
      "POST",
      `/v1/admin/csam-incidents/${inc.id}/evidence/download`,
      { reason: REASON },
    );
    expect(ticket.status).toBe(201);
    const url = ticket.json.url as string;
    expect(new Date(ticket.json.expires_at as string).getTime() - h.now().getTime()).toBe(
      5 * MINUTE,
    );

    // 只有签发给的员工能用。
    const other = await h.raw(h.staff.owner.email, "GET", url);
    expect(other.status).toBe(404);

    const dl = await h.raw(h.staff.legal.email, "GET", url);
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toBe("application/octet-stream");
    expect(dl.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(dl.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await dl.arrayBuffer())).toEqual(inc.bytes);

    const reuse = await h.raw(h.staff.legal.email, "GET", url);
    expect(reuse.status).toBe(404);
    expect(await auditActions(`csam_incident:${inc.id}`)).toEqual([
      "csam.evidence_ticket",
      "csam.evidence_download",
    ]);
  });

  it("tickets expire after five minutes", async () => {
    const inc = await incident();
    const start = h.now();
    const ticket = await h.call(
      h.staff.legal.email,
      "POST",
      `/v1/admin/csam-incidents/${inc.id}/evidence/download`,
      { reason: REASON },
    );
    h.setNow(new Date(start.getTime() + 5 * MINUTE + 1000));
    try {
      const r = await h.raw(h.staff.legal.email, "GET", ticket.json.url as string);
      expect(r.status).toBe(404);
    } finally {
      h.setNow(start);
    }
  });
});

describe("staff sign-out", () => {
  it("revokes the staff member's sessions and says when Access is not configured", async () => {
    await addSessions(h.staff.moderator.id, 2);
    const r = await h.call(
      h.staff.owner.email,
      "POST",
      `/v1/admin/staff/${h.staff.moderator.id}/sign-out`,
      { reason: REASON },
    );
    expect(r).toMatchObject({
      status: 200,
      json: { sessions_revoked: 2, access: "not_configured" },
    });
    const notStaff = await h.call(
      h.staff.owner.email,
      "POST",
      `/v1/admin/staff/${await createUser(h.t.app.db)}/sign-out`,
      { reason: REASON },
    );
    expect(notStaff.status).toBe(404);
    const admin = await h.call(
      h.staff.admin.email,
      "POST",
      `/v1/admin/staff/${h.staff.moderator.id}/sign-out`,
      { reason: REASON },
    );
    expect(admin).toMatchObject({ status: 403, json: { code: "admin.forbidden" } });
  });

  it("calls the Access revoker when it is configured", async () => {
    const calls: string[] = [];
    const h2 = await createAdminHarness({
      revokeAccess: async (email) => {
        calls.push(email);
        return "revoked";
      },
    });
    try {
      const r = await h2.call(
        h2.staff.owner.email,
        "POST",
        `/v1/admin/staff/${h2.staff.legal.id}/sign-out`,
        { reason: REASON },
      );
      expect(r).toMatchObject({ status: 200, json: { access: "revoked" } });
      expect(calls).toEqual([h2.staff.legal.email]);
    } finally {
      await h2.close();
    }
  });
});

describe("cross-origin requests from the admin SPA", () => {
  it("answers preflight for the admin origin without an Access token", async () => {
    const ok = await h.request("/v1/admin/audit/export", {
      method: "OPTIONS",
      headers: { origin: ORIGIN, "access-control-request-method": "POST" },
    });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(ok.headers.get("access-control-allow-credentials")).toBe("true");

    const evil = await h.request("/v1/admin/audit/export", {
      method: "OPTIONS",
      headers: { origin: "https://evil.example", "access-control-request-method": "POST" },
    });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
  });
});
