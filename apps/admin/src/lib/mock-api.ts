/**
 * 内置的 mock admin API：内存中的示例数据，用于单独开发界面、组件测试和 Playwright 冒烟。
 *
 * 行为尽量贴近后端：写操作要求理由至少 10 个字符，缺少能力时返回 `admin.forbidden`，
 * 大范围 tombstone 与 CSAM 锁定的解封走四眼流程。示例数据全部是虚构的。
 */
import {
  type AdminApi,
  ApiError,
  type AuditItem,
  type CreationAdminView,
  type CsamIncident,
  type FailedJob,
  type Flag,
  type FlagKey,
  type LegalRequest,
  type Me,
  MIN_REASON_LENGTH,
  type NamespaceAdminView,
  type PendingApproval,
  type QueueStats,
  type Report,
  type ReservedName,
  type StaffCapability,
  type UserAdminView,
  type WithReason,
} from "./api";

const COOLING_OFF_MS = 24 * 60 * 60 * 1000;
const FOUR_EYES_THRESHOLD = 50;

export interface MockOptions {
  me?: Me;
  /** 除当前员工外，还有几名有资格确认四眼操作的员工。 */
  otherEligibleStaff?: number;
  now?: () => Date;
}

export const OWNER_ME: Me = {
  email: "owner@char.pub",
  roles: ["owner"],
  capabilities: [
    "overview.read",
    "reports.handle",
    "creations.hide",
    "releases.yank",
    "users.ban",
    "csam.read",
    "csam.report",
    "legal.manage",
    "tombstone.policy",
    "tombstone.legal",
    "namespaces.govern",
    "flags.toggle",
    "jobs.manage",
    "audit.read_own",
    "audit.read_all",
    "staff.manage",
  ],
};

export const VIEWER_ME: Me = {
  email: "viewer@char.pub",
  roles: ["viewer"],
  capabilities: ["overview.read", "audit.read_own"],
};

/** 示例数据中受影响的 Release 数量：`@commons` 下的内容被大量依赖，会超过四眼阈值。 */
function affectedCount(subject: string): number {
  return subject.includes("commons") ? FOUR_EYES_THRESHOLD + 12 : 3;
}

function requireReason(input: WithReason) {
  if ((input.reason ?? "").trim().length < MIN_REASON_LENGTH) {
    throw new ApiError(422, "admin.reason_required");
  }
}

