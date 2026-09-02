import { expect, test, type Page } from "@playwright/test";

/**
 * The Week view against a stubbed rollup. `/api/week` is stubbed rather than
 * real for the same reason `/api/entries` is in entries.spec.ts: the e2e stack
 * shares the dev database, so a real read would report whatever the owner
 * actually logged and two parallel browsers would disagree with each other.
 *
 * The stub answers per `start` and reads its fixtures at request time, so a
 * test can change what the next read returns — which is how "the grid settles
 * after a push" is provable at all.
 */
type PushState = "unpushed" | "pushed" | "dirty" | null;

interface StubCell {
  seconds: number;
  pushState: PushState;
}

interface StubRow {
  instanceId: number;
  instanceName: string;
  instancePosition: number;
  issueKey: string;
  cells: StubCell[];
  seconds: number;
}

interface StubRollup {
  start: string;
  end: string;
  prevStart: string;
  nextStart: string;
  days: { day: string; seconds: number; pushState: PushState }[];
  rows: StubRow[];
  seconds: number;
}

interface StubEntry {
  id: number;
  instanceId: number;
  instanceName: string;
  instancePosition: number;
  issueKey: string;
  day: string;
  startedAt: string;
  seconds: number;
  comment: string;
  pushState: "unpushed" | "pushed" | "dirty";
}

/**
 * The two weeks these tests move between, written out rather than computed.
 * The browser is not allowed to derive a date and neither is its test rig: a
 * stub that did its own date arithmetic could agree with a view that had
 * started doing the same.
 */
const WEEKS: Record<string, { days: string[]; prevStart: string; nextStart: string }> = {
  "2026-08-31": {
    days: [
      "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03",
      "2026-09-04", "2026-09-05", "2026-09-06",
    ],
    prevStart: "2026-08-24",
    nextStart: "2026-09-07",
  },
  "2026-09-07": {
    days: [
      "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10",
      "2026-09-11", "2026-09-12", "2026-09-13",
    ],
    prevStart: "2026-08-31",
    nextStart: "2026-09-14",
  },
};

/** The week a bare `/week` lands on, standing in for the server's THAT_TIMEZONE Monday. */
const THIS_WEEK = "2026-09-07";

const RANK: Record<string, number> = { pushed: 0, dirty: 1, unpushed: 2 };

/** Worst wins, the server's rule — see worstPushState in internal/server/week.go. */
function worst(states: PushState[]): PushState {
  return states.reduce<PushState>((carried, state) => {
    if (state === null) return carried;
    if (carried === null) return state;

    return (RANK[state] ?? 0) > (RANK[carried] ?? 0) ? state : carried;
  }, null);
}

interface Logged {
  at: number;
  seconds: number;
  pushState: "unpushed" | "pushed" | "dirty";
}

function row(issueKey: string, logged: Logged[], instance = 1): StubRow {
  const cells: StubCell[] = Array.from({ length: 7 }, () => ({ seconds: 0, pushState: null }));
  for (const entry of logged) {
    cells[entry.at] = { seconds: entry.seconds, pushState: entry.pushState };
  }

  return {
    instanceId: instance,
    instanceName: instance === 2 ? "Personal" : "Ridgeline",
    instancePosition: instance === 2 ? 1 : 0,
    issueKey,
    cells,
    seconds: cells.reduce((sum, cell) => sum + cell.seconds, 0),
  };
}

function rollup(start: string, rows: StubRow[]): StubRollup {
  const week = WEEKS[start];
  if (!week) throw new Error(`no fixture for the week beginning ${start}`);

  const days = week.days.map((day, index) => ({
    day,
    seconds: rows.reduce((sum, each) => sum + (each.cells[index]?.seconds ?? 0), 0),
    pushState: worst(rows.map((each) => each.cells[index]?.pushState ?? null)),
  }));

  return {
    start,
    end: week.days[6] ?? start,
    prevStart: week.prevStart,
    nextStart: week.nextStart,
    days,
    rows,
    seconds: days.reduce((sum, day) => sum + day.seconds, 0),
  };
}

