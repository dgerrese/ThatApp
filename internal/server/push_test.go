package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"codeberg.org/DionGerrese/ThatApp/internal/store"
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

// failingJira answers every worklog create with 500, which the client maps to
// jira.ErrUnreachable.
func failingJira(t *testing.T) *httptest.Server {
	t.Helper()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && strings.Contains(r.URL.Path, "/worklog") {
			w.WriteHeader(http.StatusInternalServerError)
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

// pushEnv wires a server to a single fake-Jira instance whose worklog creation
// a test can hook, for scenarios a canned response can't produce — such as an
// edit landing in the window between the push's read and its Jira call.
type pushEnv struct {
	s     *Server
	store *store.Store
	inst  *store.Instance
	jira  *hookableJira
}

// hookableJira lets a test steer how the fake answers worklog PUT and POST,
// and see which one it last received. createWorklog hands back an
// incrementing id by default, matching fakeJira's behaviour for tests that
// don't care; a test overrides it directly for scenarios a canned response
// can't produce, such as an edit landing in the window between the push's
// read and its Jira call. updateStatus and createID let a test steer the
// dirty-entry update/create-fallback path without a bespoke handler.
type hookableJira struct {
	createWorklog func() (string, error)
	updateStatus  int
	createID      string
	lastMethod    string
	calls         int

	// deleted is the worklog ids DELETE was asked for, under a mutex because
	// the delete that records one runs on its own goroutine while a push is
	// still in flight — which is the whole point of the test that reads it.
	mu      sync.Mutex
	deleted []string
}

// deletedWorklogs is the ids Jira was asked to delete, in the order it saw them.
func (j *hookableJira) deletedWorklogs() []string {
	j.mu.Lock()
	defer j.mu.Unlock()

	return append([]string(nil), j.deleted...)
}

func newPushEnv(t *testing.T) *pushEnv {
	t.Helper()

	env := &pushEnv{jira: &hookableJira{updateStatus: http.StatusOK}}

	var created atomic.Int64
	env.jira.createWorklog = func() (string, error) {
		return "wl-" + strconv.FormatInt(created.Add(1), 10), nil
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.Path, "/worklog") {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{}`))
			return
		}

		env.jira.calls++
		env.jira.lastMethod = r.Method

		switch r.Method {
		case http.MethodPut:
			w.WriteHeader(env.jira.updateStatus)
		case http.MethodDelete:
			env.jira.mu.Lock()
			env.jira.deleted = append(env.jira.deleted,
				path.Base(r.URL.Path))
			env.jira.mu.Unlock()
			w.WriteHeader(http.StatusNoContent)
		case http.MethodPost:
			id := env.jira.createID
			var err error
			if id == "" {
				id, err = env.jira.createWorklog()
			}
			if err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]string{"id": id})
		default:
			w.WriteHeader(http.StatusOK)
		}
	}))
	t.Cleanup(srv.Close)

	s, db, sealer := newServerWithStore(t)
	env.s = s
	env.store = db
	env.inst = seedInstance(t, db, sealer, "Work", "", srv.URL)

	return env
}

// markPushed records worklogID as already delivered, without going through a
// real push — standing in for an entry pushed on some earlier day.
func (env *pushEnv) markPushed(t *testing.T, entryID int64, worklogID string) {
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

// editEntry corrects an entry's duration and comment, making it dirty.
//
// Both pushed_at and updated_at are stored truncated to the second; without
// crossing a second boundary here, an edit made in the same second as
// markPushed's write could tie rather than beat it, and pushStateOf would
// read the entry as clean instead of dirty.
func (env *pushEnv) editEntry(t *testing.T, entryID int64, seconds int, comment string) store.Entry {
	t.Helper()

	time.Sleep(1100 * time.Millisecond)

	updated, err := env.store.UpdateEntry(context.Background(), entryID, seconds, comment)
	if err != nil {
		t.Fatalf("editing entry %d: %v", entryID, err)
	}

	return *updated
}

func (env *pushEnv) createEntry(t *testing.T, issueKey string, seconds int, comment string) store.Entry {
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

func (env *pushEnv) push(t *testing.T, day string) pushResponseDTO {
	t.Helper()

	return pushDay(t, env.s, day)
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

	bad := failingJira(t)

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
		t.Errorf("fake Jira created %d worklogs, want 1 — the retry duplicated "+
			"the worklog instead of only sending what previously failed", got)
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
		perInstanceDelay  = 500 * time.Millisecond
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

	bad := failingJira(t)

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

	// The threshold is load-bearing, not a round number: a serial loop over the
	// 4 instances takes roughly slowInstanceCount*perInstanceDelay (~1500ms; the
	// failing instance adds essentially nothing), while concurrent fan-out takes
	// roughly one instance's delay (~500-550ms, allowing for goroutine
	// scheduling jitter and sqlite write serialisation across the concurrent
	// RecordWorklogMarkingPushedIfUnchanged calls). Setting the ceiling to 1.5x a single
	// delay keeps ~210ms/28% of headroom under it on the concurrent side while
	// staying at half the serial duration — widen perInstanceDelay, not this
	// formula, if the gap ever needs to grow further.
	threshold := perInstanceDelay + perInstanceDelay/2
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
		t.Errorf("pushed count = %d, want %d — a healthy instance's entry was "+
			"lost or blanked by the failing one", pushedCount, slowInstanceCount)
	}
	if failedCount != 1 {
		t.Errorf("failed count = %d, want 1 — the failing instance's entry "+
			"should be the only one reported failed", failedCount)
	}
}

// TestPushSerializesConcurrentRequests pins the mutex added to handlePushDay:
// two POST /api/push calls for the same day, fired concurrently, must not both
// read the same entries as unpushed before either records a worklog_id — that
// interleaving is what would create a duplicate worklog in real Jira. The fake
// Jira sleeps before answering so two unserialized requests really do overlap
// in wall-clock time rather than merely being scheduled close together.
func TestPushSerializesConcurrentRequests(t *testing.T) {
	const delay = 100 * time.Millisecond

	var created atomic.Int64
	slowFakeJira := func(t *testing.T) *httptest.Server {
		t.Helper()
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodPost && strings.Contains(r.URL.Path, "/worklog") {
				time.Sleep(delay)
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

	s, db, sealer := newServerWithStore(t)
	inst := seedInstance(t, db, sealer, "Work", "", slowFakeJira(t).URL)

	ctx := context.Background()
	for _, issueKey := range []string{"RIDGE-1", "RIDGE-2"} {
		if _, err := db.CreateEntry(ctx, store.EntryInput{
			InstanceID: inst.ID,
			IssueKey:   issueKey,
			Day:        "2026-08-31",
			StartedAt:  time.Date(2026, 8, 31, 9, 0, 0, 0, time.UTC),
			Seconds:    3600,
			Comment:    "work",
		}); err != nil {
			t.Fatalf("seeding entry: %v", err)
		}
	}

	codes := make(chan int, 2)
	for range 2 {
		go func() {
			req := httptest.NewRequest(http.MethodPost, "/api/push?day=2026-08-31", nil)
			rec := httptest.NewRecorder()
			s.ServeHTTP(rec, req)
			codes <- rec.Code
		}()
	}
	for range 2 {
		if code := <-codes; code != http.StatusOK {
			t.Errorf("POST /api/push = %d, want 200", code)
		}
	}

	if got := created.Load(); got != 2 {
		t.Fatalf("fake Jira received %d worklog creates for 2 entries pushed by two concurrent "+
			"requests, want 2 (one per entry) — the mutex in handlePushDay did not serialize them", got)
	}
}

// TestPushRecordsAWorklogAfterTheClientDisconnects pins the one failure that
// silently produces a duplicate in the user's timesheet: net/http cancels
// r.Context() when the browser goes away, and database/sql refuses to execute
// on a cancelled context, so a disconnect between Jira answering 201 and the
// local write leaves the worklog existing in Jira with worklog_id still NULL —
// and the next push creates it a second time.
//
// s.now is the seam that makes the window deterministic rather than a race: the
// handler reads it once for the default day, then once per entry as the last
// thing it evaluates before RecordWorklogMarkingPushedIfUnchanged. Cancelling on that second read
// places the disconnect exactly inside the window, with the 201 already
// received.
func TestPushRecordsAWorklogAfterTheClientDisconnects(t *testing.T) {
	var created atomic.Int64
	jiraSrv := fakeJira(t, &created)

	s, db, sealer := newServerWithStore(t)
	inst := seedInstance(t, db, sealer, "Work", "", jiraSrv.URL)

	entry, err := db.CreateEntry(context.Background(), store.EntryInput{
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

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var reads atomic.Int64
	s.now = func() time.Time {
		if reads.Add(1) > 1 {
			cancel()
		}

		return time.Date(2026, 8, 31, 17, 0, 0, 0, time.UTC)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/push?day=2026-08-31", nil).WithContext(ctx)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)

	if got := created.Load(); got != 1 {
		t.Fatalf("fake Jira received %d worklog creates, want 1", got)
	}

	stored, err := db.Entry(context.Background(), entry.ID)
	if err != nil {
		t.Fatalf("reading the entry back: %v", err)
	}
	if stored.WorklogID == "" || stored.PushedAt == nil {
		t.Fatalf("entry reads back as %+v after a disconnected push — the worklog "+
			"exists in Jira but nothing records it, so the next push duplicates it", stored)
	}
}

// TestPushDayKeepsAnEditThatLandedMidPush is #9's central case: an edit typed
// while Jira is still answering must not be stamped pushed and lost.
func TestPushDayKeepsAnEditThatLandedMidPush(t *testing.T) {
	env := newPushEnv(t)
	entry := env.createEntry(t, "RID-1", 3600, "before")

	env.jira.createWorklog = func() (string, error) {
		// The edit the guard exists for: it lands after the push read the
		// entry and before the push marks it.
		time.Sleep(1100 * time.Millisecond)
		if _, err := env.store.UpdateEntry(context.Background(), entry.ID, 7200, "typed mid-push"); err != nil {
			return "", err
		}

		return "10001", nil
	}

	resp := env.push(t, entry.Day)

	if got := resp.Results[0].Status; got != "pushed" {
		t.Fatalf("status = %q, want pushed: the worklog really was created", got)
	}

	after, err := env.store.Entry(context.Background(), entry.ID)
	if err != nil {
		t.Fatalf("re-reading the entry: %v", err)
	}
	if after.WorklogID != "10001" {
		t.Fatalf("worklog id = %q, want 10001 recorded: the worklog exists in Jira, and an "+
			"entry that does not name it is one the next push creates a second worklog for", after.WorklogID)
	}
	if after.PushedAt != nil {
		t.Fatalf("pushed_at = %v, want it left unset: what Jira holds is the text from before "+
			"the edit, so the entry must read dirty rather than pushed", after.PushedAt)
	}
	if got := pushStateOf(*after); got != "dirty" {
		t.Fatalf("push state = %q, want dirty", got)
	}
	if after.Comment != "typed mid-push" {
		t.Fatalf("comment = %q, want the edit kept", after.Comment)
	}
}

// TestPushAfterAMidPushEditUpdatesRatherThanDuplicating is the other half of the
// same case, and the one that shows what the lost worklog id costs: the push
// that follows an edit-during-push must correct the worklog already in Jira
// rather than create a second one for the same hour.
func TestPushAfterAMidPushEditUpdatesRatherThanDuplicating(t *testing.T) {
	env := newPushEnv(t)
	entry := env.createEntry(t, "RID-1", 3600, "before")

	var creates atomic.Int64
	env.jira.createWorklog = func() (string, error) {
		creates.Add(1)
		// The edit the guard exists for: it lands after the push read the
		// entry and before the push records what Jira answered.
		time.Sleep(1100 * time.Millisecond)
		if _, err := env.store.UpdateEntry(context.Background(), entry.ID, 7200, "typed mid-push"); err != nil {
			return "", err
		}

		return "10001", nil
	}

	env.push(t, entry.Day)
	second := env.push(t, entry.Day)

	if got := second.Results[0].Status; got != "pushed" {
		t.Fatalf("second push status = %q, want pushed", got)
	}
	if got := creates.Load(); got != 1 {
		t.Fatalf("Jira received %d worklog creates, want 1 — the second push duplicated the "+
			"time the first one had already logged", got)
	}
	if got := env.jira.lastMethod; got != http.MethodPut {
		t.Fatalf("second push used %s, want PUT against the worklog it already has", got)
	}

	after, err := env.store.Entry(context.Background(), entry.ID)
	if err != nil {
		t.Fatalf("re-reading the entry: %v", err)
	}
	if after.WorklogID != "10001" || pushStateOf(*after) != "pushed" {
		t.Fatalf("entry = %q %q, want worklog 10001 reading pushed",
			after.WorklogID, pushStateOf(*after))
	}
}

func TestPushDayUpdatesADirtyEntry(t *testing.T) {
	tests := []struct {
		name         string
		updateStatus int
		wantMethod   string
		wantWorklog  string
	}{
		{
			name:         "updates the worklog it already has",
			updateStatus: http.StatusOK, wantMethod: http.MethodPut, wantWorklog: "10001",
		},
		{
			name:         "creates afresh when the worklog is gone",
			updateStatus: http.StatusNotFound, wantMethod: http.MethodPost, wantWorklog: "20002",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			env := newPushEnv(t)
			env.jira.updateStatus = test.updateStatus
			env.jira.createID = "20002"

			entry := env.createEntry(t, "RID-1", 3600, "first go")
			env.markPushed(t, entry.ID, "10001")
			env.editEntry(t, entry.ID, 7200, "corrected")

			resp := env.push(t, entry.Day)

			if got := resp.Results[0].Status; got != "pushed" {
				t.Fatalf("status = %q, want pushed", got)
			}
			if got := resp.Results[0].WorklogID; got != test.wantWorklog {
				t.Fatalf("worklog id = %q, want %q", got, test.wantWorklog)
			}
			if got := env.jira.lastMethod; got != test.wantMethod {
				t.Fatalf("Jira saw %s, want %s", got, test.wantMethod)
			}

			after, err := env.store.Entry(t.Context(), entry.ID)
			if err != nil {
				t.Fatalf("re-reading the entry: %v", err)
			}
			if after.WorklogID != test.wantWorklog {
				t.Fatalf("stored worklog id = %q, want %q", after.WorklogID, test.wantWorklog)
			}
			if pushStateOf(*after) != "pushed" {
				t.Fatalf("state = %q, want pushed: a successful push leaves nothing dirty",
					pushStateOf(*after))
			}
		})
	}
}

func TestPushDaySkipsACleanEntry(t *testing.T) {
	env := newPushEnv(t)
	entry := env.createEntry(t, "RID-1", 3600, "done")
	env.markPushed(t, entry.ID, "10001")

	resp := env.push(t, entry.Day)

	if got := resp.Results[0].Status; got != "skipped" {
		t.Fatalf("status = %q, want skipped", got)
	}
	if env.jira.calls != 0 {
		t.Fatalf("Jira was called %d times, want 0: a clean entry makes no request", env.jira.calls)
	}
}

// TestPushDayLeavesARefusedCorrectionDirty is the spec's own case for a
// correction Jira refuses: the worklog must be kept so the next attempt
// updates rather than duplicates, and the entry must stay dirty rather than
// being reported clean when nothing reached Jira.
func TestPushDayLeavesARefusedCorrectionDirty(t *testing.T) {
	env := newPushEnv(t)
	env.jira.updateStatus = http.StatusUnauthorized

	entry := env.createEntry(t, "RID-1", 3600, "first go")
	env.markPushed(t, entry.ID, "10001")
	env.editEntry(t, entry.ID, 7200, "corrected")

	resp := env.push(t, entry.Day)

	if got := resp.Results[0].Status; got != "failed" {
		t.Fatalf("status = %q, want failed", got)
	}

	after, err := env.store.Entry(t.Context(), entry.ID)
	if err != nil {
		t.Fatalf("re-reading the entry: %v", err)
	}
	if after.WorklogID != "10001" {
		t.Fatalf("worklog id = %q, want it kept so the next attempt updates rather than duplicates",
			after.WorklogID)
	}
	if pushStateOf(*after) != "dirty" {
		t.Fatalf("state = %q, want dirty: the correction never reached anywhere", pushStateOf(*after))
	}
	if after.Seconds != 7200 || after.Comment != "corrected" {
		t.Fatalf("entry = %ds %q, want the correction untouched", after.Seconds, after.Comment)
	}
}

// TestDeleteWhileAPushIsInFlightStillRemovesTheWorklog is Important 5 of #10's
// whole-branch review. Delete became a Jira-writing operation on this branch
// and was left outside the lock the push and the fetch share, so a delete
// landing while the push was creating the worklog read worklog_id as empty,
// asked Jira nothing, and dropped the row — leaving time on the timesheet that
// nothing here can reach.
func TestDeleteWhileAPushIsInFlightStillRemovesTheWorklog(t *testing.T) {
	env := newPushEnv(t)
	entry := env.createEntry(t, "RID-1", 3600, "work")

	deleted := make(chan int, 1)
	env.jira.createWorklog = func() (string, error) {
		go func() {
			rec := httptest.NewRecorder()
			env.s.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete,
				"/api/entries/"+strconv.FormatInt(entry.ID, 10), nil))
			deleted <- rec.Code
		}()
		// Long enough for that request to reach the handler, which is where it
		// must then wait rather than read an entry the push is halfway through.
		time.Sleep(300 * time.Millisecond)

		return "wl-1", nil
	}

	resp := env.push(t, entry.Day)
	if got := resp.Results[0].Status; got != "pushed" {
		t.Fatalf("push status = %q, want pushed: the worklog really was created", got)
	}

	select {
	case code := <-deleted:
		if code != http.StatusNoContent {
			t.Fatalf("DELETE /api/entries = %d, want 204", code)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the delete never answered")
	}

	if got := env.jira.deletedWorklogs(); len(got) != 1 || got[0] != "wl-1" {
		t.Fatalf("Jira was asked to delete %v, want [wl-1] — a delete that ran alongside "+
			"the push left the worklog it created behind in Jira", got)
	}
	if _, err := env.store.Entry(context.Background(), entry.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("reading the deleted entry back = %v, want it gone", err)
	}
}
