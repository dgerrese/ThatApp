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
  url: string;
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

/** The site each stub instance stands in for — what a real rollup would build
 *  the row's browse URL from server-side. */
function siteOf(instance: number): string {
  return instance === 2 ? "https://personal.atlassian.net" : "https://ridgeline.atlassian.net";
}

function row(issueKey: string, logged: Logged[], instance = 1, url?: string): StubRow {
  const cells: StubCell[] = Array.from({ length: 7 }, () => ({ seconds: 0, pushState: null }));
  for (const entry of logged) {
    cells[entry.at] = { seconds: entry.seconds, pushState: entry.pushState };
  }

  return {
    instanceId: instance,
    instanceName: instance === 2 ? "Personal" : "Ridgeline",
    instancePosition: instance === 2 ? 1 : 0,
    issueKey,
    url: url ?? `${siteOf(instance)}/browse/${issueKey}`,
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
  await page.route("**/api/entries**", (route) =>
    route.fulfill({ status: 200, json: { today: THIS_WEEK, entries } }),
  );

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
 * seconds after pressing Push. It survives every read Week triggers on its own
 * behalf — the push report's own re-read here, since nothing else changed the
 * week in between — and is consumed only by the next read the user actually
 * asks for: one Refresh press, not two.
 */
test("a failed cell is marked, survives the push report's own re-read, and one Refresh press clears it", async ({
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
    if (day === "2026-09-07") {
      return route.fulfill({ status: 200, json: { day, results: [pushed(1, "RIDGE-1")] } });
    }

    return route.fulfill({ status: 200, json: { day, results: [unreachable(2, "RIDGE-2")] } });
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

  // /api/week is unchanged from the read above — the entry never actually
  // pushed, so its own rollup still says "unpushed" either way — which is
  // what proves the marker's survival is Week's own doing, not the server's.
  const refreshControl = page.getByRole("button", { name: "Refresh" });
  await refreshControl.click();
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

/** --color-ink and --color-ink-muted in the light theme Playwright runs in by
 *  default — see styles.css. */
const INK_LIGHT = "oklch(0.195 0.009 55)";
const INK_MUTED_LIGHT = "oklch(0.465 0.01 55)";

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

/**
 * #117 task 10, W14: the drawing's `.wctl.icon` is `width: 36px; padding: 0`
 * — square at the shared 36px height. "This week" is a text button and stays
 * unsquared, which is what tells the two variants apart in this assertion.
 */
test("each arrow is square at the shared 36px control height", async ({ page }) => {
  await openWeek(page, {
    [THIS_WEEK]: rollup(THIS_WEEK, [
      row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "pushed" }]),
    ]),
  });

  const arrows = [
    page.getByRole("button", { name: "Previous week" }),
    page.getByRole("button", { name: "Next week" }),
  ];
  const boxes = await Promise.all(arrows.map((arrow) => arrow.boundingBox()));

  for (const box of boxes) {
    expect(box).not.toBeNull();
    expect(box?.width).toBe(36);
    expect(box?.height).toBe(36);
  }
});

/**
 * #117 task 10, W13: the arrows carry the app's own popover rather than a
 * native `title` — dropping `button.title` in favour of a `that-tooltip` is
 * the whole change, and the aria-label stays exactly where it was, since a
 * tooltip is never the accessible name.
 */
test("the week arrows carry the drawn popover rather than a native title", async ({ page }) => {
  await openWeek(page, {
    [THIS_WEEK]: rollup(THIS_WEEK, [
      row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "pushed" }]),
    ]),
  });

  const previous = page.getByRole("button", { name: "Previous week" });
  const next = page.getByRole("button", { name: "Next week" });

  await expect(previous).not.toHaveAttribute("title");
  await expect(next).not.toHaveAttribute("title");
  // The accessible name is unchanged by the tooltip's presence.
  await expect(previous).toHaveAttribute("aria-label", "Previous week");
  await expect(next).toHaveAttribute("aria-label", "Next week");

  await previous.hover();
  const previousTip = page.locator("that-tooltip", { hasText: "previous week" });
  await expect(previousTip).toBeVisible();
  await expect(previousTip).toHaveText("previous week");

  await next.hover();
  const nextTip = page.locator("that-tooltip", { hasText: "next week" });
  await expect(nextTip).toBeVisible();
  await expect(nextTip).toHaveText("next week");
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
 * Decision 12 of the visual language: Week gains a refresh control, labelled,
 * after the rule and before Fetch worklogs. It re-reads the week from this
 * app's own database — the same read show() already performs on mount — and
 * calls no Jira endpoint, which is what tells it apart from the fetch beside
 * it.
 */
test("Refresh sits between the rule and Fetch worklogs, and re-reads /api/week when pressed", async ({
  page,
}) => {
  await openWeek(page, {
    [THIS_WEEK]: rollup(THIS_WEEK, [
      row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "pushed" }]),
    ]),
  });

  const refreshControl = page.getByRole("button", { name: "Refresh" });
  await expect(refreshControl).toBeVisible();

  // Document order rather than geometry: a wrapped header would still leave
  // the rule and Fetch worklogs on either side of Refresh even though their
  // bounding boxes stop agreeing about who is "before" whom.
  const order = await page.evaluate(() => {
    const byLabel = (label: string) =>
      Array.from(document.querySelectorAll("button")).find(
        (button) => button.getAttribute("aria-label") === label,
      ) ?? null;
    const rule = document.querySelector(".bg-edge");
    const refresh = byLabel("Refresh");
    const fetchButton = byLabel("Fetch worklogs");
    if (!rule || !refresh || !fetchButton) return null;

    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;

    return {
      ruleThenRefresh: Boolean(rule.compareDocumentPosition(refresh) & FOLLOWING),
      refreshThenFetch: Boolean(refresh.compareDocumentPosition(fetchButton) & FOLLOWING),
    };
  });
  expect(order).toEqual({ ruleThenRefresh: true, refreshThenFetch: true });

  let weekReads = 0;
  // Registered after openWeek's own route for the same glob, so this one is
  // asked first and falls back to it — counting the read without having to
  // reimplement what it answers with.
  await page.route("**/api/week**", (route) => {
    if (!new URL(route.request().url()).pathname.endsWith("/fetch")) weekReads += 1;

    return route.fallback();
  });

  await refreshControl.click();
  await expect.poll(() => weekReads).toBe(1);
});

