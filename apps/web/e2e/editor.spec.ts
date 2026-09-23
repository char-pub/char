/**
 * Native 编辑器与发布流程（mock API）。
 *
 * - 渐进式展示：第一层只有名字、正文、简介（角色另有问候语）与头像，“More options”展开后
 *   才出现 fragment、依赖、评级与许可。三种类型的正文字段名不同。
 * - 发布：保存草稿 → 创建 Revision → 发布 → 轮询 Publish Report，报告中的错误和警告、
 *   许可检查结果都展示给作者；失败的发布说明原因。
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

function working(type: Kind) {
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
    },
  };
}

async function editorFor(page: Page, type: Kind) {
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
      working: working(type),
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

for (const type of ["character", "world", "lorebook"] as const) {
  test(`the ${type} editor shows the basics first and the rest under More options`, async ({
    page,
  }) => {
    await editorFor(page, type);
    await page.goto(`/c/writer/${type}-draft/edit`);
    await expect(page.getByRole("heading", { name: "The basics" })).toBeVisible();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(`A ${type}`);
    await expect(page.getByLabel(MAIN_FIELD[type])).toHaveValue(`Some text about the ${type}.`);
    await expect(page.getByLabel("Summary")).toBeVisible();
    await expect(page.getByLabel("Choose an avatar image")).toBeAttached();
    // 只有角色有问候语。
    await expect(page.getByLabel("Greeting")).toHaveCount(type === "character" ? 1 : 0);

    // 高级字段默认收起。
    const more = page.getByRole("button", { name: "More options" });
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("heading", { name: "Fragments" })).toHaveCount(0);
    await expect(page.getByLabel("Rating", { exact: true })).toHaveCount(0);

    await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("heading", { name: "Fragments" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dependencies" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Rating, license and more" })).toBeVisible();
    await expect(page.getByLabel("Rating", { exact: true })).toBeVisible();
    await expect(page.getByLabel("License", { exact: true })).toBeVisible();
  });
}

test("publishing shows the Publish Report with warnings and the license check", async ({
  page,
}) => {
  const { api, base } = await editorFor(page, "character");
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
          : {
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
            },
    };
  });

  await page.goto("/c/writer/character-draft/edit");
  const publish = page.getByRole("region", { name: "Publish" });
  await expect(publish.getByLabel("Version")).toHaveValue("1.0.0");
  await page.getByRole("button", { name: "Publish" }).click();
  const report = page.getByRole("region", { name: "Publish report" });
  await expect(report.getByText("Published 1.0.0")).toBeVisible({ timeout: 15_000 });
  await expect(report.getByText("Licenses need attention — see the warnings.")).toBeVisible();
  await expect(report.getByText("publish.no_avatar")).toBeVisible();

  const pub = api.calls.find((c) => c.method === "POST" && c.path === `${base}/releases`);
  expect(pub?.body).toEqual({
    revision: "rev_01j00000000000000000000001",
    label: "1.0.0",
    visibility: "public",
  });
});

test("a failed publish explains the errors from the report", async ({ page }) => {
  const { api, base } = await editorFor(page, "character");
  api.on(`POST ${base}/revisions`, {
    status: 201,
    body: {
      id: "rev_01j00000000000000000000002",
      semantic_digest: `sha256:${"e".repeat(64)}`,
      created_at: "2026-09-23T08:01:00.000Z",
    },
  });
  api.on(`POST ${base}/releases`, {
    status: 202,
    body: { release: "rel_01j00000000000000000000002", state: "pending", idempotent: false },
  });
  api.on(`GET ${base}/releases/1.0.0/report`, {
    body: {
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
    },
  });

  await page.goto("/c/writer/character-draft/edit");
  await page.getByRole("button", { name: "Publish" }).click();
  const report = page.getByRole("region", { name: "Publish report" });
  await expect(report.getByText("Could not publish 1.0.0")).toBeVisible({ timeout: 15_000 });
  await expect(report.getByText("Licenses do not allow this combination.")).toBeVisible();
  await expect(report.getByText("publish.license_incompatible")).toBeVisible();
});
