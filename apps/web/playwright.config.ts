import { defineConfig, devices } from "@playwright/test";

/** 冒烟测试：构建后的静态站点用 `vite preview` 起在本地，浏览器打开关键页面。 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm build && pnpm preview --host 127.0.0.1",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Cloudflare 公开文档中的 Turnstile 测试 site key（总是通过）；测试里的脚本本身也被替身替换。
    env: { VITE_TURNSTILE_SITE_KEY: "1x00000000000000000000AA" },
  },
});
