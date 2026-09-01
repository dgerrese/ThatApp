package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/dgerrese/work-dashboard/internal/config"
	"github.com/dgerrese/work-dashboard/internal/crypto"
	"github.com/dgerrese/work-dashboard/internal/store"
)

// serverInZone builds a server whose configured zone is zone and whose clock is
// frozen at instant. Both are needed together: the day an entry lands on is only
// provable when the machine's own clock and WD_TIMEZONE disagree, and no test
// can move the machine's clock to 1am in Auckland.
func serverInZone(
	t *testing.T, zone string, instant time.Time,
) (*Server, *store.Store, *store.Instance) {
	t.Helper()

	srv, db, sealer := newServerWithStore(t)
	loc, err := time.LoadLocation(zone)
	if err != nil {
		t.Fatalf("loading zone %q: %v", zone, err)
	}
	srv.cfg.Location = loc
	srv.now = func() time.Time { return instant }
	inst := seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", "https://api.example")

	return srv, db, inst
}

// serverInZoneOverAKnownFile is serverInZone with the store's file in the
// test's own hands and a second connection open to it. One test needs to break
// a single table's reads while the rest of the store keeps answering; closing
// the store fails every call instead, which cannot tell a handler that reads
// before it writes from one that writes first.
//
// It repeats newServerWithStore's setup rather than building on it, because
// reaching the path means returning it from that helper, and that helper has
// fifty-three callers across six files. Twenty duplicated lines here are the
// cheaper of the two.
func serverInZoneOverAKnownFile(
	t *testing.T, zone string, instant time.Time,
) (*Server, *store.Store, *sql.DB, *store.Instance) {
	t.Helper()

	path := filepath.Join(t.TempDir(), "entries.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatalf("opening store at %s: %v", path, err)
	}
	t.Cleanup(func() { _ = db.Close() })

	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("opening a second connection to %s: %v", path, err)
	}
	t.Cleanup(func() { _ = raw.Close() })

	sealer, err := crypto.NewSealer(make([]byte, crypto.KeySize))
	if err != nil {
		t.Fatalf("building sealer: %v", err)
	}
	loc, err := time.LoadLocation(zone)
	if err != nil {
		t.Fatalf("loading zone %q: %v", zone, err)
	}

	srv := New(&config.Config{Addr: ":8080", Location: loc}, fstest.MapFS{}, db, sealer)
	srv.now = func() time.Time { return instant }
	inst := seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", "https://api.example")

	return srv, db, raw, inst
}

func callEntries(t *testing.T, srv *Server, method, target, body string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(method, target, nil)
	if body != "" {
		req = httptest.NewRequest(method, target, strings.NewReader(body))
	}
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	return rec
}

func decodeEntry(t *testing.T, rec *httptest.ResponseRecorder) entryDTO {
	t.Helper()

	var dto entryDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &dto); err != nil {
		t.Fatalf("decoding %s: %v", rec.Body.String(), err)
	}

	return dto
}

func decodeEntries(t *testing.T, rec *httptest.ResponseRecorder) []entryDTO {
	t.Helper()

	var dtos []entryDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &dtos); err != nil {
		t.Fatalf("decoding %s: %v", rec.Body.String(), err)
	}

	return dtos
}

// assertRejected checks the status, the stable code and that a person was told
// something. #6's review found a rejection test that asserted only that the
// error existed, so every rejection here reads all three.
func assertRejected(t *testing.T, rec *httptest.ResponseRecorder, wantStatus int, wantCode string) {
	t.Helper()

	if rec.Code != wantStatus {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, wantStatus, rec.Body.String())
	}

	var body errorBody
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decoding %s: %v", rec.Body.String(), err)
	}
	if body.Code != wantCode {
		t.Errorf("code = %q, want %q", body.Code, wantCode)
	}
	if strings.TrimSpace(body.Message) == "" {
		t.Errorf("the %s rejection carries no message", wantCode)
	}
}

func seedEntry(t *testing.T, db *store.Store, in store.EntryInput) store.Entry {
	t.Helper()

	entry, err := db.CreateEntry(context.Background(), in)
	if err != nil {
		t.Fatalf("seeding an entry for %q on %s: %v", in.IssueKey, in.Day, err)
	}

	return *entry
}

// allEntries reads every stored entry whatever its day, so a test can prove what
// a request wrote without assuming the day the handler chose.
func allEntries(t *testing.T, db *store.Store) []store.Entry {
	t.Helper()

	entries, err := db.EntriesForDay(context.Background(), "0001-01-01", "9999-12-31")
	if err != nil {
		t.Fatalf("reading the stored entries: %v", err)
	}

	return entries
}

