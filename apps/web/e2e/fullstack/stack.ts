/**
 * 端到端测试的完整本地环境：docker compose 的 Postgres 与 MinIO、编译后的 API 与 worker
 * 进程。每次运行都重建一个专用的数据库（`charpub_e2e`），不影响本地开发数据。
 *
 * 这里的口令都是 infra/docker-compose.yml 中只用于本机的开发口令；会话签名密钥每次运行
 * 随机生成。
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

export const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
export const API_PORT = 3100;
export const WORKER_PORT = 3101;
export const WEB_PORT = 4174;
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
export const DB_NAME = "charpub_e2e";
/** 运行期间的状态（会话密钥、进程 ID），供测试与 teardown 读取。 */
export const STATE_FILE = fileURLToPath(
  new URL("../../test-results/fullstack-state.json", import.meta.url),
);

const PG = { host: "127.0.0.1", port: 54329 };
const OWNER = { user: "charpub_owner", password: "charpub_owner_local" };
const APP = { user: "charpub_app", password: "charpub_app_local" };

export function pgUrl(who: { user: string; password: string }, db: string): string {
  return `postgres://${who.user}:${who.password}@${PG.host}:${PG.port}/${db}`;
}

export interface StackState {
  secret: string;
  systemActorId: string;
  pids: number[];
}

function sh(cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env): void {
  execFileSync(cmd, args, { cwd: ROOT, env, stdio: "inherit" });
}

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      // 进程还没有开始监听。
    }
    if (Date.now() > until) throw new Error(`timed out waiting for ${url}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function resetDatabase(): Promise<void> {
  const admin = new pg.Client({ connectionString: pgUrl(OWNER, "postgres") });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${DB_NAME} OWNER ${OWNER.user}`);
  await admin.query(`GRANT CONNECT ON DATABASE ${DB_NAME} TO ${APP.user}`);
  await admin.end();
  const db = new pg.Client({ connectionString: pgUrl(OWNER, DB_NAME) });
  await db.connect();
  await db.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  await db.end();
}

export function serverEnv(state: Pick<StackState, "secret" | "systemActorId">) {
  return {
    ...process.env,
    NODE_ENV: "development",
    LOG_LEVEL: "warn",
    DATABASE_URL: pgUrl(APP, DB_NAME),
    DATABASE_MIGRATION_URL: pgUrl(OWNER, DB_NAME),
    DATABASE_APP_ROLE: APP.user,
    S3_ENDPOINT: "http://127.0.0.1:59000",
    S3_REGION: "us-east-1",
    S3_ACCESS_KEY_ID: "charpub_local",
    S3_SECRET_ACCESS_KEY: "charpub_local_secret",
    S3_BUCKET_PUBLIC: "charpub-local-public",
    S3_BUCKET_PRIVATE: "charpub-local-private",
    S3_BUCKET_UPLOADS: "charpub-local-uploads",
    S3_BUCKET_EVIDENCE: "charpub-local-evidence",
    PUBLIC_ASSETS_BASE_URL: "http://127.0.0.1:59000/charpub-local-public",
    BETTER_AUTH_SECRET: state.secret,
    BETTER_AUTH_URL: WEB_ORIGIN,
    AUTH_TRUSTED_ORIGINS: WEB_ORIGIN,
    SYSTEM_ACTOR_ID: state.systemActorId,
  };
}

function startProcess(kind: "api" | "worker", port: number, env: NodeJS.ProcessEnv): ChildProcess {
  const logDir = fileURLToPath(new URL("../../test-results/", import.meta.url));
  mkdirSync(logDir, { recursive: true });
  const log = createWriteStream(`${logDir}fullstack-${kind}.log`);
  const child = spawn("node", ["apps/server/dist/main.js", kind], {
    cwd: ROOT,
    env: { ...env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  return child;
}

/** 本地开发环境已经在运行时直接复用，避免重建正在使用的容器。 */
async function infraRunning(): Promise<boolean> {
  try {
    const c = new pg.Client({ connectionString: pgUrl(OWNER, "postgres") });
    await c.connect();
    await c.end();
    const minio = await fetch("http://127.0.0.1:59000/minio/health/ready");
    return minio.ok;
  } catch {
    return false;
  }
}

/** Playwright globalSetup：启动依赖、迁移数据库、启动 API 与 worker。 */
export default async function setup(): Promise<() => Promise<void>> {
  if (!(await infraRunning())) {
    sh("docker", ["compose", "-f", "infra/docker-compose.yml", "up", "-d", "--wait"]);
  }
  sh("pnpm", ["--filter", "@char-pub/server", "build"]);

  await resetDatabase();
  const state: StackState = {
    secret: randomBytes(36).toString("base64url"),
    systemActorId: randomUUID(),
    pids: [],
  };
  const env = serverEnv(state);
  sh("node", ["apps/server/dist/main.js", "migrate"], env);

  // 自动处置记录的系统执行者必须是一个真实存在的账号。
  const db = new pg.Client({ connectionString: pgUrl(OWNER, DB_NAME) });
  await db.connect();
  await db.query(
    "INSERT INTO app.auth_user (id, email, name, email_verified) VALUES ($1, 'system@char.pub.invalid', 'char.pub system', true)",
    [state.systemActorId],
  );
  await db.end();

  const api = startProcess("api", API_PORT, env);
  const worker = startProcess("worker", WORKER_PORT, env);
  state.pids = [api.pid ?? 0, worker.pid ?? 0];
  mkdirSync(fileURLToPath(new URL("../../test-results/", import.meta.url)), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state));
  await Promise.all([
    waitFor(`http://127.0.0.1:${API_PORT}/healthz`, 30_000),
    waitFor(`http://127.0.0.1:${WORKER_PORT}/healthz`, 30_000),
  ]);

  return async () => {
    api.kill("SIGTERM");
    worker.kill("SIGTERM");
  };
}
