/**
 * E2E-2 在浏览器里走一遍（完整本地环境）：上传一张合成的 CCv3 PNG 角色卡 → 服务端导入为
 * 草稿 → 查看 Import Report（被省略的 system prompt 只显示字段名）→ 确认评级、权利与许可 →
 * 发布 1.0.0 → 导出 CCv3，得到卡片与 Loss Report。
 *
 * 默认跳过；`pnpm e2e:fullstack` 会设置 `E2E_FULLSTACK=1` 并启动所需的全部进程。
 */
import { expect, test } from "@playwright/test";
import { cardPng } from "./fullstack/png";
import { signInAs } from "./fullstack/session";

test.skip(!process.env.E2E_FULLSTACK, "needs the local full stack (pnpm e2e:fullstack)");

const SECRET = "SECRET-SYSTEM-PROMPT-DO-NOT-SHOW";

const CARD = {
  spec: "chara_card_v3",
  spec_version: "3.0",
  data: {
    name: "Lumen",
    description: "{{char}} tends the lanterns along the canal.",
    personality: "Patient and curious.",
    scenario: "",
    first_mes: "Evening, {{user}}. Mind the wet steps.",
    mes_example: "",
    creator_notes: "",
    system_prompt: SECRET,
    post_history_instructions: "",
    alternate_greetings: [],
    tags: ["lantern"],
    creator: "someone",
    character_version: "1",
    extensions: {},
    group_only_greetings: [],
  },
};

test("E2E-2: import a CCv3 PNG, confirm, publish and export it again", async ({
  page,
  context,
  request,
}) => {
  const ns = `e2e2-${Date.now().toString(36)}`;
  await signInAs(context, "Card Importer");

  await page.goto("/create/import");
  await page.getByLabel("Namespace").fill(ns);
  await page.getByRole("button", { name: `Register @${ns}` }).click();

  await page.getByLabel("Character card").setInputFiles({
    name: "Lumen.png",
    mimeType: "image/png",
    buffer: cardPng(CARD),
  });
  await expect(page.getByLabel("Address")).toHaveValue("lumen");
  await page.getByRole("button", { name: "Read the card" }).click();

  await expect(page.getByRole("heading", { name: "Import report" })).toBeVisible({
    timeout: 90_000,
  });
  const omitted = page.getByRole("list", { name: "Omitted fields" });
  await expect(omitted.getByText("system_prompt")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(SECRET);

  await page.getByRole("radio", { name: /^General/ }).check();
  await page.getByRole("radio", { name: /^Original/ }).check();
  await page.getByLabel("License", { exact: true }).selectOption("CC-BY-4.0");
  await page.getByRole("button", { name: "Save and open the editor" }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${ns}/lumen/edit$`));

  await page.getByRole("button", { name: "Publish…" }).click({ timeout: 30_000 });
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Version label")).toHaveValue("1.0.0");
  await dialog.getByRole("button", { name: "Publish 1.0.0" }).click();
  await expect(dialog.getByRole("heading", { name: "Published 1.0.0" })).toBeVisible({
    timeout: 90_000,
  });
  await dialog.getByRole("link", { name: "View release" }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${ns}/lumen(\\?|$)`));
  await expect(page.getByRole("heading", { name: "Lumen" })).toBeVisible();
  await expect(page.getByText("Lumen tends the lanterns along the canal.")).toBeVisible();
  await expect(page.getByText(/these fields were left out: .*system_prompt/)).toBeVisible();

  // 导出：服务端按需构建，构建完成前返回 202，之后重定向到内容寻址的导出物。
  const exportUrl = `/v1/creations/@${ns}/lumen/releases/1.0.0/export/ccv3`;
  let location: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await request.get(exportUrl, { maxRedirects: 0 });
        location = res.headers().location;
        return res.status();
      },
      { timeout: 90_000, intervals: [1_000] },
    )
    .toBe(302);
  const exported = await request.get(location ?? "");
  expect(exported.ok()).toBe(true);
  const body = (await exported.json()) as {
    card: { spec: string; data: { name: string; system_prompt?: string } };
    loss: unknown;
  };
  expect(body.card.spec).toBe("chara_card_v3");
  expect(body.card.data.name).toBe("Lumen");
  expect(JSON.stringify(body)).not.toContain(SECRET);
  expect(body.loss).toBeTruthy();
});
