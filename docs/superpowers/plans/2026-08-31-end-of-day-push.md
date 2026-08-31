# End-of-Day Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-08-31
**Supersedes:** nothing
**Superseded by:** nothing

**Goal:** Turn the day's local time entries into Jira worklogs, reporting success or failure for
every entry individually.

**Architecture:** A new `POST /api/push` groups the day's unpushed entries by instance and fans out
across instances with the existing `fanOutInstances`, pushing an instance's entries sequentially
within its goroutine. Each success writes `worklog_id` and `pushed_at` immediately, per entry, so a
crash mid-push cannot orphan a worklog that exists in Jira. Push state stays derived from those two
columns and `updated_at` — never a stored flag.

**Tech Stack:** Go standard library, `golang.org/x/sync/errgroup` (via `fanOutInstances`),
`modernc.org/sqlite`, vanilla TypeScript, Tailwind v4, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-04-work-dashboard-design.md`, sections *Push semantics*,
*Partial failure* and *API surface*.

**Issue:** #9

## Global Constraints

- **Everything runs in Docker.** Never run Go, Node or npm on the host.
- **No JavaScript frameworks.** Vanilla TS only. Reusable UI is a `wd-*` WebComponent in **light
  DOM, never shadow DOM**.
- **Tailwind CSS v4**, CSS-first. Theme values live in `@theme` in `web/src/styles.css`.
- **`index.html` stays under 14kB.** Views load via dynamic `import()`.
- **Go: standard library first.** Approved non-stdlib set is `modernc.org/sqlite` and
  `golang.org/x/sync`. Wrap errors with `%w`.
- **Table-driven tests with `t.Run` subtests**, using `httptest` and `testing/fstest`.
- **No test ever contacts a real Jira instance.** Jira is always an `httptest.Server`.
- **TypeScript `strict` with `noUncheckedIndexedAccess`.** No `any`, no non-null assertions.
- **Comments earn their place** — a non-obvious "why", never narration of the next line.
- **Browsers: Firefox and Chromium only.** Safari/WebKit is an explicit non-goal.

## Push states, as this plan uses them

Derived from three columns, never stored:

| State | Condition | This ticket |
|---|---|---|
| `unpushed` | `worklog_id IS NULL` | `POST` a worklog, store the ID, set `pushed_at` |
| `pushed` | `worklog_id NOT NULL AND updated_at <= pushed_at` | skipped, no Jira request |
| `dirty` | `worklog_id NOT NULL AND updated_at > pushed_at` | skipped — the `PUT` is #10 |

`dirty` is reachable today: #7's edit stamps `updated_at`, so editing an already-pushed entry
produces it. This ticket must therefore *report* `dirty` honestly rather than call such an entry
"pushed", even though repairing it is #10's job.

## File Structure

| File | Responsibility |
|---|---|
| `internal/store/entries.go` (modify) | Add `MarkEntryPushed` — the only writer of `worklog_id`/`pushed_at` |
| `internal/store/entries_test.go` (modify) | Prove it writes those two columns and touches nothing else |
| `internal/server/push.go` (create) | `POST /api/push`: grouping, fan-out, per-entry results |
| `internal/server/push_test.go` (create) | Handler tests against a fake Jira |
| `internal/server/entries.go` (modify) | `entryDTO` gains `pushState`; add `pushStateOf` |
| `internal/server/server.go` (modify) | Register the route |
| `web/src/types.ts` (modify) | `Entry.pushState`, `PushResult`, `PushResponse` |
| `web/src/api.ts` (modify) | `pushDay()` |
| `web/src/components/wd-entry-dialog.ts` (modify) | Per-entry push badge on `entryRow` |
| `web/src/views/today.ts` (modify) | Push button, confirm, result alert naming failures |
| `.claude/e2e/tests/push.spec.ts` (create) | Partial-failure visibility end to end |

---

### Task 1: `MarkEntryPushed` in the store

**Files:**
- Modify: `internal/store/entries.go`
- Test: `internal/store/entries_test.go`

**Interfaces:**
- Consumes: `store.Entry`, `store.EntryInput` (existing)
- Produces: `func (s *Store) MarkEntryPushed(ctx context.Context, id int64, worklogID string, pushedAt time.Time) error`

**Why it must not stamp `updated_at`:** the spec derives `dirty` from `updated_at > pushed_at`. An
UPDATE that also refreshed `updated_at` would race its own `pushed_at` and could mark a
just-pushed entry dirty. The existing `UpdateEntry` names only `seconds, comment, updated_at` for
the mirror-image reason, guarded by a test at `internal/store/entries_test.go:377`.

- [ ] **Step 1: Write the failing test**

Add to `internal/store/entries_test.go`:

```go
func TestMarkEntryPushedRecordsTheWorklogWithoutTouchingUpdatedAt(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	inst := seedInstance(t, s)

	created, err := s.CreateEntry(ctx, EntryInput{
		InstanceID: inst.ID,
		IssueKey:   "RIDGE-1",
		Day:        "2026-08-31",
		StartedAt:  time.Date(2026, 8, 31, 9, 0, 0, 0, time.UTC),
		Seconds:    3600,
		Comment:    "morning",
	})
	if err != nil {
		t.Fatalf("creating entry: %v", err)
	}

	pushedAt := created.UpdatedAt.Add(time.Second)
	if err := s.MarkEntryPushed(ctx, created.ID, "10123", pushedAt); err != nil {
		t.Fatalf("MarkEntryPushed: %v", err)
	}

	got, err := s.Entry(ctx, created.ID)
	if err != nil {
		t.Fatalf("reading entry back: %v", err)
	}

	if got.WorklogID != "10123" {
		t.Errorf("WorklogID = %q, want %q", got.WorklogID, "10123")
	}
	if got.PushedAt == nil {
		t.Fatal("PushedAt is nil; the push did not record when it happened")
	}
	if !got.PushedAt.Equal(pushedAt) {
		t.Errorf("PushedAt = %v, want %v", got.PushedAt, pushedAt)
	}
	if !got.UpdatedAt.Equal(created.UpdatedAt) {
		t.Errorf("UpdatedAt = %v, want it unchanged at %v — a push that stamps "+
			"updated_at can mark its own entry dirty", got.UpdatedAt, created.UpdatedAt)
	}
	if got.Seconds != created.Seconds || got.Comment != created.Comment {
		t.Errorf("MarkEntryPushed altered the entry's data: %+v", got)
	}
}

