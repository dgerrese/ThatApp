import { expect, test, type Locator, type Page } from "@playwright/test";

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
  await page.route("**/api/entries**", (route) =>
    route.fulfill({ status: 200, json: { today: "2026-09-09", entries: [] } }),
  );
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
      // "tbody > *", not "tbody tr": a row is whatever the view puts in the
      // body, and Today's is a that-ticket-row wearing display: table-row.
      const bodyRow = table.querySelector("tbody > *");
      const bodyCells = bodyRow ? Array.from(bodyRow.children) : [];

      return headerCells.map((th, index) => ({
        column: th.className,
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
    // Every column but the status starts at the same x in both cards.
    //
    // The status is where two cards are allowed to differ, and the prototype
    // is what says so: line 102 sizes c-key, c-status, c-today and c-act to
    // their own content (`width: 1%; white-space: nowrap`), and its own two
    // cards, at lines 335 and 337, carry different status vocabularies — In
    // Progress / To Do / Blocked against In Review / To Do — so they do not
    // share that column's edge either. The design source ships the very thing
    // this line allows.
    //
    // What the summary giving ground buys is that the columns after the status
    // agree anyway, so two cards' duration figures and pin controls still line
    // up. Forcing the status to a shared width would take that space out of
    // the summary to align text nothing is read against.
    if (column.column === "c-status") continue;
    expect(Math.round(column.header)).toBe(Math.round(second[index]!.header));
  }
});

/**
 * Item 4, and the design's sentence about every control in these tables: each
 * "grew its padding and gave the space straight back as negative margin: the
 * hit area is larger and nothing moved". So a row holding both of them — the
 * duration trigger and the 34px pin control — is no taller than the same row
 * with nothing but its text. If a control pushed its row taller, two adjoining
 * cards would step out of line with each other exactly as items 1-3 above
 * guard against, just vertically instead of horizontally.
 *
 * Measured by taking both controls out of the flow and reading the row again,
 * which is the claim itself. Two earlier framings of it could not fail: the
 * first compared the row against the header row, which holds 13px text against
 * a body row's 15px summary and so is the shorter of the two whatever the
 * cells do (41 against 48); the second removed only the pin control, while the
 * duration trigger — which carried padding and no negative margin, and was
 * what made the row 48 — stayed in the flow through both measurements. With
 * the give-back in place the row measures 45.83 either way.
 */
test("a row holding controls is no taller than a row of text alone", async ({ page }) => {
  await stubIssues(page, [group(1, "Ridgeline", ridgelineIssues)]);
  await page.goto("/today");

  const table = page.locator("that-table table.that-tbl").first();
  await expect(table).toBeVisible();

  const heights = await table.evaluate((element) => {
    // See the note on the same selector above.
    const bodyRow = element.querySelector("tbody > *");
    const controls = bodyRow?.querySelectorAll<HTMLElement>(
      "td.c-today button, td.c-act button",
    );
    // The duration trigger, #8's timer button and the pin, or this is
    // measuring something other than what it claims.
    if (!bodyRow || controls?.length !== 3) return null;

    const withControls = bodyRow.getBoundingClientRect().height;
    for (const control of controls) control.style.display = "none";
    const textAlone = bodyRow.getBoundingClientRect().height;
    for (const control of controls) control.style.display = "";

    return { withControls, textAlone };
  });

  expect(heights).not.toBeNull();
  expect(heights!.withControls).toBeLessThanOrEqual(heights!.textAlone);
});

/**
 * #117's T1: `.tbl th` in the prototype (line 99) sets 12px/700/.06em
 * uppercase text and a 9px block padding, distinct from the body's 11px —
 * the two were one shared rule in styles.css before this, both hard-coded to
 * 11px with no type spec of their own beyond a hand-me-down text-sm/font-bold.
 */
