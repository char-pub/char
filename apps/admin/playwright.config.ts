import { defineConfig, devices } from "@playwright/test";

/**
 * 端到端测试：用内置 mock API 构建静态站点，`vite preview` 起在本地，浏览器按各员工角色
 * 走查每个模块。真实的 admin-api 在 Cloudflare Access 后面，这里不连接。
 *
 * 端口默认 4174，可以用 `ADMIN_E2E_PORT` 覆盖（多个工作区同时跑测试时避免冲突）。
 */
const port = Number(process.env.ADMIN_E2E_PORT ?? 4174);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm build && pnpm exec vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    env: { VITE_ADMIN_MOCK: "1" },
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
