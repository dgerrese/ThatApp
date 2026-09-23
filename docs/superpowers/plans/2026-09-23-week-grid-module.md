# The Week grid in its own module (#91) Implementation Plan

**Date:** 2026-09-23
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Week's grid renderer is a module of its own that takes data and returns DOM, covered by
node unit tests under a DOM shim; `week.ts` keeps only the lifecycle. Nothing on screen changes.

**Architecture:** A new `web/src/week-grid.ts` exports `weekGrid(rollup, failures, openEntry)`,
which returns the grid card — or the empty-week message — plus the failure-set helpers the push
report feeds it. `dayHeading` moves into `web/src/week-label.ts`. `week.ts` calls `weekGrid` from
`paintWeek` and nothing else about it changes. Node's unit tests reach the DOM through happy-dom.

**Tech Stack:** TypeScript, `node --test` with type stripping, happy-dom, Playwright (unchanged).

**Spec:** Codeberg issue #91 — `tea api "repos/{owner}/{repo}/issues/91"`.

## What was decided and confirmed before planning

**The DOM shim is happy-dom, used directly, with no registrator package.** The owner settled on
adding a shim and named happy-dom as the default (lighter than jsdom). It is already added to
`web/package.json` `devDependencies` (`^20.14.5`) with its lockfile entries, by
`docker compose run --rm --no-deps web npm install --save-dev happy-dom` — the working tree carries
that change uncommitted; Task 2 commits it. The lockfile diff adds only happy-dom and its own
dependencies (`@types/whatwg-mimetype`, `@types/ws`, `buffer-image-size`, `entities`,
`whatwg-mimetype`, `ws`) and removes nothing.

A spike confirmed, inside the `web` container, that a test file doing

```ts
import { Window } from "happy-dom";
Object.assign(globalThis, { document: new Window().document });
```

runs under the unchanged `node --test 'src/**/*.test.ts'` (205 pass, 0 fail, the process exits on
its own), type-checks under `tsc -p tsconfig.test.json`, and lints clean. `Object.assign` is how the
global is set without a cast: assigning `globalThis.document` directly needs
`as unknown as Document`, which the project's TypeScript rules rule out. `@happy-dom/global-registrator`
would do the same with a second package and would install *every* browser global; the renderer only
reaches for `document`.

**Why this does not change how any other test runs.** `node --test` runs each test file in its own
child process by default, so the global set in `week-grid.test.ts` exists only in that file's
process. No flag, no preload, no change to the `test-web` target or to CI's `Test` step. CI's
`npm ci` installs devDependencies, so it picks happy-dom up with no workflow change either; only the
Makefile's comment claiming the suite is DOM-free needs correcting.

**The renderer does not take the view root.** Today's `gridTable(rollup, failures, root)` needs
`root` for one thing: `ticketCell`'s click handler calls `openEntryDialog(root, …)`. The narrowest
thing that serves is the call itself, so `weekGrid` takes `openEntry: (ticket: EntryTicket) => void`
and `week.ts` passes `(ticket) => { openEntryDialog(root, ticket); }`. The renderer then imports
nothing from the dialog but its type, reads no view state, and subscribes to nothing. The one
listener left in it is the cell's own click, which only forwards to `openEntry` — that is the
reading of "holds no listeners" this plan takes (no subscriptions, no handlers that act on the
view), and it is reversible: event delegation from `week.ts` would remove it at the cost of the
renderer encoding row and day into the DOM.

**`failuresIn` and `cellKey` move with the renderer.** `cellKey` is the format the renderer reads a
failure by; `failuresIn` is the only thing that writes it. Keeping writer and reader in one module
means the failed-cell test builds its input the way a real push does. `failuresKey` stays in
`week.ts`: it is the lifecycle's repaint signature, not rendering.

**The empty-week branch moves too.** `paintWeek` chooses between `emptyWeek()` and the grid card;
that choice is one of the renderer's rules (the ticket lists "empty week"), so `weekGrid` makes it.

