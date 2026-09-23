/**
 * 已发布作品的 Context Preview 与 Context Diff（mock API）。IR 由 web 自带的示例作品现场
 * 解析：Alice 依赖 intrinsic 的 Night City 与 keyword 触发的 Corps 世界书，并覆盖了其中
 * 一条；1.2.0 把 Night City 从 1.0.0 升级到 2.0.0，评级随之变为 mature。
 *
 * 覆盖：在浏览器里运行参考 Assembler，用一句人话解释每段内容为什么进入上下文，展开后说明
 * 来自哪条依赖、被谁覆盖；token 数标注 tokenizer，估算时明确标注；Versions 标签比较两个
 * 版本，评级与许可的变化放在最上面；旧的 /diff 地址重定向到 Versions。
 */
import { expect, type Page, test } from "@playwright/test";
import { diffPair, resolveSample } from "../src/fixtures/samples";
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

async function alice(page: Page, showMature: boolean) {
  const api = await mockApi(page, ORIGIN);
  api.on("GET /v1/me", {
    body: {
      ...ME,
      settings: {
        show_mature: showMature,
        mature_confirmed_at: showMature ? "2026-09-23T08:00:00.000Z" : null,
        locale: null,
      },
    },
  });
  api.on(`GET ${BASE}`, {
    body: creationDetail({
      ref: "@djj/alice",
      display_name: "Alice",
      effective_rating: "mature",
      releases: RELEASES,
      latest_release: RELEASES[0],
    }),
  });
  api.on(`GET ${BASE}/releases/*`, (_req, url) => {
    const label = url.pathname.split("/").pop() ?? "";
    const r = RELEASES.find((x) => x.label === label) ?? RELEASES[0];
    return {
      body: {
        ...r,
        ref: "@djj/alice",
        creation: "cr_01j00000000000000000000000",
        lock_digest: null,
        context_ir_digest: null,
        license_check: "pass",
        availability: "complete",
      },
    };
  });
  api.on(`GET ${BASE}/releases/1.2.0/ir`, { body: IR_V2 });
  api.on(`GET ${BASE}/releases/1.1.0/ir`, { body: IR_V1 });
  api.on(`GET ${BASE}/dependents`, { body: { items: [], next_cursor: null } });
  return api;
}

