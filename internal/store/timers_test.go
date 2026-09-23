package store

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"
)

func mustLoadLocation(t *testing.T, name string) *time.Location {
	t.Helper()

	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Fatalf("loading location %q: %v", name, err)
	}

	return loc
}

// countTimerRows is read straight out of the table, the way entries_test.go
// counts entries, so that a store returning the right values in Go without
// actually writing or deleting the row would still be caught.
func countTimerRows(t *testing.T, s *Store) int {
	t.Helper()

	var rows int
	if err := s.db.QueryRow(`SELECT count(*) FROM timers`).Scan(&rows); err != nil {
		t.Fatalf("counting timer rows: %v", err)
	}

	return rows
}

func TestStartTimerReportsItRunning(t *testing.T) {
	s := openTestStore(t)
	inst := createTestInstance(t, s)
	loc := mustLoadLocation(t, "Europe/Amsterdam")
	now := time.Date(2026, 9, 21, 10, 0, 0, 0, time.UTC)

	running, stopped, _, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-1", now, loc, TimerClose{})
	if err != nil {
		t.Fatalf("StartTimer() returned error: %v", err)
	}
	if stopped != nil {
		t.Fatalf("stopped = %+v, want nil: nothing was running before this start", stopped)
	}
	if running == nil {
		t.Fatal("running = nil, want the timer just started")
	}
	if running.InstanceID != inst.ID || running.IssueKey != "RIDGE-1" {
		t.Errorf("running = %+v, want instance %d and RIDGE-1", running, inst.ID)
	}
	if !running.StartedAt.Equal(now) {
		t.Errorf("running.StartedAt = %v, want %v", running.StartedAt, now)
	}

	read, closed, err := s.RunningTimer(context.Background(), now, loc)
	if err != nil {
		t.Fatalf("RunningTimer() returned error: %v", err)
	}
	if closed != nil {
		t.Errorf("closed = %+v, want nil", closed)
	}
	if read == nil || read.IssueKey != "RIDGE-1" {
		t.Fatalf("RunningTimer() = %+v, want the timer just started", read)
	}
}

func TestStopTimerAfter25MinutesRoundedUpCreatesOneEntry(t *testing.T) {
	s := openTestStore(t)
	inst := createTestInstance(t, s)
	loc := mustLoadLocation(t, "Europe/Amsterdam")
	start := time.Date(2026, 9, 21, 10, 0, 0, 0, time.UTC)
	stop := start.Add(25 * time.Minute)

	if _, _, _, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-1", start, loc, TimerClose{}); err != nil {
		t.Fatalf("StartTimer() returned error: %v", err)
	}

	entry, wasRunning, err := s.StopTimer(context.Background(), stop, loc,
		TimerClose{Round: RoundUp, Comment: "Traced the export"})
	if err != nil {
		t.Fatalf("StopTimer() returned error: %v", err)
	}
	if !wasRunning {
		t.Fatal("wasRunning = false, want true")
	}
	if entry == nil {
		t.Fatal("entry = nil, want the 1800s entry the rounded-up run earned")
	}
	if entry.Seconds != 1800 {
		t.Errorf("entry.Seconds = %d, want 1800", entry.Seconds)
	}
	if entry.Comment != "Traced the export" {
		t.Errorf("entry.Comment = %q, want the confirmed description", entry.Comment)
	}
	if !entry.StartedAt.Equal(start) {
		t.Errorf("entry.StartedAt = %v, want %v", entry.StartedAt, start)
	}
	if want := start.In(loc).Format("2006-01-02"); entry.Day != want {
		t.Errorf("entry.Day = %q, want %q", entry.Day, want)
	}
	if entry.InstanceID != inst.ID || entry.IssueKey != "RIDGE-1" {
		t.Errorf("entry = %+v, want instance %d / RIDGE-1", entry, inst.ID)
	}

	if rows := countTimerRows(t, s); rows != 0 {
		t.Errorf("timers has %d rows, want 0: the timer must be gone once stopped", rows)
	}

	// The entry a stop creates must be indistinguishable from one a manual save
	// creates: no worklog, no pushed mark, no flag saying it came from a timer.
	if entry.WorklogID != "" {
		t.Errorf("entry.WorklogID = %q, want empty", entry.WorklogID)
	}
	if entry.PushedAt != nil {
		t.Errorf("entry.PushedAt = %v, want nil", entry.PushedAt)
	}
}