function entry(
  id: number,
  issueKey: string,
  day: string,
  seconds: number,
  state: StubEntry["pushState"],
): StubEntry {
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
    pushState: state,
  };
}

function pushed(entryId: number, issueKey: string) {
  return { entryId, issueKey, instanceId: 1, status: "pushed", worklogId: `wl-${String(entryId)}` };
}

function unreachable(entryId: number, issueKey: string) {
  return {
    entryId, issueKey, instanceId: 1, status: "failed",
    error: { code: "instance_unreachable", message: "the Jira site could not be reached" },
  };
}

/**
 * `rollups` is read on every request rather than captured, so a test can swap a
 * fixture in mid-flight and the next read sees it.
 */
async function openWeek(
  page: Page,
  rollups: Record<string, StubRollup>,
  entries: StubEntry[] = [],
  path = "/week",
): Promise<void> {
  await page.route("**/api/entries**", (route) => route.fulfill({ status: 200, json: entries }));

  await page.route("**/api/week**", (route) => {
    const start = new URL(route.request().url()).searchParams.get("start") ?? THIS_WEEK;
    const body = rollups[start];
    if (!body) {
      // The real handler's own words for a start it will not serve — see
      // handleWeek in internal/server/week.go.
      return route.fulfill({
        status: 400,
        json: { code: "start_not_monday", message: "start must be a Monday, of the form YYYY-MM-DD" },
      });
    }

    return route.fulfill({ status: 200, json: body });
  });

  await page.goto(path);
}

function ticketRow(page: Page, issueKey: string) {
  return page.locator("tbody tr", { hasText: issueKey });
}

/** The rail owns the only "Push to Jira" button, and it now sends every day the
 *  week holds rather than only today. */
async function pushEverything(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Push to Jira" }).click();
  await page.getByRole("button", { name: "Push", exact: true }).click();
}

test("a ticket logged on two days shows both cells and a row total that adds them up", async ({
  page,
}) => {
  await openWeek(page, {
    [THIS_WEEK]: rollup(THIS_WEEK, [
      row("RIDGE-1", [
        { at: 0, seconds: 3600, pushState: "pushed" },
        { at: 2, seconds: 1800, pushState: "pushed" },
      ]),
    ]),
  });

  // Seven day cells and the row total. A day with no entries is an em dash, not
  // 0h 00m — a zero would claim a measurement that was never taken.
  await expect(ticketRow(page, "RIDGE-1").locator("td")).toHaveText([
    "1h 00m", "—", "0h 30m", "—", "—", "—", "—", "1h 30m",
  ]);
  // The footer adds the same figures down the columns and across the week.
  await expect(page.locator("tfoot td").last()).toHaveText("1h 30m");
});

/**
 * The cheapest possible guard on the rule that format carries meaning:
 * `timerFigure` (H:MM) is for a timer you can start and stop, and every figure
 * in a rollup is a sum. A colon anywhere in this grid is a bug.
 *
 * The positive assertion beside it is not decoration: a table rendering no
 * digits at all would satisfy the negative one on its own.
 */
test("no figure in the grid wears a timer's colon", async ({ page }) => {
  await openWeek(page, {
    [THIS_WEEK]: rollup(THIS_WEEK, [
      row("RIDGE-1", [
        { at: 0, seconds: 3600, pushState: "pushed" },
        { at: 4, seconds: 2700, pushState: "unpushed" },
      ]),
      row("PERS-9", [{ at: 2, seconds: 45_000, pushState: "dirty" }], 2),
    ]),
  });

  await expect(page.locator("table")).toBeVisible();
  const text = await page.locator("table").innerText();

  // 45000 seconds is twelve and a half hours, spelled as a sum.
  expect(text).toContain("12h 30m");
  expect(text).not.toMatch(/\d:\d/);
});

/**
 * A dirty entry reached Jira and was then edited, and re-pushing it is #10's
 * subject rather than this ticket's. So the grid marks it and the rail offers
 * nothing — a Push that skipped everything it touched would be worse than no
 * Push at all.
 */
