/**
 * 公开举报：任何人都可以举报一个作品，或者它的某个版本。
 *
 *   POST /v1/creations/@:ns/:name/reports                  举报作品
 *   POST /v1/creations/@:ns/:name/releases/:label/reports  举报某个版本
 *
 * - 举报人可以是登录用户、经验证访客或匿名。匿名举报必须通过 Turnstile（widget 的 action 是
 *   `report`，访客验证的 token 不能拿来用）；没有配置 Turnstile 时匿名举报返回 503，登录用户
 *   和访客不受影响。
 * - 限流：按账号或访客；另外按 IP，并且放在调用 Turnstile 之前，挡住刷接口的请求。IP 只以
 *   HMAC 的形式出现在限流 key 和匿名举报的记录里。
 * - 看不到的对象（不存在、别人的 private Release、没有公开内容或被隐藏的作品）和不存在一样
 *   返回 404，不能借举报探测私有内容。可见性由 `authorize()` 统一判断，先于其他任何检查。
 * - 成功一律返回 202 `{ status: "received" }`，不透露是否重复举报、会不会处理或处理结果。
 * - 举报写进 admin 的举报队列（`reports` 表），对象记公共 ID：作品是 `cr_…`（可以隐藏、强制
 *   评级），版本是 `rel_…`（可以 yank）。说明是用户内容，admin 按纯文本显示。
 * - 全站只读时返回 503。举报没有单独的 kill switch：它是用户向我们报告问题的渠道，不跟着
 *   关闭贡献、访客等功能一起停掉。
 */
import { CreateReportRequestSchema, type ReportReceivedResponseSchema } from "@char-pub/contracts";
import type { Hono } from "hono";
import type { z } from "zod";
import { appendAudit } from "../../audit/audit.js";
import type { Resource } from "../../authz/authorize.js";
import { reports } from "../../db/schema/index.js";
import { problem } from "../../http/middleware.js";
import { hit, RATE_LIMITS, type RateLimitRule } from "../../ops/rate-limit.js";
import { auditActor, clientIp, param, requestIdOf } from "../../registry/context.js";
import { type FoundCreation, findCreation, findRelease, toPublicId } from "../../registry/read.js";
import { type AppContext, type Env, notFound, route } from "../app.js";
import { CREATION_PATH } from "./read.js";

type CreateReportRequest = z.output<typeof CreateReportRequestSchema>;

/** 被举报的对象：类型与公共 ID。 */
interface Subject {
  type: "creation" | "release";
  id: string;
}

/** 按 `@ns/name` 找作品；namespace 或作品改过名时旧地址同样可以举报。 */
async function loadCreation(c: AppContext): Promise<FoundCreation | null> {
  const { db } = c.var.services;
  const p = c.var.principal;
  let found = await findCreation(db, param(c, "ns").slice(1), param(c, "name"), p);
  if (found.kind === "redirect") found = await findCreation(db, found.ns, found.name, p);
  return found.kind === "found" ? found.value : null;
}

function creationResource(f: FoundCreation): Resource {
  return {
    type: "creation",
    id: f.creation.id,
    ns: f.ns,
    has_public_release: f.hasPublicRelease,
    status: f.creation.status,
    contribution_policy: f.creation.contributionPolicy,
  };
}

async function limited(c: AppContext, key: string, rule: RateLimitRule): Promise<Response | null> {
  const r = await hit(c.var.services.db, key, rule, c.var.services.clock.now());
  if (r.allowed) return null;
  const res = problem(c, 429, "rate_limited", "too many reports, try again later");
  res.headers.set("retry-after", String(r.retryAfterSeconds));
  return res;
}

/** 校验举报人、限流，然后把举报写进队列。 */
async function receive(c: AppContext, body: CreateReportRequest, subject: Subject) {
  const { db, clock, ids } = c.var.services;
  const svc = c.var.services.reports;
  const p = c.var.principal;
  const ip = clientIp(c);

  if (p.kind === "anonymous") {
    if (!svc) {
      return problem(c, 503, "report.anonymous_unavailable", "sign in to send a report");
    }
    if (!body.turnstile_token) {
      return problem(c, 403, "turnstile.required", "anonymous reports need a Turnstile token");
    }
  }
  const ipHash = svc ? svc.hasher.ip(ip ?? "unknown") : null;
  if (ipHash) {
    const byIp = await limited(c, `report:ip:${ipHash}`, RATE_LIMITS.reportPerIp);
    if (byIp) return byIp;
  }

  let reporter: Record<string, string>;
  if (p.kind === "user") {
    const byUser = await limited(c, `report:user:${p.user_id}`, RATE_LIMITS.reportPerAccount);
    if (byUser) return byUser;
    reporter = { user: p.user_id };
  } else if (p.kind === "guest") {
    const byGuest = await limited(c, `report:guest:${p.guest_id}`, RATE_LIMITS.reportPerGuest);
    if (byGuest) return byGuest;
    reporter = { guest: p.guest_id };
  } else if (p.kind === "anonymous" && svc && ipHash && body.turnstile_token) {
    const check = await svc.turnstile.verify(body.turnstile_token, ip);
    if (!check.ok) return problem(c, 403, "turnstile.failed", check.reason);
    reporter = { anon: ipHash };
  } else {
    // 授权已经拒绝了其他身份（OIDC 发布凭证）；这里只是让类型完整。
    return problem(c, 403, "forbidden");
  }

  const now = clock.now();
  const id = ids.uuid();
  await db.transaction(async (tx) => {
    await tx.insert(reports).values({
      id,
      reporter,
      subjectType: subject.type,
      subjectId: subject.id,
      category: body.category,
      details: body.details ? body.details : null,
      status: "open",
      createdAt: now,
      updatedAt: now,
    });
    // 审计只记录举报了什么，不记录说明正文。
    await appendAudit(tx, {
      at: now,
      actor: auditActor(p),
      action: "report.create",
      subject: `report:${id}`,
      requestId: requestIdOf(c),
      after: { subject_type: subject.type, subject_id: subject.id, category: body.category },
    });
  });
  c.header("cache-control", "no-store");
  const res: z.input<typeof ReportReceivedResponseSchema> = { status: "received" };
  return c.json(res, 202);
}

export function register(app: Hono<Env>): void {
  route(app, {
    method: "post",
    path: `${CREATION_PATH}/reports`,
    body: CreateReportRequestSchema,
    authorize: async (c) => {
      const f = await loadCreation(c);
      if (!f) return notFound(c);
      return { action: "report.create", resource: creationResource(f), loaded: f };
    },
    handler: (c, { body, loaded: f }) =>
      receive(c, body, { type: "creation", id: toPublicId("creation", f.creation.id) }),
  });

  route(app, {
    method: "post",
    path: `${CREATION_PATH}/releases/:label/reports`,
    body: CreateReportRequestSchema,
    authorize: async (c) => {
      const f = await loadCreation(c);
      if (!f) return notFound(c);
      const r = await findRelease(c.var.services.db, f.creation.id, param(c, "label"));
      if (!r) return notFound(c);
      return {
        action: "report.create",
        resource: {
          type: "release",
          id: r.id,
          creation_id: f.creation.id,
          ns: f.ns,
          visibility: r.visibility,
          status: r.status,
          creation_status: f.creation.status,
        },
        loaded: r,
      };
    },
    handler: (c, { body, loaded: r }) =>
      receive(c, body, { type: "release", id: toPublicId("release", r.id) }),
  });
}