test("the creation page opens a preview that explains why each fragment is in the context", async ({
  page,
}) => {
  await alice(page, true);
  await page.goto("/c/djj/alice?v=1.1.0");
  await page.getByRole("link", { name: "Preview context" }).click();
  await expect(page).toHaveURL(/\/c\/djj\/alice\/preview\?v=1\.1\.0$/);
  const tabs = page.getByRole("navigation", { name: "Creation sections" });
  await expect(tabs.getByRole("link", { name: "Context preview" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // token 数标注 tokenizer；默认是估算，并明确标出。
  const summary = page.getByTestId("trace-summary");
  await expect(summary).toContainText("Estimated count — tokenizer: estimate");
  await expect(summary.getByRole("list", { name: "Tokens by source" })).toContainText(
    "@cyberpunk/night-city",
  );

  // 每一行给出结果和一句人话：intrinsic World 的核心设定被固定、不会被预算裁掉；其余设定
  // 总是加载，并说明是哪条依赖；世界书条目由关键词触发，没有被触发的条目说明原因。
  const table = page.getByRole("table");
  const row = (id: string) => table.locator(`tr[data-id*="${id}"]`);
  await expect(row("night-city#world").getByText("Included")).toBeVisible();
  await expect(row("night-city#world")).toContainText("Pinned — never cut to save space.");
  await expect(row("night-city#districts")).toContainText(
    "Always included, because Alice lives in Night City (Core).",
  );
  await expect(row("lore/biotechnica")).toContainText("Off until you enable it by hand.");
  await expect(row("lore/arasaka")).toContainText("The chat mentions “Arasaka”.");
  // 原始 reason code 不在表格行里。
  await expect(row("lore/arasaka")).not.toContainText("keyword:Arasaka");

  // 展开一行：来自哪个依赖、经过哪条引用、被谁改过，都用自然语言说明；原始代码是次要信息。
  await table
    .getByRole("button", { name: "Show details for @cyberpunk/corps#lore/militech" })
    .click();
  const details = page.locator("dl").filter({ hasText: "Overridden by" });
  await expect(details).toContainText("(@cyberpunk/corps)");
  await expect(details).toContainText("through the “knows” reference");
  await expect(details).toContainText("Alice changed it through its “knows” reference.");
  await expect(details.getByText(/^inactive · region/)).toBeVisible();

  // 修改 Session 会重新组装：去掉触发词后，关键词条目不再进入上下文。
  await page.getByLabel("Chat history").fill("user: How is the weather?");
  await expect(row("lore/arasaka")).toContainText("Not triggered");

  // 切换到精确 tokenizer 后，标注随之变化，不再显示估算标记。
  await page.getByLabel("Tokenizer").selectOption("cl100k_base");
  await expect(summary).toContainText("Exact count — tokenizer: cl100k_base", { timeout: 30_000 });
  await expect(summary).not.toContainText("Estimated");
});

test("the preview of a mature release stays behind the gate until confirmed", async ({ page }) => {
  await alice(page, false);
  await page.goto("/c/djj/alice/preview?v=1.2.0");
  await expect(page.getByRole("heading", { name: "Mature content is hidden" })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  // 登录用户可以去设置里长期开启。
  await expect(page.getByRole("link", { name: "Always show in settings" })).toHaveAttribute(
    "href",
    "/settings",
  );
  await page.getByRole("button", { name: "Show this once" }).click();
  await expect(page.getByRole("table")).toBeVisible();
});

test("comparing two releases puts rating and license changes first", async ({ page }) => {
  await alice(page, true);
  await page.goto("/c/djj/alice");
  await page
    .getByRole("navigation", { name: "Creation sections" })
    .getByRole("link", { name: /Versions/ })
    .click();
  await expect(page).toHaveURL(/\/c\/djj\/alice\/versions$/);
  await expect(page.getByRole("heading", { name: "Compare versions" })).toBeVisible();
  const versions = page.getByRole("form", { name: "Versions to compare" });
  await expect(versions.getByLabel("From", { exact: true })).toHaveValue("1.1.0");
  await expect(versions.getByLabel("To", { exact: true })).toHaveValue("1.2.0");
  const list = page.getByRole("list", { name: "Releases" });
  await expect(list.getByRole("listitem").first()).toContainText("Latest");

  // 评级与许可的变化在最上面，必须醒目。
  const attention = page.getByRole("region", { name: "Check these before you upgrade" });
  await expect(attention.locator('[data-highlight="rating"]')).toContainText("Teen");
  await expect(attention.locator('[data-highlight="rating"]')).toContainText("Mature");
  await expect(attention.locator('[data-highlight="licenses"]')).toContainText("CC-BY-NC-4.0");
  // 依赖升级：Night City 的锁定 Release 变了。
  const deps = page
    .locator("section", { has: page.getByRole("heading", { name: "Dependencies", exact: true }) })
    .last();
  await expect(deps.locator('[data-change="modified"]')).toContainText("@cyberpunk/night-city");
  // 片段与 token 的变化，并注明估算。
  await expect(page.getByRole("heading", { name: "Passages" })).toBeVisible();
  await expect(page.getByText("Always in context")).toBeVisible();
  await expect(page.getByText("tokenizer: estimate · approximate")).toBeVisible();

  // 点版本列表里的圆圈也能换比较对象；选择同一个版本时不做比较。
  await versions.getByLabel("From", { exact: true }).selectOption("1.2.0");
  await expect(page.getByText("Choose two different versions.")).toBeVisible();
  await list.getByRole("button", { name: "Compare 1.1.0" }).click();
  await expect(versions.getByLabel("From", { exact: true })).toHaveValue("1.1.0");
  await expect(attention).toBeVisible();
});

test("the old diff address redirects to Versions and keeps the versions", async ({ page }) => {
  await alice(page, true);
  await page.goto("/c/djj/alice/diff?from=1.2.0&to=1.1.0");
  await expect(page).toHaveURL(/\/c\/djj\/alice\/versions\?from=1\.2\.0&to=1\.1\.0$/);
  const versions = page.getByRole("form", { name: "Versions to compare" });
  await expect(versions.getByLabel("From", { exact: true })).toHaveValue("1.2.0");
  await expect(versions.getByLabel("To", { exact: true })).toHaveValue("1.1.0");
});
