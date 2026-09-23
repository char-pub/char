/**
 * 组装公开 API（`api` 进程）。admin 路由不在这里挂载：它们只存在于单独的 admin 进程。
 *
 * 中间件顺序：请求 ID → 源站校验 → 安全响应头 → CORS → Origin 校验 → 请求体上限 →
 * principal 解析 → 路由。principal 的来源依次是：个人 Token、创作者的登录会话、访客会话；
 * 登录用户优先，同时带着访客 cookie 时按登录用户处理。每个路由模块导出一个 `register(app)` 函数，并通过 `route()`
 * 注册路由，保证都经过授权。
 */
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { cors } from "hono/cors";
import { GUEST_COOKIE, guestPrincipalFromSession } from "../auth/guest.js";
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
import { DRAFT_PATH_RE, MAX_DRAFT_BYTES } from "./routes/drafts.js";
import { MAX_WEBHOOK_REQUEST_BYTES, WEBHOOK_PATH } from "./routes/github-webhook.js";

export interface ApiOptions {
  services: Services;
  /** Cloudflare 回源时附带的 secret；轮换期间可以同时有两个。为空时不校验（仅限本地开发）。 */
  originSecrets: readonly string[];
  /** 允许发起写请求的前端 Origin。 */
  allowedOrigins: readonly string[];
  /** 从 session cookie 解析登录用户；由 Better Auth 集成提供。 */
  sessionPrincipal?: (req: Request) => Promise<Principal | null>;
  /** Better Auth 的请求处理函数，挂在 `/v1/auth/*`（登录、回调、登出）。 */
  authHandler?: (req: Request) => Promise<Response>;
  /** 路由模块。 */
  modules: readonly ((app: Hono<Env>) => void)[];
}

export function createApi(opts: ApiOptions): Hono<Env> {
  const app = new Hono<Env>();
  app.use(requestId(() => opts.services.ids.uuid()));
  if (opts.originSecrets.length > 0) app.use(originAuth({ secrets: opts.originSecrets }));
  app.use(apiSecurityHeaders());
  // 前端（www）与 API 在不同的子域名，浏览器的跨域请求需要 CORS：只对白名单中的 Origin
  // 放行，并允许携带 session cookie。
  const allowed = new Set(opts.allowedOrigins);
  app.use(
    "/v1/*",
    cors({
      origin: (origin) => (allowed.has(origin) ? origin : null),
      credentials: true,
      allowMethods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
      allowHeaders: ["content-type", "if-match", "idempotency-key"],
      exposeHeaders: ["etag", "retry-after"],
      maxAge: 600,
    }),
  );
  app.use(originCheck({ allowed: opts.allowedOrigins }));
  // 草稿保存的请求体可以更大（上限 5 MiB），GitHub webhook 的投递最大 25 MiB，其他请求 1 MiB。
  const normalLimit = jsonBodyLimit();
  const draftLimit = jsonBodyLimit(MAX_DRAFT_BYTES);
  const webhookLimit = jsonBodyLimit(MAX_WEBHOOK_REQUEST_BYTES);
  app.use((c, next) =>
    (c.req.path === WEBHOOK_PATH
      ? webhookLimit
      : DRAFT_PATH_RE.test(c.req.path)
        ? draftLimit
        : normalLimit)(c, next),
  );
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
    if (!principal) {
      const guestToken = getCookie(c, GUEST_COOKIE);
      if (guestToken) {
        principal = await guestPrincipalFromSession(
          opts.services.db,
          guestToken,
          opts.services.clock.now(),
        );
      }
    }
    c.set("principal", principal ?? { kind: "anonymous" });
    await next();
  });

  app.get("/healthz", (c) => c.json({ ok: true }));
  // 登录接口由 Better Auth 自己处理授权（它们本身就是建立身份的地方），所以不经过 route()。
  const authHandler = opts.authHandler;
  if (authHandler) app.on(["GET", "POST"], "/v1/auth/*", (c) => authHandler(c.req.raw));
  for (const register of opts.modules) register(app);
  app.notFound((c) => problem(c, 404, "not_found"));
  app.onError(errorHandler);
  return app;
}