test("a header cell wears the drawn type and its own 9px block padding", async ({ page }) => {
  await stubIssues(page, [group(1, "Ridgeline", ridgelineIssues)]);
  await page.goto("/today");

  const th = page.locator("that-table thead th").first();
  const button = th.locator("button");

  const type = await button.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      fontSize: parseFloat(computed.fontSize),
      fontWeight: computed.fontWeight,
      letterSpacing: parseFloat(computed.letterSpacing),
      textTransform: computed.textTransform,
    };
  });
  expect(type.fontSize).toBe(12);
  expect(type.fontWeight).toBe("700");
  // 0.06em against a 12px font-size.
  expect(type.letterSpacing).toBeCloseTo(0.72, 1);
  expect(type.textTransform).toBe("uppercase");

  const blockPadding = await th.evaluate((element) => {
    const computed = getComputedStyle(element);
    return { top: parseFloat(computed.paddingTop), bottom: parseFloat(computed.paddingBottom) };
  });
  expect(blockPadding.top).toBe(9);
  expect(blockPadding.bottom).toBe(9);
});

/** T2: `.tbl .c-today, .tbl th.c-today { text-align: right }` — a duration is
 *  compared by magnitude, not read as a word. */
test("the Today column is right-aligned, header and body", async ({ page }) => {
  await stubIssues(page, [group(1, "Ridgeline", ridgelineIssues)]);
  await page.goto("/today");

  const th = page.locator("that-table thead th.c-today").first();
  const td = page.locator("that-table tbody td.c-today").first();

  await expect(th).toHaveCSS("text-align", "right");
  await expect(td).toHaveCSS("text-align", "right");

  // text-align: right cannot be seen through `toHaveCSS` alone — it holds
  // whether or not it does anything, because it only moves an inline-level
  // box. Compare the header button's own bounding box against the column's:
  // a block-level button fills the column and sits flush left regardless of
  // the declared alignment, so only the box position catches that failure.
  const thBox = await th.boundingBox();
  const buttonBox = await th.locator("button").boundingBox();
  if (thBox === null || buttonBox === null) throw new Error("missing boundingBox");
  expect(Math.abs(buttonBox.x + buttonBox.width - (thBox.x + thBox.width))).toBeLessThan(1);
});

/**
 * R13 residual: the same defect T2 fixed in the header — a block-level `flex`
 * box fills width: 1%'s column and ignores `text-align: right` — was still
 * live one row down. The body's duration trigger (that-ticket-row.ts) carried
 * `flex` where the drawing's `.durbtn` is `display: inline-flex` (prototype
 * line 122).
 *
 * A single row can't discriminate this: with only one row, that row's own
 * content sets the column's width, so a block box that fills the column and
 * an inline box sized to its content land in the same place. The bug only
 * shows once a second row makes the column wider than the first row's own
 * figure — the trigger's own -mr-[13px] give-back (see the give-back comment
 * in that-ticket-row.ts) also means neither box sits flush with the td's
 * literal right edge, so the discriminating check is that every row's right
 * edge lands in the *same* place, not that it touches the td.
 */
test("the duration trigger's right edge does not move with its own figure's width", async ({
  page,
}) => {
  await stubIssues(page, [group(1, "Ridgeline", ridgelineIssues)]);
  await page.route("**/api/entries**", (route) =>
    route.fulfill({
      status: 200,
      json: {
        today: "2026-09-09",
        entries: [
          {
            id: 1,
            instanceId: 1,
            instanceName: "Ridgeline",
            instancePosition: 0,
            issueKey: ridgelineIssues[0]!.key,
            day: "2026-09-09",
            startedAt: "2026-09-09T09:00:00+02:00",
            seconds: 0,
            comment: "",
            pushState: "unpushed",
          },
          {
            id: 2,
            instanceId: 1,
            instanceName: "Ridgeline",
            instancePosition: 0,
            issueKey: ridgelineIssues[1]!.key,
            day: "2026-09-09",
            startedAt: "2026-09-09T10:00:00+02:00",
            seconds: 36000,
            comment: "",
            pushState: "unpushed",
          },
        ],
      },
    }),
  );
  await page.goto("/today");

  const rows = page.locator("that-table tbody > *");
  await expect(rows).toHaveCount(2);

  const rights = await rows.evaluateAll((elements) =>
    elements.map((row) => row.querySelector("td.c-today button")!.getBoundingClientRect().right),
  );
  expect(rights).toHaveLength(2);
  expect(Math.abs(rights[0]! - rights[1]!)).toBeLessThan(1);
});