test("a week holding only edited-since-pushed time offers no Push", async ({ page }) => {
  await openWeek(
    page,
    {
      [THIS_WEEK]: rollup(THIS_WEEK, [
        row("RIDGE-1", [{ at: 0, seconds: 7200, pushState: "dirty" }]),
      ]),
    },
    [entry(1, "RIDGE-1", "2026-09-07", 7200, "dirty")],
  );

  await expect(ticketRow(page, "RIDGE-1")).toContainText("2h 00m");
  // The marker is there for a reader who can see it, and the words are there
  // for one who cannot.
  await expect(ticketRow(page, "RIDGE-1")).toContainText("edited since it was pushed");

  await expect(page.locator("#rail-unpushed")).toHaveText("Nothing to push");
  await expect(page.locator("#rail-push")).toBeDisabled();
});

test("pushing from the Week view reports below the grid and names the day that failed", async ({
  page,
}) => {
  await openWeek(
    page,
    {
      [THIS_WEEK]: rollup(THIS_WEEK, [
        row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "unpushed" }]),
        row("RIDGE-2", [{ at: 2, seconds: 1800, pushState: "unpushed" }]),
      ]),
    },
    [
      entry(1, "RIDGE-1", "2026-09-07", 3600, "unpushed"),
      entry(2, "RIDGE-2", "2026-09-09", 1800, "unpushed"),
    ],
  );

  await page.route("**/api/push**", (route) => {
    const day = new URL(route.request().url()).searchParams.get("day") ?? "";

    return route.fulfill({
      status: 200,
      json: {
        day,
        results: [day === "2026-09-07" ? pushed(1, "RIDGE-1") : unreachable(2, "RIDGE-2")],
      },
    });
  });

  await page.getByRole("button", { name: "Push to Jira" }).click();
  await expect(page.getByText(/2 entries totalling 1h 30m across 2 days/)).toBeVisible();
  await page.getByRole("button", { name: "Push", exact: true }).click();

  // One press covered two days, so "RIDGE-2 failed" alone would not say where to
  // look. The day is part of the line.
  const failure = page.getByText("2026-09-09 · RIDGE-2 — the Jira site could not be reached");
  await expect(failure).toBeVisible();

  // Below the grid, not above it: the grid must not move under a press.
  const table = await page.locator("table").boundingBox();
  const line = await failure.boundingBox();
  expect(table).not.toBeNull();
  expect(line).not.toBeNull();
  expect(line?.y ?? 0).toBeGreaterThan((table?.y ?? 0) + (table?.height ?? 0));
});

/**
 * The failed marker is the one thing in this grid that does not come from
 * /api/week — it comes from the push response, because a re-read reports those
 * entries as unpushed again, which is true and not what the reader needs in the
 * seconds after pressing Push. It lives for exactly the paint that reports the
 * push, so the read after that one shows the rollup's own answer again.
 */
test("a failed cell is marked, and the read after the reporting one clears it", async ({ page }) => {
  await openWeek(
    page,
    {
      [THIS_WEEK]: rollup(THIS_WEEK, [
        row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "unpushed" }]),
        row("RIDGE-2", [{ at: 2, seconds: 1800, pushState: "unpushed" }]),
      ]),
    },
    [
      entry(1, "RIDGE-1", "2026-09-07", 3600, "unpushed"),
      entry(2, "RIDGE-2", "2026-09-09", 1800, "unpushed"),
    ],
  );

  let wednesdayAttempts = 0;
  await page.route("**/api/push**", (route) => {
    const day = new URL(route.request().url()).searchParams.get("day") ?? "";
    if (day === "2026-09-07") {
      return route.fulfill({ status: 200, json: { day, results: [pushed(1, "RIDGE-1")] } });
    }

    // Unreachable the first time and reachable the second, so the retry that the
    // report asks for is the thing that clears the marker.
    wednesdayAttempts += 1;
    const result = wednesdayAttempts === 1 ? unreachable(2, "RIDGE-2") : pushed(2, "RIDGE-2");

    return route.fulfill({ status: 200, json: { day, results: [result] } });
  });

  const wednesday = ticketRow(page, "RIDGE-2").locator("td").nth(2);
  await expect(wednesday).toContainText("not pushed to Jira");

  await pushEverything(page);
  await expect(wednesday).toContainText("did not reach Jira");

  await pushEverything(page);
  await expect(wednesday).not.toContainText("did not reach Jira");
});

