/**
 * Admin 的员工权限。员工角色可以叠加，`owner` 拥有全部权限。
 *
 * 能力矩阵：
 *
 * | 能力                                   | viewer | moderator | trust_safety | legal | admin | owner |
 * |----------------------------------------|--------|-----------|--------------|-------|-------|-------|
 * | 查看举报、Creation、Release、用户概况  | ✓      | ✓         | ✓            | ✓     | ✓     | ✓     |
 * | 处理普通举报（驳回、隐藏、强制评级）   |        | ✓         | ✓            |       | ✓     | ✓     |
 * | 隐藏 / 恢复 Creation                   |        | ✓         | ✓            |       | ✓     | ✓     |
 * | 代作者 yank Release                    |        | ✓         | ✓            |       | ✓     | ✓     |
 * | 封禁 / 解封用户、吊销会话和 Token      |        |           | ✓            |       | ✓     | ✓     |
 * | 查看 CSAM 事件与隔离区                 |        |           | ✓（只读）    | ✓     |       | ✓     |
 * | 提交 NCMEC 报告                        |        |           |              | ✓     |       | ✓     |
 * | 登记和处理法律请求                     |        |           |              | ✓     |       | ✓     |
 * | Tombstone：严重违规                    |        |           | ✓            |       |       | ✓     |
 * | Tombstone：法律依据                    |        |           |              | ✓     |       | ✓     |
 * | Namespace 治理                         |        |           |              |       | ✓     | ✓     |
 * | Kill switch                            |        |           | ✓            |       | ✓     | ✓     |
 * | 任务队列：查看、重试、取消             |        |           |              |       | ✓     | ✓     |
 * | 审计日志：只看自己的操作               | ✓      |           |              |       |       |       |
 * | 审计日志：查看与导出全部               |        |           |              | ✓     | ✓     | ✓     |
 * | 管理员工与角色                         |        |           |              |       |       | ✓     |
 *
 * 所有写操作都必须填写理由（至少 10 个字符）；与法律请求相关的操作还要关联法律请求。
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

export const STAFF_CAPABILITIES = [
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
] as const;
export type StaffCapability = (typeof STAFF_CAPABILITIES)[number];

const MATRIX: Record<Exclude<StaffRole, "owner">, readonly StaffCapability[]> = {
  viewer: ["overview.read", "audit.read_own"],
  moderator: ["overview.read", "reports.handle", "creations.hide", "releases.yank"],
  trust_safety: [
    "overview.read",
    "reports.handle",
    "creations.hide",
    "releases.yank",
    "users.ban",
    "csam.read",
    "tombstone.policy",
    "flags.toggle",
  ],
  legal: [
    "overview.read",
    "audit.read_all",
    "csam.read",
    "csam.report",
    "legal.manage",
    "tombstone.legal",
  ],
  admin: [
    "overview.read",
    "audit.read_all",
    "reports.handle",
    "creations.hide",
    "releases.yank",
    "users.ban",
    "namespaces.govern",
    "flags.toggle",
    "jobs.manage",
  ],
};

export function capabilitiesOf(roles: readonly StaffRole[]): Set<StaffCapability> {
  if (roles.includes("owner")) return new Set(STAFF_CAPABILITIES);
  const out = new Set<StaffCapability>();
  for (const r of roles) {
    if (r === "owner") continue;
    for (const c of MATRIX[r] ?? []) out.add(c);
  }
  return out;
}

export function staffCan(roles: readonly StaffRole[], cap: StaffCapability): boolean {
  return capabilitiesOf(roles).has(cap);
}

export const MIN_REASON_LENGTH = 10;

/** 员工写操作的公共要求：必须有足够长的理由；法律类操作必须关联法律请求。 */
export function validateStaffAction(input: {
  capability: StaffCapability;
  reason: string | undefined;
  legal_request_id?: string | undefined;
}): { ok: true } | { ok: false; code: string } {
  const reason = input.reason?.trim() ?? "";
  if (reason.length < MIN_REASON_LENGTH) return { ok: false, code: "admin.reason_required" };
  if (
    (input.capability === "tombstone.legal" || input.capability === "legal.manage") &&
    !input.legal_request_id
  ) {
    return { ok: false, code: "admin.legal_request_required" };
  }
  return { ok: true };
}

/**
 * 四眼原则：影响特别大的操作需要两名员工。第一名员工发起，第二名（不同的人）确认。
 * 只有一名具备权限的员工时，发起后必须等待冷静期（默认 24 小时）才能由发起人自己确认，
 * 同时通知 owner。
 */
export const FOUR_EYES_THRESHOLD_RELEASES = 50;
export const COOLING_OFF_MS = 24 * 60 * 60 * 1000;

export type FourEyesKind = "tombstone.large" | "unban.csam" | "staff.remove_owner";

export function requiresFourEyes(input: {
  kind: "tombstone" | "unban" | "staff.remove_role";
  affected_releases?: number;
  csam_locked?: boolean;
  role?: StaffRole;
}): FourEyesKind | null {
  if (input.kind === "tombstone" && (input.affected_releases ?? 0) > FOUR_EYES_THRESHOLD_RELEASES) {
    return "tombstone.large";
  }
  if (input.kind === "unban" && input.csam_locked) return "unban.csam";
  if (input.kind === "staff.remove_role" && input.role === "owner") return "staff.remove_owner";
  return null;
}

export interface PendingApproval {
  kind: FourEyesKind;
  initiated_by: string;
  initiated_at: number;
  /** 发起时有资格确认的其他员工数量。 */
  other_eligible_staff: number;
}

export function canConfirm(
  p: PendingApproval,
  confirmer: string,
  now: number,
): { ok: true } | { ok: false; code: string } {
  if (confirmer !== p.initiated_by) return { ok: true };
  if (p.other_eligible_staff > 0) return { ok: false, code: "admin.four_eyes_required" };
  if (now - p.initiated_at < COOLING_OFF_MS) return { ok: false, code: "admin.cooling_off" };
  return { ok: true };
}
