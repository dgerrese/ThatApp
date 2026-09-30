# Week's footer marks use the app's tooltip (#231) Implementation Plan

**Date:** 2026-09-29
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A push mark on Week's footer day totals names its state in a `that-tooltip` on hover and on keyboard focus, and to a screen reader through its own `aria-label`, instead of a native `title`.

**Architecture:** `dayTotal()` in `web/src/week-grid.ts` gives its mark the entry dialog's `pushMark` shape (`web/src/components/that-entry-dialog.ts`): an `id` unique across the page (a module counter, like `weekCellSequence`), `tabIndex = 0`, `role="img"`, `aria-label` = the state's words, and a sibling `that-tooltip for=<id>` carrying the same words. The `title` and the `sr-only` words span go. The footer is not a `tbody tr`, so `enableRowArrowKeys` (`web/src/table-keys.ts`) never sees it. The prototype's `tfoot` marks get the same shape and the `.tip` the rest of the drawing uses.

**Tech Stack:** TypeScript (vanilla, happy-dom unit tests under `node --test`), Playwright e2e, the HTML prototype.

**Spec:** Codeberg issue #231 (body; it has no comments, so nothing overrides it). The drawing: `docs/superpowers/prototypes/2026-09-03-app-prototype.html` (Week's `tfoot`, line ~456; `.dmark` line ~241; `.tip` lines ~167–172; the entry dialog's `.estate` mark line ~293–294 and ~656, which is the shape this copies). The visual language: `docs/superpowers/specs/2026-09-03-visual-language-design.md`, *Decision 7 — a tooltip lives in the top layer* (line ~439): a tooltip is never the accessible name.

## Global Constraints

