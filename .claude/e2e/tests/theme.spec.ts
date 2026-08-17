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

test("a stored preference is applied before the bundle loads", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await bodyBackground(page)).toBe("rgb(10, 10, 10)");
});

// The failure the whole design is shaped around: storage that throws must
// degrade to following the OS, not to a hardcoded guess.
test("unreadable storage still themes from the OS", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("storage disabled");
    };
  });
  await page.goto("/");

  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  expect(await bodyBackground(page)).toBe("rgb(10, 10, 10)");
});

async function openSettings(page: Page): Promise<void> {
  await page.route("**/api/instances", (route) => route.fulfill({ status: 200, json: [] }));
  await page.goto("/settings");
}

test("choosing Dark themes the page and survives a reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openSettings(page);

  await page.getByRole("radio", { name: "Dark" }).check();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await bodyBackground(page)).toBe("rgb(10, 10, 10)");

  await page.reload();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await bodyBackground(page)).toBe("rgb(10, 10, 10)");
  await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
});

test("choosing Auto after Dark follows the OS again", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openSettings(page);

  await page.getByRole("radio", { name: "Dark" }).check();
  await page.getByRole("radio", { name: "Auto" }).check();

  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  expect(await bodyBackground(page)).toBe("rgb(250, 250, 250)");

  await page.reload();

  await expect(page.getByRole("radio", { name: "Auto" })).toBeChecked();
});

test("cards and buttons take the dark palette too", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openSettings(page);

  const card = page.locator("wd-card").first();
  await expect(card).toHaveCSS("background-color", "rgb(23, 23, 23)");
  await expect(card).toHaveCSS("border-color", "rgb(38, 38, 38)");

  const addButton = page.getByRole("button", { name: "Add instance" });
  await expect(addButton).toHaveCSS("background-color", "rgb(245, 245, 245)");
  await expect(addButton).toHaveCSS("color", "rgb(10, 10, 10)");
});