/** T8: the sort chevron carries opacity: .45 at rest. There is no sorted
 *  column yet (#83's), so every chevron on screen must show it. */
test("the sort chevron carries opacity .45 at rest", async ({ page }) => {
  await stubIssues(page, [group(1, "Ridgeline", ridgelineIssues)]);
  await page.goto("/today");

  const chevron = page.locator("that-table thead th button svg").first();
  await expect(chevron).toHaveCSS("opacity", "0.45");
});

/**
 * T9: `.durbtn .hint { margin-right: 10px }` and nothing else between hint
 * and figure. The trigger used to also carry a flex gap, which stacked an
 * extra 6px onto the hint's own margin.
 */
test("the duration trigger's hint keeps only its own margin between it and the figure", async ({
  page,
}) => {
  await stubIssues(page, [group(1, "Ridgeline", ridgelineIssues)]);
  await page.goto("/today");

  const trigger = page.locator("that-ticket-row td.c-today button").first();
  const spacing = await trigger.evaluate((button) => {
    const hint = button.querySelector("span") as HTMLElement;
    return {
      hintMarginRight: getComputedStyle(hint).marginRight,
      gap: getComputedStyle(button).columnGap,
    };
  });

  expect(spacing.hintMarginRight).toBe("10px");
  expect(spacing.gap).toBe("normal");
});

/**
 * T11: `.tcard { padding: 14px 20px }` — the app's `px-5 py-4` shipped 16px
 * block padding instead. The correction lives in card-surface.ts, shared by
 * `that-card` and `that-table`; this checks the table's own surface.
 */
test("the table card's own padding is 20px inline and 14px block", async ({ page }) => {
  await stubIssues(page, [group(1, "Ridgeline", ridgelineIssues)]);
  await page.goto("/today");

  const card = page.locator("that-table").first();
  const padding = await card.evaluate((element) => {
    const computed = getComputedStyle(element);
    return { top: parseFloat(computed.paddingTop), left: parseFloat(computed.paddingLeft) };
  });

  expect(padding.top).toBe(14);
  expect(padding.left).toBe(20);
});

/**
 * #83's own tests: a `that-table` sorts itself and remembers it per table.
 *
 * One instance of four issues whose key, summary, status and logged time
 * each put the rows in a different order — see the comment on
 * `sortableIssues` for the four orders this fixture proves — plus two pinned
 * issues so the Pinned table has an order of its own to leave alone.
 */
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

const SORT_DAY = "2026-09-09";

function stubEntry(id: number, issueKey: string, seconds: number): StubEntry {
  return {
    id,
    instanceId: 1,
    instanceName: "Ridgeline",
    instancePosition: 0,
    issueKey,
    day: SORT_DAY,
    startedAt: `${SORT_DAY}T09:00:00+02:00`,
    seconds,
    comment: "",
    pushState: "unpushed",
  };
}

/**
 * Answers GET from a mutable list and appends whatever a POST sends. Needed
 * (rather than the beforeEach's fixed, empty stub) only by the test that logs
 * more time mid-test and expects a live re-sort, not a reload — the other
 * sort tests would be just as well served by the plain stub.
 */
async function stubSortableEntries(page: Page, seed: StubEntry[]): Promise<void> {
  const entries = [...seed];
  let nextId = 900;

  await page.route("**/api/entries**", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      const created = stubEntry(nextId, String(body["issueKey"]), Number(body["seconds"]));
      nextId += 1;
      entries.push(created);
      await route.fulfill({ status: 201, json: created });

      return;
    }

    await route.fulfill({ status: 200, json: { today: SORT_DAY, entries } });
  });
}

async function stubSortablePins(page: Page): Promise<void> {
  await page.route("**/api/pins**", (route) =>
    route.fulfill({
      status: 200,
      json: [
        {
          id: 501,
          instanceId: 1,
          instanceName: "Ridgeline",
          instancePosition: 0,
          key: "RIDGE-50",
          summary: "Pinned Bravo",
          status: "To Do",
          url: "https://ridgeline.atlassian.net/browse/RIDGE-50",
          error: null,
        },
        {
          id: 502,
          instanceId: 1,
          instanceName: "Ridgeline",
          instancePosition: 0,
          key: "RIDGE-60",
          summary: "Pinned Alpha",
          status: "Blocked",
          url: "https://ridgeline.atlassian.net/browse/RIDGE-60",
          error: null,
        },
      ],
    }),
  );
}

