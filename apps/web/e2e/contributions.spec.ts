/**
 * Contribution 界面（mock API）：敏感变更必须逐项确认、审阅时显示和草稿的前后对比、冲突有
 * 标记、按状态和 Agent 过滤并分页、作者显示名（访客显示成 “guest · 名字”）、审阅期间草稿被改
 * 时提示重新加载、拒绝理由对提交者可见，以及访客验证后提交 Contribution 并在列表中看到自己的
 * 提交的完整流程。开放度和邀请名单在作品设置页，不在这里。
 */
import { expect, type Page, test } from "@playwright/test";
import { creationDetail, ME, mockApi, OTHER, problem } from "./mock-api";

const ORIGIN = "http://127.0.0.1:4173";
const BASE = "/v1/creations/@writer/mira";
const SHA = (c: string) => `sha256:${c.repeat(64)}`;

function summary(n: number, over: Record<string, unknown> = {}) {
  return {
    id: `ctb_01j0000000000000000000000${n}`,
    number: n,
    title: `Contribution ${n}`,
    status: "open",
    agent: false,
    author: { user: OTHER.id, display_name: OTHER.name, namespace: `@${OTHER.namespace}` },
    base_revision: "rev_01j00000000000000000000000",
    created_at: "2026-09-22T12:00:00.000Z",
    decided_at: null,
    ...over,
  };
}

const RATING_CHANGE = {
  on: "metadata",
  field: "meta.rating",
  op: "set",
  base_digest: SHA("a"),
  after: "teen",
  sensitive: true,
};
const WARNINGS_CHANGE = {
  on: "metadata",
  field: "meta.content_warnings",
  op: "set",
  after: ["violence"],
  sensitive: true,
};
const TEXT_CHANGE = {
  on: "fragment",
  op: "modify",
  id: "intro",
  base_digest: SHA("b"),
  after: {
    id: "intro",
    kind: "character",
    stable: true,
    content: { type: "text", text: "Mira keeps the old lighthouse." },
  },
};

function outcome(key: string, on: string, op: string, state: string, sensitive = false) {
  return { key, on, op, state, sensitive, ...(state === "conflict" ? { reason: "diverged" } : {}) };
}

/** 作者本人登录：可以审阅、接受与拒绝。 */
async function asAuthor(page: Page) {
  const api = await mockApi(page, ORIGIN);
  api.on("GET /v1/me", { body: ME });
  api.on(`GET ${BASE}`, { body: creationDetail() });
  return api;
}

test("sensitive changes must be confirmed one by one before accepting", async ({ page }) => {
  const api = await asAuthor(page);
  api.on(`GET ${BASE}/contributions/1`, {
    body: {
      ...summary(1),
      changes: [TEXT_CHANGE, RATING_CHANGE, WARNINGS_CHANGE],
      preview: {
        mergeable: true,
        outcomes: [
          outcome("fragment:intro", "fragment", "modify", "applied"),
          outcome("metadata:meta.rating", "metadata", "set", "applied", true),
          outcome("metadata:meta.content_warnings", "metadata", "set", "applied", true),
        ],
        conflicts: [],
        sensitive_keys: ["metadata:meta.rating", "metadata:meta.content_warnings"],
      },
      result_revision: null,
    },
  });
  // 作者当前的草稿：审阅时作为“改之前”显示。
  api.on(`GET ${BASE}/draft`, {
    body: {
      version: 4,
      working: {
        fragments: [
          {
            id: "intro",
            kind: "character",
            stable: true,
            content: { type: "text", text: "Mira keeps the lighthouse." },
          },
        ],
        meta: { rating: "general", license: "CC-BY-4.0" },
      },
      base_revision_id: "rev_01j00000000000000000000000",
      updated_at: "2026-09-22T12:00:00.000Z",
    },
  });
  api.on(`POST ${BASE}/contributions/1/accept`, {
    body: {
      status: "accepted",
      revision: "rev_01j00000000000000000000009",
      semantic_digest: SHA("c"),
      applied: ["fragment:intro", "metadata:meta.rating", "metadata:meta.content_warnings"],
      already_applied: [],
    },
  });

  await page.goto("/c/writer/mira/contributions/1");
  await expect(page.getByRole("heading", { name: "Contribution 1" })).toBeVisible();
  const preview = page.getByRole("list", { name: "Merge preview" });
  await expect(preview.getByRole("listitem")).toHaveCount(3);
  // 每个变更一张卡片：草稿里现在的内容（删除行）和贡献里的新内容（新增行）。
  const intro = preview.getByRole("listitem", { name: "Fragment #intro: will apply" });
  await expect(intro.getByText("Mira keeps the lighthouse.", { exact: true })).toBeVisible();
  await expect(intro.getByText("Mira keeps the old lighthouse.", { exact: true })).toBeVisible();
  const rating = preview.getByRole("listitem", { name: "rating: will apply" });
  await expect(rating.getByText("Sensitive")).toBeVisible();
  await expect(rating.getByText("general", { exact: true })).toBeVisible();
  await expect(rating.getByText("teen", { exact: true })).toBeVisible();
  await expect(
    page.getByText("2 sensitive changes need your confirmation, one by one."),
  ).toBeVisible();

  const accept = page.getByRole("button", { name: "Accept into the draft" });
  await expect(accept).toBeDisabled();
  // 没有“全部接受”的捷径。
  await expect(page.getByRole("button", { name: /accept all/i })).toHaveCount(0);
  const decision = page.getByRole("complementary", { name: "Decision" });
  await expect(decision.getByText("0 of 2 sensitive changes confirmed")).toBeVisible();
  await page.getByLabel("I have reviewed this rating change and accept it").check();
  await expect(accept).toBeDisabled();
  await expect(decision.getByText("1 of 2 sensitive changes confirmed")).toBeVisible();
  await page.getByLabel("I have reviewed this content warnings change and accept it").check();
  await expect(accept).toBeEnabled();
  await expect(decision.getByText("No conflicts with your draft")).toBeVisible();
  await accept.click();
  await expect(page.getByRole("heading", { name: "Accepted" })).toBeVisible();

  const call = api.calls.find((c) => c.path.endsWith("/accept"));
  expect(call?.body).toEqual({
    confirm_sensitive: ["metadata:meta.rating", "metadata:meta.content_warnings"],
  });
});