- All commands through `make` or `docker compose`; no Go, Node or npm on the host.
- Vanilla TS, no frameworks; `strict` with `noUncheckedIndexedAccess`; no `any`, no `as any`, no non-null assertion (`!`).
- **Keyboard-focus tests never use `.focus()` on the element under test** (#217): focus the element *before* it, move the pointer to `(0, 0)`, press a real `Tab`, assert `toBeFocused()`, then assert the tooltip.
- A tooltip is never the accessible name: the mark carries its own `aria-label`; the tooltip adds nothing to the accessibility tree.
- The words are `PUSH_MARKS`' own (`web/src/push-marks.ts`): "not pushed", "edited since it was pushed", "push failed". No new strings.
- Out of scope: the cell marks (their button's tooltip covers them), arrow-key movement into the footer, the instance dots' `title` (#259).
- Firefox and Chromium both run every e2e test. No WebKit.
- Screenshots and any capture spec or framed prototype are never committed.

## Review Focus

1. **Ids stay unique across remounts.** Week navigation rebuilds the grid; a repeated id would bind a new tooltip to a stale or wrong trigger (`getElementById` returns the first). Pinned by Task 1's unit test that renders two grids and compares the mark ids.
2. **One real `Tab` from the last body row's Sunday cell lands on Monday's footer mark in both browsers** (nothing focusable sits between them — the row total is inert), and `Shift+Tab` back hides the tooltip. Pinned by Task 1's keyboard e2e test.
3. **Up and Down never cross the tbody/tfoot boundary**: ArrowUp on a footer mark leaves focus there; ArrowDown on the last body row with a *marked* footer below it leaves focus on the cell (the existing table-keys test only covers an unmarked footer). Pinned by the same e2e test.
4. **A screen reader hears the state once**: no `sr-only` span in `tfoot`, no `title`, and the tooltip is hidden (`popover`, not open) at rest, so the only source is the mark's `aria-label`. Pinned by Task 1's unit and hover e2e tests.
5. **The focused 7px mark is visibly focused** in both themes (the browser's own focus ring; no rule in `web/src/styles.css` removes it). Checked by eye on Task 2's screenshots; if no ring is visible in either theme, report it to the owner as a finding — do not invent a ring style.

---

### Task 1: The footer mark becomes a named tab stop with the app's tooltip

**Files:**
- Modify: `web/src/week-grid.ts` — `dayTotal()` (~line 384), the `markerFor` doc comment (~line 231–245, "through the marker's title"), a new `weekDayMarkSequence` counter beside `weekCellSequence` (~line 263)
- Test: `web/src/week-grid.test.ts` — the two footer assertions (~lines 140–159 and ~192–197)
- Test: `.claude/e2e/tests/week.spec.ts` — the `.dmark` rule test (~line 1553–1563: its locator), a stale comment (~line 1797–1799), two new tests after the `.dmark` test

**Interfaces:**
- Consumes: `markerFor(pushState, failed): { className; words } | undefined`, `FOOT_MARKER`, `totalFigure` — all already in `week-grid.ts`; `that-tooltip` (`for`, text content).
- Produces: in each marked footer `td`, a `span` with `id="that-week-day-mark-<n>"`, `tabindex="0"`, `role="img"`, `aria-label=<words>`, classes `${FOOT_MARKER} ${marker.className}`, followed by `<that-tooltip for="that-week-day-mark-<n>">words</that-tooltip>`, then the figure text. Task 2's capture spec locates the mark by `tfoot td` → `getByRole("img", { name })`.

- [ ] **Step 1: Write the failing unit tests.** In `web/src/week-grid.test.ts`, replace the test *"a day total wears its day's marker, named for a reader who cannot see it"* with:

```ts
test("a day total's mark is a tab stop named for its state, with the app's tooltip saying the same", () => {
  const unpushedMonday = (): WeekRollup =>
    rollup([row({ byDay: { 0: { seconds: 3600, pushState: "unpushed" } } })], {
      0: { pushState: "unpushed" },
    });
  const monday = footCells(weekGrid(unpushedMonday(), noFailures(), noop))[0];
  const mark = monday?.querySelector<HTMLElement>("[role='img']");

  assert.equal(mark?.getAttribute("aria-label"), "not pushed");
  assert.equal(mark?.tabIndex, 0);
  assert.equal(mark?.hasAttribute("title"), false, "the mark still carries a native title");
  assert.ok(mark?.classList.contains("size-[7px]"), "day total's marker is not 7px");
  assert.equal(monday?.querySelector(".sr-only"), null, "the sr-only words would be heard twice");

  const tooltip = monday?.querySelector("that-tooltip");
  assert.ok(mark?.id, "the mark has no id for its tooltip to find");
  assert.equal(tooltip?.getAttribute("for"), mark?.id);
  assert.equal(tooltip?.textContent, "not pushed");

  // Week navigation rebuilds the grid: a second mount must not reuse the id.
  const again = footCells(weekGrid(unpushedMonday(), noFailures(), noop))[0]?.querySelector("[role='img']");
  assert.notEqual(again?.id, mark?.id);
});
```

  (`WeekRollup` is already imported.) In *"a failed push marks its own cell and day, outranking the rollup's state"*, replace the `tuesday` assertion (the one reading `getAttribute("title")`) with:

```ts
  const tuesday = footCells(grid)[1];
  assert.equal(tuesday?.querySelector("[role='img']")?.getAttribute("aria-label"), "push failed");
  assert.equal(tuesday?.querySelector("that-tooltip")?.textContent, "push failed");
```

- [ ] **Step 2: Run them; they fail.**

  Run: `docker compose run --build --rm --no-deps web node --test src/week-grid.test.ts`
  Expected: FAIL — no `[role='img']` in the footer (the mark is `aria-hidden` with a `title`).

- [ ] **Step 3: Implement.** In `web/src/week-grid.ts`, beside `let weekCellSequence = 0;` add:

```ts
/** A footer mark's id, unique across the page for the same reason as weekCellSequence. */
let weekDayMarkSequence = 0;
```

  Replace the `if (marker) { … }` block in `dayTotal()` with:

```ts
  const marker = markerFor(day.pushState, failed);
  if (marker) {
    // The entry dialog's pushMark shape: the mark is the only thing here
    // carrying the state, so it is a named tab stop and the tooltip only
    // shows what the label already says (#231, replacing a native title).
    const mark = document.createElement("span");
    mark.id = `that-week-day-mark-${String(++weekDayMarkSequence)}`;
    mark.tabIndex = 0;
    mark.setAttribute("role", "img");
    mark.setAttribute("aria-label", marker.words);
    mark.className = `${FOOT_MARKER} ${marker.className}`;

    const tooltip = document.createElement("that-tooltip");
    tooltip.setAttribute("for", mark.id);
    tooltip.textContent = marker.words;

    td.append(mark, tooltip);
  }
```

  Update `dayTotal`'s doc comment ("never a control") to say the total is not a control but its mark is a tab stop, so a keyboard reader reaches the tooltip. In `markerFor`'s doc comment replace "and — through the marker's title — what a reader who can see it has" with "and — through a footer mark's tooltip or a cell's own — what a reader who can see it has".

- [ ] **Step 4: Run the unit tests; they pass.**

  Run: `docker compose run --build --rm --no-deps web node --test src/week-grid.test.ts`
  Expected: PASS, 0 failures.

- [ ] **Step 5: Write the e2e tests.** In `.claude/e2e/tests/week.spec.ts`:

  (a) In *"the footer's day-total mark keeps its own rule"*, change the locator to `page.locator("tfoot td").first().getByRole("img", { name: "not pushed" })` — the mark is no longer `aria-hidden`.

  (b) In the comment at ~line 1797 ("a worst-wins marker and the sr-only words beside it"), replace "the sr-only words beside it" with "its tooltip".

  (c) After the `.dmark` test, add:

```ts
/**
 * #231: a footer day total's mark names its state in the app's own tooltip —
 * the owner ruled in #143 that a native title no longer fits — and to a
 * screen reader through its aria-label alone, so the state is heard once.
 */
test("a footer day total's mark shows its state in a tooltip on hover, never a title", async ({
  page,
}) => {
  await openWeek(page, {
    [THIS_WEEK]: rollup(THIS_WEEK, [
      row("RIDGE-1", [
        { at: 0, seconds: 3600, pushState: "unpushed" },
        { at: 1, seconds: 1800, pushState: "dirty" },
      ]),
    ]),
  });

  await expect(page.locator("tfoot .sr-only")).toHaveCount(0);

  for (const [column, words] of [
    [0, "not pushed"],
    [1, "edited since it was pushed"],
  ] as const) {
    const mark = page.locator("tfoot td").nth(column).getByRole("img", { name: words });
    await expect(mark).toBeVisible();
    await expect(mark).not.toHaveAttribute("title");

    const tooltip = page.locator(`that-tooltip[for="${(await mark.getAttribute("id")) ?? ""}"]`);
    await expect(tooltip).toBeHidden();
    await mark.hover();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveText(words);
    await page.mouse.move(0, 0);
    await expect(tooltip).toBeHidden();
  }
});

/**
 * #231: the mark is a Tab stop straight after the last row's Sunday cell —
 * the row total between them is inert — and its tooltip opens on that real
 * key press. The footer is outside `tbody tr`, so Up and Down neither leave
 * it nor enter it (#227's rows are unchanged).
 */
test("a real Tab reaches a footer mark and opens its tooltip; Up and Down stay put", async ({
  page,
}) => {
  await openWeek(page, {
    [THIS_WEEK]: rollup(THIS_WEEK, [
      row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "unpushed" }]),
    ]),
  });

  const sunday = ticketRow(page, "RIDGE-1").locator("td button").nth(6);
  const mark = page.locator("tfoot td").first().getByRole("img", { name: "not pushed" });
  await expect(mark).toBeVisible();
  const tooltip = page.locator(`that-tooltip[for="${(await mark.getAttribute("id")) ?? ""}"]`);

  await sunday.focus();
  await page.mouse.move(0, 0);
  await page.keyboard.press("Tab");
  await expect(mark).toBeFocused();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveText("not pushed");

  await page.keyboard.press("ArrowUp");
  await expect(mark).toBeFocused();

  await page.keyboard.press("Shift+Tab");
  await expect(sunday).toBeFocused();
  await expect(tooltip).toBeHidden();

  await page.keyboard.press("ArrowDown");
  await expect(sunday).toBeFocused();
});
```

- [ ] **Step 6: Prove the keyboard test can fail.** Temporarily comment out `mark.tabIndex = 0;` in `week-grid.ts`, run the two new tests, see the keyboard one fail on `toBeFocused()`; restore the line. (Review Focus 2.)

  Run: `docker compose --profile e2e rm --stop --force app-e2e; docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/week.spec.ts -g "footer"'; docker compose --profile e2e rm --stop --force app-e2e`
  Expected with the line commented out: the keyboard test FAILS in both projects. With it restored: all `footer` tests PASS in firefox and chromium.

- [ ] **Step 7: Gates.** `make verify` (lint, tsc, Go and web unit tests) green; `make test-e2e` with 0 failed. Paste both outputs' summaries into the task report.

- [ ] **Step 8: Commit.**

```bash
git add web/src/week-grid.ts web/src/week-grid.test.ts .claude/e2e/tests/week.spec.ts
git commit -m "Week's footer marks name their state in the app's tooltip, not a native title (#231)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LSFNGKuFZChTpQMJ5cQuAH"
```

  If signing fails, retry the same commit with `git -c commit.gpgsign=false commit …` and say so. Never push.

---

### Task 2: The drawing matches, compared, and the screenshots for the pull request

**Files:**
- Modify: `docs/superpowers/prototypes/2026-09-03-app-prototype.html` — `.dmark` (~line 241), the tooltip reveal rules (~lines 171–172), Week's `tfoot` (~line 456)
- Throwaway (never committed, deleted at the end): `.claude/e2e/proto-231.html`, `.claude/e2e/tests/shots-231.spec.ts`

**Interfaces:**
- Consumes: Task 1's footer mark (`tfoot td` → `getByRole("img", { name: "not pushed" })`, its `that-tooltip[for=<id>]`).
- Produces: `footer-mark-tooltip-keyboard-dark.png`, `footer-mark-tooltip-keyboard-light.png` in the executing session's scratchpad directory under `shots231/`, for `.claude/tools/pr-attach.sh` when the PR is opened. Nothing in the repository.

- [ ] **Step 1: Update the prototype.** The file is a fragment — do not add a doctype. On `.dmark` (line ~241) add `position: relative;`. Extend the reveal rule at ~line 172 with `.dmark:hover .tip, .dmark:focus-visible .tip` (append to the selector list before `{ opacity: 1; }`). In Week's `tfoot` (line ~456) replace each of the three marks:

```html
<i class="m-unpushed dmark" title="not pushed"></i>
```
  becomes
```html
<i class="m-unpushed dmark" tabindex="0" role="img" aria-label="not pushed"><span class="tip">not pushed</span></i>
```
  and likewise `m-failed` → `aria-label="push failed"` / `<span class="tip">push failed</span>`, and the second `m-unpushed`. Then `grep -n 'dmark" title' docs/superpowers/prototypes/2026-09-03-app-prototype.html` prints nothing.

- [ ] **Step 2: Frame the prototype** (ticket-workflow skill: a prototype is captured inside the companion's frame, never bare):

```bash
cd /home/dion/Projects/personal/ThatApp
awk -v f=docs/superpowers/prototypes/2026-09-03-app-prototype.html \
  '/<!-- CONTENT -->/{while((getline l < f)>0) print l; next} {print}' \
  ~/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/brainstorming/scripts/frame-template.html \
  > .claude/e2e/proto-231.html
```

- [ ] **Step 3: Write the throwaway capture spec** `.claude/e2e/tests/shots-231.spec.ts`. It (a) opens the framed prototype, shows Week, and records the footer tooltip's geometry and type in each theme; (b) opens the app's Week with a stubbed rollup, reaches Monday's footer mark by a real `Tab`, records the same, and screenshots it in dark and light:

```ts
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const SHOTS = "/e2e/test-results/shots";
const DAYS = ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"];

function weekRow(issueKey: string, logged: Record<number, [number, "unpushed" | "dirty" | "pushed"]>) {
  const cells = DAYS.map((_, index) => {
    const entry = logged[index];
    return entry ? { seconds: entry[0], pushState: entry[1] } : { seconds: 0, pushState: null };
  });
  return {
    instanceId: 1,
    instanceName: "Ridgeline",
    instancePosition: 0,
    issueKey,
    url: `https://ridgeline.atlassian.net/browse/${issueKey}`,
    cells,
    seconds: cells.reduce((sum, cell) => sum + cell.seconds, 0),
  };
}

const ROWS = [
  weekRow("RIDGE-5325", { 0: [10800, "pushed"], 1: [8100, "unpushed"], 2: [14400, "pushed"], 3: [5400, "dirty"] }),
  weekRow("NW-812", { 0: [7200, "pushed"], 2: [6300, "pushed"], 3: [10800, "pushed"] }),
];
const RANK = { pushed: 0, dirty: 1, unpushed: 2 } as const;
const ROLLUP = {
  start: DAYS[0],
  end: DAYS[6],
  prevStart: "2026-08-31",
  nextStart: "2026-09-14",
  weekNumber: 37,
  days: DAYS.map((day, index) => {
    const states = ROWS.map((row) => row.cells[index]?.pushState ?? null).filter((state) => state !== null);
    const worst = states.reduce<keyof typeof RANK | null>(
      (carried, state) => (carried === null || RANK[state] > RANK[carried] ? state : carried),
      null,
    );
    return { day, seconds: ROWS.reduce((sum, row) => sum + (row.cells[index]?.seconds ?? 0), 0), pushState: worst };
  }),
  rows: ROWS,
  seconds: ROWS.reduce((sum, row) => sum + row.seconds, 0),
};

async function tipFacts(page: Page, markSelector: string, tipSelector: string) {
  return page.evaluate(
    ([m, t]) => {
      const mark = document.querySelector(m)?.getBoundingClientRect();
      const tip = document.querySelector(t);
      if (!mark || !tip) return null;
      const box = tip.getBoundingClientRect();
      const style = getComputedStyle(tip);
      return {
        gapAbove: Math.round(mark.top - box.bottom),
        centreOffset: Math.round(box.left + box.width / 2 - (mark.left + mark.width / 2)),
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        background: style.backgroundColor,
        color: style.color,
      };
    },
    [markSelector, tipSelector] as const,
  );
}

test("prototype: the footer mark's tooltip", async ({ page }) => {
  await page.goto("file:///e2e/proto-231.html");
  await page.locator('button[data-view="week"]').first().click();
  for (const theme of ["dark", "light"]) {
    if (theme === "light") await page.locator("#lm-toggle").click();
    const mark = page.locator("tfoot .dmark").first();
    await mark.hover();
    console.log(`prototype ${theme}`, JSON.stringify(await tipFacts(page, "tfoot .dmark", "tfoot .dmark .tip")));
    await page.mouse.move(0, 0);
  }
});

for (const theme of ["dark", "light"] as const) {
  test(`app: the footer mark's tooltip opened by keyboard, ${theme}`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
    await page.route("**/api/entries**", (route) =>
      route.fulfill({ status: 200, json: { today: DAYS[1], entries: [] } }),
    );
    await page.route("**/api/week**", (route) => route.fulfill({ status: 200, json: ROLLUP }));
    await page.goto("/week");

    const sunday = page.locator("tbody tr").last().locator("td button").nth(6);
    const mark = page.locator("tfoot td").nth(1).getByRole("img", { name: "not pushed" });
    await expect(mark).toBeVisible();
    // Tuesday's mark, not Monday's: Tab from the last row's Sunday reaches the
    // first marked day, which here is Tuesday (Monday is all pushed).
    await sunday.focus();
    await page.mouse.move(0, 0);
    await page.keyboard.press("Tab");
    await expect(mark).toBeFocused();
    const id = (await mark.getAttribute("id")) ?? "";
    const tooltip = page.locator(`that-tooltip[for="${id}"]`);
    await expect(tooltip).toBeVisible();

    console.log(`app ${theme}`, JSON.stringify(await tipFacts(page, `#${id}`, `that-tooltip[for="${id}"]`)));

    const card = await page.locator("table").boundingBox();
    if (!card) throw new Error("no table on screen");
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({
      path: `${SHOTS}/footer-mark-tooltip-keyboard-${theme}.png`,
      clip: { x: card.x - 8, y: card.y - 8, width: card.width + 16, height: card.height + 16 },
    });
  });
}
```

  Pointer is parked at `(0, 0)` and focus is deliberately left on the mark: the picture is of the keyboard-opened state, which is the point.

- [ ] **Step 4: Run it in Firefox and copy the shots out** before anything else runs Playwright (a run clears `test-results/`):

```bash
cd /home/dion/Projects/personal/ThatApp
docker compose --profile e2e rm --stop --force app-e2e
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/shots-231.spec.ts --project=firefox'
docker compose --profile e2e rm --stop --force app-e2e
mkdir -p <scratchpad>/shots231 && cp .claude/e2e/test-results/shots/*.png <scratchpad>/shots231/
```

  `<scratchpad>` is the executing session's own scratchpad directory. Expected: 3 passed, two PNGs copied, and four `prototype …`/`app …` fact lines in the output.

- [ ] **Step 5: Compare against the drawing and report what was compared.** From the fact lines and by opening both PNGs (Read tool): in each theme, the app's tooltip and the prototype's `.tip` must agree on — opening **above** the mark, **centred** on it (`centreOffset` within ±1px of the prototype's), a **7px** gap (`gapAbove` 7 in both), font size (12px in the drawing; the app's `text-sm` — record both), weight, background and text colour (the rail pair). Also check in the PNGs that the focused mark shows a visible focus ring (Review Focus 5). Write the comparison into the task report as a table: property / prototype / app / match. **Any mismatch that is not produced by this ticket is reported, not fixed** — the tooltip's styling is `that-tooltip`'s, shared app-wide, and out of this ticket's scope; a mismatch this ticket *causes* (e.g. the tooltip opening below, or off-centre) is fixed in Task 1's code and re-run.

- [ ] **Step 6: Delete the throwaways.** `rm .claude/e2e/proto-231.html .claude/e2e/tests/shots-231.spec.ts`; `git status --short` shows only the prototype modified.

- [ ] **Step 7: Gates.** `make verify` green and `make test-e2e` 0 failed (the prototype is not under test, but the gate is run on the final tree).

- [ ] **Step 8: Commit.**

```bash
git add docs/superpowers/prototypes/2026-09-03-app-prototype.html
git commit -m "The prototype's footer marks drop title and draw the tooltip (#231)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LSFNGKuFZChTpQMJ5cQuAH"
```

  If signing fails, retry unsigned with `git -c commit.gpgsign=false commit …` and say so. Never push. Report the two PNG paths so the pull request can attach them with `.claude/tools/pr-attach.sh <pr-number> <scratchpad>/shots231/*.png`.
