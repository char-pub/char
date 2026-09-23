/**
 * 进程入口。同一个镜像用不同的命令启动：
 *
 *   node dist/main.js api      公开 API
 *   node dist/main.js admin    admin API（只接受经过 Cloudflare Access 的请求）
 *   node dist/main.js worker   任务消费者，没有公网入口，只在本机端口提供健康检查
 *   node dist/main.js migrate  部署前的数据库迁移（owner 角色）
 *   node dist/main.js bootstrap [--system-actor] [--owner <email>]  新环境的一次性引导
 *
 * 启动时校验环境变量，缺项直接退出，错误信息只包含变量名。
 */
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";

export type ProcessKind = "api" | "admin" | "worker" | "migrate" | "bootstrap";

export function parseProcessKind(argv: readonly string[]): ProcessKind {
  const kind = argv[2];
  if (
    kind === "api" ||
    kind === "admin" ||
    kind === "worker" ||
    kind === "migrate" ||
    kind === "bootstrap"
  ) {
    return kind;
  }
  throw new Error(`usage: main.js <api|admin|worker|migrate|bootstrap> (got ${kind ?? "nothing"})`);
}

async function main(): Promise<void> {
  const kind = parseProcessKind(process.argv);
  const port = Number(process.env.PORT ?? 3000);
  if (kind === "migrate") {
    const { migrateFromEnv } = await import("./processes/migrate.js");
    await migrateFromEnv();
    return;
  }
  if (kind === "bootstrap") {
    const { bootstrapFromArgs } = await import("./processes/bootstrap.js");
    await bootstrapFromArgs(process.argv.slice(3));
    return;
  }
  const { startProcess } = await import("./processes/start.js");
  const { fetch, hostname, shutdown } = await startProcess(kind);
  const server = serve({ fetch, port, ...(hostname ? { hostname } : {}) });
  const stop = async () => {
    server.close();
    await shutdown();
    process.exit(0);
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
