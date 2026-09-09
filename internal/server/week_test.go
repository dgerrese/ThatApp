package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
