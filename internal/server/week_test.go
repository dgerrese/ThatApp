package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"codeberg.org/DionGerrese/ThatApp/internal/crypto"
	"codeberg.org/DionGerrese/ThatApp/internal/store"
)

// entryInState builds the minimal entry that pushStateOf will read as `state`.
// updated is only meaningful for "dirty", where it must be after pushed.
func entryInState(state string) store.Entry {
	pushed := time.Date(2026, 9, 9, 10, 0, 0, 0, time.UTC)

	switch state {
	case "unpushed":
		return store.Entry{UpdatedAt: pushed}
	case "pushed":
		return store.Entry{WorklogID: "1", PushedAt: &pushed, UpdatedAt: pushed}
	case "dirty":
		return store.Entry{WorklogID: "1", PushedAt: &pushed, UpdatedAt: pushed.Add(time.Hour)}
	case "deleted":
		deleted := pushed.Add(2 * time.Hour)
		return store.Entry{WorklogID: "1", PushedAt: &pushed, UpdatedAt: pushed, DeletedAt: &deleted}
	}

	panic("unknown state " + state)
}

func TestWorstPushState(t *testing.T) {
	cases := []struct {
		name  string
		given []string
		want  string
	}{
		{"no entries at all", nil, ""},
		{"one unpushed", []string{"unpushed"}, "unpushed"},
		{"one pushed", []string{"pushed"}, "pushed"},
		{"one dirty", []string{"dirty"}, "dirty"},
		{"all pushed", []string{"pushed", "pushed"}, "pushed"},
		{"pushed and unpushed reads unpushed", []string{"pushed", "unpushed"}, "unpushed"},
		{"unpushed and pushed, order does not matter", []string{"unpushed", "pushed"}, "unpushed"},
		{"pushed and dirty reads dirty", []string{"pushed", "dirty"}, "dirty"},
		{"dirty and unpushed reads unpushed", []string{"dirty", "unpushed"}, "unpushed"},
		{"unpushed beats dirty whatever the order", []string{"unpushed", "dirty"}, "unpushed"},
		{"all three reads unpushed", []string{"pushed", "dirty", "unpushed"}, "unpushed"},
		{"one deleted", []string{"deleted"}, "deleted"},
		{"pushed and deleted reads deleted", []string{"pushed", "deleted"}, "deleted"},
		{"deleted beats dirty whatever the order", []string{"deleted", "dirty"}, "deleted"},
		{"dirty and deleted reads deleted", []string{"dirty", "deleted"}, "deleted"},
		{"unpushed beats deleted", []string{"deleted", "unpushed"}, "unpushed"},
		{"all four reads unpushed", []string{"pushed", "dirty", "deleted", "unpushed"}, "unpushed"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			entries := make([]store.Entry, 0, len(tc.given))
			for _, state := range tc.given {
				entries = append(entries, entryInState(state))
			}

			got := worstPushState(entries)

			if tc.want == "" {
				if got != nil {
					t.Fatalf("got %q, want nil", *got)
				}
				return
			}
			if got == nil {
				t.Fatalf("got nil, want %q", tc.want)
			}
			if *got != tc.want {
				t.Fatalf("got %q, want %q", *got, tc.want)
			}
		})
	}
}

func seedPin(t *testing.T, db *store.Store, instanceID int64, issueKey string) *store.Pin {
	t.Helper()

	pin, err := db.CreatePin(context.Background(), store.PinInput{InstanceID: instanceID, IssueKey: issueKey})
	if err != nil {
		t.Fatalf("pinning %q: %v", issueKey, err)
	}

	return pin
}

func callWeek(t *testing.T, srv *Server, target string) *httptest.ResponseRecorder {
	t.Helper()

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))

	return rec
}

func decodeWeek(t *testing.T, rec *httptest.ResponseRecorder) weekRollupDTO {
	t.Helper()

	var dto weekRollupDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &dto); err != nil {
		t.Fatalf("decoding %s: %v", rec.Body.String(), err)
	}

	return dto
}