/**
 * A refresh landing mid-fetch would paint a half-applied week, and a fetch
 * launched mid-refresh is the same risk the other way round — so each
 * control disables the other for the whole of its own round trip. The two
 * directions are proven separately: holding the fetch's own response and
 * holding the read a refresh press triggers are different gates, and
 * conflating them into one route would gate the fetch's own internal re-read
 * by mistake.
 */
test("refresh is disabled while a fetch is in flight, and a press on it does nothing", async ({
  page,
}) => {
  await page.route("**/api/entries**", (route) =>
    route.fulfill({ status: 200, json: { today: THIS_WEEK, entries: [] } }),
  );

  const weekBody = rollup(THIS_WEEK, [
    row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "unpushed" }]),
  ]);

  let weekReads = 0;
  let release = (): void => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route("**/api/week**", async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/fetch")) {
      await held;

      return route.fulfill({
        status: 200,
        json: { start: THIS_WEEK, end: weekBody.end, created: 0, updated: 0, keptLocal: [], failures: [] },
      });
    }

    weekReads += 1;

    return route.fulfill({ status: 200, json: weekBody });
  });

  await page.goto("/week");

  const fetchControl = page.getByRole("button", { name: "Fetch worklogs" });
  const refreshControl = page.getByRole("button", { name: "Refresh" });
  await expect(fetchControl).toBeEnabled();

  await fetchControl.click();
  await expect(fetchControl).toBeDisabled();
  await expect(refreshControl).toBeDisabled();

  const readsBeforePress = weekReads;
  // Disabled buttons ignore a real click on their own; forcing one through is
  // what proves the press does nothing, rather than merely that it cannot be
  // aimed at.
  await refreshControl.click({ force: true });
  expect(weekReads).toBe(readsBeforePress);

  release();
  await expect(refreshControl).toBeEnabled();
  await expect(fetchControl).toBeEnabled();
});

test("the fetch control is disabled while a refresh is in flight, and a press on it does nothing", async ({
  page,
}) => {
  await page.route("**/api/entries**", (route) =>
    route.fulfill({ status: 200, json: { today: THIS_WEEK, entries: [] } }),
  );

  const weekBody = rollup(THIS_WEEK, [
    row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "unpushed" }]),
  ]);

  let fetchCalls = 0;
  let weekReads = 0;
  let release = (): void => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route("**/api/week**", async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/fetch")) {
      fetchCalls += 1;

      return route.fulfill({
        status: 200,
        json: { start: THIS_WEEK, end: weekBody.end, created: 0, updated: 0, keptLocal: [], failures: [] },
      });
    }

    weekReads += 1;
    // The mount's own read answers at once; only the read a refresh press
    // triggers — the second — is held, which is what catches that press in
    // flight rather than the mount itself.
    if (weekReads > 1) await held;

    return route.fulfill({ status: 200, json: weekBody });
  });

  await page.goto("/week");

  const fetchControl = page.getByRole("button", { name: "Fetch worklogs" });
  const refreshControl = page.getByRole("button", { name: "Refresh" });
  await expect(refreshControl).toBeEnabled();

  await refreshControl.click();
  await expect(refreshControl).toBeDisabled();
  await expect(fetchControl).toBeDisabled();

  await fetchControl.click({ force: true });
  expect(fetchCalls).toBe(0);

  release();
  await expect(fetchControl).toBeEnabled();
  await expect(refreshControl).toBeEnabled();
});

/**
 * A read that fails on a refresh press must surface the same way a read that
 * fails on a fetch press does — a visible alert naming what went wrong,
 * neither button left disabled behind it. show() itself already replaces the
 * grid with that alert on any failed read (the same path a direct navigation
 * to a bad week already goes through), so this is what proves refresh's own
 * press actually reaches it rather than swallowing the failure unseen.
 *
 * A second Refresh press must recover the grid, even when the read it
 * triggers comes back byte-identical to the last one that succeeded —
 * `showing` last resolved before the failed read ever painted, so a retry
 * naming the same week and returning the same body is the ordinary case, not
 * an edge one. `painted` must therefore forget what was on screen the moment
 * the alert replaces it, or an identical retry has nothing to compare against
 * and never repaints.
 */
test("a failed read on a refresh press surfaces the same way a failed fetch does, and a further refresh recovers it", async ({
  page,
}) => {
  await page.route("**/api/entries**", (route) =>
    route.fulfill({ status: 200, json: { today: THIS_WEEK, entries: [] } }),
  );

  const weekBody = rollup(THIS_WEEK, [
    row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "pushed" }]),
  ]);

  let weekReads = 0;
  await page.route("**/api/week**", (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/fetch")) {
      return route.fulfill({
        status: 200,
        json: { start: THIS_WEEK, end: weekBody.end, created: 0, updated: 0, keptLocal: [], failures: [] },
      });
    }

    weekReads += 1;
    // The mount's own read succeeds, so Refresh reaches its enabled state;
    // the read the first press triggers is the one that fails. Every read
    // after that — a second Refresh press among them — answers with the same
    // body the mount already painted, which is what proves recovery does not
    // depend on the retry returning something new.
    if (weekReads === 2) {
      return route.fulfill({
        status: 500,
        json: { code: "store_failed", message: "could not read the stored week" },
      });
    }

    return route.fulfill({ status: 200, json: weekBody });
  });

  await page.goto("/week");

  const refreshControl = page.getByRole("button", { name: "Refresh" });
  const fetchControl = page.getByRole("button", { name: "Fetch worklogs" });
  await expect(refreshControl).toBeEnabled();
  await expect(ticketRow(page, "RIDGE-1")).toBeVisible();

  await refreshControl.click();

  await expect(page.getByText("could not read the stored week")).toBeVisible();
  // Neither control is left stuck disabled behind the failure — the same
  // recovery fetch.spec.ts already proves for a failed fetch.
  await expect(refreshControl).toBeEnabled();
  await expect(fetchControl).toBeEnabled();

  await refreshControl.click();

  await expect(page.getByText("could not read the stored week")).not.toBeVisible();
  await expect(ticketRow(page, "RIDGE-1")).toBeVisible();
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

