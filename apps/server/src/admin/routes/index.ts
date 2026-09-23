/** admin 进程挂载的全部业务路由模块。 */
import type { Hono } from "hono";
import type { AccessRevoker } from "../access-revoke.js";
import type { AdminEnv } from "../app.js";
import { registerAudit, registerFlags } from "../ops-routes.js";
import { registerAuditExport } from "./audit-export.js";
import { registerContent } from "./content.js";
import { registerCsam } from "./csam.js";
import { registerCsamEvidence } from "./csam-evidence.js";
import { registerGuests } from "./guests.js";
import { registerJobs } from "./jobs.js";
import { registerLegal } from "./legal.js";
import { registerLegalActions } from "./legal-actions.js";
import { registerMe } from "./me.js";
import { registerNamespaces } from "./namespaces.js";
import { registerReports } from "./reports.js";
import { registerStaff } from "./staff.js";
import { registerStaffSignOut } from "./staff-sign-out.js";
import { registerTombstone } from "./tombstone.js";
import { registerUsers } from "./users.js";

export interface AdminModuleOptions {
  /** 吊销员工的 Cloudflare Access 会话；没有配置 Access API 时为空。 */
  revokeAccess?: AccessRevoker;
}

export function adminModules(
  legalKey: Uint8Array,
  opts: AdminModuleOptions = {},
): ((app: Hono<AdminEnv>) => void)[] {
  return [
    registerMe,
    registerFlags,
    registerAudit,
    registerAuditExport,
    registerReports,
    registerContent,
    registerTombstone,
    registerUsers,
    registerGuests,
    registerNamespaces,
    registerCsam,
    registerCsamEvidence,
    registerLegal(legalKey),
    registerLegalActions(legalKey),
    registerJobs,
    registerStaff,
    registerStaffSignOut(opts.revokeAccess),
  ];
}
