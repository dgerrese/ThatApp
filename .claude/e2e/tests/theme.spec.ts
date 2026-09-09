import { expect, test, type Page } from "@playwright/test";

// #7 made the rail's total and split live. These tests assert the rail's
// resting state, which is only resting while nothing is logged — and the
// e2e stack shares the dev database.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/entries**", (route) =>
    route.fulfill({ status: 200, json: { today: "2026-09-09", entries: [] } }),
  );
});

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
const LIGHT_GROUND = "oklch(0.972 0.008 60)";
const DARK_GROUND = "oklch(0.178 0.012 40)";
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

// The unit tests can only read source, so a minifier that reorders the
// declaration would pass them while shipping the opposite value — which is
// exactly what happened. This reads the built, computed value instead.
test("the root's color-scheme survives the build as dark before light", async ({ page }) => {
  await stubIssues(page);
  await page.goto("/");

  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  const colorScheme = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
  expect(colorScheme).toBe("dark light");
});

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
  const card = page.locator("that-card").first();
  await expect(card).toHaveCSS("background-color", "oklch(0.228 0.014 40)");
  await expect(card).not.toHaveCSS("box-shadow", "none");

  const addButton = page.getByRole("button", { name: "Add instance" });
  await expect(addButton).toHaveCSS("background-color", "oklch(0.72 0.19 330)");
  await expect(addButton).toHaveCSS("color", "oklch(0.16 0.02 330)");
});

// The rail is the one surface that does not invert: it is the instrument, and
// it carries one ground in both themes. A change that split it back into a
// pair is a regression no other assertion here would catch.
test("the rail carries one ground in both themes", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openSettings(page);
  await expect(page.locator("aside")).toHaveCSS("background-color", "oklch(0.105 0.006 60)");

  await page.getByRole("radio", { name: "Dark" }).check();
  await expect(page.locator("aside")).toHaveCSS("background-color", "oklch(0.105 0.006 60)");
});

// The rail's remaining resting regions, until #8 and #9 make them live. #7 made
// the total live, so it is a real figure here rather than a placeholder — and
// with nothing logged it reads 0h 00m either way. Push is present and disabled
// rather than absent, and the total is a total: the format rule says a figure
// you cannot start or stop carries no colon.
test("the rail renders its resting state", async ({ page }) => {
  await openSettings(page);

  await expect(page.locator("#rail-total")).toHaveText("0h 00m");
  await expect(page.locator("#rail-push")).toBeVisible();
  await expect(page.locator("#rail-push")).toBeDisabled();
});
