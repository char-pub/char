/**
 * 组装公开 API（`api` 进程）。admin 路由不在这里挂载：它们只存在于单独的 admin 进程。
 *
 * 中间件顺序：请求 ID → 源站校验 → 安全响应头 → Origin 校验 → 请求体上限 →
 * principal 解析 → 路由。每个路由模块导出一个 `register(app)` 函数，并通过 `route()`
 * 注册路由，保证都经过授权。
 */
import { Hono } from "hono";
import { principalFromToken } from "../auth/tokens.js";
import type { Principal } from "../authz/authorize.js";
import {
  apiSecurityHeaders,
  errorHandler,
  jsonBodyLimit,
  originAuth,
  originCheck,
  problem,
  requestId,
} from "../http/middleware.js";
import type { Env, Services } from "./app.js";

export interface ApiOptions {
  services: Services;
  /** Cloudflare 回源时附带的 secret；轮换期间可以同时有两个。为空时不校验（仅限本地开发）。 */
  originSecrets: readonly string[];
  /** 允许发起写请求的前端 Origin。 */
  allowedOrigins: readonly string[];
  /** 从 session cookie 解析登录用户；由 Better Auth 集成提供。 */
  sessionPrincipal?: (req: Request) => Promise<Principal | null>;
  /** 路由模块。 */
  modules: readonly ((app: Hono<Env>) => void)[];
}

export function createApi(opts: ApiOptions): Hono<Env> {
  const app = new Hono<Env>();
  app.use(requestId(() => opts.services.ids.uuid()));
  if (opts.originSecrets.length > 0) app.use(originAuth({ secrets: opts.originSecrets }));
  app.use(apiSecurityHeaders());
  app.use(originCheck({ allowed: opts.allowedOrigins }));
  app.use(jsonBodyLimit());
  app.use(async (c, next) => {
    c.set("services", opts.services);
    const auth = c.req.header("authorization");
    let principal: Principal | null = null;
    if (auth?.startsWith("Bearer cp_pat_")) {
      principal = await principalFromToken(
        opts.services.db,
        auth.slice("Bearer ".length),
        opts.services.clock.now(),
      );
      // 带了 Token 却无效：明确返回 401，而不是当成匿名访问。
      if (!principal) return problem(c, 401, "auth.invalid_token");
    } else if (opts.sessionPrincipal) {
      principal = await opts.sessionPrincipal(c.req.raw);
    }
    c.set("principal", principal ?? { kind: "anonymous" });
    await next();
  });

  app.get("/healthz", (c) => c.json({ ok: true }));
  for (const register of opts.modules) register(app);
  app.notFound((c) => problem(c, 404, "not_found"));
  app.onError(errorHandler);
  return app;
}