/**
 * #117 task 9, W1: the drawing puts the grid in `.tcard` — `--raised`, the
 * card shadow — and scrolls it inside its own container rather than letting
 * the page scroll sideways. The viewport is narrowed to force the nine-column
 * grid past it, the same bargain that-table already documents for the phone.
 * The page's own scrollWidth staying within its clientWidth is the half that
 * matters: measuring the card's own scroll alone would still pass if the page
 * moved with it, and so would asserting scrollLeft stays 0 without ever
 * scrolling the page — that holds whether or not the page *can* scroll, which
 * is what let the fix-wave's header overflow (finding 2) go uncaught here.
 */
test("the grid sits in a raised card with the card shadow, and a wide week scrolls inside it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWeek(page, {
    [THIS_WEEK]: rollup(THIS_WEEK, [
      row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "pushed" }]),
    ]),
  });

  const card = page.locator("table").locator("xpath=..");
  await expect(card).toBeVisible();

  const style = await card.evaluate((element) => {
    const computed = getComputedStyle(element);
    return { background: computed.backgroundColor, shadow: computed.boxShadow, overflowX: computed.overflowX };
  });
  const surface = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.className = "bg-raised shadow-card";
    document.body.append(probe);
    const computed = getComputedStyle(probe);
    const result = { background: computed.backgroundColor, shadow: computed.boxShadow };
    probe.remove();
    return result;
  });

  expect(style.background).toBe(surface.background);
  expect(style.shadow).toBe(surface.shadow);
  expect(style.overflowX).toBe("auto");

  await card.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  await expect.poll(() => card.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

  // Nobody scrolled the page, so scrollLeft alone would stay 0 whether or not
  // it could — comparing scrollWidth against clientWidth is what actually
  // fails when the overflow reaches <body>.
  const pageOverflow = await page.evaluate(() => {
    const root = document.scrollingElement;
    return root ? root.scrollWidth - root.clientWidth : -1;
  });
  expect(pageOverflow).toBeLessThanOrEqual(0);
});

/**
 * #117 task 9, W2: `.grid .fig` and `.grid .kk` wear Chivo Mono, and the
 * whole table keeps its figures tabular via `.that-tnum`.
 */
test("a filled cell's figure and a row's key wear the mono face", async ({ page }) => {
  await openWeek(page, {
    [THIS_WEEK]: rollup(THIS_WEEK, [
      row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "pushed" }]),
    ]),
  });

  const figure = ticketRow(page, "RIDGE-1").locator("td").first().locator("button span");
  await expect(figure).toHaveText("1h 00m");
  expect(await figure.evaluate((element) => getComputedStyle(element).fontFamily)).toContain(
    "Chivo Mono",
  );

  const key = ticketRow(page, "RIDGE-1").locator(".that-key");
  expect(await key.evaluate((element) => getComputedStyle(element).fontFamily)).toContain(
    "Chivo Mono",
  );

  expect(await page.locator("table").evaluate((element) => getComputedStyle(element).fontVariantNumeric)).toBe(
    "tabular-nums",
  );
});

/**
 * #117 task 10, W4: the ticket key is a link to the issue in Jira — its
 * `href` is the browse URL the rollup carries — muted at rest and brightening
 * to full ink on hover, the rule `.that-key` already states for Today.
 */
test("the ticket key opens the issue in Jira, ink-muted at rest and full ink on hover", async ({
  page,
}) => {
  await openWeek(page, {
    [THIS_WEEK]: rollup(THIS_WEEK, [
      row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "pushed" }]),
    ]),
  });

  const key = ticketRow(page, "RIDGE-1").locator(".that-key");
  await expect(key).toHaveAttribute("href", "https://ridgeline.atlassian.net/browse/RIDGE-1");
  await expect(key).toHaveCSS("color", INK_MUTED_LIGHT);

  await key.hover();
  await expect(key).toHaveCSS("color", INK_LIGHT);
});

/**
 * #117 task 10, W4: an instance migrated from a gateway URL carries no site to
 * link to, so its row's key stays plain text rather than a dead anchor —
 * the same rule Today's own keyLabel already follows.
 */
test("a key from an instance with no site URL renders as plain text", async ({ page }) => {
  await openWeek(page, {
    [THIS_WEEK]: rollup(THIS_WEEK, [
      row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "pushed" }], 1, ""),
    ]),
  });

  const key = ticketRow(page, "RIDGE-1").locator(".that-key");
  await expect(key).toHaveText("RIDGE-1");
  const tagName = await key.evaluate((element) => element.tagName);
  expect(tagName).toBe("SPAN");
});

/**
 * #117 task 9, W3: `.grid thead th` — 12px, weight 700, .06em tracking,
 * uppercase, a 9px bottom padding and a hairline beneath. Read off a day
 * column rather than Ticket, whose own `.tk` class wins the weight back to
 * 400 in the drawing.
 */
