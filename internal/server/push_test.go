package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/dgerrese/work-dashboard/internal/store"
)

// fakeJira counts worklog creates and hands back a fresh id for each.
func fakeJira(t *testing.T, created *atomic.Int64) *httptest.Server {
	t.Helper()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && strings.Contains(r.URL.Path, "/worklog") {
			n := created.Add(1)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]string{"id": "wl-" + strconv.FormatInt(n, 10)})
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(srv.Close)

	return srv
}

func TestPushSendsTheDaysUnpushedEntriesAndIsIdempotent(t *testing.T) {
	var created atomic.Int64
	jiraSrv := fakeJira(t, &created)

	s, db, sealer := newServerWithStore(t)
	inst := seedInstance(t, db, sealer, "Work", "", jiraSrv.URL)

	ctx := context.Background()
	for _, seconds := range []int{3600, 1800} {
		if _, err := db.CreateEntry(ctx, store.EntryInput{
			InstanceID: inst.ID,
			IssueKey:   "RIDGE-1",
			Day:        "2026-08-31",
			StartedAt:  time.Date(2026, 8, 31, 9, 0, 0, 0, time.UTC),
			Seconds:    seconds,
			Comment:    "work",
		}); err != nil {
			t.Fatalf("seeding entry: %v", err)
		}
	}

	first := pushDay(t, s, "2026-08-31")
	if len(first.Results) != 2 {
		t.Fatalf("got %d results, want 2: %+v", len(first.Results), first.Results)
	}
	for _, r := range first.Results {
		if r.Status != "pushed" {
			t.Errorf("entry %d status = %q, want pushed (error: %+v)", r.EntryID, r.Status, r.Error)
		}
		if r.WorklogID == "" {
			t.Errorf("entry %d pushed with no worklog id recorded", r.EntryID)
		}
	}
	if got := created.Load(); got != 2 {
		t.Fatalf("fake Jira received %d worklog creates, want 2", got)
	}

	// The second push must reach Jira not at all: state is derived from
	// worklog_id, so an already-pushed entry has nothing to send.
	second := pushDay(t, s, "2026-08-31")
	for _, r := range second.Results {
		if r.Status != "skipped" {
			t.Errorf("entry %d status = %q on the second push, want skipped", r.EntryID, r.Status)
		}
	}
	if got := created.Load(); got != 2 {
		t.Errorf("fake Jira received %d worklog creates after two pushes, want 2 — "+
			"the second push duplicated worklogs", got)
	}
}

// pushDay calls POST /api/push and decodes the response, failing the test on
// any non-200.
func pushDay(t *testing.T, s *Server, day string) pushResponseDTO {
	t.Helper()

	req := httptest.NewRequest(http.MethodPost, "/api/push?day="+day, nil)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("POST /api/push = %d, want 200: %s", rec.Code, rec.Body.String())
	}

	var got pushResponseDTO
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decoding push response: %v", err)
	}

	return got
}

