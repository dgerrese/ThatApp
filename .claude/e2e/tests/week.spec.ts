import { expect, test, type Locator, type Page } from "@playwright/test";

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
  weekNumber: number;
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
const WEEKS: Record<
  string,
  { days: string[]; prevStart: string; nextStart: string; weekNumber: number }
> = {
  "2026-08-31": {
    days: [
      "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03",
      "2026-09-04", "2026-09-05", "2026-09-06",
    ],
    prevStart: "2026-08-24",
    nextStart: "2026-09-07",
    weekNumber: 36,
  },
  "2026-09-07": {
    days: [
      "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10",
      "2026-09-11", "2026-09-12", "2026-09-13",
    ],
    prevStart: "2026-08-31",
    nextStart: "2026-09-14",
    weekNumber: 37,
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
    weekNumber: week.weekNumber,
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

/** The one failure a retry must not be offered for: Jira has the worklog, this app does not. */
function storeFailed(entryId: number, issueKey: string) {
  return {
    entryId, issueKey, instanceId: 1, status: "failed",
    error: { code: "store_failed", message: "the worklog could not be recorded locally" },
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

/** The state marker inside one cell — the only aria-hidden span a cell holds. */
function markerIn(page: Page, issueKey: string, column: number): Locator {
  return ticketRow(page, issueKey).locator("td").nth(column).locator("span[aria-hidden='true']");
}

/** The popover naming a cell's value, push state, and whether clicking adds
 *  or edits — nested inside that one cell, so scoping to the cell scopes the
 *  locator too and a densely-tooltipped grid never trips a strict-mode match. */
function tooltipIn(page: Page, issueKey: string, column: number): Locator {
  return ticketRow(page, issueKey).locator("td").nth(column).locator("that-tooltip");
}

async function shapeOf(marker: Locator): Promise<{ radius: string; bottomBorder: string }> {
  return marker.evaluate((element) => {
    const style = getComputedStyle(element);

    return { radius: style.borderTopLeftRadius, bottomBorder: style.borderBottomWidth };
  });
}

/** The rail owns the only Push button, worded "Push this week" here — #117's
 *  R3 — and it sends every day the week holds rather than only today. */
async function pushEverything(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Push this week" }).click();
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
  // useInnerText: every cell now also carries a that-tooltip naming the same
  // figure in full — real textContent, just not rendered while closed — and
  // innerText is what ignores it.
  await expect(ticketRow(page, "RIDGE-1").locator("td")).toHaveText(
    ["1h 00m", "—", "0h 30m", "—", "—", "—", "—", "1h 30m"],
    { useInnerText: true },
  );
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

  // Scoped to the one cell that holds the entry, and to its trigger rather
  // than the td: the td also holds a that-tooltip sibling whose own hidden
  // text repeats both the figure and the words below, and a row- or
  // cell-wide raw-text match cannot tell "genuinely visible" from "closed
  // popover, still real textContent" apart. The trigger's own text is clean.
  const monday = ticketRow(page, "RIDGE-1").locator("td").first().locator("button");
  await expect(monday).toContainText("2h 00m");
  // The marker is the shape a sighted reader sees; the aria-label is what a
  // reader who cannot see it gets instead — not the popover, which needs a
  // hover or a focus neither reaches on its own.
  await expect(monday).toHaveAttribute("aria-label", /edited since it was pushed/);

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

  // The rail describes the view beside it, which is the whole point of decision
  // 6: the period is named, and the figure is the week's rather than Monday's.
  // The heading and the rail's period label are composed from the same string
  // — both carry the ISO week number the server computed.
  await expect(page.getByRole("heading", { name: "Week 37 · 7–13 Sep" })).toBeVisible();
  await expect(page.locator("#rail-period")).toHaveText("Week 37 · 7–13 Sep");
  await expect(page.locator("#rail-total")).toHaveText("1h 30m");

  await page.getByRole("button", { name: "Push this week" }).click();
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
 * store_failed is the one failure where the report must argue against the retry
 * every other failure asks for: those entries reached Jira and only the local
 * record of them did not, so pressing Push again logs the time in Jira twice
 * and nothing here can undo it.
 */
test("an entry Jira took but the store lost says not to push again", async ({ page }) => {
  await openWeek(
    page,
    {
      [THIS_WEEK]: rollup(THIS_WEEK, [
        row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "unpushed" }]),
      ]),
    },
    [entry(1, "RIDGE-1", "2026-09-07", 3600, "unpushed")],
  );

  await page.route("**/api/push**", (route) =>
    route.fulfill({
      status: 200,
      json: { day: "2026-09-07", results: [storeFailed(1, "RIDGE-1")] },
    }),
  );

  await pushEverything(page);

  const alert = page.locator("that-alert[tone='error']");
  await expect(alert).toContainText(
    "1 entry reached Jira but could not be recorded here. Check the issue in Jira before " +
      "pushing again — pushing now would log the time twice.",
  );
  await expect(page.getByText("2026-09-07 · RIDGE-1")).toBeVisible();
  // The retry line belongs to every other failure and would be actively harmful
  // here, so its absence is as much the assertion as the words above.
  await expect(page.getByText(/again to retry them/)).toHaveCount(0);
});

/**
 * A day whose request never comes back produces no result to count either way.
 * Reporting only what came back would find no failures in the two days that
 * answered and print the success line over a push that half finished — on the
 * screen the week is signed off from, which is the worst place for it.
 */
test("a day whose push never answered is named rather than counted as pushed", async ({ page }) => {
  await openWeek(
    page,
    {
      [THIS_WEEK]: rollup(THIS_WEEK, [
        row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "unpushed" }]),
        row("RIDGE-2", [{ at: 1, seconds: 1800, pushState: "unpushed" }]),
        row("RIDGE-3", [{ at: 2, seconds: 900, pushState: "unpushed" }]),
      ]),
    },
    [
      entry(1, "RIDGE-1", "2026-09-07", 3600, "unpushed"),
      entry(2, "RIDGE-2", "2026-09-08", 1800, "unpushed"),
      entry(3, "RIDGE-3", "2026-09-09", 900, "unpushed"),
    ],
  );

  await page.route("**/api/push**", (route) => {
    const day = new URL(route.request().url()).searchParams.get("day") ?? "";
    // The middle day, so the days either side of it do answer and the report has
    // two successes it could otherwise have called the whole push by.
    if (day === "2026-09-08") return route.abort();

    const id = day === "2026-09-07" ? 1 : 3;

    return route.fulfill({
      status: 200,
      json: { day, results: [pushed(id, `RIDGE-${String(id)}`)] },
    });
  });

  await pushEverything(page);

  await expect(page.locator("that-alert[tone='warning']")).toContainText(
    "1 day did not answer, so what happened to its time is not known here. " +
      "Press Push to Jira again.",
  );
  await expect(page.getByText("2026-09-08", { exact: true })).toBeVisible();
  await expect(page.getByText(/Pushed \d+ entr/)).toHaveCount(0);
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

  // The trigger, not the td: the td also holds a that-tooltip sibling whose
  // hidden textContent repeats these same words even while closed, which is
  // exactly what would let a wrong marker still pass a raw-text match here.
  // The aria-label is the one place these words are guaranteed to live for a
  // reader who cannot see the marker — the popover needs a hover or a focus
  // neither reaches on its own.
  const wednesday = ticketRow(page, "RIDGE-2").locator("td").nth(2).locator("button");
  await expect(wednesday).toHaveAttribute("aria-label", /not pushed to Jira/);

  await pushEverything(page);
  await expect(wednesday).toHaveAttribute("aria-label", /did not reach Jira/);

  await pushEverything(page);
  await expect(wednesday).not.toHaveAttribute("aria-label", /did not reach Jira/);
});