func TestMarkEntryPushedOnAMissingRowReportsIt(t *testing.T) {
	s := newTestStore(t)

	err := s.MarkEntryPushed(context.Background(), 9999, "10123", time.Now())
	if err == nil {
		t.Fatal("MarkEntryPushed on a missing id returned nil; the caller would record a push that did not happen")
	}
}
```

If `newTestStore` or `seedInstance` are named differently in this file, use the existing helpers —
read the top of `entries_test.go` first and match them exactly.

- [ ] **Step 2: Run the test to verify it fails**

Run: `docker compose run --build --rm --no-deps app go test ./internal/store/ -run TestMarkEntryPushed -v`
Expected: FAIL — `s.MarkEntryPushed undefined`.

- [ ] **Step 3: Write the implementation**

Add to `internal/store/entries.go`:

```go
// MarkEntryPushed records the Jira worklog an entry became.
//
// It names only worklog_id and pushed_at. Stamping updated_at here would race
// pushed_at and could leave a just-pushed entry reading as dirty, since the
// spec derives dirty from updated_at > pushed_at.
func (s *Store) MarkEntryPushed(
	ctx context.Context, id int64, worklogID string, pushedAt time.Time,
) error {
	result, err := s.db.ExecContext(ctx,
		`UPDATE time_entries SET worklog_id = ?, pushed_at = ? WHERE id = ?`,
		worklogID, pushedAt.UTC(), id,
	)
	if err != nil {
		return fmt.Errorf("recording worklog %s for entry %d: %w", worklogID, id, err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("counting rows updated for entry %d: %w", id, err)
	}
	if affected == 0 {
		return fmt.Errorf("recording worklog %s: entry %d: %w", worklogID, id, ErrNotFound)
	}

	return nil
}
```

Use whatever "not found" sentinel this package already exports — check the top of the package for
`ErrNotFound` and match it. If none exists, return a plain wrapped error instead and drop the
sentinel.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `docker compose run --build --rm --no-deps app go test ./internal/store/ -v`
Expected: PASS, including the pre-existing tests.

- [ ] **Step 5: Commit**

```bash
git add internal/store/entries.go internal/store/entries_test.go
git commit -m "feat(#9): record a pushed entry's worklog without stamping updated_at"
```

---

### Task 2: `pushState` on the entry DTO

**Files:**
- Modify: `internal/server/entries.go`
- Test: `internal/server/entries_test.go`

**Interfaces:**
- Consumes: `store.Entry` (existing)
- Produces: `func pushStateOf(e store.Entry) string` returning `"unpushed"`, `"pushed"` or
  `"dirty"`; `entryDTO.PushState string` with JSON tag `pushState`

- [ ] **Step 1: Write the failing test**

Add to `internal/server/entries_test.go`:

```go
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
			name:  "worklog id without a pushed_at is not a push",
			entry: store.Entry{WorklogID: "10123", UpdatedAt: base},
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `docker compose run --build --rm --no-deps app go test ./internal/server/ -run TestPushStateOf -v`
Expected: FAIL — `pushStateOf` undefined.

- [ ] **Step 3: Write the implementation**

In `internal/server/entries.go`, add the field to `entryDTO`:

```go
	PushState string `json:"pushState"`
```

and the deriver:

```go
// pushStateOf reports whether an entry has reached Jira, and whether it has been
// edited since. It is computed from worklog_id, pushed_at and updated_at on every
// read rather than stored, which is what makes a repeated push idempotent for free.
func pushStateOf(e store.Entry) string {
	if e.WorklogID == "" || e.PushedAt == nil {
		return "unpushed"
	}
	if e.UpdatedAt.After(*e.PushedAt) {
		return "dirty"
	}

	return "pushed"
}
```

Then set it in `entryDTOFrom`, alongside the fields already assigned there:

```go
		PushState: pushStateOf(entry),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `docker compose run --build --rm --no-deps app go test ./internal/server/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/server/entries.go internal/server/entries_test.go
git commit -m "feat(#9): expose an entry's derived push state on the API"
```

---

### Task 3: The push handler — happy path and idempotency

**Files:**
- Create: `internal/server/push.go`
- Modify: `internal/server/server.go`
- Test: Create `internal/server/push_test.go`

**Interfaces:**
- Consumes: `s.db.EntriesForDay`, `s.db.Instances`, `s.db.MarkEntryPushed` (Task 1),
  `s.clients.forInstance`, `fanOutInstances`, `dayParam`, `dayLayout`, `writeJSON`, `writeError`,
  `errorBody`, `instanceErrorBody`, `jira.Worklog`, `client.CreateWorklog`
- Produces: `pushResultDTO{EntryID int64, IssueKey string, InstanceID int64, Status string,
  WorklogID string, Error *errorBody}`, `pushResponseDTO{Day string, Results []pushResultDTO}`,
  `func (s *Server) handlePushDay(w http.ResponseWriter, r *http.Request)`

Statuses are exactly `"pushed"`, `"skipped"` and `"failed"`.

- [ ] **Step 1: Write the failing test**

Create `internal/server/push_test.go`. Read `internal/server/pins_test.go` first and copy its
fake-Jira and instance-seeding helpers rather than inventing new ones.

```go
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

	s, db, _ := newServerWithStore(t)
	inst := seedInstancePointingAt(t, s, db, jiraSrv.URL)

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
```

`seedInstancePointingAt` must create an instance whose API base URL is the fake server and whose
token is sealed with the test sealer. `internal/server/pins_test.go` already does this — reuse its
helper by name if one exists, otherwise write the smallest equivalent in this file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `docker compose run --build --rm --no-deps app go test ./internal/server/ -run TestPushSends -v`
Expected: FAIL — `pushResponseDTO` undefined and the route 404s.

- [ ] **Step 3: Write the implementation**

Create `internal/server/push.go`:

```go
package server

import (
	"context"
	"net/http"
	"sort"
	"time"

	"github.com/dgerrese/work-dashboard/internal/jira"
	"github.com/dgerrese/work-dashboard/internal/store"
)

// pushInstanceTimeout bounds one instance's whole sequence of worklog creates,
// not a single call — jira.Client already bounds each call itself. It is
// generous because a long day is many entries against the same site, and the
// cost of cutting a push short is a worklog created in Jira that no local row
// records.
const pushInstanceTimeout = 2 * time.Minute

type pushResultDTO struct {
	EntryID    int64      `json:"entryId"`
	IssueKey   string     `json:"issueKey"`
	InstanceID int64      `json:"instanceId"`
	Status     string     `json:"status"`
	WorklogID  string     `json:"worklogId,omitempty"`
	Error      *errorBody `json:"error,omitempty"`
}

type pushResponseDTO struct {
	Day     string          `json:"day"`
	Results []pushResultDTO `json:"results"`
}

// handlePushDay turns one local day's entries into Jira worklogs.
//
// It answers 200 whenever the day could be read: a Jira site refusing a worklog
// is data about that entry, not a failure of this request. Per-entry results are
// the only honest report, because the push is deliberately not transactional.
func (s *Server) handlePushDay(w http.ResponseWriter, r *http.Request) {
	today := s.now().In(s.cfg.Location).Format(dayLayout)

	day, ok := dayParam(w, r, "day", today)
	if !ok {
		return
	}

	instances, err := s.db.Instances(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not read the stored instances")
		return
	}

	entries, err := s.db.EntriesForDay(r.Context(), day, day)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not read the logged time")
		return
	}

	byInstance := make(map[int64][]store.Entry, len(instances))
	for _, entry := range entries {
		byInstance[entry.InstanceID] = append(byInstance[entry.InstanceID], entry)
	}

	groups := fanOutInstances(r.Context(), instances, pushInstanceTimeout,
		func(ctx context.Context, inst store.Instance) []pushResultDTO {
			return s.pushInstanceEntries(ctx, inst, byInstance[inst.ID])
		})

	results := make([]pushResultDTO, 0, len(entries))
	covered := make(map[int64]bool, len(entries))
	for _, group := range groups {
		for _, result := range group {
			results = append(results, result)
			covered[result.EntryID] = true
		}
	}

	// An entry whose instance is no longer configured is reachable by no
	// goroutine above, and silently dropping it would report a clean push over
	// time that never left the machine.
	for _, entry := range entries {
		if covered[entry.ID] {
			continue
		}
		results = append(results, pushResultDTO{
			EntryID:    entry.ID,
			IssueKey:   entry.IssueKey,
			InstanceID: entry.InstanceID,
			Status:     "failed",
			Error: &errorBody{
				Code:    "instance_missing",
				Message: "the Jira instance this entry belongs to is no longer configured",
			},
		})
	}

	// Sorted by entry id so the order is the caller's to rely on and a test's to
	// assert, rather than an accident of which instance answered first.
	sort.Slice(results, func(i, j int) bool { return results[i].EntryID < results[j].EntryID })

	writeJSON(w, http.StatusOK, pushResponseDTO{Day: day, Results: results})
}

