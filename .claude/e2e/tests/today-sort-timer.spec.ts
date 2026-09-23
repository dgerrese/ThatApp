import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * #183 task 2: a `that-table` sorted by Today must re-sort on a timer start,
 * stop or switch, but never on the tick alone — task 1 made the sort compare
 * the figure a row shows (logged seconds plus its own running time); this is
 * what makes the table notice that figure changed for a reason other than
 * time passing.
 *
 * Stubbing follows timer.spec.ts (the timer endpoints) and table.spec.ts (the
 * table locators) — read directly rather than imported, since spec files do
 * not share helpers in this rig.
 */

const DAY = "2026-09-23";

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

function stubEntry(id: number, issueKey: string, seconds: number): StubEntry {
  return {
    id,
    instanceId: 1,
    instanceName: "Work",
    instancePosition: 0,
    issueKey,
    day: DAY,
    startedAt: `${DAY}T09:00:00Z`,
    seconds,
    comment: "",
    pushState: "unpushed",
  };
}

/** `**\/api/issues`, `**\/api/pins**` and `**\/api/entries**`, shared by both
 *  tests. `entries` is the mutable list the timer stubs push into. */
async function stubToday(page: Page, entries: StubEntry[]): Promise<void> {
  await page.route("**/api/issues", (route) =>
    route.fulfill({
      status: 200,
      json: {
        instances: [
          {
            id: 1,
            name: "Work",
            issues: [
              { key: "WORK-1", summary: "Ahead", status: "To Do", url: "" },
              { key: "WORK-2", summary: "Behind", status: "To Do", url: "" },
            ],
            error: null,
          },
        ],
      },
    }),
  );
  await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));
  await page.route("**/api/entries**", (route) =>
    route.fulfill({ status: 200, json: { today: DAY, entries } }),
  );
}

/** `sort-id` is what makes the instance card's table addressable — see
 *  table.spec.ts's own `instanceTable`. */
function instanceTable(page: Page): Locator {
  return page.locator('that-table[sort-id="instance-1"]');
}

async function rowKeys(table: Locator): Promise<string[]> {
  return table
    .locator("tbody > *")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("key") ?? ""));
}

/** Each row's Today figure, in DOM order — the same cell the sort compares. */
async function figures(table: Locator): Promise<string[]> {
  return table
    .locator("tbody > *")
    .evaluateAll((rows) =>
      rows.map((row) => row.querySelector("td.c-today .that-tnum")?.textContent?.trim() ?? ""),
    );
}

/** "H:MM" to whole minutes, for the never-increasing check below. */
function parseFigure(figure: string): number {
  const [hours = "0", minutes = "0"] = figure.split(":");

  return Number(hours) * 60 + Number(minutes);
}

/** The claim a Today-descending sort makes: read top to bottom, the figures
 *  never increase. */
function expectNeverIncreasing(rowFigures: string[]): void {
  const minutes = rowFigures.map(parseFigure);
  for (let index = 1; index < minutes.length; index++) {
    expect(minutes[index]).toBeLessThanOrEqual(minutes[index - 1]!);
  }
}

test("ticks never re-sort a table sorted by Today; stopping the timer does", async ({ page }) => {
  const entries = [stubEntry(1, "WORK-1", 3600), stubEntry(2, "WORK-2", 3540)];
  const t0 = Date.parse("2026-09-23T10:00:00Z");
  let running: { instanceId: number; issueKey: string; startedAt: string } | null = null;

  await page.clock.install({ time: t0 });
  await stubToday(page, entries);

  await page.route("**/api/timer", (route) => {
    if (route.request().method() !== "GET") return route.fallback();

    return route.fulfill({ status: 200, json: { running, stopped: null } });
  });

  await page.route("**/api/timer/start", async (route) => {
    const body = route.request().postDataJSON() as { instanceId: number; issueKey: string };
    running = { instanceId: body.instanceId, issueKey: body.issueKey, startedAt: new Date(t0).toISOString() };
    await route.fulfill({ status: 200, json: { running, stopped: null } });
  });

  await page.route("**/api/timer/stop", async (route) => {
    const now = await page.evaluate(() => Date.now());
    const seconds = Math.floor((now - t0) / 1000);
    const stopped = stubEntry(3, "WORK-2", seconds);
    entries.push(stopped);
    running = null;
    await route.fulfill({ status: 200, json: { stopped, discarded: false } });
  });

  await page.goto("/today");

  const table = instanceTable(page);
  await expect(table.locator("tbody > *")).toHaveCount(2);

  await table.locator("th.c-today button").click();
  await expect.poll(() => rowKeys(table)).toEqual(["WORK-1", "WORK-2"]);
  expect(await figures(table)).toEqual(["1:00", "0:59"]);

  const work2 = page.locator("that-ticket-row", { hasText: "WORK-2" });
  await work2.getByRole("button", { name: "start timer" }).click();
  await expect(work2.getByRole("button", { name: "stop timer" })).toBeVisible();

  await page.clock.runFor(60_000);
  expect(await rowKeys(table)).toEqual(["WORK-1", "WORK-2"]);

  await page.clock.runFor(60_000);
  expect(await rowKeys(table)).toEqual(["WORK-1", "WORK-2"]);
  // The drift the ticket accepts: WORK-2 has overtaken WORK-1's total, but the
  // table sorted by it a minute ago and a tick alone must not act on that.
  expect(await figures(table)).toEqual(["1:00", "1:01"]);

  await work2.getByRole("button", { name: "stop timer" }).click();
  await expect.poll(() => rowKeys(table)).toEqual(["WORK-2", "WORK-1"]);
  const stoppedFigures = await figures(table);
  expect(stoppedFigures).toEqual(["1:01", "1:00"]);
  expectNeverIncreasing(stoppedFigures);
});

test("a timer the page learns of after its rows arrive re-sorts the table", async ({ page }) => {
  const entries = [stubEntry(1, "WORK-1", 3600), stubEntry(2, "WORK-2", 3540)];
  await stubToday(page, entries);

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route("**/api/timer", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();

    await gate;
    await route.fulfill({
      status: 200,
      json: {
        running: {
          instanceId: 1,
          issueKey: "WORK-2",
          startedAt: new Date(Date.now() - 120_000).toISOString(),
        },
        stopped: null,
      },
    });
  });

  await page.goto("/today");

  const table = instanceTable(page);
  await expect(table.locator("tbody > *")).toHaveCount(2);
  await table.locator("th.c-today button").click();
  await expect.poll(() => rowKeys(table)).toEqual(["WORK-1", "WORK-2"]);

  release();

  await expect.poll(() => rowKeys(table)).toEqual(["WORK-2", "WORK-1"]);
  const rowFigures = await figures(table);
  expect(rowFigures).toEqual(["1:01", "1:00"]);
  expectNeverIncreasing(rowFigures);
});
