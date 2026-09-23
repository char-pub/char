/**
 * Playwright 测试的公共工具：以某个员工角色打开 mock 构建、收集页面错误、填写理由。
 *
 * mock 后端的数据在内存里，每次整页加载都会重置；同一个测试内要保留状态时，用导航栏的
 * 链接在单页应用内跳转，不要调用 `page.goto`。
 */
import { expect, type Locator, type Page } from "@playwright/test";
import type { StaffRole } from "../src/lib/api";
import { MOCK_ENFORCE_ROLES_KEY, MOCK_ROLES_KEY } from "../src/lib/mock-keys";

export const REASON = "Reviewed the evidence and confirmed.";

/**
 * 以这些角色打开页面。`enforce` 让 mock 后端按另一组角色判断权限，
 * 模拟页面打开之后员工的角色被收回。
 */
export async function signInAs(
  page: Page,
  roles: StaffRole[],
  opts: { enforce?: StaffRole[] } = {},
): Promise<void> {
  await page.addInitScript(
    ({ rolesKey, enforceKey, value, enforce }) => {
      window.localStorage.setItem(rolesKey, value);
      if (enforce) window.localStorage.setItem(enforceKey, enforce);
      else window.localStorage.removeItem(enforceKey);
    },
    {
      rolesKey: MOCK_ROLES_KEY,
      enforceKey: MOCK_ENFORCE_ROLES_KEY,
      value: roles.join(","),
      enforce: opts.enforce?.join(",") ?? "",
    },
  );
}

/** 收集未捕获的异常与 console error；测试结束时应为空。 */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
}

/** 在单页应用内用导航栏跳转，保留 mock 后端的状态。 */
export async function navigate(page: Page, label: string): Promise<void> {
  await page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: label }).click();
}

/**
 * 断言提交按钮在填写理由之前不可用，然后填写理由。
 * 理由是审计记录的一部分，所有员工写操作都必须填写。
 */
export async function giveReason(scope: Locator, submit: Locator, reason = REASON): Promise<void> {
  await expect(submit).toBeDisabled();
  await scope.getByLabel(/^Reason/).fill("too short");
  await expect(submit).toBeDisabled();
  await scope.getByLabel(/^Reason/).fill(reason);
}