// pushInstanceEntries pushes one instance's entries in order, sequentially: they
// share a site and a rate limit, so parallelism here buys nothing and risks
// throttling. It never returns an error — see fanOutInstances on why.
func (s *Server) pushInstanceEntries(
	ctx context.Context, inst store.Instance, entries []store.Entry,
) []pushResultDTO {
	if len(entries) == 0 {
		return nil
	}

	results := make([]pushResultDTO, 0, len(entries))

	client, clientErr := s.clients.forInstance(ctx, &inst)
	for _, entry := range entries {
		result := pushResultDTO{
			EntryID:    entry.ID,
			IssueKey:   entry.IssueKey,
			InstanceID: entry.InstanceID,
		}

		if state := pushStateOf(entry); state != "unpushed" {
			result.Status = "skipped"
			result.WorklogID = entry.WorklogID
			results = append(results, result)
			continue
		}

		if clientErr != nil {
			result.Status = "failed"
			result.Error = instanceErrorBody(clientErr)
			results = append(results, result)
			continue
		}

		worklogID, err := client.CreateWorklog(ctx, jira.Worklog{
			IssueKey: entry.IssueKey,
			Started:  entry.StartedAt,
			Seconds:  int64(entry.Seconds),
			Comment:  entry.Comment,
		})
		if err != nil {
			result.Status = "failed"
			result.Error = instanceErrorBody(err)
			results = append(results, result)
			continue
		}

		// Recorded immediately, per entry, rather than batched at the end: the
		// worklog exists in Jira from here on, and a crash before the write
		// would leave the next push creating a duplicate.
		if err := s.db.MarkEntryPushed(ctx, entry.ID, worklogID, s.now().UTC()); err != nil {
			result.Status = "failed"
			result.WorklogID = worklogID
			result.Error = &errorBody{
				Code: "store_failed",
				Message: "the worklog reached Jira but could not be recorded locally; " +
					"re-pushing would duplicate it",
			}
			results = append(results, result)
			continue
		}

		result.Status = "pushed"
		result.WorklogID = worklogID
		results = append(results, result)
	}

	return results
}
```

In `internal/server/server.go`, register the route beside the entry routes:

```go
	s.mux.HandleFunc("POST /api/push", s.handlePushDay)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `docker compose run --build --rm --no-deps app go test ./internal/server/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/server/push.go internal/server/push_test.go internal/server/server.go
git commit -m "feat(#9): push a day's entries to Jira, idempotently"
```