/**
 * The visual design language says of amber and red that "neither ever rests on
 * colour alone". This grid carries neither the triangle-and-words an alert has
 * nor room for a legend, so the silhouettes are what has to differ — and the
 * assertion reads what the browser computed rather than which class was written,
 * so a utility that failed to generate would fail here too.
 */
test("a failed marker and an unpushed one differ in shape, not only in hue", async ({ page }) => {
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

  await pushEverything(page);

  // The rollup is unchanged underneath, so Monday still reads unpushed while
  // Wednesday wears the marker the push left — both on screen at once.
  const failed = markerIn(page, "RIDGE-2", 2);
  const unpushed = markerIn(page, "RIDGE-1", 0);
  await expect(failed).toBeVisible();
  await expect(unpushed).toBeVisible();

  const failedShape = await shapeOf(failed);
  const unpushedShape = await shapeOf(unpushed);

  expect(failedShape).not.toEqual(unpushedShape);
  // A triangle against a disc: the failed marker has a drawn edge and square
  // corners, the unpushed one is round and has neither.
  expect(unpushedShape.bottomBorder).toBe("0px");
  expect(failedShape.bottomBorder).not.toBe("0px");
  expect(failedShape.radius).toBe("0px");
  expect(unpushedShape.radius).not.toBe("0px");
});