func TestWeekRejectsAStartThatIsNotAMonday(t *testing.T) {
	// 2026-09-07 is a Monday; the other six are not, and none may be quietly
	// snapped to it — two different starts answering identically is the bug.
	cases := []struct {
		name  string
		start string
	}{
		{"a Sunday", "2026-09-06"},
		{"a Tuesday", "2026-09-08"},
		{"a Saturday", "2026-09-12"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv, _, _ := serverInZone(t, "Europe/Amsterdam",
				time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC))

			rec := callWeek(t, srv, "/api/week?start="+tc.start)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("got %d, want %d", rec.Code, http.StatusBadRequest)
			}
			var body errorBody
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("decoding %s: %v", rec.Body.String(), err)
			}
			if body.Code != "start_not_monday" {
				t.Fatalf("got code %q, want %q", body.Code, "start_not_monday")
			}
		})
	}
}

func TestWeekWithNoEntriesIsAnEmptyGrid(t *testing.T) {
	srv, _, _ := serverInZone(t, "Europe/Amsterdam",
		time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC))

	rec := callWeek(t, srv, "/api/week?start=2026-09-07")

	if rec.Code != http.StatusOK {
		t.Fatalf("got %d, want %d", rec.Code, http.StatusOK)
	}
	got := decodeWeek(t, rec)
	if len(got.Rows) != 0 {
		t.Fatalf("got %d rows, want 0", len(got.Rows))
	}
	if len(got.Days) != 7 {
		t.Fatalf("got %d days, want 7", len(got.Days))
	}
	if got.Seconds != 0 {
		t.Fatalf("got %d seconds, want 0", got.Seconds)
	}
	for _, day := range got.Days {
		if day.PushState != nil {
			t.Fatalf("day %s: got state %q, want nil", day.Day, *day.PushState)
		}
	}
}

func TestWeekSumsCellsRowsAndDays(t *testing.T) {
	srv, db, inst := serverInZone(t, "Europe/Amsterdam",
		time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC))

	// WORK-1 on Monday and Wednesday, WORK-2 on Monday only.
	seedEntry(t, db, store.EntryInput{
		InstanceID: inst.ID, IssueKey: "WORK-1", Day: "2026-09-07",
		StartedAt: time.Date(2026, 9, 7, 9, 0, 0, 0, time.UTC), Seconds: 3600,
	})
	seedEntry(t, db, store.EntryInput{
		InstanceID: inst.ID, IssueKey: "WORK-1", Day: "2026-09-09",
		StartedAt: time.Date(2026, 9, 9, 9, 0, 0, 0, time.UTC), Seconds: 1800,
	})
	seedEntry(t, db, store.EntryInput{
		InstanceID: inst.ID, IssueKey: "WORK-2", Day: "2026-09-07",
		StartedAt: time.Date(2026, 9, 7, 14, 0, 0, 0, time.UTC), Seconds: 900,
	})

	got := decodeWeek(t, callWeek(t, srv, "/api/week?start=2026-09-07"))

	if len(got.Rows) != 2 {
		t.Fatalf("got %d rows, want 2", len(got.Rows))
	}
	// Rows sort by instance position then issue key, so WORK-1 is first.
	if got.Rows[0].IssueKey != "WORK-1" || got.Rows[1].IssueKey != "WORK-2" {
		t.Fatalf("got rows %q, %q; want WORK-1, WORK-2",
			got.Rows[0].IssueKey, got.Rows[1].IssueKey)
	}
	if len(got.Rows[0].Cells) != 7 {
		t.Fatalf("got %d cells, want 7", len(got.Rows[0].Cells))
	}
	if got.Rows[0].Cells[0].Seconds != 3600 || got.Rows[0].Cells[2].Seconds != 1800 {
		t.Fatalf("WORK-1 cells: got Mon %d Wed %d, want 3600 and 1800",
			got.Rows[0].Cells[0].Seconds, got.Rows[0].Cells[2].Seconds)
	}
	if got.Rows[0].Seconds != 5400 {
		t.Fatalf("WORK-1 row total: got %d, want 5400", got.Rows[0].Seconds)
	}
	if got.Days[0].Seconds != 4500 {
		t.Fatalf("Monday total: got %d, want 4500", got.Days[0].Seconds)
	}
	if got.Seconds != 6300 {
		t.Fatalf("week total: got %d, want 6300", got.Seconds)
	}
	// The neighbouring Mondays travel with the rollup so the view can link to
	// them without doing date arithmetic in the browser.
	if got.PrevStart != "2026-08-31" || got.NextStart != "2026-09-14" {
		t.Fatalf("neighbouring weeks: got %q and %q, want 2026-08-31 and 2026-09-14",
			got.PrevStart, got.NextStart)
	}
}

