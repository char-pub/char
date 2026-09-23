/**
 * 身份与账号。
 *
 * `auth_user` 先按 Better Auth 的 user 表结构（含 admin 插件字段）建一个最小集合，
 * 其他表都外键指向它；接入 Better Auth 时通过字段映射复用这张表，而不是另建。
 * 内部 user.id 是我们生成的 uuid，更换身份提供方不会改变它。
 */
import { sql } from "drizzle-orm";
import { bigint, boolean, index, integer, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { app, createdAt, emptyTextArray, pk, ts, updatedAt } from "./common.js";

export const authUser = app.table(
  "auth_user",
  {
    id: pk(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    name: text("name").notNull(),
    image: text("image"),
    /** 员工角色只在 admin 进程中生效；逗号分隔，与 Better Auth admin 插件一致。 */
    role: text("role"),
    banned: boolean("banned").notNull().default(false),
    banReason: text("ban_reason"),
    banExpires: ts("ban_expires"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("auth_user_email_uq").on(t.email)],
);

export const userSettings = app.table("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => authUser.id, { onDelete: "cascade" }),
  /** mature / explicit 内容默认隐藏，需要用户主动开启并确认。 */
  showMature: boolean("show_mature").notNull().default(false),
  matureConfirmedAt: ts("mature_confirmed_at"),
  locale: text("locale"),
  updatedAt: updatedAt(),
});

/** 个人 Token：只保存 sha256 哈希；prefix 用于在列表中辨认。 */
export const apiTokens = app.table(
  "api_tokens",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    tokenHash: text("token_hash").notNull(),
    scopes: text("scopes").array().notNull().default(emptyTextArray),
    /** 给 Agent 使用的 Token：用它提交的 Contribution 一律标记为 agent，不能改回。 */
    agent: boolean("agent").notNull().default(false),
    expiresAt: ts("expires_at"),
    lastUsedAt: ts("last_used_at"),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("api_tokens_hash_uq").on(t.tokenHash),
    index("api_tokens_user_idx").on(t.userId),
  ],
);

/**
 * 经验证的访客（作者允许所有人贡献时使用）。
 *
 * 不保存明文邮箱：`email_hmac` 是规范化邮箱的 HMAC，只用来让同一个邮箱再次验证时找回
 * 同一个访客。
 */
export const guests = app.table(
  "guests",
  {
    guestId: text("guest_id").primaryKey(),
    displayName: text("display_name").notNull(),
    emailHmac: text("email_hmac"),
    verifiedAt: ts("verified_at"),
    verificationKind: text("verification_kind"),
    disabledAt: ts("disabled_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("guests_email_hmac_uq").on(t.emailHmac)],
);

/** 访客邮箱验证：一次性 token 只存哈希，30 分钟过期，使用后记录 consumed_at。 */
export const guestVerifications = app.table(
  "guest_verifications",
  {
    id: pk(),
    tokenHash: text("token_hash").notNull(),
    emailHmac: text("email_hmac").notNull(),
    displayName: text("display_name").notNull(),
    expiresAt: ts("expires_at").notNull(),
    consumedAt: ts("consumed_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("guest_verifications_token_uq").on(t.tokenHash)],
);

/** 访客会话：cookie 中是随机 token，这里只存它的哈希。登出时删除整行。 */
export const guestSessions = app.table(
  "guest_sessions",
  {
    id: pk(),
    guestId: text("guest_id")
      .notNull()
      .references(() => guests.guestId, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("guest_sessions_token_uq").on(t.tokenHash),
    index("guest_sessions_guest_idx").on(t.guestId),
  ],
);

/** 应用内限流计数（固定窗口），存储在 Postgres，不引入 Redis。 */
export const rateLimits = app.table("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: ts("window_start").notNull(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Better Auth 管理的表。TypeScript 属性名与 Better Auth 的字段名一致，
// 所以除了表名之外不需要额外的字段映射。
// ---------------------------------------------------------------------------

/** 登录会话。封禁用户时整行删除，会话立即失效。 */
export const authSession = app.table(
  "auth_session",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    /** cookie 中带签名的随机值；单独拿到它不够，还需要服务端的签名密钥。 */
    token: text("token").notNull(),
    expiresAt: ts("expires_at").notNull(),
    /** 不保存原始 IP（数据最小化），始终为空。 */
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("auth_session_token_uq").on(t.token),
    index("auth_session_user_idx").on(t.userId),
  ],
);

/**
 * 外部身份：一个用户可以绑定多个登录方式。`(provider_id, account_id)` 是
 * provider 侧的稳定标识，更换或增加登录方式不会改变内部 user.id。
 */
export const authAccount = app.table(
  "auth_account",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    accountId: text("account_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: ts("access_token_expires_at"),
    refreshTokenExpiresAt: ts("refresh_token_expires_at"),
    scope: text("scope"),
    /** 不启用密码登录，始终为空；保留这一列是因为 Better Auth 的账号模型包含它。 */
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("auth_account_provider_uq").on(t.providerId, t.accountId),
    index("auth_account_user_idx").on(t.userId),
  ],
);

/** 一次性验证值：OAuth state、magic link 等，过期后由 Better Auth 清理。 */
export const authVerification = app.table(
  "auth_verification",
  {
    id: pk(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("auth_verification_identifier_idx").on(t.identifier)],
);

/** 登录相关接口的限流计数（按客户端 IP 与路径），与应用自己的 `rate_limits` 分开。 */
export const authRateLimit = app.table(
  "auth_rate_limit",
  {
    id: pk(),
    key: text("key").notNull(),
    count: integer("count").notNull(),
    /** 最近一次请求的时间，毫秒时间戳。 */
    lastRequest: bigint("last_request", { mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("auth_rate_limit_key_uq").on(t.key)],
);

/**
 * 外部身份视图 `(user_id, provider, provider_subject)`。业务代码通过它查询外部身份，
 * 不直接依赖 Better Auth 的表结构；以后更换认证库时只需要改这个视图。
 */
export const externalIdentities = app.view("external_identities").as((qb) =>
  qb
    .select({
      userId: authAccount.userId,
      provider: sql<string>`${authAccount.providerId}`.as("provider"),
      providerSubject: sql<string>`${authAccount.accountId}`.as("provider_subject"),
      createdAt: authAccount.createdAt,
    })
    .from(authAccount),
);
