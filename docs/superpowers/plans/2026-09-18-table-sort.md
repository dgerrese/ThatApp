# Sort Today's tables (#83) Implementation Plan

**Date:** 2026-09-18
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Today table sorts on Key, Summary, Status or Today, independently, cycling natural → reversed → Jira's order, remembered per table across reloads.

**Architecture:** A pure module, `web/src/table-sort.ts`, owns the rules: the cycle, the comparators and parsing a stored state. `that-table` owns the behaviour. Its header buttons cycle its own state and show it (icon, full ink, `aria-sort`), and it keeps its body sorted with a `MutationObserver`, so rows Today adds, removes or updates (`seconds`, `summary`, `status`) re-sort without Today knowing. Jira's order is each row's arrival order, recorded when the row is first seen. A table remembers its sort in `localStorage` under the id Today gives it in a `sort-id` attribute.

**Tech Stack:** TypeScript, light-DOM WebComponents, `node --test`, Playwright.

**Spec:** Codeberg issue #83 — `tea api "repos/{owner}/{repo}/issues/83"`. The ascending arrow was settled in the design session of 2026-09-18: the drawn descending arrow, mirrored.

## Global Constraints

- No Go, Node or npm on the host; `make` / `docker compose`.
- `strict` + `noUncheckedIndexedAccess`; no `any`, `as any`, `!`.
- Light DOM only; no framework; Tailwind v4 utilities.
- **Natural direction:** Key, Summary, Status ascending; Today most-time-first. **Cycle:** natural → reversed → Jira's order (none). A different column starts its own cycle.
- **Comparators:** Key by project (case-insensitive), then issue number numerically (`RIDGE-9` < `RIDGE-10`); Summary and Status case-insensitive; Today by seconds. Ties keep Jira's order (stable).
- **Per table, independent.** Persistence in `localStorage` under `thatapp.sort.<sort-id>`; missing, blocked or unreadable storage falls back to Jira's order without an error.
- **Header states** (drawn in the prototype): the `sortable` double chevron at 45% on every inactive column; the active column's label at full ink with the ascending or descending arrow; `aria-sort="ascending" | "descending"` on the active `th`, `"none"` elsewhere. The icon never carries the state alone.
- **Icons match the drawing:** `descending` becomes the prototype's `#p-desc` (`M12 4.5V19M6.4 13.4 12 19l5.6-5.6`), and `ascending` its mirror (`M12 19.5V5M6.4 10.6 12 5l5.6 5.6`).
- The owner's dev stack (`app`, `web`) is theirs: never `make down`, never stop/restart/recreate it.
- Comments are few and explain a non-obvious why.
- Commit unsigned with `git -c commit.gpgsign=false commit …` if signing fails; **never push**.

---

### Task 1: The sort rules, pure and tested