// TestWeekRowCarriesTheBrowseURL covers W4: the ticket key becomes a link, and
// the browser must not be the one guessing Jira's URL shape from a site URL it
// already has for other purposes.
func TestWeekRowCarriesTheBrowseURL(t *testing.T) {
	srv, db, inst := serverInZone(t, "Europe/Amsterdam",
		time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC))

	seedEntry(t, db, store.EntryInput{
		InstanceID: inst.ID, IssueKey: "WORK-1", Day: "2026-09-07",
		StartedAt: time.Date(2026, 9, 7, 9, 0, 0, 0, time.UTC), Seconds: 600,
	})

	got := decodeWeek(t, callWeek(t, srv, "/api/week?start=2026-09-07"))

	if len(got.Rows) != 1 {
		t.Fatalf("got %d rows, want 1", len(got.Rows))
	}
	if got.Rows[0].URL != "https://work.atlassian.net/browse/WORK-1" {
		t.Fatalf("url = %q, want https://work.atlassian.net/browse/WORK-1", got.Rows[0].URL)
	}
}

// TestWeekRowFromAMigratedInstanceCarriesNoURL covers the instance that has no
// site to link to: browseURL returns "", and the row must pass that straight
// through rather than building a broken link from an empty base.
func TestWeekRowFromAMigratedInstanceCarriesNoURL(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	srv.now = func() time.Time { return time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC) }
	inst := seedInstance(t, db, sealer, "Migrated", "", "https://api.example")

	seedEntry(t, db, store.EntryInput{
		InstanceID: inst.ID, IssueKey: "WORK-1", Day: "2026-09-07",
		StartedAt: time.Date(2026, 9, 7, 9, 0, 0, 0, time.UTC), Seconds: 600,
	})

	got := decodeWeek(t, callWeek(t, srv, "/api/week?start=2026-09-07"))

	if len(got.Rows) != 1 {
		t.Fatalf("got %d rows, want 1", len(got.Rows))
	}
	if got.Rows[0].URL != "" {
		t.Fatalf("url = %q, want empty — a migrated instance has no site to link to", got.Rows[0].URL)
	}
}

func TestWeekKeepsTheSameKeyInTwoInstancesApart(t *testing.T) {
	srv, db, first := serverInZone(t, "Europe/Amsterdam",
		time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC))
	sealer, err := crypto.NewSealer(make([]byte, crypto.KeySize))
	if err != nil {
		t.Fatalf("building sealer: %v", err)
	}
	second := seedInstance(t, db, sealer, "Other", "https://other.atlassian.net", "https://api.other")

	seedEntry(t, db, store.EntryInput{
		InstanceID: second.ID, IssueKey: "SHARED-1", Day: "2026-09-07",
		StartedAt: time.Date(2026, 9, 7, 9, 0, 0, 0, time.UTC), Seconds: 600,
	})
	seedEntry(t, db, store.EntryInput{
		InstanceID: first.ID, IssueKey: "SHARED-1", Day: "2026-09-07",
		StartedAt: time.Date(2026, 9, 7, 10, 0, 0, 0, time.UTC), Seconds: 1200,
	})

	got := decodeWeek(t, callWeek(t, srv, "/api/week?start=2026-09-07"))

	if len(got.Rows) != 2 {
		t.Fatalf("got %d rows, want 2 — the same key in two instances is two rows", len(got.Rows))
	}
	if got.Rows[0].InstancePosition != 0 || got.Rows[1].InstancePosition != 1 {
		t.Fatalf("got positions %d, %d; want 0, 1 — rows sort by instance position",
			got.Rows[0].InstancePosition, got.Rows[1].InstancePosition)
	}
}