/**
 * Jira's own order (arrival order) is `RIDGE-20, RIDGE-3, RIDGE-100,
 * RIDGE-9` — none of Key (numeric: 3, 9, 20, 100), Summary (Alpha, Mango,
 * Yankee, Zebra), Status (Blocked, In Progress, In Review, To Do) or Today
 * (1800s, 3600s, 60s, 300s) agree with it or with each other, so every sort
 * this suite exercises lands the four rows in a distinct, checkable order.
 */
const sortableIssues: StubIssue[] = [
  {
    key: "RIDGE-20",
    summary: "Zebra work item",
    status: "To Do",
    url: "https://ridgeline.atlassian.net/browse/RIDGE-20",
  },
  {
    key: "RIDGE-3",
    summary: "Alpha work item",
    status: "Blocked",
    url: "https://ridgeline.atlassian.net/browse/RIDGE-3",
  },
  {
    key: "RIDGE-100",
    summary: "Mango work item",
    status: "In Progress",
    url: "https://ridgeline.atlassian.net/browse/RIDGE-100",
  },
  {
    key: "RIDGE-9",
    summary: "Yankee work item",
    status: "In Review",
    url: "https://ridgeline.atlassian.net/browse/RIDGE-9",
  },
];

const sortableEntries: StubEntry[] = [
  stubEntry(1, "RIDGE-20", 300),
  stubEntry(2, "RIDGE-3", 1800),
  stubEntry(3, "RIDGE-100", 60),
  stubEntry(4, "RIDGE-9", 3600),
];

async function gotoSortableToday(page: Page): Promise<void> {
  await stubIssues(page, [group(1, "Ridgeline", sortableIssues)]);
  await stubSortablePins(page);
  await stubSortableEntries(page, sortableEntries);
  await page.goto("/today");
}

/** `sort-id` (Task 2 step 4) is what makes each card's table addressable and
 *  what its remembered state is keyed by, so tests locate a table by it
 *  rather than by position. */
function instanceTable(page: Page): Locator {
  return page.locator('that-table[sort-id="instance-1"]');
}

function pinnedTable(page: Page): Locator {
  return page.locator('that-table[sort-id="pinned"]');
}

async function rowKeys(table: Locator): Promise<string[]> {
  return table
    .locator("tbody > *")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("key") ?? ""));
}

function logTrigger(page: Page, key: string): Locator {
  return page.getByRole("button", { name: new RegExp(`Log time against ${key}`) });
}

function entryDialog(page: Page): Locator {
  return page.locator("that-entry-dialog dialog");
}

async function typeDuration(page: Page, typed: string): Promise<void> {
  const field = entryDialog(page).getByLabel("Duration");
  await field.fill(typed);
  await field.press("Enter");
}

test("clicking Key cycles ascending, descending, then Jira's own order", async ({ page }) => {
  await gotoSortableToday(page);
  const table = instanceTable(page);
  await expect(table.locator("tbody > *")).toHaveCount(4);

  await expect.poll(() => rowKeys(table)).toEqual(["RIDGE-20", "RIDGE-3", "RIDGE-100", "RIDGE-9"]);

  const keyHeader = table.locator("th.c-key");
  await keyHeader.locator("button").click();
  await expect.poll(() => rowKeys(table)).toEqual(["RIDGE-3", "RIDGE-9", "RIDGE-20", "RIDGE-100"]);
  await expect(keyHeader).toHaveAttribute("aria-sort", "ascending");

  await keyHeader.locator("button").click();
  await expect.poll(() => rowKeys(table)).toEqual(["RIDGE-100", "RIDGE-20", "RIDGE-9", "RIDGE-3"]);
  await expect(keyHeader).toHaveAttribute("aria-sort", "descending");

  await keyHeader.locator("button").click();
  await expect.poll(() => rowKeys(table)).toEqual(["RIDGE-20", "RIDGE-3", "RIDGE-100", "RIDGE-9"]);
  await expect(keyHeader).toHaveAttribute("aria-sort", "none");
});

