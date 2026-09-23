/**
 * UC-1 在浏览器里走一遍（完整本地环境）：注册 namespace → 新建角色 → 填写第一层字段并
 * 上传头像 → 发布 1.0.0 → 匿名访问作品页 → 下载 Context IR。
 *
 * 默认跳过；`pnpm e2e:fullstack` 会设置 `E2E_FULLSTACK=1` 并启动所需的全部进程。
 */
import { deflateSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { signInAs } from "./fullstack/session";

test.skip(!process.env.E2E_FULLSTACK, "needs the local full stack (pnpm e2e:fullstack)");

/** 生成一张 8×8 的纯色 PNG（头像上传用）。 */
function tinyPng(): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = (crcTable[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(4 + body.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), 4 + body.length);
    return out;
  };
  const size = 8;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, 0xc8)]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

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

  // 4. 发布 1.0.0 并查看 Publish Report。
  await expect(page.getByLabel("Version")).toHaveValue("1.0.0");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published 1.0.0")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("region", { name: "Publish report" })).toBeVisible();
  await page.getByRole("link", { name: "Open the creation page" }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${ns}/alice-courier`));

  // 5. 匿名访问作品页。
  const anon = await browser.newContext();
  const visitor = await anon.newPage();
  await visitor.goto(`/c/${ns}/alice-courier`);
  await expect(visitor.getByRole("heading", { name: "Alice Courier" })).toBeVisible();
  await expect(visitor.getByText("Package for {{user}}! Sign here, please.")).toBeVisible();
  await expect(visitor.getByText(/cheerful courier who knows every alley/)).toBeVisible();
  await expect(visitor.locator("header img")).toHaveCount(1);
  await expect(visitor.getByRole("heading", { name: "Why this rating" })).toBeVisible();
  await expect(visitor.getByRole("button", { name: /1\.0\.0/ })).toBeVisible();
  await expect(visitor.getByRole("button", { name: "Sign in" })).toBeVisible();

  // 搜索也能找到它。
  await visitor.goto("/browse?q=Alice%20Courier");
  await expect(visitor.getByRole("link", { name: "Alice Courier" })).toBeVisible();

  // 6. 下载 Context IR：API 重定向到内容寻址的公共对象。
  await visitor.goto(`/c/${ns}/alice-courier`);
  const href = await visitor.getByRole("link", { name: "Context IR" }).getAttribute("href");
  expect(href).toBe(`/v1/creations/@${ns}/alice-courier/releases/1.0.0/ir`);
  const res = await visitor.request.get(href ?? "");
  expect(res.ok()).toBe(true);
  const ir = (await res.json()) as { root: { ref: string }; meta: { rating: string } };
  expect(ir.root.ref).toBe(`@${ns}/alice-courier`);
  expect(ir.meta.rating).toBe("general");
  await anon.close();
});
