/**
 * 浏览、作品页与账号设置（mock API）。作品页用的 Context IR 由 web 自带的示例作品现场
 * 解析得到，和真实 Release 的 IR 是同一种结构：Alice 依赖一个 World 与一个 Lorebook，
 * World 2.0.0 把评级提升为 mature。
 *
 * 覆盖：默认隐藏 mature 且开启需要确认 18+；作品页说明 effective rating 的来源、列出依赖
 * （锁定到 Release）、被谁依赖、署名与许可；设置页保存成人内容开关。
 */
import { expect, test } from "@playwright/test";
import { diffPair, releases, resolveSample } from "../src/fixtures/samples";
import { creationDetail, ME, mockApi } from "./mock-api";

const ORIGIN = "http://127.0.0.1:4173";
const BASE = "/v1/creations/@djj/alice";
const IR_V1 = resolveSample(diffPair.from).ir;
const IR_V2 = resolveSample(diffPair.to).ir;

function release(label: string, rating: string, n: number) {
  return {
    id: `rel_01j0000000000000000000000${n}`,
    label,
    visibility: "public",
    status: "active",
    semantic_digest: `sha256:${String(n).repeat(64)}`,
    effective_rating: rating,
    created_at: `2026-09-2${n}T12:00:00.000Z`,
  };
}

const RELEASES = [release("1.2.0", "mature", 2), release("1.1.0", "teen", 1)];

function alice(over: Record<string, unknown> = {}) {
  return creationDetail({
    ref: "@djj/alice",
    display_name: "Alice",
    rating: "general",
    effective_rating: "mature",
    releases: RELEASES,
    latest_release: RELEASES[0],
    dependents_count: 1,
    ...over,
  });
}

function releaseDetail(label: string) {
  const r = RELEASES.find((x) => x.label === label) ?? RELEASES[0];
  return {
    ...r,
    ref: "@djj/alice",
    creation: "cr_01j00000000000000000000000",
    lock_digest: `sha256:${"c".repeat(64)}`,
    context_ir_digest: `sha256:${"d".repeat(64)}`,
    license_check: "pass",
    availability: "complete",
  };
}

const SEARCH_ITEM = {
  id: "cr_01j00000000000000000000000",
  ref: "@djj/alice",
  type: "character",
  display_name: "Alice",
  summary: "A courier in Night City.",
  rating: "general",
  effective_rating: "teen",
  tags: ["cyberpunk"],
};

/** 公共 IR 由 API 重定向到 CDN；测试里直接在 API 地址上返回 IR 本身。 */
type Me = Omit<typeof ME, "settings"> & {
  settings: { show_mature: boolean; mature_confirmed_at: string | null; locale: null };
};

async function withCreation(page: import("@playwright/test").Page, me: Me | null) {
  const api = await mockApi(page, ORIGIN);
  api.on("GET /v1/me", me ? { body: me } : { status: 401, body: { code: "auth.required" } });
  api.on(`GET ${BASE}`, { body: alice() });
  api.on(`GET ${BASE}/releases/*`, (_req, url) => ({
    body: releaseDetail(url.pathname.split("/").pop() ?? ""),
  }));
  api.on(`GET ${BASE}/releases/1.2.0/ir`, { body: IR_V2 });
  api.on(`GET ${BASE}/releases/1.1.0/ir`, { body: IR_V1 });
  api.on(`GET ${BASE}/dependents`, {
    body: {
      items: [
        {
          ref: "@other/heist",
          type: "character",
          display_name: "The Heist",
          release: { id: "rel_01j00000000000000000000009", label: "0.3.0" },
          mode: "default",
          rel: "knows",
        },
      ],
      next_cursor: null,
    },
  });
  return api;
}

test("browse hides mature content by default and says how to change it", async ({ page }) => {
  const api = await mockApi(page, ORIGIN);
  api.on("GET /v1/me", { body: ME });
  api.on("GET /v1/search", { body: { items: [SEARCH_ITEM], next_cursor: null } });

  await page.goto("/browse?q=alice");
  await expect(page.getByText("Mature and explicit creations are hidden.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Change in settings" })).toHaveAttribute(
    "href",
    "/settings",
  );
  const results = page.getByRole("list", { name: "Search results" });
  await expect(results.getByRole("link", { name: "Alice" })).toBeVisible();
  await expect(results.getByText("Teen")).toBeVisible();
  // 过滤由服务端执行：请求里带着查询词，页面不自行放行 mature 结果。
  expect(api.calls.some((c) => c.path === "/v1/search")).toBe(true);
});

