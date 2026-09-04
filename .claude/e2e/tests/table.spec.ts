import { expect, test, type Page } from "@playwright/test";

interface StubIssue {
  key: string;
  summary: string;
  status: string;
  url: string;
}

interface StubGroup {
  id: number;
  name: string;
  issues: StubIssue[];
  error: { code: string; message: string } | null;
}

/**
 * Same stubbing shape as today.spec.ts: /api/issues drives the two instance
 * cards this suite measures, and the e2e stack shares the dev database, so
 * pins and entries are stubbed empty in beforeEach below rather than left to
 * whatever the store happens to hold.
 */
async function stubIssues(page: Page, ...responses: StubGroup[][]): Promise<void> {
  let calls = 0;

  await page.route("**/api/issues", async (route) => {
    const index = Math.min(calls, responses.length - 1);
    calls += 1;
    await route.fulfill({ status: 200, json: { instances: responses[index] } });
  });
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));
  await page.route("**/api/entries**", (route) => route.fulfill({ status: 200, json: [] }));
});

function group(id: number, name: string, issues: StubIssue[]): StubGroup {
  return { id, name, issues, error: null };
}

const ridgelineIssues: StubIssue[] = [
  {
    key: "RIDGE-5301",
    summary: "Timesheet export drops the last day of the month",
    status: "In Progress",
    url: "https://ridgeline.atlassian.net/browse/RIDGE-5301",
  },
  {
    key: "RIDGE-4880",
    summary: "Update the on-call rota document",
    status: "To Do",
    url: "https://ridgeline.atlassian.net/browse/RIDGE-4880",
  },
];

const northwindIssues: StubIssue[] = [
  {
    key: "NW-806",
    summary: "Review the Q3 capacity plan",
    status: "In Review",
    url: "https://northwind.atlassian.net/browse/NW-806",
  },
];

/**
 * Items 1-3 of Task 2's brief: every instance card carries a header row, its
 * own columns line up with the body beneath it, and the two cards' columns
 * line up with each other. That last one is the whole reason the spacing rule
 * is one CSS rule shared by every that-table rather than per-cell padding —
 * two cards padding their cells independently could still agree with
 * themselves and disagree with each other.
 *
 * This fails today: Today renders <ul> lists, not that-table, so the
 * that-table locator matches nothing and the count assertion below is what
 * reports that. Task 4 is what wires Today to that-table.
 */
test("every instance card's header lines up with its own body and with the other card's", async ({
  page,
}) => {
  await stubIssues(page, [group(1, "Ridgeline", ridgelineIssues), group(2, "Northwind", northwindIssues)]);
  await page.goto("/today");

  const tables = page.locator("that-table table.that-tbl");
  await expect(tables).toHaveCount(2);

  const columnStarts = await tables.evaluateAll((elements) =>
    elements.map((table) => {
      const headerCells = Array.from(table.querySelectorAll("thead th"));
      const bodyRow = table.querySelector("tbody tr");
      const bodyCells = bodyRow ? Array.from(bodyRow.children) : [];

      return headerCells.map((th, index) => ({
        header: th.getBoundingClientRect().left,
        body: bodyCells[index]?.getBoundingClientRect().left ?? null,
      }));
    }),
  );

  expect(columnStarts).toHaveLength(2);
  const [first, second] = columnStarts as [typeof columnStarts[0], typeof columnStarts[0]];

  for (const card of columnStarts) {
    for (const column of card) {
      expect(column.body).not.toBeNull();
      expect(Math.round(column.header)).toBe(Math.round(column.body as number));
    }
  }

  expect(first).toHaveLength(second.length);
  for (const [index, column] of first.entries()) {
    expect(Math.round(column.header)).toBe(Math.round(second[index]!.header));
  }
});

/**
 * Item 4: the action cell's 34px control centres on middle with 5px block
 * padding chosen so it costs nothing — a row holding it must be no taller
 * than the header row above it, which holds only text (and a 13px sort
 * icon). If the action cell's control pushed the row taller, two adjoining
 * cards would step out of line with each other exactly as items 1-3 above
 * guard against, just vertically instead of horizontally.
 *
 * Also red today, for the same reason: no that-table exists yet to measure.
 */
test("a row holding the action cell's control is no taller than the header row of text", async ({
  page,
}) => {
  await stubIssues(page, [group(1, "Ridgeline", ridgelineIssues)]);
  await page.goto("/today");

  const table = page.locator("that-table table.that-tbl").first();
  await expect(table).toBeVisible();

  const heights = await table.evaluate((element) => {
    const headerRow = element.querySelector("thead tr");
    const bodyRow = element.querySelector("tbody tr");

    return {
      header: headerRow?.getBoundingClientRect().height ?? null,
      body: bodyRow?.getBoundingClientRect().height ?? null,
    };
  });

  expect(heights.header).not.toBeNull();
  expect(heights.body).not.toBeNull();
  expect(heights.body as number).toBeLessThanOrEqual(heights.header as number);
});