// TestPushIsNotTransactionalAcrossInstances is the central property of #9: one
// site refusing must not hold back another's entries, and a refused entry must
// stay pushable.
func TestPushIsNotTransactionalAcrossInstances(t *testing.T) {
	var goodCreated atomic.Int64
	good := fakeJira(t, &goodCreated)

	// Answers every worklog create with 500, which the client maps to
	// jira.ErrUnreachable.
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && strings.Contains(r.URL.Path, "/worklog") {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(bad.Close)

	s, db, sealer := newServerWithStore(t)
	goodInst := seedInstance(t, db, sealer, "Good", "", good.URL)
	badInst := seedInstance(t, db, sealer, "Bad", "", bad.URL)

	ctx := context.Background()
	ids := map[int64]int64{}
	for _, inst := range []*store.Instance{goodInst, badInst} {
		entry, err := db.CreateEntry(ctx, store.EntryInput{
			InstanceID: inst.ID,
			IssueKey:   "RIDGE-1",
			Day:        "2026-08-31",
			StartedAt:  time.Date(2026, 8, 31, 9, 0, 0, 0, time.UTC),
			Seconds:    3600,
			Comment:    "work",
		})
		if err != nil {
			t.Fatalf("seeding entry: %v", err)
		}
		ids[inst.ID] = entry.ID
	}

	got := pushDay(t, s, "2026-08-31")

	byEntry := map[int64]pushResultDTO{}
	for _, r := range got.Results {
		byEntry[r.EntryID] = r
	}

	if r := byEntry[ids[goodInst.ID]]; r.Status != "pushed" {
		t.Errorf("healthy instance's entry status = %q, want pushed — a sibling's "+
			"failure blanked it", r.Status)
	}
	if r := byEntry[ids[badInst.ID]]; r.Status != "failed" {
		t.Errorf("failing instance's entry status = %q, want failed", r.Status)
	} else if r.Error == nil {
		t.Error("a failed entry carries no error; the UI has nothing to name")
	}

	// The failed entry must be left exactly as it was, or the next push skips it.
	stillUnpushed, err := db.Entry(ctx, ids[badInst.ID])
	if err != nil {
		t.Fatalf("reading the failed entry: %v", err)
	}
	if stillUnpushed.WorklogID != "" || stillUnpushed.PushedAt != nil {
		t.Errorf("a failed entry was marked pushed (%+v); the retry would skip it", stillUnpushed)
	}
}

func TestPushRetriesOnlyWhatFailed(t *testing.T) {
	var created atomic.Int64
	var failing atomic.Bool
	failing.Store(true)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && strings.Contains(r.URL.Path, "/worklog") {
			if failing.Load() {
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			n := created.Add(1)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]string{"id": "wl-" + strconv.FormatInt(n, 10)})
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(srv.Close)

	s, db, sealer := newServerWithStore(t)
	inst := seedInstance(t, db, sealer, "Work", "", srv.URL)

	if _, err := db.CreateEntry(context.Background(), store.EntryInput{
		InstanceID: inst.ID,
		IssueKey:   "RIDGE-1",
		Day:        "2026-08-31",
		StartedAt:  time.Date(2026, 8, 31, 9, 0, 0, 0, time.UTC),
		Seconds:    3600,
		Comment:    "work",
	}); err != nil {
		t.Fatalf("seeding entry: %v", err)
	}

	if r := pushDay(t, s, "2026-08-31").Results[0]; r.Status != "failed" {
		t.Fatalf("first push status = %q, want failed", r.Status)
	}

	failing.Store(false)

	if r := pushDay(t, s, "2026-08-31").Results[0]; r.Status != "pushed" {
		t.Errorf("second push status = %q, want pushed — a failed entry was not retried", r.Status)
	}
	if got := created.Load(); got != 1 {
		t.Errorf("fake Jira created %d worklogs, want 1", got)
	}
}

func TestPushRejectsAMalformedDay(t *testing.T) {
	s, _, _ := newServerWithStore(t)

	req := httptest.NewRequest(http.MethodPost, "/api/push?day=not-a-date", nil)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("POST /api/push?day=not-a-date = %d, want 400", rec.Code)
	}
}

