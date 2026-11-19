import { expect, test, type Page } from "@playwright/test";

/**
 * CB#253: an MCP client writes through the server while the tab is elsewhere,
 * and the tab catches up when it comes back. The stub below is that server: a
 * test changes its state from Node — outside the page, as an MCP write is —
 * and only the tab's return may bring it on screen.
 *
 * A stub and not the real /api or /mcp: app-e2e has one database and one timer
 * for every worker and both browsers, so a real start here would be the
 * running timer in every other test.
 */

const TODAY = "2026-09-09";
const WEEK = ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"];

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

interface StubRunning {
  instanceId: number;
  instanceName: string;
  instancePosition: number;
  issueKey: string;
  startedAt: string;
}

interface StubServer {
  running: StubRunning | null;
  entries: StubEntry[];
  reads: { timer: number; entries: number; week: number };
}

function entry(id: number, issueKey: string, seconds: number): StubEntry {
  return {
    id,
    instanceId: 1,
    instanceName: "Work",
    instancePosition: 0,
    issueKey,
    day: TODAY,
    startedAt: `${TODAY}T09:00:00+02:00`,
    seconds,
    comment: "",
    pushState: "unpushed",
  };
}

/** The week rollup the real handler would build from `entries`. */
function weekOf(entries: StubEntry[]) {
  const keys = [...new Set(entries.map((each) => each.issueKey))];
  const rows = keys.map((issueKey) => {
    const cells = WEEK.map((day) => {
      const seconds = entries
        .filter((each) => each.issueKey === issueKey && each.day === day)
        .reduce((sum, each) => sum + each.seconds, 0);
      return { seconds, pushState: seconds > 0 ? ("unpushed" as const) : null };
    });
    return {
      instanceId: 1,
      instanceName: "Work",
      instancePosition: 0,
      issueKey,
      url: "",
      cells,
      seconds: cells.reduce((sum, cell) => sum + cell.seconds, 0),
    };
  });
  const days = WEEK.map((day, index) => {
    const seconds = rows.reduce((sum, row) => sum + (row.cells[index]?.seconds ?? 0), 0);
    return { day, seconds, pushState: seconds > 0 ? ("unpushed" as const) : null };
  });

  return {
    start: WEEK[0],
    end: WEEK[6],
    prevStart: "2026-08-31",
    nextStart: "2026-09-14",
    weekNumber: 37,
    days,
    rows,
    seconds: days.reduce((sum, day) => sum + day.seconds, 0),
  };
}

const jiraTraffic: string[] = [];

test.beforeEach(() => {
  jiraTraffic.length = 0;
});

test.afterEach(() => {
  expect(jiraTraffic).toEqual([]);
});

async function stubServer(page: Page, entries: StubEntry[] = []): Promise<StubServer> {
  const server: StubServer = { running: null, entries, reads: { timer: 0, entries: 0, week: 0 } };

  await page.route("**/api/issues", (route) =>
    route.fulfill({
      status: 200,
      json: {
        instances: [
          {
            id: 1,
            name: "Work",
            error: null,
            issues: [
              { key: "WORK-1", summary: "Fix the export", status: "In Progress", url: "" },
              { key: "WORK-2", summary: "Tidy the backlog", status: "To Do", url: "" },
            ],
          },
        ],
      },
    }),
  );
  await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));
  await page.route("**/api/timer", (route) => {
    server.reads.timer += 1;
    return route.fulfill({ status: 200, json: { running: server.running, stopped: null } });
  });
  await page.route("**/api/entries**", (route) => {
    server.reads.entries += 1;
    return route.fulfill({ status: 200, json: { today: TODAY, entries: server.entries } });
  });
  await page.route("**/api/week**", (route) => {
    const { pathname } = new URL(route.request().url());
    if (route.request().method() === "GET" && pathname === "/api/week") {
      server.reads.week += 1;
      return route.fulfill({ status: 200, json: weekOf(server.entries) });
    }
    // Anything else under /api/week (the Jira fetch above all) must not happen on a return.
    jiraTraffic.push(`${route.request().method()} ${pathname}`);
    return route.fulfill({ status: 500, json: { error: "not stubbed" } });
  });

  return server;
}

/** What start_timer and create_entry leave on the server — written from Node, not the page. */
function writeFromOutside(server: StubServer, issueKey: string): void {
  server.running = {
    instanceId: 1,
    instanceName: "Work",
    instancePosition: 0,
    issueKey: "WORK-1",
    startedAt: new Date().toISOString(),
  };
  server.entries = [...server.entries, entry(server.entries.length + 1, issueKey, 1800)];
}

async function setVisibility(page: Page, state: "hidden" | "visible"): Promise<void> {
  await page.evaluate((next) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => next });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

async function dispatchOnWindow(page: Page, type: "blur" | "focus"): Promise<void> {
  await page.evaluate((name) => window.dispatchEvent(new Event(name)), type);
}

const AWAY = {
  "the tab is hidden": {
    leave: (page: Page) => setVisibility(page, "hidden"),
    comeBack: (page: Page) => setVisibility(page, "visible"),
  },
  "the window loses focus": {
    leave: (page: Page) => dispatchOnWindow(page, "blur"),
    comeBack: (page: Page) => dispatchOnWindow(page, "focus"),
  },
} as const;

