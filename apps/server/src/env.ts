/**
 * 环境变量校验。进程启动时解析一次；缺项或格式错误直接抛出，让进程立即退出，
 * 而不是带着错误配置运行到一半才失败。
 *
 * 各进程只校验自己需要的部分：api / admin / worker 共用数据库与存储配置，
 * 迁移命令只需要 owner 角色的连接串。
 */
import { z } from "zod";

const url = z.url();
const nonEmpty = z.string().min(1);

export const DatabaseEnvSchema = z.object({
  /** 应用运行时使用的非 owner 角色连接串。 */
  DATABASE_URL: url,
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
});

export const MigrationEnvSchema = z.object({
  /** 迁移使用的 owner 角色连接串（拥有表结构）。 */
  DATABASE_MIGRATION_URL: url,
  /** 应用运行时使用的角色名，迁移结束时给它授予最小权限。 */
  DATABASE_APP_ROLE: z
    .string()
    .regex(/^[a-z_][a-z0-9_]{0,62}$/)
    .default("charpub_app"),
});

export const StorageEnvSchema = z.object({
  S3_ENDPOINT: url,
  S3_REGION: nonEmpty.default("auto"),
  S3_ACCESS_KEY_ID: nonEmpty,
  S3_SECRET_ACCESS_KEY: nonEmpty,
  S3_BUCKET_PUBLIC: nonEmpty,
  S3_BUCKET_PRIVATE: nonEmpty,
  S3_BUCKET_UPLOADS: nonEmpty,
  S3_BUCKET_EVIDENCE: nonEmpty,
  /** 公共资源的稳定 URL 前缀，例如 https://assets.char.pub。 */
  PUBLIC_ASSETS_BASE_URL: url,
});

export const RuntimeEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

export const ServerEnvSchema = RuntimeEnvSchema.extend(DatabaseEnvSchema.shape).extend(
  StorageEnvSchema.shape,
);

/** 逗号分隔的 Origin 列表，每一项必须是 `https://host` 或本地开发的 `http://localhost:port` 这样的纯 Origin。 */
const originList = z
  .string()
  .transform((s) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x.length > 0),
  )
  .pipe(
    z
      .array(
        z.string().refine((o) => {
          try {
            const u = new URL(o);
            // 不接受通配符：白名单必须精确列出每个 Origin。
            const plainHost = /^[a-z0-9.-]+$/.test(u.hostname);
            return (
              plainHost && u.origin === o && (u.protocol === "https:" || u.hostname === "localhost")
            );
          } catch {
            return false;
          }
        }, "must be a bare origin such as https://www.char.pub"),
      )
      .min(1),
  );

/**
 * 创作者登录（Better Auth）。第三方登录的 client id 与 secret 必须成对出现；
 * 缺少的 provider 不启用。
 */
export const AuthEnvSchema = z
  .object({
    BETTER_AUTH_SECRET: z.string().min(32),
    /** API 的外部地址，例如 https://api.char.pub；OAuth 回调地址由它推导。 */
    BETTER_AUTH_URL: url,
    /** 允许发起登录与写请求的前端 Origin，逗号分隔。 */
    AUTH_TRUSTED_ORIGINS: originList,
    GITHUB_CLIENT_ID: nonEmpty.optional(),
    GITHUB_CLIENT_SECRET: nonEmpty.optional(),
    DISCORD_CLIENT_ID: nonEmpty.optional(),
    DISCORD_CLIENT_SECRET: nonEmpty.optional(),
    GOOGLE_CLIENT_ID: nonEmpty.optional(),
    GOOGLE_CLIENT_SECRET: nonEmpty.optional(),
  })
  .superRefine((env, ctx) => {
    for (const p of ["GITHUB", "DISCORD", "GOOGLE"] as const) {
      const id = env[`${p}_CLIENT_ID`];
      const secret = env[`${p}_CLIENT_SECRET`];
      if ((id === undefined) !== (secret === undefined)) {
        ctx.addIssue({
          code: "custom",
          path: [`${p}_CLIENT_${id === undefined ? "ID" : "SECRET"}`],
          message: "client id and secret must be set together",
        });
      }
    }
  });