// TestPostEntryStampsTheDayInTheConfiguredZone is the test this ticket exists
// for. Both instants are ones where UTC and the local date disagree, in opposite
// directions, so neither a hardcoded offset nor a dropped conversion survives.
func TestPostEntryStampsTheDayInTheConfiguredZone(t *testing.T) {
	for _, tc := range []struct {
		name          string
		zone          string
		instant       time.Time
		wantDay       string
		wantStartedAt string
	}{
		{
			name:          "an instant UTC still calls the 21st is already the 22nd in Auckland",
			zone:          "Pacific/Auckland",
			instant:       time.Date(2026, 8, 21, 13, 0, 0, 0, time.UTC),
			wantDay:       "2026-08-22",
			wantStartedAt: "2026-08-22T01:00:00+12:00",
		},
		{
			name:          "an instant UTC calls the 21st is still the 20th in Los Angeles",
			zone:          "America/Los_Angeles",
			instant:       time.Date(2026, 8, 21, 2, 0, 0, 0, time.UTC),
			wantDay:       "2026-08-20",
			wantStartedAt: "2026-08-20T19:00:00-07:00",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv, db, inst := serverInZone(t, tc.zone, tc.instant)

			rec := callEntries(t, srv, http.MethodPost, "/api/entries",
				`{"instanceId":`+strconv.FormatInt(inst.ID, 10)+
					`,"issueKey":"RIDGE-4929","seconds":1800,"comment":"Refinement"}`)

			if rec.Code != http.StatusCreated {
				t.Fatalf("status = %d, want %d; body %s",
					rec.Code, http.StatusCreated, rec.Body.String())
			}
			dto := decodeEntry(t, rec)
			if dto.Day != tc.wantDay {
				t.Errorf("day = %q, want %q; UTC would have said %q",
					dto.Day, tc.wantDay, tc.instant.UTC().Format("2006-01-02"))
			}
			// The store normalises started_at to UTC on write; the response
			// renders it back in the configured zone, so the browser shows the
			// wall clock the entry was made at without knowing WD_TIMEZONE.
			if dto.StartedAt != tc.wantStartedAt {
				t.Errorf("startedAt = %q, want %q", dto.StartedAt, tc.wantStartedAt)
			}

			stored := allEntries(t, db)
			if len(stored) != 1 {
				t.Fatalf("stored %d entries, want 1", len(stored))
			}
			if stored[0].Day != tc.wantDay {
				t.Errorf("stored day = %q, want %q; the response and the row disagree",
					stored[0].Day, tc.wantDay)
			}
			if !stored[0].StartedAt.Equal(tc.instant) {
				t.Errorf("stored startedAt = %v, want the instant the day was resolved from, %v",
					stored[0].StartedAt, tc.instant)
			}
		})
	}
}

// TestPostEntryIgnoresAClientSuppliedDayAndStartedAt: a browser must not be able
// to post itself into another day. The body sends both fields, deliberately
// wrong, and the stored row carries the server's values.
func TestPostEntryIgnoresAClientSuppliedDayAndStartedAt(t *testing.T) {
	instant := time.Date(2026, 8, 21, 13, 0, 0, 0, time.UTC)
	srv, db, inst := serverInZone(t, "Pacific/Auckland", instant)

	rec := callEntries(t, srv, http.MethodPost, "/api/entries",
		`{"instanceId":`+strconv.FormatInt(inst.ID, 10)+`,"issueKey":"RIDGE-4929","seconds":900,`+
			`"day":"1999-01-01","startedAt":"1999-01-01T00:00:00Z"}`)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	if dto := decodeEntry(t, rec); dto.Day != "2026-08-22" {
		t.Errorf("day = %q, want 2026-08-22; the client's day was honoured", dto.Day)
	}

	stored := allEntries(t, db)
	if len(stored) != 1 {
		t.Fatalf("stored %d entries, want 1", len(stored))
	}
	if stored[0].Day != "2026-08-22" {
		t.Errorf("stored day = %q, want 2026-08-22", stored[0].Day)
	}
	if !stored[0].StartedAt.Equal(instant) {
		t.Errorf("stored startedAt = %v, want the server's instant %v", stored[0].StartedAt, instant)
	}
}

