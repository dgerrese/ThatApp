import { expect, test, type Page } from "@playwright/test";

/**
 * Computed colours rather than class names: a spec asserting classes would pass
 * against a stylesheet that never loaded.
 *
 * The tokens are authored in oklch, and both Firefox and Chromium serialise a
 * computed oklch() colour as oklch() rather than converting to rgb(), with
 * trailing zeros normalised so 0.010 comes back as 0.01. Verified in both
 * engines rather than assumed; if an engine ever converts to rgb() instead,
 * these two constants are the only thing that has to change.
 */
const LIGHT_GROUND = "oklch(0.975 0.006 70)";
const DARK_GROUND = "oklch(0.165 0.008 60)";
function bodyBackground(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

/**
 * "/" leads to Today, which fetches on render. Themeing is a property of the
 * shell rather than of any view, so the list can be empty — but it has to be
 * stubbed: the e2e stack shares the dev database, and an unstubbed Today would
 * fan out to the real Jira instances configured in it.
 */
async function stubIssues(page: Page): Promise<void> {
  await page.route("**/api/issues", (route) =>
    route.fulfill({ status: 200, json: { instances: [] } }),
  );
}

test("follows a light OS when nothing is stored", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await stubIssues(page);
  await page.goto("/");

  expect(await bodyBackground(page)).toBe(LIGHT_GROUND);
});

test("follows a dark OS when nothing is stored", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await stubIssues(page);
  await page.goto("/");

  expect(await bodyBackground(page)).toBe(DARK_GROUND);
});

test("a stored preference is applied before the bundle loads", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await stubIssues(page);
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await bodyBackground(page)).toBe(DARK_GROUND);
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
  await stubIssues(page);
  await page.goto("/");

  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  expect(await bodyBackground(page)).toBe(DARK_GROUND);
});

// The inline script only proves storage-that-throws survives at "/", which
// never imports settings.ts. appearanceCard() calls themePreference()
// synchronously inside render(); if that throw were left uncaught it would
// reject the awaited render() in router.ts and blank the whole Settings view.
test("unreadable storage still renders Settings, defaulting to Auto", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("storage disabled");
    };
  });
  await openSettings(page);

  await expect(page.getByRole("heading", { name: "Jira instances" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Auto" })).toBeChecked();
});

async function openSettings(page: Page): Promise<void> {
  await page.route("**/api/instances", (route) => route.fulfill({ status: 200, json: [] }));
  await page.goto("/settings");
}

test("choosing Light themes the page and survives a reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openSettings(page);

  await page.getByRole("radio", { name: "Light" }).check();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await bodyBackground(page)).toBe(LIGHT_GROUND);

  await page.reload();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await bodyBackground(page)).toBe(LIGHT_GROUND);
  await expect(page.getByRole("radio", { name: "Light" })).toBeChecked();
});

test("choosing Dark themes the page and survives a reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openSettings(page);

  await page.getByRole("radio", { name: "Dark" }).check();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await bodyBackground(page)).toBe(DARK_GROUND);

  await page.reload();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await bodyBackground(page)).toBe(DARK_GROUND);
  await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
});

test("choosing Auto after Dark follows the OS again", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openSettings(page);

  await page.getByRole("radio", { name: "Dark" }).check();
  await page.getByRole("radio", { name: "Auto" }).check();

  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  expect(await bodyBackground(page)).toBe(LIGHT_GROUND);

  await page.reload();

  await expect(page.getByRole("radio", { name: "Auto" })).toBeChecked();
});

test("cards and buttons take the dark palette too", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openSettings(page);

  // Cards are borderless now and sit on a shadow instead, so there is no
  // border colour left to assert. The shadow is what proves the treatment
  // survived, and a stylesheet that never loaded leaves it "none".
  const card = page.locator("wd-card").first();
  await expect(card).toHaveCSS("background-color", "oklch(0.215 0.01 60)");
  await expect(card).not.toHaveCSS("box-shadow", "none");

  const addButton = page.getByRole("button", { name: "Add instance" });
  await expect(addButton).toHaveCSS("background-color", "oklch(0.7 0.17 330)");
  await expect(addButton).toHaveCSS("color", "oklch(0.16 0.02 330)");
});

// The rail is the one surface that does not invert: it is the instrument, and
// it stays dark under a light OS. A change that flipped it is a regression no
// other assertion here would catch.
test("the rail stays dark in both themes", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openSettings(page);
  await expect(page.locator("aside")).toHaveCSS("background-color", "oklch(0.215 0.018 55)");

  await page.getByRole("radio", { name: "Dark" }).check();
  await expect(page.locator("aside")).toHaveCSS("background-color", "oklch(0.125 0.008 55)");
});

// Every rail region renders its resting state until #7-#9 make it live. Push is
// present and disabled rather than absent, and the total is a total: the format
// rule says a figure you cannot start or stop carries no colon.
test("the rail renders its resting state", async ({ page }) => {
  await openSettings(page);

  await expect(page.locator("#rail-total")).toHaveText("0h 00m");
  await expect(page.locator("#rail-push")).toBeVisible();
  await expect(page.locator("#rail-push")).toBeDisabled();
});
