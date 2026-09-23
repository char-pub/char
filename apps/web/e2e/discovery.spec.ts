/**
 * 发现类页面（mock API）：首页的最近发布、探索页的筛选、作者主页。
 *
 * 覆盖：首页用不带关键词的搜索取最近发布的作品；探索页的类型、tag 和关键词都写在地址里并
 * 原样发给搜索接口；作者主页先解析 namespace（旧名换成新名），再按当前名字搜索，按类型筛选
 * 由服务端完成；不存在的 namespace 显示统一的 404。
 */
import { expect, type Page, test } from "@playwright/test";
import { mockApi, problem } from "./mock-api";

const ORIGIN = "http://127.0.0.1:4173";

function item(n: number, ref: string, name: string, type: string, tags: string[] = []) {
  return {
    id: `cr_01j000000000000000000000${n}`,
    ref,
    type,
    display_name: name,
    summary: `${name}, published on char.pub.`,
    rating: "general",
    effective_rating: "general",
    tags,
  };
}

const ALICE = item(1, "@cyberpunk/alice", "Alice", "character", ["cyberpunk", "noir"]);
const NIGHT_CITY = item(2, "@cyberpunk/night-city", "Night City", "world", ["cyberpunk"]);
const CORPS = item(3, "@cyberpunk/corps", "Corps of Night City", "lorebook", ["cyberpunk"]);

async function signedOut(page: Page) {
  const api = await mockApi(page, ORIGIN);
  api.on("GET /v1/me", problem(401, "auth.required"));
  api.on("GET /v1/guests/me", problem(401, "auth.required"));
  return api;
}

/** 记录每次搜索的查询参数，按 type 过滤返回的结果。 */
function searchLog(api: Awaited<ReturnType<typeof mockApi>>, items = [ALICE, NIGHT_CITY, CORPS]) {
  const queries: URLSearchParams[] = [];
  api.on("GET /v1/search", (_req, url) => {
    queries.push(url.searchParams);
    const type = url.searchParams.get("type");
    const tag = url.searchParams.get("tag");
    return {
      body: {
        items: items.filter((i) => (!type || i.type === type) && (!tag || i.tags.includes(tag))),
        next_cursor: null,
      },
    };
  });
  return queries;
}

test("the home page shows the latest releases from the registry", async ({ page }) => {
  const api = await signedOut(page);
  const queries = searchLog(api);
  await page.goto("/");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText(
    "Open characters.Shared worlds.",
  );
  const recent = main.getByRole("list", { name: "Recently published" });
  await expect(recent.getByRole("link", { name: "Night City", exact: true })).toHaveAttribute(
    "href",
    "/c/cyberpunk/night-city",
  );
  // 不带关键词：服务端按发布时间倒序返回。
  expect(queries.map((q) => q.toString())).toEqual(["limit=8"]);
  await expect(main.getByRole("link", { name: /Have a character card\?/ })).toHaveAttribute(
    "href",
    "/create/import",
  );
});

test("explore keeps the query, type and tag in the address", async ({ page }) => {
  const api = await signedOut(page);
  const queries = searchLog(api);
  await page.goto("/browse");
  const main = page.getByRole("main");
  await expect(main.getByText("3 results", { exact: true })).toBeVisible();
  await expect(main.getByText("Mature and explicit creations are hidden.")).toBeVisible();
  await expect(main.getByRole("button", { name: "Sign in to turn them on" })).toBeVisible();

  await main.getByRole("button", { name: "Worlds" }).click();
  await expect(page).toHaveURL(/\/browse\?type=world$/);
  await expect(main.getByRole("button", { name: "Worlds" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(main.getByText("1 result", { exact: true })).toBeVisible();
  await expect.poll(() => queries.at(-1)?.get("type")).toBe("world");

  await main
    .getByRole("group", { name: "Filter by tag" })
    .getByRole("button", { name: "cyberpunk" })
    .click();
  await expect(page).toHaveURL(/tag=cyberpunk/);
  await expect(main.getByText("1 result tagged “cyberpunk”")).toBeVisible();

  const box = main.getByRole("searchbox", { name: "Search creations" });
  await box.fill("night");
  await box.press("Enter");
  await expect(page).toHaveURL(/q=night/);
  await expect.poll(() => queries.at(-1)?.get("q")).toBe("night");
  expect(queries.at(-1)?.get("tag")).toBe("cyberpunk");

  await main.getByRole("button", { name: "Remove the tag filter “cyberpunk”" }).click();
  await expect(page).not.toHaveURL(/tag=/);
});

test("explore explains an empty result and clears the filters", async ({ page }) => {
  const api = await signedOut(page);
  searchLog(api, []);
  await page.goto("/browse?q=netrunner%20monk&type=lorebook");
  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", { name: "No results for “netrunner monk”" }),
  ).toBeVisible();
  await main.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/browse$/);
  await expect(main.getByRole("heading", { name: "Nothing published yet" })).toBeVisible();
});

test("an author page follows a rename and filters by type on the server", async ({ page }) => {
  const api = await signedOut(page);
  const queries = searchLog(api);
  // 服务端把旧名 301 到新名，浏览器跟随重定向后拿到的是新名字的 namespace。
  api.on("GET /v1/namespaces/old-cyberpunk", {
    body: { slug: "cyberpunk", kind: "user", status: "active" },
  });
  api.on("GET /v1/namespaces/cyberpunk", {
    body: { slug: "cyberpunk", kind: "user", status: "active" },
  });

  await page.goto("/c/old-cyberpunk");
  await expect(page).toHaveURL(/\/c\/cyberpunk$/);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "@cyberpunk" })).toBeVisible();
  await expect(main.getByText("Personal namespace · 3 public creations")).toBeVisible();
  await expect(main.getByRole("list", { name: "Creations by type" })).toContainText("1Character");
  const list = main.getByRole("list", { name: "Creations by @cyberpunk" });
  await expect(list.getByRole("article")).toHaveCount(3);
  expect(queries.every((q) => q.get("ns") === "cyberpunk")).toBe(true);

  await main
    .getByRole("navigation", { name: "Filter by type" })
    .getByRole("link", { name: "Worlds" })
    .click();
  await expect(page).toHaveURL(/\/c\/cyberpunk\?type=world$/);
  await expect(list.getByRole("article")).toHaveCount(1);
  await expect(list.getByRole("link", { name: "Night City", exact: true })).toBeVisible();
  await expect.poll(() => queries.at(-1)?.get("type")).toBe("world");
});

test("an unknown namespace gets the shared 404", async ({ page }) => {
  const api = await signedOut(page);
  api.on("GET /v1/namespaces/nobody", problem(404, "not_found"));
  await page.goto("/c/nobody");
  await expect(page.getByRole("heading", { name: "Nothing at @nobody" })).toBeVisible();
  expect(api.calls.some((c) => c.path === "/v1/search")).toBe(false);
});