// TestPostEntryReadsTheClockOnce: day and started_at are stamped from a single
// instant. A second reading could fall the other side of midnight and file the
// entry on a day its own start time contradicts, so this clock moves a day
// forward on every call and the two fields are then checked against each other.
func TestPostEntryReadsTheClockOnce(t *testing.T) {
	srv, db, inst := serverInZone(t, "Pacific/Auckland",
		time.Date(2026, 8, 21, 13, 0, 0, 0, time.UTC))
	reads := 0
	srv.now = func() time.Time {
		reads++

		return time.Date(2026, 8, 20+reads, 13, 0, 0, 0, time.UTC)
	}

	rec := callEntries(t, srv, http.MethodPost, "/api/entries",
		`{"instanceId":`+strconv.FormatInt(inst.ID, 10)+`,"issueKey":"RIDGE-4929","seconds":900}`)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	if reads != 1 {
		t.Errorf("the handler read the clock %d times, want 1", reads)
	}

	stored := allEntries(t, db)
	if len(stored) != 1 {
		t.Fatalf("stored %d entries, want 1", len(stored))
	}
	if want := stored[0].StartedAt.In(srv.cfg.Location).Format("2006-01-02"); stored[0].Day != want {
		t.Errorf("day = %q but started_at falls on %q; the two came from different instants",
			stored[0].Day, want)
	}
}

// TestPostEntryAcceptsSecondsThatAreNotAMultipleOf900 pins the design's
// decision 8: the 15-minute grid belongs to the manual control, not to the
// resource, because #8's timer will produce a run of 7m13s. Tightening this
// fails here rather than breaking that ticket weeks later.
func TestPostEntryAcceptsSecondsThatAreNotAMultipleOf900(t *testing.T) {
	srv, db, inst := serverInZone(t, "Europe/Amsterdam",
		time.Date(2026, 8, 21, 12, 5, 0, 0, time.UTC))

	rec := callEntries(t, srv, http.MethodPost, "/api/entries",
		`{"instanceId":`+strconv.FormatInt(inst.ID, 10)+`,"issueKey":"RIDGE-4929","seconds":433}`)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	if dto := decodeEntry(t, rec); dto.Seconds != 433 {
		t.Errorf("seconds = %d, want 433 stored exactly as sent", dto.Seconds)
	}
	stored := allEntries(t, db)
	if len(stored) != 1 || stored[0].Seconds != 433 {
		t.Errorf("stored entries = %+v, want one of 433 seconds", stored)
	}
}

// TestPostEntryNamesAndPositionsTheInstance: the dialog paints the new entry's
// dot the moment the 201 comes back, from these two fields alone. A second
// instance is seeded so that a position hardcoded to 0 fails here too, and the
// entry is logged against that one.
func TestPostEntryNamesAndPositionsTheInstance(t *testing.T) {
	srv, db, _ := serverInZone(t, "Europe/Amsterdam",
		time.Date(2026, 8, 21, 12, 5, 0, 0, time.UTC))
	second := seedInstance(t, db, srv.sealer, "Personal", "https://personal.atlassian.net",
		"https://api.example")

	rec := callEntries(t, srv, http.MethodPost, "/api/entries",
		`{"instanceId":`+strconv.FormatInt(second.ID, 10)+`,"issueKey":"MISC-3","seconds":900}`)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	dto := decodeEntry(t, rec)
	if dto.InstanceName != "Personal" {
		t.Errorf("instanceName = %q, want Personal; the browser must not resolve the id",
			dto.InstanceName)
	}
	// instanceHue.ts keys the dot's colour off this index into the instance list.
	if dto.InstancePosition != 1 {
		t.Errorf("instancePosition = %d, want 1 in created_at order", dto.InstancePosition)
	}
}

// TestPostEntryRejectsInTheDocumentedOrder covers each rejection and, in the last
// two cases, the order between them: a body that is wrong in two ways must be
// reported by the earlier rule, which is what stops an unknown instance being
// reported as a bad duration.
func TestPostEntryRejectsInTheDocumentedOrder(t *testing.T) {
	for _, tc := range []struct {
		name       string
		body       string
		wantStatus int
		wantCode   string
	}{
		{"a malformed body", `{`, http.StatusBadRequest, "invalid_request"},
		{
			"a blank issue key", `{"instanceId":%d,"issueKey":"  ","seconds":900}`,
			http.StatusBadRequest, "invalid_request",
		},
		{
			"a missing instance id", `{"issueKey":"RIDGE-4929","seconds":900}`,
			http.StatusBadRequest, "invalid_request",
		},
		{
			"an unknown instance", `{"instanceId":404,"issueKey":"RIDGE-4929","seconds":900}`,
			http.StatusNotFound, "instance_not_found",
		},
		// Rule 1 before rule 2: a body wrong in both ways is the client's
		// malformed request, not a missing instance.
		{
			"a blank key on an unknown instance is the blank key",
			`{"instanceId":404,"issueKey":"","seconds":900}`,
			http.StatusBadRequest, "invalid_request",
		},
		// Rule 2 before rule 3: a duration is only checked against a real instance.
		{
			"a bad duration on an unknown instance is the unknown instance",
			`{"instanceId":404,"issueKey":"RIDGE-4929","seconds":0}`,
			http.StatusNotFound, "instance_not_found",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv, db, inst := serverInZone(t, "Europe/Amsterdam",
				time.Date(2026, 8, 21, 12, 5, 0, 0, time.UTC))
			body := strings.Replace(tc.body, "%d", strconv.FormatInt(inst.ID, 10), 1)

			rec := callEntries(t, srv, http.MethodPost, "/api/entries", body)

			assertRejected(t, rec, tc.wantStatus, tc.wantCode)
			if stored := allEntries(t, db); len(stored) != 0 {
				t.Errorf("stored %d entries, want none; a rejected POST wrote a row", len(stored))
			}
		})
	}
}