test("conflicting changes are marked and cannot be accepted", async ({ page }) => {
  const api = await asAuthor(page);
  api.on(`GET ${BASE}/contributions/2`, {
    body: {
      ...summary(2),
      changes: [TEXT_CHANGE, RATING_CHANGE],
      preview: {
        mergeable: false,
        outcomes: [
          outcome("fragment:intro", "fragment", "modify", "conflict"),
          outcome("metadata:meta.rating", "metadata", "set", "already_applied", true),
        ],
        conflicts: ["fragment:intro"],
        sensitive_keys: ["metadata:meta.rating"],
      },
      result_revision: null,
    },
  });
  await page.goto("/c/writer/mira/contributions/2");
  const row = page.getByRole("listitem", { name: "Fragment #intro: conflict" });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-state", "conflict");
  await expect(row.getByText(/also changed in the draft/)).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "1 change conflicts" })).toBeVisible();
  await expect(page.getByRole("listitem", { name: "rating: already in the draft" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept into the draft" })).toBeDisabled();
});

test("a draft changed during review asks to reload the preview", async ({ page }) => {
  const api = await asAuthor(page);
  let reloads = 0;
  api.on(`GET ${BASE}/contributions/3`, () => {
    reloads++;
    return {
      body: {
        ...summary(3),
        changes: [TEXT_CHANGE],
        preview: {
          mergeable: true,
          outcomes: [outcome("fragment:intro", "fragment", "modify", "applied")],
          conflicts: [],
          sensitive_keys: [],
        },
        result_revision: null,
      },
    };
  });
  api.on(`POST ${BASE}/contributions/3/accept`, problem(409, "draft.version_conflict"));
  await page.goto("/c/writer/mira/contributions/3");
  await page.getByRole("button", { name: "Accept into the draft" }).click();
  await expect(page.getByText("The draft changed while you were reviewing.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept into the draft" })).toBeDisabled();
  const before = reloads;
  await page.getByRole("button", { name: "Reload the preview" }).click();
  await expect(page.getByText("The draft changed while you were reviewing.")).toHaveCount(0);
  expect(reloads).toBeGreaterThan(before);
  await expect(page.getByRole("button", { name: "Accept into the draft" })).toBeEnabled();
});

