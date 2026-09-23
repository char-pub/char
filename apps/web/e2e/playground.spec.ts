import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

/** 生产构建默认连接的 API；冒烟测试里没有它。 */
const API = "https://api.char.pub";

test("playground shows the assembly trace for a sample creation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    // 冒烟测试不启动 API：顶栏读取登录状态的请求失败是预期的。
    if (m.type() === "error" && !m.location().url.startsWith(API)) errors.push(m.text());
  });
  await page.route(`${API}/**`, (route) => route.abort());

  await page.goto("/playground");
  await expect(page.getByRole("heading", { name: "Context playground" })).toBeVisible();

  const table = page.getByRole("table");
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Decision" })).toBeVisible();
  await expect(page.getByTestId("trace-summary")).toContainText("tokenizer: estimate");

  await page.getByText("Character + world + lorebook").click();
  await expect(table.getByText("keyword:Arasaka")).toBeVisible();

  expect(errors).toEqual([]);
});

test("diff page highlights rating and license changes", async ({ page }) => {
  await page.goto("/playground/diff");
  await expect(page.getByText("rating changed", { exact: true })).toBeVisible();
  await expect(page.getByText("license changed", { exact: true })).toBeVisible();
});

/**
 * `vite preview` 不读取 `_headers`，这里把生产 CSP 加到 HTML 响应上，确认页面在这套
 * 策略下能正常运行、没有任何违规（例如 inline script 或 eval）。
 */
test("the production CSP from _headers is not violated", async ({ page }) => {
  const headers = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");
  const csp = /Content-Security-Policy:\s*(.+)/.exec(headers)?.[1]?.trim();
  expect(csp).toBeTruthy();
  await page.route("**/*", async (route) => {
    if (route.request().url().startsWith(API)) return route.abort();
    const response = await route.fetch();
    const type = response.headers()["content-type"] ?? "";
    if (!type.includes("text/html")) return route.fulfill({ response });
    // 本地是 http，去掉 upgrade-insecure-requests，否则浏览器会把资源请求升级成 https。
    const policy = (csp ?? "").replace(/;\s*upgrade-insecure-requests/, "");
    return route.fulfill({
      response,
      headers: { ...response.headers(), "content-security-policy": policy },
    });
  });
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  const res = await page.goto("/playground");
  expect(res?.headers()["content-security-policy"]).toContain("script-src 'self'");
  await expect(page.getByRole("table")).toBeVisible();
  // 确认策略确实生效：插入一段 inline script，它必须被拒绝执行。
  // （page.evaluate 通过调试协议执行，不受 CSP 约束，不能用来验证。）
  const inlineRan = await page.evaluate(async () => {
    const s = document.createElement("script");
    s.textContent = "window.__inlineRan = true";
    document.body.appendChild(s);
    await new Promise((r) => setTimeout(r, 50));
    return (window as unknown as { __inlineRan?: boolean }).__inlineRan === true;
  });
  expect(inlineRan).toBe(false);
  expect(violations.length).toBeGreaterThan(0);
  violations.length = 0;
  await page.getByLabel("Tokenizer").selectOption("cl100k_base");
  await expect(page.getByTestId("trace-summary")).toContainText("tokenizer: cl100k_base");
  await page.goto("/playground/diff");
  await expect(page.getByText("rating changed", { exact: true })).toBeVisible();
  expect(violations).toEqual([]);
});
