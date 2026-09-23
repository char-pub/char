/**
 * 公开 API 的应用骨架：依赖注入、principal 解析与“必须经过授权”的路由构建器。
 *
 * 路由不直接用 `app.get(...)` 注册，而是通过 `route()`：它要求每个路由声明一个
 * `authorize` 回调，框架先调用它得到授权结论，拒绝时直接返回 problem 响应，
 * 允许时才进入 handler。资源不存在时 `authorize` 可以直接返回 404 响应。
 * 这样“忘记检查权限”在类型层面就写不出来；另有一条测试扫描源码，禁止在路由模块里
 * 绕过 `route()` 直接注册。
 */
import type { Context, Hono } from "hono";
import type { z } from "zod";
import type { GuestServices } from "../auth/guest.js";
import {
  type Action,
  type AuthzContext,
  authorize,
  type Decision,
  type Principal,
  type Resource,
} from "../authz/authorize.js";
import type { Db } from "../db/client.js";
import { problem } from "../http/middleware.js";
import type { JobQueue } from "../jobs/queue.js";
import type { ReportServices } from "../moderation/reports.js";
import type { Cas } from "../storage/cas.js";

export interface Clock {
  now(): Date;
}

export interface Ids {
  /** 生成 UUIDv7。 */
  uuid(): string;
}

export interface Services {
  db: Db;
  cas: Cas;
  queue: JobQueue;
  clock: Clock;
  ids: Ids;
  /** 当前关闭的 kill switch。由 feature flag 缓存提供。 */
  flags(): Promise<AuthzContext["disabled"]>;
  /** public 资源的 URL 前缀，例如 `https://assets.char.pub/cas/sha256`。 */
  publicAssetBaseUrl: string;
  /** 访客验证（Turnstile 与发信）。没有配置时访客验证接口返回 503。 */
  guests?: GuestServices;
  /**
   * 匿名举报的 Turnstile 与 IP 哈希。没有配置时匿名举报返回 503，登录用户与访客照常可以
   * 举报（只是不按 IP 限流）。
   */
  reports?: ReportServices;
  /** Encrypts private deletion requests for the existing legal queue. */
  legalKey?: Uint8Array;
}

export type Env = {
  Variables: {
    services: Services;
    principal: Principal;
    requestId: string;
  };
};

export type AppContext = Context<Env>;

type Method = "get" | "post" | "put" | "patch" | "delete";

export interface RouteSpec<B extends z.ZodType | undefined, R> {
  method: Method;
  path: string;
  /** 请求体 schema；GET / DELETE 不需要。 */
  body?: B;
  /**
   * 加载资源并决定授权。返回 `{ action, resource }` 时由 `authorize()` 判断；
   * 返回 `{ public: true }` 表示这个路由不涉及任何受保护资源（例如健康检查、公开搜索）。
   */
  authorize: (
    c: AppContext,
  ) => Promise<
    { action: Action; resource: Resource; loaded: R } | { public: true; loaded: R } | Response
  >;
  handler: (
    c: AppContext,
    input: { body: B extends z.ZodType ? z.output<B> : undefined; loaded: R },
  ) => Promise<Response>;
}

function deniedResponse(c: AppContext, d: Exclude<Decision, { allow: true }>): Response {
  return problem(c, d.status, d.code);
}

/** 注册一个经过授权的路由。 */
export function route<B extends z.ZodType | undefined, R>(
  app: Hono<Env>,
  spec: RouteSpec<B, R>,
): void {
  // biome-ignore lint/plugin: 这里就是 route() 本身：先执行 spec.authorize，通过后才调用处理函数。
  app[spec.method](spec.path, async (c) => {
    const auth = await spec.authorize(c);
    if (auth instanceof Response) return auth;
    if (!("public" in auth)) {
      const disabled = await c.var.services.flags();
      const d = authorize(c.var.principal, auth.action, auth.resource, { disabled });
      if (!d.allow) return deniedResponse(c, d);
    }
    let body: unknown;
    if (spec.body) {
      const raw = await c.req.json().catch(() => undefined);
      const parsed = spec.body.safeParse(raw);
      if (!parsed.success) {
        return problem(c, 422, "request.invalid", parsed.error.issues[0]?.message, {
          issues: parsed.error.issues
            .slice(0, 10)
            .map((i) => ({ path: i.path.map(String), message: i.message })),
        });
      }
      body = parsed.data;
    }
    return spec.handler(c, {
      body: body as B extends z.ZodType ? z.output<B> : undefined,
      loaded: auth.loaded,
    });
  });
}

/** 资源不存在时的标准响应。对私有资源，"不存在"与"无权查看"返回同一个 404。 */
export function notFound(c: AppContext): Response {
  return problem(c, 404, "not_found");
}