test("the list marks agent contributions and filters them", async ({ page }) => {
  const api = await asAuthor(page);
  api.on(`GET ${BASE}/contributions`, (_req, url) => {
    const status = url.searchParams.get("status") ?? "open";
    const all = [
      summary(4, { agent: true, title: "Tidy the lore" }),
      summary(5, { title: "Fix a typo" }),
      summary(6, {
        title: "Name the keeper",
        author: { guest_id: "gst_01j00000000000000000000000", display_name: "Wren" },
      }),
    ].map((c) => ({ ...c, status }));
    const agent = url.searchParams.get("agent");
    const items = agent === null ? all : all.filter((c) => String(c.agent) === agent);
    return { body: { items, next_cursor: null } };
  });
  await page.goto("/c/writer/mira/contributions");
  const list = page.getByRole("list", { name: "Contributions" });
  await expect(list.getByRole("listitem")).toHaveCount(3);
  const agentRow = list.getByRole("listitem").filter({ hasText: "Tidy the lore" });
  await expect(agentRow.getByText("Agent", { exact: true })).toBeVisible();
  // 提交者显示显示名与 namespace，而不是用户 ID；访客不能看起来像登录用户。
  await expect(agentRow.getByText("by Other (@other)")).toBeVisible();
  await expect(list.getByText("by guest · Wren")).toBeVisible();
  // 接口不给各状态的总数：只在当前筛选上显示读到的条数。
  await expect(page.getByRole("button", { name: "Open 3" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByLabel("Submitted by").selectOption("human");
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list.getByText("Fix a typo")).toBeVisible();
  await page.getByLabel("Submitted by").selectOption("agent");
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list.getByText("Tidy the lore")).toBeVisible();
  await page.getByRole("button", { name: /^Accepted/ }).click();
  await expect(page.getByRole("button", { name: "Accepted 1" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(api.calls.some((c) => c.path.endsWith("/contributions") && c.method === "GET")).toBe(true);
  // 开放度在作品设置页里调整：这里只有说明和入口，接受的修改只进草稿。
  await expect(page.getByText(/Anyone can suggest changes/)).toBeVisible();
  await expect(page.getByText(/nothing is published until you publish/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Who can contribute" })).toHaveAttribute(
    "href",
    "/c/writer/mira/settings",
  );
  await expect(page.getByRole("link", { name: "Propose a change" })).toHaveCount(0);
});

test("the list loads the next page with the cursor", async ({ page }) => {
  const api = await asAuthor(page);
  api.on(`GET ${BASE}/contributions`, (_req, url) =>
    url.searchParams.get("cursor") === "9"
      ? { body: { items: [summary(8, { title: "Older change" })], next_cursor: null } }
      : { body: { items: [summary(9, { title: "Newer change" })], next_cursor: "9" } },
  );
  await page.goto("/c/writer/mira/contributions");
  const list = page.getByRole("list", { name: "Contributions" });
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Open 1+" })).toBeVisible();
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list.getByText("Older change")).toBeVisible();
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
});

test("other readers see how to propose a change", async ({ page }) => {
  const api = await mockApi(page, ORIGIN);
  api.on("GET /v1/me", { body: OTHER });
  api.on(`GET ${BASE}`, { body: creationDetail({ contribution_policy: "signed-in" }) });
  api.on(`GET ${BASE}/contributions`, { body: { items: [], next_cursor: null } });
  await page.goto("/c/writer/mira/contributions");
  await expect(page.getByText(/Signed-in users can suggest changes/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Propose a change" })).toHaveAttribute(
    "href",
    "/c/writer/mira/contributions/new",
  );
  await expect(page.getByRole("heading", { name: "No open contributions" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Who can contribute" })).toHaveCount(0);
});

test("the contributor sees why a contribution was rejected", async ({ page }) => {
  const api = await mockApi(page, ORIGIN);
  api.on("GET /v1/me", { body: OTHER });
  api.on(`GET ${BASE}`, { body: creationDetail() });
  api.on(`GET ${BASE}/contributions/5`, {
    body: {
      ...summary(5, { status: "rejected", decided_at: "2026-09-23T09:00:00.000Z" }),
      changes: [TEXT_CHANGE],
      preview: null,
      result_revision: null,
      decision_reason: "The lighthouse was torn down in the last chapter.",
    },
  });
  await page.goto("/c/writer/mira/contributions/5");
  const rejected = page.getByRole("region", { name: "Rejected" });
  await expect(
    rejected.getByText("The lighthouse was torn down in the last chapter."),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "All contributions" })).toBeVisible();
  // 已经有了决定：没有撤回、接受或拒绝。
  await expect(page.getByRole("button", { name: "Withdraw this contribution" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Accept into the draft" })).toHaveCount(0);
});

test("a guest verifies by email, then submits a contribution", async ({ page }) => {
  const api = await mockApi(page, ORIGIN);
  let guest: unknown = null;
  api.on("GET /v1/me", problem(401, "auth.required"));
  api.on("GET /v1/guests/me", () => (guest ? { body: guest } : problem(401, "auth.required")));
  api.on(`GET ${BASE}`, { body: creationDetail() });
  api.on("POST /v1/guests/verification", {
    status: 202,
    body: { status: "sent", expires_in: 1800 },
  });
  api.on("POST /v1/guests/verification/confirm", () => {
    guest = {
      guest: {
        id: "gst_01j00000000000000000000000",
        display_name: "Wren",
        verified_at: "2026-09-22T12:00:00.000Z",
      },
      session_expires_at: "2026-10-22T12:00:00.000Z",
    };
    return { body: guest };
  });
  api.on(`GET ${BASE}/releases/1.0.0/source`, {
    body: {
      revision: "rev_01j00000000000000000000000",
      semantic_digest: SHA("1"),
      creation: {
        id: "cr_01j00000000000000000000000",
        ref: "@writer/mira",
        type: "character",
        display_name: "Mira",
        fragments: [
          {
            id: "intro",
            kind: "character",
            stable: true,
            content: { type: "text", text: "Mira keeps the lighthouse." },
          },
        ],
        meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
      },
    },
  });
  api.on(`POST ${BASE}/contributions`, {
    status: 201,
    body: {
      id: "ctb_01j00000000000000000000007",
      number: 7,
      status: "open",
      agent: false,
      sensitive_keys: [],
    },
  });
  api.on(`GET ${BASE}/contributions/7`, {
    body: {
      ...summary(7, {
        title: "Mention the old lighthouse",
        author: { guest_id: "gst_01j00000000000000000000000", display_name: "Wren" },
      }),
      changes: [TEXT_CHANGE],
      preview: null,
      result_revision: null,
    },
  });
  // Turnstile 的替身：点一下按钮就给出 token。
  await page.route("https://challenges.cloudflare.com/**", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `window.turnstile = {
        render(el, o) {
          if (o.action !== "guest_verification") throw new Error("wrong action");
          const b = document.createElement("button");
          b.type = "button"; b.textContent = "I am human";
          b.onclick = () => o.callback("turnstile-test-token");
          el.appendChild(b); return "w1";
        },
        reset() {}, remove() {},
      };`,
    }),
  );

  await page.goto("/c/writer/mira/contributions/new");
  await expect(page.getByRole("heading", { name: "Contribute as a guest" })).toBeVisible();
  await page.getByLabel("Email").fill("wren@example.test");
  await page.getByLabel("Name shown with your contributions").fill("Wren");
  const send = page.getByRole("button", { name: "Send the link" });
  await expect(send).toBeDisabled();
  await page.getByRole("button", { name: "I am human" }).click();
  await send.click();
  await expect(page.getByText(/Check your inbox/)).toBeVisible();
  expect(api.calls.find((c) => c.path === "/v1/guests/verification")?.body).toEqual({
    email: "wren@example.test",
    display_name: "Wren",
    turnstile_token: "turnstile-test-token",
  });

  // 打开邮件里的链接：token 在 fragment 里，读取后从地址栏清除，然后回到原来的页面。
  await page.goto("/guest/verify#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG");
  await expect(page).toHaveURL(/\/c\/writer\/mira\/contributions\/new$/);
  expect(api.calls.find((c) => c.path.endsWith("/confirm"))?.body).toEqual({
    token: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
  });
  await expect(page.getByText("Contributing as Wren")).toBeVisible();

  await page.getByLabel("#intro · character").fill("Mira keeps the old lighthouse.");
  await page.getByLabel("Title").fill("Mention the old lighthouse");
  const submit = page.getByRole("button", { name: "Submit the contribution" });
  await expect(submit).toBeDisabled();
  await page.getByLabel(/I license my contribution under CC-BY-4.0/).check();
  await submit.click();
  await expect(page).toHaveURL(/\/contributions\/7$/);
  await expect(page.getByRole("heading", { name: "Mention the old lighthouse" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Withdraw this contribution" })).toBeVisible();

  const body = api.calls.find((c) => c.method === "POST" && c.path === `${BASE}/contributions`)
    ?.body as {
    base_revision: string;
    changes: { on: string; op: string; id: string }[];
    rights_ack: unknown;
  };
  expect(body.base_revision).toBe("rev_01j00000000000000000000000");
  expect(body.rights_ack).toEqual({ inbound_equals_outbound: true });
  expect(body.changes).toHaveLength(1);
  expect(body.changes[0]).toMatchObject({ on: "fragment", op: "modify", id: "intro" });
  expect(body.changes[0]).toHaveProperty("base_digest");

  // 访客在列表里只看到自己的提交，并标为“you”。
  api.on(`GET ${BASE}/contributions`, {
    body: {
      items: [
        summary(7, {
          title: "Mention the old lighthouse",
          author: { guest_id: "gst_01j00000000000000000000000", display_name: "Wren" },
        }),
      ],
      next_cursor: null,
    },
  });
  await page.goto("/c/writer/mira/contributions");
  const mine = page.getByRole("list", { name: "Contributions" });
  await expect(mine.getByRole("listitem")).toHaveCount(1);
  await expect(mine.getByText("by you")).toBeVisible();
});
