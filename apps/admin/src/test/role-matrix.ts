/**
 * 权限矩阵的期望值（测试数据）。
 *
 * 按 admin 设计文档中的员工角色表逐项填写，刻意不从实现中导入：实现与期望各写一遍，
 * 任何一边改动都会让测试失败。服务端的角色表由 `test/roles-sync.test.ts` 另行比对。
 * 修改员工权限时，这里、`src/lib/roles.ts` 与服务端的角色表需要一起修改。
 */
import type { StaffCapability, StaffRole } from "../lib/api";

export const EXPECTED_CAPABILITIES: Record<StaffRole, readonly StaffCapability[]> = {
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
    "csam.read",
    "csam.report",
    "csam.evidence",
    "legal.manage",
    "tombstone.legal",
    "audit.read_all",
  ],
  admin: [
    "overview.read",
    "reports.handle",
    "creations.hide",
    "releases.yank",
    "users.ban",
    "namespaces.govern",
    "flags.toggle",
    "jobs.manage",
    "audit.read_all",
  ],
  owner: [
    "overview.read",
    "reports.handle",
    "creations.hide",
    "releases.yank",
    "users.ban",
    "csam.read",
    "csam.report",
    "csam.evidence",
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

/** 一个操作入口：按钮或链接的可访问名称，以及具备其中任一能力时才应该出现。 */
export interface ControlExpectation {
  name: string;
  any: readonly StaffCapability[];
}

/** 每个模块：路径、导航入口的能力、页面本身需要的能力（没有时显示无权限提示）、页面上的操作。 */
export interface ModuleExpectation {
  path: string;
  nav: string;
  navAny: readonly StaffCapability[];
  /** 页面需要其中任一能力；缺省表示所有员工都能打开。 */
  pageAny?: readonly StaffCapability[];
  /** 有权限时页面的一级标题。 */
  heading: string;
  /** 数据加载完成的标志：出现之后才能断言某个操作“不存在”。 */
  loaded: string | RegExp;
  controls: readonly ControlExpectation[];
}

const DECIDE: readonly StaffCapability[] = [
  "tombstone.policy",
  "tombstone.legal",
  "users.ban",
  "staff.manage",
  "namespaces.govern",
];

export const MODULES: readonly ModuleExpectation[] = [
  {
    path: "/",
    nav: "Dashboard",
    navAny: ["overview.read"],
    heading: "Dashboard",
    loaded: "Open reports",
    controls: [],
  },
  {
    path: "/reports",
    nav: "Reports",
    navAny: ["overview.read"],
    heading: "Report queue",
    loaded: "spam-bot-7",
    controls: [
      { name: "Claim", any: ["reports.handle"] },
      { name: "Dismiss", any: ["reports.handle"] },
      { name: "Force rating", any: ["reports.handle"] },
      { name: "Yank release", any: ["reports.handle"] },
    ],
  },
  {
    path: "/content",
    nav: "Content",
    navAny: ["overview.read"],
    heading: "Content",
    loaded: "Borrowed Hero",
    controls: [
      { name: "Hide", any: ["creations.hide"] },
      { name: "Force rating", any: ["reports.handle"] },
      { name: "Yank", any: ["releases.yank"] },
      { name: "Start tombstone", any: ["tombstone.policy", "tombstone.legal"] },
    ],
  },
  {
    path: "/tombstone",
    nav: "Tombstone",
    navAny: ["tombstone.policy", "tombstone.legal"],
    pageAny: ["tombstone.policy", "tombstone.legal"],
    heading: "Tombstone",
    loaded: "Subject (fragment, release, creation or asset digest)",
    controls: [{ name: "Preview impact", any: ["tombstone.policy", "tombstone.legal"] }],
  },
  {
    path: "/approvals",
    nav: "Approvals",
    navAny: DECIDE,
    pageAny: DECIDE,
    heading: "Approvals",
    loaded: /Pending four-eyes approvals|No pending approvals\./,
    // mock 预置的两条待确认请求分别需要 tombstone.policy 与 users.ban 才能确认；
    // 页面只列出当前员工能确认的请求，所以 legal 角色能打开页面但看不到它们。
    controls: [{ name: "Cancel request", any: ["tombstone.policy", "users.ban"] }],
  },
  {
    path: "/users",
    nav: "Users",
    navAny: ["overview.read"],
    heading: "Users",
    loaded: "alice@example.com",
    controls: [
      { name: "Details", any: ["overview.read"] },
      { name: "Revoke sessions", any: ["users.ban"] },
      { name: "Lock uploads", any: ["users.ban"] },
      { name: "Ban", any: ["users.ban"] },
      { name: "Unban", any: ["users.ban"] },
    ],
  },
  {
    path: "/guests",
    nav: "Guests",
    navAny: ["overview.read"],
    heading: "Guests",
    loaded: "Friendly visitor",
    controls: [
      { name: "Disable", any: ["users.ban"] },
      { name: "Enable", any: ["users.ban"] },
    ],
  },
  {
    path: "/namespaces",
    nav: "Namespaces",
    navAny: ["overview.read"],
    heading: "Namespaces",
    loaded: "@admin · infrastructure",
    controls: [
      { name: "Freeze", any: ["namespaces.govern"] },
      { name: "Rename", any: ["namespaces.govern"] },
      { name: "Transfer", any: ["namespaces.govern"] },
      { name: "Reserve a name", any: ["namespaces.govern"] },
      { name: "Release @admin", any: ["namespaces.govern"] },
    ],
  },
  {
    path: "/legal",
    nav: "Legal",
    navAny: ["legal.manage"],
    pageAny: ["legal.manage"],
    heading: "Legal requests",
    loaded: "lr1",
    controls: [
      { name: "Register request", any: ["legal.manage"] },
      { name: "Open", any: ["legal.manage"] },
    ],
  },
  {
    path: "/csam",
    nav: "CSAM incidents",
    navAny: ["csam.read"],
    pageAny: ["csam.read"],
    heading: "CSAM incidents",
    loaded: "inc1",
    controls: [
      { name: "Flag content as CSAM", any: ["tombstone.policy", "legal.manage"] },
      { name: "Record NCMEC report", any: ["csam.report"] },
      { name: "Evidence", any: ["csam.evidence"] },
    ],
  },
  {
    path: "/jobs",
    nav: "Jobs",
    navAny: ["jobs.manage"],
    pageAny: ["jobs.manage"],
    heading: "Jobs",
    loaded: "job_1",
    controls: [
      { name: "Retry", any: ["jobs.manage"] },
      { name: "Cancel", any: ["jobs.manage"] },
    ],
  },
  {
    path: "/flags",
    nav: "Kill switches",
    navAny: ["overview.read"],
    heading: "Kill switches",
    loaded: "Read-only mode",
    controls: [{ name: "Switch off", any: ["flags.toggle"] }],
  },
  {
    path: "/audit",
    nav: "Audit log",
    navAny: ["audit.read_own", "audit.read_all"],
    pageAny: ["audit.read_own", "audit.read_all"],
    heading: "Audit log",
    loaded: /No audit entries match\.|flag\.toggle/,
    controls: [
      { name: "Verify hash chain", any: ["audit.read_all"] },
      { name: "Export", any: ["audit.read_all"] },
    ],
  },
  {
    path: "/staff",
    nav: "Staff",
    navAny: ["staff.manage"],
    pageAny: ["staff.manage"],
    heading: "Staff",
    loaded: "moderator@char.pub",
    controls: [
      { name: "Edit roles", any: ["staff.manage"] },
      { name: "Sign out", any: ["staff.manage"] },
    ],
  },
];
