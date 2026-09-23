/**
 * Admin 主流程中之前没有覆盖到的动作（mock 后端，以 owner 身份）：举报的驳回与升级、带期限
 * 的封禁。每个需要理由的操作都先断言没有理由时无法提交。
 */
import { expect, test } from "@playwright/test";
import { collectErrors, giveReason, navigate, signInAs } from "./helpers";

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = collectErrors(page);
  await signInAs(page, ["owner"]);
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

test("report queue: sorted by severity; dismiss one report, escalate another", async ({ page }) => {
  await page.goto("/reports");
  // 按严重度从高到低排序。
  const order = ["critical", "high", "medium", "low"];
  // 先等队列加载完，再一次性读取所有行。
  await expect(page.getByTestId("report-rp3")).toBeVisible();
  const severities = await page.locator("tbody tr td:first-child").allInnerTexts();
  expect(severities.length).toBeGreaterThan(1);
  const ranks = severities.map((s) => order.indexOf(s.trim()));
  expect(ranks).toEqual([...ranks].sort((a, b) => a - b));

  const spam = page.getByTestId("report-rp3");
  await spam.getByRole("button", { name: "Dismiss" }).click();
  let dialog = page.getByRole("dialog");
  const dismiss = dialog.getByRole("button", { name: "Dismiss" });
  await giveReason(dialog, dismiss);
  await dismiss.click();
  await expect(dialog).toBeHidden();
  await expect(spam).toContainText("dismissed");
  // 处理完的举报没有操作按钮。
  await expect(spam.getByRole("button")).toHaveCount(0);

  const copyright = page.getByTestId("report-rp1");
  await copyright.getByRole("button", { name: "Escalate to T&S / legal" }).click();
  dialog = page.getByRole("dialog");
  const escalate = dialog.getByRole("button", { name: "Escalate to T&S / legal" });
  await giveReason(dialog, escalate);
  await escalate.click();
  await expect(dialog).toBeHidden();
  // 升级之后举报仍然由员工持有，等待 T&S 或 legal 处理。
  await expect(copyright).toContainText("claimed");
  await expect(copyright).toContainText("owner@char.pub");

  await navigate(page, "Audit log");
  await expect(page.getByText("report.dismiss").first()).toBeVisible();
  await expect(page.getByText("report.escalate").first()).toBeVisible();
});

test("users: a ban can have an end date, and it is shown on the account", async ({ page }) => {
  await page.goto("/users");
  const alice = page.getByTestId("user-u_alice");
  await alice.getByRole("button", { name: "Ban", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Until (optional; empty means indefinitely)").fill("2099-01-31T12:00");
  const submit = dialog.getByRole("button", { name: "Ban account" });
  await giveReason(dialog, submit);
  await submit.click();
  await expect(page.getByRole("status")).toHaveText(
    "Banned alice@example.com; all sessions and tokens were revoked.",
  );
  await expect(alice).toContainText("banned");
  await expect(alice).toContainText("until");
  await expect(alice).toContainText("2099");
});