func TestPostEntryRejectsADurationOutsideTheDay(t *testing.T) {
	for _, tc := range []struct {
		name    string
		seconds int
		want    int
	}{
		{"zero", 0, http.StatusBadRequest},
		{"negative", -900, http.StatusBadRequest},
		{"over 24 hours", 86401, http.StatusBadRequest},
		{"exactly 24 hours", 86400, http.StatusCreated},
		{"one second", 1, http.StatusCreated},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv, _, inst := serverInZone(t, "Europe/Amsterdam",
				time.Date(2026, 8, 21, 12, 5, 0, 0, time.UTC))

			rec := callEntries(t, srv, http.MethodPost, "/api/entries",
				`{"instanceId":`+strconv.FormatInt(inst.ID, 10)+`,"issueKey":"RIDGE-4929","seconds":`+
					strconv.Itoa(tc.seconds)+`}`)

			if tc.want == http.StatusCreated {
				if rec.Code != http.StatusCreated {
					t.Fatalf("status = %d, want %d; body %s",
						rec.Code, http.StatusCreated, rec.Body.String())
				}

				return
			}
			assertRejected(t, rec, http.StatusBadRequest, "invalid_request")
		})
	}
}

// TestGetEntriesDefaultsToTodayInTheConfiguredZone: the rail calls a bare
// GET /api/entries, so the default range is where the day boundary reaches the
// read path. The clock is 13:00Z, which is the 21st in UTC and the 22nd in
// Auckland, and the entry on each of those days is seeded.
func TestGetEntriesDefaultsToTodayInTheConfiguredZone(t *testing.T) {
	srv, db, inst := serverInZone(t, "Pacific/Auckland",
		time.Date(2026, 8, 21, 13, 0, 0, 0, time.UTC))
	for _, seed := range []struct{ key, day string }{
		{"UTC-TODAY", "2026-08-21"},
		{"LOCAL-TODAY", "2026-08-22"},
		{"LOCAL-TOMORROW", "2026-08-23"},
	} {
		seedEntry(t, db, store.EntryInput{
			InstanceID: inst.ID, IssueKey: seed.key, Day: seed.day,
			StartedAt: time.Date(2026, 8, 21, 13, 0, 0, 0, time.UTC), Seconds: 900,
		})
	}

	rec := callEntries(t, srv, http.MethodGet, "/api/entries", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	body := decodeEntries(t, rec)
	if len(body) != 1 {
		t.Fatalf("got %d entries, want only the local day's; body %s", len(body), rec.Body.String())
	}
	if body[0].IssueKey != "LOCAL-TODAY" {
		t.Errorf("issueKey = %q, want LOCAL-TODAY; the default range was resolved in UTC",
			body[0].IssueKey)
	}
	// The list renders started_at in the configured zone, exactly as the single
	// entry responses do. #11's week grid reads this array, so an offset dropped
	// on the list path alone has to fail here.
	if body[0].StartedAt != "2026-08-22T01:00:00+12:00" {
		t.Errorf("startedAt = %q, want the stored instant in the configured zone", body[0].StartedAt)
	}
}

func TestGetEntriesFiltersAnInclusiveRangeOldestFirst(t *testing.T) {
	srv, db, inst := serverInZone(t, "Europe/Amsterdam",
		time.Date(2026, 8, 21, 12, 5, 0, 0, time.UTC))
	for _, seed := range []struct {
		key, day string
		started  time.Time
	}{
		{"BEFORE-1", "2026-08-18", time.Date(2026, 8, 18, 9, 0, 0, 0, time.UTC)},
		{"IN-3", "2026-08-20", time.Date(2026, 8, 20, 15, 0, 0, 0, time.UTC)},
		{"IN-2", "2026-08-20", time.Date(2026, 8, 20, 9, 0, 0, 0, time.UTC)},
		{"IN-1", "2026-08-19", time.Date(2026, 8, 19, 16, 0, 0, 0, time.UTC)},
		{"AFTER-1", "2026-08-21", time.Date(2026, 8, 21, 9, 0, 0, 0, time.UTC)},
	} {
		seedEntry(t, db, store.EntryInput{
			InstanceID: inst.ID, IssueKey: seed.key, Day: seed.day,
			StartedAt: seed.started, Seconds: 900,
		})
	}

	rec := callEntries(t, srv, http.MethodGet, "/api/entries?from=2026-08-19&to=2026-08-20", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	keys := []string{}
	for _, dto := range decodeEntries(t, rec) {
		keys = append(keys, dto.IssueKey)
	}
	// Both bounds are inclusive, and within a day the earlier start comes first.
	want := []string{"IN-1", "IN-2", "IN-3"}
	if strings.Join(keys, ",") != strings.Join(want, ",") {
		t.Errorf("keys = %v, want %v", keys, want)
	}
}

func TestGetEntriesNamesAndPositionsTheInstance(t *testing.T) {
	srv, db, first := serverInZone(t, "Europe/Amsterdam",
		time.Date(2026, 8, 21, 12, 5, 0, 0, time.UTC))
	second := seedInstance(t, db, srv.sealer, "Personal", "https://personal.atlassian.net",
		"https://api.example")
	for _, seed := range []struct {
		instanceID int64
		key        string
		started    time.Time
	}{
		{first.ID, "WORK-1", time.Date(2026, 8, 21, 9, 0, 0, 0, time.UTC)},
		{second.ID, "MISC-3", time.Date(2026, 8, 21, 10, 0, 0, 0, time.UTC)},
	} {
		seedEntry(t, db, store.EntryInput{
			InstanceID: seed.instanceID, IssueKey: seed.key, Day: "2026-08-21",
			StartedAt: seed.started, Seconds: 900,
		})
	}

	rec := callEntries(t, srv, http.MethodGet, "/api/entries", "")

	body := decodeEntries(t, rec)
	if len(body) != 2 {
		t.Fatalf("got %d entries, want 2; body %s", len(body), rec.Body.String())
	}
	if body[0].InstanceName != "Work" || body[1].InstanceName != "Personal" {
		t.Errorf("instanceName = %q/%q, want Work/Personal; the browser must not resolve the id",
			body[0].InstanceName, body[1].InstanceName)
	}
	// instanceHue.ts keys the rail's dot colour off this index.
	if body[0].InstancePosition != 0 || body[1].InstancePosition != 1 {
		t.Errorf("instancePosition = %d/%d, want 0/1 in created_at order",
			body[0].InstancePosition, body[1].InstancePosition)
	}
}

func TestGetEntriesWithNoneStoredIsAnEmptyArray(t *testing.T) {
	srv, _, _ := serverInZone(t, "Europe/Amsterdam",
		time.Date(2026, 8, 21, 12, 5, 0, 0, time.UTC))

	rec := callEntries(t, srv, http.MethodGet, "/api/entries", "")

	// Asserted on the raw body: decoding cannot tell [] from null, and the rail
	// iterates the array.
	if strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Errorf("body = %s, want []", rec.Body.String())
	}
}

func TestGetEntriesRejectsAMalformedRange(t *testing.T) {
	for _, tc := range []struct{ name, query string }{
		{"a from that is not a date", "?from=yesterday"},
		{"a to that is not a date", "?to=2026-13-01"},
		{"a day that does not exist", "?from=2026-02-30&to=2026-03-01"},
		{"an unpadded date", "?from=2026-8-1&to=2026-08-21"},
		{"a from after its to", "?from=2026-08-22&to=2026-08-21"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv, _, _ := serverInZone(t, "Europe/Amsterdam",
				time.Date(2026, 8, 21, 12, 5, 0, 0, time.UTC))

			rec := callEntries(t, srv, http.MethodGet, "/api/entries"+tc.query, "")

			assertRejected(t, rec, http.StatusBadRequest, "invalid_request")
		})
	}
}

