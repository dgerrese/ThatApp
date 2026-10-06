import { expect, test, type Locator, type Page } from "@playwright/test";

interface StubRunning {
  instanceId: number;
  issueKey: string;
  startedAt: number; // epoch ms
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
  pushState: "unpushed";
}

/** What the stub heard and wrote, for a test to assert on. */
interface TimerRecorder {
  stops: Record<string, unknown>[];
  starts: Record<string, unknown>[];
  logged: StubEntry[];
}

const GRID_SECONDS = 900;

/**
 * A stateful stand-in for the three real timer endpoints, applying the same
 * rules the store does — switch, the 15-minute grid the stop dialog chose,
 * and a zero rounding discarding the run — so this spec proves the browser's
 * *interface* to them without a second proof of the rules themselves. Those
 * already have table-driven coverage in internal/store/timers_test.go and
 * internal/server/timer_test.go; see Task 3 step 1's note in
 * docs/superpowers/plans/2026-09-18-timer.md for why this spec does not drive
 * the real endpoints.
 *
 * One closure per test, so a test can run fully parallel with any other: no
 * state survives past the page it was created for, and a page.route survives
 * page.reload(), which is what lets the reload test work against it too.
 */
async function stubTimer(page: Page, options?: { runningFor?: number }): Promise<TimerRecorder> {
  const recorder: TimerRecorder = { stops: [], starts: [], logged: [] };
  let running: StubRunning | null =
    options?.runningFor === undefined
      ? null
      : { instanceId: 1, issueKey: "WORK-1", startedAt: Date.now() - options.runningFor * 1000 };
  let nextEntryId = 1;

  const runningDTO = () =>
    running && {
      instanceId: running.instanceId,
      issueKey: running.issueKey,
      startedAt: new Date(running.startedAt).toISOString(),
    };

  const isRounding = (value: unknown): value is "up" | "down" => value === "up" || value === "down";

  // Closes whatever is running as of `now` on the grid `round` names. Returns
  // the entry, or null — nothing was running, or the rounding came to zero.
  const close = (now: number, round: "up" | "down", comment: string) => {
    if (!running) return null;
    const elapsed = Math.floor((now - running.startedAt) / 1000);
    const steps = round === "up" ? Math.ceil(elapsed / GRID_SECONDS) : Math.floor(elapsed / GRID_SECONDS);
    const seconds = steps * GRID_SECONDS;
    const closed = running;
    running = null;
    if (seconds === 0) return null;

    const entry: StubEntry = {
      id: nextEntryId++,
      instanceId: closed.instanceId,
      instanceName: "Work",
      instancePosition: 0,
      issueKey: closed.issueKey,
      day: "2026-09-21",
      startedAt: new Date(closed.startedAt).toISOString(),
      seconds,
      comment,
      pushState: "unpushed",
    };
    recorder.logged.push(entry);

    return entry;
  };

  await page.route("**/api/timer", (route) =>
    route.fulfill({ status: 200, json: { running: runningDTO(), stopped: null } }),
  );

  await page.route("**/api/timer/start", (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    recorder.starts.push(body);
    const wasRunning = running !== null;
    if (wasRunning && !isRounding(body["round"])) {
      return route.fulfill({ status: 400, json: { code: "invalid_request", message: "round" } });
    }
    const stopped = isRounding(body["round"])
      ? close(Date.now(), body["round"], String(body["comment"] ?? ""))
      : null;
    running = { instanceId: Number(body["instanceId"]), issueKey: String(body["issueKey"]), startedAt: Date.now() };

    return route.fulfill({
      status: 200,
      json: { running: runningDTO(), stopped, discarded: wasRunning && stopped === null },
    });
  });

  await page.route("**/api/timer/stop", (route) => {
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    recorder.stops.push(body);
    const round = body["round"];
    if (!isRounding(round)) {
      return route.fulfill({ status: 400, json: { code: "invalid_request", message: "round" } });
    }
    const wasRunning = running !== null;
    const stopped = close(Date.now(), round, String(body["comment"] ?? ""));

    return route.fulfill({ status: 200, json: { stopped, discarded: wasRunning && stopped === null } });
  });

  return recorder;
}

async function stubToday(page: Page): Promise<void> {
  await page.route("**/api/issues", (route) =>
    route.fulfill({
      status: 200,
      json: {
        instances: [
          {
            id: 1,
            name: "Work",
            issues: [
              { key: "WORK-1", summary: "Fix the export", status: "In Progress", url: "" },
              { key: "WORK-2", summary: "Tidy the backlog", status: "To Do", url: "" },
            ],
            error: null,
          },
        ],
      },
    }),
  );
  await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));
  await page.route("**/api/entries**", (route) =>
    route.fulfill({ status: 200, json: { today: "2026-09-21", entries: [] } }),
  );
}

function ticketRow(page: Page, issueKey: string) {
  return page.locator("that-ticket-row", { hasText: issueKey });
}

const railTimer = (page: Page) => page.locator("#rail-timer");

/** "M:SS" or "H:MM:SS" to whole seconds. */
function parseElapsed(text: string): number {
  const parts = text.trim().split(":").map(Number);

  return parts.length === 2 ? parts[0]! * 60 + parts[1]! : parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
}

test.beforeEach(async ({ page }) => {
  await stubToday(page);
});

const dialogButtonNames = (page: Page) =>
  page.getByRole("dialog").locator("that-button button").allInnerTexts();

/** How many rendered lines a button's text occupies. */
function lineCount(button: Locator): Promise<number> {
  return button.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);

    return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
  });
}

test("starting a timer on a row turns its control to stop, tints the Today figure, leaves the key muted, and the rail shows the running line", async ({
  page,
}) => {
  await stubTimer(page);
  await page.goto("/today");

  const row = ticketRow(page, "WORK-1");
  await row.getByRole("button", { name: "start timer" }).click();

  await expect(row.getByRole("button", { name: "stop timer" })).toBeVisible();
  await expect(row.locator("td.c-today .that-tnum")).toHaveClass(/text-running\b/);
  // The key stays ink-muted while its own timer runs. The visual language
  // reserves the running tone for the live timer and its stop control, and a
  // key is neither — see the row-key rule in the first edition, which this
  // asserts against the one row that would otherwise wear it.
  await expect(row.locator(".that-key")).not.toHaveClass(/text-running\b/);

  await expect(railTimer(page)).toContainText("WORK-1");
  await expect(railTimer(page)).not.toContainText("No timer running");
  await expect(railTimer(page).getByRole("button", { name: "stop timer" })).toBeVisible();
});

/** #143: the timer control carries the app's own that-tooltip, reading
 *  "start timer" or "stop timer" — the same pair its aria-label already
 *  gives, set together in that-timer's paint(). */
