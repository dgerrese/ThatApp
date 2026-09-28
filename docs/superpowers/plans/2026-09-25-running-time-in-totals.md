# Running time counts in Today's totals (#204) Implementation Plan

**Date:** 2026-09-25
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While a timer runs, the rail's day total, the running instance's split slice and that
instance card's tally on Today include the elapsed time, to the minute, as the running row already does.

**Architecture:** `GET /api/timer`'s running DTO gains `instanceName` and `instancePosition`, so the
rail can draw a slice for an instance with no entries yet. The rail keeps the last entries it painted
and, on the Today period only, adds `elapsedSeconds()` to the total and the running instance's slice on
every `onTimerChanged`. Today's `paintInstanceTallies` adds it to the running instance's tally. Both
write to the DOM only when the minute-floored text changes.

**Tech Stack:** Go (net/http, httptest), vanilla TypeScript, Playwright with `page.clock`.

**Spec:** the refined body of Codeberg issue #204 (`tea api "repos/{owner}/{repo}/issues/204" | jq -r .body`).
Read it first: it settles the Today-only rule, the cadence, what stays unchanged and the accepted ceiling.

## Global Constraints

- All commands through `make` or `docker compose`; no Go or Node on the host.
- Go: stdlib first; table-driven tests with `t.Run`; `httptest`; wrap errors with `%w`.
- TypeScript strict; no `any`, `as any` or non-null assertion. Few comments, only the why.
- The running time counts on the **Today period only** (Today, and Settings, which borrows it). On
  Week the rail total keeps matching the grid footer.
- Unchanged: the unpushed count, the push button's enabled state, the push confirmation's total.
- The totals keep their ink colour; the running tone stays on the timer and its stop control.
- Keep the 1-second tick. A repaint writes only when the text changes (once a minute in practice),
  and the split's DOM is not rebuilt more than once per minute.

## Review Focus

1. **A running instance with no entry today** must still get a slice, named and placed by position.
   Test in Task 2.
2. **Switching period to Week while a timer runs** must drop the elapsed time from the rail at once,
   and switching back must add it again. Test in Task 2.
3. **The running row sits in Pinned** (not in its instance card): the instance card's tally still
   includes the elapsed time, because the tally counts the instance's whole day. Test in Task 3.
4. **A stop**: the figures equal logged time plus the rounded entry once the entries re-read lands
   (the one-request dip is accepted). Test in Task 2 or 3.
5. **The push count and push dialog total** do not move across a run. Test in Task 2.

---

### Task 1: the running timer carries its instance's name and position

**Files:**
- Modify: `internal/server/timer.go` (`timerDTO`, `timerDTOFrom` and its two callers)
- Modify: `web/src/types.ts` (`RunningTimer`)
- Test: `internal/server/timer_test.go` (or the file holding the `GET /api/timer` handler tests)

`timerDTO` gains `InstanceName string \`json:"instanceName"\`` and `InstancePosition int
\`json:"instancePosition"\``, filled exactly the way `entryDTOFrom` (internal/server/entries.go)
gets `inst.Name` and `position` — find how its callers resolve the instance and its position and do
the same, without a second definition of "position". `RunningTimer` in types.ts gains
`instanceName: string; instancePosition: number;`.

- [ ] Step 1: failing table-driven handler test: with a running timer on the second instance,
  `GET /api/timer` answers `running.instanceName` = that instance's name and `running.instancePosition`
  = its position (1). Run `docker compose run --rm --no-deps app go test ./internal/server/ -run Timer -v`;
  FAIL.
- [ ] Step 2: implement; PASS. Also cover `POST /api/timer/start`'s running DTO if it goes through
  `timerDTOFrom` (it does: timer.go line ~147).
- [ ] Step 3: `make verify`. Commit: `The running timer names its instance and position (#204)`.

---

### Task 2: the rail's total and split count the running time on Today

**Files:**
- Modify: `web/src/rail.ts` (`startRail`'s `paint`, `sliceByInstance`/`drawSplit`, the
  `onTimerChanged` subscription)
- Test: `.claude/e2e/tests/timer.spec.ts` (it already stubs a running timer; read its helpers)

**Interfaces:** consumes Task 1's `RunningTimer.instanceName`/`instancePosition`.

Behaviour:
- `paint(entries)` stores the entries it painted (`lastEntries`). A new `paintFigures()` computes the
  total and the slices from `lastEntries`, and — only when `currentPeriod === TODAY_PERIOD` and a
  timer runs — adds `elapsedSeconds()` to the total and to the running instance's slice, creating that
  slice from `currentTimer()`'s `instanceName`/`instancePosition` when no entry has one.
- `onTimerChanged` calls `paintFigures()` (keep the existing `paintTimer` subscription). A period
  change repaints through the existing path, which must use the same `paintFigures()`.
- Write `total.textContent` only when it differs. Rebuild the split only when a signature of its
  slices (each slice's position and `totalFigure(seconds)`) differs from the last one drawn.
- `pending`, the unpushed line and the push button stay computed from entries only.

- [ ] Step 1: failing e2e tests, both browsers, with `page.clock` (install the clock before
  `page.goto`; see Playwright's `page.clock.install`/`runFor`). Stub one entry on instance A (1h) and a
  timer running on instance A for 59m50s:
  1. On Today the rail total reads 1h 59m; after `page.clock.runFor(10_000)` it reads 2h 00m; the
     running instance's split figure moves the same way.
  2. The split's figures element keeps its node identity across ticks within one minute (grab it,
     `runFor(5_000)`, assert the same node via `evaluate` on a marker you set on it).
  3. A timer running on instance B with no entries: B gets a split slice with its name.
  4. On Week (navigate), the rail total equals the grid footer's total; back on Today it includes the
     elapsed time again.
  5. "N entries to push" is the same before the run and while it runs.
- [ ] Step 2: run; FAIL; paste it.
- [ ] Step 3: implement; run `timer.spec.ts`, `entries.spec.ts`, `push.spec.ts`, `week.spec.ts`; PASS.
- [ ] Step 4: `make verify`. Commit: `The rail's total and split count the running time on Today (#204)`.

---

### Task 3: Today's instance tally counts the running time

**Files:**
- Modify: `web/src/views/today.ts` (`paintInstanceTallies`, and its mount: subscribe
  `onTimerChanged` with `registerTeardown`, as the ticket says)
- Test: `.claude/e2e/tests/timer.spec.ts` or `today-sort-timer.spec.ts`

`paintInstanceTallies(regions)` adds `elapsedSeconds()` to the tally whose instance id equals
`currentTimer()?.instanceId`, wherever the running row sits (Pinned included). An `onTimerChanged`
subscription at mount (torn down with `registerTeardown`) repaints the tallies from `regions.totals`.
Write `tally.textContent` only when it differs.

- [ ] Step 1: failing e2e tests with `page.clock`: the running instance card's tally reads "N issues ·
  1h 59m" and moves to 2h 00m after the minute; the same holds when the running ticket is pinned (its
  row in Pinned, the tally on its instance card); after a stop (stub the stop and the entries re-read
  with the rounded entry), the tally equals logged plus the rounded entry.
- [ ] Step 2: run; FAIL; paste it.
- [ ] Step 3: implement; run `timer.spec.ts`, `today.spec.ts`, `today-sort-timer.spec.ts`, `pins.spec.ts`; PASS.
- [ ] Step 4: `make verify` and the FULL `make test-e2e`; paste both. Commit:
  `Today's instance tally counts the running time (#204)`.