**The budget is not at risk, and here is why.** `main.ts` statically imports only `./rail` and
`./router`. `week-grid.ts` is imported by `views/week.ts` alone, which loads through dynamic
`import()`, so esbuild puts the module in a lazy chunk. `index.html` is not touched, so
`maxIndexHTMLBytes` in `internal/server/server_test.go` measures the same file. happy-dom is
imported only by a `*.test.ts` file, and esbuild's only entry points are `src/main.ts` and
`src/sw.ts`, so it cannot reach `web/dist`. Both are checked at the gate, not assumed.

**Imports in the new module carry `.ts` extensions** (`./format.ts`, not `./format`), because node
runs it directly under the test and resolves no extensionless specifier. Every module it imports —
`format.ts`, `instance-hue.ts`, `card-surface.ts`, `week-label.ts` — has no imports of its own and
touches no DOM at load, so the module loads in node before `document` exists. Type-only imports
(`types.ts`, `components/that-entry-dialog.ts`) are erased and load nothing.

## Global Constraints

- No Go, Node or npm on the host; everything runs through `make` or `docker compose`.
- The owner's dev stack (`thatapp-web-1`) is running and is theirs: never `make down`, never stop
  or recreate it.
- **Never touch the working tree while an e2e run is in flight** — `app-e2e` mounts `.:/src`.
- **No rendering change.** Moved code moves verbatim, comments included, except where a step
  names a change. No class string, text, attribute or element order differs.
- **No e2e spec is edited.** The suite passing untouched is an acceptance criterion.
- TypeScript is `strict` with `noUncheckedIndexedAccess`. No `any`, no `as any`, no non-null
  assertion, no `as unknown as`.
- Comments are few and explain a non-obvious why. Do not narrate the extraction.
- **Each renderer rule is shown failing when the rule is broken.** After GREEN, break the rule in
  the source, run the suite, paste the failing output into the report, and restore the source.
- Commit unsigned with `git -c commit.gpgsign=false commit …` if signing fails; **never push**.

Run the unit tests with `make test-web`, or for speed
`docker compose run --rm --no-deps web node --test 'src/**/*.test.ts'` (the Makefile exports
`THAT_UID`/`THAT_GID`; a bare `docker compose` call needs
`THAT_UID=$(id -u) THAT_GID=$(id -g)` in front of it).

---

### Task 1: `dayHeading` joins `week-label.ts`, and stops saying NaN

**Files:**
- Modify: `web/src/week-label.ts`, `web/src/week-label.test.ts`, `web/src/views/week.ts`

**Interfaces:**
- Produces: `export function dayHeading(day: string, index: number): string` in
  `web/src/week-label.ts`. `"2026-09-07", 0` → `"Mon 7"`. A `day` that is not `YYYY-MM-DD` yields
  the weekday alone. An `index` outside 0–6 yields the date alone.

- [ ] **Step 1: RED — write the tests**

Append to `web/src/week-label.test.ts`, and add `dayHeading` to its import from `./week-label.ts`:

```ts
void test("a day heading is the column's weekday and the date's day number", async (t) => {
  const cases: { day: string; index: number; want: string }[] = [
    { day: "2026-09-07", index: 0, want: "Mon 7" },
    { day: "2026-09-13", index: 6, want: "Sun 13" },
    { day: "2026-10-01", index: 3, want: "Thu 1" },
  ];

  for (const { day, index, want } of cases) {
    await t.test(`${day} in column ${String(index)} is ${want}`, () => {
      assert.equal(dayHeading(day, index), want);
    });
  }
});

void test("a malformed day falls back to the weekday, never NaN", async (t) => {
  for (const day of ["", "2026-09-xx", "not a day", "2026-09-7"]) {
    await t.test(JSON.stringify(day), () => {
      assert.equal(dayHeading(day, 0), "Mon");
    });
  }
});

void test("a column past Sunday keeps the date and no stray space", () => {
  assert.equal(dayHeading("2026-09-14", 7), "14");
});
```

- [ ] **Step 2: Run, and see it fail** — `dayHeading` is not exported. Paste the output.

- [ ] **Step 3: GREEN — move and fix**

Move `WEEKDAYS` (its doc comment with it) and `dayHeading` from `web/src/views/week.ts` into
`web/src/week-label.ts`, exported, and replace the body:

