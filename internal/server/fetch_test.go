package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/dgerrese/ThatApp/internal/crypto"
	"github.com/dgerrese/ThatApp/internal/store"
)

// testStartedLayout duplicates jira's unexported startedLayout: the format is
// part of Jira's wire contract, not this package's, so the double has to spell
// it out itself rather than reach into an internal constant.
const testStartedLayout = "2006-01-02T15:04:05.000-0700"

// rawWorklog is one worklog as fetchJiraServer hands it back, before it is
// rendered into the JSON shape IssueWorklogs decodes.
type rawWorklog struct {
	id        string
	accountID string
	started   time.Time
	updated   time.Time
	seconds   int64
}

// fetchJiraServer stands in for one Jira site across the three calls a week
// fetch makes: identity, the issue search, and each issue's worklog list.
//
// It is a third shape of the same idea as fakeJira/failingJira in push_test.go
// and jiraSearchServer in issues_test.go, extended rather than duplicated
// because this handler is the first to need all three endpoints from one
// double.
type fetchJiraServer struct {
	t *testing.T

	accountID    string
	searchStatus int
	searchIssues []string
	worklogs     map[string][]rawWorklog
	// worklogStatus overrides one issue's worklog read to fail, so a test can
	// prove what happens to an instance's earlier issues when a later one does.
	worklogStatus map[string]int
	// onWorklogRead runs before an issue's worklogs are answered, which is the
	// window a fetch's read of local state sits open across. A test lands an
	// edit there to prove the write that follows is guarded on what was read.
	onWorklogRead func(issueKey string)

	lastSearchJQL string
}

func newFetchJiraServer(t *testing.T, accountID string) *fetchJiraServer {
	t.Helper()

	return &fetchJiraServer{
		t: t, accountID: accountID, searchStatus: http.StatusOK,
		worklogs: map[string][]rawWorklog{},
	}
}

func (f *fetchJiraServer) start() *httptest.Server {
	f.t.Helper()

	srv := httptest.NewServer(http.HandlerFunc(f.handle))
	f.t.Cleanup(srv.Close)

	return srv
}