---

### Task 4: Partial failure across instances

**Files:**
- Modify: `internal/server/push_test.go`
- Modify: `internal/server/push.go` only if a test exposes a defect

**Interfaces:**
- Consumes: everything Task 3 produced. Adds no new exported surface.

- [ ] **Step 1: Write the failing tests**

Append to `internal/server/push_test.go`:

```go
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

	s, db, _ := newServerWithStore(t)
	goodInst := seedInstancePointingAt(t, s, db, good.URL)
	badInst := seedInstancePointingAt(t, s, db, bad.URL)

	ctx := context.Background()
	ids := map[int64]int64{}
	for _, inst := range []store.Instance{goodInst, badInst} {
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

	s, db, _ := newServerWithStore(t)
	inst := seedInstancePointingAt(t, s, db, srv.URL)

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

	s, db, _ := newServerWithStore(t)
	amsterdam, err := time.LoadLocation("Europe/Amsterdam")
	if err != nil {
		t.Fatalf("loading zone: %v", err)
	}
	s.cfg.Location = amsterdam
	// 23:30 UTC on the 30th is 01:30 on the 31st in Amsterdam.
	s.now = func() time.Time { return time.Date(2026, 8, 30, 23, 30, 0, 0, time.UTC) }

	inst := seedInstancePointingAt(t, s, db, jiraSrv.URL)
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
```

