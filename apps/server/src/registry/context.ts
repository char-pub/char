/**
 * 路由共用的小工具：审计主体、请求上下文、统一的 JSON 响应。
 */
import { CharError } from "@char-pub/core";
import type { AppContext } from "../api/app.js";
import type { AuditActor } from "../audit/audit.js";
import type { Principal } from "../authz/authorize.js";

/** 把 principal 转成审计日志里的操作者。匿名请求不会走到写操作。 */
export function auditActor(p: Principal): AuditActor {
  switch (p.kind) {
    case "user":
      return { kind: "user", id: p.user_id };
    case "oidc":
      return { kind: "oidc", id: p.binding_id };
    case "guest":
      return { kind: "system", id: `guest:${p.guest_id}` };
    case "anonymous":
      return { kind: "system", id: "anonymous" };
  }
}

export function userIdOf(p: Principal): string {
  if (p.kind !== "user") throw new CharError({ code: "auth.required", subject: "principal" });
  return p.user_id;
}

export function requestIdOf(c: AppContext): string | null {
  return (c.get("requestId") as string | undefined) ?? null;
}

/** 读取路由声明过的路径参数。路由匹配成功时它一定存在。 */
export function param(c: AppContext, name: string): string {
  return c.req.param(name) ?? "";
}
