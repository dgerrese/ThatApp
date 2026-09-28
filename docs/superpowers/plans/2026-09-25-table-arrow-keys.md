# Up/Down arrow keys move between table rows (#227) Implementation Plan

**Date:** 2026-09-25
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Today's tables and Week's grid, Up/Down move focus to the same cell in the data row above
or below, so a keyboard user reaches a later row without tabbing through every stop before it.

**Architecture:** one pure chooser, `rowStepTarget`, in a new `web/src/table-keys.ts`, unit-tested with
`node --test`; and one DOM wiring helper, `enableRowArrowKeys(root, rowSelector)`, in the same file,
that each view calls once with its own root and its own data-row selector. The column is the focused
element's cell (its index among its row's cells) plus its position inside that cell — never a flat
index over the row's focusables, because rows carry different numbers of them (a key link only when
the issue has a URL). This is the lesson from #143's search panel.

**Tech Stack:** vanilla TypeScript, `node --test`, Playwright (Firefox and Chromium).

**Spec:** Codeberg issue #227's refined body (`tea api "repos/{owner}/{repo}/issues/227" | jq -r .body`):
the owner's six settled points and the acceptance criteria. Stacked on #229's branch
(`issue-143-keyboard-and-cut-text`), which made summaries focusable.

## Global Constraints

- All commands through `make` or `docker compose` (in this worktree they use the `thatapp-review`
  Compose project; never `make up`/`make down`).
- TypeScript strict; no `any`, `as any`, non-null assertion. Few comments, only the why.
- Up/Down only. Tab order unchanged. Left/Right, Home/End, Page Up/Down not handled.
- Data rows only: sort headers and Week's footer never join.
- Today: Down from a table's last row enters the next table's first row, in document order; Up the
  reverse. Week: stops at its first and last row. At the view's first and last data row the key does
  nothing (no focus move; `preventDefault` so the page does not scroll either).
- A missing cell: focus goes to the nearest focusable element in the target row. Never skip a row.
- Handle the key only when focus is inside a data row; `preventDefault` only then.

## Review Focus

1. **Rows of different shape:** a Today row whose issue has no URL has no key link; Down from a key
   onto it lands on the nearest focusable (its summary), and Down again from there onto a linked row
   lands on that row's summary, not its key. Unit test in Task 1.
2. **A re-sort or a repaint** (pin, unpin, Refresh, a timer tick, a table re-sort by `moveBefore`) must
   not break the movement: the helper reads the DOM on every key press and keeps no state. e2e in Task 1.
3. **Focus inside a cell with two focusables** (Today's actions cell: timer and pin): Down from pin
   lands on the next row's pin, not its timer. Unit test in Task 1.
4. **Empty sections:** a Today section with "No issues assigned." has no data rows and is skipped.
5. **Week:** the key cell is a `<th>`, day cells are `<td>`s; both count as cells.

---

### Task 1: the chooser, the wiring helper, and Today

**Files:**
- Create: `web/src/table-keys.ts`, `web/src/table-keys.test.ts`
- Modify: `web/src/views/today.ts` (call `enableRowArrowKeys` once at mount, torn down with
  `registerTeardown`)
- Test: `.claude/e2e/tests/table-keys.spec.ts` (new)

**Interfaces (produces, for Task 2):**

```ts
/** A focusable element's place in its row: which cell, and which focusable inside that cell. */
export interface CellSlot { cell: number; index: number }

/** Where focus goes in a target row, given the source slot and the target row's focusables as
 *  slots (in DOM order). Returns an index into `target`, or null when `target` is empty. */
export function rowStepTarget(source: CellSlot, target: CellSlot[]): number | null;

/** Wires Up/Down on `root` for rows matching `rowSelector` (in document order). Returns the
 *  function that removes the listener. */
export function enableRowArrowKeys(root: HTMLElement, rowSelector: string): () => void;
```

`rowStepTarget` rules: an exact `cell` and `index` match wins; else the same `cell` with the index
clamped to that cell's last focusable; else the slot whose `cell` is nearest to `source.cell` (ties go
to the lower cell), first focusable in it.

`enableRowArrowKeys`: one `keydown` listener on `root`. On ArrowUp/ArrowDown (no modifier keys), find
the focused element's row (`closest(rowSelector)` inside `root`); if none, return. Rows are
`root.querySelectorAll(rowSelector)` minus rows with no focusable; the source row's neighbour is the
next or previous one in that list. A row's cells are its direct `td`/`th` element children, or, for
`that-ticket-row`, the `td`s it renders (it is a custom element acting as a row — read
`that-ticket-row.ts`); `cell` is the cell's index among them and `index` the element's index among
that cell's focusables. Focusable means `a[href], button:not([disabled]), [tabindex="0"]`, visible.
Focus the chosen element and `preventDefault`; at an edge, `preventDefault` and do nothing.

Today's root is the view's own container (Pinned, each instance section, the off-list section); the
data-row selector is `that-ticket-row`. Headers live in `thead`, so they are never matched.

- [ ] Step 1: table-driven unit tests for `rowStepTarget`, including Review Focus 1 and 3: exact match;
  same cell, index clamped; missing cell → nearest cell; tie → lower cell; empty target → null.
- [ ] Step 2: `make test-web`; FAIL (module missing).
- [ ] Step 3: implement `rowStepTarget`; PASS.
- [ ] Step 4: failing e2e tests (both browsers) on Today with two instance sections and a Pinned row:
  1. Down from row 1's summary focuses row 2's summary; Up goes back.
  2. Down from pin focuses the next row's pin (not its timer).
  3. Down from the last row of one table focuses the first row of the next table; Up the reverse.
  4. Down from a key onto a row with no URL focuses that row's summary.
  5. At the last data row of the view, Down leaves focus where it is and the page does not scroll
     (`scrollY` unchanged).
  6. Down from a sort header does nothing new (Tab order and header behaviour unchanged).
  7. After a re-sort (click a header) and after a pin, Down still moves by the new order.
- [ ] Step 5: implement `enableRowArrowKeys` and Today's wiring; PASS; run today, table, pins,
  cut-text, keyboard-audit specs.
- [ ] Step 6: `make verify`. Commit: `Up/Down move between Today's table rows (#227)`.

---

### Task 2: Week's grid

**Files:**
- Modify: `web/src/views/week.ts` or `web/src/week-grid.ts` (wherever the grid is mounted), calling
  `enableRowArrowKeys(gridRoot, "tbody tr")` once, torn down with the view.
- Test: `.claude/e2e/tests/table-keys.spec.ts` (append)

- [ ] Step 1: failing e2e tests (both browsers): Down from a ticket's Wednesday cell focuses the next
  ticket's Wednesday cell; Down from a key link focuses the next key link; at the last ticket row Down
  does nothing (the footer is never reached); Up from the first row does nothing.
- [ ] Step 2: run; FAIL.
- [ ] Step 3: implement; PASS; run week spec too.
- [ ] Step 4: `make verify` and the FULL `make test-e2e`. Commit: `Up/Down move between Week's grid rows (#227)`.
