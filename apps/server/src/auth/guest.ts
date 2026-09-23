/**
 * 经验证访客的身份：邮箱验证 token、访客会话与 principal 解析。
 *
 * - 访客通过 Turnstile + 邮箱验证获得 `guest_id`，只能在作者允许“所有人”贡献时提交。
 * - 不保存明文邮箱。规范化后的邮箱经 HMAC 得到 `email_hmac`，同一邮箱再次验证时据此找回
 *   同一个访客；限流 key 里的邮箱与 IP 也用同一把密钥做 HMAC（加上不同的前缀区分用途）。
 *   用 HMAC 而不是普通哈希：邮箱的取值空间小，普通哈希可以被逐个枚举还原。
 * - 验证 token 与会话 token 都是 256 位随机数，数据库只存 sha256。会话固定 30 天过期，
 *   不自动续期；访客被停用后会话立即不可用。
 * - cookie 为 `__Host-charpub.guest`：Secure、HttpOnly、SameSite=Lax、Path=/、不设 Domain，
 *   与创作者登录的 session cookie 属性一致。
 */
import { createHmac, randomBytes } from "node:crypto";
import { sha256Hex } from "@char-pub/core";
import { and, eq, gt } from "drizzle-orm";
import { TypeID } from "typeid-js";
import type { Principal } from "../authz/authorize.js";
import type { Executor } from "../db/client.js";
import { guestSessions, guests } from "../db/schema/index.js";
import type { EmailSender } from "./email.js";
import type { TurnstileVerifier } from "./turnstile.js";

export const GUEST_COOKIE = "__Host-charpub.guest";
export const GUEST_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const GUEST_VERIFICATION_TTL_SECONDS = 30 * 60;
/** 前端渲染 Turnstile widget 时使用的 action。 */
export const GUEST_TURNSTILE_ACTION = "guest_verification";

/** 验证 token 与会话 token：32 字节随机数的 base64url，43 个字符。 */
export const GUEST_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function randomGuestToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashGuestToken(token: string): string {
  return sha256Hex(token);
}

/** 访客 ID，形如 `gst_01h…`。 */
export function newGuestId(uuid: string): string {
  return TypeID.fromUUID("gst", uuid).toString();
}

/** 邮箱规范化：去掉首尾空白并转小写。 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** 用独立密钥对邮箱与 IP 做 HMAC。密钥至少 32 字节。 */
export class GuestHasher {
  constructor(private readonly key: Uint8Array) {
    if (key.length < 32) throw new Error("guest hmac key must be at least 32 bytes");
  }

  private mac(purpose: string, value: string): string {
    return createHmac("sha256", this.key).update(`${purpose}:${value}`).digest("hex");
  }

  email(email: string): string {
    return this.mac("email", normalizeEmail(email));
  }

  ip(ip: string): string {
    return this.mac("ip", ip);
  }
}

/** 访客验证需要的外部依赖。没有配置时访客验证接口返回 503。 */
export interface GuestServices {
  turnstile: TurnstileVerifier;
  email: EmailSender;
  hasher: GuestHasher;
}

/**
 * 从访客会话 token 得到 principal。token 无效、会话过期或访客没有完成验证时返回 null；
 * 访客被停用时返回 `disabled: true` 的 principal，由授权统一拒绝。
 */
export async function guestPrincipalFromSession(
  db: Executor,
  token: string,
  now: Date,
): Promise<Principal | null> {
  if (!GUEST_TOKEN_RE.test(token)) return null;
  const [row] = await db
    .select({
      guestId: guests.guestId,
      verifiedAt: guests.verifiedAt,
      disabledAt: guests.disabledAt,
    })
    .from(guestSessions)
    .innerJoin(guests, eq(guests.guestId, guestSessions.guestId))
    .where(
      and(eq(guestSessions.tokenHash, hashGuestToken(token)), gt(guestSessions.expiresAt, now)),
    )
    .limit(1);
  if (!row?.verifiedAt) return null;
  return { kind: "guest", guest_id: row.guestId, disabled: row.disabledAt !== null };
}

/** 为访客建立一个新会话，返回 cookie 中的明文 token。 */
export async function createGuestSession(
  db: Executor,
  input: { id: string; guestId: string; now: Date },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomGuestToken();
  const expiresAt = new Date(input.now.getTime() + GUEST_SESSION_TTL_SECONDS * 1000);
  await db.insert(guestSessions).values({
    id: input.id,
    guestId: input.guestId,
    tokenHash: hashGuestToken(token),
    expiresAt,
    createdAt: input.now,
  });
  return { token, expiresAt };
}

/** 删除 token 对应的会话；token 无效时什么也不做。 */
export async function deleteGuestSession(db: Executor, token: string): Promise<void> {
  if (!GUEST_TOKEN_RE.test(token)) return;
  await db.delete(guestSessions).where(eq(guestSessions.tokenHash, hashGuestToken(token)));
}
