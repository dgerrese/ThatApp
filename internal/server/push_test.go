package server

import (
	"context"
	"encoding/json"
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
