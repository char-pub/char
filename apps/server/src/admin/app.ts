/**
 * admin 进程（admin-api.char.pub）。只挂载 admin 路由，公开的 api 进程没有这些路由。
 *
 * 三层防护：
 * 1. Cloudflare Access：GitHub 登录 + char-pub 组织成员（组织强制 2FA）。
 * 2. 本进程逐个请求校验 `Cf-Access-Jwt-Assertion`，并确认邮箱在员工名单中。
 * 3. 应用内角色：每个 admin 路由声明需要的能力（`StaffCapability`），写操作必须填写理由。
 *
 * 员工身份：Access 验证过的邮箱 → `auth_user` 中的用户 → `role` 字段里的员工角色
 * （逗号分隔）。没有任何员工角色的人即使通过了 Access 也会被拒绝。
 */
import { eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import type { z } from "zod";
import type { Services } from "../api/app.js";
import { authUser } from "../db/schema/index.js";
import {
  apiSecurityHeaders,
  errorHandler,
  jsonBodyLimit,
  originAuth,
  originCheck,
  problem,
  requestId,
} from "../http/middleware.js";
import { ACCESS_HEADER, type AccessConfig, verifyAccessJwt } from "./access.js";
import {
  STAFF_ROLES,
  type StaffCapability,
  type StaffRole,
  staffCan,
  validateStaffAction,
} from "./roles.js";

export interface Staff {
  user_id: string;
  email: string;
  roles: StaffRole[];
}

export type AdminEnv = {
  Variables: {
    services: Services;
    staff: Staff;
    requestId: string;
  };
};

export type AdminContext = Context<AdminEnv>;

export function parseRoles(role: string | null): StaffRole[] {
  if (!role) return [];
  const known = new Set<string>(STAFF_ROLES);
  return role
    .split(",")
    .map((r) => r.trim())
    .filter((r): r is StaffRole => known.has(r));
}

export interface AdminRouteSpec<B extends z.ZodType | undefined> {
  method: "get" | "post" | "put" | "patch" | "delete";
  path: string;
  capability: StaffCapability;
  /** 写操作的请求体必须包含 `reason`（至少 10 个字符），法律类操作还要 `legal_request_id`。 */
  body?: B;
  handler: (
    c: AdminContext,
    input: { body: B extends z.ZodType ? z.output<B> : undefined },
  ) => Promise<Response>;
}

/** 注册一个 admin 路由：检查员工能力；写操作检查理由。 */
export function adminRoute<B extends z.ZodType | undefined>(
  app: Hono<AdminEnv>,
  spec: AdminRouteSpec<B>,
): void {
  app[spec.method](spec.path, async (c) => {
    const staff = c.var.staff;
    if (!staffCan(staff.roles, spec.capability)) return problem(c, 403, "admin.forbidden");
    let body: unknown;
    if (spec.method !== "get") {
      const raw = (await c.req.json().catch(() => undefined)) as
        | { reason?: string; legal_request_id?: string }
        | undefined;
      const check = validateStaffAction({
        capability: spec.capability,
        reason: raw?.reason,
        legal_request_id: raw?.legal_request_id,
      });
      if (!check.ok) return problem(c, 422, check.code);
      if (spec.body) {
        const parsed = spec.body.safeParse(raw);
        if (!parsed.success) {
          return problem(c, 422, "request.invalid", parsed.error.issues[0]?.message);
        }
        body = parsed.data;
      }
    }
    return spec.handler(c, { body: body as B extends z.ZodType ? z.output<B> : undefined });
  });
}

export interface AdminOptions {
  services: Services;
  access: AccessConfig;
  originSecrets: readonly string[];
  allowedOrigins: readonly string[];
  modules: readonly ((app: Hono<AdminEnv>) => void)[];
}

export function createAdmin(opts: AdminOptions): Hono<AdminEnv> {
  const app = new Hono<AdminEnv>();
  app.use(requestId(() => opts.services.ids.uuid()));
  if (opts.originSecrets.length > 0) app.use(originAuth({ secrets: opts.originSecrets }));
  app.use(apiSecurityHeaders());
  app.get("/healthz", (c) => c.json({ ok: true }));
  app.use(originCheck({ allowed: opts.allowedOrigins }));
  app.use(jsonBodyLimit());
  app.use(async (c, next) => {
    c.set("services", opts.services);
    let identity: { email: string };
    try {
      identity = await verifyAccessJwt(c.req.header(ACCESS_HEADER), opts.access);
    } catch {
      // 不区分具体原因，避免给探测者提供信息。
      return problem(c, 403, "admin.access_required");
    }
    const rows = await opts.services.db
      .select({ id: authUser.id, role: authUser.role, banned: authUser.banned })
      .from(authUser)
      .where(eq(authUser.email, identity.email))
      .limit(1);
    const user = rows[0];
    const roles = parseRoles(user?.role ?? null);
    if (!user || user.banned || roles.length === 0) return problem(c, 403, "admin.not_staff");
    c.set("staff", { user_id: user.id, email: identity.email, roles });
    await next();
  });
  for (const register of opts.modules) register(app);
  app.notFound((c) => problem(c, 404, "not_found"));
  app.onError(errorHandler as (err: Error, c: AdminContext) => Response);
  return app;
}
