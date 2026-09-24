package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// Timer is the one run in progress, if any. StartedAt is stored and compared at
// second resolution, matching every other timestamp this store keeps as text.
type Timer struct {
	InstanceID int64
	IssueKey   string
	StartedAt  time.Time // UTC, second resolution
}

// MinTimerSeconds is the shortest run the midnight close still logs; Jira
// rejects worklogs under a minute, so a shorter overnight run is discarded
// instead of logged. A same-day close never consults it — rounding to
// GridSeconds decides that path instead.
const MinTimerSeconds = 60

// Rounding is the direction a stop the user confirmed lands on the grid.
type Rounding string

// RoundUp and RoundDown are the two directions the stop dialog offers.
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

// timerDayLayout renders the local date a timer started on. ISO dates in this
// form sort the same as strings as they do chronologically, which is what lets
// staleTimer compare two of them with plain "<" instead of parsing either back
// into a time.Time.
const timerDayLayout = "2006-01-02"

func scanTimer(row scanner) (*Timer, error) {
	var (
		timer     Timer
		startedAt string
	)
	if err := row.Scan(&timer.InstanceID, &timer.IssueKey, &startedAt); err != nil {
		return nil, err
	}

	parsed, err := time.Parse(time.RFC3339, startedAt)
	if err != nil {
		return nil, fmt.Errorf("parsing timer started_at %q: %w", startedAt, err)
	}
	timer.StartedAt = parsed

	return &timer, nil
}

// runningTimerRow reads the one possible timer row, answering nil rather than
// sql.ErrNoRows when nothing is running.
func runningTimerRow(ctx context.Context, tx *sql.Tx) (*Timer, error) {
	row := tx.QueryRowContext(ctx,
		`SELECT instance_id, issue_key, started_at FROM timers WHERE id = 1`)

	timer, err := scanTimer(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading the running timer: %w", err)
	}

	return timer, nil
}

func deleteRunningTimer(ctx context.Context, tx *sql.Tx) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM timers WHERE id = 1`); err != nil {
		return fmt.Errorf("deleting the running timer: %w", err)
	}

	return nil
}

// insertRunningTimer writes the one timer row. id is always 1: the schema's
// CHECK (id = 1) is what keeps a second timer from ever existing, so every
// write names it explicitly rather than letting SQLite assign a rowid.
func insertRunningTimer(ctx context.Context, tx *sql.Tx, instanceID int64, issueKey string, startedAt time.Time) error {
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO timers (id, instance_id, issue_key, started_at) VALUES (1, ?, ?, ?)`,
		instanceID, issueKey, startedAt.UTC().Truncate(time.Second).Format(time.RFC3339),
	); err != nil {
		return fmt.Errorf("starting a timer for %q on instance %d: %w", issueKey, instanceID, err)
	}

	return nil
}

// staleTimer reports whether start's local date is before now's, both resolved
// in loc. A timer on today's local date is never stale, however long it has
// run; the comparison is of calendar dates, not elapsed duration.
func staleTimer(start, now time.Time, loc *time.Location) bool {
	return start.In(loc).Format(timerDayLayout) < now.In(loc).Format(timerDayLayout)
}

// localMidnightAfter is the cap on how long a timer's run may count: the first
// instant of the local day following start, computed in loc. Deriving it from
// start.In(loc) rather than from now is what keeps an overnight timer's entry on
// its start day even when now is read long after midnight.
func localMidnightAfter(start time.Time, loc *time.Location) time.Time {
	year, month, day := start.In(loc).Date()

	return time.Date(year, month, day+1, 0, 0, 0, 0, loc)
}

// closeTimer ends a running timer at min(now, the local midnight after its
// start day) and, if that run earned one, inserts the honest entry — written
// by insertEntry, the same call CreateEntry makes, so the entry is
// indistinguishable from one a manual save creates. A stale timer (its start
// day has passed) is the midnight close: honest and floored at
// MinTimerSeconds, whoever triggered it. Anything else is a same-day close,
// which needs choice.Round to land on the grid — with none given, it refuses
// via ErrRoundingRequired rather than guess, and changes nothing. A run that
// rounds or floors to zero returns a nil entry and nil error: that is the
// discard, not a failure.
func closeTimer(ctx context.Context, tx *sql.Tx, timer Timer, now time.Time, loc *time.Location, choice TimerClose) (*Entry, error) {
	end := now
	if deadline := localMidnightAfter(timer.StartedAt, loc); deadline.Before(end) {
		end = deadline
	}
	seconds := int(end.Sub(timer.StartedAt) / time.Second)

	switch {
	case staleTimer(timer.StartedAt, now, loc):
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
	if err != nil {
		return nil, fmt.Errorf("closing the timer for %q: %w", timer.IssueKey, err)
	}

	return entry, nil
}

func commitTimerTx(tx *sql.Tx, action string) error {
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("%s: %w", action, err)
	}

	return nil
}

