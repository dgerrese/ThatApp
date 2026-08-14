import { expect, test } from "@playwright/test";

test("the app shell boots and the bundle runs", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Work Dashboard");
  await expect(page.getByRole("heading", { name: "Work Dashboard" })).toBeVisible();

  // The shell ships an empty #view; only the router's placeholder render fills
  // it in. Seeing this text proves the bundle parsed and ran. It does not prove
  // the dynamic import() on /settings resolves, and it does not prove the
  // backend is reachable — both are Task 13's to cover once Settings exists.
  await expect(
    page.getByText("Nothing here yet. Add a Jira instance to get started."),
  ).toBeVisible();
});

test("an unknown route still serves the app shell", async ({ page }) => {
  // Client-side routing: /week is a view, not a file. A 404 here would mean the
  // server's shell fallback regressed.
  const response = await page.goto("/week");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Work Dashboard" })).toBeVisible();
});