/**
 * Every cell is a control now, empty ones included — clicking either opens
 * the entries dialog for the ticket the row names. The dialog itself is
 * shared with Today and reads whatever is logged against that ticket without
 * regard to which day's cell was clicked, so this stops at "the right dialog
 * opens" rather than claiming the two clicks land in visibly different
 * states — see the task report for why that line was not crossed.
 */
test("every cell is a control that opens the entries dialog for its ticket", async ({ page }) => {
  await openWeek(page, {
    [THIS_WEEK]: rollup(THIS_WEEK, [
      row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "pushed" }]),
      row("NW-1", [{ at: 0, seconds: 3600, pushState: "pushed" }], 2),
    ]),
  });

  const cells = ticketRow(page, "RIDGE-1").locator("td");
  const dialog = page.locator("dialog[open]");

  // A figure: RIDGE-1 already has time logged.
  await cells.nth(0).locator("button").click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("RIDGE-1");
  // Week is the only view that hands the dialog the instance position its
  // header dot is drawn from, so the hue is the proof it travelled: 265 is the
  // first instance's and 175 the second's, and a lost position would paint
  // both 265. The lightness and chroma are fixed across the ramp, by design.
  await expect(dialog.locator(".that-dot")).toHaveAttribute("aria-label", "Ridgeline");
  await expect(dialog.locator(".that-dot")).toHaveCSS("background-color", RIDGELINE_HUE);
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);

  // Empty: the same control opens the same dialog, ready to add.
  await cells.nth(1).locator("button").click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("RIDGE-1");
  await dialog.getByRole("button", { name: "Close" }).click();
  // showModal() hands focus back to the cell that opened it, which reopens that
  // cell's popover — correctly, and in the top layer over the row beneath it.
  // Moving on is what a reader does next, and it is what this has to do too.
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });

  // The second instance, which is what makes the hue above a claim rather than
  // a coincidence: position 0 is also what a missing position would fall to.
  await ticketRow(page, "NW-1").locator("td").nth(0).locator("button").click();
  await expect(dialog.locator(".that-dot")).toHaveAttribute("aria-label", "Personal");
  await expect(dialog.locator(".that-dot")).toHaveCSS("background-color", NORTHWIND_HUE);
});

/** The first two hues of the ramp in web/src/instance-hue.ts, as .that-dot
 *  paints them in the light theme Playwright runs in by default. */
const RIDGELINE_HUE = "oklch(0.6 0.13 265)";
const NORTHWIND_HUE = "oklch(0.6 0.13 175)";

/**
 * A total is a sum, never a control — worth proving now that every other cell
 * in the grid has become one. Neither total carries a button to click, and
 * clicking the bare cell opens nothing.
 */
test("a total is a sum, not a control, and opens nothing", async ({ page }) => {
  await openWeek(page, {
    [THIS_WEEK]: rollup(THIS_WEEK, [
      row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "pushed" }]),
    ]),
  });

  const rowTotal = ticketRow(page, "RIDGE-1").locator("td").last();
  const weekTotal = page.locator("tfoot td").last();

  await expect(rowTotal.locator("button")).toHaveCount(0);
  await expect(weekTotal.locator("button")).toHaveCount(0);

  await rowTotal.click();
  await weekTotal.click();

  await expect(page.locator("dialog[open]")).toHaveCount(0);
});

/**
 * This grid never had room for a legend and must not grow one: each cell
 * names itself, so nothing needs to sit beside the table explaining what a
 * marker means. Read directly off the DOM rather than the page's rendered
 * text, so a hidden that-tooltip's own copy of the same words cannot be
 * mistaken for a legend standing beside the table.
 */
test("nothing explains the markers separately from each cell's own popover", async ({ page }) => {
  await openWeek(page, {
    [THIS_WEEK]: rollup(THIS_WEEK, [
      row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "unpushed" }]),
    ]),
  });

  const siblingCount = await page
    .locator("table")
    .evaluate((table) => table.parentElement?.children.length ?? -1);
  expect(siblingCount).toBe(1);
});

/**
 * Each cell's popover names its value, its push state — pushed included, even
 * though pushed draws no marker — and whether clicking adds or edits. The
 * tooltip is scoped to its own cell, never queried loose across a grid this
 * dense with them.
 */