- [ ] **Step 2: Run them and read every failure**

Run: `docker compose run --build --rm --no-deps app go test ./internal/server/ -run TestPush -v`
Expected: these should pass against Task 3's implementation. **If any fails, the implementation is
wrong, not the test** — fix `push.go` and say so in the task report.

- [ ] **Step 3: Prove the concurrency claim by mutation**

Temporarily change `handlePushDay` to call `s.pushInstanceEntries` in a plain `for` loop instead of
`fanOutInstances`. Re-run `TestPushIsNotTransactionalAcrossInstances`. Record in the task report
whether it still passed. If it did, the suite does not actually pin the fan-out, and you must add a
timing assertion that does — a slow healthy instance whose entry must still be pushed while a fast
failing one errors. Then revert the mutation.

- [ ] **Step 4: Run the whole Go suite**

Run: `docker compose run --build --rm --no-deps app go test ./...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/server/push.go internal/server/push_test.go
git commit -m "test(#9): pin partial failure, retry and the local day boundary"
```

---

### Task 5: The frontend API call and types

**Files:**
- Modify: `web/src/types.ts`, `web/src/api.ts`

**Interfaces:**
- Produces: `Entry.pushState`, `PushResult`, `PushResponse`, `pushDay(day?: string):
  Promise<PushResponse>`