func TestStopTimerWithNothingRunning(t *testing.T) {
	s := openTestStore(t)
	loc := mustLoadLocation(t, "Europe/Amsterdam")

	entry, wasRunning, err := s.StopTimer(context.Background(), time.Now().UTC(), loc, TimerClose{})
	if err != nil {
		t.Fatalf("StopTimer() returned error: %v", err)
	}
	if entry != nil {
		t.Errorf("entry = %+v, want nil", entry)
	}
	if wasRunning {
		t.Error("wasRunning = true, want false")
	}
}

func TestStartTimerSwitchesFromA10MinuteRun(t *testing.T) {
	s := openTestStore(t)
	inst := createTestInstance(t, s)
	loc := mustLoadLocation(t, "Europe/Amsterdam")
	start := time.Date(2026, 9, 21, 10, 0, 0, 0, time.UTC)
	switchAt := start.Add(10 * time.Minute)

	if _, _, _, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-1", start, loc, TimerClose{}); err != nil {
		t.Fatalf("starting A: %v", err)
	}

	running, stopped, _, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-2", switchAt, loc,
		TimerClose{Round: RoundUp})
	if err != nil {
		t.Fatalf("starting B: %v", err)
	}
	if stopped == nil {
		t.Fatal("stopped = nil, want A's entry")
	}
	if stopped.IssueKey != "RIDGE-1" || stopped.Seconds != 900 {
		t.Errorf("stopped = %+v, want RIDGE-1 at 900s", stopped)
	}
	if running == nil || running.IssueKey != "RIDGE-2" {
		t.Fatalf("running = %+v, want RIDGE-2", running)
	}
	if !running.StartedAt.Equal(switchAt) {
		t.Errorf("running.StartedAt = %v, want %v", running.StartedAt, switchAt)
	}

	if rows := countTimerRows(t, s); rows != 1 {
		t.Errorf("timers has %d rows, want exactly 1", rows)
	}
}

func TestStartTimerSwitchesFromA30SecondRun(t *testing.T) {
	s := openTestStore(t)
	inst := createTestInstance(t, s)
	loc := mustLoadLocation(t, "Europe/Amsterdam")
	start := time.Date(2026, 9, 21, 10, 0, 0, 0, time.UTC)
	switchAt := start.Add(30 * time.Second)

	if _, _, _, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-1", start, loc, TimerClose{}); err != nil {
		t.Fatalf("starting A: %v", err)
	}

	running, stopped, wasRunning, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-2", switchAt, loc,
		TimerClose{Round: RoundDown})
	if err != nil {
		t.Fatalf("starting B: %v", err)
	}
	if stopped != nil {
		t.Errorf("stopped = %+v, want nil: A's run rounded down to zero", stopped)
	}
	if !wasRunning {
		t.Error("wasRunning = false, want true: A was running before the switch")
	}
	if running == nil || running.IssueKey != "RIDGE-2" {
		t.Fatalf("running = %+v, want RIDGE-2", running)
	}
	if rows := countTimerRows(t, s); rows != 1 {
		t.Errorf("timers has %d rows, want exactly 1", rows)
	}
}

