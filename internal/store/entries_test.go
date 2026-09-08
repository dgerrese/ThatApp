package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"
)

func createTestEntry(t *testing.T, s *Store, in EntryInput) *Entry {
	t.Helper()

	entry, err := s.CreateEntry(context.Background(), in)
	if err != nil {
		t.Fatalf("creating entry for %q on %s: %v", in.IssueKey, in.Day, err)
	}

	return entry
}

func TestCreateEntryRoundTrips(t *testing.T) {
	cases := map[string]struct {
		comment string
	}{
		"with a comment": {comment: "Refinement"},
		// An empty comment is stored as NULL, so it has to read back as "" rather
		// than blowing up the scan.
		"with an empty comment": {comment: ""},
	}

	// Deliberately not today: an INSERT that stamped day from the clock would pass
	// unnoticed against an entry logged on the day the test runs. Deliberately
	// sub-second too: started_at is stored as RFC3339, so a start time carrying
	// nanoseconds — which is what #7's handler will hand over — has to be dropped
	// to whole seconds before it is returned, or the returned row and the stored
	// one disagree.
	const day = "2026-03-04"
	started := time.Date(2026, 3, 4, 14, 5, 0, 123456789, time.UTC)

	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			s := openTestStore(t)
			inst := createTestInstance(t, s)

			created := createTestEntry(t, s, EntryInput{
				InstanceID: inst.ID, IssueKey: "RIDGE-4929", Day: day,
				StartedAt: started, Seconds: 1800, Comment: tc.comment,
			})

			if created.ID == 0 {
				t.Error("ID = 0, want the id the database assigned")
			}
			if created.CreatedAt.IsZero() || created.UpdatedAt.IsZero() {
				t.Errorf("CreatedAt/UpdatedAt = %v/%v, want both stamped",
					created.CreatedAt, created.UpdatedAt)
			}

			stored, err := s.EntriesForDay(context.Background(), day, day)
			if err != nil {
				t.Fatalf("EntriesForDay() returned error: %v", err)
			}
			if len(stored) != 1 {
				t.Fatalf("got %d entries, want 1", len(stored))
			}

			got := stored[0]
			if got.ID != created.ID {
				t.Errorf("ID = %d, want %d", got.ID, created.ID)
			}
			if got.InstanceID != inst.ID {
				t.Errorf("InstanceID = %d, want %d", got.InstanceID, inst.ID)
			}
			if got.IssueKey != "RIDGE-4929" {
				t.Errorf("IssueKey = %q, want RIDGE-4929", got.IssueKey)
			}
			if got.Day != day {
				t.Errorf("Day = %q, want %q", got.Day, day)
			}
			if !created.StartedAt.Equal(started.Truncate(time.Second)) {
				t.Errorf("returned StartedAt = %v, want %v — the sub-second part survived",
					created.StartedAt, started.Truncate(time.Second))
			}
			if !got.StartedAt.Equal(created.StartedAt) {
				t.Errorf("stored StartedAt = %v, want %v — the start time did not round-trip",
					got.StartedAt, created.StartedAt)
			}
			if got.Seconds != 1800 {
				t.Errorf("Seconds = %d, want 1800", got.Seconds)
			}
			if got.Comment != tc.comment {
				t.Errorf("Comment = %q, want %q", got.Comment, tc.comment)
			}
			if !got.CreatedAt.Equal(created.CreatedAt) {
				t.Errorf("stored CreatedAt = %v, want %v — the timestamp did not round-trip",
					got.CreatedAt, created.CreatedAt)
			}
			if !got.UpdatedAt.Equal(created.UpdatedAt) {
				t.Errorf("stored UpdatedAt = %v, want %v", got.UpdatedAt, created.UpdatedAt)
			}

			var comment sql.NullString
			if err := s.db.QueryRow(
				`SELECT comment FROM time_entries WHERE id = ?`, created.ID,
			).Scan(&comment); err != nil {
				t.Fatalf("reading the stored comment: %v", err)
			}
			if wantValid := tc.comment != ""; comment.Valid != wantValid {
				t.Errorf("stored comment valid = %t (%q), want %t — absence has one spelling",
					comment.Valid, comment.String, wantValid)
			}
		})
	}
}