- [ ] **Step 1: Add the types**

In `web/src/types.ts`, add `pushState` to `Entry`:

```ts
  /** Derived server-side from worklog_id, pushed_at and updated_at — never stored. */
  pushState: "unpushed" | "pushed" | "dirty";
```

and the push types:

```ts
export interface PushResult {
  entryId: number;
  issueKey: string;
  instanceId: number;
  status: "pushed" | "skipped" | "failed";
  worklogId?: string;
  error?: { code: string; message: string };
}

export interface PushResponse {
  day: string;
  results: PushResult[];
}
```

- [ ] **Step 2: Add the call**

In `web/src/api.ts`, following the shape of the existing `createEntry`:

```ts
export function pushDay(day?: string): Promise<PushResponse> {
  const query = day === undefined ? "" : `?day=${encodeURIComponent(day)}`;

  return request<PushResponse>(`/api/push${query}`, { method: "POST" });
}
```

Import `PushResponse` from `./types` alongside the existing type imports.

- [ ] **Step 3: Type-check**

Run: `make tsc`
Expected: PASS. Any `Entry` literal in tests or stubs will now need `pushState`; fix each rather
than loosening the type.

- [ ] **Step 4: Commit**

```bash
git add web/src/types.ts web/src/api.ts
git commit -m "feat(#9): add the push API call and its types"
```

---

### Task 6: The per-entry push badge

**Files:**
- Modify: `web/src/components/wd-entry-dialog.ts`

**Interfaces:**
- Consumes: `Entry.pushState` (Task 5)
- Produces: a badge element inside `entryRow`

Copy rules: `pushed` reads **"Pushed"**, `dirty` reads **"Edited since push"**, `unpushed` renders
**no badge at all** — the absence is the state, and a "Not pushed" chip on every fresh entry would
be noise on the common case.

- [ ] **Step 1: Add the badge**

In `entryRow`, after the `comment` span and before `actions`:

```ts
    const badge = pushBadge(entry.pushState);
    if (badge) row.append(badge);
```

but note `row.append(started, duration, comment, actions)` at the end of the function already sets
order — insert the badge into that call instead so it lands between comment and actions:

```ts
    const badge = pushBadge(entry.pushState);
    row.append(started, duration, comment, ...(badge ? [badge] : []), actions);
```

Add the helper at module scope, near `rowAction`:

```ts
/**
 * The badge an entry wears for its push state. "unpushed" deliberately renders
 * nothing: it is the ordinary state of a fresh entry, and a chip on every row
 * would say least where it appeared most.
 */
function pushBadge(state: Entry["pushState"]): HTMLElement | null {
  if (state === "unpushed") return null;

  const badge = document.createElement("span");
  badge.className = "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium";

  if (state === "dirty") {
    badge.classList.add("bg-warning-soft", "text-warning-strong");
    badge.textContent = "Edited since push";
  } else {
    badge.classList.add("bg-ok-soft", "text-ok-strong");
    badge.textContent = "Pushed";
  }

  return badge;
}
```

**Check the real token names first.** Read `web/src/styles.css`'s `@theme` block and use the
semantic colour tokens that exist there. #12 established amber as the warning tone; do not invent
tokens.