// TestWeekNumberIsISO8601 covers the year-boundary cases where a naive
// week-of-year computation and time.ISOWeek() diverge: the last week of a year
// can belong to the year that follows it, or the first days of a year can
// belong to the week of the year before.
func TestWeekNumberIsISO8601(t *testing.T) {
	cases := []struct {
		name  string
		start string
		want  int
	}{
		{"an ordinary week", "2026-08-31", 36},
		{"the last week of the year, though it holds days in the next", "2026-12-28", 53},
		{"the first week of the following year", "2027-01-04", 1},
		{"the second week of the following year", "2027-01-11", 2},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv, _, _ := serverInZone(t, "Europe/Amsterdam",
				time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC))

			got := decodeWeek(t, callWeek(t, srv, "/api/week?start="+tc.start))

			if got.WeekNumber != tc.want {
				t.Fatalf("got week %d, want %d", got.WeekNumber, tc.want)
			}
		})
	}
}

func TestWeekResolvesTheStartInTheConfiguredZone(t *testing.T) {
	// 23:30 UTC on Sunday the 13th is already Monday the 14th in Amsterdam, so
	// "this week" is the one beginning the 14th — not the 7th the UTC clock
	// would give. The process clock is UTC throughout, as it is in the container.
	srv, _, _ := serverInZone(t, "Europe/Amsterdam",
		time.Date(2026, 9, 13, 23, 30, 0, 0, time.UTC))

	got := decodeWeek(t, callWeek(t, srv, "/api/week"))

	if got.Start != "2026-09-14" {
		t.Fatalf("got start %q, want 2026-09-14", got.Start)
	}
	if got.End != "2026-09-20" {
		t.Fatalf("got end %q, want 2026-09-20", got.End)
	}
}

// TestWeekPinnedRowInCurrentWeek covers a pinned ticket with nothing logged
// against it: it gets a row of seven zero cells in the week containing today,
// and none in a neighbouring week — a pin is not a promise about every week,
// only the one that is still open.
func TestWeekPinnedRowInCurrentWeek(t *testing.T) {
	// Wednesday the 9th, Europe/Amsterdam: the current week's Monday is the 7th.
	instant := time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC)

	srv, db, inst := serverInZone(t, "Europe/Amsterdam", instant)
	seedPin(t, db, inst.ID, "PIN-1")

	got := decodeWeek(t, callWeek(t, srv, "/api/week?start=2026-09-07"))

	if len(got.Rows) != 1 {
		t.Fatalf("got %d rows, want 1 — a pinned ticket with no entries still gets a row", len(got.Rows))
	}
	row := got.Rows[0]
	if row.IssueKey != "PIN-1" {
		t.Fatalf("got issue key %q, want PIN-1", row.IssueKey)
	}
	if len(row.Cells) != 7 {
		t.Fatalf("got %d cells, want 7", len(row.Cells))
	}
	for i, cell := range row.Cells {
		if cell.Seconds != 0 || cell.PushState != nil {
			t.Fatalf("cell %d: got seconds %d pushState %v, want 0 and nil", i, cell.Seconds, cell.PushState)
		}
	}
	if row.Seconds != 0 {
		t.Fatalf("row total: got %d, want 0", row.Seconds)
	}
}

