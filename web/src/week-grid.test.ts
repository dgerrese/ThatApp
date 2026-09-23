import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

import type { EntryTicket } from "./components/that-entry-dialog.ts";
import type { WeekCell, WeekDay, WeekRollup, WeekRow } from "./types.ts";
import { failuresIn, noFailures, weekGrid } from "./week-grid.ts";

// The renderer builds through the global `document`, which node lacks. node --test
// runs every file in its own process, so this global reaches no other suite.
Object.assign(globalThis, { document: new Window().document });

const DAYS = [
  "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10",
  "2026-09-11", "2026-09-12", "2026-09-13",
];

const EMPTY_CELL: WeekCell = { seconds: 0, pushState: null };

function row(overrides: Partial<WeekRow> & { byDay?: Record<number, WeekCell> } = {}): WeekRow {
  const { byDay = {}, ...rest } = overrides;
  const cells = DAYS.map((_, index) => byDay[index] ?? EMPTY_CELL);

  return {
    instanceId: 1,
    instanceName: "Acme",
    instancePosition: 0,
    issueKey: "ABC-1",
    url: "https://acme.atlassian.net/browse/ABC-1",
    cells,
    seconds: cells.reduce((sum, cell) => sum + cell.seconds, 0),
    ...rest,
  };
}

function rollup(rows: WeekRow[], byDay: Record<number, Partial<WeekDay>> = {}): WeekRollup {
  const days = DAYS.map((day, index) => ({
    day,
    seconds: rows.reduce((sum, r) => sum + (r.cells[index]?.seconds ?? 0), 0),
    pushState: null,
    ...byDay[index],
  }));

  return {
    start: "2026-09-07",
    end: "2026-09-13",
    prevStart: "2026-08-31",
    nextStart: "2026-09-14",
    weekNumber: 37,
    days,
    rows,
    seconds: rows.reduce((sum, r) => sum + r.seconds, 0),
  };
}

function noop(): void {}

/** The day cell's button for one row and day — tds only, since the key cell is a th. */
function cellButton(grid: HTMLElement, rowIndex: number, dayIndex: number): HTMLButtonElement {
  const rows = grid.querySelectorAll("tbody tr");
  const cells = rows[rowIndex]?.querySelectorAll("td");
  const button = cells?.[dayIndex]?.querySelector("button");
  assert.ok(button, `no cell button at row ${String(rowIndex)}, day ${String(dayIndex)}`);

  return button;
}

function footCells(grid: HTMLElement): HTMLTableCellElement[] {
  return [...grid.querySelectorAll<HTMLTableCellElement>("tfoot td")];
}

test("an empty week draws the message and a way to Today, not a table", () => {
  const grid = weekGrid(rollup([]), noFailures(), noop);

  assert.equal(grid.querySelector("table"), null);
  assert.equal(grid.querySelector("p")?.textContent, "Nothing logged this week.");
  const link = grid.querySelector("a");
  assert.equal(link?.getAttribute("href"), "/today");
  assert.equal(link?.hasAttribute("data-route"), true);
});

test("the header names every column by weekday and date", () => {
  const grid = weekGrid(rollup([row()]), noFailures(), noop);
  const headings = [...grid.querySelectorAll("thead th")].map((th) => th.textContent);

  assert.deepEqual(headings, [
    "Ticket", "Mon 7", "Tue 8", "Wed 9", "Thu 10", "Fri 11", "Sat 12", "Sun 13", "Total",
  ]);
});

test("each push state draws its own marker, and pushed draws none", async (t) => {
  const cases: { state: WeekCell["pushState"]; marker: string | null; words: string }[] = [
    { state: "unpushed", marker: "bg-pending", words: "not pushed" },
    { state: "dirty", marker: "border-dirty", words: "edited since it was pushed" },
    { state: "pushed", marker: null, words: "pushed" },
  ];

  for (const { state, marker, words } of cases) {
    await t.test(String(state), () => {
      const grid = weekGrid(
        rollup([row({ byDay: { 0: { seconds: 3600, pushState: state } } })]),
        noFailures(),
        noop,
      );
      const button = cellButton(grid, 0, 0);
      const mark = button.querySelector("span[aria-hidden='true']");

      if (marker === null) {
        assert.equal(mark, null);
      } else {
        assert.ok(mark?.classList.contains(marker), `marker lacks ${marker}`);
      }
      assert.equal(button.getAttribute("aria-label"), `ABC-1, Mon 7, 1h 00m, ${words}, click to edit`);
    });
  }
});

