import { expect, test, type Page } from "@playwright/test";

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
 * Copied from timer.spec.ts's stubTimer (not exported there; see that file's
 * own comment for why this is a stateful stand-in rather than a drive against
 * the real endpoints), with one addition: `holdStart` records the first start
 * POST as usual but then holds its response until `releaseStart()` is
 * called, so a test can see whether a second click sends a second one before
 * the first resolves.
 */
async function stubTimer(
  page: Page,
  options?: { runningFor?: number; holdStart?: boolean },
): Promise<TimerRecorder & { startRequested: Promise<void>; releaseStart: () => void }> {
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

  let releaseStart: () => void = () => {};
  const startReleased = new Promise<void>((resolve) => {
    releaseStart = resolve;
  });
  let markStartRequested: () => void = () => {};
  const startRequested = new Promise<void>((resolve) => {
    markStartRequested = resolve;
  });
  let startHeld = false;

  await page.route("**/api/timer", (route) =>
    route.fulfill({ status: 200, json: { running: runningDTO(), stopped: null } }),
  );

  await page.route("**/api/timer/start", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    recorder.starts.push(body);
    if (options?.holdStart && !startHeld) {
      startHeld = true;
      markStartRequested();
      await startReleased;
    }
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

  return { ...recorder, startRequested, releaseStart };
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

/** Holds the stop dialog's chunk on its first request until the returned
 *  release is called. Other chunks pass straight through. */
async function holdStopDialogChunk(page: Page): Promise<{ requested: Promise<void>; release: () => void }> {
  const base = process.env["THAT_BASE_URL"] ?? "http://that-e2e:8080";
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markRequested: () => void = () => {};
  const requested = new Promise<void>((resolve) => {
    markRequested = resolve;
  });
  let held = false;
  await page.route("**/chunk-*.js", async (route) => {
    const url = new URL(route.request().url());
    const response = await fetch(`${base}${url.pathname}${url.search}`);
    const body = await response.text();
    if (!held && body.includes("that-stop-dialog")) {
      held = true;
      markRequested();
      await released;
    }
    await route.fulfill({
      status: response.status,
      body,
      contentType: response.headers.get("content-type") ?? "text/javascript",
    });
  });
  return { requested, release };
}

test.beforeEach(async ({ page }) => {
  await stubToday(page);
});

test("two clicks on a row's stop while the dialog first loads open one dialog", async ({ page }) => {
  await stubTimer(page, { runningFor: 60 });
  await page.goto("/today");
  const { requested, release } = await holdStopDialogChunk(page);

  const stop = ticketRow(page, "WORK-1").getByRole("button", { name: "stop timer" });
  await stop.click();
  await stop.click();
  await requested;
  release();

  await expect(page.locator("#that-stop-dialog-heading")).toBeVisible();
  await expect(page.locator("that-stop-dialog")).toHaveCount(1);
  await expect(page.locator("#that-stop-dialog-heading")).toHaveCount(1);
});

test("two clicks on the rail's stop while the dialog first loads open one dialog", async ({ page }) => {
  await stubTimer(page, { runningFor: 60 });
  await page.goto("/today");
  const { requested, release } = await holdStopDialogChunk(page);

  const stop = railTimer(page).getByRole("button", { name: "stop timer" });
  await stop.click();
  await stop.click();
  await requested;
  release();

  await expect(page.locator("#that-stop-dialog-heading")).toBeVisible();
  await expect(page.locator("that-stop-dialog")).toHaveCount(1);
  await expect(page.locator("#that-stop-dialog-heading")).toHaveCount(1);
});

test("a row's stop clicked while the rail's dialog is loading opens nothing more", async ({ page }) => {
  await stubTimer(page, { runningFor: 60 });
  await page.goto("/today");
  const { requested, release } = await holdStopDialogChunk(page);

  await railTimer(page).getByRole("button", { name: "stop timer" }).click();
  await requested;
  await ticketRow(page, "WORK-1").getByRole("button", { name: "stop timer" }).click();
  release();

  await expect(page.locator("#that-stop-dialog-heading")).toBeVisible();
  await expect(page.locator("that-stop-dialog")).toHaveCount(1);
  await expect(page.locator("#that-stop-dialog-heading")).toHaveCount(1);
});

test("while a start's POST is held, a click on another row's play sends nothing", async ({ page }) => {
  const recorder = await stubTimer(page, { holdStart: true });
  await page.goto("/today");

  await ticketRow(page, "WORK-1").getByRole("button", { name: "start timer" }).click();
  await recorder.startRequested;

  await ticketRow(page, "WORK-2").getByRole("button", { name: "start timer" }).click();
  recorder.releaseStart();

  await expect(railTimer(page)).toContainText("WORK-1");
  expect(recorder.starts.length).toBe(1);
});

test("after Keep running, the next stop opens the dialog again", async ({ page }) => {
  await stubTimer(page, { runningFor: 60 });
  await page.goto("/today");

  const row = ticketRow(page, "WORK-1");
  const dialog = page.getByRole("dialog");
  await row.getByRole("button", { name: "stop timer" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Keep running" }).click();
  await expect(dialog).toHaveCount(0);

  await row.getByRole("button", { name: "stop timer" }).click();
  await expect(page.locator("#that-stop-dialog-heading")).toBeVisible();
});

test("after a failed stop, the next stop opens the dialog again", async ({ page }) => {
  await stubTimer(page, { runningFor: 60 });
  // Registered after the stub's own /api/timer/stop route, so it runs first
  // for the one request `times: 1` allows, then falls through to the stub's
  // handler for every stop after.
  await page.route(
    "**/api/timer/stop",
    (route) => route.fulfill({ status: 500, json: { code: "internal_error", message: "boom" } }),
    { times: 1 },
  );
  await page.goto("/today");

  const row = ticketRow(page, "WORK-1");
  const dialog = page.getByRole("dialog");
  await row.getByRole("button", { name: "stop timer" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Log 0:15" }).click();
  await expect(dialog).toHaveCount(0);

  await row.getByRole("button", { name: "stop timer" }).click();
  await expect(page.locator("#that-stop-dialog-heading")).toBeVisible();
});
