/**
 * 身份与账号。
 *
 * `auth_user` 先按 Better Auth 的 user 表结构（含 admin 插件字段）建一个最小集合，
 * 其他表都外键指向它；接入 Better Auth 时通过字段映射复用这张表，而不是另建。
 * 内部 user.id 是我们生成的 uuid，更换身份提供方不会改变它。
 */
import { boolean, index, integer, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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

/** 经验证的访客（允许所有人贡献时使用）。 */
export const guests = app.table("guests", {
  guestId: text("guest_id").primaryKey(),
  displayName: text("display_name").notNull(),
  verifiedAt: ts("verified_at"),
  verificationKind: text("verification_kind"),
  disabledAt: ts("disabled_at"),
  createdAt: createdAt(),
});

/** 应用内限流计数（固定窗口），存储在 Postgres，不引入 Redis。 */
export const rateLimits = app.table("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: ts("window_start").notNull(),
  updatedAt: updatedAt(),
});