test("a header cell wears the drawn type, its own 9px bottom padding, and a hairline", async ({
  page,
}) => {
  await openWeek(page, {
    [THIS_WEEK]: rollup(THIS_WEEK, [
      row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "pushed" }]),
    ]),
  });

  const th = page.locator("table thead th").nth(1);
  const type = await th.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      fontSize: parseFloat(computed.fontSize),
      fontWeight: computed.fontWeight,
      letterSpacing: parseFloat(computed.letterSpacing),
      textTransform: computed.textTransform,
      paddingBottom: parseFloat(computed.paddingBottom),
    };
  });

  expect(type.fontSize).toBe(12);
  expect(type.fontWeight).toBe("700");
  // 0.06em against a 12px font-size.
  expect(type.letterSpacing).toBeCloseTo(0.72, 1);
  expect(type.textTransform).toBe("uppercase");
  expect(type.paddingBottom).toBe(9);
  await expect(th).toHaveCSS("border-bottom-width", "1px");
});

/**
 * #117 task 9, W6: a tbody row is 46px tall; a cell's trigger carries the
 * drawing's 9px/13px padding given back as the same negative margin; tfoot
 * carries a 12px block padding.
 */
test("a body row is 46px, a cell's trigger carries the drawn padding, and tfoot is padded 12px", async ({
  page,
}) => {
  await openWeek(page, {
    [THIS_WEEK]: rollup(THIS_WEEK, [
      row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "pushed" }]),
    ]),
  });

  const height = await ticketRow(page, "RIDGE-1").evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  expect(Math.round(height)).toBe(46);

  const trigger = ticketRow(page, "RIDGE-1").locator("td").first().locator("button");
  const cell = await trigger.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      paddingTop: parseFloat(computed.paddingTop),
      paddingLeft: parseFloat(computed.paddingLeft),
      marginTop: parseFloat(computed.marginTop),
      marginLeft: parseFloat(computed.marginLeft),
    };
  });
  expect(cell.paddingTop).toBe(9);
  expect(cell.paddingLeft).toBe(13);
  expect(cell.marginTop).toBe(-9);
  expect(cell.marginLeft).toBe(-13);

  const footCell = page.locator("tfoot td").first();
  const footPadding = await footCell.evaluate((element) => {
    const computed = getComputedStyle(element);
    return { top: parseFloat(computed.paddingTop), bottom: parseFloat(computed.paddingBottom) };
  });
  expect(footPadding.top).toBe(12);
  expect(footPadding.bottom).toBe(12);
});

/**
 * #117 task 10, W12: `.cell:hover, .cell:focus-visible { background: var(--hover) }`
 * — a grid cell takes the same hover wash on keyboard focus that it takes
 * under the pointer, which is what makes tabbing through a week legible.
 */
test("a cell takes the hover wash on keyboard focus as well as pointer hover", async ({ page }) => {
  await openWeek(page, {
    [THIS_WEEK]: rollup(THIS_WEEK, [
      row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "pushed" }]),
    ]),
  });

  const trigger = ticketRow(page, "RIDGE-1").locator("td").first().locator("button");
  const resting = await trigger.evaluate((element) => getComputedStyle(element).backgroundColor);

  await trigger.hover();
  const hovered = await trigger.evaluate((element) => getComputedStyle(element).backgroundColor);
  await page.mouse.move(0, 0);

  await trigger.focus();
  const focused = await trigger.evaluate((element) => getComputedStyle(element).backgroundColor);

  expect(hovered).not.toBe(resting);
  expect(focused).toBe(hovered);
});

/**
 * #117 task 9, W7: the drawing's `.pageh h3` is 15px at weight 500 — a
 * downgrade from the app's shipped `text-xl font-bold` — because Week's title
 * now takes the app's shared page-heading shape rather than its own.
 */
test("the week title takes the page-heading shape: 15px at weight 500", async ({ page }) => {
  await openWeek(page, {
    [THIS_WEEK]: rollup(THIS_WEEK, [
      row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "pushed" }]),
    ]),
  });

  const heading = page.getByRole("heading", { level: 2 });
  const type = await heading.evaluate((element) => {
    const computed = getComputedStyle(element);
    return { fontSize: parseFloat(computed.fontSize), fontWeight: computed.fontWeight };
  });
  expect(type.fontSize).toBe(15);
  expect(type.fontWeight).toBe("500");
});

/**
 * #117 fix wave, finding 7: `.pageh` carries 10px in the drawing wherever it
 * appears (prototype lines 329, 331, 353) — the same value Today's own
 * heading-to-content gap uses. Week's header used to strip its own mb-2.5,
 * on the mistaken belief that the container's space-y-4 would stack another
 * 16px onto it; space-y-4's margin lands through a zero-specificity
 * `:where()`, so header's real `.mb-2.5` class already wins outright and the
 * strip only left the wrong value (16px) standing.
 */
test("the week header keeps the drawn 10px gap above the grid", async ({ page }) => {
  await openWeek(page, {
    [THIS_WEEK]: rollup(THIS_WEEK, [
      row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "pushed" }]),
    ]),
  });

  const header = page.getByRole("heading", { level: 2 }).locator("xpath=..");
  const marginBottom = await header.evaluate(
    (element) => getComputedStyle(element).marginBottom,
  );
  expect(marginBottom).toBe("10px");
});

/**
 * #117 task 9, W9: `th + th`/`td + td` carry a 10px column gap; `.tk` stays
 * content-width and nowrap with its own 10px right padding rather than the
 * generic left one; `.tot` overrides the gap to 18px.
 *
 * `.tot` belongs to a row's own total alone — the prototype's tfoot markup
 * carries `fig` on every cell and `tot` on none of them, so the week total
 * takes the same generic 10px `dayTotal` beside it does. Fix round 1 caught
 * this test asserting 18px for both, the same misreading the source carried,
 * so the earlier green run proved nothing about the week total's own gap.
 */
