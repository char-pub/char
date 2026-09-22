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

export type DatabaseEnv = z.infer<typeof DatabaseEnvSchema>;
export type MigrationEnv = z.infer<typeof MigrationEnvSchema>;
export type StorageEnv = z.infer<typeof StorageEnvSchema>;
export type ServerEnv = z.infer<typeof ServerEnvSchema>;

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
