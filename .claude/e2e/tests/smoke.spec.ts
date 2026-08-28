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

// Every stub in every spec but pwa.spec.ts rests on this. A request a service
// worker claims never reaches page.route, and sw.ts claims GET /api/issues and
// GET /api/pins (#12 task 5) — so a worker registering here would send those two
// to the real server, which shares the dev database and fans out to the owner's
// real Jira instances. playwright.config.ts blocks registration for exactly that
// reason; this is the standing check that the block is honoured, on both
// engines, on every run, rather than a claim measured once and taken on trust.
test("no service worker registers in a spec that has not opted back in", async ({ page }) => {
  await page.route("**/api/issues", (route) =>
    route.fulfill({ status: 200, json: { instances: [] } }),
  );

  await page.goto("/");

  // main.ts registers on the window load event, which goto() has already waited
  // for, so the attempt is in flight by the time this runs. Polled rather than
  // read once: blocked, the count is zero on the first probe and this returns
  // immediately; unblocked, it goes to one and never comes back.
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.getRegistrations().then((all) => all.length)))
    .toBe(0);
});
