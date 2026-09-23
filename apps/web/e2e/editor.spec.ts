/**
 * 编辑器与发布流程（mock API）。
 *
 * - 渐进式展示：第一层 “The basics” 只有头像、名字、正文、简介（角色另有问候语）；“More
 *   options” 的四个折叠区默认收起，折叠时显示一行摘要。三种类型的正文字段名不同。
 * - 贡献开放度不在编辑器里设置。
 * - 依赖：搜索 → 选中 → 选版本 → 添加，锁定到精确的 Release。
 * - 发布对话框：保存草稿 → 创建 Revision → 发布 → 轮询 Publish Report；成功时显示许可检查
 *   和警告，失败时用人话解释（菱形依赖列出两条来源路径）并能跳到 Dependencies。
 */
import { expect, type Page, test } from "@playwright/test";
import { creationDetail, ME, mockApi } from "./mock-api";

const ORIGIN = "http://127.0.0.1:4173";

type Kind = "character" | "world" | "lorebook";

const MAIN_FIELD: Record<Kind, string> = {
  character: "Description",
  world: "About this world",
  lorebook: "First entry",
};

/** 第一层正文对应的 fragment：角色是 description，世界是 world，世界书是第一个条目。 */
const MAIN_ID: Record<Kind, string> = {
  character: "description",
  world: "world",
  lorebook: "lore/entry",
};

function working(type: Kind, extra: Record<string, unknown> = {}) {
  const kind = type === "lorebook" ? "knowledge" : type;
  return {
    id: "cr_01j00000000000000000000000",
    ref: `@writer/${type}-draft`,
    type,
    display_name: `A ${type}`,
    fragments: [
      {
        id: MAIN_ID[type],
        stable: true,
        kind,
        content: { type: "text", text: `Some text about the ${type}.` },
      },
    ],
    meta: {
      default_locale: "en",
      rating: "general",
      rights: "original",
      license: "LicenseRef-All-Rights-Reserved",
      contribution_policy: "invited",
    },
    ...extra,
  };
}

async function editorFor(page: Page, type: Kind, extra: Record<string, unknown> = {}) {
  const api = await mockApi(page, ORIGIN);
  const base = `/v1/creations/@writer/${type}-draft`;
  let version = 3;
  api.on("GET /v1/me", { body: ME });
  api.on(`GET ${base}`, {
    body: creationDetail({
      ref: `@writer/${type}-draft`,
      type,
      display_name: `A ${type}`,
      releases: [],
      latest_release: undefined,
    }),
  });
  api.on(`GET ${base}/draft`, {
    body: {
      version,
      working: working(type, extra),
      base_revision_id: null,
      updated_at: "2026-09-23T08:00:00.000Z",
    },
  });
  api.on(`PUT ${base}/draft`, () => {
    version += 1;
    return {
      headers: { etag: `"${version}"` },
      body: { version, semantic_digest: `sha256:${"e".repeat(64)}`, warnings: [] },
    };
  });
  return { api, base };
}

function mockPublish(api: Awaited<ReturnType<typeof mockApi>>, base: string, report: unknown) {
  api.on(`POST ${base}/revisions`, {
    status: 201,
    body: {
      id: "rev_01j00000000000000000000001",
      semantic_digest: `sha256:${"e".repeat(64)}`,
      created_at: "2026-09-23T08:01:00.000Z",
    },
  });
  api.on(`POST ${base}/releases`, {
    status: 202,
    body: { release: "rel_01j00000000000000000000001", state: "pending", idempotent: false },
  });
  let polls = 0;
  api.on(`GET ${base}/releases/1.0.0/report`, () => {
    polls += 1;
    return {
      body:
        polls < 2
          ? {
              release: "rel_01j00000000000000000000001",
              state: "pending",
              idempotent: false,
              label: "1.0.0",
            }
          : report,
    };
  });
}