test("columns keep their drawn 10px gap, Ticket stays content-width, and a row's own total sits 18px off it", async ({
  page,
}) => {
  await openWeek(page, {
    [THIS_WEEK]: rollup(THIS_WEEK, [
      row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "pushed" }]),
    ]),
  });

  const tkHeader = page.locator("table thead th").first();
  const dayHeader = page.locator("table thead th").nth(1);
  await expect(dayHeader).toHaveCSS("padding-left", "10px");

  const tk = await tkHeader.evaluate((element) => {
    const computed = getComputedStyle(element);
    return { paddingRight: parseFloat(computed.paddingRight), whiteSpace: computed.whiteSpace };
  });
  expect(tk.paddingRight).toBe(10);
  expect(tk.whiteSpace).toBe("nowrap");

  const tkWidth = (await tkHeader.boundingBox())?.width ?? 0;
  const dayWidth = (await dayHeader.boundingBox())?.width ?? 0;
  expect(tkWidth).toBeLessThan(dayWidth);

  // The first day cell (Monday, nth(0)) follows the row's <th>, not a <td> —
  // `.grid td + td` never matches there, so its gap comes only from `.tk`'s
  // own 10px padding-right, not a second 10px stacked onto it.
  const firstDayCell = ticketRow(page, "RIDGE-1").locator("td").nth(0);
  await expect(firstDayCell).toHaveCSS("padding-left", "0px");

  const dayCell = ticketRow(page, "RIDGE-1").locator("td").nth(1);
  await expect(dayCell).toHaveCSS("padding-left", "10px");

  const rowTotal = ticketRow(page, "RIDGE-1").locator("td").last();
  await expect(rowTotal).toHaveCSS("padding-left", "18px");

  // The week total in tfoot is not `.tot` in the drawing — it wears the same
  // generic 10px gap as the day total beside it, not the row total's 18px.
  const weekTotal = page.locator("tfoot td").last();
  await expect(weekTotal).toHaveCSS("padding-left", "10px");
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

/**
 * Task 5's own assertion: a cell in a week that is not this one opens the
 * dialog on the day it belongs to, not on whatever the server resolves as
 * today — and once the dialog adds time, the whole grid it came from settles
 * to match, which is only possible because Week is listening for the
 * announcement its own dialog fires.
 *
 * The POST stub only bumps 2026-08-31's rollup when the request itself named
 * that day: a cell that silently fell back to sending no day at all would
 * leave every assertion below reading the grid's untouched, original figures
 * instead of failing loudly.
 */
test("opening a past Monday's cell and adding time moves the cell, its row total, that day's total, and the week total — and the dialog names that Monday, not today", async ({
  page,
}) => {
  const entries: StubEntry[] = [entry(1, "RIDGE-9", "2026-08-31", 3600, "pushed")];
  let nextId = 2;

  const rollups: Record<string, StubRollup> = {
    [THIS_WEEK]: rollup(THIS_WEEK, []),
    "2026-08-31": rollup("2026-08-31", [
      row("RIDGE-9", [{ at: 0, seconds: 3600, pushState: "pushed" }]),
    ]),
  };

  await openWeek(page, rollups, [], "/week?start=2026-08-31");

  // Overrides openWeek's own blanket /api/entries stub: this one actually
  // answers a ranged GET from the list a POST just grew, the way the real
  // server does, so the dialog and the grid can be proven to agree.
  await page.route("**/api/entries**", async (route) => {
    const request = route.request();

    if (request.method() === "POST") {
      const body = request.postDataJSON() as {
        issueKey: string;
        day?: string;
        seconds: number;
        comment: string;
      };
      const created = entry(nextId, body.issueKey, body.day ?? THIS_WEEK, body.seconds, "unpushed");
      nextId += 1;
      entries.push(created);

      // pushed, not unpushed: the footer's own day total would otherwise grow
      // a worst-wins marker and the sr-only words beside it, which is a
      // separate claim from the one this test makes about the figures alone.
      if (body.day === "2026-08-31") {
        rollups["2026-08-31"] = rollup("2026-08-31", [
          row("RIDGE-9", [{ at: 0, seconds: 3600 + body.seconds, pushState: "pushed" }]),
        ]);
      }

      await route.fulfill({ status: 201, json: created });

      return;
    }

    const url = new URL(request.url());
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const scoped =
      from && to ? entries.filter((candidate) => candidate.day >= from && candidate.day <= to) : entries;
    // THIS_WEEK stands in for whatever the server resolves as today — a
    // different string from 2026-08-31, which is the whole point: the day
    // line below must not read as today's.
    await route.fulfill({ status: 200, json: { today: THIS_WEEK, entries: scoped } });
  });

  await expect(page.getByRole("heading", { name: "Week 36 · 31 Aug – 6 Sep" })).toBeVisible();

  const cell = ticketRow(page, "RIDGE-9").locator("td").first().locator("button");
  await expect(cell).toContainText("1h 00m");
  await cell.click();

  const dialog = page.locator("dialog[open]");
  await expect(dialog).toBeVisible();
  // Monday 31 August, per format.ts's longDay — never today's own weekday,
  // which is what a ticket that forgot to carry its day would show instead.
  await expect(page.locator("#that-entry-dialog-day")).toHaveText("Monday 31 August");

  await dialog.getByLabel("Duration").fill("30");
  await dialog.getByLabel("Duration").press("Enter");
  await dialog.getByRole("button", { name: "Add entry" }).click();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);

  await expect(cell).toHaveText("1h 30m");
  await expect(ticketRow(page, "RIDGE-9").locator("td").last()).toHaveText("1h 30m");
  // tfoot's first td is Monday's own day total — the "Total" label beside it
  // is a <th>, so the day totals are tds from index 0.
  await expect(page.locator("tfoot td").first()).toHaveText("1h 30m");
  await expect(page.locator("tfoot td").last()).toHaveText("1h 30m");
});

/**
 * `onEntriesChanged` returns its own unsubscribe, and Week is supposed to
 * hand that to the router's teardown the way Today already does for its
 * "online" listener. Nothing on screen would show a leaked subscription —
 * the grid it would repaint is not there to look at — so this proves it by
 * counting: a leaked listener re-reads /api/week after the announcement,
 * a torn-down one does not.
 */