// TestMidnightClosesAnOvernightTimer is the day-boundary case, and it is built
// so a UTC-instead-of-local mistake fails it: 23:30 Europe/Amsterdam on
// 2026-09-21 is 21:30 UTC on 2026-09-21, and the read at 00:10 local the next
// day is 22:10 UTC — still 2026-09-21 in UTC. The local date has advanced
// (2026-09-21 to 2026-09-22) but the UTC date has not, so code that compared
// UTC dates instead of local ones would see no date change at all and report
// the timer still running, where the correct answer is that it closed at local
// midnight with 1800 seconds logged on the start's local date.
func TestMidnightClosesAnOvernightTimer(t *testing.T) {
	loc := mustLoadLocation(t, "Europe/Amsterdam")
	start := time.Date(2026, 9, 21, 23, 30, 0, 0, loc)
	read := time.Date(2026, 9, 22, 0, 10, 0, 0, loc)

	if start.UTC().Format("2006-01-02") != read.UTC().Format("2006-01-02") {
		t.Fatal("fixture is broken: start and read must fall on the same UTC date " +
			"for this to be a trap for a UTC-based implementation")
	}
	if start.In(loc).Format("2006-01-02") == read.In(loc).Format("2006-01-02") {
		t.Fatal("fixture is broken: start and read must fall on different local dates " +
			"or there is no midnight boundary to cross")
	}

	t.Run("via RunningTimer", func(t *testing.T) {
		s := openTestStore(t)
		inst := createTestInstance(t, s)
		if _, _, _, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-1", start, loc, TimerClose{}); err != nil {
			t.Fatalf("starting: %v", err)
		}

		running, closed, err := s.RunningTimer(context.Background(), read, loc)
		if err != nil {
			t.Fatalf("RunningTimer() returned error: %v", err)
		}
		if running != nil {
			t.Errorf("running = %+v, want nil: the overnight timer must be closed", running)
		}
		if closed == nil {
			t.Fatal("closed = nil, want the capped entry")
		}
		if closed.Seconds != 1800 {
			t.Errorf("closed.Seconds = %d, want 1800 (capped at local midnight)", closed.Seconds)
		}
		if want := "2026-09-21"; closed.Day != want {
			t.Errorf("closed.Day = %q, want %q — the start's local date", closed.Day, want)
		}
		if rows := countTimerRows(t, s); rows != 0 {
			t.Errorf("timers has %d rows, want 0", rows)
		}
	})

	t.Run("via StopTimer", func(t *testing.T) {
		s := openTestStore(t)
		inst := createTestInstance(t, s)
		if _, _, _, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-1", start, loc, TimerClose{}); err != nil {
			t.Fatalf("starting: %v", err)
		}

		entry, wasRunning, err := s.StopTimer(context.Background(), read, loc, TimerClose{Round: RoundUp})
		if err != nil {
			t.Fatalf("StopTimer() returned error: %v", err)
		}
		if !wasRunning {
			t.Error("wasRunning = false, want true")
		}
		if entry == nil || entry.Seconds != 1800 {
			t.Fatalf("entry = %+v, want 1800s", entry)
		}
	})

	t.Run("via StartTimer", func(t *testing.T) {
		s := openTestStore(t)
		inst := createTestInstance(t, s)
		if _, _, _, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-1", start, loc, TimerClose{}); err != nil {
			t.Fatalf("starting A: %v", err)
		}

		running, stopped, _, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-2", read, loc,
			TimerClose{Round: RoundUp})
		if err != nil {
			t.Fatalf("starting B: %v", err)
		}
		if stopped == nil || stopped.Seconds != 1800 {
			t.Fatalf("stopped = %+v, want A's 1800s entry", stopped)
		}
		if running == nil || running.IssueKey != "RIDGE-2" {
			t.Fatalf("running = %+v, want RIDGE-2", running)
		}
	})
}

// TestUTCVsLocalTrap picks zones whose local midnight is nowhere near UTC
// midnight, so that a store which capped or compared dates in UTC instead of
// loc would answer both cases wrongly.
func TestUTCVsLocalTrap(t *testing.T) {
	cases := map[string]struct {
		zone string
	}{
		"Pacific/Auckland":    {zone: "Pacific/Auckland"},
		"America/Los_Angeles": {zone: "America/Los_Angeles"},
	}

	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			loc := mustLoadLocation(t, tc.zone)

			t.Run("still running an hour later the same local day", func(t *testing.T) {
				s := openTestStore(t)
				inst := createTestInstance(t, s)

				start := time.Date(2026, 9, 21, 22, 0, 0, 0, loc)
				readAt := time.Date(2026, 9, 21, 23, 0, 0, 0, loc)

				if _, _, _, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-1", start, loc, TimerClose{}); err != nil {
					t.Fatalf("starting: %v", err)
				}

				running, closed, err := s.RunningTimer(context.Background(), readAt, loc)
				if err != nil {
					t.Fatalf("RunningTimer() returned error: %v", err)
				}
				if closed != nil {
					t.Errorf("closed = %+v, want nil: the UTC date changed but the local day has not",
						closed)
				}
				if running == nil {
					t.Fatal("running = nil, want the timer still running: " +
						"22:00 and 23:00 are the same local day even though the UTC date differs")
				}
			})

			t.Run("closed at local midnight the next local morning", func(t *testing.T) {
				s := openTestStore(t)
				inst := createTestInstance(t, s)

				start := time.Date(2026, 9, 21, 22, 0, 0, 0, loc)
				readAt := time.Date(2026, 9, 22, 7, 0, 0, 0, loc)

				if _, _, _, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-1", start, loc, TimerClose{}); err != nil {
					t.Fatalf("starting: %v", err)
				}

				running, closed, err := s.RunningTimer(context.Background(), readAt, loc)
				if err != nil {
					t.Fatalf("RunningTimer() returned error: %v", err)
				}
				if running != nil {
					t.Errorf("running = %+v, want nil: it is the next local day", running)
				}
				if closed == nil {
					t.Fatal("closed = nil, want the capped entry")
				}
				if closed.Seconds != 2*60*60 {
					t.Errorf("closed.Seconds = %d, want 7200 (22:00 to local midnight)", closed.Seconds)
				}
			})
		})
	}
}

