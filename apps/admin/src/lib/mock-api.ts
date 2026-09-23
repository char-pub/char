/**
 * 内置的 mock admin API：内存中的示例数据，用于单独开发界面、组件测试和 Playwright 测试。
 *
 * 行为尽量贴近后端：
 * - 按员工角色计算能力，缺少能力时返回 403 `admin.forbidden`（读接口也一样）；
 * - 写操作要求理由至少 10 个字符，法律依据的操作要求关联法律请求；
 * - 大范围 tombstone、CSAM 锁定账号的解封、移除 owner 角色走四眼流程；
 * - 强制评级只能调高，CSAM 锁定的账号不能被普通封禁覆盖，系统里至少保留一名 owner；
 * - namespace 转让总是走四眼流程；DMCA 反通知的恢复期限按工作日计算；
 * - 隔离证据只给具备证据权限的员工，下载得到的是一个普通文件，不做预览。
 *
 * 示例数据全部是虚构的。
 */
import {
  type AdminApi,
  ApiError,
  type AuditItem,
  type CreationAdminView,
  type CsamIncident,
  type EvidenceMeta,
  type FailedJob,
  type Flag,
  type FlagKey,
  type GuestAdminView,
  type LegalRequestDetail,
  type Me,
  MIN_REASON_LENGTH,
  type NamespaceAdminView,
  type PendingApproval,
  type QueueStats,
  type Report,
  type ReservedName,
  type StaffCapability,
  type StaffMember,
  type StaffRole,
  type UserDetail,
  type WithReason,
} from "./api";
import { capabilitiesOf, DECIDE_CAPABILITIES } from "./roles";

const HOUR = 60 * 60 * 1000;
const COOLING_OFF_MS = 24 * HOUR;
const EVIDENCE_RETENTION_MS = 365 * 24 * HOUR;
const FOUR_EYES_THRESHOLD = 50;
const RATINGS = ["general", "teen", "mature", "explicit"];
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;

export interface MockOptions {
  me?: Me;
  /**
   * 后端按这些角色判断权限；不设置时与 `me` 的能力一致。
   * 用来模拟页面加载之后员工的角色被收回：界面仍显示操作，后端返回 403。
   */
  enforceRoles?: StaffRole[];
  /** 除当前员工外，还有几名有资格确认四眼操作的员工。 */
  otherEligibleStaff?: number;
  now?: () => Date;
}

/** 按角色构造当前员工，mock 中的邮箱是 `<第一个角色>@char.pub`。 */
export function meFor(roles: StaffRole[], email?: string): Me {
  return {
    email: email ?? `${roles[0] ?? "nobody"}@char.pub`,
    roles,
    capabilities: capabilitiesOf(roles),
  };
}

export const OWNER_ME: Me = meFor(["owner"]);
export const VIEWER_ME: Me = meFor(["viewer"]);

/** 示例数据中受影响的 Release 数量：`@commons` 下的内容被大量依赖，会超过四眼阈值。 */
function affectedCount(subject: string): number {
  return subject.includes("commons") ? FOUR_EYES_THRESHOLD + 12 : 3;
}

function requireReason(input: WithReason) {
  if ((input.reason ?? "").trim().length < MIN_REASON_LENGTH) {
    throw new ApiError(422, "admin.reason_required");
  }
}

/** 与后端相同的工作日计算：周一到周五（UTC），保留原来的时刻。 */
function addWeekdays(from: Date, n: number): Date {
  const d = new Date(from.getTime());
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) left--;
  }
  return d;
}

const RESTORE_NOT_BEFORE_WEEKDAYS = 12;
const RESTORE_DEADLINE_WEEKDAYS = 14;

function jsonFile(value: unknown, filename: string) {
  return {
    blob: new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    filename,
  };
}

function tombstoneCapability(reasonCode: string): StaffCapability {
  return reasonCode.startsWith("legal.") ? "tombstone.legal" : "tombstone.policy";
}

