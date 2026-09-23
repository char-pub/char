import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("kill switch page lists the flags from the (mock) admin api", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto("/flags");
  await expect(page.getByRole("heading", { name: "Kill switches" })).toBeVisible();
  await expect(page.getByTestId("staff-email")).toHaveText("owner@char.pub");
  await expect(page.getByText("Every action is recorded in the audit log.")).toBeVisible();
  const table = page.getByRole("table");
  await expect(table.getByText("Read-only mode")).toBeVisible();
  await expect(table.getByRole("row")).toHaveCount(8);

  await page.getByTestId("flag-uploads").getByRole("button", { name: "Switch off" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/within 5 seconds/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: /switch off uploads/i })).toBeDisabled();

  expect(errors).toEqual([]);
});

/**
 * `vite preview` 不读取 `_headers`，这里把生产 CSP 加到 HTML 响应上，确认页面在这套更严的
 * 策略下能正常运行（没有 inline script、eval 或 inline style）。
 */
test("the production CSP from _headers is not violated", async ({ page }) => {
  const headers = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");
  const csp = /Content-Security-Policy:\s*(.+)/.exec(headers)?.[1]?.trim();
  expect(csp).toBeTruthy();
  await page.route("**/*", async (route) => {
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
  await page.goto("/audit");
  await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
  await page.getByRole("button", { name: "Show changes of entry 3" }).click();
  await expect(page.getByRole("table", { name: "Field changes" })).toBeVisible();
  await page.goto("/tombstone");
  await expect(page.getByRole("heading", { name: "Tombstone" })).toBeVisible();
  // 对话框（Radix）在这套策略下也要正常工作。
  await page.goto("/flags");
  await page.getByTestId("flag-uploads").getByRole("button", { name: "Switch off" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(violations).toEqual([]);
});