test("turning mature content on needs the 18+ confirmation and is saved on the server", async ({
  page,
}) => {
  const api = await mockApi(page, ORIGIN);
  let settings: { show_mature: boolean; mature_confirmed_at: string | null; locale: null } = {
    ...ME.settings,
  };
  api.on("GET /v1/me", () => ({ body: { ...ME, settings } }));
  api.on("GET /v1/me/tokens", { body: { items: [] } });
  api.on("PUT /v1/me/settings", (req) => {
    const body = req.postDataJSON() as { show_mature: boolean; confirm_adult?: boolean };
    settings = {
      ...settings,
      show_mature: body.show_mature,
      mature_confirmed_at: body.show_mature ? "2026-09-23T08:00:00.000Z" : null,
    };
    return { body: { ...ME, settings } };
  });

  await page.goto("/settings");
  const toggle = page.getByRole("switch", { name: "Show mature and explicit creations" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(
    page.getByRole("alertdialog", { name: "Show mature and explicit creations?" }),
  ).toBeVisible();
  const confirm = page.getByRole("button", { name: "Show mature content" });
  await expect(confirm).toBeDisabled();
  await page.getByLabel("I am 18 or older").check();
  await confirm.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText(/On since .+ you confirmed you're 18 or older/)).toBeVisible();
  expect(api.calls.find((c) => c.method === "PUT")?.body).toEqual({
    show_mature: true,
    confirm_adult: true,
  });

  // 关闭不需要确认，服务端同时清除确认时间。
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  expect(api.calls.filter((c) => c.method === "PUT").at(-1)?.body).toEqual({ show_mature: false });
});

test("the creation page explains its rating, dependencies, dependents and credits", async ({
  page,
}) => {
  const api = await withCreation(page, null);
  // 依赖的版本号从它们各自的作品详情里查到。
  api.on("GET /v1/creations/@cyberpunk/night-city", {
    body: creationDetail({
      ref: "@cyberpunk/night-city",
      type: "world",
      display_name: "Night City",
      releases: [{ ...release("2.0.0", "mature", 5), id: releases.nightCityV2.release }],
    }),
  });
  await page.goto("/c/djj/alice");
  await expect(page.getByRole("heading", { name: "Alice", level: 1 })).toBeVisible();
  // 头部：`@ns/name@label`、类型、评级、许可；标签页里 Overview 是当前页。
  const main = page.getByRole("main");
  await expect(main.getByText("@djj/alice@1.2.0", { exact: true })).toBeVisible();
  await expect(main.locator("header").getByText("Character")).toBeVisible();
  await expect(main.locator("header").getByText("CC-BY-4.0")).toBeVisible();
  const tabs = page.getByRole("navigation", { name: "Creation sections" });
  await expect(tabs.getByRole("link", { name: "Overview" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(tabs.getByRole("link", { name: /Versions/ })).toContainText("2");
  // 不是所有者：没有 Edit 和 Settings。
  await expect(main.getByRole("link", { name: "Edit" })).toHaveCount(0);
  await expect(tabs.getByRole("link", { name: "Settings" })).toHaveCount(0);

  // effective rating 来自依赖：说明哪个来源决定了评级。
  const why = page.getByRole("region", { name: "Why this rating" });
  await expect(why.getByText("Mature", { exact: true }).first()).toBeVisible();
  await expect(why.getByText(/because a dependency is rated Mature/)).toBeVisible();
  await expect(
    why.getByRole("listitem").filter({ hasText: "sets the rating" }).first(),
  ).toContainText("@cyberpunk/night-city");

  // 依赖：关系文案、Core / Recommended、锁定的版本（查不到版本号时显示 Release ID）。
  const deps = page.getByRole("region", { name: "Built on" });
  const night = deps.getByRole("listitem").filter({ hasText: "Lives in Night City" });
  await expect(night).toContainText("@cyberpunk/night-city@2.0.0");
  await expect(night.getByText("Core", { exact: true })).toBeVisible();
  const corps = deps.getByRole("listitem").filter({ hasText: "Knows about" });
  await expect(corps.getByText("Recommended")).toBeVisible();
  await expect(corps.getByText(/locked to rel_/)).toBeVisible();

  // 反向依赖。
  const used = page.getByRole("region", { name: "Used by" });
  await expect(used.getByRole("link", { name: "The Heist" })).toBeVisible();
  await expect(used.getByText("@other/heist@0.3.0")).toBeVisible();

  // 署名与许可：自身与每个依赖。
  const credits = page.getByRole("region", { name: "Credits & licenses" });
  await expect(credits.getByText("Cyberpunk Commons").first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Release 1.2.0" })).toContainText("Public");

  // mature 内容默认被遮挡，说明评级来源；确认后才显示。
  const gate = page.getByRole("heading", { name: "Mature content is hidden" });
  await expect(gate).toBeVisible();
  await expect(
    main.getByText("Rated Mature because of @cyberpunk/night-city (World)."),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "What it says" })).toHaveCount(0);
  await page.getByRole("button", { name: "Show this once" }).click();
  await expect(page.getByRole("region", { name: /What it says/ })).toBeVisible();

  // “Show this once”在这个会话里对这个作品一直有效：切换标签、刷新都不再遮挡。
  await tabs.getByRole("link", { name: "Context preview" }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(gate).toHaveCount(0);
});

test("switching tabs keeps the version, and yanked and removed versions say so", async ({
  page,
}) => {
  const api = await withCreation(page, {
    ...ME,
    settings: { show_mature: true, mature_confirmed_at: "2026-09-23T08:00:00.000Z", locale: null },
  });
  api.on(`GET ${BASE}`, {
    body: alice({
      releases: [
        RELEASES[0],
        { ...RELEASES[1], status: "yanked", status_reason: "Broken greeting placeholder" },
        { ...release("1.0.0", "general", 0), status: "tombstoned", status_reason: "legal.dmca" },
      ],
    }),
  });
  await page.goto("/c/djj/alice?v=1.1.0");
  await expect(page.getByRole("main").getByText("@djj/alice@1.1.0", { exact: true })).toBeVisible();
  const notice = page.getByRole("note").filter({ hasText: "was yanked" });
  await expect(notice).toContainText("Version 1.1.0 was yanked: “Broken greeting placeholder”");
  // yank 之后内容仍然可用。
  await expect(page.getByRole("region", { name: /What it says/ })).toBeVisible();

  const tabs = page.getByRole("navigation", { name: "Creation sections" });
  await tabs.getByRole("link", { name: "Context preview" }).click();
  await expect(page).toHaveURL(/\/c\/djj\/alice\/preview\?v=1\.1\.0$/);
  await tabs.getByRole("link", { name: "Overview" }).click();
  await expect(page).toHaveURL(/\/c\/djj\/alice\?v=1\.1\.0$/);

  // 已移除的版本：410，只显示公开的原因代码，并引导去看其他版本。
  await page.goto("/c/djj/alice?v=1.0.0");
  await expect(
    page.getByRole("heading", {
      name: /Version 1.0.0 was removed after a copyright \(DMCA\) notice/,
    }),
  ).toBeVisible();
  await expect(page.getByText("legal.dmca")).toBeVisible();
  await page.getByRole("link", { name: "See other versions" }).click();
  await expect(page).toHaveURL(/\/c\/djj\/alice\/versions/);
});

test("a creation that doesn't exist or is private gets the shared 404", async ({ page }) => {
  const api = await mockApi(page, ORIGIN);
  api.on("GET /v1/me", { status: 401, body: { code: "auth.required" } });
  await page.goto("/c/djj/secret");
  await expect(page.getByRole("heading", { name: "Nothing at @djj/secret" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Creation sections" })).toHaveCount(0);
});

test("on a phone the header stacks and the tabs scroll sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await withCreation(page, null);
  await page.goto("/c/djj/alice");
  const download = page.getByRole("button", { name: "Download" });
  await expect(download).toBeVisible();
  const box = await download.boundingBox();
  const heading = await page.getByRole("heading", { name: "Alice", level: 1 }).boundingBox();
  // 主操作在标题下方，不和标题挤在同一行。
  expect(box && heading && box.y > heading.y + heading.height).toBe(true);
  const tabs = page.getByRole("navigation", { name: "Creation sections" });
  const scroll = await tabs.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(scroll).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= 390)).toBe(true);
});

test("an account that turned mature content on sees it without the gate", async ({ page }) => {
  await withCreation(page, {
    ...ME,
    settings: { show_mature: true, mature_confirmed_at: "2026-09-23T08:00:00.000Z", locale: null },
  });
  await page.goto("/c/djj/alice");
  await expect(page.getByRole("region", { name: "What it says" })).toBeVisible();
  await expect(page.getByText("Mature content is hidden")).toHaveCount(0);
});