// A new entry has never been pushed, and #7 writes neither column. If either
// arrived non-empty the derived push state #9 computes would read as pushed.
func TestCreateEntryLeavesPushStateUnset(t *testing.T) {
	s := openTestStore(t)
	inst := createTestInstance(t, s)

	created := createTestEntry(t, s, EntryInput{
		InstanceID: inst.ID, IssueKey: "RIDGE-1", Day: "2026-08-21",
		StartedAt: time.Now().UTC(), Seconds: 900,
	})

	if created.WorklogID != "" {
		t.Errorf("WorklogID = %q, want empty", created.WorklogID)
	}
	if created.PushedAt != nil {
		t.Errorf("PushedAt = %v, want nil", created.PushedAt)
	}

	var worklogID, pushedAt sql.NullString
	if err := s.db.QueryRow(
		`SELECT worklog_id, pushed_at FROM time_entries WHERE id = ?`, created.ID,
	).Scan(&worklogID, &pushedAt); err != nil {
		t.Fatalf("reading the stored row: %v", err)
	}
	if worklogID.Valid || pushedAt.Valid {
		t.Errorf("stored worklog_id/pushed_at = %v/%v, want both NULL", worklogID, pushedAt)
	}
}

// Ordering is by instant, not by the spelling of started_at. Entries whose local
// clock times sort one way and whose instants sort the other catch both a
// dropped ORDER BY and a started_at persisted with its original offset, where a
// text column would compare "01:00+02:00" as later than "00:15Z". Three of them,
// inserted middle-first, because two can be ordered correctly by id alone in one
// direction or the other.
func TestEntriesForDayReturnsOldestFirst(t *testing.T) {
	s := openTestStore(t)
	inst := createTestInstance(t, s)
	ctx := context.Background()

	amsterdam := time.FixedZone("CEST", 2*60*60)
	early := time.Date(2026, 8, 21, 1, 0, 0, 0, amsterdam) // 2026-08-20T23:00:00Z
	middle := time.Date(2026, 8, 21, 0, 15, 0, 0, time.UTC)
	late := time.Date(2026, 8, 21, 3, 0, 0, 0, amsterdam) // 2026-08-21T01:00:00Z

	for _, fixture := range []struct {
		comment string
		started time.Time
	}{
		{"middle", middle},
		{"late", late},
		{"early", early},
	} {
		createTestEntry(t, s, EntryInput{
			InstanceID: inst.ID, IssueKey: "RIDGE-1", Day: "2026-08-21",
			StartedAt: fixture.started, Seconds: 900, Comment: fixture.comment,
		})
	}

	entries, err := s.EntriesForDay(ctx, "2026-08-21", "2026-08-21")
	if err != nil {
		t.Fatalf("EntriesForDay() returned error: %v", err)
	}

	want := []string{"early", "middle", "late"}
	if len(entries) != len(want) {
		t.Fatalf("got %d entries, want %d", len(entries), len(want))
	}
	for i, comment := range want {
		if entries[i].Comment != comment {
			t.Errorf("entries[%d] = %q, want %q", i, entries[i].Comment, comment)
		}
	}
}

// A day spanning several dates has to come back in date order too, or #11's
// week grid would read a shuffled column.
func TestEntriesForDayOrdersAcrossDays(t *testing.T) {
	s := openTestStore(t)
	inst := createTestInstance(t, s)

	for _, day := range []string{"2026-08-21", "2026-08-19", "2026-08-20"} {
		createTestEntry(t, s, EntryInput{
			InstanceID: inst.ID, IssueKey: "RIDGE-1", Day: day,
			StartedAt: time.Date(2026, 8, 21, 9, 0, 0, 0, time.UTC),
			Seconds:   900, Comment: day,
		})
	}

	entries, err := s.EntriesForDay(context.Background(), "2026-08-19", "2026-08-21")
	if err != nil {
		t.Fatalf("EntriesForDay() returned error: %v", err)
	}

	want := []string{"2026-08-19", "2026-08-20", "2026-08-21"}
	if len(entries) != len(want) {
		t.Fatalf("got %d entries, want %d", len(entries), len(want))
	}
	for i, day := range want {
		if entries[i].Day != day {
			t.Errorf("entries[%d].Day = %q, want %q", i, entries[i].Day, day)
		}
	}
}

