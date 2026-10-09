package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"codeberg.org/DionGerrese/ThatApp/internal/config"
	"codeberg.org/DionGerrese/ThatApp/internal/crypto"
	"codeberg.org/DionGerrese/ThatApp/internal/store"
)

// serverInZone builds a server whose configured zone is zone and whose clock is
// frozen at instant. Both are needed together: the day an entry lands on is only
// provable when the machine's own clock and THAT_TIMEZONE disagree, and no test
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

	var body entriesResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decoding %s: %v", rec.Body.String(), err)
	}

	return body.Entries
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
			// wall clock the entry was made at without knowing THAT_TIMEZONE.
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

// TestPostEntryIgnoresAClientSuppliedStartedAt: #105 lets a create name its
// day, but started_at stays the server's alone — a body naming both, with a
// forged startedAt that disagrees with the named day, proves the day is
// honoured and the forged instant is not.
func TestPostEntryIgnoresAClientSuppliedStartedAt(t *testing.T) {
	instant := time.Date(2026, 8, 21, 13, 0, 0, 0, time.UTC)
	srv, db, inst := serverInZone(t, "Pacific/Auckland", instant)

	rec := callEntries(t, srv, http.MethodPost, "/api/entries",
		`{"instanceId":`+strconv.FormatInt(inst.ID, 10)+`,"issueKey":"RIDGE-4929","seconds":900,`+
			`"day":"2020-06-15","startedAt":"1999-01-01T00:00:00Z"}`)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	if dto := decodeEntry(t, rec); dto.Day != "2020-06-15" {
		t.Errorf("day = %q, want 2020-06-15; the named day was not honoured", dto.Day)
	}

	stored := allEntries(t, db)
	if len(stored) != 1 {
		t.Fatalf("stored %d entries, want 1", len(stored))
	}
	if stored[0].Day != "2020-06-15" {
		t.Errorf("stored day = %q, want 2020-06-15", stored[0].Day)
	}
	loc, err := time.LoadLocation("Pacific/Auckland")
	if err != nil {
		t.Fatalf("loading zone: %v", err)
	}
	wantStartedAt := time.Date(2020, 6, 15, 0, 0, 0, 0, loc)
	if !stored[0].StartedAt.Equal(wantStartedAt) {
		t.Errorf("stored startedAt = %v, want local midnight of the named day %v; "+
			"the forged startedAt was honoured instead", stored[0].StartedAt, wantStartedAt)
	}
}

