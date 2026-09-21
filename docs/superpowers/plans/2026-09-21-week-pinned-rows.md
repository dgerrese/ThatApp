# A pinned ticket has a row in the current week (#139) Implementation Plan

**Date:** 2026-09-21
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pinned ticket has a row in Week's current week whether or not any time was logged
against it there.

**Architecture:** The server supplies the row so it survives a reload; the client supplies the
immediacy. `/api/week` seeds an empty row for every pinned ticket the rollup does not already carry,
**only when the requested week is the current week** in `THAT_TIMEZONE`. Week's existing pin control
additionally adds the ticket to `addedTickets`, the `Map` in `render()`'s closure that already gives
search-added rows their "appears now, lasts until the view is left" behaviour.

**Tech Stack:** Go (`internal/server/week.go`), TypeScript (`web/src/views/week.ts`), Playwright.

**Spec:** Codeberg issue #139 — `tea api "repos/{owner}/{repo}/issues/139"`.

## What is already decided, and must not be reopened

**The row's appearance was settled on 2026-09-10 and is already built.** Decision 1 of
[`2026-09-10-week-rows-and-global-search-design.md`](../specs/2026-09-10-week-rows-and-global-search-design.md)
drew three shapes — an ordinary row, a row whose key carries a pin glyph, and a foot section of
empty rows under a rule — and the owner chose **the ordinary row**: no mark of any kind, an em dash
in each of the seven day cells and in the row total, in the grid's existing order. `syntheticRow`,
`compareRows` and `mergeRows` in `week.ts` already do this for search-added rows, and
`week.spec.ts` already asserts it.

**Do not** add a pin glyph, a grouping, a foot section, or any mark distinguishing a pinned row from
a worked one. A pinned row and a searched-in row are deliberately indistinguishable.

**Settled with the owner on 2026-09-21:**

1. **Current week only.** A pinned ticket gets a row in the week containing today and in no other.
   Navigating back to a closed week shows what that week contained.
2. **A pin adds its row at once; an unpin does not take it away** — the row goes when the view is
   left.
3. **An empty pinned row counts nowhere:** not a day total, not the week total, not the rail's push
   count. This is arithmetic, not a choice — the row carries no entries.

## Global Constraints

- No Go, Node or npm on the host; everything runs through `make` or `docker compose`.
- The owner's dev stack (`app`, `web`) is theirs: never `make down`, never stop or recreate it.
- **Never touch the working tree while a suite run is in flight** — the `app-e2e` service mounts
  `.:/src`, so a `git switch` mid-run makes the app serve different code to already-loaded specs.
  Read other branches with `git show <ref>:<path>`.
- Go: standard library first, wrap errors with `%w`, table-driven tests with `t.Run` subtests using
  `httptest` and `testing/fstest`. No test contacts a real Jira instance.
- TypeScript: `strict` with `noUncheckedIndexedAccess`. No `any`, no non-null assertion.
- Comments are few and explain a non-obvious why.
- Commit unsigned with `git -c commit.gpgsign=false commit …` if signing fails; **never push**.

---

### Task 1: The server gives the current week its pinned rows

**Files:**
- Modify: `internal/server/week.go`
- Modify: `internal/server/week_test.go`
- Modify: `docs/superpowers/specs/2026-09-02-week-view-design.md`

**Interfaces:** `rollUp` gains a parameter. Task 2 does not call it.

- [ ] **Step 1: RED — a pinned ticket with no entries has no row**

Add a table-driven test to `internal/server/week_test.go` that seeds a pin with no entries and reads
`/api/week` for the current week, asserting a row exists for it with seven zero cells and zero
seconds. Run it and watch it fail:

```shell
docker compose run --rm --no-deps app go test ./internal/server/ -run TestWeek -v
```

Paste the failing output into your report. It must fail because the row is absent, not because the
test is malformed.

- [ ] **Step 2: Thread pins into the rollup**

`handleWeek` currently ends:

```go
entries, err := s.db.EntriesForDay(r.Context(), start, end)
...
writeJSON(w, http.StatusOK, rollUp(startAt, entries, instances, positions))
```

Read the pins **only for the current week**, and pass them down. The current week's Monday is
`mondayOf(s.now().In(s.cfg.Location))` — the same expression `weekRangeParam` already uses for its
default, and it must stay that way so the two cannot disagree.

`rollUp` takes a new `pinned []store.Pin` parameter (nil for any other week) and, after building
`byCell` from entries and before collecting `keys`, seeds a cell block for each pinned ticket it does
not already hold:

```go
for _, pin := range pinned {
    key := rowKey{instanceID: pin.InstanceID, issueKey: pin.IssueKey}
    if _, seen := byCell[key]; seen {
        continue
    }
    if _, known := instances[pin.InstanceID]; !known {
        continue
    }
    byCell[key] = make([][]store.Entry, daysInWeek)
}
```

