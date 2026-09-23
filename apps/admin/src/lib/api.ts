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
  | "csam.evidence"
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
  /** 发布时算出的 effective rating 与强制评级中较高的一个。 */
  effective_rating: string;
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
  kind: "tombstone.large" | "unban.csam" | "staff.remove_owner" | "namespace.transfer";
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
  /** 以 `@namespace` 表示。 */
  namespaces: string[];
  banned: boolean;
  ban_reason: string | null;
  ban_expires: string | null;
  csam_locked: boolean;
  tokens: number;
  sessions: number;
  /** 被员工锁定上传：不能再上传文件或导入角色卡。 */
  uploads_locked: boolean;
  uploads_locked_at: string | null;
  created_at: string;
}

/** `GET /v1/admin/users/:id`：概况之外的作品数量与最近的处置记录。 */
export interface UserDetail extends UserAdminView {
  creations: number;
  recent_actions: { id: string; action: string; reason: string; created_at: string }[];
}

export interface StaffMember {
  id: string;
  email: string;
  name: string;
  roles: StaffRole[];
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
  counter_notice_received_at: string | null;
  /** 收到反通知后允许恢复内容的最早与最晚时间。 */
  restore_not_before: string | null;
  restore_deadline: string | null;
  /** 投诉方告知已经起诉：这时不能恢复。 */
  court_action_at: string | null;
  restored_at: string | null;
}

export interface CounterNotice {
  name: string;
  email?: string;
  address: string;
  /** 反通知正文：善意声明与同意管辖的声明。 */
  statement: string;
}

/** 与法律请求关联的处置记录。 */
export interface LegalAction {
  id: string;
  action: string;
  subject: Record<string, unknown>;
  created_at: string;
  reverted: boolean;
}

export interface RestoreResult {
  restored: string[];
  /** 因其他原因仍然隐藏的 Creation。 */
  kept_hidden: string[];
  /** 已经 tombstone 的对象数量：不可恢复。 */
  not_restorable: number;
  /** 超过了最晚恢复期限。 */
  late: boolean;
}

export interface LegalRequester {
  name: string;
  email?: string;
  organization?: string;
  address?: string;
}

/** 详情包含解密后的申请人信息；每次查看都会写一条审计记录。 */
export interface LegalRequestDetail extends LegalRequest {
  requester: LegalRequester;
  counter_notice: CounterNotice | null;
  actions: LegalAction[];
}

export interface NewLegalRequest {
  kind: LegalRequest["kind"];
  requester: LegalRequester;
  received_at: string;
  deadline?: string;
  /** 涉及的对象：URL、`@ns/name@label` 或内容 digest。 */
  subjects: string[];
  reason: string;
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

/** 隔离证据的元数据：页面上只显示这些，不预览内容。 */
export interface EvidenceMeta {
  incident_id: string;
  evidence_digest: string;
  blob_digest: string;
  size: number | null;
  media_type: string | null;
  present: boolean;
  storage: { bucket: string; key: string };
  retain_until: string | null;
}

/** 下载得到的文件：由调用方交给浏览器保存，不在页面中打开。 */
export interface DownloadedFile {
  blob: Blob;
  filename: string;
}

export interface AuditExportFilters {
  from?: string;
  to?: string;
  action?: string;
  subject?: string;
  actor?: string;
  before?: string;
}

export interface GuestAdminView {
  id: string;
  /** 访客自己填写的显示名：用户内容。 */
  display_name: string;
  verified_at: string | null;
  verification_kind: string | null;
  disabled: boolean;
  disabled_at: string | null;
  sessions: number;
  contributions: number;
  created_at: string;
}

/** 手动标记 CSAM 的结果：新建的事件、受影响的 Release 数量、写入黑名单的 digest 数量。 */
export interface CsamFlagResult {
  incident_id: string;
  affected_releases: number;
  blocked: number;
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
  /** NDJSON 导出，每次最多 10000 条；还有更多时返回下一批的起点。 */
  exportAudit(
    input: AuditExportFilters & WithReason,
  ): Promise<DownloadedFile & { next_before: string | null }>;

  listReports(): Promise<Report[]>;
  claimReport(id: string, input: WithReason): Promise<void>;
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
  cancelApproval(id: string, input: WithReason): Promise<void>;

  listUsers(q: { query?: string }): Promise<UserAdminView[]>;
  getUser(id: string): Promise<UserDetail>;
  banUser(id: string, input: { until?: string } & WithReason): Promise<void>;
  unbanUser(id: string, input: WithReason): Promise<{ approval?: PendingApproval }>;
  /** 吊销会话与个人 Token，不封禁账号。 */
  revokeCredentials(
    id: string,
    input: { sessions?: boolean; tokens?: boolean } & WithReason,
  ): Promise<{ sessions_revoked: number; tokens_revoked: number }>;
  setUploadLock(id: string, input: { locked: boolean } & WithReason): Promise<void>;

