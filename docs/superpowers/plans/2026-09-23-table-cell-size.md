# Table body cells take the drawn 15px (#127) Implementation Plan

**Date:** 2026-09-23
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** The body cells of Today's tables and of Week's grid (body and totals row) compute the
drawing's 15px, while every child that carries its own drawn size keeps it.

**Architecture:** Two one-line changes. `.that-tbl td` in `web/src/styles.css` gains
`font-size: var(--text-lg)`. `gridTable()` in `web/src/week-grid.ts` swaps the table's
`text-base` for `text-lg/[1.5]`. The `/[1.5]` matters: Tailwind's bare `text-lg` also sets
`--text-lg--line-height` (≈1.556, 23.33px), while the drawing inherits the frame's 1.5 (22.5px).
Bare `text-lg` measured Week's totals row at 47.83px against the drawing's 47px; `text-lg/[1.5]`
keeps the line box the drawing has.

**Tech Stack:** CSS (Tailwind v4), TypeScript (strict), Playwright e2e.

**Spec:** Codeberg issue #127. Drawing: `docs/superpowers/prototypes/2026-09-03-app-prototype.html`
lines 107 (`.tbl td`), 214 (`.grid tbody td, th`), 220 (`.grid tfoot th, td`).

## Measured before any change (2026-09-23)

Rendered at 1600×1000; the prototype substituted into the brainstorming companion's
`frame-template.html` (standards mode), fonts served from the app's own woff2 files. Identical in
Firefox and Chromium.

| Row | App | Drawing (framed) |
|---|---|---|
| Today body row (hairline / last) | 46.33 / 45.83 px | 45.5 / 45 px |
| Week body row | 46 px | 46 px |
| Week totals row | 45.5 px | 47 px |
| Week cells font-size | 14px | 15px |
| Today non-status cell font-size | 14px | 15px |

With this plan's change the Week totals row measures 47px, matching. Today's row stays 46.33px:
its extra 0.83px comes from the summary's own `text-lg` (#95) bringing Tailwind's 23.33px line
height, not from the cell size. That is out of this ticket's scope (row heights) and is reported
as a finding rather than fixed here.

## Deviation found in execution

Task 1's GREEN run showed `.that-tbl td { font-size }` outranking the status cell's own `text-sm`
utility (`web/src/components/that-ticket-row.ts`), turning the status 15px. The drawing states the
status size on the table rule itself (`.tbl .c-status { font-size: 13px }`), so `styles.css` gains
the same: `.that-tbl .c-status { font-size: var(--text-sm); }`, placed with the cell rules.

## Global Constraints

- Docker only: run everything through `make` or `docker compose`; never `go`, `node` or `npm` bare.
- TypeScript `strict` + `noUncheckedIndexedAccess`; no `any`, `as any` or non-null assertions in `web/src`.
- Tailwind v4, theme values in `@theme` in `web/src/styles.css`; no new tokens needed.
- Browsers: Firefox and Chromium. No WebKit.
- Children keep their drawn sizes: key 13px, status 13px, Today's duration figure 14px, both header
  rows 12px.
- Commit unsigned (`git -c commit.gpgsign=false commit …`) if signing fails; never push.

---

### Task 1: Body cells compute 15px in both listing views