// TestWeekPinnedRowOnlyInCurrentWeek covers the other side of the same rule: a
// pin with nothing logged draws no row in a week that is not the current one,
// past or future.
func TestWeekPinnedRowOnlyInCurrentWeek(t *testing.T) {
	cases := []struct {
		name  string
		start string
	}{
		{"past week", "2026-08-31"},
		{"future week", "2026-09-14"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// Wednesday the 9th, Europe/Amsterdam: the current week's Monday is
			// the 7th, so both cases below are genuinely not it.
			srv, db, inst := serverInZone(t, "Europe/Amsterdam",
				time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC))
			seedPin(t, db, inst.ID, "PIN-1")

			got := decodeWeek(t, callWeek(t, srv, "/api/week?start="+tc.start))

			if len(got.Rows) != 0 {
				t.Fatalf("got %d rows, want 0 — a pin outside the current week draws no row",
					len(got.Rows))
			}
		})
	}
}

// TestWeekPinnedTicketAlsoWorkedYieldsOneRow covers the merge: a ticket that is
// both pinned and has real entries this week must not appear twice, once from
// each source, and must carry its real figures rather than the empty block.
func TestWeekPinnedTicketAlsoWorkedYieldsOneRow(t *testing.T) {
	srv, db, inst := serverInZone(t, "Europe/Amsterdam",
		time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC))
	seedPin(t, db, inst.ID, "PIN-1")
	seedEntry(t, db, store.EntryInput{
		InstanceID: inst.ID, IssueKey: "PIN-1", Day: "2026-09-08",
		StartedAt: time.Date(2026, 9, 8, 9, 0, 0, 0, time.UTC), Seconds: 1200,
	})

	got := decodeWeek(t, callWeek(t, srv, "/api/week?start=2026-09-07"))

	if len(got.Rows) != 1 {
		t.Fatalf("got %d rows, want exactly 1 — a pinned, worked ticket is one row, not two",
			len(got.Rows))
	}
	if got.Rows[0].Seconds != 1200 {
		t.Fatalf("row total: got %d, want 1200 — the real figures, not the empty pin block",
			got.Rows[0].Seconds)
	}
	if got.Rows[0].Cells[1].Seconds != 1200 {
		t.Fatalf("Tuesday cell: got %d, want 1200", got.Rows[0].Cells[1].Seconds)
	}
}

// TestWeekPinnedAndLoggedRowsSortTogether covers a pinned empty ticket sitting
// alongside a worked one: both get rows, in the grid's ordinary instance-then-key
// order, with no mark of which is which.
func TestWeekPinnedAndLoggedRowsSortTogether(t *testing.T) {
	srv, db, first := serverInZone(t, "Europe/Amsterdam",
		time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC))
	sealer, err := crypto.NewSealer(make([]byte, crypto.KeySize))
	if err != nil {
		t.Fatalf("building sealer: %v", err)
	}
	second := seedInstance(t, db, sealer, "Other", "https://other.atlassian.net", "https://api.other")

	seedEntry(t, db, store.EntryInput{
		InstanceID: first.ID, IssueKey: "WORK-1", Day: "2026-09-07",
		StartedAt: time.Date(2026, 9, 7, 9, 0, 0, 0, time.UTC), Seconds: 600,
	})
	seedPin(t, db, second.ID, "OTHER-1")

	got := decodeWeek(t, callWeek(t, srv, "/api/week?start=2026-09-07"))

	if len(got.Rows) != 2 {
		t.Fatalf("got %d rows, want 2", len(got.Rows))
	}
	if got.Rows[0].IssueKey != "WORK-1" || got.Rows[1].IssueKey != "OTHER-1" {
		t.Fatalf("got rows %q, %q; want WORK-1, OTHER-1 — instance position order",
			got.Rows[0].IssueKey, got.Rows[1].IssueKey)
	}
	if got.Rows[1].Seconds != 0 {
		t.Fatalf("pinned row total: got %d, want 0", got.Rows[1].Seconds)
	}
}