export type DatabaseEnv = z.infer<typeof DatabaseEnvSchema>;
export type MigrationEnv = z.infer<typeof MigrationEnvSchema>;
export type StorageEnv = z.infer<typeof StorageEnvSchema>;
export type ServerEnv = z.infer<typeof ServerEnvSchema>;
export type AuthEnv = z.infer<typeof AuthEnvSchema>;

/**
 * 源站校验：Cloudflare 回源时附带的 `X-Origin-Auth`。轮换期间可以同时配置当前值与上一个值。
 * production 必须配置；只有 development 允许留空（本地开发不经过 Cloudflare）。
 */
export const EdgeEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    ORIGIN_AUTH_SECRET: z.string().min(32).optional(),
    ORIGIN_AUTH_SECRET_PREVIOUS: z.string().min(32).optional(),
  })
  .refine((e) => e.NODE_ENV === "development" || e.ORIGIN_AUTH_SECRET !== undefined, {
    message: "required outside development",
    path: ["ORIGIN_AUTH_SECRET"],
  });
export type EdgeEnv = z.infer<typeof EdgeEnvSchema>;

export function originSecretsFromEnv(env: EdgeEnv): string[] {
  return [env.ORIGIN_AUTH_SECRET, env.ORIGIN_AUTH_SECRET_PREVIOUS].filter(
    (s): s is string => s !== undefined,
  );
}

/** worker 进程：系统执行者账号与 CDN 缓存清除。 */
export const WorkerEnvSchema = z.object({
  /** 自动处置（例如 CSAM 命中）记录的执行者，必须是 auth_user 中存在的系统账号。 */
  SYSTEM_ACTOR_ID: z.uuid(),
  /** Cloudflare zone 与只有 Cache Purge 权限的 token；不配置时只记录日志（本地开发）。 */
  CF_ZONE_ID: nonEmpty.optional(),
  CF_PURGE_TOKEN: nonEmpty.optional(),
});
export type WorkerEnv = z.infer<typeof WorkerEnvSchema>;

/** admin 进程：Cloudflare Access 与员工允许名单。 */
export const AdminEnvSchema = z.object({
  CF_ACCESS_TEAM_DOMAIN: url,
  CF_ACCESS_AUD: nonEmpty,
  /** 允许进入 admin 的员工邮箱，逗号分隔。 */
  STAFF_EMAILS: z
    .string()
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim().toLowerCase())
        .filter((x) => x.length > 0),
    )
    .pipe(z.array(z.email()).min(1)),
  /** admin SPA 的 Origin（例如 https://admin.char.pub）。 */
  ADMIN_ORIGINS: originList,
  /** 法律请求中申请人信息的加密密钥：32 字节，base64 编码。 */
  LEGAL_ENCRYPTION_KEY: z
    .string()
    .refine((s) => Buffer.from(s, "base64").length === 32, "must be 32 bytes, base64 encoded"),
});
export type AdminEnv = z.infer<typeof AdminEnvSchema>;

/** 从环境变量得到已配置的第三方登录。 */
export function authProvidersFromEnv(env: AuthEnv) {
  const pair = (id: string | undefined, secret: string | undefined) =>
    id && secret ? { clientId: id, clientSecret: secret } : undefined;
  return {
    github: pair(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET),
    discord: pair(env.DISCORD_CLIENT_ID, env.DISCORD_CLIENT_SECRET),
    google: pair(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
  };
}

export class EnvError extends Error {
  constructor(readonly issues: { variable: string; message: string }[]) {
    super(`invalid environment: ${issues.map((i) => `${i.variable} (${i.message})`).join(", ")}`);
    this.name = "EnvError";
  }
}

/**
 * 按 schema 解析环境变量。错误信息只包含变量名和原因，不回显变量值，避免把密钥写进日志。
 */
export function parseEnv<S extends z.ZodType>(
  schema: S,
  source: Record<string, string | undefined> = process.env,
): z.infer<S> {
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) {
    if (v !== undefined && v !== "") cleaned[k] = v;
  }
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    throw new EnvError(
      result.error.issues.map((i) => ({
        variable: i.path.join(".") || "(root)",
        message: i.code === "invalid_type" && i.input === undefined ? "missing" : i.message,
      })),
    );
  }
  return result.data;
}
