/**
 * Admin 各模块的主流程（mock 后端，以 owner 身份）。每个需要理由的操作都先断言
 * 没有理由时无法提交。
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

test("report queue: claim, force rating on a creation report, yank on a release report", async ({
  page,
}) => {
  await page.goto("/reports");
  const rp1 = page.getByTestId("report-rp1");
  const rp2 = page.getByTestId("report-rp2");

  await rp1.getByRole("button", { name: "Claim", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await giveReason(dialog, dialog.getByRole("button", { name: "Claim report" }));
  await dialog.getByRole("button", { name: "Claim report" }).click();
  await expect(dialog).toBeHidden();
  await expect(rp1).toContainText("claimed");
  await expect(rp1).toContainText("owner@char.pub");
  await expect(rp1.getByRole("button", { name: "Claim", exact: true })).toHaveCount(0);

  // 举报对象是 Creation：可以隐藏或强制评级，不能 yank。
  await expect(rp1.getByRole("button", { name: "Yank release" })).toHaveCount(0);
  await rp1.getByRole("button", { name: "Force rating" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox").selectOption("mature");
  await giveReason(dialog, dialog.getByRole("button", { name: "Force rating" }));
  await dialog.getByRole("button", { name: "Force rating" }).click();
  await expect(dialog).toBeHidden();
  await expect(rp1).toContainText("resolved");

  // 举报对象是 Release：只能 yank，不能隐藏或强制评级。
  await expect(rp2.getByRole("button", { name: "Hide content" })).toHaveCount(0);
  await expect(rp2.getByRole("button", { name: "Force rating" })).toHaveCount(0);
  await rp2.getByRole("button", { name: "Yank release" }).click();
  dialog = page.getByRole("dialog");
  await giveReason(dialog, dialog.getByRole("button", { name: "Yank release" }));
  await dialog.getByRole("button", { name: "Yank release" }).click();
  await expect(rp2).toContainText("resolved");

  await navigate(page, "Content");
  await expect(page.getByText("forced mature")).toBeVisible();
  await expect(page.getByRole("row", { name: /1\.0\.0/ })).toContainText("yanked");
});

test("content: ratings can only be raised; hide, restore, yank, start a tombstone", async ({
  page,
}) => {
  await page.goto("/content");
  await expect(page.getByText("effective teen")).toBeVisible();

  await page.getByRole("button", { name: "Force rating", exact: true }).click();
  let dialog = page.getByRole("dialog");
  const select = dialog.getByRole("combobox");
  await expect(select.locator('option[value="general"]')).toHaveJSProperty("disabled", true);
  await expect(select.locator('option[value="teen"]')).toHaveJSProperty("disabled", false);
  await expect(select).toHaveValue("mature");
  await giveReason(dialog, dialog.getByRole("button", { name: "Confirm" }));
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("forced mature")).toBeVisible();
  await expect(page.getByText("effective mature")).toBeVisible();

  await page.getByRole("button", { name: "Force rating", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.locator('option[value="teen"]')).toHaveJSProperty("disabled", true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Hide", exact: true }).click();
  dialog = page.getByRole("dialog");
  await giveReason(dialog, dialog.getByRole("button", { name: "Confirm" }));
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("button", { name: "Restore", exact: true })).toBeVisible();
  await expect(page.locator("main").getByText("hidden", { exact: true })).toBeVisible();

  const release = page.getByRole("row", { name: /1\.0\.0/ });
  await release.getByRole("button", { name: "Yank" }).click();
  dialog = page.getByRole("dialog");
  await giveReason(dialog, dialog.getByRole("button", { name: "Confirm" }));
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(release).toContainText("yanked");
  await expect(release.getByRole("button", { name: "Yank" })).toHaveCount(0);

  await page.getByRole("link", { name: "Start tombstone" }).click();
  await expect(page).toHaveURL(/\/tombstone\?subject=/);
  await expect(page.getByLabel(/^Subject/)).toHaveValue("@fanworks/borrowed-hero");
});

test("tombstone: preview impact, four-eyes request, cooling-off, second-person confirm, cancel", async ({
  page,
}) => {
  await page.goto("/tombstone");
  await page.getByLabel(/^Subject/).fill("@commons/night-city#world");
  await page.getByRole("button", { name: "Preview impact" }).click();
  const preview = page.getByRole("region", { name: "Impact preview" });
  await expect(preview).toContainText("62 releases");
  await expect(preview).toContainText("needs a second staff member");
  await expect(preview).toContainText("@user1 @user2");

  await preview.getByLabel("Public reason code").selectOption("policy.illegal");
  const submit = preview.getByRole("button", { name: "Request tombstone (needs confirmation)" });
  await giveReason(preview, submit);
  await expect(submit).toBeDisabled();
  await preview.getByRole("checkbox").check();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(preview.getByRole("status")).toHaveText("Waiting for confirmation (ap1).");

  const approvals = page.getByRole("region", { name: "Pending approvals" });
  const mine = page.getByTestId("approval-ap1");
  await expect(mine.getByTestId("cooling-off")).toContainText(/2[34]h \d+m/);
  await expect(mine.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(0);

  // 另一名员工发起的请求可以直接确认，确认后立即执行。
  const other = page.getByTestId("approval-ap-ts-1");
  await other.getByRole("button", { name: "Confirm", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await giveReason(dialog, dialog.getByRole("button", { name: "Confirm and execute" }));
  await dialog.getByRole("button", { name: "Confirm and execute" }).click();
  await expect(approvals.getByRole("status")).toHaveText(
    "Confirmed ap-ts-1; the action was executed.",
  );
  await expect(other).toHaveCount(0);

  // 自己在 25 小时前发起、当时没有其他有资格的员工：冷静期已过，可以自己确认。
  const selfAfterCooling = page.getByTestId("approval-ap-owner-1");
  await expect(selfAfterCooling).toContainText("The cooling-off period is over");
  await expect(
    selfAfterCooling.getByRole("button", { name: "Confirm", exact: true }),
  ).toBeVisible();

  await mine.getByRole("button", { name: "Cancel request" }).click();
  dialog = page.getByRole("dialog");
  await giveReason(dialog, dialog.getByRole("button", { name: "Cancel request" }));
  await dialog.getByRole("button", { name: "Cancel request" }).click();
  await expect(approvals.getByRole("status")).toHaveText("Cancelled ap1.");
  await expect(mine).toHaveCount(0);
});

test("users: details, ban and unban; CSAM-locked accounts cannot be re-banned and need four-eyes to unban", async ({
  page,
}) => {
  await page.goto("/users");
  const alice = page.getByTestId("user-u_alice");
  const locked = page.getByTestId("user-u_locked");

  await alice.getByRole("button", { name: "Details" }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("list", { name: "Moderation history" })).toContainText(
    "creation.force_rating",
  );
  await expect(dialog).toContainText("@alice");
  await page.keyboard.press("Escape");

  await alice.getByRole("button", { name: "Ban", exact: true }).click();
  dialog = page.getByRole("dialog");
  await giveReason(dialog, dialog.getByRole("button", { name: "Ban account" }));
  await dialog.getByRole("button", { name: "Ban account" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Banned alice@example.com; all sessions and tokens were revoked.",
  );
  await expect(alice).toContainText("banned");
  await expect(alice).toContainText("0 / 0");

  await alice.getByRole("button", { name: "Unban" }).click();
  dialog = page.getByRole("dialog");
  await giveReason(dialog, dialog.getByRole("button", { name: "Unban account" }));
  await dialog.getByRole("button", { name: "Unban account" }).click();
  await expect(page.getByRole("status")).toHaveText("Unbanned alice@example.com.");
  await expect(alice).toContainText("active");

  await expect(locked).toContainText("csam lock");
  await expect(locked.getByRole("button", { name: "Ban", exact: true })).toHaveCount(0);
  await locked.getByRole("button", { name: "Unban" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("A second staff member must confirm.");
  await giveReason(dialog, dialog.getByRole("button", { name: "Unban account" }));
  await dialog.getByRole("button", { name: "Unban account" }).click();
  await expect(page.getByRole("status")).toContainText("needs a second staff member (ap1)");
  await expect(locked).toContainText("csam lock");

  await navigate(page, "Approvals");
  const approval = page.getByTestId("approval-ap1");
  await expect(approval).toContainText("unban.csam");
  await expect(approval).toContainText("user:u_locked");
  await expect(approval.getByTestId("cooling-off")).toBeVisible();
});

test("namespaces: freeze, rename with permanent redirect, reserve and release names", async ({
  page,
}) => {
  await page.goto("/namespaces");
  const alice = page.getByTestId("namespace-alice");
  await expect(
    page.getByTestId("namespace-commons").getByRole("button", { name: "Freeze" }),
  ).toHaveCount(0);

  await alice.getByRole("button", { name: "Freeze" }).click();
  let dialog = page.getByRole("dialog");
  await giveReason(dialog, dialog.getByRole("button", { name: "Confirm" }));
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("status")).toHaveText("Froze @alice.");
  await expect(alice).toContainText("suspended");
  await expect(alice.getByRole("button", { name: "Unfreeze" })).toBeVisible();

  await alice.getByRole("button", { name: "Rename" }).click();
  dialog = page.getByRole("dialog");
  const confirm = dialog.getByRole("button", { name: "Confirm" });
  await dialog.getByLabel(/^Reason/).fill(REASON);
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("New name").fill("fanworks");
  await confirm.click();
  await expect(dialog.getByRole("alert")).toHaveText("Failed: namespace.taken");
  await dialog.getByLabel("New name").fill("alice-2");
  await confirm.click();
  await expect(page.getByRole("status")).toHaveText(
    "Renamed @alice to @alice-2; the old name now redirects.",
  );
  await expect(page.getByTestId("namespace-alice-2")).toContainText("@alice @alice-old");

  await page.getByRole("button", { name: "Reserve a name" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("brand-x");
  await giveReason(dialog, dialog.getByRole("button", { name: "Confirm" }));
  await dialog.getByRole("button", { name: "Confirm" }).click();
  const reserved = page.getByRole("list", { name: "Reserved names" });
  await expect(reserved).toContainText("@brand-x");

  await page.getByRole("button", { name: "Release @brand-x" }).click();
  dialog = page.getByRole("dialog");
  await giveReason(dialog, dialog.getByRole("button", { name: "Confirm" }));
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("status")).toHaveText("Released the reservation of @brand-x.");
  await expect(reserved).not.toContainText("@brand-x");
});

test("legal: deadlines, register a request, audited detail view, case export, legal tombstone", async ({
  page,
}) => {
  await page.goto("/legal");
  await expect(page.getByTestId("legal-lr1")).toContainText(/due in \d+h/);
  await expect(page.getByTestId("legal-lr2")).not.toContainText(/due in|overdue/);

  await page.getByRole("button", { name: "Register request" }).click();
  let dialog = page.getByRole("dialog");
  const register = dialog.getByRole("button", { name: "Register request" });
  await dialog.getByLabel(/^Reason/).fill(REASON);
  await expect(register).toBeDisabled();
  await dialog.getByLabel("Requester name").fill("Example Studio");
  await dialog.getByLabel(/^Subjects/).fill("@alice/fan-art");
  await expect(register).toBeEnabled();
  await dialog.getByLabel(/^Reason/).fill("short");
  await expect(register).toBeDisabled();
  await dialog.getByLabel(/^Reason/).fill(REASON);
  await register.click();
  await expect(page.getByRole("status")).toHaveText("Registered legal request lr4.");
  await expect(page.getByTestId("legal-lr4")).toContainText("@alice/fan-art");

  await page.getByTestId("legal-lr1").getByRole("button", { name: "Open" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("recorded in the audit log");
  await expect(dialog.getByTestId("legal-requester")).toContainText("Example Rights Agency");
  await expect(dialog.getByTestId("legal-requester")).toContainText("notices@example.org");

  // 案件导出由服务端生成，包含解密后的申请人信息，必须填写理由。
  await dialog.getByRole("button", { name: "Export case record" }).click();
  const exportForm = dialog.getByRole("region", { name: "Export case record" });
  const exportButton = exportForm.getByRole("button", { name: "Download case record" });
  await giveReason(exportForm, exportButton);
  const [download] = await Promise.all([page.waitForEvent("download"), exportButton.click()]);
  expect(download.suggestedFilename()).toBe("legal-request-lr1.json");
  const record = JSON.parse(readFileSync(await download.path(), "utf8")) as {
    request: { requester: { name: string } };
    audit: { action: string }[];
  };
  expect(record.request.requester.name).toBe("Example Rights Agency");
  expect(record.audit.map((a) => a.action)).toContain("legal.view");
  expect(record.audit.map((a) => a.action)).toContain("legal.export");

  await dialog.getByRole("link", { name: "Preview tombstone" }).click();
  await expect(page).toHaveURL(/\/tombstone\?subject=/);
  await page.getByRole("button", { name: "Preview impact" }).click();
  const preview = page.getByRole("region", { name: "Impact preview" });
  await expect(preview).toContainText("3 releases");
  await expect(preview.getByLabel("Public reason code")).toHaveValue("legal.dmca");
  const execute = preview.getByRole("button", { name: "Execute tombstone" });
  await giveReason(preview, execute);
  await preview.getByRole("checkbox").check();
  // 法律依据的下架必须关联一个法律请求。
  await expect(execute).toBeDisabled();
  await preview.getByLabel("Legal request").selectOption("lr1");
  await expect(execute).toBeEnabled();
  await execute.click();
  await expect(preview.getByRole("status")).toHaveText(
    "Tombstone executed. Removal jobs are running.",
  );
});

test("csam: record an NCMEC report and flag content manually", async ({ page }) => {
  await page.goto("/csam");
  const inc1 = page.getByTestId("incident-inc1");
  await inc1.getByRole("button", { name: "Record NCMEC report" }).click();
  let dialog = page.getByRole("dialog");
  const record = dialog.getByRole("button", { name: "Record report" });
  await giveReason(dialog, record);
  await expect(record).toBeDisabled();
  await dialog.getByLabel("NCMEC report ID").fill("NCMEC-2026-0001");
  await record.click();
  await expect(page.getByRole("status")).toHaveText(
    "Recorded NCMEC report NCMEC-2026-0001 for inc1.",
  );
  await expect(inc1).toContainText("NCMEC-2026-0001");
  await expect(inc1).toContainText("reported");
  await expect(inc1.getByRole("button", { name: "Record NCMEC report" })).toHaveCount(0);

  await page.getByRole("button", { name: "Flag content as CSAM" }).click();
  dialog = page.getByRole("dialog");
  const flag = dialog.getByRole("button", { name: "Flag and quarantine" });
  await giveReason(dialog, flag);
  await dialog.getByRole("checkbox").check();
  await dialog.getByLabel("Content digest").fill("sha256:not-a-digest");
  await expect(flag).toBeDisabled();
  await dialog.getByLabel("Content digest").fill(`sha256:${"c0ffee00".repeat(8)}`);
  await expect(flag).toBeEnabled();
  await flag.click();
  await expect(page.getByRole("status")).toHaveText(
    "Opened incident inc2; 1 release(s) queued for takedown.",
  );
  await expect(page.getByTestId("incident-inc2")).toContainText("staff_flag");
  await expect(page.getByTestId("incident-inc2")).toContainText("open");
});

test("jobs: retry a dead-letter job and cancel a failed one", async ({ page }) => {
  await page.goto("/jobs");
  const dead = page.getByTestId("job-job_2");
  await expect(dead).toContainText("dead letter");
  await expect(page.getByTestId("queue-tombstone.cascade")).toContainText("1");

  await dead.getByRole("button", { name: "Retry" }).click();
  let dialog = page.getByRole("dialog");
  await giveReason(dialog, dialog.getByRole("button", { name: "Retry job" }));
  await dialog.getByRole("button", { name: "Retry job" }).click();
  await expect(page.getByRole("status")).toHaveText("Re-queued job job_2.");
  await expect(dead).toHaveCount(0);
  await expect(page.getByTestId("queue-tombstone.cascade").getByRole("cell").nth(4)).toHaveText(
    "0",
  );

  await page.getByTestId("job-job_1").getByRole("button", { name: "Cancel" }).click();
  dialog = page.getByRole("dialog");
  await giveReason(dialog, dialog.getByRole("button", { name: "Cancel job" }));
  await dialog.getByRole("button", { name: "Cancel job" }).click();
  await expect(page.getByRole("status")).toHaveText("Cancelled job job_1.");
  await expect(page.getByText("No failed jobs.")).toBeVisible();
});

test("kill switch, dashboard and audit: toggle, see it everywhere, verify and export the log", async ({
  page,
}) => {
  await page.goto("/flags");
  const uploads = page.getByTestId("flag-uploads");
  await uploads.getByRole("button", { name: "Switch off" }).click();
  const dialog = page.getByRole("dialog");
  const submit = dialog.getByRole("button", { name: "Switch off uploads" });
  await giveReason(dialog, submit, "Abuse wave from a single network.");
  await expect(submit).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  await submit.click();
  await expect(dialog).toBeHidden();
  await expect(uploads).toContainText("off");
  await expect(uploads).toContainText("Abuse wave from a single network.");

  await navigate(page, "Dashboard");
  await expect(page.locator("li", { hasText: "Uploads" })).toContainText(
    "Abuse wave from a single network.",
  );
  await expect(page.getByTestId("tile-Pending approvals")).toContainText("2");
  await expect(page.getByTestId("tile-Queue backlog")).toContainText("16");
  await expect(page.getByTestId("tile-Open legal requests")).toContainText("next deadline");

  await navigate(page, "Audit log");
  await expect(page.getByRole("row").nth(1)).toContainText("flag:uploads");
  await page.getByLabel("Subject").fill("flag:uploads");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.getByRole("cell", { name: "flag:uploads" })).toHaveCount(1);
  await page.getByRole("button", { name: "Verify hash chain" }).click();
  await expect(page.getByRole("status")).toContainText("Chain intact · 4 entries");

  // 导出由服务端生成 NDJSON，必须填写理由。
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const exportDialog = page.getByRole("dialog");
  const exportButton = exportDialog.getByRole("button", { name: "Download NDJSON" });
  await giveReason(exportDialog, exportButton);
  const [download] = await Promise.all([page.waitForEvent("download"), exportButton.click()]);
  expect(download.suggestedFilename()).toMatch(/^audit-\d{4}-\d{2}-\d{2}\.ndjson$/);
  const exported = readFileSync(await download.path(), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { action: string; subject: string });
  expect(exported).toHaveLength(1);
  expect(exported[0]).toMatchObject({ action: "flag.toggle", subject: "flag:uploads" });
});

test("staff: the only owner keeps the owner role; adding is direct, removing an owner needs four-eyes", async ({
  page,
}) => {
  await page.goto("/staff");
  await page
    .getByTestId("staff-owner@char.pub")
    .getByRole("button", { name: "Edit roles" })
    .click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("checkbox", { name: /^owner/ })).toBeDisabled();
  await expect(dialog).toContainText("At least one owner must remain.");
  await page.keyboard.press("Escape");

  const mod = page.getByTestId("staff-moderator@char.pub");
  await mod.getByRole("button", { name: "Edit roles" }).click();
  dialog = page.getByRole("dialog");
  const save = dialog.getByRole("button", { name: "Save roles" });
  await dialog.getByLabel(/^Reason/).fill(REASON);
  await expect(save).toBeDisabled();
  await dialog.getByRole("checkbox", { name: /^owner/ }).check();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole("status")).toHaveText("Updated roles of moderator@char.pub.");
  await expect(mod).toContainText("owner");

  await mod.getByRole("button", { name: "Edit roles" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox", { name: /^owner/ }).uncheck();
  await giveReason(dialog, dialog.getByRole("button", { name: "Save roles" }));
  await dialog.getByRole("button", { name: "Save roles" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Removing the owner role needs a second owner to confirm (ap1).",
  );
  await expect(mod).toContainText("owner");

  await navigate(page, "Approvals");
  await expect(page.getByTestId("approval-ap1")).toContainText("staff.remove_owner");
});
