/**
 * admin 业务路由的行为：下架与四眼确认、封禁与 CSAM 锁定、强制评级、举报处理、
 * Namespace 治理、法律请求加密、任务面板与员工管理。每组测试后审计链仍然完整。
 */
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { decryptJson, type EncryptedValue } from "../src/admin/routes/legal.js";
import { verifyAuditChain } from "../src/audit/audit.js";
import { generateToken, hashToken, principalFromToken } from "../src/auth/tokens.js";
import {
  apiTokens,
  authUser,
  blobRefs,
  creations,
  legalRequests,
  namespaceRedirects,
  namespaces,
  releaseFragments,
  releases,
  reports,
  staffApprovals,
} from "../src/db/schema/index.js";
import { toPublicId } from "../src/registry/read.js";
import { type AdminHarness, createAdminHarness } from "./fixtures/admin-harness.js";
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
const HOUR = 60 * 60 * 1000;

function character(slug: string, name: string, rating: "general" | "teen" = "general") {
  return {
    ref: `@${slug}/${name}`,
    type: "character" as const,
    display_name: name,
    fragments: [
      {
        id: "description",
        stable: true,
        kind: "character" as const,
        content: { type: "text" as const, text: `{{self}} is ${name}.` },
      },
    ],
    meta: { default_locale: "en", rating, rights: "original" as const, license: "CC-BY-4.0" },
  };
}

async function publish(slug: string, name: string, rating: "general" | "teen" = "general") {
  const owner = await createUser(h.t.app.db, { name: slug });
  const ns = await createNamespace(h.t.app.db, slug, owner);
  const r = await publishRelease({
    db: h.t.app.db,
    cas: h.services.cas,
    namespaceId: ns,
    creation: character(slug, name, rating),
    label: "1.0.0",
    publicAssetBaseUrl: h.services.publicAssetBaseUrl,
  });
  return { ...r, owner, ns };
}

