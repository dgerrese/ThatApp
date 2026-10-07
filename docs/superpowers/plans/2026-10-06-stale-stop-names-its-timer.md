# A stale tab's stop or switch names its timer, and a 409 asks again — Implementation Plan

**Date:** 2026-10-06
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A stop or switch confirmed in a tab that believes timer X runs can no longer close timer Y, which another tab started since. The server refuses it with `409 timer_changed`. The tab then re-reads the timer and asks again about what really runs, at most once. If nothing runs, it closes quietly (#226).

**Architecture:** `store.TimerClose` gains `Expected *Timer`. `StopTimer` and `StartTimer` compare it with the row they read inside their transaction, before any close. A mismatch or a missing row returns `ErrTimerChanged` and writes nothing. The midnight close passes the zero `TimerClose` and is never checked. The handlers decode an optional `expected: {instanceId, issueKey, startedAt}`. `startedAt` is a `time.Time`, so a malformed value fails the body's decode and gets the existing `400 invalid_request`. `ErrTimerChanged` maps to `409 timer_changed`. In the browser, `askHowToStop` captures the timer the dialog opens for and passes it to `commit` as `expected`. It wraps #208's `commit`: a 409 re-reads the timer (#207's `readTimer` path), lets the dialog close and answers `"timer-changed"`. `stopTimerNow` and `startTimerNow` then decide from what runs now. They carry a `retried` flag, so each click makes at most one retry. #207's stale-start retry counts as that one retry.

**Tech Stack:** Go (stdlib, `modernc.org/sqlite`), TypeScript (vanilla, light-DOM WebComponents), Playwright (Firefox and Chromium).

**Spec:** Codeberg issue #226, refined and approved. Its text is at `/tmp/claude-1001/-home-dion-Projects-personal-ThatApp/804c23fa-0349-4e0d-a8f8-765ffe771a66/scratchpad/226.md`. Its Approach and Acceptance criteria are binding, including the owner's two decisions of 2026-09-29: **the typed description is not carried over** into a reopened dialog, and **when nothing runs, the dialog closes quietly**.

This plan builds on two others, both already on this branch:

- **#208**, plan `docs/superpowers/plans/2026-10-06-failed-stop-dialog-block.md`. `confirmStop(issueKey, nextIssueKey, elapsed, commit)` runs `commit(choice)` before it closes. A rejection becomes one error block and the dialog stays open. A resolution closes the dialog, and `confirmStop` resolves on any close.
- **#207**, plan `docs/superpowers/plans/2026-10-06-stale-start-asks.md`. A 400 to a start sent with no rounding re-reads the timer and calls the inner `startTimerNow` again. Any rejection that reaches `that-timer` is an error toast.

**Nothing new on screen.** The 409 reopens the existing stop or switch dialog for another timer. In one case (Ruling 3) it leaves #208's existing error block with the server's message. Every mark is one the design already draws, so this ticket has **no design session and no screenshot task**. Task 6 still records the comparison: the reopened dialog's heading and "… ran" line must read exactly as #185 and #208 draw them, for the new timer.

## Global Constraints

- All tooling runs through `make` or `docker compose`; never run Go, Node or npm on the host. The e2e rig below brings up its own `app-e2e` and needs no port. For anything pointed at the dev stack, read `THAT_PORT` from `.env`; never assume it.
- No new dependencies, Go or npm. No JavaScript frameworks. Light DOM, never shadow DOM. Firefox and Chromium only.
- **No schema migration.** `timers` holds one row (`CHECK (id = 1)`), and the expectation is the triple `(instance_id, issue_key, started_at)` already in that row and in the tab's `RunningTimer`.
- **Wire contract:** both endpoints take an optional field, `"expected": {"instanceId": <int>, "issueKey": <string>, "startedAt": <RFC 3339>}`. A refusal answers status 409 with body `{"code":"timer_changed","message":"The timer changed in another tab."}`, worded exactly so. Leaving `expected` out keeps today's behaviour exactly: the midnight close, every existing handler test, #207's start with no rounding, and a stop with nothing running, which still answers 200 with `stopped: null`.
- **Compare `startedAt` as instants** (`time.Time.Equal`), never as strings or with `==`.
- Reuse; do not re-implement:
  - Go: `runningTimerRow`, `countTimerRows`, `openTestStore`, `createTestInstance`, `mustLoadLocation`, `serverInZone`, `callEntries`, `assertRejected`, `decodeTimerState`, `errorBody`.
  - TS: `readTimer`, `isRunningTicket`, `ApiError`, and #208's `confirmStop` contract.
  - e2e (`timer.spec.ts`): `stubTimer`, `ticketRow`, `railTimer`, `stopBlocks`, `staleBootRead`.
- **No change** to `that-stop-dialog.ts`, `that-timer.ts`, `rail.ts`, `toast.ts`, any view, or `RunningTimer` in the store. The store's midnight close (`RunningTimer`) and `closeTimer` stay untouched.
- **Go conventions:** stdlib first; wrap errors with `%w`; table-driven tests with `t.Run`. Server tests use `httptest` through the existing `callEntries`. Nothing contacts a real network.
- **TDD, per task.** RED must fail on an assertion, for the reason the test names. A compile error does not count, nor does a timeout waiting for an element that a typo hides. Where a test needs a new name to compile, the task adds the bare declaration first, with no behaviour, so RED is an assertion. The task report quotes the RED failure line.
  - A test that passes before the change is a *guard*, marked as one below. It is proven entirely by mutation instead.
  - **Every assertion a task adds or changes is proven by mutation.** Break the guarded code by hand, run that one test, show it red, restore it, show it green. The report lists each mutation and its red line.
- Go test runs:

  ```shell
  docker compose run --rm --no-deps app go test ./internal/store/ -run '<regexp>' -v
  docker compose run --rm --no-deps app go test ./internal/server/ -run '<regexp>' -v
  make test-go
  ```

- Prettier:
  - Do not run Prettier on `.claude/e2e/`; there is no config there.
  - For `web/src`, run `docker compose run --rm --no-deps web npx prettier --write <files>`.
  - Go formatting comes from `make lint`, which runs golangci-lint. Run `docker compose run --rm --no-deps app gofmt -l ./internal/` before each Go commit; it must print nothing.
- Running the timer specs uses the rig's own disposable app. Always clean up around it:

  ```shell
  docker compose --profile e2e rm --stop --force app-e2e
  docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test timer.spec.ts timer-guard.spec.ts --reporter=line'
  docker compose --profile e2e rm --stop --force app-e2e
  ```

  Add `-g "<test title fragment>"` to run one test; every mutation run uses it.
- Commits: if `git commit` fails on signing, retry with `git -c commit.gpgsign=false commit …`. Never push.

## Rulings made before execution (the controller's, reversible)

1. **A malformed `expected.startedAt` gets the body's existing 400.** `startedAt` is typed `time.Time`, so `json.Decode` refuses a value that is not RFC 3339. The answer is `400 invalid_request`, "the request body is not valid JSON", the same as any other malformed field. No separate message is written. Only `startedAt` is validated; an empty or unknown `issueKey` or `instanceId` never matches, so it gets the 409.
2. **The expectation is the timer the dialog opened for.** `askHowToStop` captures `running` when it opens and passes that to `commit`. It does not use whatever `running` holds at the click, because the dialog's words are what the user confirmed. The whole `RunningTimer` is sent as `expected`. Its `instanceName` and `instancePosition` ride along, and the server's decoder ignores them; picking out three fields would add code with no effect.
3. **A re-read that fails after a 409 leaves the 409 in the dialog.** It shows as #208's block, reading "The timer changed in another tab.", and the dialog stays open and busy-free for a retry. This follows #207's rule that a failed re-read reports the original error. Without a fresh read, reopening would name the same stale timer.
4. **One retry per click, counted across #207 and #226.** ⚠ *This changes what gets built.* `startTimerNow` and `stopTimerNow` take `retried = false`. Every recursive call passes `true`, #207's recursion included, and a call with `retried` set never retries again:
   - A 409 from a reopened dialog re-reads, closes, and asks nothing more.
   - A 409 from the switch dialog that #207's stale start opened does the same.
   - A plain start retried after a 409 that is refused again rethrows, and that rethrow is a toast.

   This is the plain reading of the ticket's "No path makes more than one retry". The alternative would let #207's ask and #226's reask chain, so one click could open two dialogs.
5. **A stop's 409 reopens for whatever runs now**, even if the re-read returns the very run the tab named, which only a spurious 409 could produce. No special case is written. The `retried` flag bounds it.
6. **For a start, a 409 whose re-read finds nothing running starts the clicked ticket plainly.** The plain start sends no rounding and no `expected`, through the same recursive `startTimerNow(…, true)`. A failure there reaches `that-timer` and is a toast (#207). It is outside the dialog, which has already closed quietly as the owner ruled.
7. **The e2e stub mirrors the store's rule.** `stubTimer` answers 409 when `expected` is present and either names another run or nothing is running, compared by `Date.parse` instant. It checks this before its rounding check. It never sees a malformed `startedAt` from the app, so it does not model the 400.
8. **The 409's message is capitalised and worded as the ticket gives it,** unlike the store's other, lower-case messages. It is the only one a user can read, through Ruling 3's block.

## Review Focus

1. **A failure other than 409 inside the dialog must stay #208's block and must not re-read or reopen.** The gate is `status === 409`, not `>= 400`. Task 4's mutation re-runs #208's "a failed stop keeps the dialog open…" against `>= 400`.
2. **The same ticket stopped and restarted elsewhere** has the same key and a new `startedAt`. It must still be a 409: the key alone would miss it. Task 1's "another start, one second later" row and Task 2's "another start" row pin it.
3. **The day boundary:**
   - A stale expectation on an overnight timer must get the 409 and leave the row in place.
   - The midnight close must still run on the next read, honest and on the start's local day.

   Task 1's overnight test pins both.
4. **The zone of `startedAt`:** the browser echoes the server's `+02:00` rendering, while the store holds `Z`. They must match:
   - Task 1's "the same instant in another zone" row checks this.
   - Task 2's "the running one" row sends `+02:00`.
   - Task 3's e2e round trip succeeds only if the stub's instant compare holds.
5. **No loop and no double dialog:**
   - A stop refused twice closes after the second (Task 4, "refused twice").
   - #207's stale start refused after its ask closes quietly (Task 5, "asked once").
   - A plain retry refused again toasts once and sends no third start (Task 5, "plain retry").

   Each test settles by clicking a row afterwards, which a still-open modal would block.

---

### Task 1: The store refuses a close confirmed for another run

**Files:**
- Modify: `internal/store/timers.go`:
  - `ErrRoundingRequired` block, :37-40: add `ErrTimerChanged` after it.
  - `TimerClose`, :42-47.
  - `StartTimer`, after the row read, :249-252.
  - `StopTimer`, after the row read, :292-295.
- Test: `internal/store/timers_test.go`. Add `countEntryRows` after `countTimerRows`, :25-34, and append two tests at the end.

**Interfaces:**
- Produces:
  - `var ErrTimerChanged error`, matched with `errors.Is`.
  - `TimerClose.Expected *Timer`, where nil means no check.
  - `func matchesExpected(row, expected *Timer) bool`, unexported.
  - Task 2 consumes `ErrTimerChanged` and `TimerClose.Expected`.

- [ ] **Step 1: Add the bare declarations, no behaviour.** This is only so the tests compile and RED is an assertion. In `internal/store/timers.go`, after `ErrRoundingRequired`:

```go
// ErrTimerChanged refuses a stop or a switch confirmed for a run that is not
// the one running — another tab switched or stopped the timer since (#226).
var ErrTimerChanged = errors.New("the running timer is not the one this close was confirmed for")
```

Replace `TimerClose`:

```go
// TimerClose is what the user confirmed in the stop dialog. The zero value
// is the midnight close's: no direction, no comment and no expectation.
type TimerClose struct {
	Round   Rounding
	Comment string
	// Expected is the run the dialog was confirmed for; nil skips the check.
	Expected *Timer
}
```

- [ ] **Step 2: Write the failing tests.** In `internal/store/timers_test.go`, after `countTimerRows`:

```go
func countEntryRows(t *testing.T, s *Store) int {
	t.Helper()

	var rows int
	if err := s.db.QueryRow(`SELECT count(*) FROM entries`).Scan(&rows); err != nil {
		t.Fatalf("counting entry rows: %v", err)
	}

	return rows
}
```

Append at the end of the file:

```go
// A stop or switch confirmed for one run is refused when the row is another
// run, or gone, and changes nothing (#226). Starts compare as instants, so the
// same second rendered in another zone still matches.
func TestACloseConfirmedForAnotherRunIsRefusedAndChangesNothing(t *testing.T) {
	loc := mustLoadLocation(t, "Europe/Amsterdam")
	start := time.Date(2026, 9, 21, 10, 0, 0, 0, time.UTC)
	at := start.Add(20 * time.Minute)

	tests := []struct {
		name        string
		running     bool
		expected    func(instanceID int64) *Timer
		wantChanged bool
	}{
		{
			name:        "another key",
			running:     true,
			expected:    func(id int64) *Timer { return &Timer{InstanceID: id, IssueKey: "RIDGE-2", StartedAt: start} },
			wantChanged: true,
		},
		{
			name:        "another instance",
			running:     true,
			expected:    func(id int64) *Timer { return &Timer{InstanceID: id + 1, IssueKey: "RIDGE-1", StartedAt: start} },
			wantChanged: true,
		},
		{
			name:    "another start, one second later",
			running: true,
			expected: func(id int64) *Timer {
				return &Timer{InstanceID: id, IssueKey: "RIDGE-1", StartedAt: start.Add(time.Second)}
			},
			wantChanged: true,
		},
		{
			name:        "no row at all",
			running:     false,
			expected:    func(id int64) *Timer { return &Timer{InstanceID: id, IssueKey: "RIDGE-1", StartedAt: start} },
			wantChanged: true,
		},
		{
			name:     "the same run",
			running:  true,
			expected: func(id int64) *Timer { return &Timer{InstanceID: id, IssueKey: "RIDGE-1", StartedAt: start} },
		},
		{
			name:     "the same instant in another zone",
			running:  true,
			expected: func(id int64) *Timer { return &Timer{InstanceID: id, IssueKey: "RIDGE-1", StartedAt: start.In(loc)} },
		},
		{
			name:     "no expectation",
			running:  true,
			expected: func(int64) *Timer { return nil },
		},
	}

	for _, path := range []string{"stop", "switch"} {
		for _, tc := range tests {
			t.Run(path+"/"+tc.name, func(t *testing.T) {
				ctx := context.Background()
				s := openTestStore(t)
				inst := createTestInstance(t, s)
				if tc.running {
					if _, _, _, err := s.StartTimer(ctx, inst.ID, "RIDGE-1", start, loc, TimerClose{}); err != nil {
						t.Fatalf("starting: %v", err)
					}
				}

				choice := TimerClose{Round: RoundUp, Comment: "Traced the export", Expected: tc.expected(inst.ID)}
				var err error
				if path == "stop" {
					_, _, err = s.StopTimer(ctx, at, loc, choice)
				} else {
					_, _, _, err = s.StartTimer(ctx, inst.ID, "RIDGE-3", at, loc, choice)
				}

				if !tc.wantChanged {
					if err != nil {
						t.Fatalf("err = %v, want the close to go through", err)
					}
					if got := countEntryRows(t, s); got != 1 {
						t.Errorf("entries = %d, want 1: the run closed as today", got)
					}
					return
				}

				if !errors.Is(err, ErrTimerChanged) {
					t.Fatalf("err = %v, want ErrTimerChanged", err)
				}
				if got := countEntryRows(t, s); got != 0 {
					t.Errorf("entries = %d, want 0: a refused close logs nothing", got)
				}
				running, _, err := s.RunningTimer(ctx, at, loc)
				if err != nil {
					t.Fatalf("RunningTimer: %v", err)
				}
				if !tc.running {
					if running != nil {
						t.Errorf("running = %+v, want nothing: a refused %s must not start a timer", running, path)
					}
					return
				}
				if running == nil || running.IssueKey != "RIDGE-1" || !running.StartedAt.Equal(start) {
					t.Errorf("running = %+v, want RIDGE-1 from %v untouched", running, start)
				}
			})
		}
	}
}

// A stale expectation on a timer whose start day has passed is still refused,
// before the stop's own midnight close could run; the next read then closes
// it as the midnight close always does, honest and on its start day (#226).
func TestAStaleExpectationOnAnOvernightTimerIsRefusedAndTheMidnightCloseStillRuns(t *testing.T) {
	loc := mustLoadLocation(t, "Europe/Amsterdam")
	start := time.Date(2026, 9, 21, 23, 37, 0, 0, loc)
	read := time.Date(2026, 9, 22, 9, 0, 0, 0, loc)

	for _, path := range []string{"stop", "switch"} {
		t.Run(path, func(t *testing.T) {
			ctx := context.Background()
			s := openTestStore(t)
			inst := createTestInstance(t, s)
			if _, _, _, err := s.StartTimer(ctx, inst.ID, "RIDGE-1", start, loc, TimerClose{}); err != nil {
				t.Fatalf("starting: %v", err)
			}

			choice := TimerClose{
				Round:    RoundUp,
				Expected: &Timer{InstanceID: inst.ID, IssueKey: "RIDGE-2", StartedAt: start},
			}
			var err error
			if path == "stop" {
				_, _, err = s.StopTimer(ctx, read, loc, choice)
			} else {
				_, _, _, err = s.StartTimer(ctx, inst.ID, "RIDGE-3", read, loc, choice)
			}
			if !errors.Is(err, ErrTimerChanged) {
				t.Fatalf("err = %v, want ErrTimerChanged", err)
			}
			if got := countTimerRows(t, s); got != 1 {
				t.Errorf("timer rows = %d, want 1: the refusal must leave the overnight timer for the midnight close", got)
			}
			if got := countEntryRows(t, s); got != 0 {
				t.Errorf("entries = %d, want 0", got)
			}

			running, closed, err := s.RunningTimer(ctx, read, loc)
			if err != nil {
				t.Fatalf("RunningTimer: %v", err)
			}
			if running != nil {
				t.Errorf("running = %+v, want nil after the midnight close", running)
			}
			if closed == nil || closed.Seconds != 1380 || closed.Day != "2026-09-21" {
				t.Errorf("closed = %+v, want the honest 1380s on 2026-09-21", closed)
			}
		})
	}
}
```

- [ ] **Step 3: Run them; expect the named failures.**

Run: `docker compose run --rm --no-deps app go test ./internal/store/ -run 'TestACloseConfirmedForAnotherRun|TestAStaleExpectation' -v`

Expected:
- Every `wantChanged` subtest FAILS with `err = <nil>, want ErrTimerChanged`, because nothing compares `Expected` yet.
- The overnight `stop` and `switch` subtests fail the same way.
- `the same run`, `the same instant in another zone` and `no expectation` PASS today. Each is a *guard*, proven by mutation in Step 6.

Quote one red line.

- [ ] **Step 4: Implement.** In `internal/store/timers.go`, after `staleTimer`:

```go
// matchesExpected reports whether row is the run expected names: the same
// instance, key and start instant. A nil expected matches anything and a nil
// row nothing. The key alone would miss a ticket stopped and restarted
// elsewhere; Equal, not ==, so a start rendered in another zone still matches.
func matchesExpected(row, expected *Timer) bool {
	if expected == nil {
		return true
	}

	return row != nil &&
		row.InstanceID == expected.InstanceID &&
		row.IssueKey == expected.IssueKey &&
		row.StartedAt.Equal(expected.StartedAt)
}
```

In `StartTimer`, directly after the `runningTimerRow` error check:

```go
	if !matchesExpected(existing, choice.Expected) {
		return nil, nil, false, ErrTimerChanged
	}
```

In `StopTimer`, directly after the `runningTimerRow` error check and **before** `if existing == nil`, because a missing row with an expectation is a refusal:

```go
	if !matchesExpected(existing, choice.Expected) {
		return nil, false, ErrTimerChanged
	}
```

Both returns go through the deferred `tx.Rollback()` with nothing written. Extend the doc comments of both functions with one sentence: "A choice.Expected that is not the running row (ErrTimerChanged) refuses before anything is closed."

- [ ] **Step 5: Run them; all pass.** Then `make test-go`; all pass. The existing `TimerClose{…}` literals are keyed, so they compile unchanged. `gofmt -l` prints nothing.

- [ ] **Step 6: Mutation-prove every assertion added.** One run per mutation: red, restore, green.
  - Delete the check in `StopTimer`: the `stop/*` refusal rows go red on `want ErrTimerChanged`, and so does the overnight `stop`.
  - Delete the check in `StartTimer`: the `switch/*` refusal rows go red. `switch/no row at all` is also red on `want ErrTimerChanged`, because the switch starts RIDGE-3.
  - In `matchesExpected`:
    - Drop the `IssueKey` clause: `*/another key` goes red.
    - Drop the `InstanceID` clause: `*/another instance` goes red.
    - Drop the `StartedAt` clause: `*/another start, one second later` goes red.
    - Replace `.Equal(expected.StartedAt)` with `== expected.StartedAt`: `*/the same instant in another zone` goes red on `want the close to go through`.
    - Replace `return row != nil && …` with `if row == nil { return true }` followed by the comparisons: `*/no row at all` goes red.
    - Replace `if expected == nil { return true }` with `if expected == nil { return false }`: `*/no expectation` goes red.
  - In `StopTimer`'s refusal, run the close and commit first. That means `closeTimer`, then `deleteRunningTimer`, then `commitTimerTx`, then `return …, ErrTimerChanged`. `stop/another key` goes red on `entries = 1, want 0`, and the overnight `stop` goes red on `timer rows = 0, want 1`.
  - Move `StopTimer`'s check below `if existing == nil { … }`: `stop/no row at all` goes red.
  - The overnight test's `closed` assertion: in the mismatch branch of `StopTimer`, delete the row and commit before refusing. The test goes red on `timer rows` and on `closed = <nil>`.

- [ ] **Step 7: Commit.**

```bash
git add internal/store/timers.go internal/store/timers_test.go
git commit -m "#226: the store refuses a close confirmed for another run"
```

---

### Task 2: The timer endpoints take `expected` and answer 409 `timer_changed`

**Files:**
- Modify: `internal/server/timer.go`:
  - `startTimerRequest`, :113-118.
  - `handleStartTimer`'s store call and its error mapping, :156-164.
  - `stopTimerRequest`, :132-135.
  - `handleStopTimer`'s `StopTimer` call and its error check, after the `validRound` check.
- Test: `internal/server/timer_test.go`. Add `"fmt"` to the imports and append one test.

**Interfaces:**
- Consumes: `store.ErrTimerChanged` and `store.TimerClose.Expected` from Task 1.
- Produces: the wire contract in Global Constraints. Task 3 sends it.

- [ ] **Step 1: Write the failing test.** Append to `internal/server/timer_test.go`, and add `"fmt"` to its imports:

```go
// TestATimerCloseNamingAnotherRunIsRefused (#226): a stop or switch whose
// expected run is not the one running gets 409 timer_changed and leaves the
// timer running; a malformed expected.startedAt is a 400; a matching one, sent
// in the configured zone's offset as GET /api/timer renders it, goes through.
func TestATimerCloseNamingAnotherRunIsRefused(t *testing.T) {
	start := time.Date(2026, 8, 21, 12, 5, 0, 0, time.UTC)

	tests := []struct {
		name       string
		expected   string // %d is the instance id
		wantStatus int
		wantCode   string
	}{
		{
			name:       "another key",
			expected:   `{"instanceId":%d,"issueKey":"OTHER-9","startedAt":"2026-08-21T14:05:00+02:00"}`,
			wantStatus: http.StatusConflict,
			wantCode:   "timer_changed",
		},
		{
			name:       "another start",
			expected:   `{"instanceId":%d,"issueKey":"FIRST-1","startedAt":"2026-08-21T14:05:01+02:00"}`,
			wantStatus: http.StatusConflict,
			wantCode:   "timer_changed",
		},
		{
			name:       "a malformed startedAt",
			expected:   `{"instanceId":%d,"issueKey":"FIRST-1","startedAt":"yesterday"}`,
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_request",
		},
		{
			name:       "the running one",
			expected:   `{"instanceId":%d,"issueKey":"FIRST-1","startedAt":"2026-08-21T14:05:00+02:00"}`,
			wantStatus: http.StatusOK,
		},
	}

	for _, path := range []string{"stop", "start"} {
		for _, tc := range tests {
			t.Run(path+"/"+tc.name, func(t *testing.T) {
				srv, _, inst := serverInZone(t, "Europe/Amsterdam", start)
				id := strconv.FormatInt(inst.ID, 10)
				rec := callEntries(t, srv, http.MethodPost, "/api/timer/start",
					`{"instanceId":`+id+`,"issueKey":"FIRST-1"}`)
				if rec.Code != http.StatusOK {
					t.Fatalf("first start status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
				}

				srv.now = func() time.Time { return start.Add(5 * time.Minute) }
				expected := fmt.Sprintf(tc.expected, inst.ID)
				body := `{"round":"up","expected":` + expected + `}`
				if path == "start" {
					body = `{"instanceId":` + id + `,"issueKey":"SECOND-2","round":"up","expected":` + expected + `}`
				}
				rec = callEntries(t, srv, http.MethodPost, "/api/timer/"+path, body)

				if tc.wantStatus != http.StatusOK {
					assertRejected(t, rec, tc.wantStatus, tc.wantCode)
					if tc.wantStatus == http.StatusConflict {
						var refusal errorBody
						if err := json.Unmarshal(rec.Body.Bytes(), &refusal); err != nil {
							t.Fatalf("decoding %s: %v", rec.Body.String(), err)
						}
						if refusal.Message != "The timer changed in another tab." {
							t.Errorf("message = %q, want %q", refusal.Message, "The timer changed in another tab.")
						}
					}
					got := decodeTimerState(t, callEntries(t, srv, http.MethodGet, "/api/timer", ""))
					if got.Running == nil || got.Running.IssueKey != "FIRST-1" {
						t.Errorf("running = %+v after a refused %s, want FIRST-1 still running", got.Running, path)
					}
					return
				}

				if rec.Code != http.StatusOK {
					t.Fatalf("status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
				}
				got := decodeTimerState(t, callEntries(t, srv, http.MethodGet, "/api/timer", ""))
				if path == "stop" && got.Running != nil {
					t.Errorf("running = %+v after a matching stop, want nothing", got.Running)
				}
				if path == "start" && (got.Running == nil || got.Running.IssueKey != "SECOND-2") {
					t.Errorf("running = %+v after a matching switch, want SECOND-2", got.Running)
				}
			})
		}
	}
}
```

- [ ] **Step 2: Run it; expect the named failures.**

Run: `docker compose run --rm --no-deps app go test ./internal/server/ -run TestATimerCloseNamingAnotherRunIsRefused -v`

Expected: today's handlers ignore the unknown `expected` field, so every refusal row FAILS in `assertRejected` with `status = 200, want 409`, or `want 400` for the malformed rows. Quote one. `*/the running one` PASSES; it is a *guard*, proven by mutation in Step 5.

- [ ] **Step 3: Implement.** In `internal/server/timer.go`, before `startTimerRequest`:

```go
// expectedTimerRequest names the run the stop dialog was confirmed for, so a
// stale tab cannot close a timer another tab started since (#226). StartedAt
// is a time.Time so a malformed one fails the body's decode, the 400 any
// malformed field gets.
type expectedTimerRequest struct {
	InstanceID int64     `json:"instanceId"`
	IssueKey   string    `json:"issueKey"`
	StartedAt  time.Time `json:"startedAt"`
}

// storeTimer is the expectation as the store compares it: nil when the request
// named none, which keeps today's unchecked close.
func (e *expectedTimerRequest) storeTimer() *store.Timer {
	if e == nil {
		return nil
	}

	return &store.Timer{InstanceID: e.InstanceID, IssueKey: e.IssueKey, StartedAt: e.StartedAt}
}
```

Add the field to both request types, after `Comment`:

```go
	Expected   *expectedTimerRequest `json:"expected"`
```

Match each struct's existing column alignment. `stopTimerRequest` uses the narrower alignment.

In `handleStartTimer`, pass `Expected` and map the error, before the `ErrRoundingRequired` check:

```go
	running, stopped, wasRunning, err := s.db.StartTimer(r.Context(), inst.ID, key, s.now(), s.cfg.Location,
		store.TimerClose{Round: req.Round, Comment: req.Comment, Expected: req.Expected.storeTimer()})
	if errors.Is(err, store.ErrTimerChanged) {
		writeError(w, http.StatusConflict, "timer_changed", "The timer changed in another tab.")
		return
	}
```

In `handleStopTimer`:

```go
	entry, wasRunning, err := s.db.StopTimer(r.Context(), s.now(), s.cfg.Location,
		store.TimerClose{Round: req.Round, Comment: req.Comment, Expected: req.Expected.storeTimer()})
	if errors.Is(err, store.ErrTimerChanged) {
		writeError(w, http.StatusConflict, "timer_changed", "The timer changed in another tab.")
		return
	}
```

Add one sentence to each handler's doc comment: "An `expected` run that is not the one running is refused with 409 timer_changed, changing nothing (#226)."

- [ ] **Step 4: Run it; all pass.** Then `make test-go`; all pass, every existing timer handler test unchanged. `gofmt -l` prints nothing.

- [ ] **Step 5: Mutation-prove every assertion added.** One run per mutation:
  - `http.StatusConflict` → `http.StatusBadRequest` in `handleStopTimer`: `stop/another key` goes red on `want 409`.
  - Do the same in `handleStartTimer`: `start/another key` goes red.
  - `"timer_changed"` → `"store_failed"` in one handler: red on `code = …, want "timer_changed"`.
  - Change the message to `"the timer changed"`: red on `message = …`.
  - Drop `Expected: req.Expected.storeTimer()` from `handleStopTimer`: the `stop/*` 409 rows go red with `status = 200`.
  - Make the same mutation in `handleStartTimer`: `start/another start` goes red. It returns 200 and the refusal is not made.
  - Type `StartedAt` as `string` and convert with `t, _ := time.Parse(time.RFC3339, e.StartedAt)`: `*/a malformed startedAt` goes red on `want 400` (it gets 409).
  - Make `storeTimer` return `&store.Timer{}` for a nil receiver: `TestStartTimerSwitchesFromTheRunningOne` (an existing test, no `expected`) goes red with 409. This proves "leaving out `expected` keeps today's behaviour".
  - `*/the running one`'s 200 path: make `storeTimer` drop `StartedAt`. Both rows go red on `status = 409, want 200`.

- [ ] **Step 6: Commit.**

```bash
git add internal/server/timer.go internal/server/timer_test.go
git commit -m "#226: the timer endpoints take expected and answer 409 timer_changed"
```

---

### Task 3: Every confirmed stop or switch names the run its dialog opened for

**Files:**
- Modify: `web/src/types.ts`: after `StopChoice`, :233-237.
- Modify: `web/src/api.ts`: `startTimer` and `stopTimer`, :204-222, and the type import, :1-20.
- Modify: `web/src/timer-state.ts`: `askHowToStop`, `startTimerNow` and `stopTimerNow`, :103-151.
- Test: `.claude/e2e/tests/timer.spec.ts`:
  - `stubTimer`, :45-126: an `issueKey` option and the 409 rule.
  - Append a `#226` section at the end of the file, after #207's.

**Interfaces:**
- Consumes: Task 2's wire contract.
- Produces:
  - `export type ExpectedTimer = Pick<RunningTimer, "instanceId" | "issueKey" | "startedAt">` in `types.ts`.
  - `startTimer(instanceId: number, issueKey: string, choice?: StopChoice, expected?: ExpectedTimer): Promise<StartTimerResponse>` in `api.ts`.
  - `stopTimer(choice: StopChoice, expected: ExpectedTimer): Promise<StopTimerResponse>` in `api.ts`.
  - In `timer-state.ts`: `askHowToStop(nextIssueKey: string | undefined, commit: (choice: StopChoice, shown: RunningTimer) => Promise<void>): Promise<void>`. Task 4 changes its return type.
  - `stubTimer(page, { runningFor?, issueKey? })`. Its stop and start answer 409 `timer_changed` for a mismatched `expected`. Tasks 4 and 5 rely on it.

- [ ] **Step 1: Teach the stub the store's rule, and write the failing test.** In `stubTimer`, change the signature and the initial run:

```ts
async function stubTimer(
  page: Page,
  options?: { runningFor?: number; issueKey?: string },
): Promise<TimerRecorder> {
  const recorder: TimerRecorder = { stops: [], starts: [], logged: [] };
  let running: StubRunning | null =
    options?.runningFor === undefined
      ? null
      : {
          instanceId: 1,
          issueKey: options.issueKey ?? "WORK-1",
          startedAt: Date.now() - options.runningFor * 1000,
        };
```

After `isRounding`, add:

```ts
  // The store's #226 rule: a close confirmed for another run, or for one no
  // longer running, is refused and changes nothing. Starts compare as instants.
  const namesAnotherRun = (expected: unknown): boolean => {
    if (expected === undefined) return false;
    const named = expected as Record<string, unknown>;

    return (
      !running ||
      named["instanceId"] !== running.instanceId ||
      named["issueKey"] !== running.issueKey ||
      Date.parse(String(named["startedAt"])) !== running.startedAt
    );
  };
  const timerChanged = (route: Route) =>
    route.fulfill({
      status: 409,
      json: { code: "timer_changed", message: "The timer changed in another tab." },
    });
```

Add `type Route` to the file's `@playwright/test` import.

In the start handler, directly after `recorder.starts.push(body);`:

```ts
    if (namesAnotherRun(body["expected"])) return timerChanged(route);
```

In the stop handler, directly after `recorder.stops.push(body);`:

```ts
    if (namesAnotherRun(body["expected"])) return timerChanged(route);
```

Append the `#226` section at the end of the file:

```ts
/**
 * #226: a stop or switch names the run its dialog was opened for, so a tab
 * that missed another tab's switch cannot close the wrong timer; the server
 * refuses it with a 409, and this tab re-reads and asks again, at most once.
 */
test("a confirmed switch and a confirmed stop name the run their dialog opened for; a plain start names none", async ({
  page,
}) => {
  const recorder = await stubTimer(page, { runningFor: 60 });
  await page.goto("/today");
  const dialog = page.getByRole("dialog");

  await ticketRow(page, "WORK-2").getByRole("button", { name: "start timer" }).click();
  await expect(dialog.getByRole("heading")).toHaveText("Stop WORK-1 and start WORK-2?");
  await dialog.getByRole("button", { name: "Log 0:15" }).click();
  await expect(dialog).toHaveCount(0);

  await ticketRow(page, "WORK-2").getByRole("button", { name: "stop timer" }).click();
  await expect(dialog.getByText("WORK-2 ran")).toBeVisible();
  await dialog.getByRole("button", { name: "Discard run" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(railTimer(page)).toContainText("No timer running");

  await ticketRow(page, "WORK-1").getByRole("button", { name: "start timer" }).click();
  await expect(ticketRow(page, "WORK-1").getByRole("button", { name: "stop timer" })).toBeVisible();

  expect(recorder.starts).toEqual([
    expect.objectContaining({
      issueKey: "WORK-2",
      round: "up",
      expected: expect.objectContaining({ instanceId: 1, issueKey: "WORK-1" }),
    }),
    expect.not.objectContaining({ expected: expect.anything() }),
  ]);
  expect(recorder.stops).toEqual([
    expect.objectContaining({
      round: "down",
      expected: expect.objectContaining({ instanceId: 1, issueKey: "WORK-2" }),
    }),
  ]);
});
```

The stub's 409 rule also proves the echoed `startedAt`. If it did not match by instant, the switch would be refused, the dialog would keep a block, and the `toHaveCount(0)` would fail.

- [ ] **Step 2: Run it; expect the named failure.**

Run with `-g "name the run their dialog opened for"`.

Expected: FAILS on `expect(recorder.starts).toEqual(…)`. The first start carries no `expected` field. Quote it. Then run the whole of `timer.spec.ts timer-guard.spec.ts`. Every other test still passes: no request carries `expected` yet, so the stub's new rule never fires.

- [ ] **Step 3: Implement.** In `web/src/types.ts`, after `StopChoice`:

```ts
/** The run a stop or switch was confirmed for, so the server can refuse it
 *  once another tab has changed the timer (#226). */
export type ExpectedTimer = Pick<RunningTimer, "instanceId" | "issueKey" | "startedAt">;
```

In `web/src/api.ts`, add `ExpectedTimer` to the type import, and replace the two functions:

```ts
/** `choice` is how to close the timer already running, which the server
 *  requires when one runs on the same day; `expected` is the run that choice
 *  was confirmed for (#226). */
export function startTimer(
  instanceId: number,
  issueKey: string,
  choice?: StopChoice,
  expected?: ExpectedTimer,
): Promise<StartTimerResponse> {
  return request<StartTimerResponse>("/api/timer/start", {
    method: "POST",
    body: JSON.stringify({ instanceId, issueKey, ...choice, expected }),
  });
}

export function stopTimer(choice: StopChoice, expected: ExpectedTimer): Promise<StopTimerResponse> {
  return request<StopTimerResponse>("/api/timer/stop", {
    method: "POST",
    body: JSON.stringify({ ...choice, expected }),
  });
}
```

`JSON.stringify` drops an `undefined` field, so a plain start sends no `expected`.

In `web/src/timer-state.ts`, replace `askHowToStop`:

```ts
/** Asks how to stop the running timer; a confirmed rounding runs `commit`
 *  while the dialog is open, against the run the dialog named (#226).
 *  Imported lazily: the dialog is only ever needed after a click. */
async function askHowToStop(
  nextIssueKey: string | undefined,
  commit: (choice: StopChoice, shown: RunningTimer) => Promise<void>,
): Promise<void> {
  const shown = running;
  if (!shown) return;
  const { confirmStop } = await import("./components/that-stop-dialog");

  await confirmStop(shown.issueKey, nextIssueKey, elapsedSeconds, (choice) => commit(choice, shown));
}
```

In `startTimerNow`, change only the inner `start`:

```ts
  const start = async (choice?: StopChoice, shown?: RunningTimer): Promise<void> => {
    const response = await postStartTimer(instanceId, issueKey, choice, shown);
    setRunning(response.running);
    if (response.stopped) announceEntriesChanged();
  };
```

In `stopTimerNow`, change the callback:

```ts
  await askHowToStop(undefined, async (choice, shown) => {
    const response = await postStopTimer(choice, shown);
    setRunning(null);
    if (response.stopped) announceEntriesChanged();
  });
```

Then run `docker compose run --rm --no-deps web npx prettier --write web/src/types.ts web/src/api.ts web/src/timer-state.ts`, then `make tsc`.

- [ ] **Step 4: Run it; it passes.** Then run the whole of `timer.spec.ts timer-guard.spec.ts`; all pass. This covers #207's stale-start tests, whose re-read gives the stub's own WORK-1 run, so its `expected` matches.

- [ ] **Step 5: Mutation-prove every assertion added.** One run per mutation:
  - In `askHowToStop`, pass `undefined as unknown as RunningTimer` for `shown`, the mutation only: red on `recorder.starts` toEqual, because the first start has no `expected`.
  - In `stopTimerNow`, send `{ ...shown, issueKey: "WORK-1" }`. The stub refuses it, the dialog keeps a block, and the test goes red on the second `expect(dialog).toHaveCount(0)`. Run again with the stub's stop-side `namesAnotherRun` line commented out: it is now red on `recorder.stops` (`issueKey: "WORK-1"`).
  - Send `{ ...shown, startedAt: new Date().toISOString() }` on the switch: red on the first `toHaveCount(0)`. The stub's instant compare refuses it.
  - In the stub, compare `named["startedAt"] !== new Date(running.startedAt).toISOString()`, a string compare, and in `api.ts` send `startedAt` rewritten into a `+00:00` offset. Red on the first `toHaveCount(0)`. This proves the instant compare in the stub is what lets an offset-rendered start match. Restore both.
  - Send an `expected` on the plain start: in `startTimerNow`'s non-running branch, call `start(undefined, { instanceId: 0, instanceName: "", instancePosition: 0, issueKey: "", startedAt: "" })`. The stub refuses it with a 409 and the WORK-1 start fails, so the test goes red on WORK-1's `stop timer` visible. Run again with the stub's start-side `namesAnotherRun` line commented out: it is now red on `expect.not.objectContaining({ expected: … })`.

- [ ] **Step 6: Commit.**

```bash
git add web/src/types.ts web/src/api.ts web/src/timer-state.ts .claude/e2e/tests/timer.spec.ts
git commit -m "#226: a confirmed stop or switch names the run its dialog opened for"
```

---

### Task 4: A refused stop re-reads and reopens for the timer that runs now, once

**Files:**
- Modify: `web/src/timer-state.ts`: `askHowToStop` and `stopTimerNow`, and the module comment's last paragraph, :15-17.
- Test: `.claude/e2e/tests/timer.spec.ts`: append to the `#226` section.

**Interfaces:**
- Consumes: Task 3's stub, its `issueKey` option and its 409. Also #208's `confirmStop`, which resolves on close, never rejects, and turns a `commit` rejection into a block.
- Produces:
  - `askHowToStop(nextIssueKey, commit): Promise<"closed" | "timer-changed">`.
  - `stopTimerNow(retried = false): Promise<void>`.
  - Task 5 consumes `askHowToStop`'s outcome.

- [ ] **Step 1: Write the failing tests.** Append to the `#226` section:

```ts
/** This tab's boot read shows WORK-1 running for a minute, whatever the stub runs. */
async function bootReadShowsWork1(page: Page): Promise<void> {
  await page.route(
    "**/api/timer",
    (route) =>
      route.fulfill({
        status: 200,
        json: {
          running: { instanceId: 1, issueKey: "WORK-1", startedAt: new Date(Date.now() - 60_000).toISOString() },
          stopped: null,
        },
      }),
    { times: 1 },
  );
}

test("a stale tab's stop is refused, and the dialog reopens for the timer that runs now with an empty description", async ({
  page,
}) => {
  const recorder = await stubTimer(page, { runningFor: 60, issueKey: "WORK-2" });
  await bootReadShowsWork1(page);
  await page.goto("/today");
  await expect(railTimer(page)).toContainText("WORK-1");

  const dialog = page.getByRole("dialog");
  const description = dialog.getByRole("textbox", { name: "Description" });
  await ticketRow(page, "WORK-1").getByRole("button", { name: "stop timer" }).click();
  await expect(dialog.getByText("WORK-1 ran")).toBeVisible();
  await description.fill("Traced the export");
  await dialog.getByRole("button", { name: "Log 0:15" }).click();

  await expect(dialog.getByText("WORK-2 ran")).toBeVisible();
  await expect(description).toHaveValue("");
  await expect(page.locator("that-toast")).toHaveCount(0);
  await expect(railTimer(page)).toContainText("WORK-2");
  expect(recorder.stops).toEqual([
    expect.objectContaining({ round: "up", expected: expect.objectContaining({ issueKey: "WORK-1" }) }),
  ]);
  expect(recorder.logged).toEqual([]);

  await dialog.getByRole("button", { name: "Log 0:15" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(railTimer(page)).toContainText("No timer running");
  expect(recorder.logged).toEqual([expect.objectContaining({ issueKey: "WORK-2", comment: "" })]);
});

test("after a refused stop, a re-read that finds nothing running closes the dialog quietly", async ({ page }) => {
  const recorder = await stubTimer(page);
  await bootReadShowsWork1(page);
  await page.goto("/today");
  await expect(railTimer(page)).toContainText("WORK-1");

  const dialog = page.getByRole("dialog");
  await ticketRow(page, "WORK-1").getByRole("button", { name: "stop timer" }).click();
  await dialog.getByRole("button", { name: "Log 0:15" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(railTimer(page)).toContainText("No timer running");
  // A dialog block is a that-toast too, so this counts blocks and toasts alike.
  await expect(page.locator("that-toast")).toHaveCount(0);
  expect(recorder.stops.length).toBe(1);
  expect(recorder.logged).toEqual([]);
});

test("a stop refused twice closes after the second refusal and asks no third time", async ({ page }) => {
  await stubTimer(page, { runningFor: 60, issueKey: "WORK-2" });
  await bootReadShowsWork1(page);
  let stops = 0;
  await page.route("**/api/timer/stop", (route) => {
    stops += 1;
    return route.fulfill({
      status: 409,
      json: { code: "timer_changed", message: "The timer changed in another tab." },
    });
  });
  await page.goto("/today");

  const dialog = page.getByRole("dialog");
  await ticketRow(page, "WORK-1").getByRole("button", { name: "stop timer" }).click();
  await dialog.getByRole("button", { name: "Log 0:15" }).click();
  await expect(dialog.getByText("WORK-2 ran")).toBeVisible();
  await dialog.getByRole("button", { name: "Log 0:15" }).click();
  await expect(dialog).toHaveCount(0);

  // A third dialog would be modal and block this click; opening one proves the first click's work is done.
  await ticketRow(page, "WORK-2").getByRole("button", { name: "stop timer" }).click();
  await expect(dialog.getByText("WORK-2 ran")).toBeVisible();
  await dialog.getByRole("button", { name: "Keep running" }).click();

  expect(stops).toBe(2);
  await expect(page.locator("that-toast")).toHaveCount(0);
  await expect(railTimer(page)).toContainText("WORK-2");
});

test("a refused stop whose re-read fails keeps the dialog open with the refusal as its block", async ({ page }) => {
  await stubTimer(page, { runningFor: 60, issueKey: "WORK-2" });
  await bootReadShowsWork1(page);
  await page.goto("/today");
  await expect(railTimer(page)).toContainText("WORK-1");
  await page.route(
    "**/api/timer",
    (route) => route.fulfill({ status: 500, json: { code: "store_failed", message: "could not read the timer" } }),
    { times: 1 },
  );

  const dialog = page.getByRole("dialog");
  await ticketRow(page, "WORK-1").getByRole("button", { name: "stop timer" }).click();
  await dialog.getByRole("textbox", { name: "Description" }).fill("Traced the export");
  await dialog.getByRole("button", { name: "Log 0:15" }).click();

  await expect(stopBlocks(page)).toHaveCount(1);
  await expect(stopBlocks(page)).toContainText("The timer changed in another tab.");
  await expect(dialog.getByText("WORK-1 ran")).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Description" })).toHaveValue("Traced the export");
});
```

- [ ] **Step 2: Run the four; expect each failure for its named reason.** Run with `-g "stale tab's stop is refused|refused stop|stop refused twice"`.

Expected:
- "…reopens for the timer that runs now…" FAILS on `dialog.getByText("WORK-2 ran")` visible. Today #208 shows the 409 as a block in the dialog still open on WORK-1. Quote it.
- "…finds nothing running closes the dialog quietly" FAILS on `expect(dialog).toHaveCount(0)`; the block keeps the dialog open.
- "…refused twice…" FAILS on `dialog.getByText("WORK-2 ran")`.
- "…whose re-read fails…" PASSES today. It is a *guard*: #208 already shows any rejection as this block. Proven by mutation in Step 5.

- [ ] **Step 3: Implement.** In `web/src/timer-state.ts`, replace the module comment's last paragraph:

```ts
 * A stop, or a start over a running timer, asks the stop dialog how to round
 * first, and the dialog sends the POST while it is still open, so a failure
 * stays in it (#208). The POST names the run the dialog showed; a 409 means
 * another tab changed the timer since, so this re-reads it and asks again
 * about what runs now, once (#226).
```

Replace `askHowToStop`:

```ts
/** Asks how to stop the running timer; a confirmed rounding runs `commit`
 *  while the dialog is open, against the run the dialog named. A 409 means
 *  another tab changed the timer since (#226): re-read it, let the dialog
 *  close, and answer "timer-changed" so the caller asks about what runs now.
 *  Imported lazily: the dialog is only ever needed after a click. */
async function askHowToStop(
  nextIssueKey: string | undefined,
  commit: (choice: StopChoice, shown: RunningTimer) => Promise<void>,
): Promise<"closed" | "timer-changed"> {
  const shown = running;
  if (!shown) return "closed";
  const { confirmStop } = await import("./components/that-stop-dialog");

  let outcome: "closed" | "timer-changed" = "closed";
  await confirmStop(shown.issueKey, nextIssueKey, elapsedSeconds, async (choice) => {
    try {
      await commit(choice, shown);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 409)) throw error;
      // Without a fresh read a reopened dialog would name the same stale run,
      // so a failed one leaves the 409 itself in the dialog, as its block.
      await readTimer().catch(() => {
        throw error;
      });
      outcome = "timer-changed";
    }
  });

  return outcome;
}
```

Replace `stopTimerNow` and the `stopTimer` export:

```ts
/** `retried` marks the one reask a refused stop gets (#226). */
async function stopTimerNow(retried = false): Promise<void> {
  const outcome = await askHowToStop(undefined, async (choice, shown) => {
    const response = await postStopTimer(choice, shown);
    setRunning(null);
    if (response.stopped) announceEntriesChanged();
  });
  // With nothing running now, the reask returns at once: there is nothing to ask about.
  if (outcome === "timer-changed" && !retried) await stopTimerNow(true);
}
```

```ts
export function stopTimer(): Promise<void> {
  return oneAtATime(() => stopTimerNow());
}
```

`startTimerNow`'s running branch still `await`s `askHowToStop` and ignores the outcome. Until Task 5, a refused switch closes quietly after its re-read.

Then run `docker compose run --rm --no-deps web npx prettier --write web/src/timer-state.ts`, then `make tsc`.

- [ ] **Step 4: Run the four; all pass.** Then run the whole of `timer.spec.ts timer-guard.spec.ts`; all pass, every #208 failure test in particular, since a 500 is not a 409.

- [ ] **Step 5: Mutation-prove every assertion added.** One run per mutation:
  - Never set `outcome = "timer-changed"`; delete that line. "…reopens…" goes red on `WORK-2 ran`, because the dialog closes and nothing reopens.
  - Delete the `readTimer` line in the 409 path. `running` stays WORK-1. "…reopens…" goes red on `WORK-2 ran`, which reads "WORK-1 ran", and "…finds nothing running…" goes red on `toHaveCount(0)` because a WORK-1 dialog reopens.
  - Replace `.catch(() => { throw error; })` with `.catch(() => undefined)`. The "re-read fails" guard goes red on `stopBlocks` count 1: the dialog reopens on WORK-1 with no block.
  - `error.status === 409` → `error.status >= 400`. #208's existing "a failed stop keeps the dialog open with its description…" goes red: its 500 re-reads and the dialog closes or reopens without the block.
  - `stopTimerNow` without `!retried`. "…refused twice…" goes red: a third dialog opens, the row click is blocked, and the test times out on that click, which is the red. It is also red on `expect(stops).toBe(2)`, received 3, if the click lands.
  - `stopTimerNow(true)` → `stopTimerNow(false)` in the recursion: "…refused twice…" goes red as above.
  - The empty description: as a mutation only, have `confirmStop` keep the last comment in a module variable and prefill the field. "…reopens…" goes red on `toHaveValue("")`.
  - The rail line `toContainText("WORK-2")` in "…reopens…": move `outcome = "timer-changed"` above the `readTimer` call and delete the read. Red on the rail.
  - `recorder.logged` empty after the refusal: make the stub's stop handler close the run before its 409 check. Red on `recorder.logged).toEqual([])`. Restore the stub.

- [ ] **Step 6: Commit.**

```bash
git add web/src/timer-state.ts .claude/e2e/tests/timer.spec.ts
git commit -m "#226: a refused stop re-reads and reopens for the timer that runs now"
```

---

### Task 5: A refused switch asks again, stops there, or starts plainly — once per click

**Files:**
- Modify: `web/src/timer-state.ts`: `startTimerNow` and the `startTimer` export.
- Test: `.claude/e2e/tests/timer.spec.ts`: append to the `#226` section.

**Interfaces:**
- Consumes: Task 4's `askHowToStop(…): Promise<"closed" | "timer-changed">`, Task 3's stub, `bootReadShowsWork1`, and #207's `staleBootRead`.
- Produces: `startTimerNow(instanceId: number, issueKey: string, retried = false): Promise<void>`. The exported `startTimer`'s signature is unchanged.

- [ ] **Step 1: Write the failing tests.** Append to the `#226` section:

```ts
/** Today's issues with a third ticket, for a switch to a ticket neither tab runs. */
async function stubThreeIssues(page: Page): Promise<void> {
  await page.route("**/api/issues", (route) =>
    route.fulfill({
      status: 200,
      json: {
        instances: [
          {
            id: 1,
            name: "Work",
            issues: [
              { key: "WORK-1", summary: "Fix the export", status: "In Progress", url: "" },
              { key: "WORK-2", summary: "Tidy the backlog", status: "To Do", url: "" },
              { key: "WORK-3", summary: "Write the notes", status: "To Do", url: "" },
            ],
            error: null,
          },
        ],
      },
    }),
  );
}

test("a stale tab's switch is refused, asks again about the timer that runs now, and never stops it with the first choice", async ({
  page,
}) => {
  await stubThreeIssues(page);
  const recorder = await stubTimer(page, { runningFor: 60, issueKey: "WORK-2" });
  await bootReadShowsWork1(page);
  await page.goto("/today");
  await expect(railTimer(page)).toContainText("WORK-1");

  const dialog = page.getByRole("dialog");
  const heading = dialog.getByRole("heading");
  const description = dialog.getByRole("textbox", { name: "Description" });
  await ticketRow(page, "WORK-3").getByRole("button", { name: "start timer" }).click();
  await expect(heading).toHaveText("Stop WORK-1 and start WORK-3?");
  await description.fill("Paired on it");
  await dialog.getByRole("button", { name: "Log 0:15" }).click();

  await expect(heading).toHaveText("Stop WORK-2 and start WORK-3?");
  await expect(description).toHaveValue("");
  expect(recorder.starts).toEqual([
    expect.objectContaining({
      issueKey: "WORK-3",
      round: "up",
      expected: expect.objectContaining({ issueKey: "WORK-1" }),
    }),
  ]);
  expect(recorder.logged).toEqual([]);

  await dialog.getByRole("button", { name: "Log 0:15" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(ticketRow(page, "WORK-3").getByRole("button", { name: "stop timer" })).toBeVisible();
  expect(recorder.logged).toEqual([expect.objectContaining({ issueKey: "WORK-2", comment: "" })]);
  await expect(page.locator("that-toast")).toHaveCount(0);
});

test("after a refused switch, a re-read that finds the clicked ticket running asks nothing more", async ({ page }) => {
  const recorder = await stubTimer(page, { runningFor: 60, issueKey: "WORK-2" });
  await bootReadShowsWork1(page);
  await page.goto("/today");
  await expect(railTimer(page)).toContainText("WORK-1");

  const dialog = page.getByRole("dialog");
  const row = ticketRow(page, "WORK-2");
  await row.getByRole("button", { name: "start timer" }).click();
  await expect(dialog.getByRole("heading")).toHaveText("Stop WORK-1 and start WORK-2?");
  await dialog.getByRole("button", { name: "Log 0:15" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(row.getByRole("button", { name: "stop timer" })).toBeVisible();
  // The next click is a plain stop: nothing was left open or in flight.
  await row.getByRole("button", { name: "stop timer" }).click();
  await expect(dialog.getByRole("heading")).toHaveText("Stop the timer?");
  await dialog.getByRole("button", { name: "Keep running" }).click();

  expect(recorder.starts.length).toBe(1);
  expect(recorder.logged).toEqual([]);
  await expect(page.locator("that-toast")).toHaveCount(0);
});

test("after a refused switch, a re-read that finds nothing running starts the clicked ticket plainly", async ({
  page,
}) => {
  const recorder = await stubTimer(page);
  await bootReadShowsWork1(page);
  await page.goto("/today");
  await expect(railTimer(page)).toContainText("WORK-1");

  const dialog = page.getByRole("dialog");
  await ticketRow(page, "WORK-2").getByRole("button", { name: "start timer" }).click();
  await expect(dialog.getByRole("heading")).toHaveText("Stop WORK-1 and start WORK-2?");
  await dialog.getByRole("button", { name: "Log 0:15" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(ticketRow(page, "WORK-2").getByRole("button", { name: "stop timer" })).toBeVisible();
  await expect(railTimer(page)).toContainText("WORK-2");
  expect(recorder.starts).toEqual([
    expect.objectContaining({ issueKey: "WORK-2", expected: expect.objectContaining({ issueKey: "WORK-1" }) }),
    expect.objectContaining({ issueKey: "WORK-2" }),
  ]);
  expect(recorder.starts[1]).not.toHaveProperty("expected");
  expect(recorder.starts[1]).not.toHaveProperty("round");
  await expect(page.locator("that-toast")).toHaveCount(0);
});

test("a stale start that asked once and is then refused closes quietly instead of asking again", async ({ page }) => {
  await stubTimer(page, { runningFor: 60 });
  await staleBootRead(page);
  let starts = 0;
  await page.route("**/api/timer/start", (route) => {
    starts += 1;
    return starts === 2
      ? route.fulfill({ status: 409, json: { code: "timer_changed", message: "The timer changed in another tab." } })
      : route.fallback();
  });
  await page.goto("/today");
  await expect(railTimer(page)).toContainText("No timer running");

  const dialog = page.getByRole("dialog");
  await ticketRow(page, "WORK-2").getByRole("button", { name: "start timer" }).click();
  await expect(dialog.getByRole("heading")).toHaveText("Stop WORK-1 and start WORK-2?");
  await dialog.getByRole("button", { name: "Log 0:15" }).click();
  await expect(dialog).toHaveCount(0);

  // A second switch dialog would be modal and block this click.
  await ticketRow(page, "WORK-1").getByRole("button", { name: "stop timer" }).click();
  await expect(dialog.getByRole("heading")).toHaveText("Stop the timer?");
  await dialog.getByRole("button", { name: "Keep running" }).click();

  expect(starts).toBe(2);
  await expect(page.locator("that-toast")).toHaveCount(0);
  await expect(railTimer(page)).toContainText("WORK-1");
});

test("a plain retry after a refused switch that is refused too reports once and sends no third start", async ({
  page,
}) => {
  await stubTimer(page);
  await bootReadShowsWork1(page);
  let starts = 0;
  await page.route("**/api/timer/start", (route) => {
    starts += 1;
    return starts === 1
      ? route.fallback()
      : route.fulfill({ status: 400, json: { code: "invalid_request", message: "round" } });
  });
  await page.goto("/today");
  await expect(railTimer(page)).toContainText("WORK-1");
  // Reads after boot: the 409's re-read finds nothing; a later one would find WORK-2.
  let reads = 0;
  await page.route("**/api/timer", (route) => {
    reads += 1;
    const running = reads === 1 ? null : { instanceId: 1, issueKey: "WORK-2", startedAt: new Date().toISOString() };
    return route.fulfill({ status: 200, json: { running, stopped: null } });
  });

  const dialog = page.getByRole("dialog");
  await ticketRow(page, "WORK-2").getByRole("button", { name: "start timer" }).click();
  await dialog.getByRole("button", { name: "Log 0:15" }).click();

  await expect(page.locator("that-toasts that-toast[tone='error']")).toHaveCount(1);
  await expect(dialog).toHaveCount(0);
  expect(starts).toBe(2);
});
```

- [ ] **Step 2: Run the five; expect each failure for its named reason.** Run with `-g "stale tab's switch is refused|refused switch|stale start that asked once|plain retry after a refused switch"`.

Expected:
- "…asks again about the timer that runs now…" FAILS on `heading` `toHaveText("Stop WORK-2 and start WORK-3?")`. After Task 4 the switch dialog closes quietly and nothing reopens. Quote it.
- "…finds nothing running starts the clicked ticket plainly" FAILS on the WORK-2 `stop timer` visible: nothing starts.
- "…plain retry…" FAILS on the error toast count 1 (received 0): no plain retry is sent.
- "…finds the clicked ticket running…" PASSES after Task 4. It is a *guard*: the re-read already shows WORK-2 and nothing reopens. Proven by mutation in Step 5.
- "…asked once and is then refused…" PASSES after Task 4. It is a *guard*: the start path ignores the outcome. Proven by mutation in Step 5.

- [ ] **Step 3: Implement.** Replace `startTimerNow` whole:

```ts
/** Starting over a running timer stops it first, so it asks how, the same as
 *  a stop does; kept running, nothing starts. `retried` marks the one retry a
 *  click gets — #207's re-read or #226's 409 — so no path makes two. */
async function startTimerNow(instanceId: number, issueKey: string, retried = false): Promise<void> {
  const start = async (choice?: StopChoice, shown?: RunningTimer): Promise<void> => {
    const response = await postStartTimer(instanceId, issueKey, choice, shown);
    setRunning(response.running);
    if (response.stopped) announceEntriesChanged();
  };

  if (running) {
    const outcome = await askHowToStop(issueKey, start);
    // Another tab changed the timer (#226), and the re-read says what runs now:
    // this ticket, done; another, ask about it; nothing, start plainly.
    if (outcome === "closed" || retried || isRunningTicket(instanceId, issueKey)) return;
    await startTimerNow(instanceId, issueKey, true);

    return;
  }
  try {
    await start();
  } catch (error) {
    // A 400 to a start with no rounding means a timer this tab never saw is
    // running. Re-read it and ask, so the first click is not a silent no-op
    // (#207). A retry already spent rethrows instead, so it toasts.
    if (retried || !(error instanceof ApiError && error.status === 400)) throw error;
    await readTimer().catch(() => undefined);
    if (isRunningTicket(instanceId, issueKey)) return;
    if (!running) throw error;
    await startTimerNow(instanceId, issueKey, true);
  }
}
```

There is one recursive call for "another runs" and "nothing runs" alike. With nothing running, it takes the plain-start branch, which sends no rounding and no `expected` (Ruling 6).

Then run `docker compose run --rm --no-deps web npx prettier --write web/src/timer-state.ts`, then `make tsc`.

- [ ] **Step 4: Run the five; all pass.** Then run the whole of `timer.spec.ts timer-guard.spec.ts`; all pass. Every #207 test must pass, in particular "…a switch whose retry fails shows the block, sends two starts and no third" and "…the first click on start asks to switch…".

- [ ] **Step 5: Mutation-prove every assertion added.** One run per mutation:
  - Delete `await startTimerNow(instanceId, issueKey, true);` in the running branch. "…asks again…" goes red on the WORK-2 heading. "…starts the clicked ticket plainly" goes red on WORK-2's `stop timer`.
  - Drop `|| isRunningTicket(instanceId, issueKey)`. "…finds the clicked ticket running…" goes red: a "Stop WORK-2 and start WORK-2?" dialog opens, so the heading reads wrong or the row click is blocked.
  - Drop `|| retried` in the running branch. "…asked once and is then refused…" goes red: after the 409 a second switch dialog opens, so the row click is blocked, or `starts` is 3.
  - Restore that, then change #207's recursion to `startTimerNow(instanceId, issueKey)`, without `true`. The same test goes red the same way, because the dialog #207 opened no longer counts as the retry.
  - Drop `retried ||` in the catch. "…plain retry…" goes red on the error toast count, received 0: the 400 re-reads, finds WORK-2, the clicked ticket, and returns quietly.
  - Retry with the old choice: in the running branch, call `askHowToStop(issueKey, start)` and on "timer-changed" call `start(lastChoice, currentTimer() ?? undefined)` instead, capturing `lastChoice` in a wrapper around `start`. "…asks again…" goes red on the heading: no second dialog opens, and WORK-2 is logged with "Paired on it". Run again with the heading assertion commented out: red on `recorder.logged).toEqual([])`.
  - Carry the description: as a mutation only, prefill the dialog as in Task 4. "…asks again…" goes red on `toHaveValue("")`.
  - Send the plain retry with the rounding, `start({ round: "up", comment: "" })`, in place of the recursion when `!running`. "…starts the clicked ticket plainly" goes red on `not.toHaveProperty("round")`. Send `expected` on it: red on `not.toHaveProperty("expected")`.
  - "…asks again…"'s final `that-toast` count 0, and the `logged` WORK-2 with `comment: ""`: make the running branch `throw new Error("x")` after the recursion. Red on the toast count.

- [ ] **Step 6: Commit.**

```bash
git add web/src/timer-state.ts .claude/e2e/tests/timer.spec.ts
git commit -m "#226: a refused switch asks again, stops there, or starts plainly, once"
```

---

### Task 6: Compare the reopened dialogs against the drawing, and the final gates

**Files:** none changed.

- [ ] **Step 1: Compare against the drawing.** No new mark is drawn, so no screenshot pair is needed, and the report says so. The report states, for each check, what was compared and what was found:
  - **Reopened stop dialog:** heading "Stop the timer?", the line "WORK-2 ran" and an empty Description. This is #185's stop dialog for the timer now running. Task 4's first test asserts it.
  - **Reopened switch dialog:** heading "Stop WORK-2 and start WORK-3?" and an empty Description. This is #185's switch dialog for the timer now running. Task 5's first test asserts it.
  - **The failed-re-read block:** one error block reading "The timer changed in another tab.", above the dialog. This is #208's block, with geometry pinned by #208's first test, and its text is the server's message.

  Report any difference the ticket forced to the owner; do not absorb it.

- [ ] **Step 2: Check the ticket's acceptance criteria one by one** against the tests that pin them, and list the mapping in the report:

  | Criterion | Pinned by |
  |---|---|
  | Store table | Task 1, the first test |
  | Stale day | Task 1, the second test |
  | `httptest` table | Task 2 |
  | e2e stop | Task 4, the first test |
  | e2e switch | Task 5, the first test |
  | e2e nothing running | Task 4, the second test |
  | One retry | Task 4 "refused twice"; Task 5 "asked once" and "plain retry" |

- [ ] **Step 3: Final gates.** Paste both outputs' tails into the report.

```shell
make verify
make test-e2e
```

Both must be green. There is no commit in this task.