// TestPushDefaultsToTodayInTheConfiguredZone pins the clock to an instant that is
// a different date in UTC than in the configured zone, which is the whole reason
// day is resolved server-side.
func TestPushDefaultsToTodayInTheConfiguredZone(t *testing.T) {
	var created atomic.Int64
	jiraSrv := fakeJira(t, &created)

	s, db, sealer := newServerWithStore(t)
	amsterdam, err := time.LoadLocation("Europe/Amsterdam")
	if err != nil {
		t.Fatalf("loading zone: %v", err)
	}
	s.cfg.Location = amsterdam
	// 23:30 UTC on the 30th is 01:30 on the 31st in Amsterdam.
	s.now = func() time.Time { return time.Date(2026, 8, 30, 23, 30, 0, 0, time.UTC) }

	inst := seedInstance(t, db, sealer, "Work", "", jiraSrv.URL)
	if _, err := db.CreateEntry(context.Background(), store.EntryInput{
		InstanceID: inst.ID,
		IssueKey:   "RIDGE-1",
		Day:        "2026-08-31",
		StartedAt:  time.Date(2026, 8, 30, 23, 30, 0, 0, time.UTC),
		Seconds:    3600,
		Comment:    "late",
	}); err != nil {
		t.Fatalf("seeding entry: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/push", nil)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)

	var got pushResponseDTO
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decoding: %v", err)
	}
	if got.Day != "2026-08-31" {
		t.Errorf("day = %q, want 2026-08-31 — the day was resolved in UTC, not the configured zone", got.Day)
	}
	if len(got.Results) != 1 {
		t.Fatalf("got %d results, want the one entry on the local day", len(got.Results))
	}
}

// TestPushRunsInstancesConcurrently pins fan-out itself, not just its result:
// three slow-but-healthy instances alongside a fast-failing one must finish in
// about one instance's delay, not the sum of all of them. A sequential loop
// over instances produces the same per-entry statuses as the fan-out version —
// which is why TestPushIsNotTransactionalAcrossInstances alone does not catch a
// regression to one — but takes roughly the sum of the delays below instead of
// the max.
func TestPushRunsInstancesConcurrently(t *testing.T) {
	const (
		slowInstanceCount = 3
		perInstanceDelay  = 150 * time.Millisecond
	)

	slowJira := func(t *testing.T) *httptest.Server {
		t.Helper()
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodPost && strings.Contains(r.URL.Path, "/worklog") {
				time.Sleep(perInstanceDelay)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusCreated)
				_, _ = w.Write([]byte(`{"id":"wl-1"}`))
				return
			}
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{}`))
		}))
		t.Cleanup(srv.Close)
		return srv
	}

	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && strings.Contains(r.URL.Path, "/worklog") {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(bad.Close)

	s, db, sealer := newServerWithStore(t)
	ctx := context.Background()

	seedEntry := func(instID int64, issueKey string) {
		if _, err := db.CreateEntry(ctx, store.EntryInput{
			InstanceID: instID,
			IssueKey:   issueKey,
			Day:        "2026-08-31",
			StartedAt:  time.Date(2026, 8, 31, 9, 0, 0, 0, time.UTC),
			Seconds:    3600,
			Comment:    "work",
		}); err != nil {
			t.Fatalf("seeding entry: %v", err)
		}
	}

	for i := 0; i < slowInstanceCount; i++ {
		inst := seedInstance(t, db, sealer, fmt.Sprintf("Slow%d", i), "", slowJira(t).URL)
		seedEntry(inst.ID, "RIDGE-1")
	}
	badInst := seedInstance(t, db, sealer, "Bad", "", bad.URL)
	seedEntry(badInst.ID, "RIDGE-2")

	start := time.Now()
	got := pushDay(t, s, "2026-08-31")
	elapsed := time.Since(start)

	// A serial loop over the 4 instances would take roughly
	// slowInstanceCount*perInstanceDelay (the failing instance adds
	// essentially nothing); concurrent fan-out takes roughly one instance's
	// delay. The threshold sits at the midpoint, comfortably clear of either.
	threshold := time.Duration(slowInstanceCount) * perInstanceDelay / 2
	if elapsed >= threshold {
		t.Errorf("push across %d instances took %v, want under %v — instances "+
			"are not being pushed concurrently", slowInstanceCount+1, elapsed, threshold)
	}

	var pushedCount, failedCount int
	for _, r := range got.Results {
		switch r.Status {
		case "pushed":
			pushedCount++
		case "failed":
			failedCount++
		}
	}
	if pushedCount != slowInstanceCount {
		t.Errorf("pushed count = %d, want %d", pushedCount, slowInstanceCount)
	}
	if failedCount != 1 {
		t.Errorf("failed count = %d, want 1", failedCount)
	}
}
