/**
 * 创作者登录：Better Auth 的配置。
 *
 * - 只支持第三方登录（GitHub / Discord / Google），不提供密码登录。Magic link 只用于
 *   已有账号登录，不能用来注册新账号。
 * - 内部 user.id 是我们生成的 UUIDv7；外部身份记录在 `auth_account` 中，更换或增加
 *   登录方式不会改变 user.id。
 * - 会话存在数据库里，不启用 cookie 缓存：封禁或吊销后，下一个请求立即失效。
 * - session cookie 名为 `__Host-charpub.session`：Secure、HttpOnly、SameSite=Lax、
 *   Path=/、不设 Domain，因此只发往 API 自己的域名，staging 与 production 互不可见。
 * - 所有写请求都要求 Origin 在白名单中（Better Auth 自身的检查，外加 API 的中间件）。
 * - 登录接口的限流计数存在数据库中，多个 api 实例共享。
 * - 不启用 2FA / passkey：员工后台的多因素认证由 Cloudflare Access 负责，创作者账号不强制。
 * - 不启用 Better Auth 的 admin 插件：它会在公开 API 上挂出冒充用户、改角色、删用户等
 *   接口。封禁由 `banUser` 在服务端完成，员工操作只存在于单独的 admin 进程。
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { magicLink } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import type { Principal } from "../authz/authorize.js";
import type { Db } from "../db/client.js";
import * as schema from "../db/schema/index.js";

/** API 的路由前缀，Better Auth 的所有接口都挂在它下面。 */
export const AUTH_BASE_PATH = "/v1/auth";

/** 所有认证 cookie 的前缀；session cookie 的完整名字是 `__Host-charpub.session`。 */
const COOKIE_PREFIX = "__Host-charpub";
export const SESSION_COOKIE = `${COOKIE_PREFIX}.session`;

/** 会话 30 天过期；每天第一次使用时续期。 */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

export interface AuthProviders {
  github?: OAuthClient | undefined;
  discord?: OAuthClient | undefined;
  google?: OAuthClient | undefined;
}

export type MagicLinkSender = (input: { email: string; url: string }) => Promise<void>;

export interface CreateAuthOptions {
  db: Db;
  /** 签名 cookie 与加密 OAuth state 的密钥，至少 32 个字符。 */
  secret: string;
  /** API 的外部地址，例如 `https://api.char.pub`。OAuth 回调地址由它推导。 */
  baseURL: string;
  /** 允许发起登录与写请求的前端 Origin，精确匹配。 */
  trustedOrigins: readonly string[];
  providers: AuthProviders;
  /** 提供时启用 magic link（只能登录已有账号）。 */
  sendMagicLink?: MagicLinkSender | undefined;
  /** 用于读取客户端 IP 的请求头，线上是 Cloudflare 的 `cf-connecting-ip`。 */
  ipAddressHeaders?: readonly string[] | undefined;
  /** 本地测试可以关闭限流；线上默认开启。 */
  rateLimit?: boolean | undefined;
}

function socialProviders(p: AuthProviders) {
  const out: Record<string, OAuthClient> = {};
  if (p.github) out.github = p.github;
  if (p.discord) out.discord = p.discord;
  if (p.google) out.google = p.google;
  return out;
}

