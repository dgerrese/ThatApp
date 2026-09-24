# Stopping a timer confirms the worklog (#185) Implementation Plan

**Date:** 2026-09-23
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stopping a timer, or switching away from one, opens a confirm dialog whose buttons round
the run up or down to the 15-minute grid (down to zero discards it) and carry an optional
description that becomes the Jira worklog comment.

**Architecture:** The rounding is applied in the store's `closeTimer`, from a direction the HTTP
body carries; the midnight close keeps its honest, 60-second-floored path untouched. In the
browser, `timer-state.ts`'s `stopTimer`/`startTimer` open a lazily imported `that-stop-dialog`
before posting, so neither `that-timer.ts` nor `rail.ts` changes. The dialog reuses
`that-confirm`'s shell and buttons, `that-entry-dialog`'s comment field, and `that-duration`'s
grid arithmetic in `duration.ts`.

**Tech Stack:** Go stdlib + `modernc.org/sqlite`; vanilla TypeScript (strict), Tailwind v4,
light-DOM `that-*` components; Playwright (Firefox, Chromium).

**Spec:** Issue #185's body (the rule, the three stop paths, the acceptance criteria and *The
dialog, settled in the design session of 2026-09-23*), plus
`docs/superpowers/specs/2026-09-18-timer-design.md`, which Task 3 amends.

## Global Constraints

- Docker only: never run `go`, `node` or `npm` on the host. `make test-go`, `make test-web`,
  `make verify`, `make test-e2e`, or `docker compose run --rm --no-deps app go test ./internal/store/ -run X -v`.
- Up is `ceil(elapsed / 900) * 900`; down is `floor(elapsed / 900) * 900`; **a result of zero
  discards** — no row, and the response says `"discarded": true`.
- The midnight close (`RunningTimer`, and any close of a timer whose start day has passed) is
  **unchanged**: no rounding, `store.MinTimerSeconds` (60) still discards under a minute.
- `TestPostEntryAcceptsSecondsThatAreNotAMultipleOf900` stays untouched and passing.
- `POST /api/timer/stop` with no body, or a `round` other than `"up"`/`"down"`, is
  `400 invalid_request`.