describe("tombstone", () => {
  it("previews and executes a small takedown immediately", async () => {
    const r = await publish("small", "alice");
    const preview = await h.call(
      h.staff.trust_safety.email,
      "POST",
      "/v1/admin/tombstones/preview",
      {
        subject: "@small/alice",
      },
    );
    expect(preview.status).toBe(200);
    expect(preview.json).toMatchObject({ requires_four_eyes: false });
    const exec = await h.call(h.staff.trust_safety.email, "POST", "/v1/admin/tombstones", {
      subject: "@small/alice",
      reason_code: "policy.illegal",
      reason: REASON,
    });
    expect(exec).toMatchObject({ status: 200, json: { executed: true } });
    const [row] = await h.t.app.db.select().from(releases).where(eq(releases.id, r.releaseId));
    expect(row).toMatchObject({ status: "tombstoned", statusReason: "policy.illegal" });
  });

  it("legal takedowns need the legal capability and a legal request", async () => {
    await publish("legalcase", "bob");
    const ts = await h.call(h.staff.trust_safety.email, "POST", "/v1/admin/tombstones", {
      subject: "@legalcase/bob",
      reason_code: "legal.dmca",
      reason: REASON,
      legal_request_id: uuidv7(),
    });
    expect(ts).toMatchObject({ status: 403, json: { code: "admin.forbidden" } });
    const lr = await h.call(h.staff.legal.email, "POST", "/v1/admin/legal-requests", {
      kind: "dmca",
      requester: { name: "Rights Holder Inc." },
      received_at: "2026-09-21T10:00:00Z",
      subjects: ["@legalcase/bob"],
      reason: "notice received by email",
    });
    expect(lr.status).toBe(201);
    const legal = await h.call(h.staff.legal.email, "POST", "/v1/admin/tombstones", {
      subject: "@legalcase/bob",
      reason_code: "legal.dmca",
      reason: REASON,
      legal_request_id: lr.json.id,
    });
    expect(legal).toMatchObject({ status: 200, json: { executed: true } });
  });

  describe("four eyes for more than 50 affected releases", () => {
    let digest: string;
    beforeAll(async () => {
      // 51 个 Release 共同包含同一个 fragment：只写影响范围计算需要的最少数据。
      const ns = await createNamespace(h.t.app.db, "bulk");
      digest = `sha256:${"d".repeat(64)}`;
      for (let i = 0; i < 51; i++) {
        const cid = uuidv7();
        const rid = uuidv7();
        await h.t.app.db.insert(creations).values({
          id: cid,
          namespaceId: ns,
          name: `c${i}`,
          type: "lorebook",
          displayName: `C${i}`,
          rating: "general",
        });
        await h.t.app.db.insert(releases).values({
          id: rid,
          creationId: cid,
          label: "1.0.0",
          visibility: "public",
          source: { provider: "native" },
          semanticDigest: `sha256:${i.toString(16).padStart(64, "0")}`,
          publishedBy: { user: "x" },
          publishState: "done",
        });
        await h.t.app.db
          .insert(releaseFragments)
          .values({ releaseId: rid, ownerRef: "@bulk/shared", fragmentId: "lore/x", digest });
        await h.t.app.db.insert(blobRefs).values({ digest, releaseId: rid, role: "fragment" });
      }
    });

    it("creates a pending approval instead of executing", async () => {
      const r = await h.call(h.staff.trust_safety.email, "POST", "/v1/admin/tombstones", {
        subject: `fragment:${digest}`,
        reason_code: "policy.illegal",
        reason: REASON,
      });
      expect(r.status).toBe(202);
      expect(r.json).toMatchObject({ executed: false, approval: { kind: "tombstone.large" } });
      const approval = r.json.approval as { id: string; other_eligible_staff: number };
      // trust_safety 与 owner 都能处置严重违规：发起人以外还有一名。
      expect(approval.other_eligible_staff).toBe(1);
      const still = await h.t.app.db
        .select()
        .from(releases)
        .where(eq(releases.status, "tombstoned"));
      expect(still.filter((x) => x.semanticDigest.startsWith("sha256:0000"))).toHaveLength(0);

      const self = await h.call(
        h.staff.trust_safety.email,
        "POST",
        `/v1/admin/approvals/${approval.id}/confirm`,
        {
          reason: REASON,
        },
      );
      expect(self).toMatchObject({ status: 403, json: { code: "admin.four_eyes_required" } });
      const noCap = await h.call(
        h.staff.admin.email,
        "POST",
        `/v1/admin/approvals/${approval.id}/confirm`,
        {
          reason: REASON,
        },
      );
      expect(noCap.status).toBe(403);
      const listed = await h.call(h.staff.owner.email, "GET", "/v1/admin/approvals");
      expect((listed.json.items as { id: string }[]).map((a) => a.id)).toContain(approval.id);

      const ok = await h.call(
        h.staff.owner.email,
        "POST",
        `/v1/admin/approvals/${approval.id}/confirm`,
        {
          reason: REASON,
        },
      );
      expect(ok).toMatchObject({ status: 200, json: { kind: "tombstone.large" } });
      const done = await h.t.app.db
        .select()
        .from(releaseFragments)
        .innerJoin(releases, eq(releases.id, releaseFragments.releaseId))
        .where(eq(releaseFragments.digest, digest));
      expect(done.every((x) => x.releases.status === "tombstoned")).toBe(true);
      const again = await h.call(
        h.staff.owner.email,
        "POST",
        `/v1/admin/approvals/${approval.id}/confirm`,
        {
          reason: REASON,
        },
      );
      expect(again.status).toBe(409);
    });

    it("lets a sole eligible staff member confirm only after the cooling-off period", async () => {
      const lr = await h.call(h.staff.legal.email, "POST", "/v1/admin/legal-requests", {
        kind: "court",
        requester: { name: "Court" },
        received_at: "2026-09-21T10:00:00Z",
        subjects: ["bulk"],
        reason: "court order received",
      });
      const ns = await createNamespace(h.t.app.db, "bulk2");
      const d2 = `sha256:${"e".repeat(64)}`;
      for (let i = 0; i < 51; i++) {
        const cid = uuidv7();
        const rid = uuidv7();
        await h.t.app.db.insert(creations).values({
          id: cid,
          namespaceId: ns,
          name: `c${i}`,
          type: "lorebook",
          displayName: `C${i}`,
          rating: "general",
        });
        await h.t.app.db.insert(releases).values({
          id: rid,
          creationId: cid,
          label: "1.0.0",
          visibility: "public",
          source: { provider: "native" },
          semanticDigest: `sha256:${(1000 + i).toString(16).padStart(64, "0")}`,
          publishedBy: { user: "x" },
          publishState: "done",
        });
        await h.t.app.db.insert(blobRefs).values({ digest: d2, releaseId: rid, role: "fragment" });
      }
      // 暂时去掉 owner 的角色，让 legal 成为唯一有法律下架权限的员工。
      await h.t.app.db
        .update(authUser)
        .set({ role: "viewer" })
        .where(eq(authUser.id, h.staff.owner.id));
      const r = await h.call(h.staff.legal.email, "POST", "/v1/admin/tombstones", {
        subject: `asset:${d2}`,
        reason_code: "legal.court_order",
        reason: REASON,
        legal_request_id: lr.json.id,
      });
      await h.t.app.db
        .update(authUser)
        .set({ role: "owner" })
        .where(eq(authUser.id, h.staff.owner.id));
      expect(r.status).toBe(202);
      const approval = r.json.approval as { id: string; other_eligible_staff: number };
      expect(approval.other_eligible_staff).toBe(0);
      const early = await h.call(
        h.staff.legal.email,
        "POST",
        `/v1/admin/approvals/${approval.id}/confirm`,
        {
          reason: REASON,
        },
      );
      expect(early).toMatchObject({ status: 403, json: { code: "admin.cooling_off" } });
      const start = h.now();
      h.setNow(new Date(start.getTime() + 24 * HOUR));
      const later = await h.call(
        h.staff.legal.email,
        "POST",
        `/v1/admin/approvals/${approval.id}/confirm`,
        {
          reason: REASON,
        },
      );
      h.setNow(start);
      expect(later.status).toBe(200);
      const [a] = await h.t.app.db
        .select()
        .from(staffApprovals)
        .where(eq(staffApprovals.id, approval.id));
      expect(a?.status).toBe("confirmed");
    });
  });
});