func TestStartedJustBeforeMidnightLeavesOnly30Seconds(t *testing.T) {
	s := openTestStore(t)
	inst := createTestInstance(t, s)
	loc := mustLoadLocation(t, "Europe/Amsterdam")
	start := time.Date(2026, 9, 21, 23, 59, 30, 0, loc)
	read := time.Date(2026, 9, 22, 9, 0, 0, 0, loc)

	if _, _, _, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-1", start, loc, TimerClose{}); err != nil {
		t.Fatalf("starting: %v", err)
	}

	running, closed, err := s.RunningTimer(context.Background(), read, loc)
	if err != nil {
		t.Fatalf("RunningTimer() returned error: %v", err)
	}
	if running != nil {
		t.Errorf("running = %+v, want nil", running)
	}
	if closed != nil {
		t.Errorf("closed = %+v, want nil: 30s is under the minute floor", closed)
	}
	if rows := countTimerRows(t, s); rows != 0 {
		t.Errorf("timers has %d rows, want 0", rows)
	}
}

// TestDiscardBoundaryIsExactlySixtySeconds pins the discard rule at the exact
// second it turns on, on the midnight path — the only path MinTimerSeconds
// still governs: a run of 59s discards, one of 60s logs, one of 61s logs.
// Each case starts that much before local midnight and closes the next
// morning, passing RoundUp so a wrongly-rounded 59s (which would round up to
// 900) cannot be mistaken for the floor holding.
func TestDiscardBoundaryIsExactlySixtySeconds(t *testing.T) {
	cases := map[string]struct {
		duration    time.Duration
		wantEntry   bool
		wantSeconds int
	}{
		"59s discards": {duration: 59 * time.Second, wantEntry: false},
		"60s logs":     {duration: 60 * time.Second, wantEntry: true, wantSeconds: 60},
		"61s logs":     {duration: 61 * time.Second, wantEntry: true, wantSeconds: 61},
	}

	for name, tc := range cases {
		t.Run(name+" via stop", func(t *testing.T) {
			s := openTestStore(t)
			inst := createTestInstance(t, s)
			loc := mustLoadLocation(t, "Europe/Amsterdam")
			midnight := time.Date(2026, 9, 21, 0, 0, 0, 0, loc).AddDate(0, 0, 1)
			start := midnight.Add(-tc.duration)
			stop := time.Date(2026, 9, 22, 9, 0, 0, 0, loc)

			if _, _, _, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-1", start, loc, TimerClose{}); err != nil {
				t.Fatalf("starting: %v", err)
			}

			entry, wasRunning, err := s.StopTimer(context.Background(), stop, loc, TimerClose{Round: RoundUp})
			if err != nil {
				t.Fatalf("StopTimer() returned error: %v", err)
			}
			if !wasRunning {
				t.Fatal("wasRunning = false, want true")
			}
			if tc.wantEntry {
				if entry == nil {
					t.Fatal("entry = nil, want the entry this run earned")
				}
				if entry.Seconds != tc.wantSeconds {
					t.Errorf("entry.Seconds = %d, want %d", entry.Seconds, tc.wantSeconds)
				}
			} else if entry != nil {
				t.Errorf("entry = %+v, want nil", entry)
			}
		})

		t.Run(name+" via switch", func(t *testing.T) {
			s := openTestStore(t)
			inst := createTestInstance(t, s)
			loc := mustLoadLocation(t, "Europe/Amsterdam")
			midnight := time.Date(2026, 9, 21, 0, 0, 0, 0, loc).AddDate(0, 0, 1)
			start := midnight.Add(-tc.duration)
			switchAt := time.Date(2026, 9, 22, 9, 0, 0, 0, loc)

			if _, _, _, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-1", start, loc, TimerClose{}); err != nil {
				t.Fatalf("starting A: %v", err)
			}

			_, stopped, _, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-2", switchAt, loc,
				TimerClose{Round: RoundUp})
			if err != nil {
				t.Fatalf("starting B: %v", err)
			}
			if tc.wantEntry {
				if stopped == nil {
					t.Fatal("stopped = nil, want A's entry")
				}
				if stopped.Seconds != tc.wantSeconds {
					t.Errorf("stopped.Seconds = %d, want %d", stopped.Seconds, tc.wantSeconds)
				}
			} else if stopped != nil {
				t.Errorf("stopped = %+v, want nil", stopped)
			}
		})
	}
}