// TestCreateEntryAcceptsADay is the test #105's Task 2 exists for: day absent
// still means today from one clock read, day present stamps local midnight of
// that day in THAT_TIMEZONE, and a date time.Parse cannot make sense of is
// rejected before anything is stored — the same rule dayParam already applies,
// so 2026-02-30 is a day out of range rather than 2 March.
func TestCreateEntryAcceptsADay(t *testing.T) {
	const zone = "Pacific/Auckland"
	// 13:00 UTC on the 21st is already 01:00 on the 22nd in Auckland — the
	// container's clock and the configured zone disagree, which is the whole
	// point of asserting an instant rather than a formatted string.
	instant := time.Date(2026, 8, 21, 13, 0, 0, 0, time.UTC)
	loc, err := time.LoadLocation(zone)
	if err != nil {
		t.Fatalf("loading zone %q: %v", zone, err)
	}

	for _, tc := range []struct {
		name          string
		day           string
		wantCode      string
		wantDay       string
		wantStartedAt time.Time
	}{
		{
			name:          "no day names today, stamped from the one clock read",
			wantDay:       "2026-08-22",
			wantStartedAt: instant,
		},
		{
			name:          "a past day stamps local midnight of that day in the zone",
			day:           "2026-01-05",
			wantDay:       "2026-01-05",
			wantStartedAt: time.Date(2026, 1, 5, 0, 0, 0, 0, loc),
		},
		{
			name:          "a day far in the past is legal",
			day:           "1901-03-09",
			wantDay:       "1901-03-09",
			wantStartedAt: time.Date(1901, 3, 9, 0, 0, 0, 0, loc),
		},
		{
			name:     "a malformed day is rejected",
			day:      "not-a-date",
			wantCode: "invalid_request",
		},
		{
			name:     "an impossible day is rejected rather than rolled forward",
			day:      "2026-02-30",
			wantCode: "invalid_request",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv, db, inst := serverInZone(t, zone, instant)

			body := `{"instanceId":` + strconv.FormatInt(inst.ID, 10) +
				`,"issueKey":"RIDGE-4929","seconds":900`
			if tc.day != "" {
				body += `,"day":"` + tc.day + `"`
			}
			body += `}`

			rec := callEntries(t, srv, http.MethodPost, "/api/entries", body)

			if tc.wantCode != "" {
				assertRejected(t, rec, http.StatusBadRequest, tc.wantCode)
				if stored := allEntries(t, db); len(stored) != 0 {
					t.Errorf("stored %d entries, want none; a rejected create wrote a row",
						len(stored))
				}

				return
			}

			if rec.Code != http.StatusCreated {
				t.Fatalf("status = %d, want %d; body %s",
					rec.Code, http.StatusCreated, rec.Body.String())
			}
			if dto := decodeEntry(t, rec); dto.Day != tc.wantDay {
				t.Errorf("day = %q, want %q", dto.Day, tc.wantDay)
			}

			stored := allEntries(t, db)
			if len(stored) != 1 {
				t.Fatalf("stored %d entries, want 1", len(stored))
			}
			if stored[0].Day != tc.wantDay {
				t.Errorf("stored day = %q, want %q", stored[0].Day, tc.wantDay)
			}
			if !stored[0].StartedAt.Equal(tc.wantStartedAt) {
				t.Errorf("stored startedAt = %v, want %v", stored[0].StartedAt, tc.wantStartedAt)
			}
		})
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

// TestListEntriesEnvelopeNamesTodayInTheConfiguredZone: the dialog needs a day
// to name itself by, and Today's dialog has no day of its own to name — so
// GET /api/entries answers with the date the server resolved, in
// THAT_TIMEZONE, wrapping the same entries the bare array used to hold. The
// clock sits at 13:00 UTC, already the 22nd in Auckland, so a UTC-only
// reading of "today" would name the wrong day.
func TestListEntriesEnvelopeNamesTodayInTheConfiguredZone(t *testing.T) {
	srv, db, inst := serverInZone(t, "Pacific/Auckland",
		time.Date(2026, 8, 21, 13, 0, 0, 0, time.UTC))
	seedEntry(t, db, store.EntryInput{
		InstanceID: inst.ID, IssueKey: "LOCAL-TODAY", Day: "2026-08-22",
		StartedAt: time.Date(2026, 8, 21, 13, 0, 0, 0, time.UTC), Seconds: 900,
	})

	rec := callEntries(t, srv, http.MethodGet, "/api/entries", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var envelope entriesResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decoding %s: %v", rec.Body.String(), err)
	}
	if envelope.Today != "2026-08-22" {
		t.Errorf("today = %q, want 2026-08-22, the date in the configured zone", envelope.Today)
	}
	if len(envelope.Entries) != 1 || envelope.Entries[0].IssueKey != "LOCAL-TODAY" {
		t.Fatalf("entries = %v, want the one seeded entry", envelope.Entries)
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
	want := `{"today":"2026-08-21","entries":[]}`
	if strings.TrimSpace(rec.Body.String()) != want {
		t.Errorf("body = %s, want %s", rec.Body.String(), want)
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

// TestPatchEntryRefusesDayAndStartedAt: #105's Task 2 gave POST a day field.
// updateEntryRequest gained none of its own, so a PATCH body forging both is
// silently dropped by json.Decode rather than the handler rejecting it — this
// guards that PATCH stayed untouched now that POST can move where an entry
// lands.
func TestPatchEntryRefusesDayAndStartedAt(t *testing.T) {
	srv, db, inst := serverInZone(t, "Pacific/Auckland",
		time.Date(2026, 8, 21, 13, 0, 0, 0, time.UTC))
	entry := seedEntryForPatch(t, db, inst)

	rec := callEntries(t, srv, http.MethodPatch, "/api/entries/"+strconv.FormatInt(entry.ID, 10),
		`{"seconds":2700,"day":"1999-01-01","startedAt":"1999-01-01T00:00:00Z"}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	dto := decodeEntry(t, rec)
	if dto.Day != "2026-06-03" {
		t.Errorf("day = %q, want 2026-06-03; the forged day was honoured", dto.Day)
	}
	if dto.StartedAt != "2026-06-03T20:15:00+12:00" {
		t.Errorf("startedAt = %q, want the stored instant; the forged startedAt was honoured",
			dto.StartedAt)
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
		{"invalid JSON on an unknown id is the unknown id", "not json"},
		{"an empty body on an unknown id is the unknown id", "{}"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv, _, _ := serverInZone(t, "Europe/Amsterdam",
				time.Date(2026, 8, 21, 12, 5, 0, 0, time.UTC))

			rec := callEntries(t, srv, http.MethodPatch, "/api/entries/999999", tc.body)

			assertRejected(t, rec, http.StatusNotFound, "not_found")
		})
	}
}

// TestPatchEntryAnswersAnIDThatIsNotAPositiveIntegerAsMissing: ids that are
// not positive integers name no entry, so they answer as a missing one does
// (#55).
func TestPatchEntryAnswersAnIDThatIsNotAPositiveIntegerAsMissing(t *testing.T) {
	for _, tc := range []struct{ name, id string }{
		{"a non-numeric id", "abc"},
		{"zero", "0"},
		{"a negative id", "-1"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv, _, _ := serverInZone(t, "Europe/Amsterdam",
				time.Date(2026, 8, 21, 12, 5, 0, 0, time.UTC))

			rec := callEntries(t, srv, http.MethodPatch, "/api/entries/"+tc.id, `{"seconds":900}`)

			assertRejected(t, rec, http.StatusNotFound, "not_found")
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

	assertRejected(t, rec, http.StatusNotFound, "not_found")
}

func TestDeleteEntryAnswersANonNumericIDAsMissing(t *testing.T) {
	srv, _, _ := serverInZone(t, "Europe/Amsterdam",
		time.Date(2026, 8, 21, 12, 5, 0, 0, time.UTC))

	rec := callEntries(t, srv, http.MethodDelete, "/api/entries/abc", "")

	assertRejected(t, rec, http.StatusNotFound, "not_found")
}

func TestPushStateOfDerivesFromTheTwoColumnsAndUpdatedAt(t *testing.T) {
	base := time.Date(2026, 8, 31, 10, 0, 0, 0, time.UTC)
	pushed := base.Add(time.Minute)
	deleted := base.Add(2 * time.Minute)

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
			// The mark a push withholds when an edit lands while Jira is
			// answering. The worklog exists and what it holds is stale, which
			// is dirty exactly — and reading it as unpushed is what had the
			// next push create a second worklog for the same entry.
			name:  "a worklog id with no pushed_at is dirty",
			entry: store.Entry{WorklogID: "10123", UpdatedAt: base},
			want:  "dirty",
		},
		{
			name:  "a pushed_at without a worklog id is not a push",
			entry: store.Entry{PushedAt: &base, UpdatedAt: base},
			want:  "unpushed",
		},
		{
			name:  "pushed, then deleted",
			entry: store.Entry{WorklogID: "10123", PushedAt: &pushed, UpdatedAt: base, DeletedAt: &deleted},
			want:  "deleted",
		},
		{
			// Whatever Jira holds, the push's next act is to delete it.
			name:  "edited after the push, then deleted",
			entry: store.Entry{WorklogID: "10123", PushedAt: &base, UpdatedAt: pushed, DeletedAt: &deleted},
			want:  "deleted",
		},
		{
			name:  "a worklog id with no pushed_at, then deleted",
			entry: store.Entry{WorklogID: "10123", UpdatedAt: base, DeletedAt: &deleted},
			want:  "deleted",
		},
		{
			// An unpushed delete removes the row, so this row should not exist;
			// if it does, Jira holds nothing and the push must still create.
			name:  "a deleted_at without a worklog id is not a pending delete",
			entry: store.Entry{UpdatedAt: base, DeletedAt: &deleted},
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

// entriesEnv wires a server to a single fake-Jira instance whose worklog
// DELETE response a test can steer, mirroring pushEnv's shape in push_test.go
// for the same reason: DELETE /api/entries needs a Jira double the way POST
// /api/push does.
type entriesEnv struct {
	s     *Server
	store *store.Store
	inst  *store.Instance
	jira  *deletableJira
}

// deletableJira answers every worklog DELETE with deleteStatus and counts how
// many it saw, which is what proves an unpushed entry asked Jira nothing.
type deletableJira struct {
	deleteStatus int
	deleteCalls  int
}

func newEntriesEnv(t *testing.T) *entriesEnv {
	t.Helper()

	env := &entriesEnv{jira: &deletableJira{deleteStatus: http.StatusNoContent}}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete && strings.Contains(r.URL.Path, "/worklog/") {
			env.jira.deleteCalls++
			w.WriteHeader(env.jira.deleteStatus)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(srv.Close)

	s, db, sealer := newServerWithStore(t)
	env.s = s
	env.store = db
	env.inst = seedInstance(t, db, sealer, "Work", "", srv.URL)

	return env
}

func (env *entriesEnv) createEntry(t *testing.T, issueKey string, seconds int, comment string) store.Entry {
	t.Helper()

	entry, err := env.store.CreateEntry(context.Background(), store.EntryInput{
		InstanceID: env.inst.ID,
		IssueKey:   issueKey,
		Day:        "2026-08-31",
		StartedAt:  time.Date(2026, 8, 31, 9, 0, 0, 0, time.UTC),
		Seconds:    seconds,
		Comment:    comment,
	})
	if err != nil {
		t.Fatalf("seeding entry: %v", err)
	}

	return *entry
}

// markPushed records worklogID as already delivered, without going through a
// real push — standing in for an entry pushed on some earlier day.
func (env *entriesEnv) markPushed(t *testing.T, entryID int64, worklogID string) {
	t.Helper()

	entry, err := env.store.Entry(context.Background(), entryID)
	if err != nil {
		t.Fatalf("reading entry %d to mark it pushed: %v", entryID, err)
	}

	ok, err := env.store.RecordWorklogMarkingPushedIfUnchanged(
		context.Background(), entryID, worklogID, entry.UpdatedAt, entry.UpdatedAt,
	)
	if err != nil {
		t.Fatalf("marking entry %d pushed: %v", entryID, err)
	}
	if !ok {
		t.Fatalf("marking entry %d pushed: guard rejected the write", entryID)
	}
}

func (env *entriesEnv) delete(t *testing.T, entryID int64) *httptest.ResponseRecorder {
	t.Helper()

	return callEntries(t, env.s, http.MethodDelete,
		"/api/entries/"+strconv.FormatInt(entryID, 10), "")
}

func (env *entriesEnv) restore(t *testing.T, entryID int64) *httptest.ResponseRecorder {
	t.Helper()

	return callEntries(t, env.s, http.MethodPost,
		"/api/entries/"+strconv.FormatInt(entryID, 10)+"/restore", "")
}

// stored reads one entry back, failing the test if it is gone.
func (env *entriesEnv) stored(t *testing.T, entryID int64) store.Entry {
	t.Helper()

	entry, err := env.store.Entry(t.Context(), entryID)
	if err != nil {
		t.Fatalf("reading entry %d back: %v", entryID, err)
	}

	return *entry
}

// #280: a delete waits for the push like every other change to Jira. Only an
// entry Jira has never seen goes at once; one it holds is marked, and Jira
// hears nothing until the push.
func TestDeleteEntryWaitsForPush(t *testing.T) {
	tests := []struct {
		name        string
		pushed      bool
		dirty       bool
		wantRowGone bool
	}{
		{name: "an unpushed entry goes at once", wantRowGone: true},
		{name: "a pushed entry is marked", pushed: true},
		{name: "an entry edited since its push is marked", pushed: true, dirty: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			env := newEntriesEnv(t)
			entry := env.createEntry(t, "RID-1", 3600, "")
			if test.pushed {
				env.markPushed(t, entry.ID, "10001")
			}
			if test.dirty {
				makeEntryDirty(t, env.store, entry.ID, 5400, "reworded")
			}

			rec := env.delete(t, entry.ID)

			if rec.Code != http.StatusNoContent {
				t.Fatalf("status = %d, want 204 (body %s)", rec.Code, rec.Body)
			}
			if env.jira.deleteCalls != 0 {
				t.Fatalf("Jira saw %d deletes, want none: a delete waits for the push", env.jira.deleteCalls)
			}

			after, err := env.store.Entry(t.Context(), entry.ID)
			gone := errors.Is(err, sql.ErrNoRows)
			if gone != test.wantRowGone {
				t.Fatalf("row gone = %v, want %v", gone, test.wantRowGone)
			}
			if gone {
				return
			}
			if got := pushStateOf(*after); got != "deleted" {
				t.Fatalf("state = %q, want deleted", got)
			}
		})
	}
}

func TestListEntriesCarriesAPendingDelete(t *testing.T) {
	env := newEntriesEnv(t)
	entry := env.createEntry(t, "RID-1", 3600, "")
	env.markPushed(t, entry.ID, "10001")
	env.delete(t, entry.ID)

	got := decodeEntries(t, callEntries(t, env.s, http.MethodGet,
		"/api/entries?from=2026-08-31&to=2026-08-31", ""))

	if len(got) != 1 || got[0].PushState != "deleted" {
		t.Fatalf("entries = %+v, want the one entry, pushState deleted", got)
	}
}

func TestDeletingAPendingDeleteAgainChangesNothing(t *testing.T) {
	env := newEntriesEnv(t)
	entry := env.createEntry(t, "RID-1", 3600, "")
	env.markPushed(t, entry.ID, "10001")

	first := time.Date(2026, 8, 31, 17, 0, 0, 0, time.UTC)
	env.s.now = func() time.Time { return first }
	env.delete(t, entry.ID)

	env.s.now = func() time.Time { return first.Add(time.Hour) }
	rec := env.delete(t, entry.ID)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("second delete status = %d, want 204", rec.Code)
	}
	if after := env.stored(t, entry.ID); after.DeletedAt == nil || !after.DeletedAt.Equal(first) {
		t.Fatalf("DeletedAt = %v, want the first delete's %v", after.DeletedAt, first)
	}
	if env.jira.deleteCalls != 0 {
		t.Fatalf("Jira saw %d deletes, want none", env.jira.deleteCalls)
	}
}

// Restore is what makes the deferred delete safe to offer. The state comes back
// because the delete wrote nothing but the mark — Task 1 pins that at the
// store; this pins it through the two requests a person makes.
func TestRestoreReturnsTheEarlierPushState(t *testing.T) {
	for _, tc := range []struct {
		name  string
		dirty bool
		want  string
	}{
		{"a pushed entry comes back pushed", false, "pushed"},
		{"an edited entry comes back dirty", true, "dirty"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			env := newEntriesEnv(t)
			entry := env.createEntry(t, "RID-1", 3600, "")
			env.markPushed(t, entry.ID, "10001")
			if tc.dirty {
				makeEntryDirty(t, env.store, entry.ID, 5400, "reworded")
			}
			before := env.stored(t, entry.ID)
			env.delete(t, entry.ID)

			rec := env.restore(t, entry.ID)

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body)
			}
			if got := decodeEntry(t, rec); got.ID != entry.ID || got.PushState != tc.want {
				t.Fatalf("restored %+v, want entry %d in state %s", got, entry.ID, tc.want)
			}
			after := env.stored(t, entry.ID)
			if after.DeletedAt != nil {
				t.Errorf("DeletedAt = %v after the restore, want nil", *after.DeletedAt)
			}
			if !after.UpdatedAt.Equal(before.UpdatedAt) {
				t.Errorf("UpdatedAt = %v, want %v untouched", after.UpdatedAt, before.UpdatedAt)
			}
			if env.jira.deleteCalls != 0 {
				t.Errorf("Jira saw %d deletes, want none", env.jira.deleteCalls)
			}
		})
	}
}

func TestRestoreAMissingEntryIsNotFound(t *testing.T) {
	env := newEntriesEnv(t)

	for _, target := range []string{"/api/entries/404/restore", "/api/entries/abc/restore"} {
		t.Run(target, func(t *testing.T) {
			assertRejected(t, callEntries(t, env.s, http.MethodPost, target, ""),
				http.StatusNotFound, "not_found")
		})
	}
}

func TestRestoreRefusesAnEntryNotWaitingToBeDeleted(t *testing.T) {
	for _, tc := range []struct {
		name   string
		pushed bool
	}{
		{"an unpushed entry", false},
		{"a pushed entry never deleted", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			env := newEntriesEnv(t)
			entry := env.createEntry(t, "RID-1", 3600, "")
			if tc.pushed {
				env.markPushed(t, entry.ID, "10001")
			}

			assertRejected(t, env.restore(t, entry.ID), http.StatusConflict, "entry_not_pending_delete")
		})
	}
}

func TestPatchAPendingDeleteIsAConflict(t *testing.T) {
	env := newEntriesEnv(t)
	entry := env.createEntry(t, "RID-1", 3600, "first go")
	env.markPushed(t, entry.ID, "10001")
	env.delete(t, entry.ID)
	before := env.stored(t, entry.ID)

	rec := callEntries(t, env.s, http.MethodPatch,
		"/api/entries/"+strconv.FormatInt(entry.ID, 10), `{"seconds":1800}`)

	assertRejected(t, rec, http.StatusConflict, "entry_pending_delete")
	after := env.stored(t, entry.ID)
	if after.Seconds != 3600 || !after.UpdatedAt.Equal(before.UpdatedAt) {
		t.Fatalf("entry = %ds updated %v, want 3600s and %v untouched",
			after.Seconds, after.UpdatedAt, before.UpdatedAt)
	}
}

// Review focus 1. A push deletes the worklog and then the row under pushMu; a
// restore landing between the two would answer 200 for a row about to vanish.
// The lock is held here by hand, standing in for that push.
func TestRestoreWaitsForTheLockAPushHolds(t *testing.T) {
	env := newEntriesEnv(t)
	entry := env.createEntry(t, "RID-1", 3600, "")
	env.markPushed(t, entry.ID, "10001")
	env.delete(t, entry.ID)

	env.s.pushMu.Lock()
	answered := make(chan int, 1)
	go func() {
		rec := httptest.NewRecorder()
		env.s.ServeHTTP(rec, httptest.NewRequest(http.MethodPost,
			"/api/entries/"+strconv.FormatInt(entry.ID, 10)+"/restore", nil))
		answered <- rec.Code
	}()

	select {
	case code := <-answered:
		env.s.pushMu.Unlock()
		t.Fatalf("restore answered %d while a push held the lock", code)
	case <-time.After(200 * time.Millisecond):
	}

	if err := env.store.DeleteEntry(t.Context(), entry.ID); err != nil {
		t.Fatalf("deleting the row as the push would: %v", err)
	}
	env.s.pushMu.Unlock()

	select {
	case code := <-answered:
		if code != http.StatusNotFound {
			t.Fatalf("restore = %d, want 404: the push removed the row first", code)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the restore never answered")
	}
}
