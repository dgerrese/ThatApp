import { expect, test, type Page } from "@playwright/test";

const DAYS = [
  "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10",
  "2026-09-11", "2026-09-12", "2026-09-13",
];

/** Every endpoint Settings, Today and Week read, answered empty. */
async function stubApi(page: Page): Promise<void> {
  await page.route("**/api/instances", (route) => route.fulfill({ status: 200, json: [] }));
  await page.route("**/api/issues", (route) =>
    route.fulfill({ status: 200, json: { instances: [] } }),
  );
  await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));
  await page.route("**/api/entries**", (route) =>
    route.fulfill({ status: 200, json: { today: DAYS[0], entries: [] } }),
  );
  await page.route("**/api/week**", (route) =>
    route.fulfill({
      status: 200,
      json: {
        start: DAYS[0],
        end: DAYS[6],
        prevStart: "2026-08-31",
        nextStart: "2026-09-14",
        weekNumber: 37,
        days: DAYS.map((day) => ({ day, seconds: 0, pushState: null })),
        rows: [],
        seconds: 0,
      },
    }),
  );
}

const ROUTE_TABLE_TODAY = /["']\/today["']\s*:\s*\(\)\s*=>\s*import\(\s*["']\.\/(chunk-[\w-]+\.js)["']\s*\)/;

test("a view whose import resolves after a later navigation never replaces it", async ({ page }) => {
  await stubApi(page);

  let todayChunk: string | undefined;
  let releaseToday: () => void = () => {};
  const todayReleased = new Promise<void>((resolve) => {
    releaseToday = resolve;
  });
  let todayRequested: () => void = () => {};
  const todayWasRequested = new Promise<void>((resolve) => {
    todayRequested = resolve;
  });

  // Plain fetch() against THAT_BASE_URL rather than route.fetch(): the
  // chromium project (see playwright.config.ts) points the *browser* at
  // "localhost" and relies on a Chromium-only --host-resolver-rules flag to
  // land it on the real host — a mapping route.fetch()'s own Node-side
  // request never sees, so it dials literal localhost and gets ECONNREFUSED.
  // Same workaround tooltip.spec.ts uses, for the same reason.
  const base = process.env["THAT_BASE_URL"] ?? "http://that-app:8080";
  await page.route("**/chunk-*.js", async (route) => {
    const requested = new URL(route.request().url());
    const file = requested.pathname.slice(1);
    if (file === todayChunk) {
      todayRequested();
      await todayReleased;
    }

    const response = await fetch(`${base}${requested.pathname}${requested.search}`);
    const body = await response.text();
    todayChunk ??= ROUTE_TABLE_TODAY.exec(body)?.[1];
    await route.fulfill({
      status: response.status,
      body,
      contentType: response.headers.get("content-type") ?? "text/javascript",
    });
  });

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Add an instance" })).toBeVisible();
  expect(todayChunk, "the router's route table was not found in any chunk").toBeDefined();

  await page.getByRole("link", { name: "Today", exact: true }).click();
  await todayWasRequested;

  await page.getByRole("link", { name: "Week", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Week 37 · 7–13 Sep" })).toBeVisible();

  releaseToday();
  await page.evaluate((file) => import(`/${file}`).then(() => undefined), todayChunk);

  await expect(page).toHaveURL(/\/week$/);
  await expect(page.getByRole("heading", { name: "Week 37 · 7–13 Sep" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pinned" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Week", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
});
