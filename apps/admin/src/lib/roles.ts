/**
 * 员工角色到能力的映射，与 admin 进程中的角色表是同一张表。
 *
 * 前端用它做两件事：mock 后端按角色计算能力并据此拒绝请求；开发时切换 mock 角色。
 * 真实环境中的能力以 `GET /v1/admin/me` 返回的为准，前端不自行推导。
 * `test/roles-sync.test.ts` 会读取服务端的角色表并与这里逐项比对，两边不一致时测试失败。
 */
import { STAFF_ROLES, type StaffCapability, type StaffRole } from "./api";

export const STAFF_CAPABILITIES: readonly StaffCapability[] = [
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
];

/** owner 拥有全部能力，不在表中列出。 */
export const ROLE_CAPABILITIES: Record<Exclude<StaffRole, "owner">, readonly StaffCapability[]> = {
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

/** 角色可以叠加：能力取并集，顺序与 `STAFF_CAPABILITIES` 一致。 */
export function capabilitiesOf(roles: readonly StaffRole[]): StaffCapability[] {
  if (roles.includes("owner")) return [...STAFF_CAPABILITIES];
  const set = new Set<StaffCapability>();
  for (const r of roles) {
    if (r === "owner") continue;
    for (const c of ROLE_CAPABILITIES[r] ?? []) set.add(c);
  }
  return STAFF_CAPABILITIES.filter((c) => set.has(c));
}

export function isStaffRole(s: string): s is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(s);
}

/** 解析逗号分隔的角色列表，忽略未知角色。 */
export function parseRoles(raw: string | null | undefined): StaffRole[] {
  const out: StaffRole[] = [];
  for (const part of (raw ?? "").split(",")) {
    const r = part.trim();
    if (isStaffRole(r) && !out.includes(r)) out.push(r);
  }
  return out;
}

/** 确认各类四眼请求所需的能力；tombstone 的能力取决于原因代码，记录在请求里。 */
export const DECIDE_CAPABILITIES: readonly StaffCapability[] = [
  "tombstone.policy",
  "tombstone.legal",
  "users.ban",
  "staff.manage",
];
