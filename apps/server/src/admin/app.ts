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
import { cors } from "hono/cors";
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
  /** 需要的能力；给出多个时具备其中任意一个即可。 */
  capability: StaffCapability | readonly StaffCapability[];
  /**
   * 能力取决于请求内容时（例如下架的原因代码决定需要严重违规还是法律下架的权限），
   * 由它根据原始请求体给出实际需要的能力；缺省使用 `capability`。
   */
  capabilityOf?: (raw: unknown) => StaffCapability | undefined;
  /** 用 POST 传参但不修改任何数据的路由（例如影响范围预览），不要求填写理由。 */
  readOnly?: boolean;
  /**
   * 不要求关联法律请求的写操作：登记新的法律请求本身，以及具备法律权限的员工执行的
   * 非法律类操作（例如手动标记 CSAM）。
   */
  noLegalRequest?: boolean;
  /** 写操作的请求体必须包含 `reason`（至少 10 个字符），法律类操作还要 `legal_request_id`。 */
  body?: B;
  handler: (
    c: AdminContext,
    input: { body: B extends z.ZodType ? z.output<B> : undefined },
  ) => Promise<Response>;
}

/** 每个 admin 应用上注册过的路由，供权限矩阵测试逐个检查。 */
const REGISTERED = new WeakMap<object, AdminRouteSpec<z.ZodType | undefined>[]>();

export function registeredAdminRoutes(
  app: Hono<AdminEnv>,
): readonly AdminRouteSpec<z.ZodType | undefined>[] {
  return REGISTERED.get(app) ?? [];
}

/** 注册一个 admin 路由：检查员工能力；写操作检查理由。 */
export function adminRoute<B extends z.ZodType | undefined>(
  app: Hono<AdminEnv>,
  spec: AdminRouteSpec<B>,
): void {
  const list = REGISTERED.get(app) ?? [];
  list.push(spec as AdminRouteSpec<z.ZodType | undefined>);
  REGISTERED.set(app, list);
  // biome-ignore lint/plugin: 这里就是 adminRoute() 本身：先校验员工身份、能力与操作理由，再调用处理函数。
  app[spec.method](spec.path, async (c) => {
    const staff = c.var.staff;
    const isWrite = spec.method !== "get";
    const raw = isWrite
      ? ((await c.req.json().catch(() => undefined)) as
          | { reason?: string; legal_request_id?: string }
          | undefined)
      : undefined;
    const required = (isWrite && spec.capabilityOf?.(raw)) || spec.capability;
    const candidates: readonly StaffCapability[] = Array.isArray(required)
      ? required
      : [required as StaffCapability];
    const capability = candidates.find((cap) => staffCan(staff.roles, cap));
    if (!capability) return problem(c, 403, "admin.forbidden");
    let body: unknown;
    if (isWrite) {
      if (!spec.readOnly) {
        const check = validateStaffAction({
          capability,
          reason: raw?.reason,
          legal_request_id: spec.noLegalRequest ? "not-required" : raw?.legal_request_id,
        });
        if (!check.ok) return problem(c, 422, check.code);
      }
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
  // 安全响应头放在最外层，被源站校验拒绝的响应也带上。
  app.use(apiSecurityHeaders());
  if (opts.originSecrets.length > 0) app.use(originAuth({ secrets: opts.originSecrets }));
  // biome-ignore lint/plugin: 健康检查不读取任何数据，给负载均衡与部署探针使用。
  app.get("/healthz", (c) => c.json({ ok: true }));
  // admin SPA 与 admin-api 在不同的子域名：只对白名单中的 Origin 放行跨域请求，并允许携带
  // Access 的 cookie。预检请求在这里直接返回，不经过 Access JWT 校验（预检不带 cookie）。
  const allowed = new Set(opts.allowedOrigins);
  app.use(
    "/v1/*",
    cors({
      origin: (origin) => (allowed.has(origin) ? origin : null),
      credentials: true,
      allowMethods: ["GET", "POST", "PUT", "DELETE"],
      allowHeaders: ["content-type"],
      exposeHeaders: ["content-disposition", "x-next-before"],
      maxAge: 600,
    }),
  );
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