test("clicking Today on the instance card puts the most time first, and leaves Pinned's own order alone", async ({
  page,
}) => {
  await gotoSortableToday(page);
  const table = instanceTable(page);
  const pinned = pinnedTable(page);
  await expect(table.locator("tbody > *")).toHaveCount(4);
  await expect(pinned.locator("tbody > *")).toHaveCount(2);

  const pinnedBefore = await rowKeys(pinned);
  expect(pinnedBefore).toEqual(["RIDGE-50", "RIDGE-60"]);

  await table.locator("th.c-today button").click();

  await expect.poll(() => rowKeys(table)).toEqual(["RIDGE-9", "RIDGE-3", "RIDGE-20", "RIDGE-100"]);
  await expect(table.locator("th.c-today")).toHaveAttribute("aria-sort", "descending");
  expect(await rowKeys(pinned)).toEqual(pinnedBefore);
});

test("a sorted table survives a reload, same order and same header state", async ({ page }) => {
  await gotoSortableToday(page);
  const table = instanceTable(page);

  await table.locator("th.c-status button").click();
  await expect
    .poll(() => rowKeys(table))
    .toEqual(["RIDGE-3", "RIDGE-100", "RIDGE-9", "RIDGE-20"]);
  await expect(table.locator("th.c-status")).toHaveAttribute("aria-sort", "ascending");

  await page.goto("/today");
  const reloaded = instanceTable(page);
  await expect(reloaded.locator("tbody > *")).toHaveCount(4);
  await expect
    .poll(() => rowKeys(reloaded))
    .toEqual(["RIDGE-3", "RIDGE-100", "RIDGE-9", "RIDGE-20"]);
  await expect(reloaded.locator("th.c-status")).toHaveAttribute("aria-sort", "ascending");
});

test("logging time against a row re-sorts a table sorted by Today", async ({ page }) => {
  await gotoSortableToday(page);
  const table = instanceTable(page);

  await table.locator("th.c-today button").click();
  await expect.poll(() => rowKeys(table)).toEqual(["RIDGE-9", "RIDGE-3", "RIDGE-20", "RIDGE-100"]);

  // RIDGE-100 is last at 0:01 (60s); two more hours puts it ahead of
  // RIDGE-9's 1:00 (3600s) without touching any other row's total.
  const trigger = logTrigger(page, "RIDGE-100");
  await trigger.click();
  await typeDuration(page, "200");
  await entryDialog(page).getByRole("button", { name: "Add entry" }).click();

  await expect
    .poll(() => rowKeys(table))
    .toEqual(["RIDGE-100", "RIDGE-9", "RIDGE-3", "RIDGE-20"]);

  // "Add entry" leaves the dialog open (so another entry can follow) — same
  // as entries.spec.ts's own tests, Escape is what closes it. The native
  // <dialog> then returns focus to whatever opened it — this row's own
  // trigger. That return target only survives if the row that moved
  // (RIDGE-100 jumped from last to first, via moveBefore) is the same
  // element, not a rebuilt one: pins down return focus surviving the
  // re-sort this same action just caused, the moveBefore path this time
  // rather than the header-click path the earlier focus test covers.
  await page.keyboard.press("Escape");
  await expect(entryDialog(page)).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("with localStorage throwing, the page loads in Jira's order and sorting still works in-page", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("storage disabled");
    };
    Storage.prototype.setItem = () => {
      throw new Error("storage disabled");
    };
  });

  await gotoSortableToday(page);
  const table = instanceTable(page);
  await expect(table.locator("tbody > *")).toHaveCount(4);
  await expect.poll(() => rowKeys(table)).toEqual(["RIDGE-20", "RIDGE-3", "RIDGE-100", "RIDGE-9"]);

  await table.locator("th.c-key button").click();
  await expect.poll(() => rowKeys(table)).toEqual(["RIDGE-3", "RIDGE-9", "RIDGE-20", "RIDGE-100"]);
  await expect(table.locator("th.c-key")).toHaveAttribute("aria-sort", "ascending");
});

