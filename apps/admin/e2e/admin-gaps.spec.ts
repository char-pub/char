/**
 * admin 功能清单中补齐的部分（mock 后端，以 owner 身份）：吊销会话、锁定上传、访客停用、
 * namespace 转让（四眼）、DMCA 停止访问 / 反通知 / 恢复、隔离证据的下载、强制员工登出。
 * 每个需要理由的操作都先断言没有理由时无法提交。
 */
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { collectErrors, giveReason, navigate, REASON, signInAs } from "./helpers";

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = collectErrors(page);
  await signInAs(page, ["owner"]);
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

test("users: revoke sessions without banning; lock and unlock uploads", async ({ page }) => {
  await page.goto("/users");
  const alice = page.getByTestId("user-u_alice");
  await expect(alice).toContainText("1 / 2");

  await alice.getByRole("button", { name: "Revoke sessions" }).click();
  let dialog = page.getByRole("dialog");
  const revoke = dialog.getByRole("button", { name: "Revoke sessions and tokens" });
  await giveReason(dialog, revoke);
  await revoke.click();
  await expect(page.getByRole("status")).toHaveText(
    "Signed alice@example.com out: revoked 1 session(s) and 2 token(s).",
  );
  await expect(alice).toContainText("0 / 0");
  await expect(alice).toContainText("active");

  await alice.getByRole("button", { name: "Lock uploads" }).click();
  dialog = page.getByRole("dialog");
  await giveReason(dialog, dialog.getByRole("button", { name: "Lock uploads" }));
  await dialog.getByRole("button", { name: "Lock uploads" }).click();
  await expect(page.getByRole("status")).toHaveText("Locked uploads for alice@example.com.");
  await expect(alice).toContainText("uploads locked");

  await alice.getByRole("button", { name: "Details" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("locked since");
  await page.keyboard.press("Escape");

  await alice.getByRole("button", { name: "Unlock uploads" }).click();
  dialog = page.getByRole("dialog");
  await giveReason(dialog, dialog.getByRole("button", { name: "Unlock uploads" }));
  await dialog.getByRole("button", { name: "Unlock uploads" }).click();
  await expect(alice).not.toContainText("uploads locked");
});

test("guests: filter, disable and enable", async ({ page }) => {
  await page.goto("/guests");
  const visitor = page.getByTestId("guest-gst_01j9mockvisitor0000000001");
  const spammer = page.getByTestId("guest-gst_01j9mockspammer0000000002");
  await expect(spammer).toContainText("disabled");
  await expect(page.locator("main")).not.toContainText("@example");

  await visitor.getByRole("button", { name: "Disable" }).click();
  let dialog = page.getByRole("dialog");
  await giveReason(dialog, dialog.getByRole("button", { name: "Disable guest" }));
  await dialog.getByRole("button", { name: "Disable guest" }).click();
  await expect(page.getByRole("status")).toContainText("Disabled guest");
  await expect(visitor).toContainText("disabled");

  await page.getByLabel("Status").selectOption("active");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("No guests match.")).toBeVisible();

  await page.getByLabel("Status").selectOption("disabled");
  await page.getByRole("button", { name: "Search" }).click();
  await spammer.getByRole("button", { name: "Enable" }).click();
  dialog = page.getByRole("dialog");
  await giveReason(dialog, dialog.getByRole("button", { name: "Enable guest" }));
  await dialog.getByRole("button", { name: "Enable guest" }).click();
  await expect(page.getByRole("status")).toContainText("Enabled guest");
});

test("namespaces: a transfer always needs a second staff member", async ({ page }) => {
  await page.goto("/namespaces");
  await expect(
    page.getByTestId("namespace-commons").getByRole("button", { name: "Transfer" }),
  ).toHaveCount(0);
  const alice = page.getByTestId("namespace-alice");

  await alice.getByRole("button", { name: "Transfer" }).click();
  let dialog = page.getByRole("dialog");
  const request = dialog.getByRole("button", { name: "Request transfer" });
  await dialog.getByLabel(/^Reason/).fill(REASON);
  await expect(request).toBeDisabled();
  await dialog.getByLabel("New owner (user ID or email)").fill("nobody@example.com");
  await request.click();
  await expect(dialog.getByRole("alert")).toHaveText("Failed: namespace.transfer_target_not_found");
  await dialog.getByLabel("New owner (user ID or email)").fill("locked@example.com");
  await request.click();
  await expect(page.getByRole("status")).toContainText("Transfer of @alice requested (ap1)");
  // 确认之前 owner 不变。
  await expect(alice).toContainText("alice@example.com");

  await alice.getByRole("button", { name: "Transfer" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("New owner (user ID or email)").fill("locked@example.com");
  await giveReason(dialog, dialog.getByRole("button", { name: "Request transfer" }));
  await dialog.getByRole("button", { name: "Request transfer" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Failed: namespace.transfer_pending");
  await page.keyboard.press("Escape");

  await navigate(page, "Approvals");
  const approval = page.getByTestId("approval-ap1");
  await expect(approval).toContainText("namespace.transfer");
  await expect(approval).toContainText("namespace:@alice");
  // 只有一名有资格的员工：发起人要等冷静期结束才能自己确认。
  await expect(approval.getByTestId("cooling-off")).toBeVisible();
});

test("legal: disable access, counter-notice window, court action; restore a due request", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("tile-Counter-notice restores due")).toContainText("1");

  await navigate(page, "Legal");
  await expect(page.getByTestId("legal-lr3")).toContainText("restore due");
  await page.getByTestId("legal-lr1").getByRole("button", { name: "Open" }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Register counter-notice" })).toHaveCount(0);

  await dialog.getByRole("button", { name: "Disable access" }).click();
  let form = dialog.getByRole("region", { name: "Disable access" });
  const hide = form.getByRole("button", { name: "Hide creations" });
  await form.getByLabel(/^Reason/).fill(REASON);
  await expect(hide).toBeDisabled();
  await form.getByLabel(/^Creations to hide/).fill("@fanworks/borrowed-hero");
  await hide.click();
  await expect(page.getByRole("status").first()).toContainText(
    "Hid 1 creation(s) under legal request lr1.",
  );
  await expect(dialog.getByRole("list", { name: "Actions taken" })).toContainText("creation.hide");

  await dialog.getByRole("button", { name: "Register counter-notice" }).click();
  form = dialog.getByRole("region", { name: "Register counter-notice" });
  const register = form.getByRole("button", { name: "Register counter-notice" });
  await form.getByLabel(/^Reason/).fill(REASON);
  await expect(register).toBeDisabled();
  await form.getByLabel("Sender name").fill("Original Author");
  await form.getByLabel("Sender address").fill("1 Example Street");
  await form.getByLabel("Statement").fill("Removed by mistake; I own the character.");
  await register.click();
  await expect(dialog.getByTestId("legal-counter-notice")).toContainText("Original Author");
  await expect(dialog).toContainText("restore window not open");
  await expect(dialog.getByRole("button", { name: "Restore content" })).toHaveCount(0);

  await dialog.getByRole("button", { name: "Record court action" }).click();
  form = dialog.getByRole("region", { name: "Record court action" });
  await giveReason(form, form.getByRole("button", { name: "Record court action" }));
  await form.getByRole("button", { name: "Record court action" }).click();
  await expect(dialog).toContainText("court action filed");
  await page.keyboard.press("Escape");

  await page.getByTestId("legal-lr3").getByRole("button", { name: "Open" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Restore content" }).click();
  form = dialog.getByRole("region", { name: "Restore content" });
  await giveReason(form, form.getByRole("button", { name: "Restore hidden creations" }));
  await form.getByRole("button", { name: "Restore hidden creations" }).click();
  await expect(dialog.getByRole("status")).toContainText("Restored 1");
  await expect(dialog.getByRole("list", { name: "Actions taken" })).toContainText("reverted");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("legal-lr3")).toContainText("closed");

  await navigate(page, "Content");
  await page.getByLabel(/^Creation/).fill("@fanworks/cover-song");
  await page.getByRole("button", { name: "Look up" }).click();
  await expect(page.locator("main")).toContainText("active");
});

test("csam: evidence shows metadata only and downloads as a file after a reason", async ({
  page,
}) => {
  await page.goto("/csam");
  await page.getByTestId("incident-inc1").getByRole("button", { name: "Evidence" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("evidence-meta")).toContainText("48213 bytes");
  await expect(dialog.getByTestId("evidence-meta")).toContainText("image/png");
  await expect(dialog.getByTestId("evidence-meta")).toContainText("until reported");
  // 页面上没有任何图片、iframe 或内容预览。
  await expect(dialog.locator("img, iframe, video, object, embed")).toHaveCount(0);

  const download = dialog.getByRole("button", { name: "Download evidence file" });
  await giveReason(dialog, download);
  await expect(download).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
  expect(file.suggestedFilename()).toBe("evidence-inc1.bin");
  expect(readFileSync(await file.path()).byteLength).toBe(16);
  await expect(dialog.getByRole("status")).toContainText("cannot be used again");
});

test("staff: force sign-out reports whether the Access session was revoked", async ({ page }) => {
  await page.goto("/staff");
  await page
    .getByTestId("staff-moderator@char.pub")
    .getByRole("button", { name: "Sign out" })
    .click();
  const dialog = page.getByRole("dialog");
  const submit = dialog.getByRole("button", { name: "Sign out everywhere" });
  await giveReason(dialog, submit);
  await submit.click();
  await expect(page.getByRole("status")).toHaveText(
    "Signed out moderator@char.pub: revoked 1 session(s); Access session not revoked (Access API not configured).",
  );
});
