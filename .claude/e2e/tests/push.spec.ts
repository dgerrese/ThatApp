import { expect, test, type Page } from "@playwright/test";

/**
 * The colour a Tailwind utility class actually resolves to in this browser,
 * read off a throwaway probe rather than a literal `oklch()` string in this
 * file — so the assertion tracks web/src/styles.css itself and cannot drift
 * from it the way index.html's classes once did.
 */
async function computedColor(
  page: Page,
  className: string,
  property: "color" | "backgroundColor",
): Promise<string> {
  return page.evaluate(
    ({ className, property }) => {
      const probe = document.createElement("span");
      probe.className = className;
      document.body.appendChild(probe);
      const value = getComputedStyle(probe)[property];
      probe.remove();

      return value;
    },
    { className, property },
  );
}

async function stubToday(
  page: Page,
  entries: Array<{ id: number; issueKey: string; pushState: "unpushed" | "pushed" | "dirty" }>,
): Promise<void> {
  await page.route("**/api/instances", (route) => route.fulfill({ status: 200, json: [] }));
  await page.route("**/api/issues", (route) =>
    route.fulfill({ status: 200, json: { instances: [{ id: 1, name: "Site", issues: [], error: null }] } }),
  );
  await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));
  await page.route("**/api/entries**", (route) =>
    route.fulfill({
      status: 200,
      json: entries.map((entry) => ({
        ...entry,
        instanceId: 1,
        instanceName: "Site",
        instancePosition: 0,
        day: "2026-08-31",
        startedAt: "2026-08-31T09:00:00Z",
        seconds: 1800,
        comment: "",
      })),
    }),
  );
}

/**
 * Proves the partial-failure case survives end to end: the failed entry is
 * named with its own reason, and the succeeded one is not swept in among the
 * failures. A count alone ("1 of 2 failed") would pass a test that only
 * checked the summary — the point of this spec is the per-entry list beside
 * it, matching the style of .claude/e2e/tests/entries.spec.ts.
 */
test("a push where one entry fails names the entry that did not make it", async ({ page }) => {
  await page.route("**/api/instances", (route) => route.fulfill({ status: 200, json: [] }));
  // At least one instance, or Today hides the header (and the Push button
  // with it) and shows "No Jira instances yet" instead — see
  // renderResponse in web/src/views/today.ts.
  await page.route("**/api/issues", (route) =>
    route.fulfill({ status: 200, json: { instances: [{ id: 1, name: "Site", issues: [], error: null }] } }),
  );
  await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));

  await page.route("**/api/entries**", (route) =>
    route.fulfill({
      status: 200,
      json: [
        {
          id: 1, instanceId: 1, instanceName: "Site", instancePosition: 0,
          issueKey: "RIDGE-1", day: "2026-08-31", startedAt: "2026-08-31T09:00:00Z",
          seconds: 3600, comment: "one", pushState: "unpushed",
        },
        {
          id: 2, instanceId: 1, instanceName: "Site", instancePosition: 0,
          issueKey: "RIDGE-2", day: "2026-08-31", startedAt: "2026-08-31T10:00:00Z",
          seconds: 1800, comment: "two", pushState: "unpushed",
        },
      ],
    }),
  );

  await page.route("**/api/push**", (route) =>
    route.fulfill({
      status: 200,
      json: {
        day: "2026-08-31",
        results: [
          { entryId: 1, issueKey: "RIDGE-1", instanceId: 1, status: "pushed", worklogId: "wl-1" },
          {
            entryId: 2, issueKey: "RIDGE-2", instanceId: 1, status: "failed",
            error: { code: "instance_unreachable", message: "the Jira site could not be reached" },
          },
        ],
      },
    }),
  );

  await page.goto("/today");
  // The rail owns the only "Push to Jira" button — see web/src/rail.ts — so an
  // unscoped role query is unambiguous.
  await page.getByRole("button", { name: "Push to Jira" }).click();

  // The confirmation names what is about to be sent.
  await expect(page.getByText(/2 entries totalling/)).toBeVisible();
  await page.getByRole("button", { name: "Push", exact: true }).click();

  // The failure is named per entry, not summarised away.
  await expect(page.getByText(/1 of 2 entries did not reach Jira/)).toBeVisible();
  await expect(page.getByText(/RIDGE-2 — the Jira site could not be reached/)).toBeVisible();
  await expect(page.getByText("RIDGE-1 —")).toHaveCount(0);
});

test("a pending queue paints the unpushed count amber and Push live", async ({ page }) => {
  await stubToday(page, [{ id: 1, issueKey: "RIDGE-1", pushState: "unpushed" }]);

  await page.goto("/today");
  const unpushed = page.locator("#rail-unpushed");
  const push = page.getByRole("button", { name: "Push to Jira" });

  await expect(unpushed).toHaveText(/entry to push/);
  await expect(unpushed).toHaveCSS("color", await computedColor(page, "text-pending-rail", "color"));
  await expect(push).toBeEnabled();
  await expect(push).toHaveCSS(
    "background-color",
    await computedColor(page, "bg-primary-rail", "backgroundColor"),
  );
});

test("an empty queue leaves the unpushed count muted and Push resting", async ({ page }) => {
  await stubToday(page, []);

  await page.goto("/today");
  const unpushed = page.locator("#rail-unpushed");
  const push = page.getByRole("button", { name: "Push to Jira" });

  await expect(unpushed).toHaveText("Nothing to push");
  await expect(unpushed).toHaveCSS("color", await computedColor(page, "text-rail-muted", "color"));
  await expect(push).toBeDisabled();
  await expect(push).toHaveCSS(
    "background-color",
    await computedColor(page, "bg-transparent", "backgroundColor"),
  );
});