/**
 * #127: the drawing's `.tbl td` sets 15px on the cell itself, so a cell's own
 * line box is 15px too. The status cell is the one that carries its own drawn
 * size (`.tbl .c-status`, 13px), and the key, the duration figure and the
 * header labels keep theirs on their own elements.
 */
test("a body cell computes the drawn 15px, and the children with their own drawn size keep it", async ({
  page,
}) => {
  await stubIssues(page, [group(1, "Ridgeline", ridgelineIssues)]);
  await page.goto("/today");

  const table = page.locator("that-table table.that-tbl").first();
  await expect(table.locator("tbody > *")).toHaveCount(2);

  const sizes = await table.evaluate((element) => {
    const size = (el: Element) => getComputedStyle(el).fontSize;
    return {
      cells: Array.from(element.querySelectorAll("tbody td:not(.c-status)"), size),
      statuses: Array.from(element.querySelectorAll("tbody td.c-status"), size),
      keys: Array.from(element.querySelectorAll("tbody .c-key .that-key"), size),
      figures: Array.from(element.querySelectorAll("tbody .c-today .font-mono"), size),
      headers: Array.from(element.querySelectorAll("thead th button"), size),
    };
  });

  expect(sizes.cells.length).toBeGreaterThan(0);
  expect(new Set(sizes.cells)).toEqual(new Set(["15px"]));
  expect(new Set(sizes.statuses)).toEqual(new Set(["13px"]));
  expect(new Set(sizes.keys)).toEqual(new Set(["13px"]));
  expect(new Set(sizes.figures)).toEqual(new Set(["14px"]));
  expect(new Set(sizes.headers)).toEqual(new Set(["12px"]));
});

/**
 * A row moved during a re-sort is the same element, not a rebuilt one — the
 * brief's own requirement. `append`/`insertBefore` on an already-connected
 * custom element fires disconnectedCallback then connectedCallback, and
 * that-ticket-row's connectedCallback rebuilds every cell unconditionally,
 * which would drop this focus regardless of the element staying in the DOM.
 * `that-table` moves rows with `moveBefore` instead, and that-ticket-row
 * opts out of the rebuild with its own `connectedMoveCallback` no-op.
 *
 * The header is clicked via `dispatchEvent`, not a real `.click()` — same
 * reasoning as today.spec.ts's "Refresh leaves an open dialog … alone": a
 * genuine pointer click would move focus to the header button itself, which
 * would pass this test even with the rebuild bug this guards against.
 */
test("re-sorting moves a row without stealing focus from its own controls", async ({ page }) => {
  await gotoSortableToday(page);
  const table = instanceTable(page);

  const trigger = logTrigger(page, "RIDGE-100");
  await trigger.focus();
  await expect(trigger).toBeFocused();

  await table.locator("th.c-key button").dispatchEvent("click");
  await expect.poll(() => rowKeys(table)).toEqual(["RIDGE-3", "RIDGE-9", "RIDGE-20", "RIDGE-100"]);
  await expect(trigger).toBeFocused();

  await table.locator("th.c-key button").dispatchEvent("click");
  await expect.poll(() => rowKeys(table)).toEqual(["RIDGE-100", "RIDGE-20", "RIDGE-9", "RIDGE-3"]);
  await expect(trigger).toBeFocused();
});

/**
 * Fix round 1: `moveBefore` shipped in Firefox 144 and Chrome 133, but the
 * owner's Firefox channel is not guaranteed to be past ESR 140, which lacks
 * it. Deletes it from wherever the engine actually defines it (Element's
 * prototype in both Firefox and Chromium, checked directly; Node's checked
 * too, in case that ever changes) so this runs against the same absence a
 * real ESR browser would present, not a simulation of one.
 *
 * Fix round 2: the two header clicks alone only prove that further clicks
 * keep working — a click always calls applyState() directly and would
 * "work" even with an observer left permanently disconnected. The log-time
 * step at the end is what actually exercises the observer: it re-sorts from
 * an attribute mutation, not a click, so it only passes if try/finally in
 * sortBody() really did reconnect the observer after the fallback reorder
 * the two clicks above already triggered.
 */
