/**
 * admin-api 的前端契约。
 *
 * 类型与 `apps/server/src/admin/routes/` 的响应一致。列表接口在后端包在 `{ items }` 中，
 * 由 http-api 解开。本地开发可以设置 `VITE_ADMIN_MOCK=1` 使用 mock 实现。
 *
 * 所有写接口的请求体都包含 `reason`（至少 10 个字符）；法律类操作还要 `legal_request_id`。
 * 错误统一是 problem+json，前端只依赖其中的 `code`。
 */

export const STAFF_ROLES = [
  "viewer",
  "moderator",
  "trust_safety",
  "legal",
  "admin",
  "owner",
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export type StaffCapability =
  | "overview.read"
  | "reports.handle"
  | "creations.hide"
  | "releases.yank"
  | "users.ban"
  | "csam.read"
  | "csam.report"
  | "legal.manage"
  | "tombstone.policy"
  | "tombstone.legal"
  | "namespaces.govern"
  | "flags.toggle"
  | "jobs.manage"
  | "audit.read_own"
  | "audit.read_all"
  | "staff.manage";

export const MIN_REASON_LENGTH = 10;

/** `GET /v1/admin/me`：当前员工。 */
export interface Me {
  email: string;
  roles: StaffRole[];
  capabilities: StaffCapability[];
}

// ---------------------------------------------------------------------------
// 运行开关与审计
// ---------------------------------------------------------------------------

export type FlagKey =
  | "signups"
  | "uploads"
  | "publish"
  | "contributions"
  | "github_sync"
  | "guest_access"
  | "read_only";

export interface Flag {
  key: FlagKey;
  enabled: boolean;
  reason: string | null;
  updated_at: string | null;
}

export interface AuditItem {
  id: string;
  at: string;
  actor: { kind: string; id: string };
  action: string;
  subject: string;
  request_id: string | null;
  before: unknown;
  after: unknown;
  hash: string;
}

export interface AuditPage {
  items: AuditItem[];
  next_before: string | null;
}

export type AuditVerify =
  | { ok: true; count: number; head: string | null }
  | { ok: false; count: number; brokenAt: string; reason: string };

// ---------------------------------------------------------------------------
// 举报、内容、tombstone、用户、Namespace、法律、CSAM、任务
// ---------------------------------------------------------------------------

export type ReportCategory =
  | "sexual_minors"
  | "illegal"
  | "copyright"
  | "harassment"
  | "spam"
  | "rating"
  | "other";

export interface Report {
  id: string;
  category: ReportCategory;
  severity: "low" | "medium" | "high" | "critical";
  subject: { type: "creation" | "release" | "user" | "upload"; id: string; label: string };
  /** 举报人写的描述：用户内容，只能按纯文本显示。 */
  details: string;
  reporter: "user" | "guest" | "anonymous";
  status: "open" | "claimed" | "resolved" | "dismissed";
  assignee: string | null;
  created_at: string;
}

export type ReportAction = "dismiss" | "hide" | "force_rating" | "yank" | "escalate";

export interface CreationAdminView {
  id: string;
  ref: string;
  type: string;
  display_name: string;
  /** 作者写的简介：用户内容。 */
  summary: string;
  rating: string;
  forced_rating: string | null;
  status: "active" | "hidden" | "suspended";
  releases: { id: string; label: string; visibility: "public" | "private"; status: string }[];
}

/** `POST /v1/admin/tombstones/preview`：影响范围。 */
export interface TombstonePreview {
  subject: string;
  releases: {
    id: string;
    ref: string;
    label: string;
    /** 直接包含被下架对象，还是通过依赖闭包间接包含。 */
    via?: "direct" | "closure";
    status?: string;
  }[];
  objects: number;
  cdn_urls: string[];
  /** 受影响的下游作者，以 `@namespace` 表示（不暴露邮箱）。 */
  downstream_authors: string[];
  /** 影响超过阈值时需要四眼确认。 */
  requires_four_eyes: boolean;
}

export const TOMBSTONE_REASONS = [
  "legal.dmca",
  "legal.court_order",
  "legal.gdpr",
  "policy.minor_sexual",
  "policy.illegal",
  "policy.non_consensual",
  "policy.malware",
  "author.request",
] as const;
export type TombstoneReason = (typeof TOMBSTONE_REASONS)[number];

/** 需要两名员工的操作。 */
export interface PendingApproval {
  id: string;
  kind: "tombstone.large" | "unban.csam" | "staff.remove_owner";
  subject: string;
  initiated_by: string;
  initiated_at: string;
  reason: string;
  /** 发起时有资格确认的其他员工数量；为 0 时发起人要等冷静期结束才能自己确认。 */
  other_eligible_staff: number;
  /** 冷静期结束时间（只有单员工时有意义）。 */
  cooling_off_until: string;
  status: "pending" | "confirmed" | "cancelled";
}

export interface UserAdminView {
  id: string;
  email: string;
  name: string;
  namespaces: string[];
  banned: boolean;
  ban_reason: string | null;
  ban_expires: string | null;
  csam_locked: boolean;
  tokens: number;
  sessions: number;
  created_at: string;
}

export interface NamespaceAdminView {
  slug: string;
  kind: "user" | "org" | "system";
  status: "active" | "suspended";
  owner: string | null;
  redirects: string[];
}

export interface ReservedName {
  slug: string;
  reason: string;
}

export interface LegalRequest {
  id: string;
  kind: "dmca" | "court" | "gdpr" | "other";
  received_at: string;
  deadline: string | null;
  status: "open" | "actioned" | "counter_notice" | "closed";
  subjects: string[];
}

export interface CsamIncident {
  id: string;
  upload_id: string | null;
  blob_digest: string;
  reason: "csam_scan" | "staff_flag";
  status: "open" | "reported" | "closed";
  ncmec_report_id: string | null;
  created_at: string;
  evidence_expires_at: string | null;
}

export interface QueueStats {
  name: string;
  queued: number;
  active: number;
  failed: number;
  dead: number;
}

export interface FailedJob {
  id: string;
  queue: string;
  error: string;
  attempts: number;
  failed_at: string;
}

// ---------------------------------------------------------------------------
// 客户端接口：真实实现与 mock 实现都满足它
// ---------------------------------------------------------------------------

export interface WithReason {
  reason: string;
  legal_request_id?: string;
}

export interface AdminApi {
  me(): Promise<Me>;

  listFlags(): Promise<Flag[]>;
  setFlag(key: FlagKey, input: { enabled: boolean } & WithReason): Promise<void>;

  listAudit(q: { before?: string; subject?: string; limit?: number }): Promise<AuditPage>;
  verifyAudit(): Promise<AuditVerify>;

  listReports(): Promise<Report[]>;
  actOnReport(
    id: string,
    input: { action: ReportAction; rating?: string } & WithReason,
  ): Promise<void>;

  getCreation(ref: string): Promise<CreationAdminView>;
  hideCreation(id: string, input: { hidden: boolean } & WithReason): Promise<void>;
  forceRating(id: string, input: { rating: string } & WithReason): Promise<void>;
  yankRelease(id: string, input: WithReason): Promise<void>;

  previewTombstone(subject: string): Promise<TombstonePreview>;
  requestTombstone(
    input: { subject: string; reason_code: TombstoneReason } & WithReason,
  ): Promise<{ executed: true } | { executed: false; approval: PendingApproval }>;
  listApprovals(): Promise<PendingApproval[]>;
  confirmApproval(id: string, input: WithReason): Promise<void>;

  listUsers(q: { query?: string }): Promise<UserAdminView[]>;
  banUser(id: string, input: { until?: string } & WithReason): Promise<void>;
  unbanUser(id: string, input: WithReason): Promise<{ approval?: PendingApproval }>;

  listNamespaces(q: { query?: string }): Promise<NamespaceAdminView[]>;
  listReserved(): Promise<ReservedName[]>;
  addReserved(input: { slug: string } & WithReason): Promise<void>;
  setNamespaceStatus(
    slug: string,
    input: { status: "active" | "suspended" } & WithReason,
  ): Promise<void>;

  listLegalRequests(): Promise<LegalRequest[]>;
  listCsamIncidents(): Promise<CsamIncident[]>;

  listQueues(): Promise<QueueStats[]>;
  listFailedJobs(): Promise<FailedJob[]>;
  retryJob(id: string, input: WithReason): Promise<void>;
  cancelJob(id: string, input: WithReason): Promise<void>;
}

/** 后端返回的 problem+json。 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "ApiError";
  }
}

/** 已由后端实现的接口。目前全部接口都已接入，保留这个集合用于标注以后新增的接口。 */
export const IMPLEMENTED_ENDPOINTS = new Set<keyof AdminApi>([
  "me",
  "listFlags",
  "setFlag",
  "listAudit",
  "verifyAudit",
  "listReports",
  "actOnReport",
  "getCreation",
  "hideCreation",
  "forceRating",
  "yankRelease",
  "previewTombstone",
  "requestTombstone",
  "listApprovals",
  "confirmApproval",
  "listUsers",
  "banUser",
  "unbanUser",
  "listNamespaces",
  "listReserved",
  "addReserved",
  "setNamespaceStatus",
  "listLegalRequests",
  "listCsamIncidents",
  "listQueues",
  "listFailedJobs",
  "retryJob",
  "cancelJob",
]);