// Both bounds are inclusive: the rail asks for a single day as from == to, and
// an exclusive comparison would answer nothing at all.
func TestEntriesForDayBoundsAreInclusive(t *testing.T) {
	s := openTestStore(t)
	inst := createTestInstance(t, s)

	for _, day := range []string{"2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"} {
		createTestEntry(t, s, EntryInput{
			InstanceID: inst.ID, IssueKey: "RIDGE-1", Day: day,
			StartedAt: time.Date(2026, 8, 21, 9, 0, 0, 0, time.UTC),
			Seconds:   900, Comment: day,
		})
	}

	cases := map[string]struct {
		from, to string
		want     []string
	}{
		"one day":        {from: "2026-08-19", to: "2026-08-19", want: []string{"2026-08-19"}},
		"both edges":     {from: "2026-08-19", to: "2026-08-20", want: []string{"2026-08-19", "2026-08-20"}},
		"nothing inside": {from: "2026-08-22", to: "2026-08-23", want: nil},
	}

	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			entries, err := s.EntriesForDay(context.Background(), tc.from, tc.to)
			if err != nil {
				t.Fatalf("EntriesForDay() returned error: %v", err)
			}
			if len(entries) != len(tc.want) {
				t.Fatalf("got %d entries, want %d", len(entries), len(tc.want))
			}
			for i, day := range tc.want {
				if entries[i].Day != day {
					t.Errorf("entries[%d].Day = %q, want %q", i, entries[i].Day, day)
				}
			}
		})
	}
}

// Empty rather than nil, matching Instances and Pins, so the handler encodes
// [] and the rail sums an empty list instead of reading null.
func TestReadPathsReturnAnEmptySliceNotNil(t *testing.T) {
	s := openTestStore(t)
	createTestInstance(t, s)

	forDay, err := s.EntriesForDay(context.Background(), "2026-08-21", "2026-08-21")
	if err != nil {
		t.Fatalf("EntriesForDay() returned error: %v", err)
	}
	if forDay == nil {
		t.Error("EntriesForDay() = nil, want an empty slice")
	}
}

// Read back from the database rather than from what UpdateEntry returned: an
// implementation that built its answer in Go and never wrote the row would
// satisfy any assertion made against the returned value.
func TestUpdateEntryChangesSecondsAndCommentAndNothingElse(t *testing.T) {
	s := openTestStore(t)
	inst := createTestInstance(t, s)

	// Deliberately not today: an UPDATE that stamped day from the clock would
	// pass unnoticed against an entry logged on the day the test runs.
	const day = "2026-03-04"
	started := time.Date(2026, 3, 4, 14, 5, 0, 0, time.UTC)

	created := createTestEntry(t, s, EntryInput{
		InstanceID: inst.ID, IssueKey: "RIDGE-4929", Day: day,
		StartedAt: started, Seconds: 1800, Comment: "Refinement",
	})

	updated, err := s.UpdateEntry(context.Background(), created.ID, 2700, "Refinement and notes")
	if err != nil {
		t.Fatalf("UpdateEntry() returned error: %v", err)
	}

	var (
		storedDay, startedAt string
		seconds              int
		comment              sql.NullString
	)
	if err := s.db.QueryRow(
		`SELECT CAST(day AS TEXT), started_at, seconds, comment
		   FROM time_entries WHERE id = ?`, created.ID,
	).Scan(&storedDay, &startedAt, &seconds, &comment); err != nil {
		t.Fatalf("reading the stored row: %v", err)
	}

	if seconds != 2700 {
		t.Errorf("stored seconds = %d, want 2700", seconds)
	}
	if comment.String != "Refinement and notes" {
		t.Errorf("stored comment = %q, want %q", comment.String, "Refinement and notes")
	}
	if storedDay != day {
		t.Errorf("stored day = %q, want %q — UpdateEntry moved the day", storedDay, day)
	}
	if startedAt != started.Format(time.RFC3339) {
		t.Errorf("stored started_at = %q, want %q — UpdateEntry moved the start time",
			startedAt, started.Format(time.RFC3339))
	}

	if updated.Seconds != 2700 || updated.Comment != "Refinement and notes" {
		t.Errorf("returned row = %d/%q, want 2700/%q",
			updated.Seconds, updated.Comment, "Refinement and notes")
	}
	if updated.Day != created.Day || !updated.StartedAt.Equal(created.StartedAt) {
		t.Errorf("returned day/start = %q/%v, want %q/%v",
			updated.Day, updated.StartedAt, created.Day, created.StartedAt)
	}
}

