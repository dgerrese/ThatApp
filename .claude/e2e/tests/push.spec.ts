import { expect, test } from "@playwright/test";

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