test("navigating away from Week removes its entries-changed listener, so a later change triggers no re-read", async ({
  page,
}) => {
  await openWeek(page, {
    [THIS_WEEK]: rollup(THIS_WEEK, [row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "pushed" }])]),
  });
  await page.route("**/api/instances", (route) => route.fulfill({ status: 200, json: [] }));

  // The mount's own read has to settle before the counting route goes on
  // below, or that first read races the route registration and can land
  // inside the count it is trying to keep at zero.
  await expect(ticketRow(page, "RIDGE-1")).toBeVisible();

  let weekReads = 0;
  // Registered after openWeek's own /api/week route, so this one is asked
  // first and falls back to it — counting reads without reimplementing what
  // they answer with, the same trick the Refresh test above uses.
  await page.route("**/api/week**", (route) => {
    if (!new URL(route.request().url()).pathname.endsWith("/fetch")) weekReads += 1;

    return route.fallback();
  });

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);

  // The event Week's own dialog fires after a mutation elsewhere — see
  // entries-changed.ts. Dispatched directly here since Settings mounts no
  // dialog of its own to fire it through.
  await page.evaluate(() => document.dispatchEvent(new CustomEvent("that-entries-changed")));

  // No positive signal exists for "nothing happened" — a leaked listener's
  // re-read would land well inside this window, the same margin
  // today.spec.ts gives its own "online" leak test.
  await page.waitForTimeout(500);

  expect(weekReads).toBe(0);
});

/**
 * Review finding on the first cut of this task: rail.ts's own push handler
 * swallows a failing re-read after announcing the push report (see
 * rail.ts:315-322), so its trailing entries-changed announcement — the one
 * this view's own subscription exists to hear — sometimes never arrives at
 * all. A guard that waited for exactly that announcement to clear itself
 * would stay set, and every genuine entries-changed event after it — a cell's
 * own dialog adding time, no less — would be swallowed right along with it:
 * the user adds time and the grid does not move, silently.
 *
 * This is why the fix carries no such guard: `show`'s `preserveFailures`
 * option lets the push's own re-read and the entries-changed re-read both
 * paint the same marks without either one needing to know whether, or when,
 * the other already ran.
 */
test("a push whose own trailing re-read fails still lets a later edit repaint the grid", async ({
  page,
}) => {
  const entries: StubEntry[] = [entry(1, "RIDGE-1", THIS_WEEK, 3600, "unpushed")];
  let nextId = 2;

  const rollups: Record<string, StubRollup> = {
    [THIS_WEEK]: rollup(THIS_WEEK, [
      row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "unpushed" }]),
    ]),
  };

  // Not openWeek(): its own /api/entries stub answers every request with the
  // same blank list, and registering a replacement only after it — and after
  // its page.goto() — leaves a real window where the app's own boot-time read
  // reaches that blank stub before this one is in place, which starves Push
  // this week of anything to push and hangs the test. Every route below goes
  // on before the one navigation that can fire requests against them.
  await page.route("**/api/week**", (route) => {
    const start = new URL(route.request().url()).searchParams.get("start") ?? THIS_WEEK;
    const body = rollups[start];
    if (!body) {
      return route.fulfill({
        status: 400,
        json: { code: "start_not_monday", message: "start must be a Monday, of the form YYYY-MM-DD" },
      });
    }

    return route.fulfill({ status: 200, json: body });
  });

  // Flipped once the push itself has answered, so the whole-week read that
  // fails below is only the one rail.ts fires *after* reporting the push —
  // the rail's own boot read (which is what enables Push this week in the
  // first place) still needs to succeed.
  let pushAnswered = false;
  await page.route("**/api/push**", async (route) => {
    await route.fulfill({ status: 200, json: { day: THIS_WEEK, results: [unreachable(1, "RIDGE-1")] } });
    pushAnswered = true;
  });

  // The whole handler this test needs — a ranged GET, an unranged GET (the
  // rail's own boot and post-push reads), and a POST — rather than openWeek's
  // blanket stub, for the reason given above.
  await page.route("**/api/entries**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === "POST") {
      const body = request.postDataJSON() as {
        issueKey: string;
        day?: string;
        seconds: number;
        comment: string;
      };
      const created = entry(nextId, body.issueKey, body.day ?? THIS_WEEK, body.seconds, "unpushed");
      nextId += 1;
      entries.push(created);

      if (body.day === THIS_WEEK) {
        rollups[THIS_WEEK] = rollup(THIS_WEEK, [
          row("RIDGE-1", [{ at: 0, seconds: 3600 + body.seconds, pushState: "unpushed" }]),
        ]);
      }

      await route.fulfill({ status: 201, json: created });

      return;
    }

    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (pushAnswered && from === THIS_WEEK && to === "2026-09-13") {
      await route.fulfill({
        status: 500,
        json: { code: "store_failed", message: "could not read the stored entries" },
      });

      return;
    }

    const scoped =
      from && to ? entries.filter((candidate) => candidate.day >= from && candidate.day <= to) : entries;
    await route.fulfill({ status: 200, json: { today: THIS_WEEK, entries: scoped } });
  });

  await page.goto("/week");

  const cell = ticketRow(page, "RIDGE-1").locator("td").first().locator("button");
  await expect(cell).toContainText("1h 00m");
  // Push this week reflects the rail's own boot read of the same entries
  // stub above; waiting for it here (rather than letting pushEverything's
  // own click retry blindly) is what turns a starved stub into a clear
  // assertion failure instead of a 30-second timeout.
  await expect(page.getByRole("button", { name: "Push this week" })).toBeEnabled();

  await pushEverything(page);
  // The push's own report still names the failure — its re-read (preserved)
  // painted it, whether or not rail.ts's own trailing read ever landed.
  await expect(cell).toHaveAttribute("aria-label", /did not reach Jira/);

  // rail.ts's trailing read just failed, silently, so no second
  // entries-changed announcement ever arrived for this push — the exact gap
  // a staleness bug in the guard would have left open.
  await cell.click();
  const dialog = page.locator("dialog[open]");
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Duration").fill("30");
  await dialog.getByLabel("Duration").press("Enter");
  await dialog.getByRole("button", { name: "Add entry" }).click();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);

  await expect(cell).toHaveText("1h 30m");
});

