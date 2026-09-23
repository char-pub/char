/**
 * 账户页面（mock API）：我的作品列表按状态说明每个作品（未发布、公开、私有、被 yank），
 * 还没有 namespace 的账号先去注册；设置页的分区导航、Token 只显示一次和吊销前确认。
 */
import { expect, test } from "@playwright/test";
import { ME, mockApi } from "./mock-api";

const ORIGIN = "http://127.0.0.1:4173";

function mine(name: string, over: Record<string, unknown> = {}) {
  return {
    ref: `@writer/${name}`,
    type: "character",
    display_name: name[0]?.toUpperCase() + name.slice(1),
    status: "active",
    latest_release: { label: "1.2.0", visibility: "public", status: "active" },
    draft_updated_at: "2026-08-30T12:00:00.000Z",
    ...over,
  };
}

test("my creations shows each creation's state and where to go next", async ({ page }) => {
  const api = await mockApi(page, ORIGIN);
  api.on("GET /v1/me", { body: ME });
  api.on("GET /v1/me/creations", {
    body: {
      items: [
        mine("alice"),
        mine("rin", { latest_release: null }),
        mine("watson", {
          type: "lorebook",
          latest_release: { label: "0.2.0", visibility: "private", status: "active" },
        }),
        mine("radio", {
          latest_release: { label: "1.0.1", visibility: "public", status: "yanked" },
        }),
      ],
    },
  });
  await page.goto("/me");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "My creations" })).toBeVisible();
  await expect(main.getByText("@writer · 4 creations")).toBeVisible();
  await expect(main.getByRole("link", { name: "Import a card" })).toHaveAttribute(
    "href",
    "/create/import",
  );
  const rows = main.getByRole("row");
  await expect(rows).toHaveCount(5);
  const table = main.getByRole("table");
  await expect(table.getByRole("cell", { name: "Public · v1.2.0" })).toBeVisible();
  await expect(table.getByRole("cell", { name: "Draft · not published" })).toBeVisible();
  await expect(table.getByRole("cell", { name: "Private · v0.2.0" })).toBeVisible();
  await expect(table.getByRole("cell", { name: "Public · v1.0.1 · yanked" })).toBeVisible();
  await expect(main.getByRole("link", { name: "Edit Alice" })).toHaveAttribute(
    "href",
    "/c/writer/alice/edit",
  );
  // 没有发布过的作品没有“查看”菜单。
  await expect(main.getByRole("button", { name: "More for Rin" })).toHaveCount(0);
  await main.getByRole("button", { name: "More for Alice" }).click();
  await expect(page.getByRole("menuitem", { name: "View" })).toHaveAttribute(
    "href",
    "/c/writer/alice",
  );
});

test("an account without a namespace is sent to choose one first", async ({ page }) => {
  const api = await mockApi(page, ORIGIN);
  api.on("GET /v1/me", { body: { ...ME, namespace: null } });
  await page.goto("/me");
  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", { name: "First, choose your name on char.pub" }),
  ).toBeVisible();
  await expect(main.getByRole("link", { name: "Choose your @name" })).toHaveAttribute(
    "href",
    "/create",
  );
  expect(api.calls.some((c) => c.path === "/v1/me/creations")).toBe(false);
});

test("an empty list offers to create or import", async ({ page }) => {
  const api = await mockApi(page, ORIGIN);
  api.on("GET /v1/me", { body: ME });
  api.on("GET /v1/me/creations", { body: { items: [] } });
  await page.goto("/me");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "No creations yet" })).toBeVisible();
  await expect(main.getByRole("link", { name: "New creation" })).toHaveCount(2);
});

test("settings: sections, the namespace and API tokens shown once", async ({ page }) => {
  const api = await mockApi(page, ORIGIN);
  api.on("GET /v1/me", { body: ME });
  let tokens: unknown[] = [];
  api.on("GET /v1/me/tokens", () => ({ body: { items: tokens } }));
  api.on("POST /v1/me/tokens", () => {
    tokens = [
      {
        id: "pat_01j00000000000000000000000",
        name: "laptop cli",
        prefix: "cp_pat_7Hq2",
        scopes: ["creations:read"],
        expires_at: "2026-12-22T12:00:00.000Z",
        last_used_at: null,
        created_at: "2026-09-23T12:00:00.000Z",
      },
    ];
    return {
      status: 201,
      body: {
        id: "pat_01j00000000000000000000000",
        token: `cp_pat_${"a".repeat(43)}`,
        prefix: "cp_pat_7Hq2",
        expires_at: "2026-12-22T12:00:00.000Z",
      },
    };
  });
  api.on("DELETE /v1/me/tokens/pat_01j00000000000000000000000", () => {
    tokens = [];
    return { status: 204 };
  });

  await page.goto("/settings");
  const nav = page.getByRole("navigation", { name: "Settings sections" });
  await expect(nav.getByRole("link", { name: "Profile" })).toHaveAttribute(
    "aria-current",
    "location",
  );
  await nav.getByRole("link", { name: "API tokens" }).click();
  await expect(page).toHaveURL(/#tokens$/);
  await expect(nav.getByRole("link", { name: "API tokens" })).toHaveAttribute(
    "aria-current",
    "location",
  );
  const profile = page.getByRole("region", { name: "Profile" });
  await expect(profile.getByText("@writer", { exact: true })).toBeVisible();
  await expect(profile.getByRole("button", { name: "Rename…" })).toBeVisible();
  // 登录方式和数据导出还没有接口：只有说明，没有按钮。
  await expect(page.getByRole("region", { name: "Your data" }).getByRole("button")).toHaveCount(0);

  const section = page.getByRole("region", { name: "API tokens" });
  await section.getByRole("button", { name: "Create a token" }).click();
  await page.getByLabel("Token name").fill("laptop cli");
  await page.getByRole("button", { name: "Create token" }).click();
  const created = page.getByRole("dialog", { name: "Token created" });
  await expect(created.getByText(`cp_pat_${"a".repeat(43)}`)).toBeVisible();
  await created.getByRole("button", { name: "I've saved it" }).click();
  await expect(page.getByText(`cp_pat_${"a".repeat(43)}`)).toHaveCount(0);
  await expect(section.getByText("cp_pat_7Hq2…")).toBeVisible();

  await section.getByRole("button", { name: "Revoke laptop cli" }).click();
  await page
    .getByRole("alertdialog", { name: "Revoke laptop cli?" })
    .getByRole("button", { name: "Revoke token" })
    .click();
  await expect(section.getByText("You have no active tokens")).toBeVisible();
  expect(api.calls.some((c) => c.method === "DELETE")).toBe(true);
});