/** A real round trip: anything an event started has sent its request before this resolves. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => fetch("/api/health").then((response) => response.text()));
}

const railTimer = (page: Page) => page.locator("#rail-timer");
const todayRow = (page: Page, key: string) => page.locator(`that-ticket-row[key="${key}"]`);
const weekRow = (page: Page, key: string) => page.locator("tbody tr", { hasText: key });

for (const [how, away] of Object.entries(AWAY)) {
  test(`Today shows a timer and an entry made outside the tab once it comes back after ${how}`, async ({
    page,
  }) => {
    const server = await stubServer(page);
    await page.goto("/today");
    await expect(todayRow(page, "WORK-2")).toHaveAttribute("seconds", "0");
    await expect(railTimer(page)).toContainText("No timer running");

    await away.leave(page);
    writeFromOutside(server, "WORK-2");
    await settle(page);
    // A second leaving event, now that the write exists: leaving must never read.
    await away.leave(page);
    await settle(page);
    // Still away: nothing may have moved yet, or the return is not what moved it.
    await expect(railTimer(page)).toContainText("No timer running");
    await expect(todayRow(page, "WORK-2")).toHaveAttribute("seconds", "0");

    await away.comeBack(page);

    await expect(railTimer(page)).toContainText("WORK-1");
    await expect(todayRow(page, "WORK-2")).toHaveAttribute("seconds", "1800");
  });

  test(`Week shows an entry made outside the tab once it comes back after ${how}`, async ({ page }) => {
    const server = await stubServer(page, [entry(1, "WORK-1", 3600)]);
    await page.goto("/week");
    await expect(weekRow(page, "WORK-1")).toBeVisible();

    await away.leave(page);
    writeFromOutside(server, "WORK-2");
    await settle(page);
    // A second leaving event, now that the write exists: leaving must never read.
    await away.leave(page);
    await settle(page);
    await expect(weekRow(page, "WORK-2")).toHaveCount(0);

    await away.comeBack(page);

    await expect(weekRow(page, "WORK-2")).toBeVisible();
    await expect(railTimer(page)).toContainText("WORK-1");
  });
}

test("a tab opened in the background catches up when it first becomes visible", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }),
  );
  const server = await stubServer(page);
  await page.goto("/today");
  await expect(todayRow(page, "WORK-2")).toHaveAttribute("seconds", "0");

  writeFromOutside(server, "WORK-2");
  await settle(page);
  await expect(railTimer(page)).toContainText("No timer running");

  await setVisibility(page, "visible");

  await expect(railTimer(page)).toContainText("WORK-1");
  await expect(todayRow(page, "WORK-2")).toHaveAttribute("seconds", "1800");
});

test("a focus while the tab is hidden is not a return, so becoming visible still catches up", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }),
  );
  const server = await stubServer(page);
  await page.goto("/today");
  await expect(todayRow(page, "WORK-2")).toHaveAttribute("seconds", "0");
  await expect(railTimer(page)).toContainText("No timer running");

  // A real window focus can reach a hidden tab: the browser window has focus
  // while the page reports itself hidden.
  await dispatchOnWindow(page, "focus");
  writeFromOutside(server, "WORK-2");
  await settle(page);
  await expect(railTimer(page)).toContainText("No timer running");

  await setVisibility(page, "visible");

  await expect(railTimer(page)).toContainText("WORK-1");
  await expect(todayRow(page, "WORK-2")).toHaveAttribute("seconds", "1800");
});

for (const path of ["/today", "/week"]) {
  test(`a tab on ${path} that stays visible and focused makes no extra reads`, async ({ page }) => {
    const server = await stubServer(page, [entry(1, "WORK-1", 3600)]);
    await page.goto(path);
    await expect(
      path === "/today" ? todayRow(page, "WORK-1") : weekRow(page, "WORK-1"),
    ).toBeVisible();
    await settle(page);
    const before = { ...server.reads };

    // Events a tab that never left still receives: a visibilitychange that
    // changes nothing, a focus with no blur before it, and focus moving
    // between controls inside the page.
    await setVisibility(page, "visible");
    await dispatchOnWindow(page, "focus");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await settle(page);

    expect(server.reads).toEqual(before);
  });
}

test("one return costs one timer read, however many of its events arrive, and the next costs one more", async ({
  page,
}) => {
  const server = await stubServer(page);
  await page.goto("/today");
  await expect(todayRow(page, "WORK-2")).toHaveAttribute("seconds", "0");
  await settle(page);
  const before = server.reads.timer;

  // A real switch away and back delivers all four, as separate tasks.
  await dispatchOnWindow(page, "blur");
  await setVisibility(page, "hidden");
  await setVisibility(page, "visible");
  await dispatchOnWindow(page, "focus");

  await expect.poll(() => server.reads.timer).toBe(before + 1);
  await settle(page);
  expect(server.reads.timer).toBe(before + 1);

  await dispatchOnWindow(page, "blur");
  await dispatchOnWindow(page, "focus");

  await expect.poll(() => server.reads.timer).toBe(before + 2);
  await settle(page);
  expect(server.reads.timer).toBe(before + 2);
});
