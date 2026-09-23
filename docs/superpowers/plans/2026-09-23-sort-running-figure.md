# A running timer's figure and the Today sort agree (#183) Implementation Plan

**Date:** 2026-09-23
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sorting by Today compares the figure a row shows — logged seconds plus the running
timer's elapsed time when the timer is that row's — and the table re-sorts on a timer start, stop or
switch, never on a tick.

**Spec:** issue #183, section "Refined, 2026-09-23" (direction 2). No design session: nothing new
goes on screen.

**Architecture:** The figure is defined once. `timer-state.ts` gains `elapsedFor(instanceId,
issueKey)` — the seconds the running timer adds to *that* ticket, 0 otherwise — and `table-sort.ts`
gains `shownSeconds({ seconds, elapsed })`. `SortableRow` carries `elapsed` beside `seconds`, the
comparator's `today` case compares `shownSeconds`, and `that-ticket-row`'s cell paints the same
`shownSeconds`. `that-table` subscribes to `onTimerChanged` but re-sorts only when the *run* changes
(instance, key or start instant), which a tick never does.

**Tech stack:** vanilla TypeScript (strict), `node --test` for pure modules, Playwright on Firefox and
Chromium. Everything runs through `make` / `docker compose` — never bare `node`/`npm` on the host.

## Global constraints

- Docker only: `make test-web`, `make verify`, `make test-e2e`, or
  `docker compose run --rm --no-deps web node --test src/table-sort.test.ts` for a focused run.
- TypeScript `strict` + `noUncheckedIndexedAccess`; no `any`, no `as any`, no non-null assertion in
  `web/src`.
- The observer's rule of ignoring in-cell changes (`isOwnRowChange`, `OBSERVED_ROW_ATTRIBUTES`) is
  **not** changed.
- A tick never re-sorts. Only a change of run identity (`instanceId`, `issueKey`, `startedAt`, or
  running ↔ not running) re-sorts from the timer's side.
- Comments: few; a non-obvious why only.
- Commits end with the two trailer lines the controller gives you. If signing fails (1Password
  locked), retry with `git -c commit.gpgsign=false commit …`. Never push.

## File structure

| File | Change |
|---|---|
| `web/src/table-sort.ts` | `SortableRow.elapsed`, `shownSeconds`, `today` compares it |
| `web/src/table-sort.test.ts` | `rows()` helper fills `elapsed`; new running-row test |
| `web/src/timer-state.ts` | `elapsedFor(instanceId, issueKey)` |
| `web/src/components/that-ticket-row.ts` | `durationSeconds()` uses `shownSeconds` + `elapsedFor` |
| `web/src/components/that-table.ts` | `sortableRow` fills `elapsed`; rows keyed once per sort; `onTimerChanged` re-sort on run change |
| `.claude/e2e/tests/today-sort-timer.spec.ts` | new: the two browser specs |

---

## Task 1: One figure for the cell and the sort

**Files:** `web/src/table-sort.ts`, `web/src/table-sort.test.ts`, `web/src/timer-state.ts`,
`web/src/components/that-ticket-row.ts`, `web/src/components/that-table.ts`

- [ ] **Step 1: Write the failing comparator test (RED).** In `web/src/table-sort.test.ts`, the
  `rows()` helper gains `elapsed: partial.elapsed ?? 0,` after `seconds`. Add, after the
  "today ascending puts the least seconds first" test:

```ts
test("today compares the shown figure: a running row's elapsed time counts", () => {
  // RUNNING has logged less (0:59 against 1:00) but shows more (1:01) with two
  // minutes on its timer, so it must lead a descending sort.
  const data = rows([
    { key: "STOPPED", seconds: 3600 },
    { key: "RUNNING", seconds: 3540, elapsed: 120 },
  ]);
  const state: SortState = { column: "today", direction: "descending" };

  const sorted = [...data].sort((a, b) => compareRows(a, b, state));

  assert.deepEqual(
    sorted.map((row) => row.key),
    ["RUNNING", "STOPPED"],
  );
});
```

- [ ] **Step 2: Run it and see it fail.**
  `docker compose run --rm --no-deps web node --test src/table-sort.test.ts`
  Expected: the new test fails (`['STOPPED','RUNNING']` vs `['RUNNING','STOPPED']`) — or fails to
  type-strip because `elapsed` is not yet on `SortableRow`; either is RED. Keep the output.

- [ ] **Step 3: Implement in `web/src/table-sort.ts`.** Add to `SortableRow`, after `seconds`:

