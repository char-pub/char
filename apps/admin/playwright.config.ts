import { defineConfig, devices } from "@playwright/test";

/**
 * 冒烟测试：用内置 mock API 构建静态站点，`vite preview` 起在本地，浏览器打开关键页面。
 * 真实的 admin-api 在 Cloudflare Access 后面，这里不连接。
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:4174",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm build && pnpm preview --host 127.0.0.1",
    env: { VITE_ADMIN_MOCK: "1" },
    url: "http://127.0.0.1:4174",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
