/**
 * 全局框架：顶栏（导航、搜索、登录对话框）、移动端菜单、主题、全站只读提示、404、页脚。
 */
import { expect, test } from "@playwright/test";
import { ME, mockApi, problem } from "./mock-api";

const ORIGIN = "http://127.0.0.1:4173";

async function signedOut(page: Parameters<typeof mockApi>[0]) {
  const api = await mockApi(page, ORIGIN);
  api.on("GET /v1/me", problem(401, "auth.required"));
  api.on("GET /v1/guests/me", problem(401, "auth.required"));
  return api;
}

test("the header searches the registry and highlights the current section", async ({ page }) => {
  const api = await signedOut(page);
  api.on("GET /v1/search", { body: { items: [], next_cursor: null } });
  await page.goto("/");
  const search = page.getByRole("searchbox", { name: "Search the registry" });
  await expect(search).toBeVisible();
  // `/` 聚焦搜索框（焦点在输入框里时 `/` 是正常输入）。
  await page.keyboard.press("/");
  await expect(search).toBeFocused();
  await search.fill("alice");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/browse\?q=alice$/);
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Explore" })).toHaveAttribute("aria-current", "page");
  expect(api.calls.some((c) => c.path === "/v1/search")).toBe(true);
});

test("signing in happens in a dialog that explains an unavailable provider", async ({ page }) => {
  await signedOut(page);
  await page.goto("/");
  await page.getByRole("banner").getByRole("button", { name: "Sign in" }).click();
  const dialog = page.getByRole("dialog", { name: "Sign in to char.pub" });
  await expect(dialog.getByRole("button", { name: "Continue with Discord" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  // 假 API 没有配置任何登录方式，Better Auth 返回 404。
  await dialog.getByRole("button", { name: "Continue with GitHub" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "GitHub sign-in is not available on this server yet.",
  );
});

test("a signed-in user gets the account menu", async ({ page }) => {
  const api = await mockApi(page, ORIGIN);
  api.on("GET /v1/me", { body: ME });
  await page.goto("/");
  await page.getByRole("button", { name: "Account menu for Test Writer" }).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "API tokens" })).toHaveAttribute(
    "href",
    "/settings#tokens",
  );
  await expect(menu.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  // 已登录时不查询访客会话。
  expect(api.calls.some((c) => c.path === "/v1/guests/me")).toBe(false);
});

test("the mobile menu switches the theme, and the theme applies before the app loads", async ({
  page,
}) => {
  await signedOut(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("banner").getByRole("button", { name: "Sign in" })).toBeHidden();
  await page.getByRole("button", { name: "Open menu" }).click();
  const menu = page.getByRole("dialog", { name: "Menu" });
  await expect(menu.getByRole("link", { name: "Import a card" })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Continue with GitHub" })).toBeVisible();
  await menu.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);

  // 不加载应用脚本，只靠 <head> 里的 theme-init.js：深色在首屏就已经生效。
  await page.route(/\/assets\/index-[^/]+\.js$/, (route) => route.abort());
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute(
    "content",
    "#171B22",
  );
});

test("a site-wide read-only error shows the maintenance banner", async ({ page }) => {
  const api = await mockApi(page, ORIGIN);
  api.on("GET /v1/me", {
    body: {
      ...ME,
      settings: {
        show_mature: true,
        mature_confirmed_at: "2026-09-23T08:00:00.000Z",
        locale: null,
      },
    },
  });
  api.on("GET /v1/me/tokens", { body: { items: [] } });
  api.on("PUT /v1/me/settings", problem(503, "feature.read_only"));
  await page.goto("/settings");
  await expect(page.getByText(/read-only for maintenance/)).toBeHidden();
  await page.getByRole("switch", { name: "Show mature and explicit creations" }).click();
  await expect(page.getByText(/read-only for maintenance/)).toBeVisible();
});

test("unknown addresses get the shared 404 and the footer leads to the policy page", async ({
  page,
}) => {
  await signedOut(page);
  await page.goto("/no/such/page");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(
    page.getByRole("main").getByRole("link", { name: "Explore the registry" }),
  ).toBeVisible();
  await page.getByRole("contentinfo").getByRole("link", { name: "Report content" }).click();
  await expect(page).toHaveURL(/\/policy#report$/);
  await expect(page.getByRole("heading", { name: "Report content" })).toBeVisible();
});