- TypeScript: no `any`, no `as any`, no non-null assertion; do not touch `tsconfig.json`.
- Light DOM only. No new dependency.
- **`web/src/components/that-timer.ts` is not edited** (open PR #195 edits it).
- Copy, verbatim: heading `Stop the timer?`; switch heading `Stop <KEY> and start <KEY>?`; run line
  `<KEY> ran <H:MM>`; eyebrow `Description`; placeholder
  `Optional — becomes the Jira worklog comment`; buttons `Keep running`, `Log <H:MM>`,
  `Discard run`.
- Commits: if signing fails because the 1Password vault is locked, retry with
  `git -c commit.gpgsign=false commit …`. Never push. End every commit message with:

  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01RMHka2uP8XsVpm3n9DKZoH
  ```

---

### Task 1: The store rounds a confirmed stop to the grid

**Files:**
- Modify: `internal/store/timers.go`
- Modify: `internal/store/timers_test.go`
- Modify (signature fallout only): `internal/server/timer.go`, `internal/server/timer_test.go`
  and any other caller — find them with `grep -rn "StartTimer(\|StopTimer(" internal`

**Interfaces:**
- Produces:
  ```go
  type Rounding string
  const RoundUp Rounding = "up"
  const RoundDown Rounding = "down"
  const GridSeconds = 900
  var ErrRoundingRequired error
  type TimerClose struct { Round Rounding; Comment string }
  func (s *Store) StopTimer(ctx context.Context, now time.Time, loc *time.Location, choice TimerClose) (stopped *Entry, wasRunning bool, err error)
  func (s *Store) StartTimer(ctx context.Context, instanceID int64, issueKey string, now time.Time, loc *time.Location, choice TimerClose) (running *Timer, stopped *Entry, wasRunning bool, err error)
  ```
  `wasRunning` on `StartTimer` is new: true when a timer was running and this call closed it.

- [ ] **Step 1: Write the failing tests** in `internal/store/timers_test.go`.

  The grid table, through both user paths (the criterion's edges, both directions):

  ```go
  // TestAConfirmedCloseRoundsToTheGrid pins the rule the stop dialog confirms:
  // up is the ceiling, down the floor, and a result of zero discards. It runs
  // every case through both user paths, the stop and the switch, because
  // they share closeTimer and a refactor that split them must not diverge.
  func TestAConfirmedCloseRoundsToTheGrid(t *testing.T) {
  	cases := []struct {
  		elapsed  time.Duration
  		round    Rounding
  		want     int // 0 means discarded
  	}{
  		{0, RoundUp, 0}, {0, RoundDown, 0},
  		{1 * time.Second, RoundUp, 900}, {1 * time.Second, RoundDown, 0},
  		{59 * time.Second, RoundUp, 900}, {59 * time.Second, RoundDown, 0},
  		{60 * time.Second, RoundUp, 900}, {60 * time.Second, RoundDown, 0},
  		{899 * time.Second, RoundUp, 900}, {899 * time.Second, RoundDown, 0},
  		{900 * time.Second, RoundUp, 900}, {900 * time.Second, RoundDown, 900},
  		{901 * time.Second, RoundUp, 1800}, {901 * time.Second, RoundDown, 900},
  		{1800 * time.Second, RoundUp, 1800}, {1800 * time.Second, RoundDown, 1800},
  	}
  	loc := mustLoadLocation(t, "Europe/Amsterdam")
  	start := time.Date(2026, 9, 21, 10, 0, 0, 0, time.UTC)

  	for _, path := range []string{"stop", "switch"} {
  		for _, tc := range cases {
  			name := fmt.Sprintf("%s %s after %v", path, tc.round, tc.elapsed)
  			t.Run(name, func(t *testing.T) {
  				s := openTestStore(t)
  				inst := createTestInstance(t, s)
  				if _, _, _, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-1", start, loc, TimerClose{}); err != nil {
  					t.Fatalf("starting: %v", err)
  				}
  				choice := TimerClose{Round: tc.round, Comment: "Traced the export"}
  				at := start.Add(tc.elapsed)

  				var (
  					entry      *Entry
  					wasRunning bool
  					err        error
  				)
  				if path == "stop" {
  					entry, wasRunning, err = s.StopTimer(context.Background(), at, loc, choice)
  				} else {
  					_, entry, wasRunning, err = s.StartTimer(context.Background(), inst.ID, "RIDGE-2", at, loc, choice)
  				}
  				if err != nil {
  					t.Fatalf("closing: %v", err)
  				}
  				if !wasRunning {
  					t.Error("wasRunning = false, want true")
  				}
  				if tc.want == 0 {
  					if entry != nil {
  						t.Errorf("entry = %+v, want nil: the rounded run is zero, so it is discarded", entry)
  					}
  					return
  				}
  				if entry == nil {
  					t.Fatalf("entry = nil, want %ds", tc.want)
  				}
  				if entry.Seconds != tc.want {
  					t.Errorf("entry.Seconds = %d, want %d", entry.Seconds, tc.want)
  				}
  				if entry.Comment != "Traced the export" {
  					t.Errorf("entry.Comment = %q, want the confirmed description", entry.Comment)
  				}
  			})
  		}
  	}
  }
  ```

  A same-day close with no direction is refused and changes nothing:

  ```go
  func TestAUserCloseWithoutARoundingIsRefusedAndLeavesTheTimerRunning(t *testing.T) {
  	loc := mustLoadLocation(t, "Europe/Amsterdam")
  	start := time.Date(2026, 9, 21, 10, 0, 0, 0, time.UTC)
  	at := start.Add(20 * time.Minute)

  	for _, path := range []string{"stop", "switch"} {
  		t.Run(path, func(t *testing.T) {
  			s := openTestStore(t)
  			inst := createTestInstance(t, s)
  			if _, _, _, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-1", start, loc, TimerClose{}); err != nil {
  				t.Fatalf("starting: %v", err)
  			}

  			var err error
  			if path == "stop" {
  				_, _, err = s.StopTimer(context.Background(), at, loc, TimerClose{})
  			} else {
  				_, _, _, err = s.StartTimer(context.Background(), inst.ID, "RIDGE-2", at, loc, TimerClose{})
  			}
  			if !errors.Is(err, ErrRoundingRequired) {
  				t.Fatalf("err = %v, want ErrRoundingRequired", err)
  			}

  			running, _, err := s.RunningTimer(context.Background(), at, loc)
  			if err != nil {
  				t.Fatalf("RunningTimer: %v", err)
  			}
  			if running == nil || running.IssueKey != "RIDGE-1" {
  				t.Errorf("running = %+v, want RIDGE-1 still running: the refusal must roll back", running)
  			}
  		})
  	}
  }
  ```

  A timer whose start day has passed is the midnight close even when the user stops it, so it stays
  honest whatever direction was confirmed (23:37 local to midnight is 1380s, off the grid):

  ```go
  func TestAStaleTimerStoppedByTheUserIsTheMidnightCloseAndStaysHonest(t *testing.T) {
  	loc := mustLoadLocation(t, "Europe/Amsterdam")
  	start := time.Date(2026, 9, 21, 23, 37, 0, 0, loc)
  	read := time.Date(2026, 9, 22, 9, 0, 0, 0, loc)

  	for _, round := range []Rounding{RoundUp, RoundDown} {
  		t.Run(string(round), func(t *testing.T) {
  			s := openTestStore(t)
  			inst := createTestInstance(t, s)
  			if _, _, _, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-1", start, loc, TimerClose{}); err != nil {
  				t.Fatalf("starting: %v", err)
  			}
  			entry, _, err := s.StopTimer(context.Background(), read, loc, TimerClose{Round: round})
  			if err != nil {
  				t.Fatalf("StopTimer: %v", err)
  			}
  			if entry == nil || entry.Seconds != 1380 {
  				t.Fatalf("entry = %+v, want the honest 1380s: past midnight nothing rounds", entry)
  			}
  			if entry.Day != "2026-09-21" {
  				t.Errorf("entry.Day = %q, want the start's local day", entry.Day)
  			}
  		})
  	}
  }
  ```

  Add `"errors"` and `"fmt"` to the imports.

- [ ] **Step 2: Update the existing tests to the new signatures and meaning.**
  - Every `s.StartTimer(..., loc)` becomes `s.StartTimer(..., loc, TimerClose{})` with a fourth
    return (`_, _, _, err` / `running, stopped, _, err`) where nothing same-day is being closed.
  - `TestStopTimerAfter25MinutesCreatesOneEntry`: stop with
    `TimerClose{Round: RoundUp, Comment: "Traced the export"}`; want `1800` and that comment. Keep
    its other assertions. Rename to `TestStopTimerAfter25MinutesRoundedUpCreatesOneEntry`.
  - Delete `TestStopTimerAfter59SecondsCreatesNoEntry` (the grid table covers it).
  - `TestStopTimerWithNothingRunning`: pass `TimerClose{}`; still no error, `wasRunning` false.
  - `TestStartTimerSwitchesFromA10MinuteRun`: switch with `TimerClose{Round: RoundUp}`, want `900`.
  - `TestStartTimerSwitchesFromA30SecondRun`: switch with `TimerClose{Round: RoundDown}`, want nil
    entry and `wasRunning` true.
  - `TestMidnightClosesAnOvernightTimer`'s StopTimer/StartTimer subtests: pass
    `TimerClose{Round: RoundUp}`; they still want the honest 1800.
  - `TestDiscardBoundaryIsExactlySixtySeconds`: the 60-second floor now lives on the midnight path
    only, so each case starts at `time.Date(2026, 9, 21, 0, 0, 0, 0, loc).AddDate(0, 0, 1).Add(-tc.duration)`
    (that much before local midnight) and closes at `time.Date(2026, 9, 22, 9, 0, 0, 0, loc)`,
    passing `TimerClose{Round: RoundUp}` — so the case proves the floor, not the rounding, decides
    (a rounded-up 59s would be 900). Same expectations: 59s discards, 60s logs 60, 61s logs 61.
    Update its doc comment to say it pins the floor on the midnight path.
  - Callers in `internal/server/` (`timer.go`, `timer_test.go`'s `db.StartTimer` seeding): pass
    `store.TimerClose{}` / take the extra return, just enough to compile. Task 2 does the HTTP work.

- [ ] **Step 3: Run to verify RED.**
  Run: `docker compose run --rm --no-deps app go test ./internal/store/ -run 'Timer|Discard|Midnight|Grid|Stale|UTC|DST' -v`
  Expected: compile failure (`undefined: TimerClose`, `RoundUp`, `ErrRoundingRequired`). Paste it.

- [ ] **Step 4: Implement** in `internal/store/timers.go`.

  ```go
  // Rounding is the direction a stop the user confirmed lands on the grid.
  type Rounding string

  const (
  	RoundUp   Rounding = "up"
  	RoundDown Rounding = "down"
  )

  // GridSeconds is the 15-minute grid a confirmed stop rounds to.
  const GridSeconds = 900

  // ErrRoundingRequired refuses a stop or a switch of a same-day timer that
  // names no direction. Only the midnight close logs an honest run, because
  // only there is nobody present to confirm one.
  var ErrRoundingRequired = errors.New("stopping a timer needs a rounding direction, up or down")

  // TimerClose is what the user confirmed in the stop dialog. The zero value
  // is the midnight close's: no direction and no comment.
  type TimerClose struct {
  	Round   Rounding
  	Comment string
  }

  func roundedSeconds(seconds int, round Rounding) int {
  	if seconds <= 0 {
  		return 0
  	}
  	if round == RoundUp {
  		return (seconds + GridSeconds - 1) / GridSeconds * GridSeconds
  	}

  	return seconds / GridSeconds * GridSeconds
  }
  ```

  `closeTimer` takes `choice TimerClose` and decides by path:

  ```go
  func closeTimer(ctx context.Context, tx *sql.Tx, timer Timer, now time.Time, loc *time.Location, choice TimerClose) (*Entry, error) {
  	end := now
  	if deadline := localMidnightAfter(timer.StartedAt, loc); deadline.Before(end) {
  		end = deadline
  	}
  	seconds := int(end.Sub(timer.StartedAt) / time.Second)

  	switch {
  	case staleTimer(timer.StartedAt, now, loc):
  		// The midnight close, whoever triggered it: honest, and floored at
  		// Jira's minimum rather than rounded.
  		if seconds < MinTimerSeconds {
  			return nil, nil
  		}
  	case choice.Round == RoundUp || choice.Round == RoundDown:
  		seconds = roundedSeconds(seconds, choice.Round)
  		if seconds == 0 {
  			return nil, nil
  		}
  	default:
  		return nil, ErrRoundingRequired
  	}

  	entry, err := insertEntry(ctx, tx, EntryInput{
  		InstanceID: timer.InstanceID,
  		IssueKey:   timer.IssueKey,
  		Day:        timer.StartedAt.In(loc).Format(timerDayLayout),
  		StartedAt:  timer.StartedAt,
  		Seconds:    seconds,
  		Comment:    choice.Comment,
  	})
  	...
  }
  ```

  `RunningTimer` calls `closeTimer(..., TimerClose{})` (it only ever closes stale timers).
  `StopTimer` and `StartTimer` take `choice TimerClose` and pass it through; `StartTimer` returns
  `wasRunning = existing != nil`. Return `ErrRoundingRequired` unwrapped (or `%w`-wrapped) so
  `errors.Is` finds it; the deferred rollback undoes nothing-yet-written. Update the doc comments of
  `MinTimerSeconds` (now: the midnight close's floor only), `closeTimer`, `StopTimer`, `StartTimer`.

- [ ] **Step 5: Run to verify GREEN.** `make test-go`. Expected: PASS, including
  `TestPostEntryAcceptsSecondsThatAreNotAMultipleOf900` untouched.

- [ ] **Step 6: Commit.** `feat(store): a confirmed timer stop rounds to the 15-minute grid (#185)`

---

### Task 2: The timer endpoints carry the direction and the description

**Files:**
- Modify: `internal/server/timer.go`
- Modify: `internal/server/timer_test.go`

**Interfaces:**
- Consumes: Task 1's `store.TimerClose`, `store.RoundUp/RoundDown`, `store.ErrRoundingRequired`,
  the new `StopTimer`/`StartTimer` signatures.
- Produces (HTTP):
  - `POST /api/timer/stop` body `{"round":"up"|"down","comment":"…"}` →
    `200 {"stopped": <entry|null>, "discarded": bool}`.
  - `POST /api/timer/start` body `{"instanceId","issueKey","round"?,"comment"?}` →
    `200 {"running": {…}, "stopped": <entry|null>, "discarded": bool}`.
  - 400 `invalid_request`: stop with no/malformed body or `round` not up/down; start with a
    `round` present but not up/down; start while a same-day timer runs with no `round`.

- [ ] **Step 1: Write the failing tests** in `internal/server/timer_test.go`.
  - `decodeStartTimer` helper returning `startTimerResponse`.
  - `TestStopTimerRejectsAMissingOrUnknownRound`: table over bodies `""`, `"{}"`,
    `{"round":"sideways"}`, `{"round":"UP"}`, `{`; each after a start → `assertRejected(t, rec,
    http.StatusBadRequest, "invalid_request")`, and a GET afterwards still reports the timer
    running.
  - Rewrite `TestStopTimerAfter25MinutesLogsTheEntry`: stop body
    `{"round":"up","comment":"Traced the export"}`; want `seconds == 1800`, `comment ==
    "Traced the export"`, `discarded == false`; keep the "matches GET /api/entries" assertion.
  - Replace `TestStopTimerUnderAMinuteDiscardsIt` with `TestStopTimerRoundedDownUnderFifteenMinutesDiscardsIt`:
    7 minutes, `{"round":"down"}` → `discarded == true`, `stopped == nil`, no entries listed.
  - `TestStopTimerWithNothingRunningIsNotAnError`: send `{"round":"down"}`.
  - Rewrite `TestStartTimerSwitchesFromTheRunningOne`: switch at 5 minutes with
    `"round":"up","comment":"Paired on it"` → stopped FIRST-1 at 900 with that comment,
    `discarded == false`.
  - `TestStartTimerSwitchRoundedDownToZeroDiscards`: same with `"round":"down"` → `stopped == nil`,
    `discarded == true`, running SECOND-2.
  - `TestStartTimerWithATimerRunningAndNoRoundIsRefused`: second start without `round` → 400
    `invalid_request`; GET still reports FIRST-1 running.
  - `TestStartTimerWithNothingRunningIgnoresTheChoice`: first start with
    `"round":"down","comment":"x"` → 200, running, `stopped == nil`, `discarded == false`.
  - `TestStartTimerRejectsAnUnknownRound`: first start with `"round":"sideways"` → 400.
  - `TestAStoppedTimersCommentReachesJiraOnPush`: two subtests, comment `"Traced the export"` and
    `""`. Build a server whose instance points at an `httptest.Server` that records each worklog
    POST body (see `newPushEnv` in `push_test.go` for the shape: `newServerWithStore`,
    `seedInstance(t, db, sealer, "Work", "", jira.URL)`, then set `s.cfg.Location` and `s.now`).
    Start, stop with `{"round":"up","comment":…}`, then `pushDay(t, s, <day>)`. Assert the
    recorded body contains `Traced the export` in the first subtest, and has **no** `"comment"`
    key in the second (`json.Unmarshal` into `map[string]json.RawMessage`).

- [ ] **Step 2: Run to verify RED.** `docker compose run --rm --no-deps app go test ./internal/server/ -run 'Timer' -v`.
  Expected: failures (stop with no body answers 200; `discarded` absent on start). Paste them.

- [ ] **Step 3: Implement** in `internal/server/timer.go`.

  ```go
  // stopTimerRequest is the body POST /api/timer/stop requires: the direction
  // the stop dialog confirmed, and its optional description.
  type stopTimerRequest struct {
  	Round   store.Rounding `json:"round"`
  	Comment string         `json:"comment"`
  }

  func validRound(round store.Rounding) bool {
  	return round == store.RoundUp || round == store.RoundDown
  }
  ```

  `startTimerRequest` gains `Round store.Rounding` and `Comment string` with the same tags. A new
  `startTimerResponse{Running *timerDTO; Stopped *entryDTO; Discarded bool}` (json `running`,
  `stopped`, `discarded`) replaces `timerStateResponse` as the start answer; GET keeps
  `timerStateResponse`.

  `handleStopTimer`: decode (an empty body is a decode error → 400 "the request body is not valid
  JSON"); `!validRound` → 400 `"round must be \"up\" or \"down\""`; then
  `s.db.StopTimer(ctx, s.now(), s.cfg.Location, store.TimerClose{Round: req.Round, Comment: req.Comment})`.

  `handleStartTimer`: after decoding, `req.Round != "" && !validRound(req.Round)` → the same 400;
  after `StartTimer`, `errors.Is(err, store.ErrRoundingRequired)` → 400 `invalid_request`
  `"a timer is running: round is required to stop it"`; `Discarded: wasRunning && stopped == nil`.

  Update the doc comments on both handlers to say what the body carries.

- [ ] **Step 4: Run to verify GREEN.** `make test-go`, then `make lint`. Expected: PASS.

- [ ] **Step 5: Commit.** `feat(server): the timer stop and switch take a rounding and a description (#185)`

---

### Task 3: The drawing and the design documents record the dialog

**Files:**
- Modify: `docs/superpowers/prototypes/2026-09-03-app-prototype.html`
- Modify: `docs/superpowers/specs/2026-09-18-timer-design.md`
- Modify: `docs/superpowers/specs/2026-09-03-visual-language-design.md`
- Modify: `docs/superpowers/specs/2026-08-21-manual-time-entry-design.md`

**Interfaces:** Produces the drawing Task 4 is built against and compared with.

Required reading: issue #185's body, section *The dialog, settled in the design session of
2026-09-23* (`tea api "repos/{owner}/{repo}/issues/185" | python3 -c "import sys,json;print(json.load(sys.stdin)['body'])"`).
The prototype is a fragment on purpose — **do not add a doctype**.

- [ ] **Step 1: Prototype.** Inside `<div class="pt dark">`, after the `.app` div closes and
  before `<p class="cap">`, draw both variants side by side as static sheets:

  ```html
  <div class="stopdemo">
    <div class="sheet ssheet">
      <h3 class="sh">Stop the timer?</h3>
      <p class="srun"><span class="ekey">RIDGE-5325</span> ran <span class="mono">0:20</span></p>
      <label class="sdesc"><span class="seyebrow">Description</span>
        <input class="ecomment-in" placeholder="Optional — becomes the Jira worklog comment"></label>
      <div class="sacts">
        <button class="btn quiet">Keep running</button>
        <button class="btn quiet">Log 0:15</button>
        <button class="btn primary">Log 0:30</button>
      </div>
    </div>
    <div class="sheet ssheet">
      <h3 class="sh">Stop the timer?</h3>
      <p class="srun"><span class="ekey">RIDGE-5325</span> ran <span class="mono">0:07</span></p>
      <label class="sdesc"><span class="seyebrow">Description</span>
        <input class="ecomment-in" placeholder="Optional — becomes the Jira worklog comment"></label>
      <div class="sacts">
        <button class="btn quiet">Keep running</button>
        <button class="btn danger">Discard run</button>
        <button class="btn primary">Log 0:15</button>
      </div>
    </div>
  </div>
  ```

  CSS, in the main `<style>` block, transcribing the build's classes (`that-confirm`'s shell: 20px
  padding, 8px radius, edge border, raised ground; heading 17px bold −0.02em; muted 14px run line
  with 16px below; eyebrow 12px bold 0.16em uppercase muted; 8px button gap):

  ```css
  .stopdemo { display: flex; gap: 28px; flex-wrap: wrap; margin-top: 28px; color: var(--ink); }
  .ssheet { width: 440px; margin: 0; padding: 20px; box-sizing: border-box; }
  .ssheet .sh { margin: 0 0 8px; font-size: 17px; font-weight: 700; letter-spacing: -.02em; }
  .srun { margin: 0 0 16px; font-size: 14px; color: var(--ink-muted); }
  .sdesc { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
  .sdesc .ecomment-in { width: 100%; font-size: 13px; }
  .seyebrow { font-size: 12px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: var(--ink-muted); }
  .sacts { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
  .btn { white-space: nowrap; }
  .btn.danger { background: var(--fail); color: var(--state-ink); }
  .btn.danger:hover { opacity: .9; }
  ```

  Add `--state-ink: oklch(0.16 0.01 60);` to `.pt.dark` and `--state-ink: oklch(0.99 0.004 70);`
  to `.pt.light` (the app's `--color-state-ink`). Extend the caption with a `<b>Stop dialog</b>`
  sentence: the rounding is the button; down reads "Discard run" in the failed tone under 15
  minutes; up is primary so Enter rounds up; "Keep running" cancels; labels never break.

  Open it inside the companion frame (substitute the file for `<!-- CONTENT -->` in
  `/home/dion/.claude/plugins/cache/claude-plugins-official/superpowers/*/skills/brainstorming/scripts/frame-template.html`)
  in both themes (`#lm-toggle`) and check the two sheets render with every button on one line.
  Say what you looked at in the report.

- [ ] **Step 2: Timer design document.** In `2026-09-18-timer-design.md`:
  - Amend decision 5 in place, dated: "**Superseded for the two user paths on 2026-09-23 (#185).**
    A stop or a switch now opens the stop dialog, and its down button is what discards; the
    60-second floor survives on the midnight close only (decision 6)."
  - Add a section `## The stop dialog (#185, settled 2026-09-23)` holding: the rule sentence and
    its table from the issue; the three stop paths table; the dialog bullets from the issue's
    *The dialog, settled…* section verbatim in substance; that labels and the run line tick with
    the running timer while the dialog is open, so a button always names what it will write; that
    a stop of a timer whose start day has passed is the midnight close and stays honest whatever
    the dialog chose; that the "Under a minute — nothing logged." notice is retired, because every
    discard on a user path is now a button named "Discard run" (reversible, owner to confirm).
  - Update the HTTP bullets to the bodies and responses of Task 2, and the Browser bullets:
    `timer-state.ts` opens `that-stop-dialog` before posting.

- [ ] **Step 3: Visual language.** In `2026-09-03-visual-language-design.md`, add a short
  `## Decision 13 — a button label never breaks` (set by the owner on 2026-09-23 in #185's
  session): `that-button` carries `whitespace-nowrap`, app-wide; a container too narrow for its
  button row grows, or wraps whole buttons, never a label.

- [ ] **Step 4: Manual entry decisions.** In `2026-08-21-manual-time-entry-design.md`, append to
  decision 3 and decision 8 an "**Amended 2026-09-23 (#185):**" sentence: the timer now rounds at
  stop, in its dialog, so a timer entry lands on the grid too; the API still accepts off-grid
  seconds, which the midnight close still writes, and the test pinning that stays.

- [ ] **Step 5: Commit.** `docs: the stop dialog, drawn and recorded (#185)`

---

### Task 4: The stop dialog, end to end

**Files:**
- Modify: `web/src/components/that-button.ts` (add `whitespace-nowrap` to `base`)
- Modify: `web/src/components/that-confirm.ts` (export its shell pieces)
- Modify: `web/src/components/that-entry-dialog.ts` (export the comment field's class)
- Create: `web/src/components/that-stop-dialog.ts`
- Modify: `web/src/duration.ts`, `web/src/duration.test.ts` (`roundedSeconds`)
- Modify: `web/src/types.ts`, `web/src/api.ts`, `web/src/timer-state.ts`, `web/src/views/today.ts`
- Modify: `.claude/e2e/tests/timer.spec.ts`, `.claude/e2e/tests/today-sort-timer.spec.ts`, and any
  other spec that clicks a timer control (`grep -ln "stop timer\|start timer" .claude/e2e/tests`)
- **Not modified:** `web/src/components/that-timer.ts`, `web/src/rail.ts`

**Interfaces:**
- Consumes: Task 2's HTTP contract; Task 3's drawing.
- Produces:
  ```ts
  // types.ts
  export type Rounding = "up" | "down";
  export interface StopChoice { round: Rounding; comment: string }
  export interface StartTimerResponse { running: RunningTimer | null; stopped: Entry | null; discarded: boolean }
  // duration.ts
  export function roundedSeconds(seconds: number, round: Rounding): number
  // api.ts
  export function startTimer(instanceId: number, issueKey: string, choice?: StopChoice): Promise<StartTimerResponse>
  export function stopTimer(choice: StopChoice): Promise<StopTimerResponse>
  // that-stop-dialog.ts
  export function confirmStop(issueKey: string, nextIssueKey: string | undefined, elapsed: () => number): Promise<StopChoice | null>
  ```

**Required reading (drawing):** the stop sheets Task 3 added to
`docs/superpowers/prototypes/2026-09-03-app-prototype.html`, `2026-09-18-timer-design.md`'s
*The stop dialog* section, and `2026-09-03-visual-language-design.md` (Decision 13, tokens). The
report must say what was compared against the drawing and what was found.

- [ ] **Step 1: Failing unit test** in `web/src/duration.test.ts`:

  ```ts
  test("roundedSeconds is the ceiling up and the floor down on the 15-minute grid", () => {
    const cases: [number, "up" | "down", number][] = [
      [0, "up", 0], [0, "down", 0],
      [1, "up", 900], [1, "down", 0],
      [899, "up", 900], [899, "down", 0],
      [900, "up", 900], [900, "down", 900],
      [901, "up", 1800], [901, "down", 900],
      [1800, "up", 1800], [1800, "down", 1800],
    ];
    for (const [seconds, round, want] of cases) {
      assert.equal(roundedSeconds(seconds, round), want, `${round} from ${seconds}`);
    }
  });
  ```

- [ ] **Step 2: Failing e2e specs** in `.claude/e2e/tests/timer.spec.ts`.

  Extend `stubTimer(page, options?: { runningFor?: number /* seconds */ })` so it: starts with a
  timer on WORK-1 already `runningFor` seconds old when given; rejects a stop body whose `round`
  is not `up`/`down` with 400 (mirroring the server); applies the grid on close
  (`up` → `Math.ceil(elapsed / 900) * 900`, `down` → `Math.floor(…)`, zero → no entry) and carries
  `comment`; answers start with `discarded`; and returns a recorder
  `{ stops: Record<string, unknown>[]; starts: Record<string, unknown>[]; logged: StubEntry[] }`.
  Delete `MIN_TIMER_SECONDS` and the test "a stop within a minute reports nothing was logged".
  Update "starting another row's timer…" and "stopping from the rail on Week" to confirm with
  the dialog's up button. New tests (`const dialog = page.getByRole("dialog")`):

  1. **"a stop rounds up in the dialog and the entry carries the seconds and the comment"** —
     start WORK-1 on its row, stop it on its row; the dialog's heading is `Stop the timer?`;
     fill `Description` with `Traced the export`; click `Log 0:15`; expect
     `recorder.logged` to equal one entry with `seconds: 900`, `comment: "Traced the export"`,
     and `recorder.stops[0]` to equal `{ round: "up", comment: "Traced the export" }`.
  2. **"a short run rounded down is discarded and logs nothing"** — start, stop; the down button
     reads `Discard run`; click it; `recorder.logged` is empty, `recorder.stops[0].round` is
     `"down"`, and the rail reads `No timer running`.
  3. **"under 15 minutes the buttons read Keep running, Discard run, Log 0:15, each on one line"**
     — `runningFor: 7 * 60`; open from the rail's stop; the run line reads `WORK-1 ran 0:07`;
     the dialog's buttons' names in order are `["Keep running", "Discard run", "Log 0:15"]`;
     `Discard run`'s inner `<button>` has class `bg-failed`, `Log 0:15`'s has `bg-primary`; and
     each button's text is one line:

     ```ts
     const lines = await button.evaluate((el) => {
       const range = document.createRange();
       range.selectNodeContents(el);
       return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
     });
     expect(lines).toBe(1);
     ```
  4. **"at 15 minutes or more the down button logs the floor, and Enter rounds up"** —
     `runningFor: 20 * 60`; buttons `["Keep running", "Log 0:15", "Log 0:30"]`, `Log 0:15` not
     `bg-failed`; press Enter in `Description`; `recorder.logged[0].seconds` is `1800`.
  5. **"Keep running, or Esc, leaves the timer running"** — start, stop, click `Keep running`:
     no stop was posted, the row still shows `stop timer`; repeat with `Escape`.
  6. **"switching names both tickets, and Keep running starts nothing"** — start WORK-1, click
     WORK-2's `start timer`; heading `Stop WORK-1 and start WORK-2?`; click `Keep running`;
     `recorder.starts.length` is 1 and WORK-1's row still shows `stop timer`.

- [ ] **Step 3: Run to verify RED.** `make test-web` (fails: `roundedSeconds` is not exported)
  and `make test-e2e` (the new specs fail: no dialog). Paste both.

- [ ] **Step 4: Implement.**

  `duration.ts`:

  ```ts
  /**
   * A timer run on the 15-minute grid, as the stop dialog offers it: up is the
   * ceiling, down the floor, and zero means the run is discarded. The server
   * applies the same rule to its own clock (store.roundedSeconds); this copy is
   * only what the buttons say.
   */
  export function roundedSeconds(seconds: number, round: Rounding): number {
    const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
    const grid = STEP_MINUTES * SECONDS_PER_MINUTE;
    const steps = round === "up" ? Math.ceil(safe / grid) : Math.floor(safe / grid);

    return steps * grid;
  }
  ```
  (`import type { Rounding } from "./types";` — a type-only import keeps the node test runnable.)

  `that-button.ts`: `base` gains `whitespace-nowrap`, with a one-line comment citing Decision 13.

  `that-confirm.ts`: export the pieces it already has, unchanged in value, and use them itself:

  ```ts
  export const CONFIRM_DIALOG_CLASS =
    "bg-raised text-ink shadow-dialog border-edge m-auto rounded-md border p-5";
  export const CONFIRM_HEADING_CLASS = "mb-2 text-xl font-bold tracking-[-0.02em]";
  export const CONFIRM_BODY_CLASS = "text-ink-muted mb-4 text-base";
  export function dialogButton(label: string, variant: string): HTMLElement { … }
  ```
  `that-confirm` keeps `max-w-sm` by appending it: `` `${CONFIRM_DIALOG_CLASS} max-w-sm` ``.

  `that-entry-dialog.ts`: hoist the comment input's class string to
  `export const COMMENT_FIELD_CLASS` and use it there unchanged.

  `that-stop-dialog.ts` (new, light DOM):

  ```ts
  import "./that-button";

  import { fieldFigure, roundedSeconds } from "../duration";
  import type { Rounding, StopChoice } from "../types";
  import {
    CONFIRM_BODY_CLASS,
    CONFIRM_DIALOG_CLASS,
    CONFIRM_HEADING_CLASS,
    dialogButton,
  } from "./that-confirm";
  import { COMMENT_FIELD_CLASS } from "./that-entry-dialog";

  /**
   * The stop dialog of #185: the rounding is the button. A native <dialog>
   * like that-confirm's, whose shell and buttons it borrows; wider than
   * that-confirm's max-w-sm so the button row holds on one line (Decision 13).
   *
   * The timer keeps running while this is open, so the run line and both
   * labels repaint every second — a button always names what the server,
   * reading its own clock at the click, will write.
   */
  export class ThatStopDialog extends HTMLElement {
    issueKey = "";
    nextIssueKey: string | undefined;
    elapsed: () => number = () => 0;

    private dialog: HTMLDialogElement | undefined;
    private ran: HTMLElement | undefined;
    private down: HTMLElement | undefined;
    private up: HTMLElement | undefined;
    private field: HTMLInputElement | undefined;
    private tick: number | undefined;

    get comment(): string {
      return this.field?.value.trim() ?? "";
    }

    connectedCallback(): void {
      if (this.dialog) return;

      const dialog = document.createElement("dialog");
      dialog.className = `${CONFIRM_DIALOG_CLASS} w-[440px] max-w-[calc(100vw-2rem)]`;

      const heading = document.createElement("h2");
      heading.id = "that-stop-dialog-heading";
      heading.className = CONFIRM_HEADING_CLASS;
      heading.textContent = this.nextIssueKey
        ? `Stop ${this.issueKey} and start ${this.nextIssueKey}?`
        : "Stop the timer?";

      const line = document.createElement("p");
      line.className = CONFIRM_BODY_CLASS;
      const key = document.createElement("span");
      key.className = "that-key that-tnum";
      key.textContent = this.issueKey;
      const ran = document.createElement("span");
      ran.className = "that-tnum";
      line.append(key, " ran ", ran);

      const label = document.createElement("label");
      label.className = "mb-4 flex flex-col gap-1.5";
      const eyebrow = document.createElement("span");
      eyebrow.className = "text-ink-muted text-xs font-bold tracking-[0.16em] uppercase";
      eyebrow.textContent = "Description";
      const field = document.createElement("input");
      field.type = "text";
      field.placeholder = "Optional — becomes the Jira worklog comment";
      field.className = COMMENT_FIELD_CLASS;
      field.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        dialog.close("up");
      });
      label.append(eyebrow, field);

      const actions = document.createElement("div");
      actions.className = "flex flex-wrap justify-end gap-2";
      const keep = dialogButton("Keep running", "secondary");
      const down = dialogButton("", "secondary");
      const up = dialogButton("", "primary");
      keep.addEventListener("click", () => dialog.close("cancel"));
      down.addEventListener("click", () => dialog.close("down"));
      up.addEventListener("click", () => dialog.close("up"));
      actions.append(keep, down, up);

      dialog.setAttribute("aria-labelledby", heading.id);
      dialog.append(heading, line, label, actions);
      this.append(dialog);
      Object.assign(this, { dialog, ran, down, up, field });

      this.paint();
      this.tick = window.setInterval(() => this.paint(), 1000);
      dialog.showModal();
    }

    disconnectedCallback(): void {
      window.clearInterval(this.tick);
    }

    private paint(): void {
      const seconds = this.elapsed();
      if (this.ran) this.ran.textContent = fieldFigure(seconds);

      const floor = roundedSeconds(seconds, "down");
      setIfChanged(this.down, "label", floor === 0 ? "Discard run" : `Log ${fieldFigure(floor)}`);
      setIfChanged(this.down, "variant", floor === 0 ? "danger" : "secondary");
      setIfChanged(this.up, "label", `Log ${fieldFigure(roundedSeconds(seconds, "up"))}`);
    }
  }

  function setIfChanged(element: HTMLElement | undefined, name: string, value: string): void {
    if (element && element.getAttribute(name) !== value) element.setAttribute(name, value);
  }

  customElements.define("that-stop-dialog", ThatStopDialog);

  /** Resolves the confirmed choice, or null for Keep running, Esc or any other close. */
  export function confirmStop(
    issueKey: string,
    nextIssueKey: string | undefined,
    elapsed: () => number,
  ): Promise<StopChoice | null> {
    const element = document.createElement("that-stop-dialog") as ThatStopDialog;
    element.issueKey = issueKey;
    element.nextIssueKey = nextIssueKey;
    element.elapsed = elapsed;
    document.body.append(element);

    const dialog = element.querySelector("dialog");
    if (!dialog) {
      element.remove();
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      dialog.addEventListener(
        "close",
        () => {
          const round = dialog.returnValue;
          const comment = element.comment;
          element.remove();
          resolve(isRounding(round) ? { round, comment } : null);
        },
        { once: true },
      );
    });
  }

  function isRounding(value: string): value is Rounding {
    return value === "up" || value === "down";
  }
  ```
  Replace the `Object.assign` with plain field assignments if lint or the reviewer prefers — it is
  there only to keep the listing short; the private fields must be set before `paint()`.

  `types.ts`: add `Rounding`, `StopChoice`, `StartTimerResponse`; fix `StopTimerResponse`'s doc
  comment (`discarded` is true when the confirmed rounding came to zero).

  `api.ts`: `startTimer(instanceId, issueKey, choice?)` posts
  `JSON.stringify({ instanceId, issueKey, ...choice })` and returns `StartTimerResponse`;
  `stopTimer(choice)` posts `JSON.stringify(choice)`.

  `timer-state.ts`:

  ```ts
  /** The stop dialog's answer for the running timer, or null when it was kept
   *  running. Imported lazily: the dialog is only ever needed after a click. */
  async function askHowToStop(nextIssueKey?: string): Promise<StopChoice | null> {
    const issueKey = running?.issueKey;
    if (issueKey === undefined) return null;
    const { confirmStop } = await import("./components/that-stop-dialog");

    return confirmStop(issueKey, nextIssueKey, elapsedSeconds);
  }

  export async function startTimer(instanceId: number, issueKey: string): Promise<void> {
    let choice: StopChoice | undefined;
    if (running) {
      const answer = await askHowToStop(issueKey);
      if (!answer) return;
      choice = answer;
    }
    const response = await postStartTimer(instanceId, issueKey, choice);
    setRunning(response.running);
    if (response.stopped) announceEntriesChanged();
  }

  export async function stopTimer(): Promise<void> {
    const choice = await askHowToStop();
    if (!choice) return;
    const response = await postStopTimer(choice);
    setRunning(null);
    if (response.stopped) announceEntriesChanged();
  }
  ```
  Delete `TIMER_DISCARDED`, `announceTimerDiscarded` and `onTimerDiscarded`, and the listener in
  `views/today.ts` with its import (drop any import that leaves unused). Update the module's doc
  comment where it mentions a stop.

- [ ] **Step 5: Run to verify GREEN.** `make test-web`, `make tsc`, `make lint`, `make test-e2e`.

- [ ] **Step 6: Compare with the drawing.** With the dev stack (`make up`; port is `THAT_PORT` in
  `.env`), or from the e2e rig, open the dialog at 7 and at 20 minutes in both themes and compare
  against the prototype's two stop sheets: heading, run line, eyebrow and field, button order,
  labels, variants, widths, one-line labels. Report each item and any difference. Leave the dev
  stack as you found it.

- [ ] **Step 7: Commit.** `feat(web): stopping a timer opens the stop dialog (#185)`