- [ ] **Step 2: Verify by eye in both themes**

Run `make up`, open a ticket with logged time, and confirm the badge reads correctly in light and
dark. Record what you saw.

- [ ] **Step 3: Lint and type-check**

Run: `make lint-web && make tsc`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/wd-entry-dialog.ts
git commit -m "feat(#9): show each entry's push state in the entry dialog"
```

---

### Task 7: The push button, its confirmation and its result

**Files:**
- Modify: `web/src/views/today.ts`

**Interfaces:**
- Consumes: `pushDay` (Task 5), `openConfirm` from `web/src/components/wd-confirm.ts`,
  `listEntries`, `announceEntriesChanged`
- Produces: a Push control in Today's header and a result alert

Read `wd-confirm.ts` for its actual API before writing this — `confirmAndDelete` in
`wd-entry-dialog.ts` shows a working call.

- [ ] **Step 1: Add the control**

Beside the existing Refresh button in `render`:

```ts
  const push = button("Push to Jira", "primary");
  header.append(heading, push, refresh);
  push.addEventListener("click", () => {
    void pushToday(regions);
  });
```

- [ ] **Step 2: Add the flow**

```ts
/**
 * Confirms, pushes, then reports per entry.
 *
 * The confirmation exists because a push writes real worklogs and, until #10,
 * the only way to undo one is Jira's own UI.
 */
async function pushToday(regions: Regions): Promise<void> {
  let entries: Entry[];
  try {
    entries = await listEntries();
  } catch (error) {
    regions.pushReport.replaceChildren(alertFor("danger", messageOf(error)));
    regions.pushReport.hidden = false;
    return;
  }

  const pending = entries.filter((entry) => entry.pushState === "unpushed");
  if (pending.length === 0) {
    regions.pushReport.replaceChildren(
      alertFor("info", "Everything logged today has already been pushed."),
    );
    regions.pushReport.hidden = false;
    return;
  }

  const confirmed = await confirmPush(pending);
  if (!confirmed) return;

  try {
    const response = await pushDay();
    renderPushReport(regions, response);
  } catch (error) {
    regions.pushReport.replaceChildren(alertFor("danger", messageOf(error)));
    regions.pushReport.hidden = false;
    return;
  }

  announceEntriesChanged(await listEntries());
}

/**
 * Names every entry that did not reach Jira. A count alone would be the blanket
 * status the spec calls a defect: with several entries against one ticket, "2
 * failed" does not say which two.
 */