// seedEntryForPatch stores an entry on a day far from the frozen clock's local
// today, so a mutation that re-stamps day or started_at from the clock cannot
// write back the value being asserted.
func seedEntryForPatch(t *testing.T, db *store.Store, inst *store.Instance) store.Entry {
	t.Helper()

	return seedEntry(t, db, store.EntryInput{
		InstanceID: inst.ID, IssueKey: "RIDGE-4929", Day: "2026-06-03",
		StartedAt: time.Date(2026, 6, 3, 8, 15, 0, 0, time.UTC), Seconds: 1800, Comment: "Refinement",
	})
}

func TestPatchEntryRewritesSecondsAndComment(t *testing.T) {
	srv, db, inst := serverInZone(t, "Pacific/Auckland",
		time.Date(2026, 8, 21, 13, 0, 0, 0, time.UTC))
	entry := seedEntryForPatch(t, db, inst)

	rec := callEntries(t, srv, http.MethodPatch, "/api/entries/"+strconv.FormatInt(entry.ID, 10),
		`{"seconds":2700,"comment":"Refinement and follow-up"}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	dto := decodeEntry(t, rec)
	if dto.Seconds != 2700 || dto.Comment != "Refinement and follow-up" {
		t.Errorf("seconds/comment = %d/%q, want 2700/%q",
			dto.Seconds, dto.Comment, "Refinement and follow-up")
	}

	stored := allEntries(t, db)
	if len(stored) != 1 {
		t.Fatalf("stored %d entries, want 1", len(stored))
	}
	if stored[0].Seconds != 2700 || stored[0].Comment != "Refinement and follow-up" {
		t.Errorf("stored seconds/comment = %d/%q; the response and the row disagree",
			stored[0].Seconds, stored[0].Comment)
	}
}

// TestPatchEntryNamesAndPositionsTheInstance: the edited row is repainted from
// the 200, so it needs the same join the 201 and the list carry. A second
// instance is seeded and the entry logged against it, so a position hardcoded
// to 0 fails here too.
func TestPatchEntryNamesAndPositionsTheInstance(t *testing.T) {
	srv, db, _ := serverInZone(t, "Pacific/Auckland",
		time.Date(2026, 8, 21, 13, 0, 0, 0, time.UTC))
	second := seedInstance(t, db, srv.sealer, "Personal", "https://personal.atlassian.net",
		"https://api.example")
	entry := seedEntry(t, db, store.EntryInput{
		InstanceID: second.ID, IssueKey: "MISC-3", Day: "2026-06-03",
		StartedAt: time.Date(2026, 6, 3, 8, 15, 0, 0, time.UTC), Seconds: 1800,
	})

	rec := callEntries(t, srv, http.MethodPatch,
		"/api/entries/"+strconv.FormatInt(entry.ID, 10), `{"seconds":2700}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	dto := decodeEntry(t, rec)
	if dto.InstanceName != "Personal" {
		t.Errorf("instanceName = %q, want Personal; the browser must not resolve the id",
			dto.InstanceName)
	}
	if dto.InstancePosition != 1 {
		t.Errorf("instancePosition = %d, want 1 in created_at order", dto.InstancePosition)
	}
}

// The start time is never editable, and moving an entry between days would let
// the browser rewrite history the server stamped. The fixture is dated 3 June
// while the frozen clock's local day is 22 August, so a handler re-stamping
// either field from the clock fails here.
func TestPatchEntryNeverMovesTheDayOrTheStartTime(t *testing.T) {
	srv, db, inst := serverInZone(t, "Pacific/Auckland",
		time.Date(2026, 8, 21, 13, 0, 0, 0, time.UTC))
	entry := seedEntryForPatch(t, db, inst)

	rec := callEntries(t, srv, http.MethodPatch, "/api/entries/"+strconv.FormatInt(entry.ID, 10),
		`{"seconds":2700}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	dto := decodeEntry(t, rec)
	if dto.Day != "2026-06-03" {
		t.Errorf("day = %q, want 2026-06-03 kept", dto.Day)
	}
	if dto.StartedAt != "2026-06-03T20:15:00+12:00" {
		t.Errorf("startedAt = %q, want the stored instant in the configured zone", dto.StartedAt)
	}

	stored := allEntries(t, db)
	if len(stored) != 1 {
		t.Fatalf("stored %d entries, want 1", len(stored))
	}
	if stored[0].Day != "2026-06-03" {
		t.Errorf("stored day = %q, want 2026-06-03 kept", stored[0].Day)
	}
	if !stored[0].StartedAt.Equal(entry.StartedAt) {
		t.Errorf("stored startedAt = %v, want %v kept", stored[0].StartedAt, entry.StartedAt)
	}
}

func TestPatchEntryKeepsTheFieldItWasNotSent(t *testing.T) {
	for _, tc := range []struct {
		name        string
		body        string
		wantSeconds int
		wantComment string
	}{
		{"seconds alone keeps the comment", `{"seconds":2700}`, 2700, "Refinement"},
		{"a comment alone keeps the seconds", `{"comment":"Rework"}`, 1800, "Rework"},
		{"an empty comment clears it", `{"comment":""}`, 1800, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv, db, inst := serverInZone(t, "Pacific/Auckland",
				time.Date(2026, 8, 21, 13, 0, 0, 0, time.UTC))
			entry := seedEntryForPatch(t, db, inst)

			rec := callEntries(t, srv, http.MethodPatch,
				"/api/entries/"+strconv.FormatInt(entry.ID, 10), tc.body)

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
			}
			stored := allEntries(t, db)
			if len(stored) != 1 {
				t.Fatalf("stored %d entries, want 1", len(stored))
			}
			if stored[0].Seconds != tc.wantSeconds {
				t.Errorf("stored seconds = %d, want %d", stored[0].Seconds, tc.wantSeconds)
			}
			if stored[0].Comment != tc.wantComment {
				t.Errorf("stored comment = %q, want %q", stored[0].Comment, tc.wantComment)
			}
		})
	}
}

// TestPatchEntryStoresNothingWhenTheInstanceReadFails pins the ordering
// handleCreatePin states outright: every read happens before anything is
// stored. Renaming the instances table away breaks the join the response needs
// while the entry's own row stays readable and writable, so a handler writing
// first would answer 500 with the edit already landed.
func TestPatchEntryStoresNothingWhenTheInstanceReadFails(t *testing.T) {
	srv, db, raw, inst := serverInZoneOverAKnownFile(t, "Pacific/Auckland",
		time.Date(2026, 8, 21, 13, 0, 0, 0, time.UTC))
	entry := seedEntryForPatch(t, db, inst)

	if _, err := raw.Exec(`ALTER TABLE instances RENAME TO instances_gone`); err != nil {
		t.Fatalf("renaming the instances table away: %v", err)
	}

	rec := callEntries(t, srv, http.MethodPatch,
		"/api/entries/"+strconv.FormatInt(entry.ID, 10), `{"seconds":2700,"comment":"Rework"}`)

	assertRejected(t, rec, http.StatusInternalServerError, "store_failed")
	stored := allEntries(t, db)
	if len(stored) != 1 {
		t.Fatalf("stored %d entries, want 1", len(stored))
	}
	if stored[0].Seconds != 1800 || stored[0].Comment != "Refinement" {
		t.Errorf("stored seconds/comment = %d/%q, want 1800/%q; the edit landed under a 500",
			stored[0].Seconds, stored[0].Comment, "Refinement")
	}
}

func TestPatchEntryRejectsABodyChangingNothing(t *testing.T) {
	srv, db, inst := serverInZone(t, "Pacific/Auckland",
		time.Date(2026, 8, 21, 13, 0, 0, 0, time.UTC))
	entry := seedEntryForPatch(t, db, inst)

	rec := callEntries(t, srv, http.MethodPatch,
		"/api/entries/"+strconv.FormatInt(entry.ID, 10), `{}`)

	assertRejected(t, rec, http.StatusBadRequest, "invalid_request")
	if stored := allEntries(t, db); stored[0].Seconds != 1800 || stored[0].Comment != "Refinement" {
		t.Errorf("stored entry = %+v, want it untouched by a rejected PATCH", stored[0])
	}
}

// TestPatchEntryRejectsADurationOutsideTheDay carries the accepting boundary as
// well as the rejecting one, because PATCH and POST share validEntrySeconds:
// the twin whose table stops one second short is the one a tightening to
// >= maxEntrySeconds slips through.
func TestPatchEntryRejectsADurationOutsideTheDay(t *testing.T) {
	for _, tc := range []struct {
		name    string
		seconds int
		want    int
	}{
		{"zero", 0, http.StatusBadRequest},
		{"negative", -900, http.StatusBadRequest},
		{"over 24 hours", 86401, http.StatusBadRequest},
		{"exactly 24 hours", 86400, http.StatusOK},
		{"one second", 1, http.StatusOK},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv, db, inst := serverInZone(t, "Pacific/Auckland",
				time.Date(2026, 8, 21, 13, 0, 0, 0, time.UTC))
			entry := seedEntryForPatch(t, db, inst)

			rec := callEntries(t, srv, http.MethodPatch,
				"/api/entries/"+strconv.FormatInt(entry.ID, 10),
				`{"seconds":`+strconv.Itoa(tc.seconds)+`}`)

			wantStored := 1800
			if tc.want == http.StatusOK {
				wantStored = tc.seconds
				if rec.Code != http.StatusOK {
					t.Fatalf("status = %d, want %d; body %s",
						rec.Code, http.StatusOK, rec.Body.String())
				}
			} else {
				assertRejected(t, rec, http.StatusBadRequest, "invalid_request")
			}
			if stored := allEntries(t, db); stored[0].Seconds != wantStored {
				t.Errorf("stored seconds = %d, want %d", stored[0].Seconds, wantStored)
			}
		})
	}
}

func TestPatchEntryRejectsAMalformedBody(t *testing.T) {
	srv, db, inst := serverInZone(t, "Pacific/Auckland",
		time.Date(2026, 8, 21, 13, 0, 0, 0, time.UTC))
	entry := seedEntryForPatch(t, db, inst)

	rec := callEntries(t, srv, http.MethodPatch,
		"/api/entries/"+strconv.FormatInt(entry.ID, 10), `{`)

	assertRejected(t, rec, http.StatusBadRequest, "invalid_request")
}

// TestPatchMissingEntryIsNotFound covers the id that does not exist and, in the
// second case, the order between a missing entry and a bad duration: PATCH
// mirrors POST, where a body wrong in both ways is reported by the row that
// isn't there rather than by the duration.
func TestPatchMissingEntryIsNotFound(t *testing.T) {
	for _, tc := range []struct{ name, body string }{
		{"a valid body on an unknown id", `{"seconds":900}`},
		{"a bad duration on an unknown id is the unknown id", `{"seconds":0}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv, _, _ := serverInZone(t, "Europe/Amsterdam",
				time.Date(2026, 8, 21, 12, 5, 0, 0, time.UTC))

			rec := callEntries(t, srv, http.MethodPatch, "/api/entries/999999", tc.body)

			assertRejected(t, rec, http.StatusNotFound, "entry_not_found")
		})
	}
}

