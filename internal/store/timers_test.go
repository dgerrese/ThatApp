package store

import (
	"context"
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

	running, stopped, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-1", now, loc)
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

func TestStopTimerAfter25MinutesCreatesOneEntry(t *testing.T) {
	s := openTestStore(t)
	inst := createTestInstance(t, s)
	loc := mustLoadLocation(t, "Europe/Amsterdam")
	start := time.Date(2026, 9, 21, 10, 0, 0, 0, time.UTC)
	stop := start.Add(25 * time.Minute)

	if _, _, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-1", start, loc); err != nil {
		t.Fatalf("StartTimer() returned error: %v", err)
	}

	entry, wasRunning, err := s.StopTimer(context.Background(), stop, loc)
	if err != nil {
		t.Fatalf("StopTimer() returned error: %v", err)
	}
	if !wasRunning {
		t.Fatal("wasRunning = false, want true")
	}
	if entry == nil {
		t.Fatal("entry = nil, want the 1500s entry the run earned")
	}
	if entry.Seconds != 1500 {
		t.Errorf("entry.Seconds = %d, want 1500", entry.Seconds)
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

func TestStopTimerAfter59SecondsCreatesNoEntry(t *testing.T) {
	s := openTestStore(t)
	inst := createTestInstance(t, s)
	loc := mustLoadLocation(t, "Europe/Amsterdam")
	start := time.Date(2026, 9, 21, 10, 0, 0, 0, time.UTC)
	stop := start.Add(59 * time.Second)

	if _, _, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-1", start, loc); err != nil {
		t.Fatalf("StartTimer() returned error: %v", err)
	}

	entry, wasRunning, err := s.StopTimer(context.Background(), stop, loc)
	if err != nil {
		t.Fatalf("StopTimer() returned error: %v", err)
	}
	if !wasRunning {
		t.Fatal("wasRunning = false, want true: a timer was running, however short its run")
	}
	if entry != nil {
		t.Errorf("entry = %+v, want nil: a run under a minute is discarded", entry)
	}
	if rows := countTimerRows(t, s); rows != 0 {
		t.Errorf("timers has %d rows, want 0: a discarded run still clears the timer", rows)
	}
}

func TestStopTimerWithNothingRunning(t *testing.T) {
	s := openTestStore(t)
	loc := mustLoadLocation(t, "Europe/Amsterdam")

	entry, wasRunning, err := s.StopTimer(context.Background(), time.Now().UTC(), loc)
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

	if _, _, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-1", start, loc); err != nil {
		t.Fatalf("starting A: %v", err)
	}

	running, stopped, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-2", switchAt, loc)
	if err != nil {
		t.Fatalf("starting B: %v", err)
	}
	if stopped == nil {
		t.Fatal("stopped = nil, want A's entry")
	}
	if stopped.IssueKey != "RIDGE-1" || stopped.Seconds != 600 {
		t.Errorf("stopped = %+v, want RIDGE-1 at 600s", stopped)
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

	if _, _, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-1", start, loc); err != nil {
		t.Fatalf("starting A: %v", err)
	}

	running, stopped, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-2", switchAt, loc)
	if err != nil {
		t.Fatalf("starting B: %v", err)
	}
	if stopped != nil {
		t.Errorf("stopped = %+v, want nil: A's run was under a minute", stopped)
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
		if _, _, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-1", start, loc); err != nil {
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
		if _, _, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-1", start, loc); err != nil {
			t.Fatalf("starting: %v", err)
		}

		entry, wasRunning, err := s.StopTimer(context.Background(), read, loc)
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
		if _, _, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-1", start, loc); err != nil {
			t.Fatalf("starting A: %v", err)
		}

		running, stopped, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-2", read, loc)
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

				if _, _, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-1", start, loc); err != nil {
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

				if _, _, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-1", start, loc); err != nil {
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

	if _, _, err := s.StartTimer(context.Background(), inst.ID, "RIDGE-1", start, loc); err != nil {
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