function renderPushReport(regions: Regions, response: PushResponse): void {
  const failed = response.results.filter((result) => result.status === "failed");
  const pushed = response.results.filter((result) => result.status === "pushed");

  if (failed.length === 0) {
    regions.pushReport.replaceChildren(
      alertFor("success", `Pushed ${String(pushed.length)} ${pushed.length === 1 ? "entry" : "entries"} to Jira.`),
    );
    regions.pushReport.hidden = false;
    return;
  }

  const alert = alertFor(
    "warning",
    `${String(failed.length)} of ${String(response.results.length)} entries did not reach Jira. ` +
      "Press Push to Jira again to retry them.",
  );

  const list = document.createElement("ul");
  list.className = "mt-2 space-y-1 text-sm";
  for (const result of failed) {
    const item = document.createElement("li");
    item.textContent = `${result.issueKey} — ${result.error?.message ?? "unknown error"}`;
    list.append(item);
  }
  alert.append(list);

  regions.pushReport.replaceChildren(alert);
  regions.pushReport.hidden = false;
}
```

Import `pushDay` from `../api` and `PushResponse` from `../types`, alongside the imports the
file already has. Add `pushReport: HTMLElement` to the `Regions` interface, create it in `render` next to `stale`
with the same `hidden = true` treatment and the same reasoning (an empty box would contribute a
`space-y-4` margin), and include it in the `container.append(...)` call.

`alertFor` currently takes a tone string — check which tones `wd-alert` actually supports and use
those exact names rather than the ones written above.

- [ ] **Step 3: Lint and type-check**

Run: `make lint-web && make tsc`
Expected: PASS.

- [ ] **Step 4: Verify by hand**

`make up`, log two entries, press Push to Jira, confirm, and read the result. Record what you saw.

- [ ] **Step 5: Commit**

```bash
git add web/src/views/today.ts
git commit -m "feat(#9): push the day from Today, and name what did not make it"
```

---

### Task 8: The end-to-end spec

**Files:**
- Create: `.claude/e2e/tests/push.spec.ts`

**Interfaces:**
- Consumes: the whole stack through the browser. Stubs `/api/*` with `page.route`, as every other
  spec in this directory does — no test contacts Jira, real or fake.

- [ ] **Step 1: Write the spec**

Read `.claude/e2e/tests/entries.spec.ts` first and follow its stubbing style exactly.

```ts
import { expect, test } from "@playwright/test";

test("a push where one entry fails names the entry that did not make it", async ({ page }) => {
  await page.route("**/api/instances", (route) => route.fulfill({ status: 200, json: [] }));
  await page.route("**/api/issues", (route) => route.fulfill({ status: 200, json: { instances: [] } }));
  await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));

  await page.route("**/api/entries**", (route) =>
    route.fulfill({
      status: 200,
      json: [
        {
          id: 1, instanceId: 1, instanceName: "Site", instancePosition: 0,
          issueKey: "RIDGE-1", day: "2026-08-31", startedAt: "2026-08-31T09:00:00Z",
          seconds: 3600, comment: "one", pushState: "unpushed",
        },
        {
          id: 2, instanceId: 1, instanceName: "Site", instancePosition: 0,
          issueKey: "RIDGE-2", day: "2026-08-31", startedAt: "2026-08-31T10:00:00Z",
          seconds: 1800, comment: "two", pushState: "unpushed",
        },
      ],
    }),
  );

  await page.route("**/api/push**", (route) =>
    route.fulfill({
      status: 200,
      json: {
        day: "2026-08-31",
        results: [
          { entryId: 1, issueKey: "RIDGE-1", instanceId: 1, status: "pushed", worklogId: "wl-1" },
          {
            entryId: 2, issueKey: "RIDGE-2", instanceId: 1, status: "failed",
            error: { code: "instance_unreachable", message: "the Jira site could not be reached" },
          },
        ],
      },
    }),
  );

  await page.goto("/");
  await page.getByRole("button", { name: "Push to Jira" }).click();

  // The confirmation names what is about to be sent.
  await expect(page.getByText(/2 entries/)).toBeVisible();
  await page.getByRole("button", { name: /^Push$/ }).click();

  // The failure is named per entry, not summarised away.
  await expect(page.getByText(/1 of 2 entries did not reach Jira/)).toBeVisible();
  await expect(page.getByText(/RIDGE-2 — the Jira site could not be reached/)).toBeVisible();
  await expect(page.getByText("RIDGE-1 —")).toHaveCount(0);
});
```

Adjust the selectors to whatever the confirm dialog and alert actually render — run the suite and
read the failures rather than guessing.

- [ ] **Step 2: Run the suite**

Run: `make test-e2e`
Expected: PASS on both Firefox and Chromium, with no reduction in the existing 209 passing.

- [ ] **Step 3: Check the e2e paths gate**

`.github/workflows/e2e.yml` already covers `web/**` and `.claude/e2e/**`, so this needs no gate
edit. Confirm that is still true and say so in the task report.

- [ ] **Step 4: Commit**

```bash
git add .claude/e2e/tests/push.spec.ts
git commit -m "test(#9): cover a partial push failure end to end"
```

---

## Final gate

- [ ] `make verify` green — paste the output
- [ ] `make test-e2e` green — paste the counts
- [ ] Whole-branch code review on the most capable tier, then a fix wave and a scoped re-review
- [ ] Push the branch and open a pull request saying `Closes #9`

**Do not merge.** Merging into `main` locally is forbidden; the owner merges the pull request.