describe("user bans", () => {
  it("revokes tokens immediately and can be lifted", async () => {
    const user = await createUser(h.t.app.db, { name: "spammer" });
    const token = generateToken();
    await h.t.app.db.insert(apiTokens).values({
      id: uuidv7(),
      userId: user,
      name: "cli",
      prefix: token.slice(0, 12),
      tokenHash: hashToken(token),
      scopes: ["creations:write"],
    });
    expect(await principalFromToken(h.t.app.db, token, h.now())).not.toBeNull();
    const id = toPublicId("user", user);
    const ban = await h.call(h.staff.trust_safety.email, "POST", `/v1/admin/users/${id}/ban`, {
      reason: REASON,
    });
    expect(ban).toMatchObject({ status: 200, json: { tokens_revoked: 1 } });
    expect(await principalFromToken(h.t.app.db, token, h.now())).toBeNull();
    const view = await h.call(h.staff.viewer.email, "GET", `/v1/admin/users/${id}`);
    expect(view.json).toMatchObject({ banned: true, csam_locked: false, tokens: 0 });
    const unban = await h.call(h.staff.trust_safety.email, "POST", `/v1/admin/users/${id}/unban`, {
      reason: REASON,
    });
    expect(unban).toMatchObject({ status: 200, json: {} });
    const [u] = await h.t.app.db.select().from(authUser).where(eq(authUser.id, user));
    expect(u?.banned).toBe(false);
  });

  it("CSAM-locked accounts need a second staff member to unban and cannot be re-banned over", async () => {
    const user = await createUser(h.t.app.db, { name: "locked" });
    await h.t.app.db
      .update(authUser)
      .set({ banned: true, banReason: "csam" })
      .where(eq(authUser.id, user));
    const id = toPublicId("user", user);
    const rebans = await h.call(h.staff.admin.email, "POST", `/v1/admin/users/${id}/ban`, {
      reason: REASON,
    });
    expect(rebans).toMatchObject({ status: 409, json: { code: "admin.csam_locked" } });
    const r = await h.call(h.staff.admin.email, "POST", `/v1/admin/users/${id}/unban`, {
      reason: REASON,
    });
    expect(r.status).toBe(202);
    const approval = r.json.approval as { id: string };
    const [still] = await h.t.app.db.select().from(authUser).where(eq(authUser.id, user));
    expect(still?.banned).toBe(true);
    const self = await h.call(
      h.staff.admin.email,
      "POST",
      `/v1/admin/approvals/${approval.id}/confirm`,
      {
        reason: REASON,
      },
    );
    expect(self.status).toBe(403);
    const ok = await h.call(
      h.staff.trust_safety.email,
      "POST",
      `/v1/admin/approvals/${approval.id}/confirm`,
      {
        reason: REASON,
      },
    );
    expect(ok.status).toBe(200);
    const [after] = await h.t.app.db.select().from(authUser).where(eq(authUser.id, user));
    expect(after?.banned).toBe(false);
  });

  it("staff cannot ban themselves", async () => {
    const r = await h.call(h.staff.admin.email, "POST", `/v1/admin/users/${h.staff.admin.id}/ban`, {
      reason: REASON,
    });
    expect(r).toMatchObject({ status: 422, json: { code: "admin.cannot_ban_self" } });
  });
});