export function createAuth(opts: CreateAuthOptions) {
  if (opts.secret.length < 32) throw new Error("auth secret must be at least 32 characters");
  const plugins = opts.sendMagicLink
    ? [
        magicLink({
          disableSignUp: true,
          expiresIn: 10 * 60,
          sendMagicLink: async ({ email, url }) => {
            await opts.sendMagicLink?.({ email, url });
          },
        }),
      ]
    : [];
  return betterAuth({
    appName: "char.pub",
    baseURL: opts.baseURL,
    basePath: AUTH_BASE_PATH,
    secret: opts.secret,
    trustedOrigins: [...opts.trustedOrigins],
    // 模型名保持 Better Auth 的默认值（user / session / …），在这里映射到我们的表。
    database: drizzleAdapter(opts.db, {
      provider: "pg",
      schema: {
        user: schema.authUser,
        session: schema.authSession,
        account: schema.authAccount,
        verification: schema.authVerification,
        rateLimit: schema.authRateLimit,
      },
    }),
    user: {
      // 封禁字段由我们自己维护（见 `banUser`），客户端不能写入。员工角色只在 admin 进程中使用。
      additionalFields: {
        role: { type: "string", required: false, input: false, returned: false },
        banned: { type: "boolean", required: false, defaultValue: false, input: false },
        banReason: { type: "string", required: false, input: false, returned: false },
        banExpires: { type: "date", required: false, input: false },
      },
    },
    databaseHooks: {
      session: {
        create: {
          // 已封禁的用户不能建立新会话；封禁到期后自动解除。
          before: async (session) => {
            const [u] = await opts.db
              .select({ banned: schema.authUser.banned, banExpires: schema.authUser.banExpires })
              .from(schema.authUser)
              .where(eq(schema.authUser.id, session.userId))
              .limit(1);
            if (u && isBanned(u, new Date())) {
              throw APIError.from("FORBIDDEN", {
                message: "account is banned",
                code: "BANNED_USER",
              });
            }
          },
        },
      },
    },
    session: {
      expiresIn: SESSION_TTL_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      // 不在 cookie 里缓存会话：每次都查数据库，封禁与吊销立即生效。
      cookieCache: { enabled: false },
    },
    account: {
      // 同一邮箱的第三方账号只有在对方确认邮箱且本地账号也已验证时才会自动关联。
      accountLinking: { enabled: true, requireLocalEmailVerified: true },
      encryptOAuthTokens: true,
    },
    emailAndPassword: { enabled: false },
    socialProviders: socialProviders(opts.providers),
    rateLimit: {
      enabled: opts.rateLimit ?? true,
      storage: "database",
      window: 60,
      max: 60,
    },
    advanced: {
      // Better Auth 默认给安全 cookie 加 `__Secure-` 前缀。我们要的是更严格的 `__Host-`
      // （必须 Secure、Path=/、不能设 Domain），所以关掉自动前缀，把 `__Host-` 直接写进
      // 名字，Secure 由下面的默认属性保证。所有 Better Auth 的 cookie 都用这个前缀。
      useSecureCookies: false,
      cookiePrefix: COOKIE_PREFIX,
      cookies: {
        session_token: { name: SESSION_COOKIE },
      },
      defaultCookieAttributes: { sameSite: "lax", httpOnly: true, secure: true, path: "/" },
      crossSubDomainCookies: { enabled: false },
      // Better Auth 在 NODE_ENV=test 时默认跳过 Origin 与回调地址检查。这里显式打开，
      // 保证测试与线上的行为一致。
      disableOriginCheck: false,
      disableCSRFCheck: false,
      database: { generateId: () => uuidv7() },
      ipAddress: {
        ipAddressHeaders: [...(opts.ipAddressHeaders ?? ["cf-connecting-ip"])],
      },
    },
    telemetry: { enabled: false },
    plugins,
  });
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * 从请求的 session cookie 得到 principal。没有登录、会话过期或用户已被封禁时返回 null。
 * 封禁时会话已经被删除；这里再检查一次 banned，防止封禁与请求并发时漏掉。
 */
export function sessionPrincipalResolver(auth: Auth) {
  return async (req: Request): Promise<Principal | null> => {
    if (!req.headers.get("cookie")?.includes(SESSION_COOKIE)) return null;
    const result = await auth.api.getSession({
      headers: req.headers,
      query: { disableCookieCache: true },
    });
    if (!result) return null;
    const user = result.user as {
      id: string;
      banned?: boolean | null;
      banExpires?: Date | string | null;
    };
    if (isBanned(user, new Date())) return null;
    return { kind: "user", user_id: user.id, banned: false };
  };
}

/** 封禁有效：已标记封禁，并且没有到期时间或还没到期。 */
export function isBanned(
  u: { banned?: boolean | null; banExpires?: Date | string | null },
  now: Date,
): boolean {
  if (!u.banned) return false;
  if (!u.banExpires) return true;
  return new Date(u.banExpires) > now;
}