// TestWeekPinnedEmptyRowDoesNotMoveTotals covers decision 3 of the plan: an
// empty pinned row is arithmetic, not a choice — it must not nudge a day total,
// the week total, or any pushState, because it carries no entries to sum.
func TestWeekPinnedEmptyRowDoesNotMoveTotals(t *testing.T) {
	srv, db, inst := serverInZone(t, "Europe/Amsterdam",
		time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC))
	seedEntry(t, db, store.EntryInput{
		InstanceID: inst.ID, IssueKey: "WORK-1", Day: "2026-09-07",
		StartedAt: time.Date(2026, 9, 7, 9, 0, 0, 0, time.UTC), Seconds: 600,
	})
	seedPin(t, db, inst.ID, "PIN-1")

	got := decodeWeek(t, callWeek(t, srv, "/api/week?start=2026-09-07"))

	if got.Seconds != 600 {
		t.Fatalf("week total: got %d, want 600 — an empty pinned row adds nothing", got.Seconds)
	}
	if got.Days[0].Seconds != 600 || got.Days[0].PushState == nil || *got.Days[0].PushState != "unpushed" {
		t.Fatalf("Monday: got seconds %d pushState %v, want 600 and unpushed",
			got.Days[0].Seconds, got.Days[0].PushState)
	}
	for i, day := range got.Days {
		if i == 0 {
			continue
		}
		if day.Seconds != 0 || day.PushState != nil {
			t.Fatalf("day %d: got seconds %d pushState %v, want 0 and nil", i, day.Seconds, day.PushState)
		}
	}
}

// TestWeekPinnedRowUsesTheConfiguredZoneNotUTC is the day-boundary case
// CLAUDE.md names as a risk area, applied to the new "is this the current
// week" check handleWeek makes before fetching pins. Kiritimati sits fourteen
// hours ahead of UTC, so at this instant the UTC calendar date and the local
// one disagree by a whole week's worth of Monday: a version that dropped
// `.In(s.cfg.Location)` — whether by comparing against a bare `s.now()` or by
// swapping in `time.Now()` — would resolve the wrong current week, and this
// test would fail either mistake.
func TestWeekPinnedRowUsesTheConfiguredZoneNotUTC(t *testing.T) {
	// 20:00 UTC on Sunday the 13th is already 10:00 Monday the 14th in
	// Kiritimati (UTC+14), so the local current week begins the 14th, not the
	// week beginning the 7th that the UTC calendar date would give.
	srv, db, inst := serverInZone(t, "Pacific/Kiritimati",
		time.Date(2026, 9, 13, 20, 0, 0, 0, time.UTC))
	seedPin(t, db, inst.ID, "PIN-1")

	local := decodeWeek(t, callWeek(t, srv, "/api/week?start=2026-09-14"))
	if len(local.Rows) != 1 {
		t.Fatalf("local current week (2026-09-14): got %d rows, want 1 — the pinned row belongs here",
			len(local.Rows))
	}

	utc := decodeWeek(t, callWeek(t, srv, "/api/week?start=2026-09-07"))
	if len(utc.Rows) != 0 {
		t.Fatalf("the UTC-dated week (2026-09-07): got %d rows, want 0 — "+
			"it is not current once the day boundary is resolved in Pacific/Kiritimati",
			len(utc.Rows))
	}
}