describe("content actions", () => {
  it("force rating only goes up and shows in public reads and search", async () => {
    const r = await publish("rated", "carol");
    const id = toPublicId("creation", r.creationId);
    const down = await h.call(h.staff.moderator.email, "POST", `/v1/admin/creations/${id}/rating`, {
      rating: "general",
      reason: REASON,
    });
    expect(down.status).toBe(200);
    const up = await h.call(h.staff.moderator.email, "POST", `/v1/admin/creations/${id}/rating`, {
      rating: "mature",
      reason: REASON,
    });
    expect(up.status).toBe(200);
    const lower = await h.call(
      h.staff.moderator.email,
      "POST",
      `/v1/admin/creations/${id}/rating`,
      {
        rating: "teen",
        reason: REASON,
      },
    );
    expect(lower).toMatchObject({ status: 422, json: { code: "admin.rating_can_only_increase" } });

    const detail = await (await h.publicRequest("/v1/creations/@rated/carol")).json();
    expect(detail.effective_rating).toBe("mature");
    const anon = await (await h.publicRequest("/v1/search?q=carol")).json();
    expect(anon.items).toHaveLength(0);
    const adult = await createUser(h.t.app.db, { showMature: true });
    const shown = await (await h.publicRequest("/v1/search?q=carol", adult)).json();
    expect(shown.items[0]?.effective_rating).toBe("mature");
    const view = await h.call(h.staff.viewer.email, "GET", "/v1/admin/creations/@rated/carol");
    expect(view.json).toMatchObject({ forced_rating: "mature", effective_rating: "mature" });
  });

  it("hides and unhides a creation, and yanks a release", async () => {
    const r = await publish("hideme", "dave");
    const id = toPublicId("creation", r.creationId);
    const hide = await h.call(
      h.staff.moderator.email,
      "POST",
      `/v1/admin/creations/${id}/visibility`,
      {
        hidden: true,
        reason: REASON,
      },
    );
    expect(hide.status).toBe(200);
    expect((await h.publicRequest("/v1/creations/@hideme/dave")).status).toBe(404);
    await h.call(h.staff.moderator.email, "POST", `/v1/admin/creations/${id}/visibility`, {
      hidden: false,
      reason: REASON,
    });
    expect((await h.publicRequest("/v1/creations/@hideme/dave")).status).toBe(200);
    const yank = await h.call(
      h.staff.moderator.email,
      "POST",
      `/v1/admin/releases/${r.publicReleaseId}/yank`,
      {
        reason: REASON,
      },
    );
    expect(yank.status).toBe(200);
    const [row] = await h.t.app.db.select().from(releases).where(eq(releases.id, r.releaseId));
    expect(row?.status).toBe("yanked");
  });

  it("handles a report end to end", async () => {
    const r = await publish("reported", "erin");
    const reportId = uuidv7();
    await h.t.app.db.insert(reports).values({
      id: reportId,
      reporter: { anon: "hash" },
      subjectType: "creation",
      subjectId: toPublicId("creation", r.creationId),
      category: "rating",
      details: "<script>alert(1)</script> this is mature",
    });
    const list = await h.call(h.staff.viewer.email, "GET", "/v1/admin/reports");
    const item = (
      list.json.items as { id: string; details: string; subject: { label: string } }[]
    ).find((x) => x.id === reportId);
    expect(item?.details).toBe("<script>alert(1)</script> this is mature");
    expect(item?.subject.label).toBe("@reported/erin");
    const claim = await h.call(
      h.staff.moderator.email,
      "POST",
      `/v1/admin/reports/${reportId}/claim`,
      {
        reason: REASON,
      },
    );
    expect(claim.status).toBe(200);
    const act = await h.call(
      h.staff.moderator.email,
      "POST",
      `/v1/admin/reports/${reportId}/actions`,
      {
        action: "force_rating",
        rating: "teen",
        reason: REASON,
      },
    );
    expect(act.status).toBe(200);
    const [rep] = await h.t.app.db.select().from(reports).where(eq(reports.id, reportId));
    expect(rep?.status).toBe("resolved");
    const closed = await h.call(
      h.staff.moderator.email,
      "POST",
      `/v1/admin/reports/${reportId}/actions`,
      {
        action: "dismiss",
        reason: REASON,
      },
    );
    expect(closed.status).toBe(409);
  });
});

