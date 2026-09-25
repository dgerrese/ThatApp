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

/**
 * A timer started from another tab or device is unknown to this one, so its
 * first start goes out with no rounding and the server refuses it. That
 * refusal must re-read the timer, or every later click fails the same way
 * until a reload.
 */
test("a start refused over a timer this tab never saw re-reads it, so the next click asks to switch", async ({
  page,
}) => {
  const recorder = await stubTimer(page, { runningFor: 60 });
  await page.route(
    "**/api/timer",
    (route) => route.fulfill({ status: 200, json: { running: null, stopped: null } }),
    { times: 1 },
  );
  await page.goto("/today");
  await expect(railTimer(page)).toContainText("No timer running");

  const start = ticketRow(page, "WORK-2").getByRole("button", { name: "start timer" });
  await start.click();
  await expect.poll(() => recorder.starts.length).toBe(1);

  await start.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading")).toHaveText("Stop WORK-1 and start WORK-2?");
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