func TestWeekCellStateIsTheWorstOfItsEntries(t *testing.T) {
	srv, db, inst := serverInZone(t, "Europe/Amsterdam",
		time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC))

	pushed := seedEntry(t, db, store.EntryInput{
		InstanceID: inst.ID, IssueKey: "WORK-1", Day: "2026-09-07",
		StartedAt: time.Date(2026, 9, 7, 9, 0, 0, 0, time.UTC), Seconds: 600,
	})
	if _, err := db.RecordWorklogMarkingPushedIfUnchanged(
		context.Background(), pushed.ID, "w-1", time.Now().UTC(), pushed.UpdatedAt,
	); err != nil {
		t.Fatalf("marking entry pushed: %v", err)
	}
	seedEntry(t, db, store.EntryInput{
		InstanceID: inst.ID, IssueKey: "WORK-1", Day: "2026-09-07",
		StartedAt: time.Date(2026, 9, 7, 11, 0, 0, 0, time.UTC), Seconds: 600,
	})

	got := decodeWeek(t, callWeek(t, srv, "/api/week?start=2026-09-07"))

	cell := got.Rows[0].Cells[0]
	if cell.PushState == nil || *cell.PushState != "unpushed" {
		t.Fatalf("got %v, want unpushed — one pushed and one not reads as unpushed", cell.PushState)
	}
	if got.Days[0].PushState == nil || *got.Days[0].PushState != "unpushed" {
		t.Fatalf("day state: got %v, want unpushed", got.Days[0].PushState)
	}
}

// #280: every total says what Jira will hold after the push. Monday holds a
// pushed hour and a pending-delete half hour; Tuesday holds only a pending
// delete, which still marks its cell and its day — that is how the grid tells
// it from a day with nothing on it.
func TestWeekLeavesPendingDeletesOutOfItsTotals(t *testing.T) {
	srv, db, inst := serverInZone(t, "Europe/Amsterdam", time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC))
	ctx := context.Background()

	seed := func(day string, hour, seconds int, deleted bool) {
		t.Helper()
		entry := seedEntry(t, db, store.EntryInput{
			InstanceID: inst.ID, IssueKey: "WORK-1", Day: day,
			StartedAt: time.Date(2026, 9, 7, hour, 0, 0, 0, time.UTC), Seconds: seconds,
		})
		if _, err := db.RecordWorklogMarkingPushedIfUnchanged(
			ctx, entry.ID, "w-"+strconv.FormatInt(entry.ID, 10), time.Now().UTC(), entry.UpdatedAt,
		); err != nil {
			t.Fatalf("marking entry pushed: %v", err)
		}
		if deleted {
			if err := db.MarkEntryDeleted(ctx, entry.ID, time.Now()); err != nil {
				t.Fatalf("marking entry deleted: %v", err)
			}
		}
	}
	seed("2026-09-07", 9, 3600, false)
	seed("2026-09-07", 11, 1800, true)
	seed("2026-09-08", 9, 900, true)

	got := decodeWeek(t, callWeek(t, srv, "/api/week?start=2026-09-07"))

	monday, tuesday := got.Rows[0].Cells[0], got.Rows[0].Cells[1]
	if monday.Seconds != 3600 || monday.PushState == nil || *monday.PushState != "deleted" {
		t.Errorf("Monday cell = %d %v, want 3600 deleted", monday.Seconds, monday.PushState)
	}
	if tuesday.Seconds != 0 || tuesday.PushState == nil || *tuesday.PushState != "deleted" {
		t.Errorf("Tuesday cell = %d %v, want 0 deleted", tuesday.Seconds, tuesday.PushState)
	}
	if got.Days[0].Seconds != 3600 || got.Days[1].Seconds != 0 {
		t.Errorf("day totals = %d, %d; want 3600, 0", got.Days[0].Seconds, got.Days[1].Seconds)
	}
	if got.Days[1].PushState == nil || *got.Days[1].PushState != "deleted" {
		t.Errorf("Tuesday's day state = %v, want deleted", got.Days[1].PushState)
	}
	if got.Rows[0].Seconds != 3600 || got.Seconds != 3600 {
		t.Errorf("row total %d, week total %d; want 3600 and 3600", got.Rows[0].Seconds, got.Seconds)
	}
}
