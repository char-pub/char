/**
 * 作品外框里所有者和访客的操作（mock API）：yank 一个版本（头部溢出菜单与 Versions 的版本行）、
 * 作品设置（贡献开放度、按 @namespace 邀请、GitHub 绑定），以及举报（登录用户与需要通过
 * Turnstile 的匿名访客）。非所有者进入设置页看到和不存在一样的 404。
 */
import { expect, type Page, test } from "@playwright/test";
import { diffPair, resolveSample } from "../src/fixtures/samples";
import { creationDetail, ME, mockApi, problem } from "./mock-api";

const ORIGIN = "http://127.0.0.1:4173";
const BASE = "/v1/creations/@djj/alice";
const OWNER = { ...ME, namespace: "djj" };

function release(label: string, n: number, over: Record<string, unknown> = {}) {
  return {
    id: `rel_01j0000000000000000000000${n}`,
    label,
    visibility: "public",
    status: "active",
    semantic_digest: `sha256:${String(n).repeat(64)}`,
    effective_rating: "teen",
    created_at: `2026-09-2${n}T12:00:00.000Z`,
    ...over,
  };
}

async function setup(page: Page, me: typeof ME | null) {
  const api = await mockApi(page, ORIGIN);
  let releases = [release("1.2.0", 2), release("1.1.0", 1)];
  let policy = "signed-in";
  api.on("GET /v1/me", me ? { body: me } : { status: 401, body: { code: "auth.required" } });
  api.on(`GET ${BASE}`, () => ({
    body: creationDetail({
      ref: "@djj/alice",
      display_name: "Alice",
      releases,
      latest_release: releases[0],
      contribution_policy: policy,
    }),
  }));
  api.on(`GET ${BASE}/releases/*`, (_req, url) => {
    const label = url.pathname.split("/").pop() ?? "";
    const r = releases.find((x) => x.label === label) ?? releases[0];
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
  // 评级是 teen：这些用例不涉及成人内容遮挡。
  api.on(`GET ${BASE}/releases/1.2.0/ir`, { body: resolveSample(diffPair.from).ir });
  api.on(`GET ${BASE}/releases/1.1.0/ir`, { body: resolveSample(diffPair.from).ir });
  api.on(`GET ${BASE}/dependents`, { body: { items: [], next_cursor: null } });
  api.on(`POST ${BASE}/releases/*/yank`, (req, url) => {
    const label = url.pathname.split("/").at(-2) ?? "";
    const reason = (req.postDataJSON() as { reason: string }).reason;
    releases = releases.map((r) =>
      r.label === label ? { ...r, status: "yanked", status_reason: reason } : r,
    );
    return { body: releases.find((r) => r.label === label) };
  });
  api.on(`PUT ${BASE}/contribution-settings`, (req) => {
    policy = (req.postDataJSON() as { policy: string }).policy;
    return { status: 204 };
  });
  return api;
}

test("the owner yanks a version from the header menu and the page flags it", async ({ page }) => {
  const api = await setup(page, OWNER);
  await page.goto("/c/djj/alice");
  const main = page.getByRole("main");
  await expect(main.getByRole("link", { name: "Edit" })).toBeVisible();
  await main.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Yank 1.2.0…" }).click();

  const dialog = page.getByRole("dialog", { name: "Yank 1.2.0?" });
  await expect(dialog).toContainText("can't be undone");
  const confirm = dialog.getByRole("button", { name: "Yank 1.2.0" });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Reason (shown publicly)").fill("The greeting breaks in some runtimes");
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  expect(api.calls.find((c) => c.path.endsWith("/yank"))?.body).toEqual({
    reason: "The greeting breaks in some runtimes",
  });
  // 刷新作品数据后，yanked 提示条出现，内容仍然可用。
  await expect(page.getByRole("note").filter({ hasText: "was yanked" })).toContainText(
    "Version 1.2.0 was yanked: “The greeting breaks in some runtimes”",
  );
  await expect(page.getByRole("region", { name: /What it says/ })).toBeVisible();
});

test("the owner can yank from the Versions list", async ({ page }) => {
  await setup(page, OWNER);
  await page.goto("/c/djj/alice/versions");
  const list = page.getByRole("list", { name: "Releases" });
  await list.getByRole("button", { name: "Actions for 1.1.0" }).click();
  await page.getByRole("menuitem", { name: "Yank 1.1.0…" }).click();
  await expect(page.getByRole("dialog", { name: "Yank 1.1.0?" })).toBeVisible();
});

test("other people can't yank or change settings", async ({ page }) => {
  await setup(page, { ...ME, namespace: "other" });
  await page.goto("/c/djj/alice/versions");
  await page
    .getByRole("list", { name: "Releases" })
    .getByRole("button", { name: "Actions for 1.1.0" })
    .click();
  await expect(page.getByRole("menuitem", { name: "View this version" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Yank/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("main").getByRole("link", { name: "Edit" })).toHaveCount(0);
});

test("the owner sets who can contribute, invites by @namespace and resolves a frozen GitHub binding", async ({
  page,
}) => {
  const api = await setup(page, OWNER);
  let invites: { user: string; namespace: string | null; invited_at: string }[] = [];
  api.on(`GET ${BASE}/contribution-invites`, () => ({ body: { items: invites } }));
  api.on(`POST ${BASE}/contribution-invites`, (req) => {
    const ns = (req.postDataJSON() as { namespace: string }).namespace;
    if (ns === "@ghost") return problem(422, "contribution.invite_unknown_user");
    invites = [
      ...invites,
      {
        user: "usr_01j0000000000000000000000v",
        namespace: ns,
        invited_at: "2026-09-23T08:00:00.000Z",
      },
    ];
    return { body: { user: "usr_01j0000000000000000000000v", namespace: ns, invited: true } };
  });
  let binding: Record<string, unknown> = {
    repository_id: "1",
    repository_owner_id: "2",
    installation_id: "3",
    full_name: "djj/alice-character",
    path: "char.yaml",
    tracked_ref: "refs/heads/main",
    publish_refs: ["refs/tags/*"],
    status: "frozen",
    frozen_reason:
      "The repository moved to a new owner, so publishing is paused until you confirm.",
  };
  api.on(`GET ${BASE}/source-binding`, () => ({ body: binding }));
  api.on(`POST ${BASE}/source-binding/resolve`, () => {
    binding = { ...binding, status: "active", frozen_reason: undefined };
    return { body: binding };
  });

  await page.goto("/c/djj/alice");
  await page
    .getByRole("navigation", { name: "Creation sections" })
    .getByRole("link", { name: "Settings" })
    .click();
  await expect(page).toHaveURL(/\/c\/djj\/alice\/settings$/);

  const who = page.getByRole("region", { name: "Who can suggest changes" });
  await expect(who.getByRole("radio", { name: "Signed-in users" })).toBeChecked();
  await who.getByText("Invited people", { exact: true }).click();
  await expect
    .poll(() => api.calls.find((c) => c.method === "PUT")?.body)
    .toEqual({ policy: "invited" });

  await who.getByLabel("Invite by @namespace").fill("@ghost");
  await who.getByRole("button", { name: "Invite" }).click();
  await expect(who.getByRole("alert")).toContainText("Nobody uses @ghost");
  await who.getByLabel("Invite by @namespace").fill("@vee");
  await who.getByRole("button", { name: "Invite" }).click();
  await expect(who.getByRole("list", { name: "Invited people" })).toContainText("@vee");
  await expect(who.getByText("Only you can see who's invited.")).toBeVisible();

  const github = page.getByRole("region", { name: "Publish from GitHub" });
  await expect(github.getByText("Paused", { exact: true })).toBeVisible();
  await expect(github).toContainText("The repository moved to a new owner");
  await github.getByRole("button", { name: "Keep this repository" }).click();
  await expect(github.getByText("Active", { exact: true })).toBeVisible();
  expect(api.calls.find((c) => c.path.endsWith("/source-binding/resolve"))?.body).toEqual({
    action: "rebind",
  });

  await expect(page.getByRole("link", { name: "Request removal…" })).toHaveAttribute(
    "href",
    "/policy#report",
  );
});

test("someone else's creation has no settings: the address is a 404", async ({ page }) => {
  await setup(page, null);
  await page.goto("/c/djj/alice/settings");
  await expect(page.getByRole("heading", { name: "Nothing at @djj/alice/settings" })).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Creation sections" })
      .getByRole("link", { name: "Settings" }),
  ).toHaveCount(0);
});

test("an anonymous visitor reports a version after the human check", async ({ page }) => {
  const api = await setup(page, null);
  api.on(`POST ${BASE}/releases/1.2.0/reports`, { status: 202, body: { status: "received" } });
  // Turnstile 的替身：点一下按钮就给出 token；action 必须是举报用的 `report`。
  await page.route("https://challenges.cloudflare.com/**", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `window.turnstile = {
        render(el, o) {
          if (o.action !== "report") throw new Error("wrong action");
          const b = document.createElement("button");
          b.type = "button"; b.textContent = "I am human";
          b.onclick = () => o.callback("turnstile-report-token");
          el.appendChild(b); return "w1";
        },
        reset() {}, remove() {},
      };`,
    }),
  );

  await page.goto("/c/djj/alice");
  await page.getByRole("main").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Report…" }).click();
  const dialog = page.getByRole("dialog", { name: "Report @djj/alice" });
  await dialog.getByText("Only version 1.2.0").click();
  await dialog.getByText("Wrong rating").click();
  await dialog.getByLabel("Details (optional)").fill("This is not Teen.");
  const send = dialog.getByRole("button", { name: "Send report" });
  await expect(send).toBeDisabled();
  await dialog.getByRole("button", { name: "I am human" }).click();
  await send.click();
  // 成功后对话框只说明已经收到。
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "Report received" }),
  ).toBeVisible();
  expect(api.calls.find((c) => c.path.endsWith("/reports"))).toEqual({
    method: "POST",
    path: `${BASE}/releases/1.2.0/reports`,
    body: {
      category: "rating",
      details: "This is not Teen.",
      turnstile_token: "turnstile-report-token",
    },
  });
});

test("a signed-in report about the whole creation explains a rate limit", async ({ page }) => {
  const api = await setup(page, { ...ME, namespace: "other" });
  api.on(`POST ${BASE}/reports`, problem(429, "rate_limited"));
  await page.goto("/c/djj/alice");
  await page.getByRole("main").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Report…" }).click();
  const dialog = page.getByRole("dialog", { name: "Report @djj/alice" });
  await dialog.getByText("Copyright or trademark").click();
  await expect(dialog.getByRole("link", { name: "copyright (DMCA) notice" })).toHaveAttribute(
    "href",
    "/policy#report",
  );
  // 登录用户不需要人机校验。
  await expect(dialog.getByTestId("turnstile")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Send report" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Try again later");
  expect(api.calls.find((c) => c.path.endsWith("/reports"))?.body).toEqual({
    category: "copyright",
  });
});