export function createMockApi(opts: MockOptions = {}): AdminApi {
  const me = opts.me ?? OWNER_ME;
  const now = opts.now ?? (() => new Date());
  const iso = () => now().toISOString();
  const can = (c: StaffCapability) => me.capabilities.includes(c);
  const need = (c: StaffCapability) => {
    if (!can(c)) throw new ApiError(403, "admin.forbidden");
  };

  const flags: Flag[] = (
    [
      "signups",
      "uploads",
      "publish",
      "contributions",
      "github_sync",
      "guest_access",
      "read_only",
    ] as FlagKey[]
  ).map((key) => ({ key, enabled: true, reason: null, updated_at: null }));

  let auditSeq = 3;
  const audit: AuditItem[] = [
    {
      id: "3",
      at: "2026-09-22T10:12:00.000Z",
      actor: { kind: "staff", id: "u_owner" },
      action: "flag.toggle",
      subject: "flag:guest_access",
      request_id: "req-3",
      before: { enabled: true },
      after: { enabled: false, reason: "guest spam from one ASN" },
      hash: "sha256:3c1f…",
    },
    {
      id: "2",
      at: "2026-09-22T09:40:00.000Z",
      actor: { kind: "system", id: "github-webhook" },
      action: "binding.frozen",
      subject: "source_binding:b1",
      request_id: "d-42",
      before: { owner_id: "2001" },
      after: { owner_id: "2002", reason: "repository.transferred" },
      hash: "sha256:9a02…",
    },
    {
      id: "1",
      at: "2026-09-22T08:00:00.000Z",
      actor: { kind: "user", id: "u_alice" },
      action: "release.publish",
      subject: "release:rel_alice_1",
      request_id: "req-1",
      before: null,
      after: { label: "1.0.0", visibility: "public" },
      hash: "sha256:11ab…",
    },
  ];
  const addAudit = (action: string, subject: string, before: unknown, after: unknown) => {
    auditSeq += 1;
    audit.unshift({
      id: String(auditSeq),
      at: iso(),
      actor: { kind: "staff", id: me.email },
      action,
      subject,
      request_id: `mock-${auditSeq}`,
      before,
      after,
      hash: `sha256:mock${auditSeq}…`,
    });
  };

  const reports: Report[] = [
    {
      id: "rp1",
      category: "copyright",
      severity: "high",
      subject: { type: "creation", id: "cr1", label: "@fanworks/borrowed-hero" },
      details:
        "This is my original character, copied without permission. <script>alert(1)</script>",
      reporter: "user",
      status: "open",
      assignee: null,
      created_at: "2026-09-22T07:30:00.000Z",
    },
    {
      id: "rp2",
      category: "rating",
      severity: "medium",
      subject: { type: "release", id: "rel2", label: "@djj/night-city@1.2.0" },
      details: "Marked general but contains graphic violence.",
      reporter: "anonymous",
      status: "open",
      assignee: null,
      created_at: "2026-09-22T06:10:00.000Z",
    },
    {
      id: "rp3",
      category: "spam",
      severity: "low",
      subject: { type: "user", id: "u_spam", label: "spam-bot-7" },
      details: "Posting the same contribution to 40 creations.",
      reporter: "user",
      status: "claimed",
      assignee: "ts@char.pub",
      created_at: "2026-09-21T22:00:00.000Z",
    },
  ];

  const creations: CreationAdminView[] = [
    {
      id: "cr1",
      ref: "@fanworks/borrowed-hero",
      type: "character",
      display_name: "Borrowed Hero",
      summary: "A hero. <img src=x onerror=alert(1)>",
      rating: "general",
      forced_rating: null,
      status: "active",
      releases: [
        { id: "rel_bh_1", label: "1.0.0", visibility: "public", status: "active" },
        { id: "rel_bh_2", label: "1.1.0", visibility: "public", status: "yanked" },
      ],
    },
  ];

  const approvals: PendingApproval[] = [];
  const users: UserAdminView[] = [
    {
      id: "u_alice",
      email: "alice@example.com",
      name: "Alice",
      namespaces: ["alice"],
      banned: false,
      ban_reason: null,
      ban_expires: null,
      csam_locked: false,
      tokens: 2,
      sessions: 1,
      created_at: "2026-09-01T00:00:00.000Z",
    },
    {
      id: "u_locked",
      email: "locked@example.com",
      name: "Locked account",
      namespaces: ["locked"],
      banned: true,
      ban_reason: "csam",
      ban_expires: null,
      csam_locked: true,
      tokens: 0,
      sessions: 0,
      created_at: "2026-09-10T00:00:00.000Z",
    },
  ];

  const namespaces: NamespaceAdminView[] = [
    {
      slug: "alice",
      kind: "user",
      status: "active",
      owner: "alice@example.com",
      redirects: ["alice-old"],
    },
    { slug: "commons", kind: "system", status: "active", owner: null, redirects: [] },
  ];
  const reserved: ReservedName[] = [
    { slug: "commons", reason: "system namespace" },
    { slug: "admin", reason: "infrastructure" },
    { slug: "api", reason: "infrastructure" },
  ];

  const legal: LegalRequest[] = [
    {
      id: "lr1",
      kind: "dmca",
      received_at: "2026-09-21T12:00:00.000Z",
      deadline: "2026-09-24T12:00:00.000Z",
      status: "open",
      subjects: ["@fanworks/borrowed-hero"],
    },
  ];
  const incidents: CsamIncident[] = [
    {
      id: "inc1",
      upload_id: "upl_1",
      blob_digest: "sha256:5e2d…",
      reason: "staff_flag",
      status: "open",
      ncmec_report_id: null,
      created_at: "2026-09-22T05:00:00.000Z",
      evidence_expires_at: null,
    },
  ];
  const queues: QueueStats[] = [
    { name: "publish", queued: 2, active: 1, failed: 0, dead: 0 },
    { name: "upload.process", queued: 14, active: 3, failed: 1, dead: 0 },
    { name: "tombstone.cascade", queued: 0, active: 0, failed: 0, dead: 1 },
    { name: "github.sync", queued: 0, active: 0, failed: 0, dead: 0 },
  ];
  const failed: FailedJob[] = [
    {
      id: "job_1",
      queue: "upload.process",
      error: "scanner unavailable (retrying)",
      attempts: 3,
      failed_at: "2026-09-22T09:59:00.000Z",
    },
    {
      id: "job_2",
      queue: "tombstone.cascade.dead",
      error: "CDN purge returned 502",
      attempts: 5,
      failed_at: "2026-09-22T08:30:00.000Z",
    },
  ];

  const makeApproval = (
    kind: PendingApproval["kind"],
    subject: string,
    reason: string,
  ): PendingApproval => {
    const at = now();
    const a: PendingApproval = {
      id: `ap${approvals.length + 1}`,
      kind,
      subject,
      initiated_by: me.email,
      initiated_at: at.toISOString(),
      reason,
      other_eligible_staff: opts.otherEligibleStaff ?? 0,
      cooling_off_until: new Date(at.getTime() + COOLING_OFF_MS).toISOString(),
      status: "pending",
    };
    approvals.push(a);
    return a;
  };

  const delay = <T>(v: T) => Promise.resolve(structuredClone(v));

  return {
    me: () => delay(me),

    listFlags: () => delay(flags),
    setFlag: async (key, input) => {
      need("flags.toggle");
      requireReason(input);
      const f = flags.find((x) => x.key === key);
      if (!f) throw new ApiError(404, "not_found");
      addAudit(
        "flag.toggle",
        `flag:${key}`,
        { enabled: f.enabled },
        { enabled: input.enabled, reason: input.reason },
      );
      f.enabled = input.enabled;
      f.reason = input.reason;
      f.updated_at = iso();
    },

    listAudit: async (q) => {
      const own = !can("audit.read_all");
      let items = audit.filter(
        (a) => (!own || a.actor.id === me.email) && (!q.subject || a.subject === q.subject),
      );
      if (q.before) items = items.filter((a) => Number(a.id) < Number(q.before));
      const limit = q.limit ?? 50;
      const page = items.slice(0, limit);
      return delay({
        items: page,
        next_before: items.length > limit ? (page.at(-1)?.id ?? null) : null,
      });
    },
    verifyAudit: async () => {
      need("audit.read_all");
      return delay({ ok: true as const, count: audit.length, head: audit[0]?.hash ?? null });
    },

    listReports: () => delay(reports),
    actOnReport: async (id, input) => {
      need("reports.handle");
      requireReason(input);
      const r = reports.find((x) => x.id === id);
      if (!r) throw new ApiError(404, "not_found");
      r.status = input.action === "dismiss" ? "dismissed" : "resolved";
      addAudit(`report.${input.action}`, `report:${id}`, null, { reason: input.reason });
    },

    getCreation: async (ref) => {
      const c = creations.find((x) => x.ref === ref);
      if (!c) throw new ApiError(404, "not_found");
      return delay(c);
    },
    hideCreation: async (id, input) => {
      need("creations.hide");
      requireReason(input);
      const c = creations.find((x) => x.id === id);
      if (!c) throw new ApiError(404, "not_found");
      c.status = input.hidden ? "hidden" : "active";
      addAudit(input.hidden ? "creation.hide" : "creation.unhide", `creation:${id}`, null, null);
    },
    forceRating: async (id, input) => {
      need("reports.handle");
      requireReason(input);
      const c = creations.find((x) => x.id === id);
      if (!c) throw new ApiError(404, "not_found");
      addAudit(
        "creation.force_rating",
        `creation:${id}`,
        { rating: c.forced_rating },
        { rating: input.rating },
      );
      c.forced_rating = input.rating;
    },
    yankRelease: async (id, input) => {
      need("releases.yank");
      requireReason(input);
      for (const c of creations) {
        const r = c.releases.find((x) => x.id === id);
        if (r) r.status = "yanked";
      }
      addAudit("release.yank", `release:${id}`, null, null);
    },

    previewTombstone: async (subject) => {
      const many = subject.includes("commons");
      const count = affectedCount(subject);
      return delay({
        subject,
        releases: Array.from({ length: count }, (_, i) => ({
          id: `rel_${i + 1}`,
          ref: many ? `@user${i}/uses-commons` : "@fanworks/borrowed-hero",
          label: `1.${i}.0`,
        })),
        objects: count * 4,
        cdn_urls: [`https://assets.char.pub/cas/sha256/ab/${"ab".repeat(32)}`],
        downstream_authors: many ? ["user1@example.com", "user2@example.com"] : [],
        requires_four_eyes: count > FOUR_EYES_THRESHOLD,
      });
    },
    requestTombstone: async (input) => {
      const legalReason = input.reason_code.startsWith("legal.");
      need(legalReason ? "tombstone.legal" : "tombstone.policy");
      requireReason(input);
      if (legalReason && !input.legal_request_id)
        throw new ApiError(422, "admin.legal_request_required");
      if (affectedCount(input.subject) > FOUR_EYES_THRESHOLD) {
        return {
          executed: false as const,
          approval: makeApproval("tombstone.large", input.subject, input.reason),
        };
      }
      addAudit("tombstone.execute", input.subject, null, { reason_code: input.reason_code });
      return { executed: true as const };
    },
    listApprovals: () => delay(approvals.filter((a) => a.status === "pending")),
    confirmApproval: async (id, input) => {
      requireReason(input);
      const a = approvals.find((x) => x.id === id);
      if (a?.status !== "pending") throw new ApiError(404, "not_found");
      if (a.initiated_by === me.email) {
        if (a.other_eligible_staff > 0) throw new ApiError(403, "admin.four_eyes_required");
        if (now().getTime() < new Date(a.cooling_off_until).getTime()) {
          throw new ApiError(403, "admin.cooling_off");
        }
      }
      a.status = "confirmed";
      addAudit("approval.confirm", `approval:${id}`, null, { kind: a.kind });
    },

    listUsers: async (q) =>
      delay(users.filter((u) => !q.query || u.email.includes(q.query) || u.name.includes(q.query))),
    banUser: async (id, input) => {
      need("users.ban");
      requireReason(input);
      const u = users.find((x) => x.id === id);
      if (!u) throw new ApiError(404, "not_found");
      u.banned = true;
      u.ban_reason = input.reason;
      u.ban_expires = input.until ?? null;
      u.sessions = 0;
      u.tokens = 0;
      addAudit("user.ban", `user:${id}`, null, { until: input.until ?? null });
    },
    unbanUser: async (id, input) => {
      need("users.ban");
      requireReason(input);
      const u = users.find((x) => x.id === id);
      if (!u) throw new ApiError(404, "not_found");
      if (u.csam_locked)
        return { approval: makeApproval("unban.csam", `user:${id}`, input.reason) };
      u.banned = false;
      u.ban_reason = null;
      addAudit("user.unban", `user:${id}`, null, null);
      return {};
    },

    listNamespaces: async (q) =>
      delay(namespaces.filter((n) => !q.query || n.slug.includes(q.query))),
    listReserved: () => delay(reserved),
    addReserved: async (input) => {
      need("namespaces.govern");
      requireReason(input);
      reserved.push({ slug: input.slug, reason: input.reason });
      addAudit("namespace.reserve", `namespace:${input.slug}`, null, null);
    },
    setNamespaceStatus: async (slug, input) => {
      need("namespaces.govern");
      requireReason(input);
      const n = namespaces.find((x) => x.slug === slug);
      if (!n) throw new ApiError(404, "not_found");
      n.status = input.status;
      addAudit(`namespace.${input.status}`, `namespace:${slug}`, null, null);
    },

    listLegalRequests: async () => {
      need("legal.manage");
      return delay(legal);
    },
    listCsamIncidents: async () => {
      need("csam.read");
      return delay(incidents);
    },

    listQueues: () => delay(queues),
    listFailedJobs: () => delay(failed),
    retryJob: async (id, input) => {
      need("jobs.manage");
      requireReason(input);
      addAudit("job.retry", `job:${id}`, null, null);
    },
    cancelJob: async (id, input) => {
      need("jobs.manage");
      requireReason(input);
      addAudit("job.cancel", `job:${id}`, null, null);
    },
  };
}