  listGuests(q: {
    status?: "all" | "active" | "disabled";
    query?: string;
  }): Promise<GuestAdminView[]>;
  getGuest(id: string): Promise<GuestAdminView>;
  disableGuest(id: string, input: WithReason): Promise<void>;
  enableGuest(id: string, input: WithReason): Promise<void>;

  listNamespaces(q: { query?: string }): Promise<NamespaceAdminView[]>;
  listReserved(): Promise<ReservedName[]>;
  addReserved(input: { slug: string } & WithReason): Promise<void>;
  removeReserved(slug: string, input: WithReason): Promise<void>;
  setNamespaceStatus(
    slug: string,
    input: { status: "active" | "suspended" } & WithReason,
  ): Promise<void>;
  renameNamespace(slug: string, input: { new_slug: string } & WithReason): Promise<void>;
  /** 转让总是需要第二名员工确认，返回待确认请求。`to` 是用户 ID 或邮箱。 */
  transferNamespace(
    slug: string,
    input: { to: string } & WithReason,
  ): Promise<{ approval: PendingApproval }>;

  listLegalRequests(): Promise<LegalRequest[]>;
  getLegalRequest(id: string): Promise<LegalRequestDetail>;
  createLegalRequest(input: NewLegalRequest): Promise<{ id: string }>;
  /** 隐藏涉及的 Creation（可以恢复）。 */
  disableAccess(
    id: string,
    input: { creations: string[] } & WithReason,
  ): Promise<{ hidden: number }>;
  registerCounterNotice(
    id: string,
    input: { counter_notice: CounterNotice; received_at: string } & WithReason,
  ): Promise<{ restore_not_before: string; restore_deadline: string }>;
  recordCourtAction(id: string, input: WithReason): Promise<void>;
  restoreLegal(id: string, input: WithReason): Promise<RestoreResult>;
  /** 案件记录（包含解密后的申请人信息），导出本身写审计。 */
  exportLegalCase(id: string, input: WithReason): Promise<DownloadedFile>;

  listCsamIncidents(): Promise<CsamIncident[]>;
  flagCsam(input: { blob_digest: string } & WithReason): Promise<CsamFlagResult>;
  reportCsamIncident(id: string, input: { ncmec_report_id: string } & WithReason): Promise<void>;
  getEvidence(incidentId: string): Promise<EvidenceMeta>;
  /** 签发一次性凭据并立即用它下载；只保存为文件，不在页面中预览。 */
  downloadEvidence(incidentId: string, input: WithReason): Promise<DownloadedFile>;

  listQueues(): Promise<QueueStats[]>;
  listFailedJobs(): Promise<FailedJob[]>;
  retryJob(id: string, input: WithReason): Promise<void>;
  cancelJob(id: string, input: WithReason): Promise<void>;

  listStaff(): Promise<StaffMember[]>;
  /** 移除 owner 角色需要第二名 owner 确认，这时返回待确认请求。 */
  setStaffRoles(
    userId: string,
    input: { roles: StaffRole[] } & WithReason,
  ): Promise<{ approval?: PendingApproval }>;
  /** 吊销员工在 www 的会话与 Cloudflare Access 会话。 */
  signOutStaff(
    userId: string,
    input: WithReason,
  ): Promise<{ sessions_revoked: number; access: "revoked" | "failed" | "not_configured" }>;
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
  "claimReport",
  "actOnReport",
  "getCreation",
  "hideCreation",
  "forceRating",
  "yankRelease",
  "previewTombstone",
  "requestTombstone",
  "listApprovals",
  "confirmApproval",
  "cancelApproval",
  "listUsers",
  "getUser",
  "banUser",
  "unbanUser",
  "listNamespaces",
  "listReserved",
  "addReserved",
  "removeReserved",
  "setNamespaceStatus",
  "renameNamespace",
  "listLegalRequests",
  "getLegalRequest",
  "createLegalRequest",
  "listCsamIncidents",
  "flagCsam",
  "reportCsamIncident",
  "listQueues",
  "listFailedJobs",
  "retryJob",
  "cancelJob",
  "listStaff",
  "setStaffRoles",
  "revokeCredentials",
  "setUploadLock",
  "listGuests",
  "getGuest",
  "disableGuest",
  "enableGuest",
  "transferNamespace",
  "disableAccess",
  "registerCounterNotice",
  "recordCourtAction",
  "restoreLegal",
  "exportLegalCase",
  "getEvidence",
  "downloadEvidence",
  "exportAudit",
  "signOutStaff",
]);
