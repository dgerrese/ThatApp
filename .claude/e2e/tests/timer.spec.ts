import { expect, test, type Page } from "@playwright/test";

/** A run under this many seconds leaves no entry — store.MinTimerSeconds, mirrored here. */
const MIN_TIMER_SECONDS = 60;

interface StubRunning {
  instanceId: number;
  issueKey: string;
  startedAt: number; // epoch ms
}

/**
 * A stateful stand-in for the three real timer endpoints, applying the same
 * rules the store does — switch and the under-a-minute discard — so this spec
 * proves the browser's *interface* to them without a second proof of the
 * rules themselves. Those already have table-driven coverage in
 * internal/store/timers_test.go and internal/server/timer_test.go; see
 * Task 3 step 1's note in docs/superpowers/plans/2026-09-18-timer.md for why
 * this spec does not drive the real endpoints.
 *
 * One closure per test, so a test can run fully parallel with any other: no
 * state survives past the page it was created for, and a page.route survives
 * page.reload(), which is what lets the reload test work against it too.
 */
async function stubTimer(page: Page): Promise<void> {
  let running: StubRunning | null = null;
  let nextEntryId = 1;

  const runningDTO = () =>
    running && {
      instanceId: running.instanceId,
      issueKey: running.issueKey,
      startedAt: new Date(running.startedAt).toISOString(),
    };

  // Closes whatever is running as of `now`, the same close rule the store
  // applies: under a minute leaves no entry. Returns the entry DTO, or null
  // either way — nothing was running, or the run was discarded.
  const close = (now: number) => {
    if (!running) return null;
    const seconds = Math.floor((now - running.startedAt) / 1000);
    const closed = running;
    running = null;
    if (seconds < MIN_TIMER_SECONDS) return null;

    return {
      id: nextEntryId++,
      instanceId: closed.instanceId,
      instanceName: "Work",
      instancePosition: 0,
      issueKey: closed.issueKey,
      day: "2026-09-21",
      startedAt: new Date(closed.startedAt).toISOString(),
      seconds,
      comment: "",
      pushState: "unpushed" as const,
    };
  };

  await page.route("**/api/timer", (route) =>
    route.fulfill({ status: 200, json: { running: runningDTO(), stopped: null } }),
  );

  await page.route("**/api/timer/start", (route) => {
    const body = route.request().postDataJSON() as { instanceId: number; issueKey: string };
    const stopped = close(Date.now());
    running = { instanceId: body.instanceId, issueKey: body.issueKey, startedAt: Date.now() };

    return route.fulfill({ status: 200, json: { running: runningDTO(), stopped } });
  });

  await page.route("**/api/timer/stop", (route) => {
    const wasRunning = running !== null;
    const stopped = close(Date.now());

    return route.fulfill({ status: 200, json: { stopped, discarded: wasRunning && stopped === null } });
  });
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
  await stubTimer(page);
});

test("starting a timer on a row turns its control to stop, tints the key and the Today figure, and the rail shows the running line", async ({
  page,
}) => {
  await page.goto("/today");

  const row = ticketRow(page, "WORK-1");
  await row.getByRole("button", { name: "start timer" }).click();

  await expect(row.getByRole("button", { name: "stop timer" })).toBeVisible();
  await expect(row.locator(".that-key")).toHaveClass(/text-running\b/);
  await expect(row.locator("td.c-today .that-tnum")).toHaveClass(/text-running\b/);

  await expect(railTimer(page)).toContainText("WORK-1");
  await expect(railTimer(page)).not.toContainText("No timer running");
  await expect(railTimer(page).getByRole("button", { name: "stop timer" })).toBeVisible();
});

test("a reload keeps the timer running and its elapsed time carries on", async ({ page }) => {
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
  await page.goto("/today");

  const first = ticketRow(page, "WORK-1");
  const second = ticketRow(page, "WORK-2");

  await first.getByRole("button", { name: "start timer" }).click();
  await expect(first.getByRole("button", { name: "stop timer" })).toBeVisible();

  await second.getByRole("button", { name: "start timer" }).click();

  await expect(first.getByRole("button", { name: "start timer" })).toBeVisible();
  await expect(first.locator(".that-key")).not.toHaveClass(/text-running\b/);
  await expect(second.getByRole("button", { name: "stop timer" })).toBeVisible();
  await expect(railTimer(page)).toContainText("WORK-2");
});

test("stopping from the rail on Week returns it to 'No timer running'", async ({ page }) => {
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

  await expect(railTimer(page)).toContainText("No timer running");
});

test("a stop within a minute reports nothing was logged", async ({ page }) => {
  await page.goto("/today");

  const row = ticketRow(page, "WORK-1");
  await row.getByRole("button", { name: "start timer" }).click();
  await row.getByRole("button", { name: "stop timer" }).click();

  await expect(page.getByText("Under a minute — nothing logged.")).toBeVisible();
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
