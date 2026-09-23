/**
 * 权限矩阵：按角色表自动生成用例。每个角色打开每个模块，检查导航入口、页面本身
 * （无权限时显示提示而不是空白）以及页面上每个操作是否与该角色的能力一致。
 *
 * 另外检查后端拒绝（403）时界面会显示错误，而不是静默失败：mock 后端可以按另一组
 * 角色判断权限，模拟页面打开之后员工的角色被收回。
 */
import { expect, test } from "@playwright/test";
import { STAFF_ROLES, type StaffCapability } from "../src/lib/api";
import { EXPECTED_CAPABILITIES, MODULES } from "../src/test/role-matrix";
import { collectErrors, giveReason, signInAs } from "./helpers";

for (const role of STAFF_ROLES) {
  test.describe(`as ${role}`, () => {
    const caps = EXPECTED_CAPABILITIES[role];
    const has = (any: readonly StaffCapability[]) => any.some((c) => caps.includes(c));

    for (const m of MODULES) {
      test(`${m.path} matches the ${role} capabilities`, async ({ page }) => {
        const errors = collectErrors(page);
        await signInAs(page, [role]);
        await page.goto(m.path);
        await expect(page.getByTestId("staff-email")).toHaveText(`${role}@char.pub`);

        const nav = page.getByRole("navigation", { name: "Admin" });
        await expect(nav.getByRole("link", { name: m.nav, exact: true })).toHaveCount(
          has(m.navAny) ? 1 : 0,
        );

        const main = page.locator("main");
        if (m.pageAny && !has(m.pageAny)) {
          await expect(main.getByRole("alert")).toContainText("You do not have permission");
          await expect(main.getByRole("heading", { level: 1 })).toHaveCount(0);
          expect(errors).toEqual([]);
          return;
        }

        await expect(
          main.getByRole("heading", { level: 1, name: m.heading, exact: true }),
        ).toBeVisible();
        await expect(main.getByText(m.loaded).first()).toBeVisible();
        for (const c of m.controls) {
          const control = main
            .getByRole("button", { name: c.name, exact: true })
            .or(main.getByRole("link", { name: c.name, exact: true }));
          if (has(c.any)) await expect(control.first(), c.name).toBeVisible();
          else await expect(control, c.name).toHaveCount(0);
        }
        expect(errors).toEqual([]);
      });
    }
  });
}

test("a write refused by the server (403) is shown in the dialog, not swallowed", async ({
  page,
}) => {
  await signInAs(page, ["owner"], { enforce: ["viewer"] });
  await page.goto("/flags");
  await page.getByTestId("flag-uploads").getByRole("button", { name: "Switch off" }).click();
  const dialog = page.getByRole("dialog");
  const submit = dialog.getByRole("button", { name: "Switch off uploads" });
  await giveReason(dialog, submit);
  await dialog.getByRole("checkbox").check();
  await submit.click();
  await expect(dialog.getByRole("alert")).toHaveText("Failed: admin.forbidden");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("flag-uploads")).toContainText("on");
});

test("a read refused by the server (403) shows a permission error on the page", async ({
  page,
}) => {
  await signInAs(page, ["owner"], { enforce: ["moderator"] });
  await page.goto("/jobs");
  await expect(page.getByRole("heading", { name: "Jobs", level: 1 })).toBeVisible();
  const alerts = page.locator("main").getByRole("alert");
  await expect(alerts.first()).toContainText("You do not have permission");
  await expect(alerts.first()).toContainText("admin.forbidden");
  await expect(page.getByTestId("job-job_1")).toHaveCount(0);
});

test("the mock role switcher changes what the page offers", async ({ page }) => {
  // 新的浏览器上下文里没有保存角色，默认是 owner；切换后页面重新加载。
  await page.goto("/");
  await expect(page.getByTestId("staff-email")).toHaveText("owner@char.pub");
  const nav = page.getByRole("navigation", { name: "Admin" });
  await expect(nav.getByRole("link", { name: "Staff", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Mock staff role" }).selectOption("legal");
  await expect(page.getByTestId("staff-email")).toHaveText("legal@char.pub");
  await expect(nav.getByRole("link", { name: "Legal", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Staff", exact: true })).toHaveCount(0);
});
