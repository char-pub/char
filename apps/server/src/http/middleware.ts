/**
 * HTTP 层的通用中间件：源站校验、安全响应头、请求体上限、Origin 白名单、请求 ID，
 * 以及统一的 problem+json 错误格式。api 与 admin 两个进程共用。
 */
import { timingSafeEqual } from "node:crypto";
import { isCharError } from "@char-pub/core";
import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";

export interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  instance?: string;
  [extra: string]: unknown;
}

export const PROBLEM_CONTENT_TYPE = "application/problem+json";

/** 生成一个 RFC 9457 problem 响应。`code` 是给程序判断用的稳定错误码。 */
export function problem(
  c: Context,
  status: number,
  code: string,
  detail?: string,
  extra: Record<string, unknown> = {},
): Response {
  const body: Problem = {
    type: `https://char.pub/problems/${code}`,
    title: code,
    status,
    code,
    ...(detail ? { detail } : {}),
    ...extra,
  };
  const requestId = c.get("requestId" as never) as string | undefined;
  if (requestId) body.instance = `urn:request:${requestId}`;
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": PROBLEM_CONTENT_TYPE },
  });
}

/** 常量时间比较两个字符串，长度不同也不会提前返回。 */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  const len = Math.max(ab.length, bb.length, 1);
  const pa = Buffer.alloc(len);
  const pb = Buffer.alloc(len);
  ab.copy(pa);
  bb.copy(pb);
  return timingSafeEqual(pa, pb) && ab.length === bb.length;
}

/**
 * 源站校验：Cloudflare 在回源请求上加 `X-Origin-Auth`，不带或不匹配的请求一律拒绝，
 * 这样绕过 Cloudflare 直接访问 Railway 域名的请求进不来。轮换 secret 时新旧两个值同时有效。
 * 健康检查路径不校验，Railway 的探针不经过 Cloudflare。
 */
export function originAuth(opts: {
  secrets: readonly string[];
  exempt?: readonly string[];
}): MiddlewareHandler {
  const exempt = new Set(opts.exempt ?? ["/healthz", "/readyz"]);
  const secrets = opts.secrets.filter((s) => s.length > 0);
  return async (c, next) => {
    if (exempt.has(c.req.path)) return next();
    const got = c.req.header("x-origin-auth") ?? "";
    // 每个候选值都比较一遍，耗时与哪个值匹配无关。
    let ok = false;
    for (const s of secrets) ok = safeEqual(got, s) || ok;
    if (!ok) return problem(c, 403, "origin.forbidden");
    return next();
  };
}

/**
 * 写请求必须带白名单里的 Origin。浏览器会自动带上 Origin，不能伪造；
 * CLI 等非浏览器客户端不带 cookie，用 Bearer Token 认证，所以没有 Origin 时只允许
 * 带 Authorization 头的请求通过。
 */
export function originCheck(opts: { allowed: readonly string[] }): MiddlewareHandler {
  const allowed = new Set(opts.allowed);
  const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
  return async (c, next) => {
    if (SAFE.has(c.req.method)) return next();
    const origin = c.req.header("origin");
    if (origin === undefined) {
      if (c.req.header("authorization")?.startsWith("Bearer ")) return next();
      if (c.req.header("cookie") === undefined) return next();
      return problem(c, 403, "origin.missing");
    }
    if (!allowed.has(origin)) return problem(c, 403, "origin.not_allowed");
    return next();
  };
}

/** 安全响应头。API 只返回 JSON，CSP 设为最严格。 */
export function apiSecurityHeaders(): MiddlewareHandler {
  return secureHeaders({
    strictTransportSecurity: "max-age=63072000; includeSubDomains; preload",
    xContentTypeOptions: "nosniff",
    xFrameOptions: "DENY",
    referrerPolicy: "strict-origin-when-cross-origin",
    crossOriginResourcePolicy: "same-site",
    crossOriginOpenerPolicy: "same-origin",
    contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
  });
}

/** 请求体上限：默认 1 MiB，草稿接口 5 MiB。文件上传不经过 API。 */
export function jsonBodyLimit(maxBytes = 1024 * 1024): MiddlewareHandler {
  return bodyLimit({
    maxSize: maxBytes,
    onError: (c) => problem(c, 413, "request.too_large", `body exceeds ${maxBytes} bytes`),
  });
}

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * 每个请求都有 `X-Request-Id`，贯穿日志、审计与任务。接受上游传来的合法值
 * （Cloudflare 的 cf-ray 或调用方自己的 ID），否则生成一个。
 */
export function requestId(generate: () => string): MiddlewareHandler {
  return async (c, next) => {
    const incoming = c.req.header("x-request-id");
    const id = incoming && REQUEST_ID_RE.test(incoming) ? incoming : generate();
    c.set("requestId" as never, id as never);
    c.header("x-request-id", id);
    await next();
  };
}

/** 把 core 的 CharError、zod 错误和 Hono 的异常统一转成 problem+json。 */
export function errorHandler(err: Error, c: Context): Response {
  if (isCharError(err)) {
    const status = statusForCode(err.code);
    return problem(c, status, err.code, err.detail, {
      subject: err.subject,
      ...(err.data ? { data: err.data } : {}),
    });
  }
  if (err instanceof HTTPException) {
    return problem(c, err.status, `http.${err.status}`, err.message);
  }
  // 未知错误不把内部信息返回给客户端。
  return problem(c, 500, "internal", "unexpected error");
}

/** 按错误码的前缀决定 HTTP 状态码。 */
export function statusForCode(code: string): number {
  if (code === "not_found" || code.endsWith(".not_found")) return 404;
  if (code === "release.tombstoned" || code === "resolve.tombstoned") return 410;
  if (code.startsWith("feature.")) return 503;
  if (
    code === "publish.label_taken" ||
    code.endsWith(".conflict") ||
    code === "draft.version_conflict"
  ) {
    return 409;
  }
  if (code.startsWith("auth.")) return 401;
  if (
    code.startsWith("schema.") ||
    code.startsWith("canonical.") ||
    code.startsWith("check.") ||
    code.startsWith("publish.") ||
    code.startsWith("resolve.") ||
    code.startsWith("contribution.") ||
    code.startsWith("template.") ||
    code.startsWith("license.") ||
    code.startsWith("request.")
  ) {
    return 422;
  }
  return 400;
}
