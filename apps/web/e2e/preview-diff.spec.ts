/**
 * 已发布作品的 Context Preview 与 Context Diff（mock API）。IR 由 web 自带的示例作品现场
 * 解析：Alice 依赖 intrinsic 的 Night City 与 keyword 触发的 Corps 世界书，并覆盖了其中
 * 一条；1.2.0 把 Night City 从 1.0.0 升级到 2.0.0，评级随之变为 mature。
 *
 * 覆盖：在浏览器里运行参考 Assembler 并解释每个 fragment 为什么进入上下文、来自哪条依赖、
 * 被谁覆盖；token 数标注 tokenizer，估算时明确标注；两个版本之间的 Diff 列出依赖、fragment、
 * 评级与 token 的变化。
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
  await page.getByRole("link", { name: "Preview" }).click();
  await expect(page).toHaveURL(/\/c\/djj\/alice\/preview\?v=1\.1\.0$/);
  await expect(page.getByRole("heading", { name: "Preview 1.1.0" })).toBeVisible();

  // token 数标注 tokenizer；默认是估算，并明确标出。
  const summary = page.getByTestId("trace-summary");
  await expect(summary).toContainText("tokenizer: estimate");
  await expect(summary.getByText("estimate", { exact: true })).toBeVisible();

  // 每一行给出决定与原因：intrinsic World 的核心设定被固定、不会被预算裁掉；其余设定总是
  // 加载；世界书条目由关键词触发，没有被触发的条目说明原因。
  const table = page.getByRole("table");
  const world = table.getByRole("row").filter({ hasText: "night-city#world" });
  await expect(world.getByText("included")).toBeVisible();
  await expect(world.getByText("pinned — never cut")).toBeVisible();
  const districts = table.getByRole("row").filter({ hasText: "night-city#districts" });
  await expect(districts.getByText("always included")).toBeVisible();
  const biotechnica = table.getByRole("row").filter({ hasText: "lore/biotechnica" });
  await expect(biotechnica.getByText("not triggered")).toBeVisible();
  const arasaka = table.getByRole("row").filter({ hasText: "lore/arasaka" });
  await expect(arasaka.getByText("keyword “Arasaka” matched")).toBeVisible();

  // 展开一行：来自哪个依赖（锁定的 Release）、经过哪条边、被谁覆盖。
  await table
    .getByRole("button", { name: "Show details for @cyberpunk/corps#lore/militech" })
    .click();
  const details = page.locator("dl").filter({ hasText: "Overridden by" });
  await expect(details.getByText(/@cyberpunk\/corps/).first()).toBeVisible();
  await expect(details.getByText(/root → knows/)).toBeVisible();
  await expect(details.getByText(/@djj\/alice \(knows\) patch/)).toBeVisible();

  // 修改 Session 会重新组装：去掉触发词后，关键词条目不再进入上下文。
  await page.getByLabel("Chat history").fill("user: How is the weather?");
  await expect(arasaka.getByText("not triggered")).toBeVisible();

  // 切换到精确 tokenizer 后，标注随之变化，不再显示估算标记。
  await page.getByLabel("Tokenizer").selectOption("cl100k_base");
  await expect(summary).toContainText("tokenizer: cl100k_base", { timeout: 30_000 });
  await expect(summary.getByText("estimate", { exact: true })).toHaveCount(0);
});

test("the preview of a mature release stays behind the gate until confirmed", async ({ page }) => {
  await alice(page, false);
  await page.goto("/c/djj/alice/preview?v=1.2.0");
  await expect(page.getByText("Mature content is hidden")).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await page.getByRole("button", { name: "Show mature content" }).click();
  await expect(page.getByRole("table")).toBeVisible();
});

test("comparing two releases lists dependency, fragment, rating and token changes", async ({
  page,
}) => {
  await alice(page, true);
  await page.goto("/c/djj/alice");
  await page.getByRole("link", { name: "Compare versions" }).click();
  await expect(page.getByRole("heading", { name: "Compare versions" })).toBeVisible();
  const versions = page.getByRole("form", { name: "Versions to compare" });
  await expect(versions.getByLabel("From", { exact: true })).toHaveValue("1.1.0");
  await expect(versions.getByLabel("To", { exact: true })).toHaveValue("1.2.0");

  // 评级变化必须醒目。
  await expect(page.getByText("rating changed", { exact: true })).toBeVisible();
  // 依赖升级：Night City 的锁定 Release 变了。
  const deps = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /^Dependencies/ }) });
  await expect(deps.getByText(/@cyberpunk\/night-city/)).toBeVisible();
  // fragment 与 token 的变化，并注明估算。
  await expect(page.getByRole("heading", { name: /^Fragments/ })).toBeVisible();
  await expect(page.getByText("Always in context")).toBeVisible();
  await expect(page.getByText("tokenizer: estimate (estimate)")).toBeVisible();

  // 选择同一个版本时不做比较。
  await versions.getByLabel("From", { exact: true }).selectOption("1.2.0");
  await expect(page.getByText("Choose two different versions.")).toBeVisible();
});