// updated_at is half of what makes an entry dirty for #9, so an update that
// left it alone would present a changed entry as already pushed. Both stamps are
// backdated first, and to different instants: they have one-second resolution,
// so an immediate update would otherwise land in the second it was created in
// and a returned updated_at taken from created_at would read as correct.
func TestUpdateEntryMovesUpdatedAt(t *testing.T) {
	s := openTestStore(t)
	inst := createTestInstance(t, s)

	created := createTestEntry(t, s, EntryInput{
		InstanceID: inst.ID, IssueKey: "RIDGE-1", Day: "2026-08-21",
		StartedAt: time.Date(2026, 8, 21, 9, 0, 0, 0, time.UTC), Seconds: 900,
	})

	backdated := "2020-01-01T00:00:00Z"
	if _, err := s.db.Exec(
		`UPDATE time_entries SET created_at = ?, updated_at = ? WHERE id = ?`,
		"2019-01-01T00:00:00Z", backdated, created.ID,
	); err != nil {
		t.Fatalf("backdating the timestamps: %v", err)
	}

	updated, err := s.UpdateEntry(context.Background(), created.ID, 1800, "")
	if err != nil {
		t.Fatalf("UpdateEntry() returned error: %v", err)
	}

	var stored string
	if err := s.db.QueryRow(
		`SELECT updated_at FROM time_entries WHERE id = ?`, created.ID,
	).Scan(&stored); err != nil {
		t.Fatalf("reading updated_at: %v", err)
	}
	if stored == backdated {
		t.Error("updated_at is unchanged, want it moved to the time of the update")
	}
	if got := updated.UpdatedAt.Format(time.RFC3339); got != stored {
		t.Errorf("returned UpdatedAt = %q, want the stored %q", got, stored)
	}
}