describe("namespace governance", () => {
  it("reserves names, suspends and renames with a permanent redirect", async () => {
    const add = await h.call(h.staff.admin.email, "POST", "/v1/admin/reserved-names", {
      slug: "brandname",
      reason: REASON,
    });
    expect(add.status).toBe(201);
    const listed = await h.call(h.staff.viewer.email, "GET", "/v1/admin/reserved-names");
    expect((listed.json.items as { slug: string }[]).map((x) => x.slug)).toContain("brandname");

    await publish("oldname", "frank");
    const suspend = await h.call(
      h.staff.admin.email,
      "POST",
      "/v1/admin/namespaces/oldname/status",
      {
        status: "suspended",
        reason: REASON,
      },
    );
    expect(suspend.status).toBe(200);
    expect((await h.publicRequest("/v1/creations/@oldname/frank")).status).toBe(404);
    await h.call(h.staff.admin.email, "POST", "/v1/admin/namespaces/oldname/status", {
      status: "active",
      reason: REASON,
    });
    const rename = await h.call(
      h.staff.admin.email,
      "POST",
      "/v1/admin/namespaces/oldname/rename",
      {
        new_slug: "newname",
        reason: REASON,
      },
    );
    expect(rename.status).toBe(200);
    const [redir] = await h.t.app.db
      .select()
      .from(namespaceRedirects)
      .where(eq(namespaceRedirects.oldSlug, "oldname"));
    expect(redir).toBeDefined();
    const res = await h.publicRequest("/v1/creations/@oldname/frank");
    expect(res.status).toBe(301);
    await createNamespace(h.t.app.db, "other");
    const taken = await h.call(h.staff.admin.email, "POST", "/v1/admin/namespaces/other/rename", {
      new_slug: "oldname",
      reason: REASON,
    });
    expect(taken).toMatchObject({ status: 409, json: { code: "namespace.taken" } });
    const [ns] = await h.t.app.db.select().from(namespaces).where(eq(namespaces.slug, "newname"));
    expect(ns?.status).toBe("active");
  });
});

describe("legal requests", () => {
  it("stores the requester encrypted and only shows it to legal and owner", async () => {
    const r = await h.call(h.staff.legal.email, "POST", "/v1/admin/legal-requests", {
      kind: "gdpr",
      requester: { name: "Jane Doe", email: "jane@example.com" },
      received_at: "2026-09-20T10:00:00Z",
      subjects: ["@someone/something"],
      reason: "erasure request received",
    });
    const id = r.json.id as string;
    const [row] = await h.t.app.db.select().from(legalRequests).where(eq(legalRequests.id, id));
    expect(JSON.stringify(row?.requester)).not.toContain("Jane");
    expect(decryptJson(h.legalKey, row?.requester as EncryptedValue)).toEqual({
      name: "Jane Doe",
      email: "jane@example.com",
    });
    const list = await h.call(h.staff.owner.email, "GET", "/v1/admin/legal-requests");
    expect(JSON.stringify(list.json)).not.toContain("Jane");
    const detail = await h.call(h.staff.owner.email, "GET", `/v1/admin/legal-requests/${id}`);
    expect(detail.json.requester).toEqual({ name: "Jane Doe", email: "jane@example.com" });
    for (const role of ["viewer", "moderator", "trust_safety", "admin"] as const) {
      const denied = await h.call(h.staff[role].email, "GET", `/v1/admin/legal-requests/${id}`);
      expect(denied.status).toBe(403);
    }
  });
});