/**
 * Task 6: Week's own mount of that-issue-search, and the transient row a
 * chosen result adds to the grid — design decisions 1, 3 and 4. Both halves
 * of the second test are required: logging into the row and it surviving
 * navigation would also pass if rows were stored outright, and losing a
 * never-logged one would also pass if rows were never added at all — see
 * task-6-brief.md's own wording for this.
 */

interface StubIssueHit {
  instanceId: number;
  instanceName: string;
  instancePosition: number;
  key: string;
  summary: string;
  status: string;
  url: string;
}

function searchHit(key: string, summary: string): StubIssueHit {
  return {
    instanceId: 1,
    instanceName: "Ridgeline",
    instancePosition: 0,
    key,
    summary,
    status: "To Do",
    url: `${siteOf(1)}/browse/${key}`,
  };
}

function weekSearchField(page: Page) {
  return page.getByRole("textbox", { name: "Add a ticket to this week", exact: true });
}

/** The result row for `key`, scoped from the key's own link — the only
 *  element in a row that names its ticket, the same reasoning search.spec.ts's
 *  own resultRow gives: every control's accessible name is fixed per
 *  IssueSearchControl and repeats across rows. */
function weekSearchResultRow(page: Page, key: string) {
  return page.getByTitle(`Open ${key} in Jira`).locator("..");
}

