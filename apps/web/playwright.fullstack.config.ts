import { defineConfig, devices } from "@playwright/test";

/**
 * 完整本地环境上的端到端测试（`pnpm e2e:fullstack`）：docker compose 的 Postgres 与
 * MinIO、编译后的 API 与 worker，再加上构建好的 web 站点。web 通过 `vite preview` 的
 * 代理把 `/v1` 转发给 API，页面与 API 同源。需要本机有 Docker。
 */
const WEB_PORT = 4174;
const API_PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /fullstack(-[a-z0-9-]+)?\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 120_000,
  globalSetup: "./e2e/fullstack/stack.ts",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm build && pnpm preview --host localhost --port ${WEB_PORT}`,
    url: `http://localhost:${WEB_PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { VITE_API_BASE_URL: "", API_PROXY: `http://127.0.0.1:${API_PORT}`, E2E_FULLSTACK: "1" },
  },
});
