import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The fetch control and the three reports the design settled: a clean run's
 * counts, an entry whose unpushed edit was kept over what came back, and an
 * instance that could not be read.
 *
 * `/api/week/fetch` is stubbed the same way `/api/week` and `/api/entries`
 * already are in week.spec.ts: the question here is what the view does with
 * an answer, not where the answer came from.
 */

const START = "2026-08-31";

/**
 * A rollup with no rows. What each test cares about is the report below the
 * grid, and an empty week is the simplest fixture that still lets the mount's
 * own read (and the re-read after a fetch) resolve.
 */
const ROLLUP = {
  start: START,
  end: "2026-09-06",
  prevStart: "2026-08-24",
  nextStart: "2026-09-07",
  weekNumber: 36,
  days: [
    "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03",
    "2026-09-04", "2026-09-05", "2026-09-06",
  ].map((day) => ({ day, seconds: 0, pushState: null })),
  rows: [],
  seconds: 0,
};

const NOTHING = { start: START, end: "2026-09-06", created: 0, updated: 0, keptLocal: [], failures: [] };

/**
 * Mounts Week against the empty rollup above and answers the fetch it will
 * ask for. One route handler covers both `/api/week` and `/api/week/fetch`:
 * a glob that only matched the former would also catch the latter, since
 * `/api/week/fetch` is a path underneath it, so telling them apart has to
 * happen inside the handler rather than by registering two routes and hoping
 * one wins.
 */
async function openWeek(page: Page, fetch: { body: unknown; status?: number; hold?: Promise<void> }): Promise<void> {
  await page.route("**/api/entries**", (route) =>
    route.fulfill({ status: 200, json: { today: START, entries: [] } }),
  );

  await page.route("**/api/week**", async (route) => {
    if (!new URL(route.request().url()).pathname.endsWith("/fetch")) {
      return route.fulfill({ status: 200, json: ROLLUP });
    }

    if (fetch.hold) await fetch.hold;

    return route.fulfill({ status: fetch.status ?? 200, json: fetch.body });
  });

  await page.goto("/week");
}

/** The report region: the alert's own parent, which is also the list's — a
 *  scope a whole-page `getByRole("listitem")` search would not have. */
function reportRegion(page: Page): Locator {
  return page.getByRole("status").locator("..");
}

/** One entry, shaped as `/api/entries` answers it — see `entry()` in
 *  week.spec.ts, which this mirrors rather than imports across spec files. */
function entry(id: number, issueKey: string, day: string, seconds: number) {
  return {
    id,
    instanceId: 1,
    instanceName: "Ridgeline",
    instancePosition: 0,
    issueKey,
    day,
    startedAt: `${day}T09:00:00+02:00`,
    seconds,
    comment: "",
    pushState: "pushed",
  };
}

const BEFORE_ENTRIES = [entry(1, "RIDGE-1", "2026-09-01", 1800)];
const AFTER_ENTRIES = [...BEFORE_ENTRIES, entry(2, "RIDGE-2", "2026-09-02", 5400)];

/**
 * As openWeek, but `/api/entries` answers `before` until the fetch has
 * resolved and `after` from then on, and counts how many times it was asked.
 * The rail reads the period through this same endpoint — see rail.ts's
 * refresh() — so this is what lets a test tell "the rail re-read" apart from
 * "the rail still shows what it painted at mount".
 */
async function openWeekWithEntries(
  page: Page,
  fetch: { body: unknown },
  before: unknown[],
  after: unknown[],
): Promise<{ entriesRequests: () => number }> {
  let resolved = false;
  let entriesRequests = 0;

  await page.route("**/api/entries**", (route) => {
    entriesRequests += 1;

    return route.fulfill({ status: 200, json: { today: START, entries: resolved ? after : before } });
  });

  await page.route("**/api/week**", async (route) => {
    if (!new URL(route.request().url()).pathname.endsWith("/fetch")) {
      return route.fulfill({ status: 200, json: ROLLUP });
    }

    await route.fulfill({ status: 200, json: fetch.body });
    resolved = true;
  });

  await page.goto("/week");

  return { entriesRequests: () => entriesRequests };
}

test("a clean run reports counts and names nothing", async ({ page }) => {
  await openWeek(page, { body: { ...NOTHING, created: 3, updated: 1 } });

  await page.getByRole("button", { name: "Fetch worklogs" }).click();

  await expect(page.getByText("Added 3 entries and updated 1.")).toBeVisible();
  await expect(reportRegion(page).getByRole("listitem")).toHaveCount(0);
});

test("entries whose unpushed changes were kept are named", async ({ page }) => {
  await openWeek(page, {
    body: {
      ...NOTHING,
      created: 1,
      keptLocal: [
        { day: "2026-09-01", issueKey: "RID-1", instanceId: 1 },
        { day: "2026-09-03", issueKey: "NW-806", instanceId: 2 },
      ],
    },
  });

  await page.getByRole("button", { name: "Fetch worklogs" }).click();

  await expect(page.getByText(/2 entries have changes you have not pushed/)).toBeVisible();
  await expect(page.getByText("2026-09-01 · RID-1")).toBeVisible();
  await expect(page.getByText("2026-09-03 · NW-806")).toBeVisible();
});