test.describe("Week's own search", () => {
  test("a chosen result carries the add-to-week and pin controls, and no duration control", async ({
    page,
  }) => {
    await openWeek(page, { [THIS_WEEK]: rollup(THIS_WEEK, []) });
    await page.route("**/api/issues/search**", (route) =>
      route.fulfill({
        status: 200,
        json: { results: [searchHit("RIDGE-9001", "Draft the onboarding checklist")], errors: [] },
      }),
    );

    await page.goto("/week");
    await weekSearchField(page).fill("ridge");

    const resultRow = weekSearchResultRow(page, "RIDGE-9001");
    await expect(resultRow).toBeVisible();
    await expect(
      resultRow.getByRole("button", { name: "Add RIDGE-9001 to this week", exact: true }),
    ).toBeVisible();
    await expect(resultRow.getByRole("button", { name: "Pin RIDGE-9001", exact: true })).toBeVisible();
    // Decision 3: Week's result rows carry no duration control — logging
    // happens in the day cells the row joins, never in the search panel.
    await expect(resultRow.getByRole("button", { name: /Log time against/ })).toHaveCount(0);

    await expect(
      page.getByText(
        "Searching all instances. Choosing a result adds it to this week; click a day to log time.",
      ),
    ).toBeVisible();
  });

  test("a row added by search survives once logged, and disappears once abandoned", async ({ page }) => {
    const entries: StubEntry[] = [];
    let nextId = 1;

    function currentRows(): StubRow[] {
      const days = WEEKS[THIS_WEEK]?.days ?? [];
      const byKey = new Map<string, StubEntry[]>();
      for (const logged of entries) {
        const list = byKey.get(logged.issueKey) ?? [];
        list.push(logged);
        byKey.set(logged.issueKey, list);
      }

      return [...byKey.entries()].map(([issueKey, list]) => {
        const first = list[0];

        return row(
          issueKey,
          list.map((each) => ({ at: days.indexOf(each.day), seconds: each.seconds, pushState: each.pushState })),
          first?.instanceId ?? 1,
        );
      });
    }

    // Every route below goes on before the one navigation that can fire
    // requests against them — the same ordering the file's last test insists
    // on, for the same reason.
    await page.route("**/api/week**", (route) => {
      const start = new URL(route.request().url()).searchParams.get("start") ?? THIS_WEEK;
      if (start !== THIS_WEEK) {
        return route.fulfill({
          status: 400,
          json: { code: "start_not_monday", message: "start must be a Monday, of the form YYYY-MM-DD" },
        });
      }

      return route.fulfill({ status: 200, json: rollup(THIS_WEEK, currentRows()) });
    });

    await page.route("**/api/entries**", async (route) => {
      const request = route.request();
      if (request.method() === "POST") {
        const body = request.postDataJSON() as {
          instanceId: number;
          issueKey: string;
          day?: string;
          seconds: number;
          comment: string;
        };
        const created = entry(nextId, body.issueKey, body.day ?? THIS_WEEK, body.seconds, "unpushed");
        nextId += 1;
        entries.push(created);
        await route.fulfill({ status: 201, json: created });

        return;
      }

      if (request.method() === "DELETE") {
        const id = Number(request.url().split("/").pop());
        const index = entries.findIndex((each) => each.id === id);
        if (index >= 0) entries.splice(index, 1);
        await route.fulfill({ status: 204, body: "" });

        return;
      }

      await route.fulfill({ status: 200, json: { today: THIS_WEEK, entries } });
    });

    await page.route("**/api/issues/search**", (route) =>
      route.fulfill({
        status: 200,
        json: {
          results: [
            searchHit("RIDGE-9001", "Draft the onboarding checklist"),
            searchHit("RIDGE-9002", "Refresh the runbook diagrams"),
          ],
          errors: [],
        },
      }),
    );
    // Today's own mount, once this test navigates there and back — nothing
    // assigned or pinned, so it has nothing to say about either ticket.
    await page.route("**/api/issues", (route) => route.fulfill({ status: 200, json: { instances: [] } }));
    await page.route("**/api/pins**", (route) => {
      if (route.request().method() !== "GET") return route.fallback();

      return route.fulfill({ status: 200, json: [] });
    });

    await page.goto("/week");
    // The week opens with nothing logged and nothing added, so the grid
    // itself is still "Nothing logged this week." — the field beside it is
    // what this test waits on, not a table that has no row to show yet.
    await expect(weekSearchField(page)).toBeVisible();

    // Add the first ticket. It joins the grid with nothing logged: seven
    // empty cells and an em dash total — decision 1's own words for a row
    // with nothing in it that week, applied to a row search just added.
    await weekSearchField(page).fill("ridge");
    await weekSearchResultRow(page, "RIDGE-9001")
      .getByRole("button", { name: "Add RIDGE-9001 to this week", exact: true })
      .click();
    await expect(ticketRow(page, "RIDGE-9001").locator("td")).toHaveText(
      ["—", "—", "—", "—", "—", "—", "—", "—"],
      { useInnerText: true },
    );

    // Log an hour into Wednesday. The cell does the logging — the panel
    // never did, and never offered to.
    await ticketRow(page, "RIDGE-9001").locator("td").nth(2).locator("button").click();
    const dialog = page.locator("dialog[open]");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Duration").fill("60");
    await dialog.getByLabel("Duration").press("Enter");
    await dialog.getByRole("button", { name: "Add entry" }).click();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(ticketRow(page, "RIDGE-9001").locator("td").nth(2).locator("button")).toContainText(
      "1h 00m",
    );

    // Delete that same entry, with no navigation anywhere near it. Decision
    // 3's settled rule is "an add lasts until you leave the view" — not
    // until its last entry is gone — so the row this search deliberately
    // added must still be here, empty again, ready for the right day. The
    // old, superseded rule (drop the key the moment an entry existed) would
    // have let the rollup's own read carry this row for exactly as long as
    // the entry lived, then lose it the instant this delete lands — this is
    // the assertion that tells the two apart.
    await ticketRow(page, "RIDGE-9001").locator("td").nth(2).locator("button").click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Delete the 09:00 entry" }).click();
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(ticketRow(page, "RIDGE-9001").locator("td")).toHaveText(
      ["—", "—", "—", "—", "—", "—", "—", "—"],
      { useInnerText: true },
    );

    // Log the hour again, into the right day this time, so the row still
    // carries real time to survive the navigation below on its own account.
    await ticketRow(page, "RIDGE-9001").locator("td").nth(2).locator("button").click();
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Duration").fill("60");
    await dialog.getByLabel("Duration").press("Enter");
    await dialog.getByRole("button", { name: "Add entry" }).click();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(ticketRow(page, "RIDGE-9001").locator("td").nth(2).locator("button")).toContainText(
      "1h 00m",
    );

    // Add a second ticket and leave it exactly as added: nothing logged.
    await weekSearchField(page).fill("ridge");
    await weekSearchResultRow(page, "RIDGE-9002")
      .getByRole("button", { name: "Add RIDGE-9002 to this week", exact: true })
      .click();
    await expect(ticketRow(page, "RIDGE-9002")).toBeVisible();

    // Navigate away and back. RIDGE-9001 survives — the rollup now carries
    // it for real, logged time and all. RIDGE-9002 does not: this mount's own
    // memory of adding it died with the view, and the fresh read the new
    // mount opens with carries no entries for it either.
    await page.getByRole("link", { name: "Today", exact: true }).click();
    await expect(page).toHaveURL(/\/today$/);
    await page.getByRole("link", { name: "Week", exact: true }).click();
    await expect(page.locator("table")).toBeVisible();

    await expect(ticketRow(page, "RIDGE-9001").locator("td").nth(2).locator("button")).toContainText(
      "1h 00m",
    );
    await expect(page.locator("tbody tr", { hasText: "RIDGE-9002" })).toHaveCount(0);
  });

  test("the pin control posts to /api/pins with the chosen ticket, and a failure reports below the grid", async ({
    page,
  }) => {
    await openWeek(page, { [THIS_WEEK]: rollup(THIS_WEEK, []) });
    await page.route("**/api/issues/search**", (route) =>
      route.fulfill({
        status: 200,
        json: {
          results: [
            searchHit("RIDGE-9001", "Draft the onboarding checklist"),
            searchHit("RIDGE-9002", "Refresh the runbook diagrams"),
          ],
          errors: [],
        },
      }),
    );

    // Week's pin control calls createPin directly — a different path from
    // Today's PIN-event dispatch — so this stub is what proves it reaches
    // the right endpoint with the right arguments, not just that a click
    // does something.
    const posted: Record<string, unknown>[] = [];
    let refuseNext = false;
    await page.route("**/api/pins", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();

      if (refuseNext) {
        await route.fulfill({
          status: 409,
          json: { code: "pin_exists", message: "that issue is already pinned on this instance" },
        });

        return;
      }

      const body = route.request().postDataJSON() as Record<string, unknown>;
      posted.push(body);
      await route.fulfill({
        status: 201,
        json: {
          id: 5,
          instanceId: body["instanceId"],
          instanceName: "Ridgeline",
          instancePosition: 0,
          key: body["issueKey"],
          summary: "Draft the onboarding checklist",
          status: "To Do",
          url: `${siteOf(1)}/browse/${String(body["issueKey"])}`,
          error: null,
        },
      });
    });

    await page.goto("/week");
    await weekSearchField(page).fill("ridge");
    await weekSearchResultRow(page, "RIDGE-9001")
      .getByRole("button", { name: "Pin RIDGE-9001", exact: true })
      .click();

    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0]).toMatchObject({ instanceId: 1, issueKey: "RIDGE-9001" });
    // Week draws no pin mark of its own (decision 1: a pinned row and a
    // searched one are indistinguishable), so a successful pin has nothing
    // else on screen to show for it — no alert is the whole of the proof.
    await expect(page.locator("that-alert[tone='error']")).toHaveCount(0);

    refuseNext = true;
    await weekSearchResultRow(page, "RIDGE-9002")
      .getByRole("button", { name: "Pin RIDGE-9002", exact: true })
      .click();

    await expect(page.locator("that-alert[tone='error']")).toContainText(
      "that issue is already pinned on this instance",
    );
  });
});