// TestPatchEntryRejectsAnIDThatIsNotAPositiveInteger: ids are store-generated
// integers, so a garbled one is the client's mistake. 0 and a negative are the
// cases the handler's own message promises and the parse alone would let
// through — /api/entries/0 answering entry_not_found would contradict it.
func TestPatchEntryRejectsAnIDThatIsNotAPositiveInteger(t *testing.T) {
	for _, tc := range []struct{ name, id string }{
		{"a non-numeric id", "abc"},
		{"zero", "0"},
		{"a negative id", "-1"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv, _, _ := serverInZone(t, "Europe/Amsterdam",
				time.Date(2026, 8, 21, 12, 5, 0, 0, time.UTC))

			rec := callEntries(t, srv, http.MethodPatch, "/api/entries/"+tc.id, `{"seconds":900}`)

			assertRejected(t, rec, http.StatusBadRequest, "invalid_request")
		})
	}
}

func TestDeleteEntryRemovesIt(t *testing.T) {
	srv, db, inst := serverInZone(t, "Pacific/Auckland",
		time.Date(2026, 8, 21, 13, 0, 0, 0, time.UTC))
	entry := seedEntryForPatch(t, db, inst)

	rec := callEntries(t, srv, http.MethodDelete,
		"/api/entries/"+strconv.FormatInt(entry.ID, 10), "")

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, http.StatusNoContent, rec.Body.String())
	}
	if stored := allEntries(t, db); len(stored) != 0 {
		t.Errorf("stored %d entries after the delete, want 0", len(stored))
	}
}