test("an instance that refused is named, and the others still applied", async ({ page }) => {
  await openWeek(page, {
    body: {
      ...NOTHING,
      created: 2,
      failures: [
        {
          instanceId: 2,
          instanceName: "Northwind",
          error: { code: "unauthorized", message: "the stored token does not carry the scope this needs" },
        },
      ],
    },
  });

  await page.getByRole("button", { name: "Fetch worklogs" }).click();

  await expect(page.getByText("Added 2 entries and updated 0.")).toBeVisible();
  await expect(page.getByText(/Northwind could not be read/)).toBeVisible();
  await expect(page.getByText("the stored token does not carry the scope this needs")).toBeVisible();
});

test("a fetch that created something updates the rail without navigating", async ({ page }) => {
  await openWeekWithEntries(page, { body: { ...NOTHING, created: 1 } }, BEFORE_ENTRIES, AFTER_ENTRIES);

  await expect(page.locator("#rail-total")).toHaveText("0h 30m");

  await page.getByRole("button", { name: "Fetch worklogs" }).click();

  await expect(page.getByText("Added 1 entry and updated 0.")).toBeVisible();
  // No navigation and no reload happened — the fetch itself is what has to
  // have woken the rail into reading the period again.
  await expect(page.locator("#rail-total")).toHaveText("2h 00m");
});

test("a fetch that changed nothing leaves the rail alone", async ({ page }) => {
  const { entriesRequests } = await openWeekWithEntries(page, { body: NOTHING }, BEFORE_ENTRIES, AFTER_ENTRIES);

  await expect(page.locator("#rail-total")).toHaveText("0h 30m");
  // Two reads happen on mount, deterministically, before any press: the
  // rail's own boot read (against TODAY_PERIOD, fired by startRail() before
  // any view exists) and the one Week's setRailPeriod triggers once it
  // mounts. Waiting for that known count rather than a timer means a third
  // mount-time read some future change adds would fail this line with an
  // explanation, instead of silently poisoning the baseline below.
  await expect.poll(() => entriesRequests()).toBe(2);
  const readsAtMount = entriesRequests();

  await page.getByRole("button", { name: "Fetch worklogs" }).click();

  await expect(page.getByText("Nothing to add or update.")).toBeVisible();
  // Give a rail that wrongly re-reads a turn to do it before checking it
  // didn't: the total staying "0h 30m" alone would also be true of a re-read
  // that asked for AFTER_ENTRIES and got served BEFORE_ENTRIES by mistake.
  await page.waitForTimeout(200);
  expect(entriesRequests()).toBe(readsAtMount);
  await expect(page.locator("#rail-total")).toHaveText("0h 30m");
});

test("the control is disabled for the length of the round trip", async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await openWeek(page, { body: NOTHING, hold: held });

  const control = page.getByRole("button", { name: "Fetch worklogs" });
  await control.click();
  await expect(control).toBeDisabled();

  release();
  await expect(control).toBeEnabled();
});

test("a failed request reports rather than leaving the press unanswered", async ({ page }) => {
  await openWeek(page, {
    body: { code: "store_failed", message: "could not read the logged time" },
    status: 500,
  });

  await page.getByRole("button", { name: "Fetch worklogs" }).click();

  await expect(page.getByText("could not read the logged time")).toBeVisible();
  await expect(page.getByRole("button", { name: "Fetch worklogs" })).toBeEnabled();
});

test("the control is disabled until the week has been read", async ({ page }) => {
  let release = (): void => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route("**/api/entries**", (route) =>
    route.fulfill({ status: 200, json: { today: START, entries: [] } }),
  );
  await page.route("**/api/week**", async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/fetch")) {
      return route.fulfill({ status: 200, json: NOTHING });
    }

    await held;

    return route.fulfill({ status: 200, json: ROLLUP });
  });

  await page.goto("/week");

  // The header paints before the read resolves, so the control exists with no
  // week to fetch yet. Enabled here it would swallow the press silently.
  const control = page.getByRole("button", { name: "Fetch worklogs" });
  await expect(control).toBeDisabled();

  release();
  await expect(control).toBeEnabled();
});

test("a week that could not be read leaves the control disabled", async ({ page }) => {
  await page.route("**/api/entries**", (route) =>
    route.fulfill({ status: 200, json: { today: START, entries: [] } }),
  );
  await page.route("**/api/week**", (route) =>
    route.fulfill({
      status: 400,
      json: { code: "start_not_monday", message: "start must be a Monday, of the form YYYY-MM-DD" },
    }),
  );

  await page.goto("/week?start=2026-09-02");

  await expect(page.getByText("start must be a Monday, of the form YYYY-MM-DD")).toBeVisible();
  // There is no week on screen to fetch, and there never will be on this
  // mount: an enabled control here is one that answers no press at all.
  await expect(page.getByRole("button", { name: "Fetch worklogs" })).toBeDisabled();
});