test("a day total wears its day's marker, named for a reader who cannot see it", () => {
  const grid = weekGrid(
    rollup([row({ byDay: { 0: { seconds: 3600, pushState: "unpushed" } } })], {
      0: { pushState: "unpushed" },
    }),
    noFailures(),
    noop,
  );
  const monday = footCells(grid)[0];

  assert.equal(monday?.querySelector("span[aria-hidden='true']")?.getAttribute("title"), "not pushed");
  assert.equal(monday?.querySelector(".sr-only")?.textContent, "not pushed, ");
});

test("a failed push marks its own cell and day, outranking the rollup's state", () => {
  const failures = failuresIn([
    {
      day: "2026-09-08",
      results: [
        { entryId: 1, issueKey: "ABC-1", instanceId: 1, status: "failed" },
        { entryId: 2, issueKey: "ABC-2", instanceId: 1, status: "pushed" },
      ],
    },
  ]);
  const unpushed: WeekCell = { seconds: 1800, pushState: "unpushed" };
  const grid = weekGrid(
    rollup([row({ byDay: { 1: unpushed } }), row({ issueKey: "ABC-2", byDay: { 1: unpushed } })], {
      1: { pushState: "unpushed" },
    }),
    failures,
    noop,
  );

  const failed = cellButton(grid, 0, 1);
  assert.ok(failed.querySelector("span[aria-hidden='true']")?.classList.contains("border-b-failed"));
  assert.match(failed.getAttribute("aria-label") ?? "", /push failed/);

  const pushed = cellButton(grid, 1, 1);
  assert.ok(pushed.querySelector("span[aria-hidden='true']")?.classList.contains("bg-pending"));

  const tuesday = footCells(grid)[1];
  assert.equal(tuesday?.querySelector("span[aria-hidden='true']")?.getAttribute("title"), "push failed");
});

test("rows, days and the week are totalled, and a zero total is an em dash", () => {
  const grid = weekGrid(
    rollup([
      row({
        byDay: {
          0: { seconds: 3600, pushState: "pushed" },
          1: { seconds: 1800, pushState: "pushed" },
        },
      }),
      row({ issueKey: "ABC-2" }),
    ]),
    noFailures(),
    noop,
  );
  const rows = grid.querySelectorAll("tbody tr");
  const rowTotal = (index: number): Element | null | undefined =>
    rows[index]?.querySelector("td:last-child");

  assert.equal(rowTotal(0)?.textContent, "1h 30m");
  assert.equal(rowTotal(1)?.textContent, "—");
  assert.ok(rowTotal(1)?.classList.contains("text-ink-muted"));

  const foot = footCells(grid).map((td) => td.textContent);
  assert.deepEqual(foot, ["1h 00m", "0h 30m", "—", "—", "—", "—", "—", "1h 30m"]);
});

test("an empty cell is an em dash that still opens the dialog", () => {
  const grid = weekGrid(rollup([row()]), noFailures(), noop);
  const button = cellButton(grid, 0, 2);

  assert.equal(button.textContent, "—");
  assert.equal(button.getAttribute("aria-label"), "ABC-1, Wed 9, no time logged, click to add");
});

test("the key links to Jira, or is plain text with no site to link to", async (t) => {
  await t.test("with a url", () => {
    const grid = weekGrid(rollup([row()]), noFailures(), noop);
    const link = grid.querySelector("tbody th a.that-key");

    assert.equal(link?.getAttribute("href"), "https://acme.atlassian.net/browse/ABC-1");
    assert.equal(link?.getAttribute("target"), "_blank");
    assert.equal(link?.getAttribute("rel"), "noopener");
    assert.equal(link?.textContent, "ABC-1");
  });

  await t.test("without one", () => {
    const grid = weekGrid(rollup([row({ url: "" })]), noFailures(), noop);

    assert.equal(grid.querySelector("tbody th a"), null);
    assert.equal(grid.querySelector("tbody th span.that-key")?.textContent, "ABC-1");
  });
});

test("a cell opens the entries dialog for its own ticket and day", () => {
  const opened: EntryTicket[] = [];
  const grid = weekGrid(rollup([row()]), noFailures(), (ticket) => {
    opened.push(ticket);
  });

  cellButton(grid, 0, 1).click();

  assert.deepEqual(opened, [
    {
      instanceId: 1,
      instanceName: "Acme",
      instancePosition: 0,
      issueKey: "ABC-1",
      summary: "",
      status: "",
      day: "2026-09-08",
    },
  ]);
});