test("a cell's popover names its value, its push state, and whether clicking adds or edits", async ({
  page,
}) => {
  await openWeek(page, {
    [THIS_WEEK]: rollup(THIS_WEEK, [
      row("RIDGE-1", [
        { at: 0, seconds: 3600, pushState: "pushed" },
        { at: 1, seconds: 2700, pushState: "unpushed" },
        { at: 2, seconds: 1800, pushState: "dirty" },
      ]),
    ]),
  });

  await expect(tooltipIn(page, "RIDGE-1", 0)).toHaveText("1h 00m · pushed to Jira · click to edit");
  await expect(tooltipIn(page, "RIDGE-1", 1)).toHaveText("0h 45m · not pushed to Jira · click to edit");
  await expect(tooltipIn(page, "RIDGE-1", 2)).toHaveText(
    "0h 30m · edited since it was pushed · click to edit",
  );
  await expect(tooltipIn(page, "RIDGE-1", 3)).toHaveText("No time logged · click to add");

  // The popover is never the accessible name — the trigger names itself too,
  // independently, so a reader who never sees the popover still hears this.
  const filled = ticketRow(page, "RIDGE-1").locator("td").nth(0).locator("button");
  await expect(filled).toHaveAttribute("aria-label", /RIDGE-1/);
  await expect(filled).toHaveAttribute("aria-label", /pushed to Jira/);
  const empty = ticketRow(page, "RIDGE-1").locator("td").nth(3).locator("button");
  await expect(empty).toHaveAttribute("aria-label", /no time logged/);
});

/** The icon buttons either side of "This week" used to be shorter than the
 *  text button between them — an 18px mark has nothing else to give it a text
 *  line's height. All three now share one fixed height instead. */
test("the three week controls share one height", async ({ page }) => {
  await openWeek(page, {
    [THIS_WEEK]: rollup(THIS_WEEK, [
      row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "pushed" }]),
    ]),
  });

  const controls = [
    page.getByRole("button", { name: "Previous week" }),
    page.getByRole("button", { name: "This week", exact: true }),
    page.getByRole("button", { name: "Next week" }),
  ];
  const heights = await Promise.all(
    controls.map(async (control) => (await control.boundingBox())?.height),
  );

  expect(heights).toEqual([36, 36, 36]);
});

test("the fetch control sits beside the label, and the week controls do not move", async ({
  page,
}) => {
  await openWeek(page, {
    [THIS_WEEK]: rollup(THIS_WEEK, [
      row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "pushed" }]),
    ]),
  });

  const fetchControl = page.getByRole("button", { name: "Fetch worklogs" });
  await expect(fetchControl).toBeVisible();

  const label = page.getByRole("heading", { level: 2 });
  const thisWeek = page.getByRole("button", { name: "This week", exact: true });

  const labelBox = (await label.boundingBox()) ?? null;
  const fetchBox = (await fetchControl.boundingBox()) ?? null;
  const weekBox = (await thisWeek.boundingBox()) ?? null;
  if (!labelBox || !fetchBox || !weekBox) throw new Error("a header control had no box");

  expect(fetchBox.x).toBeGreaterThan(labelBox.x);
  expect(fetchBox.x + fetchBox.width).toBeLessThan(weekBox.x);
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

  // The trigger, not the td: the td's that-tooltip sibling carries these same
  // words as real, hidden textContent even while closed, which would let a
  // wrong marker still pass a raw-text match against the td. The words for a
  // reader who cannot see the marker live in the aria-label instead.
  const monday = ticketRow(page, "RIDGE-1").locator("td").first().locator("button");
  await expect(monday).toHaveAttribute("aria-label", /not pushed to Jira/);

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

  await page.getByRole("button", { name: "This week", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Week 37 · 7–13 Sep" })).toBeVisible();
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

  await expect(page.getByRole("heading", { name: "Week 37 · 7–13 Sep" })).toBeVisible();
  await expect(ticketRow(page, "RIDGE-1")).toBeVisible();

  await page.getByRole("button", { name: "Previous week" }).click();

  await expect(page.getByRole("heading", { name: "Week 36 · 31 Aug – 6 Sep" })).toBeVisible();
  await expect(ticketRow(page, "RIDGE-9")).toBeVisible();
  await expect(ticketRow(page, "RIDGE-1")).toHaveCount(0);
  expect(new URL(page.url()).search).toBe("?start=2026-08-31");

  await page.goBack();

  await expect(page.getByRole("heading", { name: "Week 37 · 7–13 Sep" })).toBeVisible();
  await expect(ticketRow(page, "RIDGE-1")).toBeVisible();
});
