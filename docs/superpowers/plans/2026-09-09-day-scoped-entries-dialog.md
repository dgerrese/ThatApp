# The entries dialog, scoped to a day — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-09-09
**Supersedes:** nothing
**Superseded by:** nothing

**Goal:** A cell in Week opens a dialog that lists, adds to and says the day it was opened for,
instead of silently showing and editing today.

**Architecture:** A day travels with the dialog rather than being computed anywhere in the browser.
Week reads it out of the rollup the server already sent; Today sends none, which still means "today
as the server resolves it". `POST /api/entries` gains an optional day and keeps stamping
`started_at` itself, so an entry whose start contradicts its day stays unconstructible. Because
every dialog now names its day, and Today's has none to name, `GET /api/entries` gains an envelope
carrying the date the server resolved.

**Tech Stack:** Go standard library with `modernc.org/sqlite`, vanilla TypeScript (`strict`,
`noUncheckedIndexedAccess`), Tailwind v4 with tokens in `@theme`, `node --test` for unit tests,
Playwright for end-to-end.

**Spec:** [`docs/superpowers/specs/2026-09-09-day-scoped-entries-dialog-design.md`](../specs/2026-09-09-day-scoped-entries-dialog-design.md),
which holds the four decisions of the 2026-09-09 design session. The ticket is
[#105](https://codeberg.org/DionGerrese/ThatApp/issues/105) and carries the acceptance criteria.
Also binding: [`2026-08-21-manual-time-entry-design.md`](../specs/2026-08-21-manual-time-entry-design.md)
and [`2026-08-04-thatapp-design.md`](../specs/2026-08-04-thatapp-design.md), both corrected by Task 6.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Local development runs in Docker.** No Go, Node or npm on the host. Everything through `make` or
  `docker compose run --rm --no-deps <service> <cmd>`.
- **The browser never derives a date.** `day` is the user's local date resolved in `THAT_TIMEZONE`,
  and the container's clock is UTC. Every date in the browser came from a server response. A `new
  Date()` used to work out which day it is, anywhere in this plan, is a defect.
- **`started_at` is stamped by the server, always**, and is never editable. `PATCH` refuses both
  `day` and `startedAt`.
- **Go: standard library first.** Wrap errors with `%w` and context about what was attempted.
  Table-driven tests with `t.Run` subtests, `httptest` and `testing/fstest` — never real network or
  filesystem. **No test ever contacts a real Jira instance.**
- **TypeScript is `strict` with `noUncheckedIndexedAccess`.** No `any`, no `as any`, no non-null
  assertion to get past a type error. `tsconfig.json` is not to be weakened.
- **Tailwind v4, CSS-first.** Theme values live in `@theme` in `web/src/styles.css`;
  `web/src/vocabulary.test.ts` forbids arbitrary literals for some properties.
- **Reusable UI is a `that-*` WebComponent in light DOM.** Never shadow DOM.
- **Comments are few** — a non-obvious why, an external workaround, a subtle invariant.
- **A function's name must let a reader predict what it returns.**
- **A middot between two facts is typography**, not an icon.
- Commit style: `feat(#105):` / `fix(#105):` / `docs(#105):`, a body explaining why, and the trailers
  the session uses.

## The state this branch starts from

`issue-105-day-scoped-dialog` is cut from `issue-117-prototype-drift`, **which is open as PR #128 and
not yet merged**. #117 changed the dialog's edge, its row tooltips, the shared control height, the
card surface and the page heading. Nothing in this plan revisits any of that. If #117 rebase-merges
before this branch opens its own pull request, this branch rebases onto the new `main` first.

## File structure

| File | What changes |
| --- | --- |
| `internal/server/entries.go` | The list response becomes an envelope; `POST` accepts an optional day and stamps local midnight for it. |
| `internal/server/entries_test.go` | The envelope, the day's validation, the midnight stamp, and that `PATCH` still refuses both fields. |
| `web/src/api.ts` | `listEntries` returns the envelope; `createEntry` sends an optional day. |
| `web/src/types.ts` | `EntriesResponse`, `EntryTicket.day`, `EntryDraft.day`. |
| `web/src/rail.ts` | Three reads move to the envelope. |
| `web/src/views/today.ts` | Its totals read moves to the envelope. |
| `web/src/components/that-entry-dialog.ts` | Reads its own day, sends it, names it, and scopes what it announces. |
| `web/src/format.ts` | `longDay()` — a `YYYY-MM-DD` rendered as `Monday 8 September`. |
| `web/src/views/week.ts` | Cells pass their day; the view subscribes to the announcement. |
| `.claude/e2e/tests/*.spec.ts` | 26 stubs of `/api/entries` across ten files move to the envelope. |
| `docs/superpowers/specs/2026-08-04-thatapp-design.md`, `…/2026-08-21-manual-time-entry-design.md` | The rule that a client may never name a day. |

## Task order, and the one place it is forced

Six tasks. **Task 1 is the largest and cannot be split**: the moment the server returns an envelope,
every consumer that expects a bare array is broken, so the server change, the client migration and
the end-to-end stubs land together or the gate is red in between. Everything after it is additive.

---

### Task 1: The envelope, end to end

**Covers:** the `GET /api/entries` criterion.

**Files:**
- Modify: `internal/server/entries.go` (`handleListEntries`), `internal/server/entries_test.go`
- Modify: `web/src/types.ts`, `web/src/api.ts`
- Modify: `web/src/rail.ts`, `web/src/views/today.ts`, `web/src/components/that-entry-dialog.ts`
- Modify: every `/api/entries` stub in `.claude/e2e/tests/` — 26 across ten files

**Interfaces:**
- Produces: `EntriesResponse { today: string; entries: Entry[] }` in `web/src/types.ts`, and
  `listEntries(range?): Promise<EntriesResponse>`. Later tasks consume `today` and `entries` by name.

**The shape:**

```json
{ "today": "2026-09-09", "entries": [ … ] }
```

`today` is the date the server resolved when it answered, in `THAT_TIMEZONE` — the same value
`handleListEntries` already computes for its own bounds default. **It is `today` in every response,
ranged or not**, and it does not describe the range. The spec's Decision 3 says why.

- [ ] **Step 1: Write the failing Go test**

In `internal/server/entries_test.go`, against a server whose location is not UTC and whose clock is
a fixed UTC instant near midnight, assert the response is an object whose `today` is the date in the
configured zone, and whose `entries` hold what the bare array held before. The suite already has a
helper for a server in a zone — use it rather than building a second one.

- [ ] **Step 2: Run it and watch it fail**

Run: `docker compose run --rm --no-deps app go test ./internal/server/ -run TestListEntries -v`
Expected: FAIL — the response decodes as an array.

- [ ] **Step 3: Make the handler write the envelope**

`handleListEntries` already computes `today` for its bounds; return it alongside the DTOs rather
than computing it twice.

- [ ] **Step 4: Move the client's type and call**

`EntriesResponse` in `types.ts`; `listEntries` returns it. Then follow the type errors — `tsc` will
name every consumer, which is the cheapest possible migration list.

- [ ] **Step 5: Move each consumer**

`rail.ts` reads entries at boot, before a push and after one; `today.ts` reads them for totals; the
dialog reads them in `reload`. Each takes `.entries`. **No consumer may start using `today` in this
task** — that is Task 4's, and a consumer that quietly starts formatting a date here is doing Task 4
without its tests.

- [ ] **Step 6: Move the stubs**

26 sites answer `/api/entries` with a bare array. Each becomes `{ today: "…", entries: [ … ] }`. Give
each a date that suits its test rather than one global constant: a stub claiming a day its
assertions contradict is worse than the array it replaced.

- [ ] **Step 7: Run both gates**

Run: `make verify` and `make test-e2e`. Paste both.

- [ ] **Step 8: Commit**

```bash
git add internal/server web/src .claude/e2e/tests
git commit -m "feat(#105): the entries response says which day the server resolved"
```

---

### Task 2: A create may name its day

**Covers:** the `POST` criteria, and the one that says `PATCH` still refuses.

**Files:**
- Modify: `internal/server/entries.go` (`createEntryRequest`, `handleCreateEntry`)
- Modify: `internal/server/entries_test.go`

**Interfaces:**
- Produces: `POST /api/entries` accepts `{ …, "day": "YYYY-MM-DD" }`, optional. Absent means today.

**The rules, exactly:**

- A malformed or impossible date is `400 invalid_request`, by the same `time.Parse` rule `dayParam`
  already uses — `2026-02-30` is "day out of range", not 2 March.
- **A day given means `started_at` is local midnight of that day in `THAT_TIMEZONE`.** Absent means
  today, stamped exactly as it is now, from one reading of the clock.
- `PATCH` is untouched and still refuses `day` and `startedAt`.

- [ ] **Step 1: Write the failing tests, table-driven**

Cases: no day (today, unchanged); a past day (midnight in the zone, asserted as an instant, not a
string); a malformed day; an impossible day; a day far in the past, which is legal. The container's
clock is UTC and the configured zone is not, which is the whole point of the assertion.

- [ ] **Step 2: Run them and watch them fail**

Run: `docker compose run --rm --no-deps app go test ./internal/server/ -run TestCreateEntry -v`
Expected: FAIL — the field is dropped, so a past day lands on today.

- [ ] **Step 3: Accept and validate the day**

Add it to `createEntryRequest` with a comment saying why it is now allowed, replacing the one that
says it never can be. Validate before touching the store.

- [ ] **Step 4: Stamp midnight**

`time.Date(y, m, d, 0, 0, 0, 0, s.cfg.Location)` for a given day; `s.now()` otherwise. One reading
of the clock either way.

- [ ] **Step 5: Prove `PATCH` is unchanged**

If no test asserts that `PATCH` ignores `day` and `startedAt`, add one now — the criterion asks for
it and the plan's own change is what makes it worth guarding.

- [ ] **Step 6: Run the Go suite, then the gates**

- [ ] **Step 7: Commit**

```bash
git add internal/server
git commit -m "feat(#105): a create may name its day, and the server stamps its midnight"
```

---

### Task 3: The day travels with the dialog

**Covers:** `EntryTicket` carrying a day, the dialog reading its own day, and the scoped
announcement.

**Files:**
- Modify: `web/src/types.ts` (`EntryTicket`, `EntryDraft`)
- Modify: `web/src/components/that-entry-dialog.ts` (`reload`, the add path)
- Modify: `web/src/api.ts` (`createEntry`)
- Test: `.claude/e2e/tests/entries.spec.ts`

**Interfaces:**
- Consumes: `EntriesResponse` from Task 1.
- Produces: `EntryTicket.day?: string`. Week sets it in Task 5; Today never does.

**The three behaviours:**

1. **The read.** `listEntries({ from: day, to: day })` when the ticket has a day, a bare
   `listEntries()` when it does not.
2. **The add.** `createEntry` sends the day when there is one. The comment and duration are
   unchanged.
3. **The announcement is scoped.** `announceEntriesChanged(entries)` documents its payload as *the
   day's* entries, and Today's listener repaints from whatever it is handed. **A dialog scoped to a
   day that is not today announces with no payload**, so every listener re-reads its own period
   instead of painting another day's rows into Today's.

That last one is the subtle half, and it is invisible on screen: the test for it asserts that
Today's durations are unchanged after an add against a past day, not merely that something
happened.

- [ ] **Step 1: Write the failing end-to-end assertions**

A dialog opened with a day lists only that day's entries; adding sends the day; Today's figures do
not move when a past day's dialog adds time.

- [ ] **Step 2: Run them and watch them fail**

- [ ] **Step 3: Carry the day through the three paths**

- [ ] **Step 4: Run both gates**

- [ ] **Step 5: Commit**

```bash
git add web/src .claude/e2e/tests/entries.spec.ts
git commit -m "feat(#105): the dialog reads, writes and announces its own day"
```

---

### Task 4: The dialog says which day it is for

**Covers:** the header's day line and the empty-state line.

**Files:**
- Modify: `web/src/format.ts` and `web/src/format.test.ts`
- Modify: `web/src/components/that-entry-dialog.ts` (`header`, `emptyLine`)
- Test: `.claude/e2e/tests/entries.spec.ts`

**Interfaces:**
- Consumes: `EntryTicket.day` from Task 3, `EntriesResponse.today` from Task 1.
- Produces: `longDay(day: string): string` — `"2026-09-08"` becomes `"Monday 8 September"`.

**What the design settled**, from Decision 1, 2 and 4 of the spec:

- The day sits **on the line beneath the key**, written in full, in the ink and size the summary line
  uses — `text-ink-muted`, 14px, the existing `.etitle` treatment.
- **Every dialog names its day.** Today's has none of its own, so it names the `today` the envelope
  carried. Where a summary also exists, **the day sits above it**.
- The empty line reads `Nothing logged against this ticket on Monday 8 September.` when the dialog is
  scoped, and keeps `… today.` when it is not.

**`longDay` must not construct a date from parts and read it back.** Parsing `YYYY-MM-DD` into a
`Date` and formatting it drags in the browser's own zone, which is the one thing this whole ticket is
about. Split the string, index the month and weekday names, and compute the weekday arithmetically —
the function takes a string and returns a string, and touches no clock. That is what makes it a unit
test rather than an end-to-end one.

- [ ] **Step 1: Write the failing unit tests for `longDay`**

```ts
test("a day renders as its full weekday and month", () => {
  assert.equal(longDay("2026-09-08"), "Monday 8 September");
  assert.equal(longDay("2026-01-01"), "Thursday 1 January");
  assert.equal(longDay("2024-02-29"), "Thursday 29 February");
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `docker compose run --rm --no-deps web node --test 'src/format.test.ts'`

- [ ] **Step 3: Write `longDay`**

- [ ] **Step 4: Write the failing dialog assertions**

The day line's text and its position above the summary; the empty line's two wordings.

- [ ] **Step 5: Render the day and the empty line**

- [ ] **Step 6: Run both gates**

- [ ] **Step 7: Commit**

```bash
git add web/src .claude/e2e/tests/entries.spec.ts
git commit -m "feat(#105): the dialog names the day it is showing"
```

---

### Task 5: Week passes its day, and hears about changes

**Covers:** Week's cells passing the day, Week's subscription, and the end-to-end assertion that a
past cell's add reaches every total.

**Files:**
- Modify: `web/src/views/week.ts`
- Test: `.claude/e2e/tests/week.spec.ts`

**Interfaces:**
- Consumes: `EntryTicket.day` from Task 3.

**Where the day comes from:** `rollup.days[index].day`, the string the server sent. Week derives no
date, and the criterion says so explicitly.

**The subscription** mirrors Today's: `onEntriesChanged` returns its own unsubscribe, and Week
registers that with the teardown the router already calls on navigation. A subscription that
outlives the view repaints a grid that is no longer on screen.

- [ ] **Step 1: Write the failing end-to-end assertion**

Open a past Monday's cell, add time, and assert the cell, its row total, that day's total and the
week total all move — and that the dialog listed that Monday rather than today.

- [ ] **Step 2: Run it and watch it fail**

- [ ] **Step 3: Pass the day from the rollup**

- [ ] **Step 4: Subscribe, and tear it down**

- [ ] **Step 5: Run both gates**

- [ ] **Step 6: Commit**

```bash
git add web/src/views/week.ts .claude/e2e/tests/week.spec.ts
git commit -m "feat(#105): a week's cell opens its own day, and hears when it changes"
```

---

### Task 6: The two specs that say this is impossible

**Covers:** the last criterion.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-04-thatapp-design.md`
- Modify: `docs/superpowers/specs/2026-08-21-manual-time-entry-design.md`

Both say, in as many words, that a browser cannot post itself into another day. **Correct each in
place, in the document's own voice**, saying what the rule is now and why the invariant it protected
still holds: the client still never sends a start time, so an entry whose `started_at` contradicts
its `day` is still unconstructible. Cite #105.

Do not delete the old sentence without replacing its reasoning — the next reader needs to know the
rule changed deliberately, not that it was forgotten.

- [ ] **Step 1: Correct both documents**
- [ ] **Step 2: Run `make verify`**
- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs
git commit -m "docs(#105): a client may name a day, and what still cannot be constructed"
```

---

## Finishing

1. **The whole-branch review is not optional**, and this branch's own risk is Task 1: a shape change
   that reached six consumers and 26 stubs.
2. **`make verify` and `make test-e2e` both green, output pasted into the pull request.**
3. **Tick the ticket's criteria as the reviews confirm them**, and untick anything a later pass
   shows regressed.
4. **Open the pull request with `Closes #105`.** The ticket keeps `status/in-progress`; the open
   pull request is the review state.
5. **Never merge to `main` locally.** Push and open the pull request, or leave the branch alone.

## Risks worth stating before starting

- **Task 1 is the whole ticket's risk in one commit.** Every reader of `/api/entries` moves at once,
  and a stub left as a bare array fails in a way that looks like a product bug.
- **The scoped announcement is invisible.** Nothing on screen shows that Today declined to repaint
  from another day's rows; only a test that asserts Today's figures did not move will catch its
  regression.
- **`longDay` is where a browser-derived date would sneak in.** If it ever takes a `Date`, this
  ticket's central invariant is gone and nothing in the suite would necessarily notice.
- **This branch stacks on an unmerged #117.** Its pull request will show #117's commits until that
  merges.