test("the timer control's tooltip reads start timer, then stop timer once it is running", async ({
  page,
}) => {
  await stubTimer(page);
  await page.goto("/today");

  const row = ticketRow(page, "WORK-1");
  const tooltip = row.locator("that-tooltip:visible");

  await row.getByRole("button", { name: "start timer" }).hover();
  await expect(tooltip).toHaveText("start timer");

  await row.getByRole("button", { name: "start timer" }).click();
  await expect(tooltip).toHaveText("stop timer");

  // Stopped from elsewhere entirely — the rail's own stop button, not the
  // row — proving paint() reacts to onTimerChanged regardless of what
  // stopped it, not only a click on this control itself.
  await railTimer(page).getByRole("button", { name: "stop timer" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Log 0:15" }).click();

  await row.getByRole("button", { name: "start timer" }).hover();
  await expect(tooltip).toHaveText("start timer");
});

test("a reload keeps the timer running and its elapsed time carries on", async ({ page }) => {
  await stubTimer(page);
  await page.goto("/today");
  await ticketRow(page, "WORK-1").getByRole("button", { name: "start timer" }).click();
  await expect(railTimer(page)).toContainText("WORK-1");

  await page.waitForTimeout(2100);
  const before = parseElapsed(await railTimer(page).locator(".that-tnum").innerText());

  await page.reload();

  await expect(railTimer(page)).toContainText("WORK-1");
  await expect
    .poll(async () => parseElapsed(await railTimer(page).locator(".that-tnum").innerText()))
    .toBeGreaterThanOrEqual(before);
});

test("starting another row's timer stops the first and runs the second", async ({ page }) => {
  await stubTimer(page);
  await page.goto("/today");

  const first = ticketRow(page, "WORK-1");
  const second = ticketRow(page, "WORK-2");

  await first.getByRole("button", { name: "start timer" }).click();
  await expect(first.getByRole("button", { name: "stop timer" })).toBeVisible();

  await second.getByRole("button", { name: "start timer" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Log 0:15" }).click();

  await expect(first.getByRole("button", { name: "start timer" })).toBeVisible();
  await expect(first.locator("td.c-today .that-tnum")).not.toHaveClass(/text-running\b/);
  await expect(second.getByRole("button", { name: "stop timer" })).toBeVisible();
  await expect(railTimer(page)).toContainText("WORK-2");
});

test("stopping from the rail on Week returns it to 'No timer running'", async ({ page }) => {
  await stubTimer(page);
  await page.goto("/today");
  await ticketRow(page, "WORK-1").getByRole("button", { name: "start timer" }).click();
  await expect(railTimer(page)).toContainText("WORK-1");

  await page.route("**/api/week**", (route) =>
    route.fulfill({
      status: 200,
      json: {
        start: "2026-09-21",
        end: "2026-09-27",
        prevStart: "2026-09-14",
        nextStart: "2026-09-28",
        weekNumber: 39,
        days: [],
        rows: [],
        seconds: 0,
      },
    }),
  );
  await page.getByRole("link", { name: "Week" }).click();
  await expect(page).toHaveURL(/\/week$/);

  await railTimer(page).getByRole("button", { name: "stop timer" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Log 0:15" }).click();

  await expect(railTimer(page)).toContainText("No timer running");
});

test("a stop rounds up in the dialog and the entry carries the seconds and the comment", async ({ page }) => {
  const recorder = await stubTimer(page);
  await page.goto("/today");

  const row = ticketRow(page, "WORK-1");
  await row.getByRole("button", { name: "start timer" }).click();
  await row.getByRole("button", { name: "stop timer" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading")).toHaveText("Stop the timer?");
  await dialog.getByRole("textbox", { name: "Description" }).fill("Traced the export");
  await dialog.getByRole("button", { name: "Log 0:15" }).click();

  await expect(dialog).toHaveCount(0);
  await expect.poll(() => recorder.logged).toEqual([
    expect.objectContaining({ issueKey: "WORK-1", seconds: 900, comment: "Traced the export" }),
  ]);
  expect(recorder.stops[0]).toEqual({ round: "up", comment: "Traced the export" });
});

test("a short run rounded down is discarded and logs nothing", async ({ page }) => {
  const recorder = await stubTimer(page);
  await page.goto("/today");

  const row = ticketRow(page, "WORK-1");
  await row.getByRole("button", { name: "start timer" }).click();
  await row.getByRole("button", { name: "stop timer" }).click();

  await page.getByRole("dialog").getByRole("button", { name: "Discard run" }).click();

  await expect(railTimer(page)).toContainText("No timer running");
  expect(recorder.logged).toEqual([]);
  expect(recorder.stops[0]?.["round"]).toBe("down");
});

test("under 15 minutes the buttons read Keep running, Discard run, Log 0:15, each on one line", async ({
  page,
}) => {
  await stubTimer(page, { runningFor: 7 * 60 });
  await page.goto("/today");
  await expect(railTimer(page)).toContainText("WORK-1");

  await railTimer(page).getByRole("button", { name: "stop timer" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("WORK-1 ran 0:07")).toBeVisible();
  expect(await dialogButtonNames(page)).toEqual(["Keep running", "Discard run", "Log 0:15"]);
  await expect(dialog.getByRole("button", { name: "Discard run" })).toHaveClass(/\bbg-failed\b/);
  await expect(dialog.getByRole("button", { name: "Log 0:15" })).toHaveClass(/\bbg-primary\b/);

  for (const name of ["Keep running", "Discard run", "Log 0:15"]) {
    expect(await lineCount(dialog.getByRole("button", { name })), name).toBe(1);
  }
  // The house field height; a column-flex label let flex-1 override it.
  expect((await dialog.getByRole("textbox", { name: "Description" }).boundingBox())?.height).toBe(38);
});

test("at 15 minutes or more the down button logs the floor, and Enter rounds up", async ({ page }) => {
  const recorder = await stubTimer(page, { runningFor: 20 * 60 });
  await page.goto("/today");
  await expect(railTimer(page)).toContainText("WORK-1");

  await railTimer(page).getByRole("button", { name: "stop timer" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Log 0:30" })).toBeVisible();
  expect(await dialogButtonNames(page)).toEqual(["Keep running", "Log 0:15", "Log 0:30"]);
  await expect(dialog.getByRole("button", { name: "Log 0:15" })).not.toHaveClass(/\bbg-failed\b/);

  await dialog.getByRole("textbox", { name: "Description" }).press("Enter");

  await expect.poll(() => recorder.logged[0]?.seconds).toBe(1800);
});

test("Keep running, or Esc, leaves the timer running", async ({ page }) => {
  const recorder = await stubTimer(page);
  await page.goto("/today");

  const row = ticketRow(page, "WORK-1");
  const dialog = page.getByRole("dialog");
  await row.getByRole("button", { name: "start timer" }).click();

  await row.getByRole("button", { name: "stop timer" }).click();
  await dialog.getByRole("button", { name: "Keep running" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row.getByRole("button", { name: "stop timer" })).toBeVisible();

  await row.getByRole("button", { name: "stop timer" }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(row.getByRole("button", { name: "stop timer" })).toBeVisible();

  expect(recorder.stops).toEqual([]);
});

test("switching names both tickets, and Keep running starts nothing", async ({ page }) => {
  const recorder = await stubTimer(page);
  await page.goto("/today");

  const first = ticketRow(page, "WORK-1");
  await first.getByRole("button", { name: "start timer" }).click();
  await expect(first.getByRole("button", { name: "stop timer" })).toBeVisible();

  await ticketRow(page, "WORK-2").getByRole("button", { name: "start timer" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading")).toHaveText("Stop WORK-1 and start WORK-2?");
  await dialog.getByRole("button", { name: "Keep running" }).click();

  await expect(dialog).toHaveCount(0);
  expect(recorder.starts.length).toBe(1);
  await expect(first.getByRole("button", { name: "stop timer" })).toBeVisible();
});

/**
 * Mirrors entries.spec.ts's "a failed first fetch retries until the rail
 * holds a real figure": readTimer()'s own boot read is the only thing that
 * ever tells the rail what is running, and unlike the entries total nothing
 * else re-reads it on a schedule — so a read that fails once must keep
 * retrying rather than leave the rail claiming nothing is running forever.
 * Overrides this file's own beforeEach GET stub, which never fails.
 */
test("a failed boot read of the timer retries until the rail shows what's actually running", async ({
  page,
}) => {
  await stubTimer(page);
  let failures = 0;
  const startedAt = new Date(Date.now() - 90_000).toISOString();

  await page.route("**/api/timer", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    if (failures < 2) {
      failures += 1;
      await route.abort();

      return;
    }
    await route.fulfill({
      status: 200,
      json: { running: { instanceId: 1, issueKey: "WORK-1", startedAt }, stopped: null },
    });
  });

  await page.goto("/today");

  await expect(railTimer(page)).toContainText("WORK-1", { timeout: 10_000 });
});

const instanceTable = (page: Page) => page.locator('that-table[sort-id="instance-1"]');

async function rowKeys(page: Page): Promise<string[]> {
  return instanceTable(page)
    .locator("tbody > that-ticket-row")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("key") ?? ""));
}

/** Two clicks on Key: ascending leaves WORK-1, WORK-2 alone; descending moves WORK-2 up. */
async function sortKeyDescending(page: Page): Promise<void> {
  const keyButton = instanceTable(page).locator("th.c-key button");
  await keyButton.click();
  await keyButton.click();
  await expect.poll(() => rowKeys(page)).toEqual(["WORK-2", "WORK-1"]);
}

async function expectTimerDrawn(page: Page, issueKey: string, running: boolean): Promise<void> {
  const button = ticketRow(page, issueKey).locator("that-timer button");
  await expect(button).toHaveAttribute("aria-label", running ? "stop timer" : "start timer");
  await expect(button.locator(running ? "svg rect" : "svg path")).toHaveCount(1);
}

/**
 * #192: a sort that moves a row must not leave its that-timer's button empty.
 * WORK-2 is the moved row and runs the timer, so its button must read stop.
 */
test("a row a sort moves keeps its start/stop button drawn", async ({ page }) => {
  await stubTimer(page);
  await page.goto("/today");
  await ticketRow(page, "WORK-2").getByRole("button", { name: "start timer" }).click();
  await expectTimerDrawn(page, "WORK-2", true);

  await sortKeyDescending(page);

  await expectTimerDrawn(page, "WORK-2", true);
  await expectTimerDrawn(page, "WORK-1", false);
});

/**
 * The insertBefore-style reconnect criterion 2 names, done directly rather
 * than through a sort: a real sort without moveBefore rebuilds the whole row
 * (that-ticket-row.render() creates a fresh that-timer), so it never reaches
 * the stale memo — table.spec.ts already covers that fallback path.
 * Removing and reinserting the same element is what fires that-timer's own
 * disconnectedCallback/connectedCallback on the one instance the bug needs.
 */
test("a that-timer disconnected and reconnected draws its button again", async ({ page }) => {
  await stubTimer(page);
  await page.goto("/today");
  await ticketRow(page, "WORK-2").getByRole("button", { name: "start timer" }).click();
  await expectTimerDrawn(page, "WORK-2", true);

  await ticketRow(page, "WORK-2")
    .locator("that-timer")
    .evaluate((el) => {
      const parent = el.parentNode;
      if (!parent) throw new Error("that-timer has no parent");
      const next = el.nextSibling;
      parent.removeChild(el);
      parent.insertBefore(el, next);
    });

  await expectTimerDrawn(page, "WORK-2", true);
});

/**
 * #192 with moveBefore: the moved row's own button survives the move, so its
 * focus does too. The header is clicked with dispatchEvent, as in
 * table.spec.ts's focus test — a real click would move focus to the header.
 */
test("a focused start/stop button keeps focus when a sort moves its row", async ({ page }) => {
  await stubTimer(page);
  await page.goto("/today");
  const button = ticketRow(page, "WORK-2").getByRole("button", { name: "start timer" });
  await button.focus();
  await expect(button).toBeFocused();

  const keyButton = instanceTable(page).locator("th.c-key button");
  await keyButton.dispatchEvent("click");
  await keyButton.dispatchEvent("click");
  await expect.poll(() => rowKeys(page)).toEqual(["WORK-2", "WORK-1"]);

  await expect(button).toBeFocused();
  await expectTimerDrawn(page, "WORK-2", false);
});

/**
 * #204 task 2: the rail's total and split count a running timer's elapsed
 * time on Today. A rig of its own rather than stubTimer/stubToday above —
 * those hardcode instanceId 1/"Work" on the running timer with no
 * instanceName/instancePosition, and these tests need both to vary.
 */
interface TotalsEntry {
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

interface TotalsRunning {
  instanceId: number;
  instanceName: string;
  instancePosition: number;
  issueKey: string;
  startedAt: string;
}

interface TotalsIssue {
  key: string;
  summary: string;
  status: string;
  url: string;
}

async function stubTotalsRig(
  page: Page,
  entries: TotalsEntry[],
  running: TotalsRunning | null,
  // Task 3: defaults keep every existing caller's instance-less rig, while
  // the instance-tally tests below pass real issues (and pins) to get a card
  // to read a tally off.
  instances: { id: number; name: string; issues: TotalsIssue[] }[] = [
    { id: 1, name: "Work", issues: [] },
  ],
  pins: unknown[] = [],
): Promise<void> {
  await page.route("**/api/issues", (route) =>
    route.fulfill({
      status: 200,
      json: { instances: instances.map((instance) => ({ ...instance, error: null })) },
    }),
  );
  await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: pins }));
  await page.route("**/api/entries**", (route) =>
    route.fulfill({ status: 200, json: { today: entries[0]?.day ?? "2026-09-21", entries } }),
  );
  await page.route("**/api/timer", (route) => {
    if (route.request().method() !== "GET") return route.fallback();

    return route.fulfill({ status: 200, json: { running, stopped: null } });
  });
}

const DAY = "2026-09-21";

test("the rail total and the running instance's split figure add the timer's elapsed time and tick with it", async ({
  page,
}) => {
  const t0 = Date.parse(`${DAY}T10:00:00Z`);
  await page.clock.install({ time: t0 });
  await stubTotalsRig(
    page,
    [
      {
        id: 1, instanceId: 1, instanceName: "Work", instancePosition: 0, issueKey: "WORK-1",
        day: DAY, startedAt: `${DAY}T08:00:00Z`, seconds: 3600, comment: "", pushState: "unpushed",
      },
    ],
    {
      instanceId: 1, instanceName: "Work", instancePosition: 0, issueKey: "WORK-1",
      startedAt: new Date(t0 - (59 * 60 + 50) * 1000).toISOString(),
    },
  );

  await page.goto("/today");

  await expect(page.locator("#rail-total")).toHaveText("1h 59m");
  await expect(page.locator("#rail-split")).toContainText("1h 59m");

  await page.clock.runFor(10_000);

  await expect(page.locator("#rail-total")).toHaveText("2h 00m");
  await expect(page.locator("#rail-split")).toContainText("2h 00m");
});

/**
 * Settings is a dialog over Today, so the rail keeps describing today beneath
 * it — running time included.
 */
test("the rail total includes the running timer's elapsed time while Settings is open", async ({ page }) => {
  const t0 = Date.parse(`${DAY}T10:00:00Z`);
  await page.clock.install({ time: t0 });
  await page.route("**/api/instances", (route) => route.fulfill({ status: 200, json: [] }));
  await stubTotalsRig(
    page,
    [
      {
        id: 1, instanceId: 1, instanceName: "Work", instancePosition: 0, issueKey: "WORK-1",
        day: DAY, startedAt: `${DAY}T08:00:00Z`, seconds: 3600, comment: "", pushState: "unpushed",
      },
    ],
    {
      instanceId: 1, instanceName: "Work", instancePosition: 0, issueKey: "WORK-1",
      startedAt: new Date(t0 - (59 * 60 + 50) * 1000).toISOString(),
    },
  );

  await page.goto("/today");
  await expect(page.locator("#rail-total")).toHaveText("1h 59m");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await expect(page.locator("#rail-total")).toHaveText("1h 59m");

  await page.clock.runFor(10_000);
  await expect(page.locator("#rail-total")).toHaveText("2h 00m");
});

test("the split's figures node keeps its identity across ticks within the same minute", async ({
  page,
}) => {
  const t0 = Date.parse(`${DAY}T10:00:00Z`);
  await page.clock.install({ time: t0 });
  await stubTotalsRig(page, [], {
    instanceId: 1, instanceName: "Work", instancePosition: 0, issueKey: "WORK-1",
    startedAt: new Date(t0).toISOString(),
  });

  await page.goto("/today");
  await expect(page.locator("#rail-split")).toContainText("Work");

  const figuresEl = page.locator("#rail-split > div").nth(1);
  await figuresEl.evaluate((el) => el.setAttribute("data-marker", "kept"));

  await page.clock.runFor(5_000);

  await expect(figuresEl).toHaveAttribute("data-marker", "kept");
});

// #143 gave a cut split name its own that-tooltip; #204 made the split redraw
// on a minute tick. Removing an open popover closes it, so a full rebuild of
// the split on every minute tick closed a name's tooltip mid-hover — this is
// the regression test for the in-place update that fixes it.
const longSplitName =
  "Ridgeline Analytics and Reporting Platform for the Quarterly Capacity and Utilisation Programme";

test("the split's name node — and its open tooltip — survive a minute tick that changes the figure", async ({
  page,
}) => {
  const t0 = Date.parse(`${DAY}T10:00:00Z`);
  await page.clock.install({ time: t0 });
  await stubTotalsRig(page, [], {
    instanceId: 1,
    instanceName: longSplitName,
    instancePosition: 0,
    issueKey: "WORK-1",
    startedAt: new Date(t0 - 50_000).toISOString(),
  });

  await page.goto("/today");

  // .first(): the name's own that-tooltip carries the same text too, hidden.
  const nameEl = page.locator("#rail-split").getByText(longSplitName, { exact: true }).first();
  await expect(nameEl).toBeVisible();
  await nameEl.evaluate((el) => el.setAttribute("data-marker", "kept"));
  await nameEl.hover();
  await expect(page.locator("that-tooltip", { hasText: longSplitName })).toBeVisible();

  await expect(page.locator("#rail-split")).toContainText("0h 00m");
  await page.clock.runFor(15_000);
  await expect(page.locator("#rail-split")).toContainText("0h 01m");

  await expect(nameEl).toHaveAttribute("data-marker", "kept");
  await expect(nameEl).toBeAttached();
  await expect(page.locator("that-tooltip", { hasText: longSplitName })).toBeVisible();
});

test("a running timer on an instance with no entries today still gets a named split slice", async ({
  page,
}) => {
  await stubTotalsRig(page, [], {
    instanceId: 2, instanceName: "Personal", instancePosition: 1, issueKey: "PERS-1",
    startedAt: `${DAY}T09:59:00Z`,
  });

  await page.goto("/today");

  await expect(page.locator("#rail-split")).toContainText("Personal");
});

test("switching to Week drops the timer's elapsed time from the rail total, and back to Today restores it", async ({
  page,
}) => {
  const t0 = Date.parse(`${DAY}T10:00:00Z`);
  await page.clock.install({ time: t0 });
  await stubTotalsRig(
    page,
    [
      {
        id: 1, instanceId: 1, instanceName: "Work", instancePosition: 0, issueKey: "WORK-1",
        day: DAY, startedAt: `${DAY}T08:00:00Z`, seconds: 3600, comment: "", pushState: "unpushed",
      },
    ],
    {
      instanceId: 1, instanceName: "Work", instancePosition: 0, issueKey: "WORK-1",
      startedAt: new Date(t0 - 1_800_000).toISOString(),
    },
  );
  const weekDays = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"];
  await page.route("**/api/week**", (route) =>
    route.fulfill({
      status: 200,
      json: {
        start: DAY, end: "2026-09-27", prevStart: "2026-09-14", nextStart: "2026-09-28",
        weekNumber: 39,
        days: weekDays.map((day, index) => ({
          day, seconds: index === 0 ? 3600 : 0, pushState: index === 0 ? "unpushed" : null,
        })),
        rows: [
          {
            instanceId: 1, instanceName: "Work", instancePosition: 0, issueKey: "WORK-1", url: "",
            cells: weekDays.map((_, index) => ({
              seconds: index === 0 ? 3600 : 0, pushState: index === 0 ? "unpushed" : null,
            })),
            seconds: 3600,
          },
        ],
        seconds: 3600,
      },
    }),
  );

  await page.goto("/today");
  await expect(page.locator("#rail-total")).toHaveText("1h 30m");

  await page.getByRole("link", { name: "Week" }).click();
  await expect(page).toHaveURL(/\/week$/);
  await expect(page.locator("#rail-total")).toHaveText("1h 00m");
  await expect(page.locator("tfoot td").last()).toHaveText("1h 00m");

  await page.getByRole("link", { name: "Today" }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.locator("#rail-total")).toHaveText("1h 30m");
});

/**
 * Review finding on #204 task 2: setRailPeriod flips `currentPeriod`
 * synchronously (inside the destination view's own mount), but `lastEntries`
 * only catches up once that period's own listEntries() read lands — an async
 * gap a real 1-second tick can land inside. paintFigures() must sit out that
 * gap entirely rather than combine the old period's entries with the new
 * period's TODAY_PERIOD-ness (or lack of it); this holds each direction's
 * read open long enough for `clock.runFor` to prove a tick changes nothing
 * until the read for the period actually on screen lands.
 */
test("a tick during a period switch paints neither period's entries under the other's label", async ({
  page,
}) => {
  const t0 = Date.parse(`${DAY}T10:00:00Z`);
  await page.clock.install({ time: t0 });

  await page.route("**/api/issues", (route) =>
    route.fulfill({
      status: 200,
      json: { instances: [{ id: 1, name: "Work", issues: [], error: null }] },
    }),
  );
  await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));
  await page.route("**/api/timer", (route) => {
    if (route.request().method() !== "GET") return route.fallback();

    return route.fulfill({
      status: 200,
      json: {
        running: {
          instanceId: 1, instanceName: "Work", instancePosition: 0, issueKey: "WORK-1",
          startedAt: new Date(t0 - 1_800_000).toISOString(),
        },
        stopped: null,
      },
    });
  });

  // Both flags start false: the boot reads (Today's own and the rail's own)
  // must resolve at once. Each holds a queue rather than one resolver — Today's
  // mount fires two bare listEntries() calls of its own (its row totals and
  // the rail's), and losing one to an overwritten resolver would hang it.
  let holdToday = false;
  let holdWeek = false;
  const todayReleases: (() => void)[] = [];
  const weekReleases: (() => void)[] = [];

  await page.route("**/api/entries**", async (route) => {
    const ranged = new URL(route.request().url()).searchParams.has("from");
    if (ranged && holdWeek) {
      await new Promise<void>((resolve) => weekReleases.push(resolve));
    } else if (!ranged && holdToday) {
      await new Promise<void>((resolve) => todayReleases.push(resolve));
    }

    return route.fulfill({
      status: 200,
      json: {
        today: DAY,
        entries: [
          {
            id: 1, instanceId: 1, instanceName: "Work", instancePosition: 0, issueKey: "WORK-1",
            day: DAY, startedAt: `${DAY}T08:00:00Z`,
            seconds: ranged ? 7200 : 3600, comment: "", pushState: "unpushed",
          },
        ],
      },
    });
  });

  const weekDays = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"];
  await page.route("**/api/week**", (route) =>
    route.fulfill({
      status: 200,
      json: {
        start: DAY, end: "2026-09-27", prevStart: "2026-09-14", nextStart: "2026-09-28",
        weekNumber: 39,
        days: weekDays.map((day, index) => ({
          day, seconds: index === 0 ? 7200 : 0, pushState: index === 0 ? "unpushed" : null,
        })),
        rows: [
          {
            instanceId: 1, instanceName: "Work", instancePosition: 0, issueKey: "WORK-1", url: "",
            cells: weekDays.map((_, index) => ({
              seconds: index === 0 ? 7200 : 0, pushState: index === 0 ? "unpushed" : null,
            })),
            seconds: 7200,
          },
        ],
        seconds: 7200,
      },
    }),
  );

  await page.goto("/today");
  await expect(page.locator("#rail-total")).toHaveText("1h 30m");

  // Today -> Week: hold the rail's own ranged re-read. A tick landing before
  // it does must leave the Today figure exactly alone, not drop its elapsed
  // time because the period is now Week's.
  holdWeek = true;
  await page.getByRole("link", { name: "Week" }).click();
  await expect(page).toHaveURL(/\/week$/);

  await page.clock.runFor(65_000);
  await expect(page.locator("#rail-total")).toHaveText("1h 30m");

  holdWeek = false;
  weekReleases.splice(0).forEach((release) => release());
  await expect(page.locator("#rail-total")).toHaveText("2h 00m");
  await expect(page.locator("tfoot td").last()).toHaveText("2h 00m");

  // Week -> Today: hold the bare re-read. A tick landing before it does must
  // leave Week's figure exactly alone, not add the timer's elapsed time to
  // Week's stale entries because the period is now Today's.
  holdToday = true;
  await page.getByRole("link", { name: "Today" }).click();
  await expect(page).toHaveURL(/\/today$/);

  await page.clock.runFor(65_000);
  await expect(page.locator("#rail-total")).toHaveText("2h 00m");

  holdToday = false;
  todayReleases.splice(0).forEach((release) => release());
  await expect(page.locator("#rail-total")).toHaveText("1h 32m");
});

test("the unpushed count and the push confirmation's total do not move while the timer runs", async ({
  page,
}) => {
  const t0 = Date.parse(`${DAY}T10:00:00Z`);
  await page.clock.install({ time: t0 });
  await stubTotalsRig(
    page,
    [
      {
        id: 1, instanceId: 1, instanceName: "Work", instancePosition: 0, issueKey: "WORK-1",
        day: DAY, startedAt: `${DAY}T08:00:00Z`, seconds: 3600, comment: "", pushState: "unpushed",
      },
    ],
    {
      instanceId: 1, instanceName: "Work", instancePosition: 0, issueKey: "WORK-1",
      startedAt: new Date(t0).toISOString(),
    },
  );

  await page.goto("/today");
  await expect(page.locator("#rail-unpushed")).toHaveText("1 entry to push");

  await page.clock.runFor(65_000);
  await expect(page.locator("#rail-unpushed")).toHaveText("1 entry to push");

  await page.getByRole("button", { name: "Push worklogs" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("1 entry totalling 1h 00m will be sent to 1 site.");
});

/**
 * #204 task 3: the instance card's own tally ("N issues · H:MM") counts the
 * running timer's elapsed time too, the same figure paintFigures already adds
 * to the rail's total and split (task 2).
 */
test("the running instance's card tally adds the timer's elapsed time and ticks with it", async ({
  page,
}) => {
  const t0 = Date.parse(`${DAY}T10:00:00Z`);
  await page.clock.install({ time: t0 });
  await stubTotalsRig(
    page,
    [
      {
        id: 1, instanceId: 1, instanceName: "Work", instancePosition: 0, issueKey: "WORK-1",
        day: DAY, startedAt: `${DAY}T08:00:00Z`, seconds: 3600, comment: "", pushState: "unpushed",
      },
    ],
    {
      instanceId: 1, instanceName: "Work", instancePosition: 0, issueKey: "WORK-1",
      startedAt: new Date(t0 - (59 * 60 + 50) * 1000).toISOString(),
    },
    [{ id: 1, name: "Work", issues: [{ key: "WORK-1", summary: "Fix it", status: "To Do", url: "" }] }],
  );

  await page.goto("/today");

  const tally = page.locator("[data-instance-tally]").first();
  await expect(tally).toHaveText("1 issue · 1h 59m");

  await page.clock.runFor(10_000);

  await expect(tally).toHaveText("1 issue · 2h 00m");
});

/**
 * Review Focus item 3: a running ticket that is pinned moves its row into
 * Pinned, out of its instance's own card — but the tally beside that card's
 * name still counts the whole instance's day, elapsed time included, the same
 * way it already counts a pinned issue's logged time (see today.spec.ts's
 * "an instance's tally counts a pinned issue's time too", #117).
 */
test("the instance tally counts the running time even while its row is pinned", async ({ page }) => {
  const t0 = Date.parse(`${DAY}T10:00:00Z`);
  await page.clock.install({ time: t0 });
  await stubTotalsRig(
    page,
    [
      {
        id: 1, instanceId: 1, instanceName: "Work", instancePosition: 0, issueKey: "WORK-1",
        day: DAY, startedAt: `${DAY}T08:00:00Z`, seconds: 3600, comment: "", pushState: "unpushed",
      },
    ],
    {
      instanceId: 1, instanceName: "Work", instancePosition: 0, issueKey: "WORK-1",
      startedAt: new Date(t0 - (59 * 60 + 50) * 1000).toISOString(),
    },
    [
      {
        id: 1,
        name: "Work",
        issues: [
          { key: "WORK-1", summary: "Fix it", status: "To Do", url: "" },
          { key: "WORK-2", summary: "Also fix it", status: "To Do", url: "" },
        ],
      },
    ],
    [
      {
        id: 1, instanceId: 1, instanceName: "Work", instancePosition: 0,
        key: "WORK-1", summary: "Fix it", status: "To Do", url: "", error: null,
      },
    ],
  );

  await page.goto("/today");

  const workRegion = page.getByRole("region", { name: "Work", exact: true });
  const pinnedRegion = page.getByRole("region", { name: "Pinned", exact: true });
  await expect(pinnedRegion.locator("that-ticket-row", { hasText: "WORK-1" })).toBeVisible();
  await expect(workRegion.locator("that-ticket-row", { hasText: "WORK-1" })).toHaveCount(0);
  await expect(workRegion.locator("that-ticket-row", { hasText: "WORK-2" })).toBeVisible();

  // "1 issue" — WORK-2 is the only row this card still shows — carrying both
  // WORK-1's logged hour and its running time.
  const tally = page.locator("[data-instance-tally]").first();
  await expect(tally).toHaveText("1 issue · 1h 59m");

  await page.clock.runFor(10_000);

  await expect(tally).toHaveText("1 issue · 2h 00m");
});

/**
 * Global constraint 4: a stop drops the elapsed time from the tally the
 * instant the timer clears (the accepted one-request dip), then the tally
 * settles on logged time plus the rounded entry once the entries re-read —
 * fired by announceEntriesChanged() inside stopTimer() — lands.
 */
test("a stop settles the instance tally on logged time plus the rounded entry", async ({ page }) => {
  const t0 = Date.parse(`${DAY}T10:00:00Z`);
  await page.clock.install({ time: t0 });

  const entries: TotalsEntry[] = [
    {
      id: 1, instanceId: 1, instanceName: "Work", instancePosition: 0, issueKey: "WORK-1",
      day: DAY, startedAt: `${DAY}T08:00:00Z`, seconds: 3600, comment: "", pushState: "unpushed",
    },
  ];
  let running: TotalsRunning | null = {
    instanceId: 1, instanceName: "Work", instancePosition: 0, issueKey: "WORK-1",
    startedAt: new Date(t0 - 5 * 60 * 1000).toISOString(),
  };

  await stubTotalsRig(page, entries, running, [
    { id: 1, name: "Work", issues: [{ key: "WORK-1", summary: "Fix it", status: "To Do", url: "" }] },
  ]);
  // Overrides stubTotalsRig's own timer route (last registered wins) so GET
  // reflects `running` after the stop below flips it, and adds the stop
  // endpoint the rig has no opinion on.
  await page.route("**/api/timer", (route) => {
    if (route.request().method() !== "GET") return route.fallback();

    return route.fulfill({ status: 200, json: { running, stopped: null } });
  });
  await page.route("**/api/timer/stop", async (route) => {
    const rounded: TotalsEntry = {
      id: 2, instanceId: 1, instanceName: "Work", instancePosition: 0, issueKey: "WORK-1",
      day: DAY, startedAt: new Date(t0 - 5 * 60 * 1000).toISOString(),
      seconds: 900, comment: "", pushState: "unpushed",
    };
    entries.push(rounded);
    running = null;
    await route.fulfill({ status: 200, json: { stopped: rounded, discarded: false } });
  });

  await page.goto("/today");

  const tally = page.locator("[data-instance-tally]").first();
  await expect(tally).toHaveText("1 issue · 1h 05m");
  // The criterion covers the rail too: it reads the same settled value.
  await expect(page.locator("#rail-total")).toHaveText("1h 05m");
  await expect(page.locator("#rail-split")).toContainText("1h 05m");

  await ticketRow(page, "WORK-1").getByRole("button", { name: "stop timer" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Log 0:15" }).click();

  await expect(tally).toHaveText("1 issue · 1h 15m");
  await expect(page.locator("#rail-total")).toHaveText("1h 15m");
  await expect(page.locator("#rail-split")).toContainText("1h 15m");
});

/**
 * #208: a stop or switch that fails after the dialog is confirmed leaves the
 * dialog open, the description typed and the timer running, with one error
 * block above the dialog (the toasts design, decisions 7 and 8).
 */
const stopBlocks = (page: Page) => page.locator("that-stop-dialog that-dialog-blocks that-toast");

/** Registered after stubTimer, so it answers first for `times` requests and
 *  then falls through to the stub. */
async function failTimerPost(page: Page, path: "stop" | "start", times = 1): Promise<void> {
  await page.route(
    `**/api/timer/${path}`,
    (route) => route.fulfill({ status: 500, json: { code: "internal_error", message: "Jira said no." } }),
    { times },
  );
}

test("a failed stop keeps the dialog open with its description, the timer running and one error block above it", async ({
  page,
}) => {
  const recorder = await stubTimer(page, { runningFor: 60 });
  await failTimerPost(page, "stop");
  await page.goto("/today");

  const row = ticketRow(page, "WORK-1");
  const dialog = page.getByRole("dialog");
  await row.getByRole("button", { name: "stop timer" }).click();
  await dialog.getByRole("textbox", { name: "Description" }).fill("Traced the export");
  const before = await dialog.boundingBox();
  await dialog.getByRole("button", { name: "Log 0:15" }).click();

  await expect(stopBlocks(page)).toHaveCount(1);
  await expect(stopBlocks(page)).toContainText("Jira said no.");
  await expect(stopBlocks(page).getByRole("img", { name: "Failed" })).toBeVisible();
  await expect(stopBlocks(page).getByRole("button", { name: "Dismiss" })).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("WORK-1 ran")).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Description" })).toHaveValue("Traced the export");
  await expect(row.getByRole("button", { name: "stop timer" })).toBeVisible();
  await expect(railTimer(page)).toContainText("WORK-1");
  expect(recorder.logged).toEqual([]);

  // The entry dialog's block geometry: 8px above, the dialog's width and left edge, the dialog unchanged.
  const block = await stopBlocks(page).boundingBox();
  const after = await dialog.boundingBox();
  if (!before || !block || !after) throw new Error("no box");
  expect(Math.abs(block.y + block.height + 8 - after.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(block.width - after.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(block.x - after.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
});

test("a retry clears the block when it starts, and a successful one writes the description and closes", async ({
  page,
}) => {
  const recorder = await stubTimer(page, { runningFor: 60 });
  await failTimerPost(page, "stop");
  await page.goto("/today");

  // From the rail: it routes through the same stopTimer as a row.
  const dialog = page.getByRole("dialog");
  await railTimer(page).getByRole("button", { name: "stop timer" }).click();
  await dialog.getByRole("textbox", { name: "Description" }).fill("Traced the export");
  await dialog.getByRole("button", { name: "Log 0:15" }).click();
  await expect(stopBlocks(page)).toHaveCount(1);

  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/api/timer/stop",
    async (route) => {
      await held;
      await route.fallback();
    },
    { times: 1 },
  );
  await dialog.getByRole("button", { name: "Log 0:15" }).click();
  await expect(stopBlocks(page)).toHaveCount(0);
  release();

  await expect(dialog).toHaveCount(0);
  await expect(page.locator("that-dialog-blocks")).toHaveCount(0);
  await expect(railTimer(page)).toContainText("No timer running");
  await expect.poll(() => recorder.logged).toEqual([
    expect.objectContaining({ issueKey: "WORK-1", seconds: 900, comment: "Traced the export" }),
  ]);
});

test("a retry that fails again shows exactly one fresh block, from a click or from Enter", async ({ page }) => {
  await stubTimer(page, { runningFor: 60 });
  await failTimerPost(page, "stop", 3);
  await page.goto("/today");

  const dialog = page.getByRole("dialog");
  await ticketRow(page, "WORK-1").getByRole("button", { name: "stop timer" }).click();
  await dialog.getByRole("button", { name: "Log 0:15" }).click();
  await expect(stopBlocks(page)).toHaveCount(1);
  await stopBlocks(page).getByRole("button", { name: "Dismiss" }).click();
  await expect(stopBlocks(page)).toHaveCount(0);

  await dialog.getByRole("button", { name: "Log 0:15" }).click();
  await expect(stopBlocks(page)).toHaveCount(1);
  await stopBlocks(page).getByRole("button", { name: "Dismiss" }).click();
  await expect(stopBlocks(page)).toHaveCount(0);
  await dialog.getByRole("textbox", { name: "Description" }).press("Enter");
  await expect(stopBlocks(page)).toHaveCount(1);
  await expect(stopBlocks(page)).toContainText("Jira said no.");
  await expect(dialog).toBeVisible();
});

test("a failed switch keeps the dialog open with a block, and the first timer still running", async ({ page }) => {
  const recorder = await stubTimer(page);
  await page.goto("/today");

  const first = ticketRow(page, "WORK-1");
  const second = ticketRow(page, "WORK-2");
  await first.getByRole("button", { name: "start timer" }).click();
  await expect(first.getByRole("button", { name: "stop timer" })).toBeVisible();

  await failTimerPost(page, "start");
  await second.getByRole("button", { name: "start timer" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Description" }).fill("Half the export");
  await dialog.getByRole("button", { name: "Log 0:15" }).click();

  await expect(stopBlocks(page)).toHaveCount(1);
  await expect(stopBlocks(page)).toContainText("Jira said no.");
  await expect(dialog.getByRole("heading")).toHaveText("Stop WORK-1 and start WORK-2?");
  await expect(dialog.getByRole("textbox", { name: "Description" })).toHaveValue("Half the export");
  await expect(first.getByRole("button", { name: "stop timer" })).toBeVisible();
  await expect(second.getByRole("button", { name: "start timer" })).toBeVisible();
  await expect(railTimer(page)).toContainText("WORK-1");

  await dialog.getByRole("button", { name: "Log 0:15" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(railTimer(page)).toContainText("WORK-2");
  await expect.poll(() => recorder.logged).toEqual([
    expect.objectContaining({ issueKey: "WORK-1", comment: "Half the export" }),
  ]);
});

test("after a failure, Keep running and Esc still cancel, and the block leaves with the dialog", async ({ page }) => {
  await stubTimer(page, { runningFor: 60 });
  await failTimerPost(page, "stop", 2);
  await page.goto("/today");

  const row = ticketRow(page, "WORK-1");
  const dialog = page.getByRole("dialog");

  await row.getByRole("button", { name: "stop timer" }).click();
  await dialog.getByRole("button", { name: "Log 0:15" }).click();
  await expect(stopBlocks(page)).toHaveCount(1);
  await dialog.getByRole("button", { name: "Keep running" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("that-dialog-blocks")).toHaveCount(0);
  await expect(page.locator("that-toast")).toHaveCount(0);

  await row.getByRole("button", { name: "stop timer" }).click();
  await dialog.getByRole("button", { name: "Log 0:15" }).click();
  await expect(stopBlocks(page)).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("that-dialog-blocks")).toHaveCount(0);
  await expect(page.locator("that-toast")).toHaveCount(0);
  await expect(row.getByRole("button", { name: "stop timer" })).toBeVisible();
});

test("while a stop is in flight the buttons are disabled, Esc and Enter do nothing, and a failure enables them again", async ({
  page,
}) => {
  await stubTimer(page, { runningFor: 60 });
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let sent = 0;
  await page.route("**/api/timer/stop", async (route) => {
    sent++;
    await held;
    await route.fulfill({ status: 500, json: { code: "internal_error", message: "Jira said no." } });
  });
  await page.goto("/today");

  const dialog = page.getByRole("dialog");
  const names = ["Keep running", "Discard run", "Log 0:15"];
  await ticketRow(page, "WORK-1").getByRole("button", { name: "stop timer" }).click();
  await dialog.getByRole("button", { name: "Log 0:15" }).click();
  await expect.poll(() => sent).toBe(1);

  for (const name of names) await expect(dialog.getByRole("button", { name })).toBeDisabled();
  // Chromium lets only the first Esc's cancel be prevented; the second needs the keydown guard.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Description" }).press("Enter");
  // A repaint tick passes: paint() must not re-enable anything.
  await page.waitForTimeout(1100);
  await expect(dialog).toBeVisible();
  for (const name of names) await expect(dialog.getByRole("button", { name })).toBeDisabled();
  expect(sent).toBe(1);

  release();
  await expect(stopBlocks(page)).toHaveCount(1);
  for (const name of names) await expect(dialog.getByRole("button", { name })).toBeEnabled();
  await expect(dialog).toBeVisible();
});

test("after a failed stop the keyboard focus returns to the button that was pressed", async ({ page }) => {
  await stubTimer(page, { runningFor: 60 });
  await failTimerPost(page, "stop");
  await page.goto("/today");

  const dialog = page.getByRole("dialog");
  await ticketRow(page, "WORK-1").getByRole("button", { name: "stop timer" }).click();
  const log = dialog.getByRole("button", { name: "Log 0:15" });
  await log.focus();
  await page.keyboard.press("Enter");

  await expect(stopBlocks(page)).toHaveCount(1);
  await expect(log).toBeEnabled();
  await expect(log).toBeFocused();
});

/**
 * #207: a start that fails reports in an error toast, the way a failed pin
 * does (the toasts design, decisions 2, 4 and 10) — except a switch whose
 * start fails inside the dialog, which #208's block already reports.
 */
const errorToasts = (page: Page) => page.locator("that-toasts that-toast[tone='error']");

test("a start the server refuses with nothing running shows one error toast and leaves the button on start", async ({
  page,
}) => {
  await stubTimer(page);
  await failTimerPost(page, "start");
  await page.goto("/today");

  const start = ticketRow(page, "WORK-2").getByRole("button", { name: "start timer" });
  await start.click();

  await expect(errorToasts(page)).toHaveCount(1);
  await expect(errorToasts(page)).toContainText("Jira said no.");
  await expect(page.locator("that-toast")).toHaveCount(1);
  await expect(start).toBeVisible();
  await expect(railTimer(page)).toContainText("No timer running");
});

test("a switch that fails in the dialog shows the block and no toast, after Keep running or Esc too", async ({
  page,
}) => {
  await stubTimer(page);
  await page.goto("/today");

  const first = ticketRow(page, "WORK-1");
  const second = ticketRow(page, "WORK-2");
  await first.getByRole("button", { name: "start timer" }).click();
  await expect(first.getByRole("button", { name: "stop timer" })).toBeVisible();

  await failTimerPost(page, "start", 2);
  const dialog = page.getByRole("dialog");
  const heading = dialog.getByRole("heading");

  await second.getByRole("button", { name: "start timer" }).click();
  await dialog.getByRole("button", { name: "Log 0:15" }).click();
  await expect(stopBlocks(page)).toHaveCount(1);
  await dialog.getByRole("button", { name: "Keep running" }).click();
  await expect(dialog).toHaveCount(0);

  // Reopening proves the click's promise has settled, so a toast it would
  // raise is already in the host before the count below.
  await second.getByRole("button", { name: "start timer" }).click();
  await expect(heading).toHaveText("Stop WORK-1 and start WORK-2?");
  await expect(page.locator("that-toast")).toHaveCount(0);

  await dialog.getByRole("button", { name: "Log 0:15" }).click();
  await expect(stopBlocks(page)).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await second.getByRole("button", { name: "start timer" }).click();
  await expect(heading).toHaveText("Stop WORK-1 and start WORK-2?");
  await expect(page.locator("that-toast")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Keep running" }).click();
  await expect(first.getByRole("button", { name: "stop timer" })).toBeVisible();
});

/** This tab's boot read says nothing runs, while the stub's timer does. */
async function staleBootRead(page: Page): Promise<void> {
  await page.route(
    "**/api/timer",
    (route) => route.fulfill({ status: 200, json: { running: null, stopped: null } }),
    { times: 1 },
  );
}

test("in a tab that never saw the running timer, the first click on start asks to switch, and confirming switches", async ({
  page,
}) => {
  const recorder = await stubTimer(page, { runningFor: 60 });
  await staleBootRead(page);
  await page.goto("/today");
  await expect(railTimer(page)).toContainText("No timer running");

  await ticketRow(page, "WORK-2").getByRole("button", { name: "start timer" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading")).toHaveText("Stop WORK-1 and start WORK-2?");
  await dialog.getByRole("button", { name: "Log 0:15" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(ticketRow(page, "WORK-2").getByRole("button", { name: "stop timer" })).toBeVisible();
  await expect(railTimer(page)).toContainText("WORK-2");
  expect(recorder.starts).toEqual([
    expect.not.objectContaining({ round: expect.anything() }),
    expect.objectContaining({ issueKey: "WORK-2", round: "up" }),
  ]);
  await expect(page.locator("that-toast")).toHaveCount(0);
});

test("in a stale tab, a start for the ticket already running elsewhere shows stop and asks nothing", async ({
  page,
}) => {
  const recorder = await stubTimer(page, { runningFor: 60 });
  await staleBootRead(page);
  await page.goto("/today");
  await expect(railTimer(page)).toContainText("No timer running");

  const row = ticketRow(page, "WORK-1");
  await row.getByRole("button", { name: "start timer" }).click();
  await expect(row.getByRole("button", { name: "stop timer" })).toBeVisible();

  // The next click is a plain stop: no switch dialog was left open, and the
  // first click's work is finished.
  await row.getByRole("button", { name: "stop timer" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading")).toHaveText("Stop the timer?");
  await dialog.getByRole("button", { name: "Keep running" }).click();

  expect(recorder.starts.length).toBe(1);
  await expect(page.locator("that-toast")).toHaveCount(0);
});

test("a refused start whose re-read finds nothing running reports once and sends no second start", async ({
  page,
}) => {
  await stubTimer(page);
  let starts = 0;
  await page.route("**/api/timer/start", (route) => {
    starts += 1;
    return route.fulfill({
      status: 400,
      json: { code: "invalid_request", message: "a timer is running: round is required to stop it" },
    });
  });
  await page.goto("/today");

  const start = ticketRow(page, "WORK-2").getByRole("button", { name: "start timer" });
  await start.click();

  await expect(page.locator("that-toasts that-toast[tone='error']")).toHaveCount(1);
  expect(starts).toBe(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(start).toBeVisible();
});

test("a stale tab's start that fails for another reason reports in a toast and does not ask", async ({ page }) => {
  await stubTimer(page, { runningFor: 60 });
  await staleBootRead(page);
  await failTimerPost(page, "start");
  await page.goto("/today");
  await expect(railTimer(page)).toContainText("No timer running");

  await ticketRow(page, "WORK-2").getByRole("button", { name: "start timer" }).click();

  await expect(page.locator("that-toasts that-toast[tone='error']")).toContainText("Jira said no.");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("in a stale tab, a switch whose retry fails shows the block, sends two starts and no third", async ({
  page,
}) => {
  const recorder = await stubTimer(page, { runningFor: 60 });
  await staleBootRead(page);
  await page.goto("/today");
  await expect(railTimer(page)).toContainText("No timer running");

  await ticketRow(page, "WORK-2").getByRole("button", { name: "start timer" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading")).toHaveText("Stop WORK-1 and start WORK-2?");

  let retries = 0;
  await page.route("**/api/timer/start", (route) => {
    retries += 1;
    return route.fulfill({ status: 500, json: { code: "internal_error", message: "Jira said no." } });
  });
  await dialog.getByRole("button", { name: "Log 0:15" }).click();
  await expect(stopBlocks(page)).toHaveCount(1);
  await dialog.getByRole("button", { name: "Keep running" }).click();
  await expect(dialog).toHaveCount(0);

  expect(recorder.starts.length + retries).toBe(2);
  await expect(page.locator("that-toast")).toHaveCount(0);
  await expect(railTimer(page)).toContainText("WORK-1");
});