func (f *fetchJiraServer) handle(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.URL.Path == "/rest/api/3/myself":
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"accountId": f.accountID, "displayName": "Me", "active": true,
		})

	case r.URL.Path == "/rest/api/3/search/jql":
		var body struct {
			JQL string `json:"jql"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			f.t.Fatalf("decoding the search request body: %v", err)
		}
		f.lastSearchJQL = body.JQL

		if f.searchStatus != http.StatusOK {
			w.WriteHeader(f.searchStatus)
			return
		}

		issues := make([]map[string]any, 0, len(f.searchIssues))
		for _, key := range f.searchIssues {
			issues = append(issues, map[string]any{"key": key, "fields": map[string]any{
				"summary": "x", "status": map[string]any{"name": "To Do"},
			}})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"issues": issues})

	case strings.HasPrefix(r.URL.Path, "/rest/api/3/issue/") && strings.HasSuffix(r.URL.Path, "/worklog"):
		key := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/rest/api/3/issue/"), "/worklog")
		if f.onWorklogRead != nil {
			f.onWorklogRead(key)
		}
		if status, failing := f.worklogStatus[key]; failing {
			w.WriteHeader(status)
			return
		}
		logs := f.worklogs[key]

		type rawEntry struct {
			ID     string `json:"id"`
			Author struct {
				AccountID string `json:"accountId"`
			} `json:"author"`
			Started          string `json:"started"`
			TimeSpentSeconds int64  `json:"timeSpentSeconds"`
			Updated          string `json:"updated"`
		}

		entries := make([]rawEntry, 0, len(logs))
		for _, l := range logs {
			var e rawEntry
			e.ID = l.id
			e.Author.AccountID = l.accountID
			e.Started = l.started.Format(testStartedLayout)
			e.TimeSpentSeconds = l.seconds
			e.Updated = l.updated.Format(testStartedLayout)
			entries = append(entries, e)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"startAt": 0, "maxResults": len(entries) + 1, "total": len(entries), "worklogs": entries,
		})

	default:
		f.t.Errorf("unexpected path %q", r.URL.Path)
		w.WriteHeader(http.StatusNotFound)
	}
}

// fetchEnv builds a server whose zone and clock are fixed, with no instance
// seeded — every fetch test seeds its own instance(s), pointed at a
// fetchJiraServer rather than at the fixed stub serverInZone wires up.
func fetchEnv(t *testing.T, zone string, instant time.Time) (*Server, *store.Store, *crypto.Sealer) {
	t.Helper()

	s, db, sealer := newServerWithStore(t)
	loc, err := time.LoadLocation(zone)
	if err != nil {
		t.Fatalf("loading zone %q: %v", zone, err)
	}
	s.cfg.Location = loc
	s.now = func() time.Time { return instant }

	return s, db, sealer
}

// markEntryPushed records worklogID as already delivered, mirroring
// pushEnv.markPushed in push_test.go without requiring a pushEnv, and returns
// the row as the store now holds it.
func markEntryPushed(t *testing.T, db *store.Store, entryID int64, worklogID string) store.Entry {
	t.Helper()

	entry, err := db.Entry(context.Background(), entryID)
	if err != nil {
		t.Fatalf("reading entry %d to mark it pushed: %v", entryID, err)
	}

	ok, err := db.RecordWorklogMarkingPushedIfUnchanged(
		context.Background(), entryID, worklogID, entry.UpdatedAt, entry.UpdatedAt,
	)
	if err != nil || !ok {
		t.Fatalf("marking entry %d pushed: ok=%v err=%v", entryID, ok, err)
	}

	after, err := db.Entry(context.Background(), entryID)
	if err != nil {
		t.Fatalf("re-reading entry %d: %v", entryID, err)
	}

	return *after
}

// makeEntryDirty edits an entry so it reads dirty. The sleep crosses the
// second boundary pushed_at and updated_at are both truncated to — without it
// an edit made in the same second as markEntryPushed's write could tie rather
// than beat it, and pushStateOf would read the entry as clean. See
// pushEnv.editEntry in push_test.go for the same reasoning.
func makeEntryDirty(t *testing.T, db *store.Store, entryID int64, seconds int, comment string) store.Entry {
	t.Helper()

	time.Sleep(1100 * time.Millisecond)

	updated, err := db.UpdateEntry(context.Background(), entryID, seconds, comment)
	if err != nil {
		t.Fatalf("editing entry %d: %v", entryID, err)
	}

	return *updated
}

func callFetchWeek(t *testing.T, srv *Server, target string) *httptest.ResponseRecorder {
	t.Helper()

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, target, nil))

	return rec
}

func decodeFetchWeek(t *testing.T, rec *httptest.ResponseRecorder) fetchResponseDTO {
	t.Helper()

	var dto fetchResponseDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &dto); err != nil {
		t.Fatalf("decoding %s: %v", rec.Body.String(), err)
	}

	return dto
}

func TestFetchWeekCreatesUpdatesAndKeepsLocal(t *testing.T) {
	loc, err := time.LoadLocation("Europe/Amsterdam")
	if err != nil {
		t.Fatalf("loading zone: %v", err)
	}

	jiraSrv := newFetchJiraServer(t, "me-1")
	jiraSrv.searchIssues = []string{"WORK-1"}
	srv := jiraSrv.start()

	s, db, sealer := fetchEnv(t, "Europe/Amsterdam", time.Date(2026, 9, 2, 12, 0, 0, 0, time.UTC))
	inst := seedInstance(t, db, sealer, "Work", "", srv.URL)

	// wl-B: a clean local entry, older than the remote copy, so Jira's version
	// wins.
	clean := seedEntry(t, db, store.EntryInput{
		InstanceID: inst.ID, IssueKey: "WORK-1", Day: "2026-09-02",
		StartedAt: time.Date(2026, 9, 2, 9, 0, 0, 0, loc), Seconds: 1800, Comment: "old",
	})
	cleanAfterMark := markEntryPushed(t, db, clean.ID, "wl-B")

	// wl-C: a dirty local entry — an edit typed and never pushed — which must
	// survive the fetch untouched regardless of what Jira says.
	dirty := seedEntry(t, db, store.EntryInput{
		InstanceID: inst.ID, IssueKey: "WORK-1", Day: "2026-09-03",
		StartedAt: time.Date(2026, 9, 3, 9, 0, 0, 0, loc), Seconds: 2400, Comment: "typed",
	})
	markEntryPushed(t, db, dirty.ID, "wl-C")
	makeEntryDirty(t, db, dirty.ID, 2400, "typed, not yet pushed")

	jiraSrv.worklogs["WORK-1"] = []rawWorklog{
		{ // wl-A: no local entry claims it.
			id: "wl-A", accountID: "me-1",
			started: time.Date(2026, 9, 1, 10, 0, 0, 0, loc),
			updated: time.Date(2026, 9, 1, 10, 0, 0, 0, loc),
			seconds: 3600,
		},
		{
			id: "wl-B", accountID: "me-1",
			started: time.Date(2026, 9, 2, 9, 0, 0, 0, loc),
			updated: cleanAfterMark.UpdatedAt.Add(time.Hour),
			seconds: 5400,
		},
		{
			id: "wl-C", accountID: "me-1",
			started: time.Date(2026, 9, 3, 9, 0, 0, 0, loc),
			updated: time.Date(2026, 9, 3, 9, 0, 0, 0, loc),
			seconds: 999,
		},
	}

	rec := callFetchWeek(t, s, "/api/week/fetch?start=2026-08-31")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	body := decodeFetchWeek(t, rec)

	if body.Created != 1 {
		t.Errorf("created = %d, want 1", body.Created)
	}
	if body.Updated != 1 {
		t.Errorf("updated = %d, want 1", body.Updated)
	}
	if len(body.KeptLocal) != 1 {
		t.Fatalf("keptLocal = %+v, want one member", body.KeptLocal)
	}
	if body.KeptLocal[0].Day != "2026-09-03" || body.KeptLocal[0].IssueKey != "WORK-1" {
		t.Errorf("keptLocal[0] = %+v, want day 2026-09-03 on WORK-1", body.KeptLocal[0])
	}

	after, err := db.Entry(context.Background(), dirty.ID)
	if err != nil {
		t.Fatalf("re-reading the dirty entry: %v", err)
	}
	if after.Seconds != 2400 || after.Comment != "typed, not yet pushed" {
		t.Errorf("dirty entry = %ds %q, want the edit untouched", after.Seconds, after.Comment)
	}
}

// TestFetchWeekFiltersByAuthorAndDay is the test a UTC-based day filter would
// fail: two of the four worklogs start within a couple of hours of local
// midnight, where the UTC calendar day and the Amsterdam one disagree.
func TestFetchWeekFiltersByAuthorAndDay(t *testing.T) {
	jiraSrv := newFetchJiraServer(t, "me-1")
	jiraSrv.searchIssues = []string{"WORK-1"}
	srv := jiraSrv.start()

	s, db, sealer := fetchEnv(t, "Europe/Amsterdam", time.Date(2026, 9, 2, 12, 0, 0, 0, time.UTC))
	seedInstance(t, db, sealer, "Work", "", srv.URL)

	jiraSrv.worklogs["WORK-1"] = []rawWorklog{
		{ // another author's time, well inside the week.
			id: "wl-other", accountID: "someone-else",
			started: time.Date(2026, 9, 2, 10, 0, 0, 0, time.UTC),
			updated: time.Date(2026, 9, 2, 10, 0, 0, 0, time.UTC),
			seconds: 600,
		},
		{ // the day before the week starts, no midnight ambiguity involved.
			id: "wl-before", accountID: "me-1",
			started: time.Date(2026, 8, 30, 10, 0, 0, 0, time.UTC),
			updated: time.Date(2026, 8, 30, 10, 0, 0, 0, time.UTC),
			seconds: 600,
		},
		{ // 2026-09-06T22:30Z is 2026-09-07T00:30 CEST: the day after the week
			// in Amsterdam, but still "2026-09-06" — the last day of the week —
			// read in UTC. A UTC-based filter would wrongly keep this one.
			id: "wl-after", accountID: "me-1",
			started: time.Date(2026, 9, 6, 22, 30, 0, 0, time.UTC),
			updated: time.Date(2026, 9, 6, 22, 30, 0, 0, time.UTC),
			seconds: 600,
		},
		{ // 2026-08-30T23:00Z is 2026-08-31T01:00 CEST: the Monday the week
			// starts on, but still "2026-08-30" — the day before it — read in
			// UTC. A UTC-based filter would wrongly drop this one, the only
			// worklog that should survive.
			id: "wl-inside", accountID: "me-1",
			started: time.Date(2026, 8, 30, 23, 0, 0, 0, time.UTC),
			updated: time.Date(2026, 8, 30, 23, 0, 0, 0, time.UTC),
			seconds: 700,
		},
	}

	rec := callFetchWeek(t, s, "/api/week/fetch?start=2026-08-31")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	body := decodeFetchWeek(t, rec)

	if body.Created != 1 {
		t.Fatalf("created = %d, want 1 — only wl-inside qualifies", body.Created)
	}

	entries := allEntries(t, db)
	if len(entries) != 1 {
		t.Fatalf("stored %d entries, want 1", len(entries))
	}
	if entries[0].WorklogID != "wl-inside" || entries[0].Day != "2026-08-31" || entries[0].Seconds != 700 {
		t.Errorf("stored entry = %+v, want wl-inside on 2026-08-31 for 700s", entries[0])
	}

	if !strings.Contains(jiraSrv.lastSearchJQL, `worklogDate >= "2026-08-30"`) {
		t.Errorf("search JQL = %q, want worklogDate >= 2026-08-30 (a day before start)", jiraSrv.lastSearchJQL)
	}
	if !strings.Contains(jiraSrv.lastSearchJQL, `worklogDate <= "2026-09-07"`) {
		t.Errorf("search JQL = %q, want worklogDate <= 2026-09-07 (a day after end)", jiraSrv.lastSearchJQL)
	}
}

func TestFetchWeekAppliesOneInstanceWhenAnotherRefuses(t *testing.T) {
	good := newFetchJiraServer(t, "me-1")
	good.searchIssues = []string{"WORK-1"}
	good.worklogs["WORK-1"] = []rawWorklog{{
		id: "wl-good", accountID: "me-1",
		started: time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC),
		updated: time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC),
		seconds: 1200,
	}}
	goodSrv := good.start()

	bad := newFetchJiraServer(t, "me-2")
	bad.searchStatus = http.StatusUnauthorized
	badSrv := bad.start()

	s, db, sealer := fetchEnv(t, "Europe/Amsterdam", time.Date(2026, 9, 2, 12, 0, 0, 0, time.UTC))
	goodInst := seedInstance(t, db, sealer, "Work", "", goodSrv.URL)
	badInst := seedInstance(t, db, sealer, "Northwind", "", badSrv.URL)

	rec := callFetchWeek(t, s, "/api/week/fetch?start=2026-08-31")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	body := decodeFetchWeek(t, rec)

	if body.Created != 1 {
		t.Errorf("created = %d, want 1 — the good instance's worklog", body.Created)
	}
	if len(body.Failures) != 1 {
		t.Fatalf("failures = %+v, want one", body.Failures)
	}
	if body.Failures[0].InstanceID != badInst.ID || body.Failures[0].InstanceName != "Northwind" {
		t.Errorf("failure = %+v, want instance %d named Northwind", body.Failures[0], badInst.ID)
	}
	if body.Failures[0].Error.Code != "credentials_rejected" {
		t.Errorf("failure code = %q, want credentials_rejected", body.Failures[0].Error.Code)
	}

	entries := allEntries(t, db)
	if len(entries) != 1 {
		t.Fatalf("stored %d entries, want 1", len(entries))
	}
	if entries[0].InstanceID != goodInst.ID || entries[0].WorklogID != "wl-good" {
		t.Errorf("stored entry = %+v, want the good instance's worklog", entries[0])
	}
}

// TestFetchWeekKeepsAnEarlierIssuesCreateWhenALaterOneFails is the test the
// whole-branch review of CB#10 asked for: fetchInstanceWeek reads one issue at a
// time, and a failure on the second must not erase what the first already
// wrote. Mirrors pushInstanceEntries' per-entry independence in push.go —
// this is the same rule one level up, at the per-issue read.
func TestFetchWeekKeepsAnEarlierIssuesCreateWhenALaterOneFails(t *testing.T) {
	jiraSrv := newFetchJiraServer(t, "me-1")
	jiraSrv.searchIssues = []string{"WORK-1", "WORK-2"}
	jiraSrv.worklogs["WORK-1"] = []rawWorklog{{
		id: "wl-1", accountID: "me-1",
		started: time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC),
		updated: time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC),
		seconds: 1200,
	}}
	jiraSrv.worklogStatus = map[string]int{"WORK-2": http.StatusInternalServerError}
	srv := jiraSrv.start()

	s, db, sealer := fetchEnv(t, "Europe/Amsterdam", time.Date(2026, 9, 2, 12, 0, 0, 0, time.UTC))
	inst := seedInstance(t, db, sealer, "Work", "", srv.URL)

	rec := callFetchWeek(t, s, "/api/week/fetch?start=2026-08-31")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	body := decodeFetchWeek(t, rec)

	if body.Created != 1 {
		t.Errorf("created = %d, want 1 — WORK-1's worklog, kept despite WORK-2 failing", body.Created)
	}
	if len(body.Failures) != 1 {
		t.Fatalf("failures = %+v, want one", body.Failures)
	}
	if body.Failures[0].InstanceID != inst.ID {
		t.Errorf("failure = %+v, want instance %d", body.Failures[0], inst.ID)
	}

	entries := allEntries(t, db)
	if len(entries) != 1 || entries[0].WorklogID != "wl-1" {
		t.Errorf("stored entries = %+v, want just wl-1", entries)
	}
}

func TestFetchWeekRejectsAStartThatIsNotAMonday(t *testing.T) {
	s, _, _ := fetchEnv(t, "Europe/Amsterdam", time.Date(2026, 9, 2, 12, 0, 0, 0, time.UTC))

	rec := callFetchWeek(t, s, "/api/week/fetch?start=2026-09-06")

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	var body errorBody
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decoding %s: %v", rec.Body.String(), err)
	}
	if body.Code != "start_not_monday" {
		t.Errorf("code = %q, want start_not_monday", body.Code)
	}
}

// TestFetchWeekKeepsAnEditThatLandedMidFetch is Critical 2 of CB#10's
// whole-branch review, and the mirror of the push's own guard. The fetch reads
// local state once, before the per-issue Jira reads, and an edit typed while
// those are in flight must not be overwritten by a copy of the entry that
// predates it.
func TestFetchWeekKeepsAnEditThatLandedMidFetch(t *testing.T) {
	loc, err := time.LoadLocation("Europe/Amsterdam")
	if err != nil {
		t.Fatalf("loading zone: %v", err)
	}

	jiraSrv := newFetchJiraServer(t, "me-1")
	jiraSrv.searchIssues = []string{"WORK-1"}
	srv := jiraSrv.start()

	s, db, sealer := fetchEnv(t, "Europe/Amsterdam", time.Date(2026, 9, 2, 12, 0, 0, 0, time.UTC))
	inst := seedInstance(t, db, sealer, "Work", "", srv.URL)

	clean := seedEntry(t, db, store.EntryInput{
		InstanceID: inst.ID, IssueKey: "WORK-1", Day: "2026-09-02",
		StartedAt: time.Date(2026, 9, 2, 9, 0, 0, 0, loc), Seconds: 1800, Comment: "old",
	})
	marked := markEntryPushed(t, db, clean.ID, "wl-B")

	jiraSrv.worklogs["WORK-1"] = []rawWorklog{{
		id: "wl-B", accountID: "me-1",
		started: time.Date(2026, 9, 2, 9, 0, 0, 0, loc),
		updated: marked.UpdatedAt.Add(time.Hour),
		seconds: 5400,
	}}

	// The edit, landing after the fetch read local state and before it decides
	// what to write. The sleep crosses the second boundary updated_at is
	// truncated to; without it the edit would write back the value the fetch
	// already holds and no guard could tell the two apart.
	jiraSrv.onWorklogRead = func(string) {
		time.Sleep(1100 * time.Millisecond)
		if _, err := db.UpdateEntry(context.Background(), clean.ID, 2400, "typed mid-fetch"); err != nil {
			t.Errorf("editing the entry mid-fetch: %v", err)
		}
	}

	rec := callFetchWeek(t, s, "/api/week/fetch?start=2026-08-31")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	body := decodeFetchWeek(t, rec)

	after, err := db.Entry(context.Background(), clean.ID)
	if err != nil {
		t.Fatalf("re-reading the entry: %v", err)
	}
	if after.Seconds != 2400 || after.Comment != "typed mid-fetch" {
		t.Fatalf("entry = %ds %q, want the edit typed mid-fetch kept: it was never pushed, "+
			"and this app has no other copy of it", after.Seconds, after.Comment)
	}

	if body.Updated != 0 {
		t.Errorf("updated = %d, want 0 — nothing was overwritten", body.Updated)
	}
	if len(body.KeptLocal) != 1 {
		t.Fatalf("keptLocal = %+v, want the entry named: the user is the only one who can "+
			"choose between the two texts", body.KeptLocal)
	}
	if body.KeptLocal[0].IssueKey != "WORK-1" || body.KeptLocal[0].Day != "2026-09-02" {
		t.Errorf("keptLocal[0] = %+v, want WORK-1 on 2026-09-02", body.KeptLocal[0])
	}
}

// TestFetchWeekAfterAPushReportsNothingUpdated is Important 3. A push moves
// pushed_at and leaves updated_at where the last edit put it, while Jira stamps
// the worklog it creates at push time — so a fetch that compared against
// updated_at alone rewrote every entry just pushed with the app's own data, and
// told the user Jira held something else.
func TestFetchWeekAfterAPushReportsNothingUpdated(t *testing.T) {
	loc, err := time.LoadLocation("Europe/Amsterdam")
	if err != nil {
		t.Fatalf("loading zone: %v", err)
	}

	jiraSrv := newFetchJiraServer(t, "me-1")
	jiraSrv.searchIssues = []string{"WORK-1"}
	srv := jiraSrv.start()

	s, db, sealer := fetchEnv(t, "Europe/Amsterdam", time.Date(2026, 9, 2, 12, 0, 0, 0, time.UTC))
	inst := seedInstance(t, db, sealer, "Work", "", srv.URL)

	entry := seedEntry(t, db, store.EntryInput{
		InstanceID: inst.ID, IssueKey: "WORK-1", Day: "2026-09-02",
		StartedAt: time.Date(2026, 9, 2, 9, 0, 0, 0, loc), Seconds: 1800, Comment: "mine",
	})

	// The push: pushed_at moves an hour past the edit that produced the entry,
	// updated_at does not move at all.
	pushedAt := entry.UpdatedAt.Add(time.Hour)
	ok, err := db.RecordWorklogMarkingPushedIfUnchanged(
		context.Background(), entry.ID, "wl-mine", pushedAt, entry.UpdatedAt)
	if err != nil || !ok {
		t.Fatalf("recording the push: ok=%v err=%v", ok, err)
	}

	jiraSrv.worklogs["WORK-1"] = []rawWorklog{{
		id: "wl-mine", accountID: "me-1",
		started: time.Date(2026, 9, 2, 9, 0, 0, 0, loc),
		// Jira stamps the worklog when the push creates it: after the local
		// edit, and no later than the push itself.
		updated: pushedAt.Add(-time.Minute),
		seconds: 1800,
	}}

	rec := callFetchWeek(t, s, "/api/week/fetch?start=2026-08-31")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	body := decodeFetchWeek(t, rec)

	if body.Created != 0 || body.Updated != 0 {
		t.Fatalf("created = %d, updated = %d, want 0 and 0 — the worklog is this app's own "+
			"push coming back, and reporting it as an update reads as an alarm", body.Created, body.Updated)
	}
}

// CB#280: a fetch must not re-create, overwrite or un-mark a pending delete. The
// remote copy here is younger and has moved a day, so every other rule would
// rewrite the row.
func TestFetchWeekLeavesAPendingDeleteAlone(t *testing.T) {
	loc, err := time.LoadLocation("Europe/Amsterdam")
	if err != nil {
		t.Fatalf("loading zone: %v", err)
	}

	jiraSrv := newFetchJiraServer(t, "me-1")
	jiraSrv.searchIssues = []string{"WORK-1"}
	srv := jiraSrv.start()

	s, db, sealer := fetchEnv(t, "Europe/Amsterdam", time.Date(2026, 9, 2, 12, 0, 0, 0, time.UTC))
	inst := seedInstance(t, db, sealer, "Work", "", srv.URL)

	entry := seedEntry(t, db, store.EntryInput{
		InstanceID: inst.ID, IssueKey: "WORK-1", Day: "2026-09-02",
		StartedAt: time.Date(2026, 9, 2, 9, 0, 0, 0, loc), Seconds: 1800, Comment: "old",
	})
	marked := markEntryPushed(t, db, entry.ID, "wl-D")
	if err := db.MarkEntryDeleted(context.Background(), entry.ID,
		time.Date(2026, 9, 2, 11, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("marking the entry deleted: %v", err)
	}

	jiraSrv.worklogs["WORK-1"] = []rawWorklog{{
		id: "wl-D", accountID: "me-1",
		started: time.Date(2026, 9, 3, 10, 0, 0, 0, loc),
		updated: marked.UpdatedAt.Add(time.Hour),
		seconds: 5400,
	}}

	rec := callFetchWeek(t, s, "/api/week/fetch?start=2026-08-31")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	body := decodeFetchWeek(t, rec)

	if body.Created != 0 || body.Updated != 0 || len(body.KeptLocal) != 0 {
		t.Errorf("created %d, updated %d, keptLocal %+v; want nothing done and nothing reported",
			body.Created, body.Updated, body.KeptLocal)
	}
	if len(body.Failures) != 0 {
		t.Errorf("failures = %+v, want none: the fetch tried to re-create the worklog", body.Failures)
	}
	stored := allEntries(t, db)
	if len(stored) != 1 {
		t.Fatalf("stored %d entries, want the one: the worklog was re-created", len(stored))
	}
	after := stored[0]
	if after.Seconds != 1800 || after.Day != "2026-09-02" || pushStateOf(after) != "deleted" {
		t.Errorf("entry = %ds on %s in state %q, want 1800s on 2026-09-02, still deleted",
			after.Seconds, after.Day, pushStateOf(after))
	}
}