**Files:**
- Modify: `web/src/styles.css` (the `.that-tbl td` rule, around line 256)
- Modify: `web/src/week-grid.ts` (`gridTable()`, the `table.className` line, around line 108)
- Test: `.claude/e2e/tests/table.spec.ts` (append one test)
- Test: `.claude/e2e/tests/week.spec.ts` (add one test after the #117 "a body row is 46px…" test)

- [ ] **Step 1: Write the Today test.** Append to `.claude/e2e/tests/table.spec.ts`, using the
  file's own `stubIssues`, `group` and `ridgelineIssues`:

```ts
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
```

- [ ] **Step 2: Write the Week test.** Add to `.claude/e2e/tests/week.spec.ts` directly after the
  test named "a body row is 46px, a cell's trigger carries the drawn padding, and tfoot is padded
  12px", using the file's own `openWeek`, `rollup`, `row` and `THIS_WEEK`:

```ts
/**
 * #127: `.grid tbody td, .grid tbody th` and `.grid tfoot th, .grid tfoot td`
 * set 15px, and the figures inherit it. The line box stays the drawing's 1.5
 * rather than Tailwind's text-lg default, which the totals row's drawn 47px
 * height is what proves: the default's 23.33px line made it 47.83.
 */
test("body and totals cells compute the drawn 15px, and the totals row keeps the drawn 47px", async ({
  page,
}) => {
  await openWeek(page, {
    [THIS_WEEK]: rollup(THIS_WEEK, [
      row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "pushed" }]),
    ]),
  });
  await expect(page.locator("tbody tr")).toHaveCount(1);

  const sizes = await page.locator("table").first().evaluate((element) => {
    const size = (el: Element) => getComputedStyle(el).fontSize;
    return {
      cells: Array.from(element.querySelectorAll("tbody td, tbody th, tfoot td, tfoot th"), size),
      figures: Array.from(element.querySelectorAll("tbody td .font-mono, tfoot td"), size),
      keys: Array.from(element.querySelectorAll("tbody .that-key"), size),
      headers: Array.from(element.querySelectorAll("thead th"), size),
      footHeight: element.querySelector("tfoot tr")?.getBoundingClientRect().height ?? null,
    };
  });

  expect(sizes.cells.length).toBeGreaterThan(0);
  expect(new Set(sizes.cells)).toEqual(new Set(["15px"]));
  expect(new Set(sizes.figures)).toEqual(new Set(["15px"]));
  expect(new Set(sizes.keys)).toEqual(new Set(["13px"]));
  expect(new Set(sizes.headers)).toEqual(new Set(["12px"]));
  expect(sizes.footHeight).not.toBeNull();
  expect(Math.round(sizes.footHeight ?? 0)).toBe(47);
});
```

- [ ] **Step 3: Run both tests and watch them fail (RED).**

```shell
docker compose --profile e2e rm --stop --force app-e2e
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test table.spec.ts week.spec.ts -g "drawn 15px"'
docker compose --profile e2e rm --stop --force app-e2e
```

Expected: 4 failures (2 tests × Firefox, Chromium). Today: `cells` is `{"14px"}`. Week: `cells`
is `{"14px"}`. If any *other* assertion fails (a selector that matches nothing, a child size that
is not what the AC says), stop and report — do not adjust the expectation to fit.

- [ ] **Step 4: Make the change (GREEN).** In `web/src/styles.css`:

```css
.that-tbl td {
  padding-block: 11px;
  font-size: var(--text-lg);
}
```

Extend the comment block above `.that-tbl th, .that-tbl td` only if a sentence is needed; the
existing comments describe the rule set. In `web/src/week-grid.ts`, `gridTable()`:

```ts
  // that-tnum on the table, so every figure under it is tabular — figures that
  // sit above one another have to align or the column reads as noise. text-lg
  // with the 1.5 line the drawing inherits, not Tailwind's own text-lg line,
  // which makes the totals row 47.83px against the drawn 47.
  table.className = "that-tnum w-full text-lg/[1.5]";
```

- [ ] **Step 5: Run the two tests again (GREEN)**, same command as Step 3. Expected: 4 passed.

- [ ] **Step 6: Run the two whole spec files** (`npx playwright test table.spec.ts week.spec.ts`)
  so nothing else in either view moved (the #117 46px row and 12px padding tests in particular).

- [ ] **Step 7: Commit.**

```shell
git add web/src/styles.css web/src/week-grid.ts .claude/e2e/tests/table.spec.ts .claude/e2e/tests/week.spec.ts
git commit -m "Table body cells take the drawn 15px in both listing views (#127)"
```

With the session's attribution trailer lines.
