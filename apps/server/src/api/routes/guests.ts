/**
 * 经验证访客：邮箱验证与访客会话。
 *
 * 流程：前端通过 Turnstile 后提交邮箱与显示名 → 服务端发出一封带一次性链接的邮件 →
 * 访客打开链接，前端把链接 fragment 里的 token 提交上来 → 服务端创建（或找回）访客并下发
 * 访客会话 cookie。之后访客就可以向允许“所有人”贡献的作品提交 Contribution。
 *
 * - 申请验证的响应与邮箱是否验证过无关，一律 202，不能用来探测某个邮箱是否用过。
 * - 限流：先按 IP（在调用 Turnstile 之前，挡住刷接口的请求），通过 Turnstile 后再按邮箱
 *   （防止用我们的发信域名反复骚扰同一个邮箱）。
 * - 验证邮件在请求内同步发送，不进任务队列：队列里的任务数据会落库，而明文 token 只应该
 *   出现在邮件里。
 * - 验证链接指向发起请求的前端 Origin（已经过白名单校验），staging 与 production 各自正确。
 * - admin 的 `guest_access` 开关关闭时，申请与确认都返回 503；访客提交 Contribution 也会被拒绝。
 */
import {
  GuestConfirmRequestSchema,
  type GuestSessionResponseSchema,
  GuestVerificationRequestSchema,
  type GuestVerificationResponseSchema,
} from "@char-pub/contracts";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { z } from "zod";
import { appendAudit } from "../../audit/audit.js";
import { guestVerificationEmail } from "../../auth/email.js";
import {
  createGuestSession,
  deleteGuestSession,
  GUEST_COOKIE,
  GUEST_SESSION_TTL_SECONDS,
  GUEST_TOKEN_RE,
  GUEST_VERIFICATION_TTL_SECONDS,
  type GuestServices,
  hashGuestToken,
  newGuestId,
  randomGuestToken,
} from "../../auth/guest.js";
import type { Executor } from "../../db/client.js";
import { guestSessions, guests, guestVerifications } from "../../db/schema/index.js";
import { problem } from "../../http/middleware.js";
import { hit, RATE_LIMITS, type RateLimitRule } from "../../ops/rate-limit.js";
import { clientIp, requestIdOf } from "../../registry/context.js";
import type { AppContext, Env } from "../app.js";
import { route } from "../app.js";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
  path: "/",
} as const;

const SYSTEM = { type: "system" } as const;

function notConfigured(c: AppContext): Response {
  return problem(c, 503, "guest.not_configured", "guest verification is not available");
}

async function limit(c: AppContext, key: string, rule: RateLimitRule): Promise<Response | null> {
  const r = await hit(c.var.services.db, key, rule, c.var.services.clock.now());
  if (r.allowed) return null;
  const res = problem(c, 429, "rate_limited", "too many requests, try again later");
  res.headers.set("retry-after", String(r.retryAfterSeconds));
  return res;
}

function guestJson(g: { guestId: string; displayName: string; verifiedAt: Date | null }) {
  return {
    id: g.guestId,
    display_name: g.displayName,
    verified_at: (g.verifiedAt ?? new Date(0)).toISOString(),
  };
}

type ConfirmResult =
  | { kind: "invalid" }
  | { kind: "disabled" }
  | {
      kind: "ok";
      guest: typeof guests.$inferSelect;
      session: { token: string; expiresAt: Date };
    };

