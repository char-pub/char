/** admin 进程挂载的全部业务路由模块。 */
import type { Hono } from "hono";
import type { AdminEnv } from "../app.js";
import { registerAudit, registerFlags } from "../ops-routes.js";
import { registerContent } from "./content.js";
import { registerCsam } from "./csam.js";
import { registerGuests } from "./guests.js";
import { registerJobs } from "./jobs.js";
import { registerLegal } from "./legal.js";
import { registerMe } from "./me.js";
import { registerNamespaces } from "./namespaces.js";
import { registerReports } from "./reports.js";
import { registerStaff } from "./staff.js";
import { registerTombstone } from "./tombstone.js";
import { registerUsers } from "./users.js";

export function adminModules(legalKey: Uint8Array): ((app: Hono<AdminEnv>) => void)[] {
  return [
    registerMe,
    registerFlags,
    registerAudit,
    registerReports,
    registerContent,
    registerTombstone,
    registerUsers,
    registerGuests,
    registerNamespaces,
    registerCsam,
    registerLegal(legalKey),
    registerJobs,
    registerStaff,
  ];
}
