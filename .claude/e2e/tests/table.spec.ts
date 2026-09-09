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
    // Both of them, or this is measuring something other than what it claims.
    if (!bodyRow || controls?.length !== 2) return null;

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
      json: [
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