```ts
/**
 * `Mon 7`. The weekday comes from the column's position, the number from the
 * day string the server sent — sliced rather than parsed, for the reason at the
 * top of this file. A day that is not `YYYY-MM-DD` has no number to show, so it
 * shows none rather than `NaN`.
 */
export function dayHeading(day: string, index: number): string {
  const date = /^\d{4}-\d{2}-(\d{2})$/.exec(day)?.[1];
  const parts = [WEEKDAYS[index], date === undefined ? undefined : String(Number(date))];

  return parts.filter((part) => part !== undefined).join(" ");
}
```

In `week.ts`, import it: `import { dayHeading, weekLabel } from "../week-label";`.

- [ ] **Step 4: Run, and see it pass.** Then break the rule — revert the body to
  `` `${WEEKDAYS[index] ?? ""} ${String(Number(day.slice(8, 10)))}` `` — run again, paste the
  failing output (the malformed-day and past-Sunday cases), and restore.

- [ ] **Step 5: `make tsc` and `make lint`** — both clean.

- [ ] **Step 6: Commit** — `git add web/src/week-label.ts web/src/week-label.test.ts web/src/views/week.ts`,
  message `refactor(web): dayHeading lives with weekLabel and never says NaN (#91)`.

---

### Task 2: `week-grid.ts`, its tests, and `week.ts` rewired

**Files:**
- Create: `web/src/week-grid.ts`, `web/src/week-grid.test.ts`
- Modify: `web/src/views/week.ts`, `Makefile` (the comment above `test-web`)
- Commit (already changed in the working tree): `web/package.json`, `web/package-lock.json`

**Interfaces:**
- Consumes: `dayHeading(day, index)` from `web/src/week-label.ts` (Task 1).
- Produces, from `web/src/week-grid.ts`:
  - `export interface Failures { cells: Set<string>; days: Set<string> }`
  - `export function noFailures(): Failures`
  - `export function failuresIn(responses: PushResponse[]): Failures`
  - `export function weekGrid(rollup: WeekRollup, failures: Failures, openEntry: (ticket: EntryTicket) => void): HTMLElement`

- [ ] **Step 1: RED — write the tests**

Create `web/src/week-grid.test.ts`:

```ts
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
  const button = grid
    .querySelectorAll("tbody tr")
    [rowIndex]?.querySelectorAll("td")
    [dayIndex]?.querySelector("button");
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
```

Note on the totals test: a day with `seconds: 1800` in the footer reads `0h 30m` because
`totalFigure` always prints hours. If the implementer finds `totalFigure(1800)` returns something
else, the test's expectation follows `totalFigure`, not the other way round — this is a move, not a
rendering change. The same applies to any expectation above that disagrees with what `week.ts`
renders today: fix the test, report it, never the renderer.

- [ ] **Step 2: Run, and see it fail** — `./week-grid.ts` does not exist. Paste the output.

- [ ] **Step 3: GREEN — create `web/src/week-grid.ts`**

Move these from `web/src/views/week.ts` **verbatim, doc comments included**, in this order:
`Failures`, `noFailures`, `cellKey`, `failuresIn`, `TK_CLASSES`, `keyLink`, `gridTable`, `gridCard`,
`MARKER_BASE`, `MARKERS`, `PushState`, `markerFor`, `pushWords`, `weekCellSequence`, `ticketCell`,
`dayTotal`, `totalCell`, `tkHeadCell`, `headCell`, `emptyWeek`. Export `Failures`, `noFailures` and
`failuresIn`; everything else stays module-private.

The module's imports, extensions included:

```ts
import { CARD_SURFACE_CLASSES } from "./card-surface.ts";
import type { EntryTicket } from "./components/that-entry-dialog.ts";
import { totalFigure } from "./format.ts";
import { paintInstanceDot } from "./instance-hue.ts";
import type { PushResponse, WeekCell, WeekDay, WeekRollup, WeekRow } from "./types.ts";
import { dayHeading, weekLabel } from "./week-label.ts";
```

Exactly three changes to the moved code, all to replace `root` with `openEntry`:

