/**
 * UC-1 在浏览器里走一遍（完整本地环境）：注册 namespace → 新建角色 → 填写第一层字段并
 * 上传头像 → 发布 1.0.0 → 匿名访问作品页 → 下载 Context IR。
 *
 * 默认跳过；`pnpm e2e:fullstack` 会设置 `E2E_FULLSTACK=1` 并启动所需的全部进程。
 */
import { expect, test } from "@playwright/test";
import { tinyPng } from "./fullstack/png";
import { signInAs } from "./fullstack/session";

test.skip(!process.env.E2E_FULLSTACK, "needs the local full stack (pnpm e2e:fullstack)");

test("UC-1: create, publish and download a character in the browser", async ({
  browser,
  page,
  context,
}) => {
  const suffix = Date.now().toString(36);
  const ns = `uc1-${suffix}`;
  await signInAs(context, "Uc One");

  // 1. 第一次创作：先注册 namespace。
  await page.goto("/create");
  await expect(
    page.getByRole("heading", { name: "First, choose your name on char.pub" }),
  ).toBeVisible();
  await page.getByLabel("Namespace").fill(ns);
  await page.getByRole("button", { name: `Register @${ns}` }).click();

  // 2. 新建角色。
  await page.getByLabel("Name", { exact: true }).fill("Alice Courier");
  await expect(page.getByLabel("Address")).toHaveValue("alice-courier");
  await page.getByRole("button", { name: "Create character" }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${ns}/alice-courier/edit$`));

  // 3. 第一层字段与头像；自动保存。
  await expect(page.getByRole("heading", { name: "The basics" })).toBeVisible();
  await page
    .getByLabel("Description")
    .fill("{{self}} is a cheerful courier who knows every alley of the old town.");
  await page.getByLabel("Summary").fill("A courier who never misses a delivery.");
  await page.getByLabel("Greeting").fill("Package for {{user}}! Sign here, please.");
  await page.getByLabel("Choose an avatar image").setInputFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: tinyPng(),
  });
  await expect(page.getByRole("button", { name: "Replace" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("All changes saved")).toBeVisible({ timeout: 30_000 });

  // 4. 在发布对话框里发布 1.0.0 并查看 Publish Report。
  await page.getByRole("button", { name: "Publish…" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Version label")).toHaveValue("1.0.0");
  await dialog.getByRole("button", { name: "Publish 1.0.0" }).click();
  await expect(dialog.getByRole("heading", { name: "Published 1.0.0" })).toBeVisible({
    timeout: 90_000,
  });
  await expect(dialog.getByRole("region", { name: "Publish report" })).toBeVisible();
  await dialog.getByRole("link", { name: "View release" }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${ns}/alice-courier`));

  // 5. 匿名访问作品页。
  const anon = await browser.newContext();
  const visitor = await anon.newPage();
  await visitor.goto(`/c/${ns}/alice-courier`);
  await expect(visitor.getByRole("heading", { name: "Alice Courier" })).toBeVisible();
  await expect(visitor.getByText("Package for {{user}}! Sign here, please.")).toBeVisible();
  await expect(visitor.getByText(/cheerful courier who knows every alley/)).toBeVisible();
  // 作品头部的头像（顶栏的品牌 logo 不在 main 里）。
  await expect(visitor.locator("main header img")).toHaveCount(1);
  await expect(visitor.getByRole("heading", { name: "Why this rating" })).toBeVisible();
  await expect(
    visitor.getByRole("main").getByText(`@${ns}/alice-courier@1.0.0`, { exact: true }),
  ).toBeVisible();
  await expect(visitor.getByRole("button", { name: "Sign in" })).toBeVisible();

  // 搜索也能找到它。
  await visitor.goto("/browse?q=Alice%20Courier");
  await expect(visitor.getByRole("link", { name: "Alice Courier" })).toBeVisible();

  // 6. 下载 Context IR：API 重定向到内容寻址的公共对象。
  await visitor.goto(`/c/${ns}/alice-courier`);
  // 下载在作品头部的 Download 菜单里。
  await visitor.getByRole("main").getByRole("button", { name: "Download" }).click();
  const href = await visitor.getByRole("menuitem", { name: /Context IR/ }).getAttribute("href");
  expect(href).toBe(`/v1/creations/@${ns}/alice-courier/releases/1.0.0/ir`);
  const res = await visitor.request.get(href ?? "");
  expect(res.ok()).toBe(true);
  const ir = (await res.json()) as { root: { ref: string }; meta: { rating: string } };
  expect(ir.root.ref).toBe(`@${ns}/alice-courier`);
  expect(ir.meta.rating).toBe("general");
  await anon.close();
});
