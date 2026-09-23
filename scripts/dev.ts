/**
 * 本地一键开发环境（`pnpm dev`）：
 *
 *   1. 确认 docker compose 的 Postgres、MinIO、Mailpit 在运行，没有就启动；
 *   2. 迁移本地数据库 `charpub`，并创建自动处置使用的系统账号；
 *   3. 从 TypeScript 源码启动 api（默认端口 3000）与 worker（健康检查默认在 3001），
 *      改动代码后自动重启；
 *   4. 启动 web 的 Vite 开发服务器（默认 http://localhost:5173），`/v1` 转发给 api。
 *
 * 端口被占用时可以用 `DEV_API_PORT`、`DEV_WORKER_PORT`、`DEV_WEB_PORT` 换一个。
 *
 * 会话签名密钥与系统账号 ID 只在第一次运行时随机生成，保存在 `.dev/state.json`（不提交）。
 * 数据库与对象存储的口令是 infra/docker-compose.yml 中只用于本机的开发口令。
 * 仓库根目录的 `.env`（不提交）中的变量会覆盖这里的默认值，例如 OAuth client 或访客验证的配置。
 *
 * Ctrl-C 停止所有进程；容器保持运行，用 `pnpm infra:down` 停止。
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const STATE_DIR = `${ROOT}.dev`;
const STATE_FILE = `${STATE_DIR}/state.json`;

export const API_PORT = Number(process.env.DEV_API_PORT ?? 3000);
export const WORKER_PORT = Number(process.env.DEV_WORKER_PORT ?? 3001);
export const WEB_PORT = Number(process.env.DEV_WEB_PORT ?? 5173);
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;

interface DevState {
  betterAuthSecret: string;
  systemActorId: string;
}

/** 第一次运行时生成本地密钥，之后复用，重启不会让已登录的会话失效。 */
export function loadOrCreateState(): DevState {
  if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf8")) as DevState;
  return saveState({
    betterAuthSecret: randomBytes(36).toString("base64url"),
    systemActorId: randomUUID(),
  });
}

function saveState(state: DevState): DevState {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  return state;
}

const PG = "127.0.0.1:54329/charpub";

export function devEnv(state: DevState, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "development",
    LOG_LEVEL: "info",
    DATABASE_URL: `postgres://charpub_app:charpub_app_local@${PG}`,
    DATABASE_MIGRATION_URL: `postgres://charpub_owner:charpub_owner_local@${PG}`,
    DATABASE_APP_ROLE: "charpub_app",
    S3_ENDPOINT: "http://127.0.0.1:59000",
    S3_REGION: "us-east-1",
    S3_ACCESS_KEY_ID: "charpub_local",
    S3_SECRET_ACCESS_KEY: "charpub_local_secret",
    S3_BUCKET_PUBLIC: "charpub-local-public",
    S3_BUCKET_PRIVATE: "charpub-local-private",
    S3_BUCKET_UPLOADS: "charpub-local-uploads",
    S3_BUCKET_EVIDENCE: "charpub-local-evidence",
    PUBLIC_ASSETS_BASE_URL: "http://127.0.0.1:59000/charpub-local-public",
    BETTER_AUTH_SECRET: state.betterAuthSecret,
    BETTER_AUTH_URL: WEB_ORIGIN,
    AUTH_TRUSTED_ORIGINS: WEB_ORIGIN,
    SYSTEM_ACTOR_ID: state.systemActorId,
    ...overrides,
  };
}

/** 仓库根目录 `.env` 中的变量（没有这个文件时为空）。 */
function localOverrides(): NodeJS.ProcessEnv {
  const file = `${ROOT}.env`;
  if (!existsSync(file)) return {};
  const before = { ...process.env };
  process.loadEnvFile(file);
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (before[k] !== v) out[k] = v;
  return out;
}

async function reachable(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!(await reachable(url))) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${url}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** 端口是否空闲：在所有地址上试着监听一次。 */
function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer()
      .once("error", () => resolve(false))
      .once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port);
  });
}

const SERVER_ENTRY = ["tsx", "--conditions=@char-pub/source", "apps/server/src/main.ts"];