// TestClosingATimerAcrossADSTTransitionMeasuresRealElapsedTime is the other
// half of the day boundary: a local day is not always 24 hours. Both fixtures
// start a timer at 00:30 local on the transition day and read it well into the
// following local day, so closeTimer caps the run at the local midnight that
// follows — and the seconds it records must reflect the real wall-clock gap
// between those two instants, not a nominal 24h day. Both start and the cap are
// built with time.Date(..., loc), which resolves through Go's IANA tzdata and
// is DST-aware; a refactor to start.Add(24*time.Hour) would silently drop that
// and is exactly what the mutation below checks for.
func TestClosingATimerAcrossADSTTransitionMeasuresRealElapsedTime(t *testing.T) {
	loc := mustLoadLocation(t, "Europe/Amsterdam")

	cases := map[string]struct {
		start       time.Time
		read        time.Time
		wantSeconds int
	}{
		// 2026-03-29: clocks spring forward at 02:00 CET -> 03:00 CEST, so this
		// local day has only 23 real hours. Nominal 00:30 -> 24:00 is 23h30m; the
		// missing hour brings the true elapsed time to 22h30m.
		"spring forward: the local day loses an hour": {
			start:       time.Date(2026, 3, 29, 0, 30, 0, 0, loc),
			read:        time.Date(2026, 3, 30, 9, 0, 0, 0, loc),
			wantSeconds: 22*60*60 + 30*60,
		},
		// 2026-10-25: clocks fall back at 03:00 CEST -> 02:00 CET, so this local
		// day has 25 real hours. Nominal 00:30 -> 24:00 is 23h30m; the extra hour
		// brings the true elapsed time to 24h30m.
		"fall back: the local day gains an hour": {
			start:       time.Date(2026, 10, 25, 0, 30, 0, 0, loc),
			read:        time.Date(2026, 10, 26, 9, 0, 0, 0, loc),
			wantSeconds: 24*60*60 + 30*60,
		},
	}

	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			s := openTestStore(t)
			inst := createTestInstance(t, s)

			if _, _, _, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-1", tc.start, loc, TimerClose{}); err != nil {
				t.Fatalf("starting: %v", err)
			}

			running, closed, err := s.RunningTimer(context.Background(), tc.read, loc)
			if err != nil {
				t.Fatalf("RunningTimer() returned error: %v", err)
			}
			if running != nil {
				t.Errorf("running = %+v, want nil", running)
			}
			if closed == nil {
				t.Fatal("closed = nil, want the capped entry")
			}
			if closed.Seconds != tc.wantSeconds {
				t.Errorf("closed.Seconds = %d, want %d — the cap must measure real elapsed "+
					"time, not a nominal 24h day", closed.Seconds, tc.wantSeconds)
			}
		})
	}
}

// TestAConfirmedCloseRoundsToTheGrid pins the rule the stop dialog confirms:
// up is the ceiling, down the floor, and a result of zero discards. It runs
// every case through both user paths, the stop and the switch, because
// they share closeTimer and a refactor that split them must not diverge.
func TestAConfirmedCloseRoundsToTheGrid(t *testing.T) {
	cases := []struct {
		elapsed time.Duration
		round   Rounding
		want    int // 0 means discarded
	}{
		{0, RoundUp, 0},
		{0, RoundDown, 0},
		{1 * time.Second, RoundUp, 900},
		{1 * time.Second, RoundDown, 0},
		{59 * time.Second, RoundUp, 900},
		{59 * time.Second, RoundDown, 0},
		{60 * time.Second, RoundUp, 900},
		{60 * time.Second, RoundDown, 0},
		{899 * time.Second, RoundUp, 900},
		{899 * time.Second, RoundDown, 0},
		{900 * time.Second, RoundUp, 900},
		{900 * time.Second, RoundDown, 900},
		{901 * time.Second, RoundUp, 1800},
		{901 * time.Second, RoundDown, 900},
		{1800 * time.Second, RoundUp, 1800},
		{1800 * time.Second, RoundDown, 1800},
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
				wantRows := 0
				if path == "switch" {
					wantRows = 1
				}
				if rows := countTimerRows(t, s); rows != wantRows {
					t.Errorf("timer rows = %d, want %d: the closed timer must be gone even when discarded", rows, wantRows)
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

// A same-day close with no direction is refused and changes nothing.
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

// A timer whose start day has passed is the midnight close even when the user
// stops it, so it stays honest whatever direction was confirmed (23:37 local
// to midnight is 1380s, off the grid).
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
