import { expect, test, type Page } from "@playwright/test";

/**
 * Computed colours rather than class names: a spec asserting classes would pass
 * against a stylesheet that never loaded.
 */
function bodyBackground(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

// "/" has no registered route, so the router renders its placeholder and the
// page needs no API stub. Themeing is a property of the shell, not of a view.
test("follows a light OS when nothing is stored", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");

  expect(await bodyBackground(page)).toBe("rgb(250, 250, 250)");
});

test("follows a dark OS when nothing is stored", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");

  expect(await bodyBackground(page)).toBe("rgb(10, 10, 10)");
});