```ts
  /** What the running timer adds to this row's figure: 0 unless the timer is this row's. */
  elapsed: number;
```

  Add, below the interface:

```ts
/** The Today figure a row shows: logged seconds plus its own running time. The
 *  cell paints this and the sort compares it, so the two cannot disagree (#183). */
export function shownSeconds(row: Pick<SortableRow, "seconds" | "elapsed">): number {
  return row.seconds + row.elapsed;
}
```

  and change the `today` case of `compareColumn` to
  `return shownSeconds(a) - shownSeconds(b);`

- [ ] **Step 4: Add `elapsedFor` to `web/src/timer-state.ts`**, directly below `elapsedSeconds`:

```ts
/** The seconds the running timer adds to this ticket's figure: its elapsed
 *  time when it is this ticket's, 0 otherwise. */
export function elapsedFor(instanceId: number, issueKey: string): number {
  return isRunningTicket(instanceId, issueKey) ? elapsedSeconds() : 0;
}
```

- [ ] **Step 5: The cell paints the same figure.** In `that-ticket-row.ts`, import `shownSeconds`
  from `"../table-sort"` and `elapsedFor` from `"../timer-state"` (drop `elapsedSeconds` from that
  import if nothing else uses it; keep `isRunningTicket` for `mine()`). Replace `durationSeconds()`
  with:

```ts
  /** The figure this row shows — see shownSeconds, which the sort compares too. */
  private durationSeconds(): number {
    const seconds = Number(this.getAttribute("seconds") ?? "0");

    return shownSeconds({
      seconds: Number.isFinite(seconds) ? seconds : 0,
      elapsed: elapsedFor(
        Number(this.getAttribute("instance-id") ?? "0"),
        this.getAttribute("key") ?? "",
      ),
    });
  }
```

- [ ] **Step 6: The sort reads it.** In `that-table.ts`, import `elapsedFor` from
  `"../timer-state"`. In `sortableRow`, add after `seconds`:

```ts
      elapsed: elapsedFor(Number(row.getAttribute("instance-id") ?? "0"), row.getAttribute("key") ?? ""),
```

  Then, in `sortBody`, build each row's `SortableRow` once rather than per comparison — elapsed
  reads the clock, and a comparator whose inputs move mid-sort is not a consistent ordering:

```ts
    const keyed = rows.map((row) => ({ row, sortable: this.sortableRow(row) }));
    const sorted = keyed
      .sort((a, b) => compareRows(a.sortable, b.sortable, this.sortState))
      .map(({ row }) => row);
```

  (replacing the existing `const sorted = [...rows].sort(...)`; the rest of `sortBody` is unchanged).

- [ ] **Step 7: GREEN.** Re-run the focused test (all `table-sort` tests pass), then `make tsc` and
  `make lint`. Keep the output.

- [ ] **Step 8: Commit** — `feat(web): the Today sort compares the figure a row shows (#183)`.

---

## Task 2: Re-sort on a timer start, stop or switch — never on a tick

**Files:** `web/src/components/that-table.ts`, new `.claude/e2e/tests/today-sort-timer.spec.ts`