The `instances` guard matters: a row for an unknown instance would render with an empty name and a
meaningless URL. Everything downstream then works unchanged — the existing sort places the row by
instance position then issue key, the seven empty cells produce zero seconds and a nil push state,
and `byDay` is untouched so no total moves.

- [ ] **Step 3: GREEN, and the table that a refactor would fail**

Re-run the test from step 1. Then extend it into a table covering, at minimum:

| case | expectation |
|---|---|
| pinned, no entries, current week | one row, seven zero cells, zero row seconds |
| pinned, entries this week | **exactly one** row, carrying the real figures — not two |
| pinned, no entries, **past** week | **no** row |
| pinned, no entries, **future** week | **no** row |
| pinned ticket + logged ticket | both rows, in instance-position then issue-key order |
| pinned, no entries | day totals, week total and every `pushState` unchanged |

**The day-boundary case is the one that matters most** and `CLAUDE.md` names it a risk area. Drive
`s.now()` to an instant where the machine's UTC date and the `THAT_TIMEZONE` date differ — late
evening in `Pacific/Kiritimati` or early morning in `America/Los_Angeles` — and assert the pinned row
appears for the *local* current week, not the UTC one. A refactor that swapped `s.now().In(loc)` for
`time.Now()` must fail this test.

- [ ] **Step 4: Correct the design of record**

`docs/superpowers/specs/2026-09-02-week-view-design.md` already describes how an empty row *looks*
(decision 1 of the 2026-09-10 design). It does not say *when* one appears. Add that: a pinned ticket
produces a row in the current week only, and a closed week shows what it contained rather than what
is pinned now. Say why the special case exists, so the next reader does not "simplify" it away.

- [ ] **Step 5: Gate**

```shell
make verify
```

Green, pasted into your report.

---

### Task 2: A pin adds its row without waiting for a read

**Files:**
- Modify: `web/src/views/week.ts`
- Modify: `.claude/e2e/tests/week.spec.ts`

**Interfaces:** depends on Task 1 only in that the server may already send the row; this task is
about the *unread* case and must work on its own.

- [ ] **Step 1: RED — pinning from Week's panel changes nothing on screen**

In `.claude/e2e/tests/week.spec.ts`, add a test that opens Week's search panel, presses the **pin**
control on a result (not the add-to-week control), and expects a row for that ticket to appear in the
grid without any navigation or refresh. Run it on both engines and watch it fail:

```shell
make test-e2e
```

Paste the failing output. It fails because `onPress` for the pin control calls only `createPin`.

- [ ] **Step 2: The pin control also adds the row**

In `weekSearchConfig`, the pin control's `onPress` currently reads:

```ts
onPress: (hit) => {
  void createPin(hit.instanceId, hit.key).catch(onPinFailure);
},
```

It must also do what the add-to-week control does — put the ticket into `addedTickets` — so the row
appears immediately. Thread the existing `onAdd` closure into the pin control rather than inventing a
second path; `mergeRows` already skips a ticket the rollup carries for real, so there is no
double-row risk.

**Do not add a subscription to pin changes.** Decision 2 is satisfied by `addedTickets` alone, and a
subscription would be new machinery for a case that does not need it. The comment above the pin
control explaining that Week draws no pin mark of its own stays as it is — it is still true.

- [ ] **Step 3: GREEN, plus the unpin half**

Re-run. Then add a test for the other half of decision 2: after pinning and then unpinning while
Week is still on screen, **the row is still there**. It goes only when the view is left. This is the
behaviour `addedTickets` already has ("an add lasts until the view is left, full stop") and the test
exists so a later change cannot quietly turn it into a row that vanishes under the cursor.

- [ ] **Step 4: Verify against the drawing**

The row's appearance is drawn: decision 1 of the 2026-09-10 design, and the prototype at
`docs/superpowers/prototypes/2026-09-03-app-prototype.html`. Compare what you built against it and
**say in your report what you compared and what you found** — seven em dashes, an em-dash row total,
no pin glyph, no grouping, ordinary position in the sort. "Looks right" is not a comparison. If the
build has to differ from the drawing, report it rather than absorbing it.

- [ ] **Step 5: Gates**

```shell
make verify
make test-e2e
```

Both green, pasted into your report. `make test-e2e` takes about a minute.

## Verification

- A pinned ticket with no entries has a row in the current week, with seven em dashes and an em-dash
  total, indistinguishable from any other row.
- That row survives a reload, and is absent in past and future weeks.
- A pinned ticket that was also worked this week yields exactly one row with its real figures.
- Pinning from Week's panel shows the row at once; unpinning leaves it until the view is left.
- Day totals, the week total and the push count are unmoved by an empty pinned row.
- The week-view design of record says when a pinned row appears.
- `make verify` and `make test-e2e` green.