// RunningTimer reports the timer in progress, if any. A timer whose start day
// (in loc) is before now's local day is stale: this closes it at its start
// day's local midnight, creates the entry it earned (nil if the run was too
// short), deletes the timer row, and reports nothing running — all in one
// transaction, so a concurrent read never sees the timer gone without its entry
// having landed, or the entry landed with the timer still there.
func (s *Store) RunningTimer(
	ctx context.Context, now time.Time, loc *time.Location,
) (running *Timer, closed *Entry, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, nil, fmt.Errorf("beginning transaction to read the timer: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	timer, err := runningTimerRow(ctx, tx)
	if err != nil {
		return nil, nil, err
	}
	if timer == nil {
		return nil, nil, commitTimerTx(tx, "reading the timer")
	}

	if !staleTimer(timer.StartedAt, now, loc) {
		return timer, nil, commitTimerTx(tx, "reading the timer")
	}

	entry, err := closeTimer(ctx, tx, *timer, now, loc, TimerClose{})
	if err != nil {
		return nil, nil, err
	}
	if err := deleteRunningTimer(ctx, tx); err != nil {
		return nil, nil, err
	}

	return nil, entry, commitTimerTx(tx, "closing the overnight timer")
}

// StartTimer closes any running timer as StopTimer would, then starts the new
// one, in one transaction — the switch the row control and the rail both drive.
// Keeping both in one transaction is what keeps the "exactly one timer" rule
// true under a crash mid-switch: there is no window where either both or
// neither exist. wasRunning is true when a timer was running and this call
// closed it, whether or not that close earned an entry; choice governs how a
// same-day close lands, and a refusal (ErrRoundingRequired) rolls the whole
// transaction back, leaving the original timer running untouched.
func (s *Store) StartTimer(
	ctx context.Context, instanceID int64, issueKey string, now time.Time, loc *time.Location, choice TimerClose,
) (running *Timer, stopped *Entry, wasRunning bool, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, nil, false, fmt.Errorf("beginning transaction to start a timer: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	existing, err := runningTimerRow(ctx, tx)
	if err != nil {
		return nil, nil, false, err
	}

	var closedEntry *Entry
	if existing != nil {
		closedEntry, err = closeTimer(ctx, tx, *existing, now, loc, choice)
		if err != nil {
			return nil, nil, false, err
		}
		if err := deleteRunningTimer(ctx, tx); err != nil {
			return nil, nil, false, err
		}
	}

	startedAt := now.UTC().Truncate(time.Second)
	if err := insertRunningTimer(ctx, tx, instanceID, issueKey, startedAt); err != nil {
		return nil, nil, false, err
	}

	if err := commitTimerTx(tx, "starting the timer"); err != nil {
		return nil, nil, false, err
	}

	return &Timer{InstanceID: instanceID, IssueKey: issueKey, StartedAt: startedAt}, closedEntry, existing != nil, nil
}

// StopTimer ends whatever is running. Nothing running is not an error: it
// answers wasRunning == false so the caller — the row control and the rail
// alike — can tell "stopped cleanly" from "there was nothing to stop" without
// inspecting an error string. choice governs how a same-day close lands; a
// refusal (ErrRoundingRequired) rolls the transaction back, leaving the timer
// running.
func (s *Store) StopTimer(
	ctx context.Context, now time.Time, loc *time.Location, choice TimerClose,
) (stopped *Entry, wasRunning bool, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, false, fmt.Errorf("beginning transaction to stop the timer: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	existing, err := runningTimerRow(ctx, tx)
	if err != nil {
		return nil, false, err
	}
	if existing == nil {
		return nil, false, commitTimerTx(tx, "stopping the timer")
	}

	entry, err := closeTimer(ctx, tx, *existing, now, loc, choice)
	if err != nil {
		return nil, false, err
	}
	if err := deleteRunningTimer(ctx, tx); err != nil {
		return nil, false, err
	}

	if err := commitTimerTx(tx, "stopping the timer"); err != nil {
		return nil, false, err
	}

	return entry, true, nil
}
