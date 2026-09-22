/**
 * 数据库迁移入口，作为部署前命令执行（用 owner 角色连接）。
 *
 * 步骤：
 * 1. 运行 drizzle 迁移（建 `app` schema 与所有业务表）。
 * 2. 安装或升级 pg-boss 的 `pgboss` schema，并创建所有队列。队列定义在代码里，
 *    迁移时统一创建，应用进程只需要读写权限。
 * 3. 给应用角色授予最小权限：普通表 SELECT / INSERT / UPDATE / DELETE；
 *    audit_log 只有 INSERT / SELECT，应用无法修改或删除审计记录。
 *    应用角色不拥有任何表，所以不能 ALTER / DROP / TRUNCATE。
 *
 * 整个过程可以重复执行（幂等）。
 */
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { PgBoss } from "pg-boss";
import { MigrationEnvSchema, parseEnv } from "../env.js";
import { QUEUES } from "../jobs/definitions.js";
import { PGBOSS_SCHEMA } from "../jobs/queue.js";
import { createDatabase } from "./client.js";

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));
export const MIGRATIONS_SCHEMA = "migrations";

/** 只允许追加的表：应用角色只有 INSERT / SELECT。 */
export const APPEND_ONLY_TABLES = ["audit_log"] as const;

export interface MigrateOptions {
  /** owner 角色连接串。 */
  connectionString: string;
  /** 应用运行时使用的角色名。 */
  appRole: string;
}

const ROLE_RE = /^[a-z_][a-z0-9_]{0,62}$/;

export async function runMigrations(options: MigrateOptions): Promise<void> {
  if (!ROLE_RE.test(options.appRole)) throw new Error("invalid app role name");
  const { db, close } = createDatabase(options.connectionString, { max: 2 });
  try {
    // 迁移记录放在独立的 schema，应用角色对它没有任何权限。
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER, migrationsSchema: MIGRATIONS_SCHEMA });

    const boss = new PgBoss({
      connectionString: options.connectionString,
      schema: PGBOSS_SCHEMA,
      migrate: true,
      supervise: false,
      schedule: false,
      max: 2,
    });
    boss.on("error", () => {});
    await boss.start();
    try {
      for (const q of QUEUES) {
        // 先建死信队列，因为业务队列会引用它。
        if (q.deadLetter && !(await boss.getQueue(q.deadLetter))) {
          await boss.createQueue(q.deadLetter, { policy: "standard" });
        }
        const { name, ...opts } = q;
        if (await boss.getQueue(name)) await boss.updateQueue(name, withoutFixed(opts));
        else await boss.createQueue(name, opts);
      }
    } finally {
      await boss.stop({ graceful: false });
    }

    await grantAppRole(db, options.appRole);
  } finally {
    await close();
  }
}

/** 队列创建后不能修改的字段（policy、partition）在更新时去掉。 */
function withoutFixed<T extends { policy?: unknown; partition?: unknown }>(o: T) {
  const { policy: _p, partition: _q, ...rest } = o;
  return rest;
}

async function grantAppRole(db: ReturnType<typeof createDatabase>["db"], role: string) {
  const r = sql.identifier(role);
  const b = sql.identifier(PGBOSS_SCHEMA);
  await db.execute(sql`GRANT USAGE ON SCHEMA app TO ${r}`);
  await db.execute(sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO ${r}`);
  await db.execute(sql`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO ${r}`);
  for (const t of APPEND_ONLY_TABLES) {
    const table = sql.identifier(t);
    await db.execute(sql`REVOKE UPDATE, DELETE, TRUNCATE ON app.${table} FROM ${r}`);
  }
  // pg-boss：应用只做入队、取任务、完成 / 失败这类数据操作，以及调用它的函数。
  await db.execute(sql`GRANT USAGE ON SCHEMA ${b} TO ${r}`);
  await db.execute(sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${b} TO ${r}`);
  await db.execute(sql`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${b} TO ${r}`);
  await db.execute(sql`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${b} TO ${r}`);
  // 队列的增删只能由迁移完成：应用可以更新队列统计，但不能新建或删除队列、改版本记录。
  for (const t of PGBOSS_OWNER_ONLY_TABLES) {
    const table = sql.identifier(t);
    await db.execute(sql`REVOKE INSERT, DELETE, TRUNCATE ON ${b}.${table} FROM ${r}`);
  }
}

/** pg-boss 中只允许迁移新增或删除行的表。 */
export const PGBOSS_OWNER_ONLY_TABLES = ["queue", "version"] as const;

async function main() {
  const env = parseEnv(MigrationEnvSchema);
  await runMigrations({
    connectionString: env.DATABASE_MIGRATION_URL,
    appRole: env.DATABASE_APP_ROLE,
  });
  process.stdout.write("migrations complete\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err: unknown) => {
    process.stderr.write(`migration failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
