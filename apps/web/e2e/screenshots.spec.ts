import { expect, test } from "@playwright/test";

/** 手动审阅用的截图，不在 CI 中运行（`SCREENSHOTS=1` 时才执行）。 */
test.skip(!process.env.SCREENSHOTS, "screenshots are only taken on demand");

for (const theme of ["light", "dark"] as const) {
  test(`screenshots (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.addInitScript((t) => window.localStorage.setItem("charpub.theme", t), theme);
    for (const [name, path] of [
      ["home", "/"],
      ["playground", "/playground"],
      ["diff", "/playground/diff"],
    ] as const) {
      await page.goto(path);
      if (name === "playground") {
        await page.getByText("Character + world + lorebook").click();
        await expect(page.getByRole("table")).toBeVisible();
      }
      await page.waitForTimeout(700);
      await page.screenshot({ path: `test-results/screens/${name}-${theme}.png`, fullPage: true });
    }
  });
}
