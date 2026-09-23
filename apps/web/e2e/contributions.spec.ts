/**
 * Contribution 界面（mock API）：敏感变更必须逐项确认、冲突有标记、按 Agent 过滤、
 * 作者显示名、审阅期间草稿被改时提示重新加载、作者管理邀请名单，以及访客验证后提交
 * Contribution 并在列表中看到自己的提交的完整流程。
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
  await expect(
    page.getByText("2 sensitive changes need your confirmation, one by one."),
  ).toBeVisible();

  const accept = page.getByRole("button", { name: "Accept into the draft" });
  await expect(accept).toBeDisabled();
  // 没有“全部接受”的捷径。
  await expect(page.getByRole("button", { name: /accept all/i })).toHaveCount(0);
  await page.getByLabel("I have reviewed this rating change and accept it").check();
  await expect(accept).toBeDisabled();
  await page.getByLabel("I have reviewed this content warnings change and accept it").check();
  await expect(accept).toBeEnabled();
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
    const all = [
      summary(4, { agent: true, title: "Tidy the lore" }),
      summary(5, { title: "Fix a typo" }),
    ];
    const agent = url.searchParams.get("agent");
    const items = agent === null ? all : all.filter((c) => String(c.agent) === agent);
    return { body: { items, next_cursor: null } };
  });
  await page.goto("/c/writer/mira/contributions");
  const list = page.getByRole("list", { name: "Contributions" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  const agentRow = list.getByRole("listitem").filter({ hasText: "Tidy the lore" });
  await expect(agentRow.getByText("agent", { exact: true })).toBeVisible();
  // 提交者显示显示名与 namespace，而不是用户 ID。
  await expect(agentRow.getByText("by Other (@other)")).toBeVisible();

  await page.getByLabel("Submitted by").selectOption("human");
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list.getByText("Fix a typo")).toBeVisible();
  await page.getByLabel("Submitted by").selectOption("agent");
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list.getByText("Tidy the lore")).toBeVisible();
  expect(api.calls.some((c) => c.path.endsWith("/contributions"))).toBe(true);
  // 作者可以设置谁能提交。
  await expect(page.getByRole("heading", { name: "Who can contribute" })).toBeVisible();
});

test("the author sees and edits the invite list", async ({ page }) => {
  const api = await mockApi(page, ORIGIN);
  api.on("GET /v1/me", { body: ME });
  api.on(`GET ${BASE}`, { body: creationDetail({ contribution_policy: "invited" }) });
  api.on(`GET ${BASE}/contributions`, { body: { items: [], next_cursor: null } });
  interface Invite {
    user: string;
    display_name: string | null;
    namespace: string | null;
    invited_at: string;
  }
  let invited: Invite[] = [
    {
      user: OTHER.id,
      display_name: OTHER.name,
      namespace: `@${OTHER.namespace}`,
      invited_at: "2026-09-22T12:00:00.000Z",
    },
  ];
  const NEW_USER = "usr_01j00000000000000000000009";
  api.on(`GET ${BASE}/contribution-invites`, () => ({ body: { items: invited } }));
  api.on(`POST ${BASE}/contribution-invites`, () => {
    invited = [
      ...invited,
      {
        user: NEW_USER,
        display_name: null,
        namespace: null,
        invited_at: "2026-09-22T13:00:00.000Z",
      },
    ];
    return { body: { user: NEW_USER, invited: true } };
  });
  api.on(`DELETE ${BASE}/contribution-invites/${OTHER.id}`, () => {
    invited = invited.filter((i) => i.user !== OTHER.id);
    return { body: { user: OTHER.id, invited: false } };
  });

  await page.goto("/c/writer/mira/contributions");
  const list = page.getByRole("list", { name: "Invited users" });
  // 名单来自服务端：刷新页面后仍然能看到之前邀请的人。
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list.getByText("Other", { exact: true })).toBeVisible();
  await expect(list.getByText("@other")).toBeVisible();

  await page.getByLabel("Invite a user by ID").fill(NEW_USER);
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list.getByText(NEW_USER)).toBeVisible();

  await page.getByRole("button", { name: "Remove Other" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list.getByText("Other", { exact: true })).toHaveCount(0);
  expect(api.calls.filter((c) => c.method === "POST").map((c) => c.body)).toEqual([
    { user: NEW_USER },
  ]);
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
