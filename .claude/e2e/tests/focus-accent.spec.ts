import { expect, test, type Locator, type Page } from "@playwright/test";

// CB#108: every focused text field lights its border with --color-primary, the
// same as the search field and CB#89's Settings form fields already do. Pinned
// against the search field's own focused border, read fresh per theme, so a
// later drift of either token fails this rather than a hard-coded string.

async function stubToday(page: Page): Promise<void> {
  await page.route("**/api/issues", (route) =>
    route.fulfill({
      status: 200,
      json: {
        instances: [
          {
            id: 1,
            name: "Ridgeline",
            issues: [
              { key: "WORK-1", summary: "Fix the export", status: "In Progress", url: "" },
            ],
            error: null,
          },
        ],
      },
    }),
  );
  await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));
  await page.route("**/api/entries**", (route) =>
    route.fulfill({ status: 200, json: { today: "2026-09-28", entries: [] } }),
  );
}

async function stubTimerRunning(page: Page): Promise<void> {
  await page.route("**/api/timer", (route) =>
    route.fulfill({
      status: 200,
      json: {
        running: {
          instanceId: 1,
          issueKey: "WORK-1",
          startedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
        },
        stopped: null,
      },
    }),
  );
  await page.route("**/api/timer/stop", (route) =>
    route.fulfill({ status: 200, json: { stopped: null, discarded: false } }),
  );
}

async function stubSettings(page: Page): Promise<void> {
  await page.route("**/api/instances", (route) => route.fulfill({ status: 200, json: [] }));
}

function searchField(page: Page) {
  return page.getByRole("textbox", { name: "Search all instances" });
}

/** that-issue-search carries the border and the `focus-within:border-primary`
 *  utility on the custom element itself, not on the input inside it — the
 *  same group/field split CB#108's own duration control takes. */
async function searchFocusedBorderColor(page: Page): Promise<string> {
  return focusedBorderColor(page, page.locator("that-issue-search"), searchField(page));
}

/** Parks the pointer first, so a hover state never leaks into the reading —
 *  `:focus`/`:focus-within` are not modality-gated, so a plain `.focus()`
 *  reaches the same style a keyboard user's focus would. */
async function focusedBorderColor(page: Page, target: Locator, toFocus: Locator = target): Promise<string> {
  await page.mouse.move(0, 0);
  await toFocus.focus();

  return target.evaluate((el) => getComputedStyle(el).borderTopColor);
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
    });

    test(`the duration group's focused border matches the search field's, in ${theme}`, async ({ page }) => {
      await stubToday(page);
      await page.goto("/today");
      const want = await searchFocusedBorderColor(page);

      await page.getByRole("button", { name: /Log time against WORK-1/ }).click();
      const dialog = page.locator("that-entry-dialog dialog");
      const group = dialog.locator("that-duration > div");
      const got = await focusedBorderColor(page, group, dialog.getByLabel("Duration"));

      expect(got).toBe(want);
    });

    test(`the entries dialog's comment field focused border matches the search field's, in ${theme}`, async ({
      page,
    }) => {
      await stubToday(page);
      await page.goto("/today");
      const want = await searchFocusedBorderColor(page);

      await page.getByRole("button", { name: /Log time against WORK-1/ }).click();
      const comment = page.locator("that-entry-dialog dialog").getByPlaceholder("What did you work on?");
      const got = await focusedBorderColor(page, comment);

      expect(got).toBe(want);
    });

    test(`the stop dialog's comment field focused border matches the search field's, in ${theme}`, async ({
      page,
    }) => {
      await stubToday(page);
      await stubTimerRunning(page);
      await page.goto("/today");
      const want = await searchFocusedBorderColor(page);

      await page
        .locator("that-ticket-row", { hasText: "WORK-1" })
        .getByRole("button", { name: "stop timer" })
        .click();
      const comment = page.getByRole("dialog").getByRole("textbox", { name: "Description" });
      const got = await focusedBorderColor(page, comment);

      expect(got).toBe(want);
    });

    test(`Settings' four form fields focus with the search field's border, in ${theme}`, async ({ page }) => {
      await stubToday(page);
      await stubSettings(page);
      await page.goto("/today");
      const want = await searchFocusedBorderColor(page);

      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("button", { name: "Add an instance" }).click();

      for (const label of ["Name", "Site URL", "Account email", "API token"] as const) {
        const field = page.getByLabel(label, { exact: true });
        const got = await focusedBorderColor(page, field);
        expect(got).toBe(want);
      }
    });
  });
}