test("sorting still works when the engine has no moveBefore", async ({ page }) => {
  await page.addInitScript(() => {
    for (const proto of [Element.prototype, Node.prototype]) {
      if (Object.prototype.hasOwnProperty.call(proto, "moveBefore")) {
        delete (proto as unknown as Record<string, unknown>)["moveBefore"];
      }
    }
  });

  await gotoSortableToday(page);
  const table = instanceTable(page);
  await expect(table.locator("tbody > *")).toHaveCount(4);
  await expect.poll(() => rowKeys(table)).toEqual(["RIDGE-20", "RIDGE-3", "RIDGE-100", "RIDGE-9"]);

  await table.locator("th.c-key button").click();
  await expect.poll(() => rowKeys(table)).toEqual(["RIDGE-3", "RIDGE-9", "RIDGE-20", "RIDGE-100"]);
  await expect(table.locator("th.c-key")).toHaveAttribute("aria-sort", "ascending");

  // The table must keep working afterwards too — the whole point of the
  // try/finally around reorder() is that one throwing move must not leave
  // the observer disconnected and the table stuck sorting nothing further.
  await table.locator("th.c-key button").click();
  await expect.poll(() => rowKeys(table)).toEqual(["RIDGE-100", "RIDGE-20", "RIDGE-9", "RIDGE-3"]);
  await expect(table.locator("th.c-key")).toHaveAttribute("aria-sort", "descending");

  // Now the observer-driven path, still under the fallback: sort by Today,
  // then log time against the last row and let the resulting attribute
  // change (not a click) drive the reorder.
  await table.locator("th.c-today button").click();
  await expect.poll(() => rowKeys(table)).toEqual(["RIDGE-9", "RIDGE-3", "RIDGE-20", "RIDGE-100"]);

  await logTrigger(page, "RIDGE-100").click();
  await typeDuration(page, "200");
  await entryDialog(page).getByRole("button", { name: "Add entry" }).click();

  await expect
    .poll(() => rowKeys(table))
    .toEqual(["RIDGE-100", "RIDGE-9", "RIDGE-3", "RIDGE-20"]);
});

/**
 * Item 1 of the review's final wave: `subtree: true` on the body's own
 * observer is what lets a row's `seconds` change reach it without Today
 * wiring anything per row — but it also reaches every change *inside* a
 * row, including that-ticket-row's own re-render for an attribute this
 * table does not sort by (`url`, here — soon #8's per-second timer tick in
 * the Today cell too). `isOwnRowChange` is what keeps that from queuing a
 * sort pass: only a row arriving/leaving directly under `body`, or one of
 * the four sort-relevant attributes changing directly on a row, counts.
 * Exercises the excluded case directly (a row rebuilding itself without a
 * sort-relevant attribute changing) and confirms the sort survives it
 * untouched, then that the observer is still alive by triggering a real
 * resort right after.
 */
test("a row's own re-render for an attribute this table does not sort by leaves an existing sort untouched", async ({
  page,
}) => {
  await gotoSortableToday(page);
  const table = instanceTable(page);

  await table.locator("th.c-key button").click();
  await expect.poll(() => rowKeys(table)).toEqual(["RIDGE-3", "RIDGE-9", "RIDGE-20", "RIDGE-100"]);

  await table.evaluate(() => {
    const row = document.querySelector('that-ticket-row[key="RIDGE-9"]');
    // `url` is observed by that-ticket-row (it falls through to a full
    // render()) but not by that-table (OBSERVED_ROW_ATTRIBUTES omits it) —
    // the row rebuilds itself with nothing this table sorts by having
    // changed.
    row?.setAttribute("url", "https://ridgeline.atlassian.net/browse/RIDGE-9-moved");
  });

  await expect.poll(() => rowKeys(table)).toEqual(["RIDGE-3", "RIDGE-9", "RIDGE-20", "RIDGE-100"]);
  await expect(table.locator("th.c-key")).toHaveAttribute("aria-sort", "ascending");

  // Alive, not merely quiet: a real resort still works right after.
  await table.locator("th.c-key button").click();
  await expect.poll(() => rowKeys(table)).toEqual(["RIDGE-100", "RIDGE-20", "RIDGE-9", "RIDGE-3"]);
});
