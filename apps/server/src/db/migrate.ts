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

/** 记录可以更新状态但永不删除的表：应用角色没有 DELETE / TRUNCATE。 */
export const NO_DELETE_TABLES = ["csam_incidents", "staff_approvals"] as const;

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
      for (const name of PGBOSS_INTERNAL_QUEUES) {
        if (!(await boss.getQueue(name))) await boss.createQueue(name);
      }
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
  for (const t of NO_DELETE_TABLES) {
    const table = sql.identifier(t);
    await db.execute(sql`REVOKE DELETE, TRUNCATE ON app.${table} FROM ${r}`);
  }
  // pg-boss：应用只做入队、取任务、完成 / 失败这类数据操作，以及调用它的函数。
  await db.execute(sql`GRANT USAGE ON SCHEMA ${b} TO ${r}`);
  await db.execute(sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${b} TO ${r}`);
  await db.execute(sql`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${b} TO ${r}`);
  await db.execute(sql`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${b} TO ${r}`);
  // 应用不能删除队列，也不能新增或删除 pg-boss 的版本记录。
  // - queue 保留 INSERT：pg-boss 的定时调度每次启动都会调用 create_queue 创建内部队列
  //   （迁移时已经建好，实际是 ON CONFLICT DO NOTHING），没有 INSERT 权限 worker 无法启动。
  // - version 保留 UPDATE：调度与监控会在这一行上记录 cron 与退避时间。
  await db.execute(sql`REVOKE DELETE, TRUNCATE ON ${b}.queue FROM ${r}`);
  await db.execute(sql`REVOKE INSERT, DELETE, TRUNCATE ON ${b}.version FROM ${r}`);
  // 行级安全：应用角色只能“插入”迁移时登记过的队列名（实际上都已存在，插入会被
  // ON CONFLICT 忽略），不能借此新建别的队列。表的 owner（迁移角色）不受这些策略限制。
  // DDL 不能使用绑定参数，所以队列名以字面量写入策略。它们都是代码里的常量，
  // 这里再按严格的字符集检查一遍，防止任何意外字符进入 SQL。
  const names = knownQueueNames();
  for (const n of names) {
    if (!/^[a-z0-9_.-]+$/.test(n)) throw new Error(`unexpected queue name: ${n}`);
  }
  const allowed = sql.raw(names.map((n) => `'${n}'`).join(", "));
  await db.execute(sql`ALTER TABLE ${b}.queue ENABLE ROW LEVEL SECURITY`);
  for (const p of ["app_select", "app_update", "app_insert"]) {
    await db.execute(sql`DROP POLICY IF EXISTS ${sql.identifier(p)} ON ${b}.queue`);
  }
  await db.execute(sql`CREATE POLICY app_select ON ${b}.queue FOR SELECT TO ${r} USING (true)`);
  await db.execute(
    sql`CREATE POLICY app_update ON ${b}.queue FOR UPDATE TO ${r} USING (true) WITH CHECK (true)`,
  );
  await db.execute(
    sql`CREATE POLICY app_insert ON ${b}.queue FOR INSERT TO ${r} WITH CHECK (name IN (${allowed}))`,
  );
}

/** 迁移时创建的全部队列名：业务队列、它们的死信队列与 pg-boss 的内部队列。 */
function knownQueueNames(): string[] {
  const names = new Set<string>(PGBOSS_INTERNAL_QUEUES);
  for (const q of QUEUES) {
    names.add(q.name);
    if (q.deadLetter) names.add(q.deadLetter);
  }
  return [...names].sort();
}

/** pg-boss 中应用不能删除行的表。 */
export const PGBOSS_OWNER_ONLY_TABLES = ["queue", "version"] as const;

/** pg-boss 定时调度使用的内部队列，迁移时预先创建。 */
export const PGBOSS_INTERNAL_QUEUES = ["__pgboss__send-it"] as const;

export async function migrateFromEnv(): Promise<void> {
  const env = parseEnv(MigrationEnvSchema);
  await runMigrations({
    connectionString: env.DATABASE_MIGRATION_URL,
    appRole: env.DATABASE_APP_ROLE,
  });
  process.stdout.write("migrations complete\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrateFromEnv().catch((err: unknown) => {
    process.stderr.write(`migration failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
