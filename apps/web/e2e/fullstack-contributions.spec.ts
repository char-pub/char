/**
 * UC-5 在浏览器里走一遍（完整本地环境）：作者发布一个角色 → 第二个账号在最新 Release 上
 * 修改一段文本并调高评级，提交 Contribution → 作者随后改了另一段文本 → 作者审阅：变更
 * 自动 rebase 到当前草稿，评级变更必须单独确认 → 接受。
 *
 * 作品的准备与作者对草稿的修改直接调用 API（在页面里用 fetch，带上会话 cookie 与 Origin），
 * 界面部分只覆盖贡献者的提交与作者的审阅。
 *
 * 读取 Release 来源内容的接口（`GET …/releases/:label/source`）服务端还没有提供，这里用
 * 作者发布时的草稿与 Revision 在浏览器层面替它应答；其余请求都打到真实的 API。
 *
 * 默认跳过；`pnpm e2e:fullstack` 会设置 `E2E_FULLSTACK=1` 并启动所需的全部进程。
 */
import { expect, type Page, test } from "@playwright/test";
import { signInAs } from "./fullstack/session";

test.skip(!process.env.E2E_FULLSTACK, "needs the local full stack (pnpm e2e:fullstack)");

interface CallResult {
  status: number;
  body: unknown;
}

/** 在页面里调用 API：浏览器自动带上会话 cookie 与 Origin，和界面发出的请求一样。 */
async function call(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<CallResult> {
  return page.evaluate(
    async ({ method, path, body, headers }) => {
      const res = await fetch(path, {
        method,
        credentials: "include",
        headers: {
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    },
    { method, path, body, headers },
  );
}

function ok(r: CallResult, what: string): Record<string, unknown> {
  if (r.status >= 300) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as Record<string, unknown>;
}

type Working = { fragments: { id: string; content: { text: string } }[]; meta: { rating: string } };

test("UC-5: a contribution is rebased onto the author's newer draft and the rating change is confirmed separately", async ({
  browser,
}) => {
  const suffix = Date.now().toString(36);
  const ns = `uc5-${suffix}`;
  const base = `/v1/creations/@${ns}/harbor`;

  // 1. 作者发布 1.0.0。
  const authorCtx = await browser.newContext();
  await signInAs(authorCtx, "Ada Author");
  const author = await authorCtx.newPage();
  await author.goto("/");
  ok(await call(author, "POST", "/v1/namespaces", { slug: ns }), "namespace");
  ok(
    await call(author, "POST", `/v1/namespaces/${ns}/creations`, {
      name: "harbor",
      type: "character",
      display_name: "Harbor Keeper",
    }),
    "creation",
  );
  const d0 = ok(await call(author, "GET", `${base}/draft`), "draft");
  const working = {
    ...(d0.working as Record<string, unknown>),
    display_name: "Harbor Keeper",
    fragments: [
      {
        id: "intro",
        kind: "character",
        stable: true,
        content: { type: "text", text: "The keeper counts every ship that enters the harbor." },
      },
      {
        id: "habit",
        kind: "character",
        stable: true,
        content: { type: "text", text: "At dusk the keeper lights the lamps." },
      },
    ],
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
  };
  ok(
    await call(author, "PUT", `${base}/draft`, { working }, { "if-match": `"${d0.version}"` }),
    "put draft",
  );
  const published = ok(await call(author, "GET", `${base}/draft`), "draft after put");
  const revision = ok(await call(author, "POST", `${base}/revisions`, {}), "revision");
  ok(
    await call(
      author,
      "POST",
      `${base}/releases`,
      { revision: revision.id, label: "1.0.0", visibility: "public" },
      { "idempotency-key": `uc5-${suffix}` },
    ),
    "publish",
  );
  await expect
    .poll(
      async () =>
        (
          ok(await call(author, "GET", `${base}/releases/1.0.0/report`), "report") as {
            state: string;
          }
        ).state,
      { timeout: 60_000 },
    )
    .toBe("active");

  // 2. 第二个账号提交：改写 intro，并把评级调高到 teen。
  const contribCtx = await browser.newContext();
  await signInAs(contribCtx, "Cy Contributor");
  const contributor = await contribCtx.newPage();
  await contributor.route(`**${base}/releases/1.0.0/source`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        revision: revision.id,
        semantic_digest: revision.semantic_digest,
        creation: published.working,
      }),
    }),
  );
  await contributor.goto(`/c/${ns}/harbor`);
  await contributor.getByRole("link", { name: "Contributions" }).click();
  await contributor.getByRole("link", { name: "Propose a change" }).click();
  await contributor
    .getByLabel("#intro · character")
    .fill("The keeper counts every ship, and remembers each captain's name.");
  await contributor.getByLabel("Rating", { exact: true }).selectOption("teen");
  await expect(contributor.getByText(/A rating change is sensitive/)).toBeVisible();
  await contributor.getByLabel("Title", { exact: true }).fill("Remember the captains");
  await contributor.getByLabel(/I license my contribution under CC-BY-4.0/).check();
  await contributor.getByRole("button", { name: "Submit the contribution" }).click();
  await expect(contributor).toHaveURL(new RegExp(`/c/${ns}/harbor/contributions/1$`));
  await expect(contributor.getByRole("heading", { name: "Remember the captains" })).toBeVisible();

  // 3. 作者在此期间改了另一段文本。
  const d1 = ok(await call(author, "GET", `${base}/draft`), "draft");
  const w1 = d1.working as Working;
  const habit = w1.fragments.find((f) => f.id === "habit");
  if (!habit) throw new Error("habit fragment missing");
  habit.content.text = "At dusk the keeper lights the lamps, one by one.";
  ok(
    await call(author, "PUT", `${base}/draft`, { working: w1 }, { "if-match": `"${d1.version}"` }),
    "author edit",
  );

  // 4. 作者审阅：intro 会被应用；评级变更必须单独确认。
  await author.goto(`/c/${ns}/harbor/contributions`);
  await author.getByRole("link", { name: "Remember the captains" }).click();
  await expect(author.getByRole("listitem", { name: "Fragment #intro: will apply" })).toBeVisible();
  await expect(author.getByRole("listitem", { name: "rating: will apply" })).toBeVisible();
  const accept = author.getByRole("button", { name: "Accept into the draft" });
  await expect(accept).toBeDisabled();
  await author.getByLabel("I have reviewed this rating change and accept it").check();
  await expect(accept).toBeEnabled();
  await accept.click();
  await expect(author.getByRole("heading", { name: "Accepted" })).toBeVisible();

  // 5. 草稿同时包含贡献者的改动与作者后来的改动。
  const d2 = ok(await call(author, "GET", `${base}/draft`), "draft after accept");
  const w2 = d2.working as Working;
  expect(w2.fragments.find((f) => f.id === "intro")?.content.text).toBe(
    "The keeper counts every ship, and remembers each captain's name.",
  );
  expect(w2.fragments.find((f) => f.id === "habit")?.content.text).toBe(
    "At dusk the keeper lights the lamps, one by one.",
  );
  expect(w2.meta.rating).toBe("teen");

  await authorCtx.close();
  await contribCtx.close();
});