function run(args: string[], env: NodeJS.ProcessEnv): void {
  execFileSync("pnpm", ["exec", ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
}

/**
 * 创建系统账号。多个 clone 或 worktree 共用同一个本地数据库时，库里可能已经有另一个 ID 的
 * 系统账号：本地开发以数据库为准，改用那个 ID 并记进 `.dev/state.json`。
 */
function ensureSystemActor(state: DevState, overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = devEnv(state, overrides);
  try {
    execFileSync("pnpm", ["exec", ...SERVER_ENTRY, "bootstrap", "--system-actor"], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ["ignore", "inherit", "pipe"],
    });
    return env;
  } catch (e) {
    const stderr = String((e as { stderr?: Buffer }).stderr ?? "");
    const existing = /system_actor_mismatch: \S+ already belongs to ([0-9a-f-]{36})/.exec(
      stderr,
    )?.[1];
    if (!existing || overrides.SYSTEM_ACTOR_ID) {
      process.stderr.write(stderr);
      throw e;
    }
    const adopted = saveState({ ...state, systemActorId: existing });
    process.stdout.write(`using the existing local system actor ${existing}\n`);
    return devEnv(adopted, overrides);
  }
}

const COLORS = { api: 36, worker: 35, web: 32 } as const;

/** 启动一个长期运行的子进程，输出逐行加上带颜色的前缀。 */
function start(name: keyof typeof COLORS, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  // 独立的进程组：停止时连同 pnpm 启动的孙进程一起结束。
  const child = spawn("pnpm", args, {
    cwd: ROOT,
    env: { ...process.env, ...env, FORCE_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const prefix = `\x1b[${COLORS[name]}m${name.padEnd(6)}\x1b[0m│ `;
  for (const stream of [child.stdout, child.stderr]) {
    let buf = "";
    stream?.setEncoding("utf8");
    stream?.on("data", (chunk: string) => {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) process.stdout.write(`${prefix}${line}\n`);
    });
  }
  child.on("exit", (code, signal) => {
    if (stopping) return;
    process.stdout.write(`${prefix}exited (${signal ?? code})\n`);
    stop(1);
  });
  children.push(child);
  return child;
}

const children: ChildProcess[] = [];
let stopping = false;

function stop(exitCode: number): void {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    try {
      if (c.pid) process.kill(-c.pid, "SIGTERM");
    } catch {
      // 进程组已经结束。
    }
  }
  setTimeout(() => process.exit(exitCode), 1500).unref();
}

async function main(): Promise<void> {
  for (const [name, port] of [
    ["DEV_API_PORT", API_PORT],
    ["DEV_WORKER_PORT", WORKER_PORT],
    ["DEV_WEB_PORT", WEB_PORT],
  ] as const) {
    if (!(await portFree(port))) {
      throw new Error(`port ${port} is already in use; pick another one with ${name}=<port>`);
    }
  }
  if (!(await reachable("http://127.0.0.1:59000/minio/health/ready"))) {
    execFileSync("docker", ["compose", "-f", "infra/docker-compose.yml", "up", "-d", "--wait"], {
      cwd: ROOT,
      stdio: "inherit",
    });
  }

  const overrides = localOverrides();
  const state = loadOrCreateState();
  run([...SERVER_ENTRY, "migrate"], devEnv(state, overrides));
  const env = ensureSystemActor(state, overrides);

  process.once("SIGINT", () => stop(0));
  process.once("SIGTERM", () => stop(0));
  start("api", ["exec", "tsx", "watch", ...SERVER_ENTRY.slice(1), "api"], {
    ...env,
    PORT: String(API_PORT),
  });
  start("worker", ["exec", "tsx", "watch", ...SERVER_ENTRY.slice(1), "worker"], {
    ...env,
    PORT: String(WORKER_PORT),
  });
  start(
    "web",
    [
      "--filter",
      "@char-pub/web",
      "exec",
      "vite",
      "--host",
      "localhost",
      "--port",
      String(WEB_PORT),
      "--strictPort",
    ],
    { API_PROXY: `http://127.0.0.1:${API_PORT}`, VITE_API_BASE_URL: "" },
  );

  await Promise.all([
    waitFor(`http://127.0.0.1:${API_PORT}/healthz`, 60_000),
    waitFor(`http://127.0.0.1:${WORKER_PORT}/healthz`, 60_000),
    waitFor(WEB_ORIGIN, 60_000),
  ]);
  process.stdout.write(
    [
      "",
      `  char.pub is running: ${WEB_ORIGIN}`,
      `  API ${`http://127.0.0.1:${API_PORT}`} · worker health http://127.0.0.1:${WORKER_PORT}/healthz`,
      "  Mail (Mailpit): http://127.0.0.1:58025 · MinIO console: http://127.0.0.1:59001",
      "  Sign in without an OAuth app: pnpm dev:login <name>",
      "",
    ].join("\n"),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    if (children.length > 0) stop(1);
    else process.exit(1);
  });
}