1. `gridTable(rollup, failures, root: HTMLElement)` becomes
   `gridTable(rollup, failures, openEntry: (ticket: EntryTicket) => void)`, and passes `openEntry`
   where it passed `root` to `ticketCell`.
2. `ticketCell(…, root: HTMLElement)` becomes `ticketCell(…, openEntry: (ticket: EntryTicket) => void)`.
3. Its click handler calls `openEntry({ … })` with the same object literal (and the same comment)
   it passed to `openEntryDialog(root, { … })`.

Then add the one new export, placed first after the imports:

```ts
/**
 * Week's grid for one rollup: the table in its card, or the empty-week message
 * when there is no row to draw. Pure but for the DOM it returns — it reads no
 * view state, and a cell's press is handed to `openEntry` rather than acted on.
 */
export function weekGrid(
  rollup: WeekRollup,
  failures: Failures,
  openEntry: (ticket: EntryTicket) => void,
): HTMLElement {
  return rollup.rows.length === 0 ? emptyWeek() : gridCard(gridTable(rollup, failures, openEntry));
}
```

- [ ] **Step 4: Rewire `web/src/views/week.ts`**

- Delete everything Step 3 moved.
- Import: `import { failuresIn, noFailures, weekGrid } from "../week-grid";` and
  `import type { Failures } from "../week-grid";`.
- `paintWeek`'s grid line becomes:

  ```ts
  grid.replaceChildren(
    weekGrid(painting, marked, (ticket) => {
      openEntryDialog(root, ticket);
    }),
  );
  ```

- Drop imports the file no longer uses (`noUnusedLocals` and eslint will name them — expect
  `CARD_SURFACE_CLASSES`, `totalFigure`, `paintInstanceDot`, `dayHeading`, and the `PushResponse`,
  `WeekCell`, `WeekDay` types).

- [ ] **Step 5: Correct the Makefile comment above `test-web`**

Replace its last sentence ("Scope is the DOM-free modules; anything reaching for `document` is the
e2e rig's, not this target's.") with: "A test that needs `document` builds one from happy-dom (a
dev dependency) inside its own file; node --test runs each file in its own process, so it reaches
no other suite." Keep the rest; the recipe does not change. `.forgejo/workflows/verify.yml` runs
`npm ci` then the same command, so it needs no change — confirm that by reading it, and say so.

- [ ] **Step 6: Run, and see it pass** — `make test-web`, `make tsc`, `make lint`. Paste the tails.

- [ ] **Step 7: Show each rule failing when broken.** One at a time: break it in
  `web/src/week-grid.ts`, run `node --test src/week-grid.test.ts` in the `web` container, paste the
  failing test names, restore, and confirm `git diff web/src/week-grid.ts` is back to the committed
  shape. The breaks:
  1. Empty week: `rollup.rows.length === 0` → `rollup.rows.length < 0`.
  2. Unpushed marker: `MARKERS.unpushed.className` `bg-pending` → `bg-dirty`.
  3. Dirty marker: `MARKERS.dirty.className` `border-dirty` → `border-pending`.
  4. Failed cell: in `gridTable`, `failed` is always `false`.
  5. Row total: `totalCell(row.seconds, …)` → `totalCell(0, …)`.
  6. Day total: `dayTotal`'s `day.seconds === 0` → `day.seconds !== 0`.
  7. Key link: `keyLink`'s `url === ""` → `url !== ""`.
  8. Opening a cell: `day: day || undefined` → `day: undefined`.

- [ ] **Step 8: Commit** — `git add web/src/week-grid.ts web/src/week-grid.test.ts web/src/views/week.ts Makefile web/package.json web/package-lock.json`,
  message `refactor(web): the Week grid renderer is its own module, tested under happy-dom (#91)`.

---

### Gates (the controller runs these after the whole-branch review)

- `make verify` — paste the tail.
- `make test-e2e` — paste the tail. `git diff codeberg/main --stat -- .claude/e2e` must be empty.
- `make build-web`, then: `grep -rl happy-dom web/dist` finds nothing; `grep -l "Nothing logged this week" web/dist/*.js`
  names a `chunk-*.js`, never `app.js`; `git diff codeberg/main -- web/index.html` is empty.
