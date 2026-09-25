import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * #227 task 1: Up/Down move focus between Today's table rows. Fixtures follow
 * table.spec.ts's own shape (stubIssues, group) — RIDGE-2 carries no URL so
 * its key cell has no focusable, which is what item 4 below needs.
 */
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

async function stubIssues(page: Page, groups: StubGroup[]): Promise<void> {
  await page.route("**/api/issues", async (route) => {
    await route.fulfill({ status: 200, json: { instances: groups } });
  });
}

function group(id: number, name: string, issues: StubIssue[]): StubGroup {
  return { id, name, issues, error: null };
}

/** GET returns whatever has been pinned so far; POST appends and answers with
 *  the created pin — the shape Today's own optimistic pin control needs to
 *  repaint into the Pinned table (keyboard-audit.spec.ts's own pattern). */
async function stubPins(page: Page): Promise<void> {
  const pinned: Record<string, unknown>[] = [];
  let nextId = 900;

  await page.route("**/api/pins**", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { instanceId: number; issueKey: string };
      const issue = ridgeIssues.find((candidate) => candidate.key === body.issueKey);
      const created = {
        id: nextId++,
        instanceId: body.instanceId,
        instanceName: "Ridgeline",
        instancePosition: 0,
        key: body.issueKey,
        summary: issue?.summary ?? "",
        status: issue?.status ?? "",
        url: issue?.url ?? "",
        error: null,
      };
      pinned.push(created);
      await route.fulfill({ status: 201, json: created });

      return;
    }

    await route.fulfill({ status: 200, json: pinned });
  });
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/entries**", (route) =>
    route.fulfill({ status: 200, json: { today: "2026-09-25", entries: [] } }),
  );
});

const ridgeIssues: StubIssue[] = [
  {
    key: "RIDGE-1",
    summary: "Timesheet export drops the last day of the month",
    status: "In Progress",
    url: "https://ridgeline.atlassian.net/browse/RIDGE-1",
  },
  // No URL: keyContent renders a bare span, not a link — no key focusable.
  { key: "RIDGE-2", summary: "Update the on-call rota document", status: "To Do", url: "" },
];

const northwindIssues: StubIssue[] = [
  {
    key: "NW-1",
    summary: "Review the Q3 capacity plan",
    status: "In Review",
    url: "https://northwind.atlassian.net/browse/NW-1",
  },
];

async function gotoToday(page: Page): Promise<void> {
  await stubIssues(page, [group(1, "Ridgeline", ridgeIssues), group(2, "Northwind", northwindIssues)]);
  await stubPins(page);
  await page.goto("/today");
  await expect(page.locator('that-ticket-row[key="NW-1"]')).toBeVisible();
}

function row(page: Page, key: string): Locator {
  return page.locator(`that-ticket-row[key="${key}"]`);
}

/** Scoped to the row: a bare getByText would also match the row's own hidden
 *  cut-text tooltip carrying the same text (#143). */
function summaryOf(page: Page, key: string): Locator {
  return row(page, key).locator('[id^="that-sum-"]');
}

function keyLinkOf(page: Page, key: string): Locator {
  return row(page, key).locator('[id^="that-key-"]');
}

function pinOf(page: Page, key: string): Locator {
  return row(page, key).locator('[id^="that-pin-"]');
}

test("Down from row 1's summary focuses row 2's summary; Up goes back", async ({ page }) => {
  await gotoToday(page);

  await summaryOf(page, "RIDGE-1").focus();
  await page.keyboard.press("ArrowDown");
  await expect(summaryOf(page, "RIDGE-2")).toBeFocused();

  await page.keyboard.press("ArrowUp");
  await expect(summaryOf(page, "RIDGE-1")).toBeFocused();
});

test("Down from pin focuses the next row's pin, not its timer", async ({ page }) => {
  await gotoToday(page);

  await pinOf(page, "RIDGE-1").focus();
  await page.keyboard.press("ArrowDown");
  await expect(pinOf(page, "RIDGE-2")).toBeFocused();
});

test("Down from the last row of one table focuses the first row of the next; Up the reverse", async ({
  page,
}) => {
  await gotoToday(page);

  await summaryOf(page, "RIDGE-2").focus();
  await page.keyboard.press("ArrowDown");
  await expect(summaryOf(page, "NW-1")).toBeFocused();

  await page.keyboard.press("ArrowUp");
  await expect(summaryOf(page, "RIDGE-2")).toBeFocused();
});

test("Down from a key onto a row with no URL focuses that row's summary", async ({ page }) => {
  await gotoToday(page);

  await keyLinkOf(page, "RIDGE-1").focus();
  await page.keyboard.press("ArrowDown");
  await expect(summaryOf(page, "RIDGE-2")).toBeFocused();
});

