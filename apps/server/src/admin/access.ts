/**
 * Cloudflare Access JWT 校验：admin 进程的第二道防线。
 *
 * admin.char.pub 与 admin-api.char.pub 前面有 Cloudflare Access，只有通过 GitHub 登录、
 * 并且是 char-pub 组织成员的员工才能进来。Access 会在每个请求上附带
 * `Cf-Access-Jwt-Assertion`。admin 进程不信任“请求来自 Cloudflare”这一点本身，
 * 而是逐个请求校验这个 JWT：签名（Access 团队域名下的 JWKS）、`aud`（这个 Access
 * 应用的 AUD tag）、`iss`（团队域名）、有效期，以及 email 是否在员工允许名单里。
 */
import { CharError } from "@char-pub/core";
import { errors, type JWTVerifyGetKey, jwtVerify } from "jose";

export interface AccessConfig {
  /** 例如 `https://char-pub.cloudflareaccess.com`。 */
  teamDomain: string;
  /** Access 应用的 AUD tag。 */
  audience: string;
  /** 允许进入 admin 的员工邮箱（小写）。 */
  allowedEmails: ReadonlySet<string>;
  /** JWKS：生产环境为 `${teamDomain}/cdn-cgi/access/certs`。 */
  jwks: JWTVerifyGetKey;
  now?: () => Date;
}

export interface AccessIdentity {
  email: string;
  /** Access 中的用户 ID。 */
  sub: string;
}

export const ACCESS_HEADER = "cf-access-jwt-assertion";

export async function verifyAccessJwt(
  token: string | undefined,
  cfg: AccessConfig,
): Promise<AccessIdentity> {
  if (!token) throw new CharError({ code: "access.missing", subject: ACCESS_HEADER });
  const issuer = cfg.teamDomain.replace(/\/+$/, "");
  let payload: Record<string, unknown>;
  try {
    const res = await jwtVerify(token, cfg.jwks, {
      algorithms: ["RS256"],
      issuer,
      audience: cfg.audience,
      clockTolerance: 60,
      ...(cfg.now ? { currentDate: cfg.now() } : {}),
    });
    payload = res.payload as Record<string, unknown>;
  } catch (e) {
    const code =
      e instanceof errors.JWTExpired
        ? "access.expired"
        : e instanceof errors.JWTClaimValidationFailed
          ? "access.claim_invalid"
          : "access.invalid";
    throw new CharError({ code, subject: ACCESS_HEADER });
  }
  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  if (!email || !sub) throw new CharError({ code: "access.claim_invalid", subject: "email" });
  if (!cfg.allowedEmails.has(email)) {
    throw new CharError({ code: "access.not_staff", subject: email });
  }
  return { email, sub };
}