export function createMockApi(opts: MockOptions = {}): AdminApi {
  const me = opts.me ?? OWNER_ME;
  const now = opts.now ?? (() => new Date());
  const iso = () => now().toISOString();
  const at = (offsetMs: number) => new Date(now().getTime() + offsetMs).toISOString();
  const enforced = new Set<StaffCapability>(
    opts.enforceRoles ? capabilitiesOf(opts.enforceRoles) : me.capabilities,
  );
  const can = (c: StaffCapability) => enforced.has(c);
  /** 具备其中任一能力即可。 */
  const need = (...caps: StaffCapability[]) => {
    if (!caps.some(can)) throw new ApiError(403, "admin.forbidden");
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
      actor: { kind: "staff", id: "owner@char.pub" },
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
      subject: { type: "release", id: "rel_bh_1", label: "@fanworks/borrowed-hero@1.0.0" },
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
      assignee: "trust_safety@char.pub",
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
      rating: "teen",
      effective_rating: "teen",
      forced_rating: null,
      status: "active",
      releases: [
        { id: "rel_bh_1", label: "1.0.0", visibility: "public", status: "active" },
        { id: "rel_bh_2", label: "1.1.0", visibility: "public", status: "yanked" },
        { id: "rel_bh_3", label: "2.0.0-draft", visibility: "private", status: "active" },
      ],
    },
    {
      id: "cr2",
      ref: "@fanworks/cover-song",
      type: "character",
      display_name: "Cover Song",
      summary: "A singer who covers classic songs.",
      rating: "general",
      effective_rating: "general",
      forced_rating: null,
      status: "hidden",
      releases: [{ id: "rel_cs_1", label: "1.0.0", visibility: "public", status: "active" }],
    },
  ];
  const findCreation = (idOrRef: string) =>
    creations.find((x) => x.id === idOrRef || x.ref === idOrRef);

  let approvalSeq = 0;
  /** 每个请求确认所需的能力；tombstone 的能力取决于原因代码。 */
  const approvalCapability = new Map<string, StaffCapability>();
  /** 确认之后才执行的操作。 */
  const approvalEffect = new Map<string, () => void>();
  const approvals: PendingApproval[] = [];
  const addApproval = (
    a: Omit<PendingApproval, "cooling_off_until" | "status">,
    capability: StaffCapability,
    effect: () => void,
  ): PendingApproval => {
    const full: PendingApproval = {
      ...a,
      cooling_off_until: new Date(
        new Date(a.initiated_at).getTime() + COOLING_OFF_MS,
      ).toISOString(),
      status: "pending",
    };
    approvals.push(full);
    approvalCapability.set(a.id, capability);
    approvalEffect.set(a.id, effect);
    return full;
  };
  const makeApproval = (
    kind: PendingApproval["kind"],
    subject: string,
    reason: string,
    capability: StaffCapability,
    effect: () => void,
  ): PendingApproval => {
    approvalSeq += 1;
    return addApproval(
      {
        id: `ap${approvalSeq}`,
        kind,
        subject,
        initiated_by: me.email,
        initiated_at: iso(),
        reason,
        other_eligible_staff: opts.otherEligibleStaff ?? 0,
      },
      capability,
      effect,
    );
  };

  const users: UserDetail[] = [
    {
      id: "u_alice",
      email: "alice@example.com",
      name: "Alice",
      namespaces: ["@alice"],
      banned: false,
      ban_reason: null,
      ban_expires: null,
      csam_locked: false,
      tokens: 2,
      sessions: 1,
      uploads_locked: false,
      uploads_locked_at: null,
      created_at: "2026-09-01T00:00:00.000Z",
      creations: 3,
      recent_actions: [
        {
          id: "ma1",
          action: "creation.force_rating",
          reason: "graphic violence in the greeting",
          created_at: "2026-09-15T10:00:00.000Z",
        },
      ],
    },
    {
      id: "u_locked",
      email: "locked@example.com",
      name: "Locked account",
      namespaces: ["@locked"],
      banned: true,
      ban_reason: "csam",
      ban_expires: null,
      csam_locked: true,
      tokens: 0,
      sessions: 0,
      uploads_locked: false,
      uploads_locked_at: null,
      created_at: "2026-09-10T00:00:00.000Z",
      creations: 0,
      recent_actions: [],
    },
  ];
  const unban = (u: UserDetail) => {
    u.banned = false;
    u.ban_reason = null;
    u.ban_expires = null;
    u.csam_locked = false;
  };

  const staff: StaffMember[] = [
    { id: "usr_owner", email: "owner@char.pub", name: "Owner", roles: ["owner"] },
    { id: "usr_ts", email: "trust_safety@char.pub", name: "T&S", roles: ["trust_safety"] },
    { id: "usr_legal", email: "legal@char.pub", name: "Legal", roles: ["legal"] },
    { id: "usr_mod", email: "moderator@char.pub", name: "Moderator", roles: ["moderator"] },
    { id: "usr_ops", email: "admin@char.pub", name: "Ops", roles: ["admin"] },
  ];
  if (!staff.some((s) => s.email === me.email)) {
    staff.push({ id: "usr_me", email: me.email, name: "You", roles: [...me.roles] });
  }
  const setRoles = (member: StaffMember, roles: StaffRole[]) => {
    const removingOwner = member.roles.includes("owner") && !roles.includes("owner");
    if (removingOwner && !staff.some((s) => s !== member && s.roles.includes("owner"))) {
      throw new ApiError(422, "admin.last_owner");
    }
    addAudit("staff.set_roles", `user:${member.id}`, { roles: member.roles }, { roles });
    member.roles = roles;
  };

  // 预置两条待确认请求：一条由其他员工发起（当前员工可以直接确认），
  // 一条由 owner 在冷静期之前发起（只有一名 owner 时，冷静期过后可以自己确认）。
  addApproval(
    {
      id: "ap-ts-1",
      kind: "tombstone.large",
      subject: "@commons/old-map#world",
      initiated_by: "trust_safety@char.pub",
      initiated_at: at(-2 * HOUR),
      reason: "non-consensual imagery embedded in a shared world",
      other_eligible_staff: 1,
    },
    "tombstone.policy",
    () => addAudit("tombstone.execute", "@commons/old-map#world", null, null),
  );
  addApproval(
    {
      id: "ap-owner-1",
      kind: "unban.csam",
      subject: "user:u_locked",
      initiated_by: "owner@char.pub",
      initiated_at: at(-25 * HOUR),
      reason: "scanner false positive confirmed by the provider",
      other_eligible_staff: 0,
    },
    "users.ban",
    () => {
      const u = users.find((x) => x.id === "u_locked");
      if (u) unban(u);
    },
  );

  const namespaces: NamespaceAdminView[] = [
    {
      slug: "alice",
      kind: "user",
      status: "active",
      owner: "alice@example.com",
      redirects: ["alice-old"],
    },
    { slug: "fanworks", kind: "org", status: "active", owner: "fan@example.com", redirects: [] },
    { slug: "commons", kind: "system", status: "active", owner: null, redirects: [] },
  ];
  const reserved: ReservedName[] = [
    { slug: "admin", reason: "infrastructure" },
    { slug: "api", reason: "infrastructure" },
    { slug: "commons", reason: "system namespace" },
  ];

  const legal: LegalRequestDetail[] = [
    {
      id: "lr1",
      kind: "dmca",
      received_at: at(-12 * HOUR),
      deadline: at(36 * HOUR),
      status: "open",
      subjects: ["@fanworks/borrowed-hero"],
      requester: {
        name: "Example Rights Agency",
        email: "notices@example.org",
        organization: "Example Rights Agency LLC",
      },
      counter_notice: null,
      counter_notice_received_at: null,
      restore_not_before: null,
      restore_deadline: null,
      court_action_at: null,
      restored_at: null,
      actions: [],
    },
    {
      id: "lr2",
      kind: "court",
      received_at: at(-20 * 24 * HOUR),
      deadline: at(-6 * 24 * HOUR),
      status: "actioned",
      subjects: ["@spam/mirror"],
      requester: { name: "District court clerk" },
      counter_notice: null,
      counter_notice_received_at: null,
      restore_not_before: null,
      restore_deadline: null,
      court_action_at: null,
      restored_at: null,
      actions: [],
    },
    {
      // 已收到反通知、恢复期限已经开始的 DMCA 请求：仪表盘上会提醒恢复。
      id: "lr3",
      kind: "dmca",
      received_at: at(-30 * 24 * HOUR),
      deadline: null,
      status: "counter_notice",
      subjects: ["@fanworks/cover-song"],
      requester: { name: "Label Rights Desk", email: "desk@example.org" },
      counter_notice: {
        name: "Cover Artist",
        address: "1 Example Street",
        statement: "The work is a licensed cover.",
      },
      counter_notice_received_at: at(-18 * 24 * HOUR),
      restore_not_before: at(-2 * 24 * HOUR),
      restore_deadline: at(24 * HOUR),
      court_action_at: null,
      restored_at: null,
      actions: [
        {
          id: "ma-lr3",
          action: "creation.hide",
          subject: { creation: "cr2" },
          created_at: at(-29 * 24 * HOUR),
          reverted: false,
        },
      ],
    },
  ];
  /** 因每个法律请求而隐藏的 Creation。 */
  const hiddenByLegal = new Map<string, Set<string>>([["lr3", new Set(["cr2"])]]);
  let legalSeq = legal.length;

  const incidents: CsamIncident[] = [
    {
      id: "inc1",
      upload_id: "upl_1",
      blob_digest: `sha256:${"5e2d".repeat(16)}`,
      reason: "csam_scan",
      status: "open",
      ncmec_report_id: null,
      created_at: "2026-09-22T05:00:00.000Z",
      evidence_expires_at: null,
    },
  ];
  const evidenceSize = 48213;

  const guests: GuestAdminView[] = [
    {
      id: "gst_01j9mockvisitor0000000001",
      display_name: "Friendly visitor",
      verified_at: "2026-09-20T10:00:00.000Z",
      verification_kind: "email",
      disabled: false,
      disabled_at: null,
      sessions: 1,
      contributions: 2,
      created_at: "2026-09-20T09:58:00.000Z",
    },
    {
      id: "gst_01j9mockspammer0000000002",
      display_name: "Link spammer",
      verified_at: "2026-09-18T10:00:00.000Z",
      verification_kind: "email",
      disabled: true,
      disabled_at: "2026-09-19T08:00:00.000Z",
      sessions: 0,
      contributions: 14,
      created_at: "2026-09-18T09:50:00.000Z",
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
  const takeFailed = (id: string) => {
    const i = failed.findIndex((j) => j.id === id);
    if (i < 0) throw new ApiError(404, "not_found");
    const [job] = failed.splice(i, 1);
    if (!job) return;
    const q = queues.find((x) => job.queue.startsWith(x.name));
    if (q && job.queue.endsWith(".dead")) q.dead = Math.max(0, q.dead - 1);
    else if (q) q.failed = Math.max(0, q.failed - 1);
  };

  const forceRatingOn = (c: CreationAdminView, rating: string, reason: string) => {
    // 与后端一致：强制评级只能调高（等于当前评级时不变）。
    if (RATINGS.indexOf(rating) < RATINGS.indexOf(c.effective_rating)) {
      throw new ApiError(422, "admin.rating_can_only_increase");
    }
    addAudit(
      "creation.force_rating",
      `creation:${c.id}`,
      { rating: c.effective_rating },
      { rating, reason },
    );
    c.forced_rating = rating;
    c.effective_rating = rating;
  };
  const yank = (releaseId: string) => {
    for (const c of creations) {
      const r = c.releases.find((x) => x.id === releaseId);
      if (r) {
        r.status = "yanked";
        addAudit("release.yank", `release:${releaseId}`, null, null);
        return;
      }
    }
    throw new ApiError(404, "not_found");
  };

  const clone = <T>(v: T) => Promise.resolve(structuredClone(v));
  const listUser = ({ creations: _c, recent_actions: _r, ...u }: UserDetail) => u;

  return {
    me: () => clone(me),

    listFlags: async () => {
      need("overview.read");
      return clone(flags);
    },
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
      need("audit.read_own", "audit.read_all");
      const own = !can("audit.read_all");
      let items = audit.filter(
        (a) => (!own || a.actor.id === me.email) && (!q.subject || a.subject === q.subject),
      );
      if (q.before) items = items.filter((a) => Number(a.id) < Number(q.before));
      const limit = q.limit ?? 50;
      const page = items.slice(0, limit);
      return clone({
        items: page,
        next_before: items.length > limit ? (page.at(-1)?.id ?? null) : null,
      });
    },
    verifyAudit: async () => {
      need("audit.read_all");
      return clone({ ok: true as const, count: audit.length, head: audit[0]?.hash ?? null });
    },

    listReports: async () => {
      need("overview.read");
      return clone(reports);
    },
    claimReport: async (id, input) => {
      need("reports.handle");
      requireReason(input);
      const r = reports.find((x) => x.id === id);
      if (!r) throw new ApiError(404, "not_found");
      if (r.status !== "open" && r.status !== "claimed") throw new ApiError(409, "report.closed");
      r.status = "claimed";
      r.assignee = me.email;
      addAudit("report.claim", `report:${id}`, null, { assignee: me.email });
    },
    actOnReport: async (id, input) => {
      need("reports.handle");
      requireReason(input);
      const r = reports.find((x) => x.id === id);
      if (!r) throw new ApiError(404, "not_found");
      if (r.status === "resolved" || r.status === "dismissed") {
        throw new ApiError(409, "report.closed");
      }
      if (input.action === "hide" || input.action === "force_rating") {
        if (r.subject.type !== "creation") throw new ApiError(422, "report.subject_not_creation");
        const c = findCreation(r.subject.id);
        if (!c) throw new ApiError(404, "not_found");
        if (input.action === "hide") c.status = "hidden";
        else forceRatingOn(c, input.rating ?? "general", input.reason);
      }
      if (input.action === "yank") {
        if (r.subject.type !== "release") throw new ApiError(422, "report.subject_not_release");
        yank(r.subject.id);
      }
      if (input.action === "escalate") {
        r.status = "claimed";
        r.assignee = r.assignee ?? me.email;
      } else {
        r.status = input.action === "dismiss" ? "dismissed" : "resolved";
      }
      addAudit(`report.${input.action}`, `report:${id}`, null, { reason: input.reason });
    },

    getCreation: async (ref) => {
      need("overview.read");
      const c = findCreation(ref);
      if (!c) throw new ApiError(404, "not_found");
      return clone(c);
    },
    hideCreation: async (id, input) => {
      need("creations.hide");
      requireReason(input);
      const c = findCreation(id);
      if (!c) throw new ApiError(404, "not_found");
      c.status = input.hidden ? "hidden" : "active";
      addAudit(input.hidden ? "creation.hide" : "creation.unhide", `creation:${id}`, null, null);
    },
    forceRating: async (id, input) => {
      need("reports.handle");
      requireReason(input);
      const c = findCreation(id);
      if (!c) throw new ApiError(404, "not_found");
      forceRatingOn(c, input.rating, input.reason);
    },
    yankRelease: async (id, input) => {
      need("releases.yank");
      requireReason(input);
      yank(id);
    },

    previewTombstone: async (subject) => {
      need("tombstone.policy", "tombstone.legal");
      const many = subject.includes("commons");
      const count = affectedCount(subject);
      return clone({
        subject,
        releases: Array.from({ length: count }, (_, i) => ({
          id: `rel_${i + 1}`,
          ref: many ? `@user${i}/uses-commons` : "@fanworks/borrowed-hero",
          label: `1.${i}.0`,
          via: i === 0 ? ("direct" as const) : ("closure" as const),
        })),
        objects: count * 4,
        cdn_urls: [`https://assets.char.pub/cas/sha256/ab/${"ab".repeat(32)}`],
        downstream_authors: many ? ["@user1", "@user2"] : [],
        requires_four_eyes: count > FOUR_EYES_THRESHOLD,
      });
    },
    requestTombstone: async (input) => {
      const capability = tombstoneCapability(input.reason_code);
      need(capability);
      requireReason(input);
      if (capability === "tombstone.legal" && !input.legal_request_id) {
        throw new ApiError(422, "admin.legal_request_required");
      }
      const execute = () =>
        addAudit("tombstone.execute", input.subject, null, { reason_code: input.reason_code });
      if (affectedCount(input.subject) > FOUR_EYES_THRESHOLD) {
        return {
          executed: false as const,
          approval: makeApproval(
            "tombstone.large",
            input.subject,
            input.reason,
            capability,
            execute,
          ),
        };
      }
      execute();
      return { executed: true as const };
    },
    listApprovals: async () => {
      need(...DECIDE_CAPABILITIES);
      return clone(
        approvals.filter(
          (a) => a.status === "pending" && can(approvalCapability.get(a.id) ?? "staff.manage"),
        ),
      );
    },
    confirmApproval: async (id, input) => {
      need(...DECIDE_CAPABILITIES);
      requireReason(input);
      const a = approvals.find((x) => x.id === id);
      if (!a) throw new ApiError(404, "not_found");
      if (a.status !== "pending") throw new ApiError(409, "approval.not_pending");
      need(approvalCapability.get(id) ?? "staff.manage");
      if (a.initiated_by === me.email) {
        if (a.other_eligible_staff > 0) throw new ApiError(403, "admin.four_eyes_required");
        if (now().getTime() < new Date(a.cooling_off_until).getTime()) {
          throw new ApiError(403, "admin.cooling_off");
        }
      }
      // 执行失败（例如会移除最后一名 owner）时请求保持 pending。
      approvalEffect.get(id)?.();
      a.status = "confirmed";
      addAudit("approval.confirm", `approval:${id}`, null, {
        kind: a.kind,
        self_confirmed_after_cooling_off: a.initiated_by === me.email,
      });
    },
    cancelApproval: async (id, input) => {
      need(...DECIDE_CAPABILITIES);
      requireReason(input);
      const a = approvals.find((x) => x.id === id);
      if (!a) throw new ApiError(404, "not_found");
      if (a.status !== "pending") throw new ApiError(409, "approval.not_pending");
      if (a.initiated_by !== me.email) need(approvalCapability.get(id) ?? "staff.manage");
      a.status = "cancelled";
      addAudit("approval.cancel", `approval:${id}`, null, { kind: a.kind });
    },

    listUsers: async (q) => {
      need("overview.read");
      return clone(
        users
          .filter((u) => !q.query || u.email.includes(q.query) || u.name.includes(q.query))
          .map(listUser),
      );
    },
    getUser: async (id) => {
      need("overview.read");
      const u = users.find((x) => x.id === id);
      if (!u) throw new ApiError(404, "not_found");
      return clone(u);
    },
    banUser: async (id, input) => {
      need("users.ban");
      requireReason(input);
      const u = users.find((x) => x.id === id);
      if (!u) throw new ApiError(404, "not_found");
      if (u.email === me.email) throw new ApiError(422, "admin.cannot_ban_self");
      if (input.until && new Date(input.until) <= now()) {
        throw new ApiError(422, "admin.ban_until_in_past");
      }
      // 与后端一致：CSAM 锁定不能被普通封禁覆盖，否则可以借“重新封禁再解封”绕过四眼。
      if (u.csam_locked) throw new ApiError(409, "admin.csam_locked");
      u.banned = true;
      u.ban_reason = input.reason;
      u.ban_expires = input.until ?? null;
      u.sessions = 0;
      u.tokens = 0;
      u.recent_actions.unshift({
        id: `ma${auditSeq + 1}`,
        action: "user.ban",
        reason: input.reason,
        created_at: iso(),
      });
      addAudit("user.ban", `user:${id}`, null, { until: input.until ?? null });
    },
    unbanUser: async (id, input) => {
      need("users.ban");
      requireReason(input);
      const u = users.find((x) => x.id === id);
      if (!u) throw new ApiError(404, "not_found");
      if (!u.banned) return {};
      if (u.csam_locked) {
        return {
          approval: makeApproval("unban.csam", `user:${id}`, input.reason, "users.ban", () =>
            unban(u),
          ),
        };
      }
      unban(u);
      u.recent_actions.unshift({
        id: `ma${auditSeq + 1}`,
        action: "user.unban",
        reason: input.reason,
        created_at: iso(),
      });
      addAudit("user.unban", `user:${id}`, null, null);
      return {};
    },

    listNamespaces: async (q) => {
      need("overview.read");
      return clone(namespaces.filter((n) => !q.query || n.slug.includes(q.query)));
    },
    listReserved: async () => {
      need("overview.read");
      return clone(reserved);
    },
    addReserved: async (input) => {
      need("namespaces.govern");
      requireReason(input);
      if (!SLUG_RE.test(input.slug)) throw new ApiError(422, "request.invalid");
      if (reserved.some((r) => r.slug === input.slug))
        throw new ApiError(409, "namespace.reserved");
      reserved.push({ slug: input.slug, reason: input.reason });
      reserved.sort((a, b) => a.slug.localeCompare(b.slug));
      addAudit("namespace.reserve", `namespace:${input.slug}`, null, { reason: input.reason });
    },
    removeReserved: async (slug, input) => {
      need("namespaces.govern");
      requireReason(input);
      const i = reserved.findIndex((r) => r.slug === slug);
      if (i < 0) throw new ApiError(404, "not_found");
      reserved.splice(i, 1);
      addAudit("namespace.unreserve", `namespace:${slug}`, null, { reason: input.reason });
    },
    setNamespaceStatus: async (slug, input) => {
      need("namespaces.govern");
      requireReason(input);
      const n = namespaces.find((x) => x.slug === slug);
      if (!n) throw new ApiError(404, "not_found");
      n.status = input.status;
      addAudit(
        input.status === "suspended" ? "namespace.suspend" : "namespace.unsuspend",
        `namespace:${slug}`,
        null,
        null,
      );
    },
    renameNamespace: async (slug, input) => {
      need("namespaces.govern");
      requireReason(input);
      const n = namespaces.find((x) => x.slug === slug);
      if (!n) throw new ApiError(404, "not_found");
      if (!SLUG_RE.test(input.new_slug)) throw new ApiError(422, "request.invalid");
      if (input.new_slug === slug) throw new ApiError(422, "namespace.same_name");
      const owner = namespaces.find((x) => x.redirects.includes(input.new_slug));
      // 允许改回这个 namespace 自己以前用过的名字；别人的旧名永久占用。
      if (namespaces.some((x) => x.slug === input.new_slug) || (owner && owner !== n)) {
        throw new ApiError(409, "namespace.taken");
      }
      n.redirects = [...n.redirects.filter((r) => r !== input.new_slug), slug].sort();
      n.slug = input.new_slug;
      addAudit("namespace.rename", `namespace:${slug}`, { slug }, { slug: input.new_slug });
    },

    listLegalRequests: async () => {
      need("legal.manage");
      return clone(legal.map(({ requester: _r, counter_notice: _c, actions: _a, ...l }) => l));
    },
    getLegalRequest: async (id) => {
      need("legal.manage");
      const l = legal.find((x) => x.id === id);
      if (!l) throw new ApiError(404, "not_found");
      // 与后端一致：每次查看申请人信息都写一条审计记录。
      addAudit("legal.view", `legal_request:${id}`, null, null);
      return clone(l);
    },
    createLegalRequest: async (input) => {
      need("legal.manage");
      requireReason(input);
      if (!input.requester.name.trim() || input.subjects.length === 0) {
        throw new ApiError(422, "request.invalid");
      }
      legalSeq += 1;
      const id = `lr${legalSeq}`;
      legal.unshift({
        id,
        kind: input.kind,
        received_at: input.received_at,
        deadline: input.deadline ?? null,
        status: "open",
        subjects: input.subjects,
        requester: input.requester,
        counter_notice: null,
        counter_notice_received_at: null,
        restore_not_before: null,
        restore_deadline: null,
        court_action_at: null,
        restored_at: null,
        actions: [],
      });
      // 审计中不记录申请人信息。
      addAudit("legal.register", `legal_request:${id}`, null, {
        kind: input.kind,
        subjects: input.subjects,
        reason: input.reason,
      });
      return { id };
    },

    listCsamIncidents: async () => {
      need("csam.read");
      return clone(incidents);
    },
    flagCsam: async (input) => {
      need("tombstone.policy", "legal.manage");
      requireReason(input);
      if (!DIGEST_RE.test(input.blob_digest)) throw new ApiError(422, "request.invalid");
      const id = `inc${incidents.length + 1}`;
      incidents.unshift({
        id,
        upload_id: null,
        blob_digest: input.blob_digest,
        reason: "staff_flag",
        status: "open",
        ncmec_report_id: null,
        created_at: iso(),
        evidence_expires_at: null,
      });
      addAudit("csam.flag", `csam_incident:${id}`, null, { blob_digest: input.blob_digest });
      return { incident_id: id, affected_releases: 1, blocked: 1 };
    },
    reportCsamIncident: async (id, input) => {
      need("csam.report");
      requireReason(input);
      const i = incidents.find((x) => x.id === id);
      if (!i) throw new ApiError(404, "not_found");
      if (i.status !== "open") throw new ApiError(409, "csam.already_reported");
      i.status = "reported";
      i.ncmec_report_id = input.ncmec_report_id;
      i.evidence_expires_at = at(EVIDENCE_RETENTION_MS);
      addAudit("csam.reported", `csam_incident:${id}`, { status: "open" }, { status: "reported" });
    },

    listQueues: async () => {
      need("jobs.manage");
      return clone(queues);
    },
    listFailedJobs: async () => {
      need("jobs.manage");
      return clone(failed);
    },
    retryJob: async (id, input) => {
      need("jobs.manage");
      requireReason(input);
      takeFailed(id);
      addAudit("job.retry", `job:${id}`, null, null);
    },
    cancelJob: async (id, input) => {
      need("jobs.manage");
      requireReason(input);
      takeFailed(id);
      addAudit("job.cancel", `job:${id}`, null, null);
    },

    listStaff: async () => {
      need("staff.manage");
      return clone(staff);
    },
    setStaffRoles: async (userId, input) => {
      need("staff.manage");
      requireReason(input);
      const member = staff.find((s) => s.id === userId);
      if (!member) throw new ApiError(404, "not_found");
      const roles = [...new Set(input.roles)];
      if (member.roles.includes("owner") && !roles.includes("owner")) {
        return {
          approval: makeApproval(
            "staff.remove_owner",
            `user:${userId}`,
            input.reason,
            "staff.manage",
            () => setRoles(member, roles),
          ),
        };
      }
      setRoles(member, roles);
      return {};
    },

    revokeCredentials: async (id, input) => {
      need("users.ban");
      requireReason(input);
      const u = users.find((x) => x.id === id);
      if (!u) throw new ApiError(404, "not_found");
      if (input.sessions === false && input.tokens === false) {
        throw new ApiError(422, "admin.nothing_to_revoke");
      }
      const sessions = input.sessions === false ? 0 : u.sessions;
      const tokens = input.tokens === false ? 0 : u.tokens;
      u.sessions -= sessions;
      u.tokens -= tokens;
      addAudit("user.revoke_credentials", `user:${id}`, null, { sessions, tokens });
      return { sessions_revoked: sessions, tokens_revoked: tokens };
    },
    setUploadLock: async (id, input) => {
      need("users.ban");
      requireReason(input);
      const u = users.find((x) => x.id === id);
      if (!u) throw new ApiError(404, "not_found");
      if (u.uploads_locked === input.locked) return;
      u.uploads_locked = input.locked;
      u.uploads_locked_at = input.locked ? iso() : null;
      addAudit(input.locked ? "user.lock_uploads" : "user.unlock_uploads", `user:${id}`, null, {
        reason: input.reason,
      });
    },

    listGuests: async (q) => {
      need("overview.read");
      return clone(
        guests.filter(
          (g) =>
            (!q.status || q.status === "all" || (q.status === "disabled") === g.disabled) &&
            (!q.query || g.display_name.toLowerCase().includes(q.query.toLowerCase())),
        ),
      );
    },
    getGuest: async (id) => {
      need("overview.read");
      const g = guests.find((x) => x.id === id);
      if (!g) throw new ApiError(404, "not_found");
      return clone(g);
    },
    disableGuest: async (id, input) => {
      need("users.ban");
      requireReason(input);
      const g = guests.find((x) => x.id === id);
      if (!g) throw new ApiError(404, "not_found");
      if (g.disabled) return;
      g.disabled = true;
      g.disabled_at = iso();
      g.sessions = 0;
      addAudit("guest.disable", `guest:${id}`, null, { reason: input.reason });
    },
    enableGuest: async (id, input) => {
      need("users.ban");
      requireReason(input);
      const g = guests.find((x) => x.id === id);
      if (!g) throw new ApiError(404, "not_found");
      if (!g.disabled) return;
      g.disabled = false;
      g.disabled_at = null;
      addAudit("guest.enable", `guest:${id}`, null, { reason: input.reason });
    },

    transferNamespace: async (slug, input) => {
      need("namespaces.govern");
      requireReason(input);
      const n = namespaces.find((x) => x.slug === slug);
      if (!n) throw new ApiError(404, "not_found");
      if (n.kind === "system") throw new ApiError(422, "namespace.not_transferable");
      const target = users.find((u) => u.id === input.to || u.email === input.to);
      if (!target) throw new ApiError(422, "namespace.transfer_target_not_found");
      if (target.email === n.owner) throw new ApiError(422, "namespace.same_owner");
      const pending = approvals.some(
        (a) =>
          a.status === "pending" &&
          a.kind === "namespace.transfer" &&
          a.subject.startsWith(`namespace:@${slug} `),
      );
      if (pending) throw new ApiError(409, "namespace.transfer_pending");
      return {
        approval: makeApproval(
          "namespace.transfer",
          `namespace:@${slug} → ${target.id}`,
          input.reason,
          "namespaces.govern",
          () => {
            addAudit(
              "namespace.transfer",
              `namespace:${slug}`,
              { owner: n.owner },
              { owner: target.email },
            );
            n.owner = target.email;
          },
        ),
      };
    },

    disableAccess: async (id, input) => {
      need("legal.manage");
      requireReason(input);
      const l = legal.find((x) => x.id === id);
      if (!l) throw new ApiError(404, "not_found");
      if (l.status === "closed") throw new ApiError(409, "legal.closed");
      const found = input.creations.map((ref) => {
        const c = findCreation(ref.trim());
        if (!c) throw new ApiError(422, "legal.subject_not_found", ref);
        return c;
      });
      const set = hiddenByLegal.get(id) ?? new Set<string>();
      for (const c of found) {
        c.status = "hidden";
        set.add(c.id);
        l.actions.push({
          id: `ma${auditSeq + 1}`,
          action: "creation.hide",
          subject: { creation: c.id },
          created_at: iso(),
          reverted: false,
        });
        addAudit("creation.hide", `creation:${c.id}`, null, { legal_request_id: id });
      }
      hiddenByLegal.set(id, set);
      if (l.status === "open") l.status = "actioned";
      addAudit("legal.disable_access", `legal_request:${id}`, null, {
        creations: found.map((c) => c.id),
      });
      return { hidden: found.length };
    },
    registerCounterNotice: async (id, input) => {
      need("legal.manage");
      requireReason(input);
      const l = legal.find((x) => x.id === id);
      if (!l) throw new ApiError(404, "not_found");
      if (l.kind !== "dmca") throw new ApiError(422, "legal.counter_notice_dmca_only");
      if (l.status !== "actioned") throw new ApiError(409, "legal.not_actioned");
      const received = new Date(input.received_at);
      if (received > now()) throw new ApiError(422, "legal.received_in_future");
      const notBefore = addWeekdays(received, RESTORE_NOT_BEFORE_WEEKDAYS).toISOString();
      const deadline = addWeekdays(received, RESTORE_DEADLINE_WEEKDAYS).toISOString();
      l.status = "counter_notice";
      l.counter_notice = input.counter_notice;
      l.counter_notice_received_at = received.toISOString();
      l.restore_not_before = notBefore;
      l.restore_deadline = deadline;
      addAudit("legal.counter_notice", `legal_request:${id}`, null, {
        restore_not_before: notBefore,
        restore_deadline: deadline,
      });
      return { restore_not_before: notBefore, restore_deadline: deadline };
    },
    recordCourtAction: async (id, input) => {
      need("legal.manage");
      requireReason(input);
      const l = legal.find((x) => x.id === id);
      if (!l) throw new ApiError(404, "not_found");
      if (l.status !== "counter_notice") throw new ApiError(409, "legal.no_counter_notice");
      if (l.court_action_at) return;
      l.court_action_at = iso();
      addAudit("legal.court_action", `legal_request:${id}`, null, { reason: input.reason });
    },
    restoreLegal: async (id, input) => {
      need("legal.manage");
      requireReason(input);
      const l = legal.find((x) => x.id === id);
      if (!l) throw new ApiError(404, "not_found");
      if (l.status !== "counter_notice") throw new ApiError(409, "legal.no_counter_notice");
      if (l.court_action_at) throw new ApiError(409, "legal.court_action_filed");
      if (!l.restore_not_before || now() < new Date(l.restore_not_before)) {
        throw new ApiError(409, "legal.restore_window_not_open");
      }
      const restored: string[] = [];
      for (const cid of hiddenByLegal.get(id) ?? []) {
        const c = findCreation(cid);
        if (c) {
          c.status = "active";
          restored.push(c.id);
        }
      }
      for (const a of l.actions) a.reverted = true;
      l.status = "closed";
      l.restored_at = iso();
      const late = l.restore_deadline !== null && now() > new Date(l.restore_deadline);
      addAudit("legal.restore", `legal_request:${id}`, null, { restored, late });
      return { restored, kept_hidden: [], not_restorable: 0, late };
    },
    exportLegalCase: async (id, input) => {
      need("legal.manage");
      requireReason(input);
      const l = legal.find((x) => x.id === id);
      if (!l) throw new ApiError(404, "not_found");
      addAudit("legal.export", `legal_request:${id}`, null, { reason: input.reason });
      return jsonFile(
        {
          format: "char-pub.legal-case/1",
          exported_at: iso(),
          exported_by: me.email,
          request: l,
          audit: audit.filter((a) => a.subject === `legal_request:${id}`),
        },
        `legal-request-${id}.json`,
      );
    },

    getEvidence: async (id) => {
      need("csam.evidence");
      const i = incidents.find((x) => x.id === id);
      if (!i) throw new ApiError(404, "not_found");
      const hex = i.blob_digest.slice("sha256:".length);
      const meta: EvidenceMeta = {
        incident_id: i.id,
        evidence_digest: i.blob_digest,
        blob_digest: i.blob_digest,
        size: evidenceSize,
        media_type: "image/png",
        present: true,
        storage: { bucket: "evidence", key: `evidence/cas/sha256/${hex.slice(0, 2)}/${hex}` },
        retain_until: i.evidence_expires_at,
      };
      return clone(meta);
    },
    downloadEvidence: async (id, input) => {
      need("csam.evidence");
      requireReason(input);
      const i = incidents.find((x) => x.id === id);
      if (!i) throw new ApiError(404, "not_found");
      addAudit("csam.evidence_ticket", `csam_incident:${id}`, null, { reason: input.reason });
      addAudit("csam.evidence_download", `csam_incident:${id}`, null, null);
      // mock 不保存任何素材，下载内容只是占位字节。
      return {
        blob: new Blob([new Uint8Array(16)], { type: "application/octet-stream" }),
        filename: `evidence-${id}.bin`,
      };
    },

    exportAudit: async (input) => {
      need("audit.read_all");
      requireReason(input);
      const rows = audit.filter(
        (a) =>
          (!input.action || a.action === input.action) &&
          (!input.subject || a.subject === input.subject) &&
          (!input.before || Number(a.id) < Number(input.before)),
      );
      const { reason, ...filters } = input;
      addAudit("audit.export", "audit_log", null, { reason, filters, count: rows.length });
      const lines = rows.map((r) => `${JSON.stringify(r)}\n`);
      return {
        blob: new Blob(lines, { type: "application/x-ndjson" }),
        filename: `audit-${iso().slice(0, 10)}.ndjson`,
        next_before: null,
      };
    },

    signOutStaff: async (userId, input) => {
      need("staff.manage");
      requireReason(input);
      const member = staff.find((s) => s.id === userId);
      if (!member) throw new ApiError(404, "not_found");
      addAudit("staff.sign_out", `user:${userId}`, null, { access: "not_configured" });
      return { sessions_revoked: 1, access: "not_configured" as const };
    },
  };
}