/**
 * void show() after a push is the only thing that settles the grid, and without
 * a fixture that changes underneath it nothing here would fail if it were
 * deleted.
 */
test("the grid settles once the push has gone through", async ({ page }) => {
  const rollups: Record<string, StubRollup> = {
    [THIS_WEEK]: rollup(THIS_WEEK, [
      row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "unpushed" }]),
    ]),
  };
  await openWeek(page, rollups, [entry(1, "RIDGE-1", "2026-09-07", 3600, "unpushed")]);

  await page.route("**/api/push**", (route) => {
    rollups[THIS_WEEK] = rollup(THIS_WEEK, [
      row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "pushed" }]),
    ]);

    return route.fulfill({
      status: 200,
      json: { day: "2026-09-07", results: [pushed(1, "RIDGE-1")] },
    });
  });

  const monday = ticketRow(page, "RIDGE-1").locator("td").first();
  await expect(monday).toContainText("not pushed to Jira");

  await pushEverything(page);

  await expect(page.getByText("Pushed 1 entry to Jira.")).toBeVisible();
  await expect(monday).toHaveText("1h 00m");
});

test("a week with nothing logged says so rather than drawing an empty grid", async ({ page }) => {
  await openWeek(page, { [THIS_WEEK]: rollup(THIS_WEEK, []) });

  await expect(page.getByText("Nothing logged this week.")).toBeVisible();
  await expect(page.locator("table")).toHaveCount(0);
  // A week off is not an error, and the week either side is still one press away.
  await expect(page.getByRole("button", { name: "Previous week" })).toBeVisible();
});

/** /week?start=<not a Monday> is a reachable address the server rejects on
 *  purpose, so the view has to leave a way out of it. */
test("a week the server refuses still offers a way back to this one", async ({ page }) => {
  await openWeek(
    page,
    { [THIS_WEEK]: rollup(THIS_WEEK, [row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "pushed" }])]) },
    [],
    "/week?start=2026-09-08",
  );

  await expect(page.getByText("start must be a Monday, of the form YYYY-MM-DD")).toBeVisible();

  await page.getByRole("button", { name: "This week" }).click();

  await expect(page.getByRole("heading", { name: "7–13 Sep" })).toBeVisible();
  await expect(ticketRow(page, "RIDGE-1")).toBeVisible();
});

test("the previous week is a place you can go back from", async ({ page }) => {
  await openWeek(page, {
    [THIS_WEEK]: rollup(THIS_WEEK, [
      row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "pushed" }]),
    ]),
    "2026-08-31": rollup("2026-08-31", [
      row("RIDGE-9", [{ at: 4, seconds: 5400, pushState: "pushed" }]),
    ]),
  });

  await expect(page.getByRole("heading", { name: "7–13 Sep" })).toBeVisible();
  await expect(ticketRow(page, "RIDGE-1")).toBeVisible();

  await page.getByRole("button", { name: "Previous week" }).click();

  await expect(page.getByRole("heading", { name: "31 Aug – 6 Sep" })).toBeVisible();
  await expect(ticketRow(page, "RIDGE-9")).toBeVisible();
  await expect(ticketRow(page, "RIDGE-1")).toHaveCount(0);
  expect(new URL(page.url()).search).toBe("?start=2026-08-31");

  await page.goBack();

  await expect(page.getByRole("heading", { name: "7–13 Sep" })).toBeVisible();
  await expect(ticketRow(page, "RIDGE-1")).toBeVisible();
});