/** 找回或创建邮箱对应的访客。被停用的访客不会被重新启用。 */
async function upsertGuest(
  tx: Executor,
  input: { id: string; emailHmac: string; displayName: string; now: Date },
): Promise<{ guest: typeof guests.$inferSelect; created: boolean } | null> {
  const byEmail = () =>
    tx.select().from(guests).where(eq(guests.emailHmac, input.emailHmac)).limit(1).for("update");
  const [existing] = await byEmail();
  if (existing) {
    if (existing.disabledAt) return null;
    const [updated] = await tx
      .update(guests)
      .set({ displayName: input.displayName, verifiedAt: input.now, verificationKind: "email" })
      .where(eq(guests.guestId, existing.guestId))
      .returning();
    return updated ? { guest: updated, created: false } : null;
  }
  const [inserted] = await tx
    .insert(guests)
    .values({
      guestId: input.id,
      displayName: input.displayName,
      emailHmac: input.emailHmac,
      verifiedAt: input.now,
      verificationKind: "email",
      createdAt: input.now,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) return { guest: inserted, created: true };
  // 同一邮箱的另一个确认请求刚刚创建了访客：沿用它。
  const [raced] = await byEmail();
  return raced && !raced.disabledAt ? { guest: raced, created: false } : null;
}

export function register(app: Hono<Env>): void {
  // ------------------------------------------------------------------------
  // 申请验证：Turnstile → 限流 → 发送一次性链接
  // ------------------------------------------------------------------------
  route(app, {
    method: "post",
    path: "/v1/guests/verification",
    body: GuestVerificationRequestSchema,
    authorize: async () => ({ action: "guest.verify", resource: SYSTEM, loaded: null }),
    handler: async (c, { body }) => {
      const g: GuestServices | undefined = c.var.services.guests;
      if (!g) return notConfigured(c);
      const { db, clock, ids } = c.var.services;
      // 链接指向发起请求的前端；浏览器一定会带 Origin，并且中间件已经核对过白名单。
      const origin = c.req.header("origin");
      if (!origin) return problem(c, 403, "origin.missing");
      const ip = clientIp(c);

      const byIp = await limit(
        c,
        `guest-verify:ip:${g.hasher.ip(ip ?? "unknown")}`,
        RATE_LIMITS.guestVerificationPerIp,
      );
      if (byIp) return byIp;
      const check = await g.turnstile.verify(body.turnstile_token, ip);
      if (!check.ok) return problem(c, 403, "turnstile.failed", check.reason);
      const emailHmac = g.hasher.email(body.email);
      const byEmail = await limit(
        c,
        `guest-verify:email:${emailHmac}`,
        RATE_LIMITS.guestVerificationPerEmail,
      );
      if (byEmail) return byEmail;

      const now = clock.now();
      const token = randomGuestToken();
      const id = ids.uuid();
      await db.insert(guestVerifications).values({
        id,
        tokenHash: hashGuestToken(token),
        emailHmac,
        displayName: body.display_name,
        expiresAt: new Date(now.getTime() + GUEST_VERIFICATION_TTL_SECONDS * 1000),
        createdAt: now,
      });
      const link = `${origin}/guest/verify#token=${token}`;
      try {
        await g.email.send(
          guestVerificationEmail(body.email, link, GUEST_VERIFICATION_TTL_SECONDS / 60),
        );
      } catch (e) {
        // 邮件没有发出去，这个 token 也就作废。日志里不写错误详情：SMTP 的错误信息可能带着收件地址。
        await db.delete(guestVerifications).where(eq(guestVerifications.id, id));
        process.stderr.write(
          `guest verification email failed: ${e instanceof Error ? e.name : "error"}\n`,
        );
        return problem(c, 503, "email.unavailable", "could not send the verification email");
      }
      const res: z.input<typeof GuestVerificationResponseSchema> = {
        status: "sent",
        expires_in: GUEST_VERIFICATION_TTL_SECONDS,
      };
      return c.json(res, 202);
    },
  });

  // ------------------------------------------------------------------------
  // 确认：消耗 token → 创建或找回访客 → 下发会话 cookie
  // ------------------------------------------------------------------------
  route(app, {
    method: "post",
    path: "/v1/guests/verification/confirm",
    body: GuestConfirmRequestSchema,
    authorize: async () => ({ action: "guest.verify", resource: SYSTEM, loaded: null }),
    handler: async (c, { body }) => {
      const g = c.var.services.guests;
      if (!g) return notConfigured(c);
      const { db, clock, ids } = c.var.services;
      const limited = await limit(
        c,
        `guest-confirm:ip:${g.hasher.ip(clientIp(c) ?? "unknown")}`,
        RATE_LIMITS.guestConfirmPerIp,
      );
      if (limited) return limited;
      // 无效、过期与已使用的 token 返回同一个错误。
      const invalid = () => problem(c, 400, "guest.token_invalid");
      if (!GUEST_TOKEN_RE.test(body.token)) return invalid();

      const now = clock.now();
      const result: ConfirmResult = await db.transaction(async (tx) => {
        const [v] = await tx
          .update(guestVerifications)
          .set({ consumedAt: now })
          .where(
            and(
              eq(guestVerifications.tokenHash, hashGuestToken(body.token)),
              isNull(guestVerifications.consumedAt),
              gt(guestVerifications.expiresAt, now),
            ),
          )
          .returning();
        if (!v) return { kind: "invalid" };
        const up = await upsertGuest(tx, {
          id: newGuestId(ids.uuid()),
          emailHmac: v.emailHmac,
          displayName: v.displayName,
          now,
        });
        if (!up) return { kind: "disabled" };
        const session = await createGuestSession(tx, {
          id: ids.uuid(),
          guestId: up.guest.guestId,
          now,
        });
        await appendAudit(tx, {
          at: now,
          actor: { kind: "system", id: `guest:${up.guest.guestId}` },
          action: "guest.verified",
          subject: `guest:${up.guest.guestId}`,
          requestId: requestIdOf(c),
          after: { created: up.created },
        });
        return { kind: "ok", guest: up.guest, session };
      });
      if (result.kind === "invalid") return invalid();
      if (result.kind === "disabled") return problem(c, 403, "guest.disabled");

      setCookie(c, GUEST_COOKIE, result.session.token, {
        ...COOKIE_OPTIONS,
        maxAge: GUEST_SESSION_TTL_SECONDS,
        expires: result.session.expiresAt,
      });
      c.header("cache-control", "no-store");
      const res: z.input<typeof GuestSessionResponseSchema> = {
        guest: guestJson(result.guest),
        session_expires_at: result.session.expiresAt.toISOString(),
      };
      return c.json(res, 200);
    },
  });

  // ------------------------------------------------------------------------
  // 当前访客会话
  // ------------------------------------------------------------------------
  route(app, {
    method: "get",
    path: "/v1/guests/me",
    authorize: async () => ({ action: "guest.read_self", resource: SYSTEM, loaded: null }),
    handler: async (c) => {
      const { db, clock } = c.var.services;
      const token = getCookie(c, GUEST_COOKIE) ?? "";
      const [row] = await db
        .select({
          guestId: guests.guestId,
          displayName: guests.displayName,
          verifiedAt: guests.verifiedAt,
          expiresAt: guestSessions.expiresAt,
        })
        .from(guestSessions)
        .innerJoin(guests, eq(guests.guestId, guestSessions.guestId))
        .where(
          and(
            eq(guestSessions.tokenHash, hashGuestToken(token)),
            gt(guestSessions.expiresAt, clock.now()),
          ),
        )
        .limit(1);
      if (!row) return problem(c, 401, "auth.required");
      c.header("cache-control", "private, no-store");
      const res: z.input<typeof GuestSessionResponseSchema> = {
        guest: guestJson(row),
        session_expires_at: row.expiresAt.toISOString(),
      };
      return c.json(res);
    },
  });

  // ------------------------------------------------------------------------
  // 退出：删除会话并清除 cookie。没有会话时同样成功。
  // ------------------------------------------------------------------------
  route(app, {
    method: "delete",
    path: "/v1/guests/session",
    authorize: async () => ({ action: "guest.sign_out", resource: SYSTEM, loaded: null }),
    handler: async (c) => {
      const token = getCookie(c, GUEST_COOKIE);
      if (token) await deleteGuestSession(c.var.services.db, token);
      deleteCookie(c, GUEST_COOKIE, COOKIE_OPTIONS);
      return c.body(null, 204);
    },
  });
}