describe("csam incidents", () => {
  it("records an NCMEC report and sets the evidence retention to one year", async () => {
    const { csamIncidents } = await import("../src/db/schema/index.js");
    const incident = uuidv7();
    await h.t.app.db.insert(csamIncidents).values({
      id: incident,
      blobDigest: `sha256:${"f".repeat(64)}`,
      reason: "staff_flag",
      evidenceKey: "evidence/x",
    });
    const list = await h.call(h.staff.trust_safety.email, "GET", "/v1/admin/csam-incidents");
    expect((list.json.items as { id: string }[]).map((x) => x.id)).toContain(incident);
    const ts = await h.call(
      h.staff.trust_safety.email,
      "POST",
      `/v1/admin/csam-incidents/${incident}/report`,
      {
        ncmec_report_id: "CT-1",
        reason: REASON,
      },
    );
    expect(ts.status).toBe(403);
    const ok = await h.call(
      h.staff.legal.email,
      "POST",
      `/v1/admin/csam-incidents/${incident}/report`,
      {
        ncmec_report_id: "CT-1",
        reason: REASON,
      },
    );
    expect(ok.status).toBe(200);
    const [row] = await h.t.app.db
      .select()
      .from(csamIncidents)
      .where(eq(csamIncidents.id, incident));
    expect(row?.status).toBe("reported");
    expect(row?.evidenceExpiresAt?.getTime()).toBe(h.now().getTime() + 365 * 24 * HOUR);
  });

  it("flagging an unknown digest is a clean 404", async () => {
    const r = await h.call(h.staff.trust_safety.email, "POST", "/v1/admin/csam/flag", {
      blob_digest: `sha256:${"9".repeat(64)}`,
      reason: REASON,
    });
    expect(r.status).toBe(404);
  });
});

describe("jobs and staff", () => {
  it("lists queues and retries a dead-lettered job", async () => {
    const queues = await h.call(h.staff.admin.email, "GET", "/v1/admin/queues");
    expect((queues.json.items as { name: string }[]).map((q) => q.name)).toContain("publish");
    const id = await h.queue.boss.send("publish.dead", { release_id: "x" });
    const failed = await h.call(h.staff.admin.email, "GET", "/v1/admin/jobs/failed");
    expect((failed.json.items as { id: string }[]).map((j) => j.id)).toContain(id);
    const retry = await h.call(h.staff.admin.email, "POST", `/v1/admin/jobs/${id}/retry`, {
      reason: REASON,
    });
    expect(retry).toMatchObject({ status: 200, json: { queue: "publish.dead" } });
    const [again] = await h.queue.boss.findJobs("publish", { data: { release_id: "x" } });
    expect(again).toBeDefined();
    const cancel = await h.call(
      h.staff.admin.email,
      "POST",
      `/v1/admin/jobs/publish/${again?.id}/cancel`,
      {
        reason: REASON,
      },
    );
    expect(cancel.status).toBe(200);
    const unknown = await h.call(h.staff.admin.email, "POST", `/v1/admin/jobs/${uuidv7()}/retry`, {
      reason: REASON,
    });
    expect(unknown.status).toBe(404);
  });

  it("owner manages roles; removing an owner needs a second owner; the last owner stays", async () => {
    const extra = await h.addStaff("owner2@char.pub", ["owner"]);
    const promote = await h.call(
      h.staff.owner.email,
      "PUT",
      `/v1/admin/staff/${h.staff.viewer.id}`,
      {
        roles: ["viewer", "moderator"],
        reason: REASON,
      },
    );
    expect(promote).toMatchObject({ status: 200, json: { roles: ["viewer", "moderator"] } });
    const me = await h.call(h.staff.viewer.email, "GET", "/v1/admin/me");
    expect(me.json.capabilities).toContain("reports.handle");
    const demote = await h.call(h.staff.owner.email, "PUT", `/v1/admin/staff/${extra}`, {
      roles: ["admin"],
      reason: REASON,
    });
    expect(demote.status).toBe(202);
    const approval = demote.json.approval as { id: string };
    const ok = await h.call(
      "owner2@char.pub",
      "POST",
      `/v1/admin/approvals/${approval.id}/confirm`,
      {
        reason: REASON,
      },
    );
    // owner2 自己被降级，但确认的是另一名 owner 发起的请求，满足四眼。
    expect(ok.status).toBe(200);
    const [u] = await h.t.app.db.select().from(authUser).where(eq(authUser.id, extra));
    expect(u?.role).toBe("admin");
    const staff = await h.call(h.staff.owner.email, "GET", "/v1/admin/staff");
    expect((staff.json.items as { email: string }[]).map((s) => s.email)).toContain(
      "owner@char.pub",
    );
  });
});