- [ ] **Step 1: Write the browser specs (RED).** Create
  `.claude/e2e/tests/today-sort-timer.spec.ts`. Model its stubs on `timer.spec.ts` and
  `table.spec.ts` (read both first; do not import from them — spec files do not share helpers here).
  It needs, per test, one closure-held state:

  - `**/api/issues` → one instance `{ id: 1, name: "Work", issues: [WORK-1 "Ahead", WORK-2 "Behind"] , error: null }`
    (fields as in `timer.spec.ts`'s `stubToday`).
  - `**/api/pins**` → `[]`.
  - `**/api/entries**` → GET answers `{ today: DAY, entries }` from a mutable list seeded with
    WORK-1 at 3600 s (shows `1:00`) and WORK-2 at 3540 s (shows `0:59`); entries shaped like
    `timer.spec.ts`'s `close()` output (`instanceId: 1`, `instanceName: "Work"`,
    `instancePosition: 0`, `day: DAY`, `pushState: "unpushed"`).
  - `**/api/timer`, `**/api/timer/start`, `**/api/timer/stop` as below.

  Helpers: `rowKeys(table)` and the instance table locator `that-table[sort-id="instance-1"]` as in
  `table.spec.ts`; `figures(table)` returns each row's `td.c-today .that-tnum` text in DOM order;
  a `parseFigure("H:MM")` to minutes; and an assertion helper that the figures, read in row order,
  never increase (the order matches the displayed figures).

  **Test A — "ticks never re-sort a table sorted by Today; stopping the timer does".**
  1. `await page.clock.install({ time: T0 })` with a fixed `T0` (e.g.
     `Date.parse("2026-09-23T10:00:00Z")`), before `page.goto("/today")`.
  2. Stubs: `/api/timer` GET → `{ running, stopped: null }`; `/start` sets
     `running = { instanceId, issueKey, startedAt: new Date(T0).toISOString() }` and returns
     `{ running, stopped: null }`; `/stop` computes the run's seconds from the *page's* clock
     (`await page.evaluate(() => Date.now())` minus `T0`, floored to seconds), pushes an entry for
     WORK-2 with those seconds into the entries list, clears `running`, and returns
     `{ stopped: <that entry>, discarded: false }`.
  3. Click the table's `th.c-today button` once; expect order `["WORK-1", "WORK-2"]`, figures
     `["1:00", "0:59"]`.
  4. Click WORK-2's `start timer` button; expect its `stop timer` button.
  5. `await page.clock.runFor(60_000)` then again `runFor(60_000)`; after each, assert the order is
     **still** `["WORK-1", "WORK-2"]` (ticks alone do not re-sort). After the second, WORK-2's
     figure reads `1:01` and WORK-1's `1:00` — the drift the ticket accepts.
  6. Click WORK-2's `stop timer`. Expect order `["WORK-2", "WORK-1"]` (poll), figures
     `["1:01", "1:00"]`, and the never-increasing assertion to hold.

  **Test B — "a timer the page learns of after its rows arrive re-sorts the table".** This is the
  one that isolates the timer-changed re-sort from an entries refresh.
  1. `/api/timer` GET waits on a promise the test resolves (`let release!: () => void` is fine in
     the spec — the non-null ban is `web/src` only; or use `Promise.withResolvers` if the rig's
     Node has it), then answers `running = { instanceId: 1, issueKey: "WORK-2", startedAt: new
     Date(Date.now() - 120_000).toISOString() }`. No `page.clock` here.
  2. `goto("/today")`, click Today's header; expect `["WORK-1", "WORK-2"]`.
  3. Resolve the gate. Expect (poll) `["WORK-2", "WORK-1"]`, WORK-2's figure `1:01`, and the
     never-increasing assertion to hold.

- [ ] **Step 2: Run it and see Test B fail (RED).**
  `docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test today-sort-timer'`
  (then `docker compose --profile e2e rm --stop --force app-e2e`). Expected: Test B fails on both
  browsers — the order stays `["WORK-1", "WORK-2"]` because nothing re-sorts when the timer arrives.
  Test A may already pass (the stop's entries refresh re-sorts through the `seconds` attribute);
  that is fine, its job is pinning the tick behaviour. Keep the output. If Test A fails for a
  reason other than the missing feature (clock, stub), fix the spec before going on.

- [ ] **Step 3: Implement in `that-table.ts`.** Import `currentTimer` and `onTimerChanged` alongside
  `elapsedFor`. Add a module-level function:

```ts
/** Which run is on, if any. A tick leaves this unchanged; a start, stop or switch does not. */
function runIdentity(): string {
  const timer = currentTimer();

  return timer === null ? "" : `${String(timer.instanceId)}:${timer.issueKey}:${timer.startedAt}`;
}
```

  A field `private stopTimerListening: (() => void) | undefined;`. At the end of
  `connectedCallback`:

```ts
    // onTimerChanged fires on every tick too. Re-sorting then would move rows
    // once a second while they are read, so only a change of run re-sorts (#183).
    let seenRun = runIdentity();
    this.stopTimerListening = onTimerChanged(() => {
      const run = runIdentity();
      if (run === seenRun) return;
      seenRun = run;
      this.sortBody();
    });
```

  In `disconnectedCallback`: `this.stopTimerListening?.(); this.stopTimerListening = undefined;`.
  Update the `isOwnRowChange` doc comment's "soon #8's per-second timer" wording only if it is now
  inaccurate (it is: #8 has shipped) — say the tick is ignored there and handled by the run check.

- [ ] **Step 4: GREEN.** Re-run the focused spec on both browsers — both tests pass. Then
  `make verify`. Keep the output.

- [ ] **Step 5: Commit** — `feat(web): the Today sort follows a timer start, stop or switch (#183)`.