func TestDeleteMissingEntryIsNotFound(t *testing.T) {
	srv, _, _ := serverInZone(t, "Europe/Amsterdam",
		time.Date(2026, 8, 21, 12, 5, 0, 0, time.UTC))

	rec := callEntries(t, srv, http.MethodDelete, "/api/entries/404", "")

	assertRejected(t, rec, http.StatusNotFound, "entry_not_found")
}

func TestDeleteEntryRejectsANonNumericID(t *testing.T) {
	srv, _, _ := serverInZone(t, "Europe/Amsterdam",
		time.Date(2026, 8, 21, 12, 5, 0, 0, time.UTC))

	rec := callEntries(t, srv, http.MethodDelete, "/api/entries/abc", "")

	assertRejected(t, rec, http.StatusBadRequest, "invalid_request")
}

func TestPushStateOfDerivesFromTheTwoColumnsAndUpdatedAt(t *testing.T) {
	base := time.Date(2026, 8, 31, 10, 0, 0, 0, time.UTC)
	pushed := base.Add(time.Minute)

	cases := []struct {
		name  string
		entry store.Entry
		want  string
	}{
		{
			name:  "never pushed",
			entry: store.Entry{UpdatedAt: base},
			want:  "unpushed",
		},
		{
			name:  "pushed and untouched since",
			entry: store.Entry{WorklogID: "10123", PushedAt: &pushed, UpdatedAt: base},
			want:  "pushed",
		},
		{
			name:  "edited after the push",
			entry: store.Entry{WorklogID: "10123", PushedAt: &base, UpdatedAt: pushed},
			want:  "dirty",
		},
		{
			name:  "pushed and edited in the same instant",
			entry: store.Entry{WorklogID: "10123", PushedAt: &base, UpdatedAt: base},
			want:  "pushed",
		},
		{
			name:  "worklog id without a pushed_at is not a push",
			entry: store.Entry{WorklogID: "10123", UpdatedAt: base},
			want:  "unpushed",
		},
		{
			name:  "a pushed_at without a worklog id is not a push",
			entry: store.Entry{PushedAt: &base, UpdatedAt: base},
			want:  "unpushed",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := pushStateOf(tc.entry); got != tc.want {
				t.Errorf("pushStateOf() = %q, want %q", got, tc.want)
			}
		})
	}
}