/**
 * `window.scrollY` never moves in this layout — `#content` is the app's own
 * scrolling region (index.html's overflow-y-auto, exercised by smoke.spec.ts's
 * "the content region owns the scroll, not the page") — so this needs enough
 * rows to make *that* element overflow.
 *
 * Scrolled short of its own maximum, deliberately: pinned to the true bottom,
 * a further Down has nowhere left to scroll to and the assertion would pass
 * whether or not `preventDefault` ran. `focus({ preventScroll: true })` puts
 * focus on the last row without the focus call itself scrolling it into view
 * and erasing that headroom — Firefox's own default action otherwise nudges
 * `#content` a few pixels further on an unprevented Down, which is exactly
 * what this guards against.
 */
test("at the view's last data row, Down leaves focus alone and does not scroll #content", async ({
  page,
}) => {
  const manyIssues: StubIssue[] = Array.from({ length: 40 }, (_, index) => ({
    key: `WORK-${1000 + index}`,
    summary: `Row ${index}`,
    status: "To Do",
    url: `https://work.atlassian.net/browse/WORK-${1000 + index}`,
  }));
  await stubIssues(page, [group(1, "Work", manyIssues)]);
  await stubPins(page);
  await page.goto("/today");

  const lastKey = "WORK-1039";
  await expect(row(page, lastKey)).toBeAttached();

  const content = page.locator("#content");
  await content.evaluate((element) => {
    element.scrollTop = element.scrollHeight - element.clientHeight - 300;
  });
  await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  const summary = summaryOf(page, lastKey);
  await summary.evaluate((element) => (element as HTMLElement).focus({ preventScroll: true }));
  await expect(summary).toBeFocused();
  const scrollBefore = await content.evaluate((element) => element.scrollTop);

  await page.keyboard.press("ArrowDown");

  await expect(summary).toBeFocused();
  expect(await content.evaluate((element) => element.scrollTop)).toBe(scrollBefore);
});

/** Review Focus 4: an empty section between two populated ones has no data row of
 *  its own to land on, so Down must skip straight past it. */
test("Down skips an empty instance section between two populated ones", async ({ page }) => {
  await stubIssues(page, [
    group(1, "Ridgeline", [ridgeIssues[0]!]),
    group(2, "EmptyCo", []),
    group(3, "Northwind", northwindIssues),
  ]);
  await stubPins(page);
  await page.goto("/today");
  await expect(page.getByText("No issues assigned.")).toBeVisible();

  await summaryOf(page, "RIDGE-1").focus();
  await page.keyboard.press("ArrowDown");
  await expect(summaryOf(page, "NW-1")).toBeFocused();
});

test("Down from a sort header does nothing — no header behaviour, no focus move", async ({
  page,
}) => {
  await gotoToday(page);

  const header = page.locator('that-table[sort-id="instance-1"] th.c-key');
  const headerButton = header.locator("button");
  await headerButton.focus();

  await page.keyboard.press("ArrowDown");

  await expect(headerButton).toBeFocused();
  await expect(header).toHaveAttribute("aria-sort", "none");
});

test("after a re-sort, Down still moves by the new order", async ({ page }) => {
  await gotoToday(page);
  const table = page.locator('that-table[sort-id="instance-1"]');

  // Ascending by key puts RIDGE-1 before RIDGE-2 already; descending reverses it,
  // so the row DOM order this checks is not the order the fixture happened to load in.
  await table.locator("th.c-key button").click();
  await table.locator("th.c-key button").click();
  await expect(table.locator("th.c-key")).toHaveAttribute("aria-sort", "descending");
  await expect
    .poll(() => table.locator("tbody > *").evaluateAll((rows) => rows.map((r) => r.getAttribute("key"))))
    .toEqual(["RIDGE-2", "RIDGE-1"]);

  await summaryOf(page, "RIDGE-2").focus();
  await page.keyboard.press("ArrowDown");
  await expect(summaryOf(page, "RIDGE-1")).toBeFocused();
});

test("after a pin, Down still moves by the new order", async ({ page }) => {
  await gotoToday(page);

  await pinOf(page, "RIDGE-2").click();
  await expect(page.locator('that-table[sort-id="pinned"] that-ticket-row[key="RIDGE-2"]')).toBeVisible();

  // Document order is now: Pinned (RIDGE-2), then Ridgeline's own card holding
  // only RIDGE-1, then Northwind.
  await summaryOf(page, "RIDGE-2").focus();
  await page.keyboard.press("ArrowDown");
  await expect(summaryOf(page, "RIDGE-1")).toBeFocused();
});
