import { expect, test } from "@playwright/test";

test("the app shell boots and the bundle runs", async ({ page }) => {
  // Today fetches on render, and the e2e stack shares the dev database, so this
  // has to be stubbed or the fan-out reaches real Jira instances.
  await page.route("**/api/issues", (route) =>
    route.fulfill({ status: 200, json: { instances: [] } }),
  );

  await page.goto("/");

  await expect(page).toHaveTitle("Work Dashboard");
  await expect(page.getByRole("heading", { name: "Work Dashboard" })).toBeVisible();

  // The shell ships an empty #view. Seeing Today's empty state proves the bundle
  // parsed, "/" redirected, and the dynamic import() of a view resolved.
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByText("No Jira instances yet.")).toBeVisible();
});

test("an unknown route still serves the app shell", async ({ page }) => {
  // Client-side routing: /week is a view, not a file. A 404 here would mean the
  // server's shell fallback regressed.
  const response = await page.goto("/week");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Work Dashboard" })).toBeVisible();
});