**Files:**
- Create: `web/src/table-sort.ts`, `web/src/table-sort.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SortColumn = "key" | "summary" | "status" | "today";
  export type SortDirection = "ascending" | "descending";
  export interface SortState { column: SortColumn; direction: SortDirection }
  export interface SortableRow { key: string; summary: string; status: string; seconds: number; order: number }
  export function nextSortState(current: SortState | null, clicked: SortColumn): SortState | null;
  export function compareRows(a: SortableRow, b: SortableRow, state: SortState | null): number;
  export function parseSortState(stored: string | null): SortState | null;
  export function serializeSortState(state: SortState | null): string | null;
  ```
  `compareRows` with `state === null` orders by `order` (Jira's). With a state, ties fall back to `order`,
  so a plain `Array.prototype.sort` is stable by construction. `parseSortState` returns null for
  anything that is not exactly a known column and direction.

- [ ] **Step 1: Failing tests** — `web/src/table-sort.test.ts` (node:test, `assert/strict`), one test each:
  - the cycle for each column: Key/Summary/Status `null → ascending → descending → null`; Today `null → descending → ascending → null`; clicking another column mid-cycle starts that column's natural direction.
  - Key: `["RIDGE-10","ridge-9","NW-2","RIDGE-9"]` ascending → `NW-2, ridge-9 / RIDGE-9 (arrival order), RIDGE-10`; a key without a number sorts by its text.
  - Summary and Status case-insensitive; Today descending puts the most seconds first.
  - ties keep arrival order in both directions; `null` restores arrival order.
  - `parseSortState`: round-trips `serializeSortState`; `null`, `""`, `"{"`, `{"column":"x"}` and a wrong direction all → `null`.

  Run `docker compose run --rm --no-deps web node --test src/table-sort.test.ts`: FAIL (module missing).

- [ ] **Step 2: Implement** `web/src/table-sort.ts` to the interfaces. Key comparison: split on the last
  `-`; compare the project part with `localeCompare(…, undefined, { sensitivity: "base" })`, then the
  numeric part as numbers; fall back to a base-sensitivity text compare when there is no numeric part.
  Summary/Status: `localeCompare(…, undefined, { sensitivity: "base" })`. Descending negates the
  column comparison only, never the `order` tie-break.

  Run: PASS. `make verify`.

- [ ] **Step 3: Commit** — `git add web/src/table-sort.ts web/src/table-sort.test.ts && git commit -m "feat(#83): the sort rules — cycle, comparators, stored state"`

---

### Task 2: `that-table` sorts itself, and Today names its tables

**Files:**
- Modify: `web/src/components/that-table.ts`, `web/src/icons.ts` (`ascending`, `descending` paths), `web/src/icons.test.ts` if it pins paths
- Modify: `web/src/views/today.ts` (set `sort-id` on each `that-table` it creates: `pinned`, `off-list`, `instance-<id>`)
- Modify: `docs/superpowers/prototypes/2026-09-03-app-prototype.html` (add `#p-asc`; show one column ascending somewhere a reader can see it — e.g. the off-list card's Summary header — and say in the report where)
- Test: `.claude/e2e/tests/table.spec.ts` (new tests; read its existing helpers first)

**Interfaces:**
- Consumes: Task 1's exports.
- `that-table` gains an optional `sort-id` attribute. Without it, the table sorts but does not persist.

- [ ] **Step 1: Failing e2e tests** (Firefox and Chromium), stubbing `/api/issues`, `/api/pins`, `/api/entries` the way `table.spec.ts`/`today.spec.ts` already do, with one instance of four issues whose keys, summaries, statuses and logged times make each order distinguishable, and at least one pin:
  - clicking Key cycles ascending → descending → Jira's order, asserting the row order each time and `aria-sort` on the header;
  - clicking Today on the instance card puts the most time first; the Pinned table's order is unchanged;
  - a sorted table survives a reload (same order, same header state);
  - logging time against a row (stub the entries round trip the way existing specs do, or change the stubbed totals and trigger Today's refresh) re-sorts a table sorted by Today;
  - with `localStorage` throwing (`page.addInitScript` replacing `Storage.prototype.getItem`/`setItem` with throwing functions), the page loads in Jira's order and sorting still works in-page.

  Run them: FAIL.

- [ ] **Step 2: Implement `that-table`**
  - Header buttons (already built with `aria-label="Sort by …"`) get click handlers: `state = nextSortState(state, column)`, then `applyState()`.
  - `applyState()` paints each `th`: the active one gets `aria-sort` ascending/descending, full-ink label (drop the muted class), and the matching arrow icon at full strength; the rest get `aria-sort="none"`, the muted label and the `sortable` chevron at `opacity-45`. Then it sorts the body and, if `sort-id` is set, saves (`try`/`catch` around every storage access).
  - On `connectedCallback`, read `sort-id`'s stored state with `parseSortState` (inside `try`/`catch`; any throw → `null`).
  - Body sorting: each row element gets its arrival order the first time the table sees it (a `WeakMap<Element, number>` fed by a counter). A row's sortable values come from its attributes: `key`, `summary`, `status`, `seconds` (number, default 0). Sort a copy of `body.children` with `compareRows` and re-append only if the order changed.
  - A `MutationObserver` on the body (`childList: true`, and `attributes: true, subtree: true, attributeFilter: ["key","summary","status","seconds"]`) re-sorts when rows arrive or change. Disconnect it around the table's own re-append so its own moves don't loop, and reconnect after. Disconnect it in `disconnectedCallback`.
  - A re-sort must not rebuild rows. Moving a `that-ticket-row` keeps its focus target alive, as its own comment requires.

- [ ] **Step 3: Icons** — set `ascending`/`descending` in `web/src/icons.ts` to the drawn paths (Global Constraints). Update any icon test that pins the old paths.

- [ ] **Step 4: Today** — every `that-table` Today creates gets `sort-id` (`pinned`, `off-list`, `instance-<instance id>`), set before it is appended.

- [ ] **Step 5: Prototype** — add `#p-asc` and draw one column ascending; compare the built header states against the prototype (rest, ascending, descending) and report what was compared and what was found.

- [ ] **Step 6: GREEN and gates** — the new tests PASS on both engines; `make verify`; `make test-e2e`. #134's intermittent chromium crash in `pwa.spec.ts`: re-run once, report both runs; twice in a row → report, don't re-run further. If `pwa.spec.ts`'s offline-shell tests fail with `toBeGreaterThan`, run `make build-web` once (#67) and say so.

- [ ] **Step 7: Commit** — `git add web/src .claude/e2e/tests docs/superpowers/prototypes && git commit -m "feat(#83): Today's tables sort on every column, each on its own, remembered per table"`