for (const type of ["character", "world", "lorebook"] as const) {
  test(`the ${type} editor shows the basics first and the rest under More options`, async ({
    page,
  }) => {
    await editorFor(page, type);
    await page.goto(`/c/writer/${type}-draft/edit`);
    await expect(page.getByRole("heading", { name: `Editing A ${type}` })).toBeVisible();
    await expect(page.getByRole("heading", { name: "The basics", exact: true })).toBeVisible();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(`A ${type}`);
    await expect(page.getByLabel("Address", { exact: true })).toHaveValue(`@writer/${type}-draft`);
    await expect(page.getByLabel(MAIN_FIELD[type])).toHaveValue(`Some text about the ${type}.`);
    await expect(page.getByText("Always sent to the model.", { exact: false })).toBeVisible();
    await expect(page.getByLabel("Summary")).toBeVisible();
    await expect(page.getByText("Not sent to the model.", { exact: false })).toBeVisible();
    await expect(page.getByLabel("Choose an avatar image")).toBeAttached();
    // 只有角色有问候语。
    await expect(page.getByLabel("Greeting")).toHaveCount(type === "character" ? 1 : 0);

    // 检查栏常驻显示。
    const checks = page.getByRole("region", { name: "Before you publish" });
    await expect(checks.getByText("Basics complete")).toBeVisible();
    await expect(page.getByRole("region", { name: "Next release" })).toContainText(
      `@writer/${type}-draft@1.0.0`,
    );

    // 高级字段默认收起，只显示一行摘要。
    await expect(page.getByRole("heading", { name: "More options" })).toBeVisible();
    const meta = page.getByRole("button", { name: "Rating, license & tags", exact: true });
    await expect(meta).toHaveAttribute("aria-expanded", "false");
    await expect(meta).toContainText("General · All rights reserved");
    await expect(page.getByLabel("Rating", { exact: true })).toHaveCount(0);

    await meta.click();
    await expect(meta).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByLabel("Rating", { exact: true })).toBeVisible();
    await expect(page.getByLabel("License", { exact: true })).toBeVisible();
    // 贡献开放度只在作品设置里改。
    await expect(page.getByText("Who can suggest changes")).toHaveCount(0);

    const passages = page.getByRole("button", { name: "Passages", exact: true });
    await expect(passages).toHaveAttribute("aria-expanded", "false");
    await passages.click();
    await expect(page.getByRole("button", { name: "Add passage" })).toBeVisible();

    const deps = page.getByRole("button", { name: "Dependencies", exact: true });
    await deps.click();
    await expect(page.getByLabel("Add a dependency")).toBeVisible();

    await page.getByRole("button", { name: "Language", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Language", exact: true })).toHaveValue("en");
  });
}

test("editing keeps the contribution policy that is already in the draft", async ({ page }) => {
  const { api, base } = await editorFor(page, "character");
  await page.goto("/c/writer/character-draft/edit");
  await page.getByLabel("Summary").fill("A courier.");
  await expect(page.getByText("All changes saved")).toBeVisible({ timeout: 10_000 });
  const put = api.calls.findLast((c) => c.method === "PUT" && c.path === `${base}/draft`);
  expect(put?.body).toMatchObject({
    working: { summary: "A courier.", meta: { contribution_policy: "invited" } },
  });
});

test("a dependency is found by search and locked to the chosen release", async ({ page }) => {
  const { api, base } = await editorFor(page, "character");
  const world = creationDetail({
    id: "cr_01j00000000000000000000009",
    ref: "@cyberpunk/night-city",
    type: "world",
    display_name: "Night City",
    releases: [
      {
        id: "rel_01j00000000000000000000092",
        label: "2.0.1",
        visibility: "public",
        status: "active",
        semantic_digest: `sha256:${"2".repeat(64)}`,
        effective_rating: "teen",
        created_at: "2026-09-20T12:00:00.000Z",
      },
      {
        id: "rel_01j00000000000000000000091",
        label: "1.9.0",
        visibility: "public",
        status: "active",
        semantic_digest: `sha256:${"3".repeat(64)}`,
        effective_rating: "teen",
        created_at: "2026-09-01T12:00:00.000Z",
      },
    ],
    latest_release: {
      id: "rel_01j00000000000000000000092",
      label: "2.0.1",
      visibility: "public",
      status: "active",
      semantic_digest: `sha256:${"2".repeat(64)}`,
      effective_rating: "teen",
      created_at: "2026-09-20T12:00:00.000Z",
    },
  });
  api.on("GET /v1/search", {
    body: {
      items: [
        {
          id: world.id,
          ref: world.ref,
          type: "world",
          display_name: "Night City",
          rating: "teen",
          tags: [],
          latest_release: world.latest_release,
        },
      ],
      next_cursor: null,
    },
  });
  api.on("GET /v1/creations/@cyberpunk/night-city", { body: world });

  await page.goto("/c/writer/character-draft/edit");
  await page.getByRole("button", { name: "Dependencies", exact: true }).click();
  await page.getByLabel("Add a dependency").fill("night");
  await page.getByRole("button", { name: /Night City/ }).click();
  await page.getByLabel("Version", { exact: true }).selectOption({ label: "1.9.0" });
  await page.getByLabel("How it's used").selectOption("intrinsic");
  await expect(page.getByLabel("Relationship")).toHaveValue("lives_in");
  await page.getByRole("button", { name: "Add dependency" }).click();

  const row = page.getByRole("list", { name: "Dependencies" }).getByRole("listitem");
  await expect(row).toContainText("lives in");
  await expect(row).toContainText("@cyberpunk/night-city");
  await expect(page.getByLabel("Version of @cyberpunk/night-city")).toHaveValue(
    "rel_01j00000000000000000000091",
  );
  await expect(page.getByLabel("How @cyberpunk/night-city is used")).toHaveValue("intrinsic");
  await expect(page.getByText("All changes saved")).toBeVisible({ timeout: 10_000 });
  const put = api.calls.findLast((c) => c.method === "PUT" && c.path === `${base}/draft`);
  expect(put?.body).toMatchObject({
    working: {
      references: [
        {
          id: "night-city",
          use: "@cyberpunk/night-city",
          rel: "lives_in",
          mode: "intrinsic",
          pin: {
            release: "rel_01j00000000000000000000091",
            semantic_digest: `sha256:${"3".repeat(64)}`,
          },
        },
      ],
    },
  });
  await expect(
    page.getByRole("region", { name: "Before you publish" }).getByText("Dependencies pinned"),
  ).toBeVisible();
});

test("publishing shows the Publish Report with warnings and the license check", async ({
  page,
}) => {
  const { api, base } = await editorFor(page, "character");
  mockPublish(api, base, {
    release: "rel_01j00000000000000000000001",
    state: "active",
    idempotent: false,
    label: "1.0.0",
    report: {
      license_check: "warn",
      issues: [
        {
          code: "publish.no_avatar",
          subject: "assets",
          severity: "warning",
          detail: "the character has no avatar",
        },
      ],
    },
  });

  await page.goto("/c/writer/character-draft/edit");
  await page.getByRole("button", { name: "Publish…" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Version label")).toHaveValue("1.0.0");
  await expect(dialog.getByRole("radio", { name: /^Public/ })).toBeChecked();
  await expect(dialog.getByText(/Others get “not found”/)).toBeVisible();
  await dialog.getByRole("button", { name: "Publish 1.0.0" }).click();
  await expect(dialog.getByRole("heading", { name: "Published 1.0.0" })).toBeVisible({
    timeout: 15_000,
  });
  const report = dialog.getByRole("region", { name: "Publish report" });
  await expect(report.getByText("Licenses need attention — see the warnings.")).toBeVisible();
  await expect(report.getByText("publish.no_avatar")).toBeVisible();
  await expect(dialog.getByRole("link", { name: "View release" })).toHaveAttribute(
    "href",
    "/c/writer/character-draft?v=1.0.0",
  );

  const pub = api.calls.find((c) => c.method === "POST" && c.path === `${base}/releases`);
  expect(pub?.body).toEqual({
    revision: "rev_01j00000000000000000000001",
    label: "1.0.0",
    visibility: "public",
  });
});

test("a failed publish explains the errors from the report", async ({ page }) => {
  const { api, base } = await editorFor(page, "character");
  mockPublish(api, base, {
    release: "rel_01j00000000000000000000002",
    state: "failed",
    idempotent: false,
    label: "1.0.0",
    report: {
      license_check: "fail",
      issues: [
        {
          code: "publish.license_incompatible",
          subject: "@cyberpunk/corps",
          severity: "error",
          detail: "the dependency does not allow redistribution",
        },
      ],
    },
  });

  await page.goto("/c/writer/character-draft/edit");
  await page.getByRole("button", { name: "Publish…" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Publish 1.0.0" }).click();
  await expect(dialog.getByRole("heading", { name: "Couldn't publish 1.0.0" })).toBeVisible({
    timeout: 15_000,
  });
  const report = dialog.getByRole("region", { name: "Publish report" });
  await expect(report.getByText("Licenses do not allow this combination.")).toBeVisible();
  await expect(report.getByText("publish.license_incompatible")).toBeVisible();
});

test("a diamond dependency lists both paths and leads to Dependencies", async ({ page }) => {
  const { api, base } = await editorFor(page, "character", {
    references: [
      {
        id: "a-knows",
        use: "@cyberpunk/corps",
        mode: "default",
        pin: {
          release: "rel_01j00000000000000000000081",
          semantic_digest: `sha256:${"8".repeat(64)}`,
        },
      },
      {
        id: "b-lives",
        use: "@cyberpunk/night-city",
        mode: "intrinsic",
        pin: {
          release: "rel_01j00000000000000000000091",
          semantic_digest: `sha256:${"9".repeat(64)}`,
        },
      },
    ],
  });
  mockPublish(api, base, {
    release: "rel_01j00000000000000000000003",
    state: "failed",
    idempotent: false,
    label: "1.0.0",
    report: {
      license_check: "pass",
      issues: [
        {
          code: "publish.diamond_conflict",
          subject: "@cyberpunk/night-city",
          severity: "error",
          detail: "the same creation appears with two different releases",
          data: {
            ref: "@cyberpunk/night-city",
            releases: [
              { release: "rel_01j00000000000000000000091", via: ["b-lives"] },
              { release: "rel_01j00000000000000000000092", via: ["a-knows", "setting"] },
            ],
          },
        },
      ],
    },
  });

  await page.goto("/c/writer/character-draft/edit");
  // 已有依赖时 Dependencies 默认展开；先收起，确认失败对话框会把它重新打开。
  const deps = page.getByRole("button", { name: "Dependencies", exact: true });
  await expect(deps).toHaveAttribute("aria-expanded", "true");
  await deps.click();
  await page.getByRole("button", { name: "Publish…" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Publish 1.0.0" }).click();
  await expect(dialog.getByText("Two versions of the same dependency")).toBeVisible({
    timeout: 15_000,
  });
  const paths = dialog.getByRole("list", { name: "Where it comes from" });
  await expect(paths).toContainText("A character → @cyberpunk/night-city");
  await expect(paths).toContainText("A character → @cyberpunk/corps → @cyberpunk/night-city");
  await expect(dialog.getByText("publish.diamond_conflict")).toBeVisible();
  await dialog.getByRole("button", { name: "Open dependencies" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(deps).toHaveAttribute("aria-expanded", "true");
});
