import { expect, test } from "@playwright/test";

test("the app shell boots and reaches the API", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Work Dashboard");
  await expect(page.getByRole("heading", { name: "Work Dashboard" })).toBeVisible();

  // The shell ships this text; the module rewrites it only after /api/health
  // resolves. Seeing it change proves the bundle parsed and the fetch worked.
  await expect(page.locator("#status")).toHaveText("Server is up.");
});

test("an unknown route still serves the app shell", async ({ page }) => {
  // Client-side routing: /week is a view, not a file. A 404 here would mean the
  // server's shell fallback regressed.
  const response = await page.goto("/week");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Work Dashboard" })).toBeVisible();
});
