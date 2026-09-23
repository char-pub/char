/**
 * `pnpm dev` 的冒烟测试（`pnpm dev:smoke`）：按 README 的方式启动整个本地环境，检查 web、
 * 经 web 代理的 API、worker 健康检查，用 `pnpm dev:login` 登录并确认会话有效，最后发送
 * Ctrl-C，确认所有进程都退出。CI 在全新的 runner 上运行它，相当于每次都在干净的机器上
 * 走一遍本地开发步骤。
 *
 * 端口沿用 `pnpm dev` 的 `DEV_API_PORT`、`DEV_WORKER_PORT`、`DEV_WEB_PORT`。
 */
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const API_PORT = Number(process.env.DEV_API_PORT ?? 3000);
const WORKER_PORT = Number(process.env.DEV_WORKER_PORT ?? 3001);
const WEB = `http://localhost:${process.env.DEV_WEB_PORT ?? 5173}`;

async function status(url: string, init?: RequestInit): Promise<number> {
  try {
    return (await fetch(url, { ...init, signal: AbortSignal.timeout(5000) })).status;
  } catch {
    return 0;
  }
}

function check(name: string, ok: boolean, detail: string): void {
  process.stdout.write(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}\n`);
  if (!ok) process.exitCode = 1;
}

async function main(): Promise<void> {
  // 直接用 tsx 启动（与 `pnpm dev` 相同的入口），这样 Ctrl-C 只发给 dev 脚本本身，
  // 检查的是它自己的关闭逻辑。
  const dev = spawn(`${ROOT}node_modules/.bin/tsx`, ["scripts/dev.ts"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  dev.stdout.on("data", (b: Buffer) => {
    log += b.toString();
  });
  dev.stderr.on("data", (b: Buffer) => {
    log += b.toString();
  });
  const exited = new Promise<number | null>((resolve) => dev.on("exit", (code) => resolve(code)));

  const until = Date.now() + 180_000;
  while (!log.includes("char.pub is running")) {
    if (dev.exitCode !== null || Date.now() > until) {
      process.stdout.write(log);
      throw new Error("pnpm dev did not become ready");
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  try {
    check("web", (await status(`${WEB}/`)) === 200, `GET ${WEB}/`);
    check(
      "api via web proxy",
      (await status(`${WEB}/v1/search?q=x`)) === 200,
      "GET /v1/search?q=x",
    );
    check("anonymous /v1/me", (await status(`${WEB}/v1/me`)) === 401, "GET /v1/me → 401");
    check(
      "worker health",
      (await status(`http://127.0.0.1:${WORKER_PORT}/healthz`)) === 200,
      `GET 127.0.0.1:${WORKER_PORT}/healthz`,
    );
    const login = execFileSync("pnpm", ["--silent", "dev:login", "smoke"], {
      cwd: ROOT,
      env: { ...process.env, DEV_API_PORT: String(API_PORT) },
    }).toString();
    check("dev:login", login.includes("session works"), login.split("\n")[0] ?? "");
  } finally {
    dev.kill("SIGINT");
  }
  const code = await Promise.race([
    exited,
    new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 15_000)),
  ]);
  check("clean shutdown", code === 0, `dev exited with ${code}`);
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