// #9 owns worklog_id and pushed_at. An UPDATE naming every column would clear
// them, silently unpushing an entry Jira already holds.
func TestUpdateEntryLeavesPushStateAlone(t *testing.T) {
	s := openTestStore(t)
	inst := createTestInstance(t, s)

	created := createTestEntry(t, s, EntryInput{
		InstanceID: inst.ID, IssueKey: "RIDGE-1", Day: "2026-08-21",
		StartedAt: time.Date(2026, 8, 21, 9, 0, 0, 0, time.UTC), Seconds: 900,
	})

	pushedAt := time.Date(2026, 8, 21, 17, 0, 0, 0, time.UTC)
	if _, err := s.db.Exec(
		`UPDATE time_entries SET worklog_id = ?, pushed_at = ? WHERE id = ?`,
		"10042", pushedAt.Format(time.RFC3339), created.ID,
	); err != nil {
		t.Fatalf("marking the entry as pushed: %v", err)
	}

	if _, err := s.UpdateEntry(context.Background(), created.ID, 1800, "reworked"); err != nil {
		t.Fatalf("UpdateEntry() returned error: %v", err)
	}

	entries, err := s.EntriesForDay(context.Background(), "2026-08-21", "2026-08-21")
	if err != nil {
		t.Fatalf("EntriesForDay() returned error: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("got %d entries, want 1", len(entries))
	}
	if entries[0].WorklogID != "10042" {
		t.Errorf("WorklogID = %q, want 10042", entries[0].WorklogID)
	}
	if entries[0].PushedAt == nil {
		t.Fatal("PushedAt = nil, want the stored instant")
	}
	if !entries[0].PushedAt.Equal(pushedAt) {
		t.Errorf("PushedAt = %v, want %v", *entries[0].PushedAt, pushedAt)
	}
}

// Counted straight out of the table, so that a read path returning nothing
// cannot stand in for a delete that removed nothing.
func TestDeleteEntryRemovesTheRow(t *testing.T) {
	s := openTestStore(t)
	inst := createTestInstance(t, s)
	ctx := context.Background()

	created := createTestEntry(t, s, EntryInput{
		InstanceID: inst.ID, IssueKey: "RIDGE-1", Day: "2026-08-21",
		StartedAt: time.Date(2026, 8, 21, 9, 0, 0, 0, time.UTC), Seconds: 900,
	})

	countRows := func() int {
		t.Helper()
		var rows int
		if err := s.db.QueryRow(
			`SELECT count(*) FROM time_entries WHERE id = ?`, created.ID,
		).Scan(&rows); err != nil {
			t.Fatalf("counting the stored row: %v", err)
		}

		return rows
	}

	if countRows() != 1 {
		t.Fatal("the entry was not stored, so deleting it proves nothing")
	}

	if err := s.DeleteEntry(ctx, created.ID); err != nil {
		t.Fatalf("DeleteEntry() returned error: %v", err)
	}

	if rows := countRows(); rows != 0 {
		t.Errorf("time_entries still holds %d matching rows, want 0", rows)
	}
}

// UPDATE and DELETE against a missing id are not driver errors, so without
// errNoRowsIfUnaffected both would report success on a row that never existed.
// UpdateEntry's re-read would raise sql.ErrNoRows by itself, so the message is
// asserted as well: it is what tells the two apart and what keeps the guard —
// which is the one that names the failed write — from being dropped unnoticed.
func TestMutatingAMissingEntryIsErrNoRows(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	t.Run("UpdateEntry", func(t *testing.T) {
		_, err := s.UpdateEntry(ctx, 404, 900, "")
		if !errors.Is(err, sql.ErrNoRows) {
			t.Fatalf("err = %v, want sql.ErrNoRows", err)
		}
		if want := "updating entry 404"; !strings.Contains(err.Error(), want) {
			t.Errorf("err = %q, want it to name the failed update as %q", err, want)
		}
	})

	t.Run("DeleteEntry", func(t *testing.T) {
		if err := s.DeleteEntry(ctx, 404); !errors.Is(err, sql.ErrNoRows) {
			t.Errorf("err = %v, want sql.ErrNoRows", err)
		}
	})
}

// Removing a site takes its logged time with it, which is what the schema's
// ON DELETE CASCADE promises and what PRAGMA foreign_keys makes real.
func TestDeletingAnInstanceCascadesToItsEntries(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	doomed := createTestInstance(t, s)
	kept, err := s.CreateInstance(ctx, InstanceInput{
		Name: "Kept", SiteURL: "https://kept.atlassian.net",
		Email: "a@b.c", TokenEnc: []byte("sealed"),
	})
	if err != nil {
		t.Fatalf("creating the second instance: %v", err)
	}

	started := time.Date(2026, 8, 21, 9, 0, 0, 0, time.UTC)
	createTestEntry(t, s, EntryInput{
		InstanceID: doomed.ID, IssueKey: "RIDGE-1", Day: "2026-08-21",
		StartedAt: started, Seconds: 900, Comment: "doomed",
	})
	createTestEntry(t, s, EntryInput{
		InstanceID: kept.ID, IssueKey: "OTHER-1", Day: "2026-08-21",
		StartedAt: started, Seconds: 900, Comment: "kept",
	})

	if err := s.DeleteInstance(ctx, doomed.ID); err != nil {
		t.Fatalf("DeleteInstance() returned error: %v", err)
	}

	entries, err := s.EntriesForDay(ctx, "2026-08-21", "2026-08-21")
	if err != nil {
		t.Fatalf("EntriesForDay() returned error: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("got %d entries, want 1", len(entries))
	}
	if entries[0].Comment != "kept" {
		t.Errorf("surviving entry = %q, want kept", entries[0].Comment)
	}
}

func TestMarkEntryPushedIfUnchanged(t *testing.T) {
	tests := []struct {
		name       string
		editBefore bool
		wantMarked bool
	}{
		{name: "marks an entry nothing touched", editBefore: false, wantMarked: true},
		{name: "refuses an entry edited since it was read", editBefore: true, wantMarked: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ctx := context.Background()
			s := openTestStore(t)
			inst := createTestInstance(t, s)
			entry, err := s.CreateEntry(ctx, EntryInput{
				InstanceID: inst.ID, IssueKey: "RID-1", Day: "2026-09-08",
				StartedAt: time.Date(2026, 9, 8, 9, 0, 0, 0, time.UTC), Seconds: 3600,
			})
			if err != nil {
				t.Fatalf("creating an entry: %v", err)
			}

			read := entry.UpdatedAt

			if test.editBefore {
				// A second of separation, because updated_at is stored at
				// RFC3339's one-second resolution: without it the "edited"
				// case would write the same value it read and pass wrongly.
				time.Sleep(1100 * time.Millisecond)
				if _, err := s.UpdateEntry(ctx, entry.ID, 7200, "typed while pushing"); err != nil {
					t.Fatalf("editing the entry: %v", err)
				}
			}

			marked, err := s.MarkEntryPushedIfUnchanged(
				ctx, entry.ID, "10001", time.Now().UTC(), read)
			if err != nil {
				t.Fatalf("marking pushed: %v", err)
			}
			if marked != test.wantMarked {
				t.Fatalf("marked = %v, want %v", marked, test.wantMarked)
			}

			after, err := s.Entry(ctx, entry.ID)
			if err != nil {
				t.Fatalf("re-reading the entry: %v", err)
			}
			if test.wantMarked && after.WorklogID != "10001" {
				t.Fatalf("worklog id = %q, want 10001", after.WorklogID)
			}
			if !test.wantMarked {
				if after.WorklogID != "" {
					t.Fatalf("worklog id = %q, want it left empty so the next push retries", after.WorklogID)
				}
				if after.Seconds != 7200 {
					t.Fatalf("seconds = %d, want the edit kept at 7200", after.Seconds)
				}
			}
		})
	}
}
