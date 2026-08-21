# Pinned issues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-08-20
**Supersedes:** nothing
**Superseded by:** nothing

**Goal:** Pin issues from any instance through one cross-instance search box, render them in a Pinned card above the assigned issues on Today, and keep their summary and status cached so they paint without a Jira round trip.

**Architecture:** A new `pinned_issues` store layer and `/api/pins` resource, a new `/api/issues/search` fan-out that searches every instance by key and by title, and a `wd-combobox` component driving the form. The three fan-outs in the codebase — assigned issues, pin refresh, search — move onto one extracted `fanOutInstances` helper, re-proved against #5's mutation guard.

**Tech Stack:** Go 1.26 standard library plus `modernc.org/sqlite` and `golang.org/x/sync/errgroup`; vanilla TypeScript with Tailwind v4; Playwright for the UI.

**Spec:** `docs/superpowers/specs/2026-08-20-pinned-issues-design.md`

## Global Constraints

- **Everything runs in Docker.** No Go, Node or npm on the host. Every command below is a `make` target or `docker compose run`.
- **No JavaScript frameworks.** Vanilla JS/TS only.
- **Tailwind CSS v4**, CSS-first. Theme values live in `@theme` in `web/src/styles.css`. Use the semantic tokens (`bg-raised`, `text-ink-muted`, `border-edge`, …), never a stock colour utility.
- **WebComponents are `wd-*`, light DOM, never shadow DOM.**
- **TypeScript is `strict` with `noUncheckedIndexedAccess`.** No `any`, no `as any`, no non-null assertion.
- **No test ever contacts a real Jira instance.** Go tests use `httptest`; Playwright stubs `/api/*` with `page.route`.
- **Browser support is Firefox and Chromium.** Safari and WebKit are an explicit non-goal.
- **Comments are few** and explain *why*, never what the next line does.
- **Function names must let a reader predict the return value.** No bare `process`, `handle`, `build`.
- **The branch is `issue-6-pinned-issues`, rebased onto `main` on 2026-08-21** once #5 (PR #38) and #44 (PR #52) had merged — nothing is stacked on anything any more. Never merge to `main` locally.
- Verification gate: `make verify` (lint, tsc, Go tests) and `make test-e2e` (Playwright). Both must be green and their output pasted before the pull request.

## File structure

| File | Responsibility |
|---|---|
| `internal/store/migrations/2026-08-20_100000_pin_status_cache.sql` | Adds `status_cache` |
| `internal/store/pins.go` | `Pin`, `PinInput`, CRUD, `ErrPinExists` |
| `internal/store/pins_test.go` | Store behaviour, including the unique constraint and the cascade |
| `internal/jira/issue.go` | `Client.Issue` — one issue by key |
| `internal/jira/issue_test.go` | Its wire format and escaping |
| `internal/jira/search.go` | Gains `SearchText` and `escapeJQL` beside `SearchAssigned` |
| `internal/server/fanout.go` | `fanOutInstances`, extracted from `issues.go` |
| `internal/server/pins.go` | `/api/pins` — list, create, delete, refresh |
| `internal/server/issue_search.go` | `/api/issues/search` |
| `web/src/components/wd-combobox.ts` | Searchable select with listbox and keyboard nav |
| `web/src/views/today.ts` | Pinned card, dedupe, refresh wiring |
| `.claude/e2e/tests/pins.spec.ts` | The user-visible behaviour this ticket promises |

**Task order matters in one place:** Task 4 extracts `fanOutInstances`, and Tasks 7 and 8 consume it. Do not reorder those.

---

### Task 1: The `status_cache` migration and the pins store

**Files:**
- Create: `internal/store/migrations/2026-08-20_100000_pin_status_cache.sql`
- Create: `internal/store/pins.go`
- Test: `internal/store/pins_test.go`
- Modify: `docs/superpowers/specs/2026-08-04-work-dashboard-design.md` (the `pinned_issues` block)

**Interfaces:**
- Consumes: `openTestStore(t)` and `createTestInstance(t, s)` from `internal/store/store_test.go` and `instances_test.go`; the `scanner` interface and `nullable` from `instances.go`.
- Produces: `store.Pin{ID, InstanceID, IssueKey, SummaryCache, StatusCache, CreatedAt}`, `store.PinInput{InstanceID, IssueKey, SummaryCache, StatusCache}`, `store.ErrPinExists`, and the methods `Pins(ctx) ([]Pin, error)`, `CreatePin(ctx, PinInput) (*Pin, error)`, `SetPinCache(ctx, id int64, summary, status string) error`, `DeletePin(ctx, id int64) error`.

- [ ] **Step 1: Write the failing tests**

Create `internal/store/pins_test.go`:

```go
package store

import (
	"context"
	"database/sql"
	"errors"
	"testing"
)

func createTestPin(t *testing.T, s *Store, instanceID int64, key string) *Pin {
	t.Helper()

	pin, err := s.CreatePin(context.Background(), PinInput{
		InstanceID:   instanceID,
		IssueKey:     key,
		SummaryCache: "Weekly standup",
		StatusCache:  "In Progress",
	})
	if err != nil {
		t.Fatalf("creating pin %q: %v", key, err)
	}

	return pin
}

func TestCreatePinReturnsTheStoredRow(t *testing.T) {
	s := openTestStore(t)
	inst := createTestInstance(t, s)

	pin := createTestPin(t, s, inst.ID, "SHARED-12")

	if pin.ID == 0 {
		t.Error("ID = 0, want an assigned id")
	}
	if pin.IssueKey != "SHARED-12" {
		t.Errorf("IssueKey = %q, want SHARED-12", pin.IssueKey)
	}
	if pin.SummaryCache != "Weekly standup" {
		t.Errorf("SummaryCache = %q, want Weekly standup", pin.SummaryCache)
	}
	if pin.StatusCache != "In Progress" {
		t.Errorf("StatusCache = %q, want In Progress", pin.StatusCache)
	}
	if pin.CreatedAt.IsZero() {
		t.Error("CreatedAt is zero")
	}
}

func TestPinsRoundTripBothCaches(t *testing.T) {
	s := openTestStore(t)
	inst := createTestInstance(t, s)
	createTestPin(t, s, inst.ID, "SHARED-12")

	pins, err := s.Pins(context.Background())
	if err != nil {
		t.Fatalf("reading pins: %v", err)
	}
	if len(pins) != 1 {
		t.Fatalf("got %d pins, want 1", len(pins))
	}
	if pins[0].SummaryCache != "Weekly standup" || pins[0].StatusCache != "In Progress" {
		t.Errorf("caches = %q/%q, want Weekly standup/In Progress",
			pins[0].SummaryCache, pins[0].StatusCache)
	}
}

// The UNIQUE(instance_id, issue_key) constraint has to reach the handler as
// something it can answer 409 to, not as an opaque driver error.
func TestPinningTheSameKeyTwiceIsRejected(t *testing.T) {
	s := openTestStore(t)
	inst := createTestInstance(t, s)
	createTestPin(t, s, inst.ID, "SHARED-12")

	_, err := s.CreatePin(context.Background(), PinInput{
		InstanceID: inst.ID, IssueKey: "SHARED-12", SummaryCache: "Again", StatusCache: "To Do",
	})

	if !errors.Is(err, ErrPinExists) {
		t.Errorf("err = %v, want ErrPinExists", err)
	}
}

// The constraint is per instance, not global: the same shared key can exist on
// two sites and both are pinnable.
func TestTheSameKeyOnAnotherInstanceIsAllowed(t *testing.T) {
	s := openTestStore(t)
	first := createTestInstance(t, s)
	second, err := s.CreateInstance(context.Background(), InstanceInput{
		Name: "Second", SiteURL: "https://second.atlassian.net",
		Email: "a@b.c", TokenEnc: []byte("sealed"),
	})
	if err != nil {
		t.Fatalf("creating the second instance: %v", err)
	}
	createTestPin(t, s, first.ID, "SHARED-12")

	if _, err := s.CreatePin(context.Background(), PinInput{
		InstanceID: second.ID, IssueKey: "SHARED-12", SummaryCache: "Standup", StatusCache: "Open",
	}); err != nil {
		t.Errorf("pinning the same key on another instance: %v", err)
	}
}

func TestSetPinCacheRewritesBothColumns(t *testing.T) {
	s := openTestStore(t)
	inst := createTestInstance(t, s)
	pin := createTestPin(t, s, inst.ID, "SHARED-12")

	if err := s.SetPinCache(context.Background(), pin.ID, "Renamed standup", "Done"); err != nil {
		t.Fatalf("rewriting the cache: %v", err)
	}

	pins, err := s.Pins(context.Background())
	if err != nil {
		t.Fatalf("reading pins: %v", err)
	}
	if pins[0].SummaryCache != "Renamed standup" || pins[0].StatusCache != "Done" {
		t.Errorf("caches = %q/%q, want Renamed standup/Done",
			pins[0].SummaryCache, pins[0].StatusCache)
	}
}

func TestSetPinCacheOnAMissingIDIsNotFound(t *testing.T) {
	s := openTestStore(t)

	err := s.SetPinCache(context.Background(), 404, "x", "y")

	if !errors.Is(err, sql.ErrNoRows) {
		t.Errorf("err = %v, want sql.ErrNoRows", err)
	}
}

func TestDeletePinRemovesTheRow(t *testing.T) {
	s := openTestStore(t)
	inst := createTestInstance(t, s)
	pin := createTestPin(t, s, inst.ID, "SHARED-12")

	if err := s.DeletePin(context.Background(), pin.ID); err != nil {
		t.Fatalf("deleting the pin: %v", err)
	}

	pins, err := s.Pins(context.Background())
	if err != nil {
		t.Fatalf("reading pins: %v", err)
	}
	if len(pins) != 0 {
		t.Errorf("got %d pins, want 0", len(pins))
	}
}

func TestDeletePinOnAMissingIDIsNotFound(t *testing.T) {
	s := openTestStore(t)

	err := s.DeletePin(context.Background(), 404)

	if !errors.Is(err, sql.ErrNoRows) {
		t.Errorf("err = %v, want sql.ErrNoRows", err)
	}
}

// The view iterates the result without a null check.
func TestPinsIsEmptyNotNilWhenNoneStored(t *testing.T) {
	s := openTestStore(t)

	pins, err := s.Pins(context.Background())
	if err != nil {
		t.Fatalf("reading pins: %v", err)
	}
	if pins == nil {
		t.Fatal("Pins returned nil, want an empty slice")
	}
	if len(pins) != 0 {
		t.Errorf("got %d pins, want 0", len(pins))
	}
}

func TestDeletingAnInstanceTakesItsPins(t *testing.T) {
	s := openTestStore(t)
	inst := createTestInstance(t, s)
	createTestPin(t, s, inst.ID, "SHARED-12")

	if err := s.DeleteInstance(context.Background(), inst.ID); err != nil {
		t.Fatalf("deleting the instance: %v", err)
	}

	pins, err := s.Pins(context.Background())
	if err != nil {
		t.Fatalf("reading pins: %v", err)
	}
	if len(pins) != 0 {
		t.Errorf("got %d pins after the cascade, want 0", len(pins))
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```shell
docker compose run --rm --no-deps app go test ./internal/store/ -run TestPin -v
```

Expected: FAIL — `undefined: PinInput`, `undefined: Pin`, `undefined: ErrPinExists`.

- [ ] **Step 3: Write the migration**

Create `internal/store/migrations/2026-08-20_100000_pin_status_cache.sql`:

```sql
-- status_cache lets a refreshed pin still look refreshed after a reload.
-- ADD COLUMN needs no table rebuild, so unlike the URL split this cannot
-- cascade into time_entries.
ALTER TABLE pinned_issues ADD COLUMN status_cache TEXT;
```

- [ ] **Step 4: Write the store**

Create `internal/store/pins.go`:

```go
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"
)

// Pin is an issue kept on the Today view whether or not it is assigned to the
// user. Both caches are written when the pin is created and rewritten by a
// refresh; they read as "" only for a row written before status_cache existed.
type Pin struct {
	ID           int64
	InstanceID   int64
	IssueKey     string
	SummaryCache string
	StatusCache  string
	CreatedAt    time.Time
}

// PinInput carries what a caller supplies when pinning. The caches are inputs
// rather than something the store fetches: resolving them needs a Jira client,
// which the store has no business holding.
type PinInput struct {
	InstanceID   int64
	IssueKey     string
	SummaryCache string
	StatusCache  string
}

// ErrPinExists reports the UNIQUE(instance_id, issue_key) violation. Without it
// the handler could not tell a duplicate from a disk failure, and would answer
// 500 where it owes a 409.
var ErrPinExists = errors.New("store: issue already pinned on this instance")

const pinColumns = `id, instance_id, issue_key, summary_cache, status_cache, created_at`

func scanPin(row scanner) (*Pin, error) {
	var (
		pin       Pin
		summary   sql.NullString
		status    sql.NullString
		createdAt string
	)
	if err := row.Scan(
		&pin.ID, &pin.InstanceID, &pin.IssueKey, &summary, &status, &createdAt,
	); err != nil {
		return nil, err
	}
	pin.SummaryCache = summary.String
	pin.StatusCache = status.String

	parsed, err := time.Parse(time.RFC3339, createdAt)
	if err != nil {
		return nil, fmt.Errorf("parsing created_at %q: %w", createdAt, err)
	}
	pin.CreatedAt = parsed

	return &pin, nil
}

// isUniqueViolation reports the constraint failure by its SQLite code rather
// than by matching the driver's message, which is not part of any contract.
func isUniqueViolation(err error) bool {
	var sqliteErr *sqlite.Error

	return errors.As(err, &sqliteErr) && sqliteErr.Code() == sqlite3.SQLITE_CONSTRAINT_UNIQUE
}

// CreatePin stores a pin and returns it with its assigned id.
func (s *Store) CreatePin(ctx context.Context, in PinInput) (*Pin, error) {
	// Truncated because created_at is stored as RFC3339, which has one-second
	// resolution. Without this the returned value would not equal the stored one.
	createdAt := time.Now().UTC().Truncate(time.Second)

	result, err := s.db.ExecContext(ctx,
		`INSERT INTO pinned_issues (instance_id, issue_key, summary_cache, status_cache, created_at)
		 VALUES (?, ?, ?, ?, ?)`,
		in.InstanceID, in.IssueKey, nullable(in.SummaryCache), nullable(in.StatusCache),
		createdAt.Format(time.RFC3339),
	)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, fmt.Errorf("pinning %q on instance %d: %w",
				in.IssueKey, in.InstanceID, ErrPinExists)
		}

		return nil, fmt.Errorf("pinning %q on instance %d: %w", in.IssueKey, in.InstanceID, err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("reading id of new pin %q: %w", in.IssueKey, err)
	}

	return &Pin{
		ID: id, InstanceID: in.InstanceID, IssueKey: in.IssueKey,
		SummaryCache: in.SummaryCache, StatusCache: in.StatusCache, CreatedAt: createdAt,
	}, nil
}

// Pins returns every pin, oldest first, ordered as Instances is and for the
// same reason: id is a reusable rowid, so it cannot carry insertion order.
func (s *Store) Pins(ctx context.Context) ([]Pin, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+pinColumns+` FROM pinned_issues ORDER BY created_at, id`)
	if err != nil {
		return nil, fmt.Errorf("querying pins: %w", err)
	}
	defer func() { _ = rows.Close() }()

	pins := []Pin{}
	for rows.Next() {
		pin, err := scanPin(rows)
		if err != nil {
			return nil, fmt.Errorf("scanning pin: %w", err)
		}
		pins = append(pins, *pin)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating pins: %w", err)
	}

	return pins, nil
}

// SetPinCache rewrites what a refresh learned. A missing id yields an error
// wrapping sql.ErrNoRows.
func (s *Store) SetPinCache(ctx context.Context, id int64, summary, status string) error {
	result, err := s.db.ExecContext(ctx,
		`UPDATE pinned_issues SET summary_cache = ?, status_cache = ? WHERE id = ?`,
		nullable(summary), nullable(status), id)
	if err != nil {
		return fmt.Errorf("updating the cache of pin %d: %w", id, err)
	}

	return errNoRowsIfUnaffected(result, "updating the cache of pin", id)
}

// DeletePin removes a pin. A missing id yields an error wrapping sql.ErrNoRows.
func (s *Store) DeletePin(ctx context.Context, id int64) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM pinned_issues WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("deleting pin %d: %w", id, err)
	}

	return errNoRowsIfUnaffected(result, "deleting pin", id)
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```shell
docker compose run --rm --no-deps app go test ./internal/store/ -v
```

Expected: PASS, including the pre-existing `TestOpenCreatesEverySchemaTable` and `TestMigrateIsIdempotent`.

- [ ] **Step 6: Update the design of record's schema block**

In `docs/superpowers/specs/2026-08-04-work-dashboard-design.md`, add the column to the `pinned_issues` table so the spec and the database do not drift:

```sql
  summary_cache  TEXT,                   -- so pins render without a Jira round trip
  status_cache   TEXT,                   -- written with it, so a refresh survives a reload
```

- [ ] **Step 7: Commit**

```shell
git add internal/store/pins.go internal/store/pins_test.go \
  internal/store/migrations/2026-08-20_100000_pin_status_cache.sql \
  docs/superpowers/specs/2026-08-04-work-dashboard-design.md
git commit -m "feat(store): pins, with both caches and a real duplicate error"
```

---

### Task 2: `jira.Client.Issue` — one issue by key

**Files:**
- Create: `internal/jira/issue.go`
- Test: `internal/jira/issue_test.go`

**Interfaces:**
- Consumes: `newTestClient(t, handler)` from `internal/jira/client_test.go`; `Client.do`, the `Issue` struct and the sentinels from `client.go`, `search.go` and `errors.go`.
- Produces: `func (c *Client) Issue(ctx context.Context, key string) (*Issue, error)`.

- [ ] **Step 1: Write the failing tests**

Create `internal/jira/issue_test.go`:

```go
package jira_test

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/dgerrese/work-dashboard/internal/jira"
)

func TestIssueReturnsSummaryAndStatus(t *testing.T) {
	var gotPath, gotFields string
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotFields = r.URL.Query().Get("fields")
		_, _ = w.Write([]byte(`{"key":"SHARED-12","fields":{` +
			`"summary":"Weekly standup","status":{"name":"In Progress"}}}`))
	})

	issue, err := client.Issue(context.Background(), "SHARED-12")

	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	if gotPath != "/rest/api/3/issue/SHARED-12" {
		t.Errorf("path = %q, want /rest/api/3/issue/SHARED-12", gotPath)
	}
	// Without naming fields the endpoint returns everything, which is a much
	// larger response for two strings.
	if gotFields != "summary,status" {
		t.Errorf("fields = %q, want summary,status", gotFields)
	}
	if issue.Key != "SHARED-12" {
		t.Errorf("Key = %q, want SHARED-12", issue.Key)
	}
	if issue.Summary != "Weekly standup" {
		t.Errorf("Summary = %q, want Weekly standup", issue.Summary)
	}
	if issue.Status != "In Progress" {
		t.Errorf("Status = %q, want In Progress", issue.Status)
	}
}

// A key the user typed reaches the URL path. Left unescaped, a stray character
// addresses a different resource.
func TestIssueKeyIsEscapedIntoThePath(t *testing.T) {
	var gotPath string
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		_, _ = w.Write([]byte(`{"key":"A/B-1","fields":{"summary":"s","status":{"name":"n"}}}`))
	})

	if _, err := client.Issue(context.Background(), "A/B-1"); err != nil {
		t.Fatalf("Issue: %v", err)
	}

	if gotPath != "/rest/api/3/issue/A/B-1" {
		t.Errorf("path = %q; the slash must arrive escaped, not as a path separator", gotPath)
	}
}

func TestIssueMapsAMissingKeyToNotFound(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	})

	_, err := client.Issue(context.Background(), "NOPE-1")

	if !errors.Is(err, jira.ErrNotFound) {
		t.Errorf("err = %v, want ErrNotFound", err)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```shell
docker compose run --rm --no-deps app go test ./internal/jira/ -run TestIssue -v
```

Expected: FAIL — `client.Issue undefined`.

- [ ] **Step 3: Write the implementation**

Create `internal/jira/issue.go`:

```go
package jira

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
)

type issueResponse struct {
	Key    string `json:"key"`
	Fields struct {
		Summary string `json:"summary"`
		Status  struct {
			Name string `json:"name"`
		} `json:"status"`
	} `json:"fields"`
}

// Issue returns one issue by key. A key that does not exist on this site is
// ErrNotFound, which the caller reads as an ordinary answer rather than a fault.
func (c *Client) Issue(ctx context.Context, key string) (*Issue, error) {
	query := url.Values{"fields": {"summary,status"}}

	var resp issueResponse
	path := "/rest/api/3/issue/" + url.PathEscape(key)
	if err := c.do(ctx, http.MethodGet, path, query, nil, &resp); err != nil {
		return nil, fmt.Errorf("reading issue %q: %w", key, err)
	}

	return &Issue{
		Key:     resp.Key,
		Summary: resp.Fields.Summary,
		Status:  resp.Fields.Status.Name,
	}, nil
}
```

**Check `c.do`'s signature before writing this** — read `internal/jira/client.go:59`. If the query parameter is not the third argument, match the real order; `worklog.go:93` shows a call with a query and `myself.go:21` one without.

- [ ] **Step 4: Run the tests to verify they pass**

```shell
docker compose run --rm --no-deps app go test ./internal/jira/ -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```shell
git add internal/jira/issue.go internal/jira/issue_test.go
git commit -m "feat(jira): read one issue by key"
```

---

### Task 3: `jira.Client.SearchText` and `escapeJQL`

**Files:**
- Modify: `internal/jira/search.go`
- Test: `internal/jira/search_test.go`

**Interfaces:**
- Consumes: `searchRequest`, `searchResponse` and `Issue` from `search.go`; `newTestClient` from `client_test.go`.
- Produces: `func (c *Client) SearchText(ctx context.Context, query string, limit int) ([]Issue, error)` and the unexported `escapeJQL(string) string`.

- [ ] **Step 1: Write the failing tests**

Append to `internal/jira/search_test.go`:

```go
func TestSearchTextSendsAPrefixMatchOnSummary(t *testing.T) {
	var got struct {
		JQL        string   `json:"jql"`
		Fields     []string `json:"fields"`
		MaxResults int      `json:"maxResults"`
	}
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Errorf("decoding the request: %v", err)
		}
		_, _ = w.Write([]byte(`{"issues":[{"key":"SHARED-40","fields":{` +
			`"summary":"Vendor security review","status":{"name":"To Do"}}}]}`))
	})

	issues, err := client.SearchText(context.Background(), "security", 10)

	if err != nil {
		t.Fatalf("SearchText: %v", err)
	}
	want := `summary ~ "security*" AND statusCategory != Done ORDER BY updated DESC`
	if got.JQL != want {
		t.Errorf("jql = %q, want %q", got.JQL, want)
	}
	if got.MaxResults != 10 {
		t.Errorf("maxResults = %d, want 10", got.MaxResults)
	}
	if len(got.Fields) != 2 || got.Fields[0] != "summary" || got.Fields[1] != "status" {
		t.Errorf("fields = %v, want [summary status]", got.Fields)
	}
	if len(issues) != 1 || issues[0].Key != "SHARED-40" {
		t.Errorf("issues = %v, want one SHARED-40", issues)
	}
	if issues[0].Status != "To Do" {
		t.Errorf("Status = %q, want To Do; the picker endpoint was rejected for lacking this",
			issues[0].Status)
	}
}

// A type-ahead that walks a hundred pages is a bug. One page, and a
// nextPageToken in the response is deliberately not followed.
func TestSearchTextDoesNotPage(t *testing.T) {
	calls := 0
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		_, _ = w.Write([]byte(`{"issues":[{"key":"A-1","fields":{"summary":"s",` +
			`"status":{"name":"n"}}}],"nextPageToken":"more"}`))
	})

	if _, err := client.SearchText(context.Background(), "security", 10); err != nil {
		t.Fatalf("SearchText: %v", err)
	}

	if calls != 1 {
		t.Errorf("made %d requests, want 1", calls)
	}
}

func TestSearchTextReturnsEmptyNotNil(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"issues":[]}`))
	})

	issues, err := client.SearchText(context.Background(), "nothing", 10)

	if err != nil {
		t.Fatalf("SearchText: %v", err)
	}
	if issues == nil {
		t.Error("SearchText returned nil, want an empty slice")
	}
}

// A quote in the query would otherwise close the JQL string literal early and
// turn the rest of it into syntax.
func TestEscapeJQLEscapesQuotesAndBackslashes(t *testing.T) {
	tests := []struct {
		name  string
		query string
		want  string
	}{
		{"plain", `security`, `security`},
		{"quote", `He said "hi"`, `He said \"hi\"`},
		{"backslash", `a\b`, `a\\b`},
		{"both", `a\"b`, `a\\\"b`},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := escapeJQL(tc.query); got != tc.want {
				t.Errorf("escapeJQL(%q) = %q, want %q", tc.query, got, tc.want)
			}
		})
	}
}

func TestSearchTextEscapesTheQueryIntoTheJQL(t *testing.T) {
	var got struct {
		JQL string `json:"jql"`
	}
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Errorf("decoding the request: %v", err)
		}
		_, _ = w.Write([]byte(`{"issues":[]}`))
	})

	if _, err := client.SearchText(context.Background(), `say "hi"`, 10); err != nil {
		t.Fatalf("SearchText: %v", err)
	}

	want := `summary ~ "say \"hi\"*" AND statusCategory != Done ORDER BY updated DESC`
	if got.JQL != want {
		t.Errorf("jql = %q, want %q", got.JQL, want)
	}
}
```

`escapeJQL` is unexported, so these tests must live in package `jira`, not `jira_test`. **Check the top of `search_test.go`:** if it declares `package jira_test`, put the `escapeJQL` table-driven test in a new `internal/jira/search_internal_test.go` with `package jira` and leave the rest where they are. `internal/server/server_internal_test.go` is the precedent for that split.

Add `"encoding/json"` to the test file's imports if it is not already there.

- [ ] **Step 2: Run the tests to verify they fail**

```shell
docker compose run --rm --no-deps app go test ./internal/jira/ -run 'TestSearchText|TestEscapeJQL' -v
```

Expected: FAIL — `client.SearchText undefined`, `undefined: escapeJQL`.

- [ ] **Step 3: Write the implementation**

Append to `internal/jira/search.go`:

```go
// escapeJQL makes a user's text safe inside a JQL string literal. Backslashes
// go first: escaping them after the quotes would escape the backslashes this
// function just added.
func escapeJQL(query string) string {
	escaped := strings.ReplaceAll(query, `\`, `\\`)

	return strings.ReplaceAll(escaped, `"`, `\"`)
}

// SearchText finds issues whose summary starts a word with query, most recently
// updated first.
//
// Three properties of Jira's ~ operator shape this and cannot be worked around
// here: it matches word prefixes rather than substrings, a leading wildcard is
// rejected by the endpoint outright, and the * belongs inside the quotes. So
// "secur" finds "security" and "curity" finds nothing.
//
// Unlike SearchAssigned this does not page: it backs a type-ahead, where a
// second page is latency spent on results nobody scrolls to.
func (c *Client) SearchText(ctx context.Context, query string, limit int) ([]Issue, error) {
	jql := fmt.Sprintf(
		`summary ~ "%s*" AND statusCategory != Done ORDER BY updated DESC`, escapeJQL(query))

	body := searchRequest{
		JQL:        jql,
		Fields:     []string{"summary", "status"},
		MaxResults: limit,
	}

	var resp searchResponse
	if err := c.do(ctx, http.MethodPost, "/rest/api/3/search/jql", nil, body, &resp); err != nil {
		return nil, fmt.Errorf("searching for %q: %w", query, err)
	}

	issues := []Issue{}
	for _, raw := range resp.Issues {
		issues = append(issues, Issue{
			Key:     raw.Key,
			Summary: raw.Fields.Summary,
			Status:  raw.Fields.Status.Name,
		})
	}

	return issues, nil
}
```

Add `"strings"` to the imports of `search.go`.

- [ ] **Step 4: Run the tests to verify they pass**

```shell
docker compose run --rm --no-deps app go test ./internal/jira/ -v
```

Expected: PASS, `SearchAssigned`'s existing tests included.

- [ ] **Step 5: Commit**

```shell
git add internal/jira/search.go internal/jira/search_test.go internal/jira/search_internal_test.go
git commit -m "feat(jira): search issues by summary prefix"
```

---

### Task 4: Extract `fanOutInstances`, and re-prove #5's guard against it

This task changes no behaviour. Its deliverable is that the same tests pass against extracted code, **and that the guard test still fails when the extraction is broken.** A refactor that cannot be shown to break the test it was meant to preserve has not been verified.

**Files:**
- Create: `internal/server/fanout.go`
- Modify: `internal/server/issues.go`

**Interfaces:**
- Consumes: `store.Instance`.
- Produces: `func fanOutInstances[T any](ctx context.Context, instances []store.Instance, timeout time.Duration, work func(context.Context, store.Instance) T) []T`.

- [ ] **Step 1: Write the helper**

Create `internal/server/fanout.go`:

```go
package server

import (
	"context"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/dgerrese/work-dashboard/internal/store"
)

// fanOutInstances runs work against every instance concurrently and returns one
// result per instance, in the order given.
//
// errgroup is here for Wait and its context, not for error propagation: work
// returns a value rather than an error precisely so that one instance failing
// cannot cancel the others. That is the property three endpoints depend on —
// assigned issues, the pin refresh and the issue search — and the reason this
// helper exists instead of a third copy.
//
// Each call is bounded by its own timeout, so one stalled site holds nothing
// but its own slot.
func fanOutInstances[T any](
	ctx context.Context,
	instances []store.Instance,
	timeout time.Duration,
	work func(context.Context, store.Instance) T,
) []T {
	// Preallocated and written by index, so the result order is the caller's
	// order without a mutex and without sorting afterwards.
	results := make([]T, len(instances))

	group, ctx := errgroup.WithContext(ctx)
	for i, inst := range instances {
		group.Go(func() error {
			callCtx, cancel := context.WithTimeout(ctx, timeout)
			defer cancel()

			results[i] = work(callCtx, inst)

			return nil
		})
	}
	_ = group.Wait()

	return results
}
```

- [ ] **Step 2: Move `handleListIssues` onto it**

In `internal/server/issues.go`, replace the body of `handleListIssues` from `groups := make(...)` through `_ = group.Wait()` with:

```go
	groups := fanOutInstances(r.Context(), instances, issueFetchTimeout, s.issuesForInstance)
```

and delete the now-unused `errgroup` import. Then remove the `context.WithTimeout` from `issuesForInstance`, since the helper now owns it — its signature stays `func (s *Server) issuesForInstance(ctx context.Context, inst store.Instance) instanceIssuesDTO`, so it matches `work` directly.

Keep the comment explaining why every goroutine returns nil where a reader will meet it: it now belongs on `fanOutInstances`, and `issues.go` should carry a one-line pointer rather than a duplicate.

- [ ] **Step 3: Run the existing suite to verify nothing changed**

```shell
docker compose run --rm --no-deps app go test ./internal/server/ -v
```

Expected: PASS, unchanged — in particular `TestGetIssuesKeepsWorkingInstancesWhenOneFails`.

- [ ] **Step 4: Prove the guard still bites**

Temporarily break the helper: in `fanOutInstances`, change the goroutine body to propagate a failure so the group cancels its siblings —

```go
		group.Go(func() error {
			callCtx, cancel := context.WithTimeout(ctx, timeout)
			defer cancel()

			results[i] = work(callCtx, inst)

			return ctx.Err() // deliberate break: cancels siblings
		})
```

Run:

```shell
docker compose run --rm --no-deps app go test ./internal/server/ -run TestGetIssuesKeepsWorkingInstancesWhenOneFails -v
```

Expected: **FAIL** with "a sibling's failure blanked it". If it passes, the extraction has silently dropped the property and the delay on the healthy instance is no longer doing its job — stop and report that rather than continuing.

**Then revert the deliberate break** and re-run to confirm PASS.

- [ ] **Step 5: Commit**

```shell
git add internal/server/fanout.go internal/server/issues.go
git commit -m "refactor(api): one fan-out for three callers"
```

---

### Task 5: `GET /api/pins` and `DELETE /api/pins/{id}`

**Files:**
- Create: `internal/server/pins.go`
- Test: `internal/server/pins_test.go`
- Modify: `internal/server/server.go` (routes)

**Interfaces:**
- Consumes: `store.Pin`, `store.Pins`, `store.DeletePin`; `writeJSON`, `writeError`, `errorBody` from `json.go`; `browseURL` from `issues.go`; `newServerWithStore(t)` and `seedInstance` from `issues_test.go`.
- Produces: `pinDTO{ID, InstanceID, InstanceName, Key, Summary, Status, URL, Error}` as JSON `{id, instanceId, instanceName, key, summary, status, url, error}`; handlers `handleListPins`, `handleDeletePin`.

- [ ] **Step 1: Write the failing tests**

Create `internal/server/pins_test.go`:

```go
package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dgerrese/work-dashboard/internal/store"
)

func getPins(t *testing.T, srv *Server, query string) (*httptest.ResponseRecorder, []pinDTO) {
	t.Helper()

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/pins"+query, nil))

	var body []pinDTO
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decoding the response %s: %v", rec.Body.String(), err)
		}
	}

	return rec, body
}

func TestGetPinsReadsTheStoreAndNamesTheInstance(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	inst := seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", "https://api.example")
	if _, err := db.CreatePin(context.Background(), store.PinInput{
		InstanceID: inst.ID, IssueKey: "SHARED-12",
		SummaryCache: "Weekly standup", StatusCache: "In Progress",
	}); err != nil {
		t.Fatalf("creating the pin: %v", err)
	}

	rec, body := getPins(t, srv, "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if len(body) != 1 {
		t.Fatalf("got %d pins, want 1", len(body))
	}
	pin := body[0]
	if pin.InstanceName != "Work" {
		t.Errorf("instanceName = %q, want Work; the browser must not have to resolve the id",
			pin.InstanceName)
	}
	if pin.Summary != "Weekly standup" || pin.Status != "In Progress" {
		t.Errorf("summary/status = %q/%q, want the cached values", pin.Summary, pin.Status)
	}
	if pin.URL != "https://work.atlassian.net/browse/SHARED-12" {
		t.Errorf("url = %q, want the browse URL", pin.URL)
	}
	if pin.Error != nil {
		t.Errorf("error = %v on a plain GET, want nil", pin.Error)
	}
}

// The whole point of the cache columns: no Jira call on load. The seeded
// instance points at a server that fails the test if it is ever reached.
func TestGetPinsMakesNoJiraRequest(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	jiraSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("a plain GET /api/pins reached Jira at %s", r.URL.Path)
	}))
	t.Cleanup(jiraSrv.Close)
	inst := seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", jiraSrv.URL)
	if _, err := db.CreatePin(context.Background(), store.PinInput{
		InstanceID: inst.ID, IssueKey: "SHARED-12", SummaryCache: "Standup", StatusCache: "Open",
	}); err != nil {
		t.Fatalf("creating the pin: %v", err)
	}

	rec, _ := getPins(t, srv, "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestGetPinsWithNoneStoredIsAnEmptyArray(t *testing.T) {
	srv, _, _ := newServerWithStore(t)

	rec, _ := getPins(t, srv, "")

	// Asserted on the raw body: decoding cannot tell [] from null, and the view
	// iterates the array.
	if strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Errorf("body = %s, want []", rec.Body.String())
	}
}

func TestDeletePinRemovesIt(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	inst := seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", "https://api.example")
	pin, err := db.CreatePin(context.Background(), store.PinInput{
		InstanceID: inst.ID, IssueKey: "SHARED-12", SummaryCache: "Standup", StatusCache: "Open",
	})
	if err != nil {
		t.Fatalf("creating the pin: %v", err)
	}

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete,
		"/api/pins/"+strconv.FormatInt(pin.ID, 10), nil))

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNoContent)
	}
	_, body := getPins(t, srv, "")
	if len(body) != 0 {
		t.Errorf("got %d pins after the delete, want 0", len(body))
	}
}

func TestDeleteMissingPinIsNotFound(t *testing.T) {
	srv, _, _ := newServerWithStore(t)

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/api/pins/404", nil))

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
	if !strings.Contains(rec.Body.String(), "pin_not_found") {
		t.Errorf("body = %s, want the pin_not_found code", rec.Body.String())
	}
}

func TestDeletePinRejectsANonNumericID(t *testing.T) {
	srv, _, _ := newServerWithStore(t)

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/api/pins/abc", nil))

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}
```

Add `"strconv"` to the imports.

**Check how the instance handlers parse `{id}`** — read `internal/server/instances.go` for its id-parsing helper and reuse it rather than writing a second one. If it is unexported and named something like `pathID`, call that.

- [ ] **Step 2: Run the tests to verify they fail**

```shell
docker compose run --rm --no-deps app go test ./internal/server/ -run TestGetPins -v
```

Expected: FAIL — `undefined: pinDTO`.

- [ ] **Step 3: Write the handlers**

Create `internal/server/pins.go`:

```go
package server

import (
	"database/sql"
	"errors"
	"net/http"

	"github.com/dgerrese/work-dashboard/internal/store"
)

// pinDTO is one pin as the Pinned card needs it. InstanceName is joined in here
// rather than resolved in the browser, which would be a round trip to answer a
// question the server already had in hand.
//
// Error is non-nil only on a refresh that failed; Summary and Status stay the
// cached values in that case, so a failed refresh never blanks a row.
type pinDTO struct {
	ID           int64      `json:"id"`
	InstanceID   int64      `json:"instanceId"`
	InstanceName string     `json:"instanceName"`
	Key          string     `json:"key"`
	Summary      string     `json:"summary"`
	Status       string     `json:"status"`
	URL          string     `json:"url"`
	Error        *errorBody `json:"error"`
}

func pinDTOFrom(pin store.Pin, inst store.Instance) pinDTO {
	return pinDTO{
		ID:           pin.ID,
		InstanceID:   pin.InstanceID,
		InstanceName: inst.Name,
		Key:          pin.IssueKey,
		Summary:      pin.SummaryCache,
		Status:       pin.StatusCache,
		URL:          browseURL(inst.SiteURL, pin.IssueKey),
	}
}

// handleListPins answers with every pin from the store. With ?refresh=1 it also
// re-reads each one from Jira; without it the request touches no network, which
// is what lets the card paint while every instance is unreachable.
func (s *Server) handleListPins(w http.ResponseWriter, r *http.Request) {
	pins, instances, ok := s.pinsWithInstances(w, r)
	if !ok {
		return
	}

	dtos := make([]pinDTO, 0, len(pins))
	for _, pin := range pins {
		dtos = append(dtos, pinDTOFrom(pin, instances[pin.InstanceID]))
	}

	writeJSON(w, http.StatusOK, dtos)
}

// pinsWithInstances reads both tables and indexes the instances by id. A pin
// whose instance is missing cannot exist — the foreign key cascades — so the
// lookup is total.
func (s *Server) pinsWithInstances(
	w http.ResponseWriter, r *http.Request,
) ([]store.Pin, map[int64]store.Instance, bool) {
	pins, err := s.db.Pins(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not read the stored pins")
		return nil, nil, false
	}

	instances, err := s.db.Instances(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed",
			"could not read the stored instances")
		return nil, nil, false
	}

	byID := make(map[int64]store.Instance, len(instances))
	for _, inst := range instances {
		byID[inst.ID] = inst
	}

	return pins, byID, true
}

func (s *Server) handleDeletePin(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}

	if err := s.db.DeletePin(r.Context(), id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "pin_not_found", "no such pin")
			return
		}
		writeError(w, http.StatusInternalServerError, "store_failed", "could not remove the pin")

		return
	}

	w.WriteHeader(http.StatusNoContent)
}
```

Replace `pathID` with whatever `instances.go` actually calls its id parser; if there is none, write one in `pins.go` that answers 400 `invalid_request` for a non-numeric id and reuse it from the instance handlers in a follow-up rather than duplicating logic here.

Register in `internal/server/server.go`, beside the existing routes:

```go
	s.mux.HandleFunc("GET /api/pins", s.handleListPins)
	s.mux.HandleFunc("DELETE /api/pins/{id}", s.handleDeletePin)
```

- [ ] **Step 4: Run the tests to verify they pass**

```shell
docker compose run --rm --no-deps app go test ./internal/server/ -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```shell
git add internal/server/pins.go internal/server/pins_test.go internal/server/server.go
git commit -m "feat(api): list and remove pins without touching Jira"
```

---

### Task 6: `POST /api/pins`

**Files:**
- Modify: `internal/server/pins.go`, `internal/server/server.go`
- Test: `internal/server/pins_test.go`

**Interfaces:**
- Consumes: `s.clients.forInstance`, `jira.Client.Issue` (Task 2), `store.CreatePin` and `store.ErrPinExists` (Task 1), `instanceErrorFor` from `instances.go`.
- Produces: `handleCreatePin`; request body `{"instanceId": 1, "issueKey": "SHARED-12"}`; a `201` carrying one `pinDTO`.

- [ ] **Step 1: Write the failing tests**

Append to `internal/server/pins_test.go`:

```go
// jiraIssueServer stands in for one site's single-issue endpoint. status other
// than 200 makes the lookup fail.
func jiraIssueServer(t *testing.T, summary, status string, code int) *httptest.Server {
	t.Helper()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/rest/api/3/issue/") {
			t.Errorf("unexpected path %q", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if code != http.StatusOK {
			w.WriteHeader(code)
			return
		}
		_, _ = w.Write([]byte(`{"key":"SHARED-12","fields":{"summary":"` + summary +
			`","status":{"name":"` + status + `"}}}`))
	}))
	t.Cleanup(srv.Close)

	return srv
}

func postPin(t *testing.T, srv *Server, body string) *httptest.ResponseRecorder {
	t.Helper()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/pins", strings.NewReader(body))
	srv.ServeHTTP(rec, req)

	return rec
}

// The summary and status that get cached come from the server's own lookup,
// never from the browser: the client sends an id and a key and nothing else.
func TestPostPinCachesWhatTheLookupReturned(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	jiraSrv := jiraIssueServer(t, "Weekly standup", "In Progress", http.StatusOK)
	inst := seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", jiraSrv.URL)

	rec := postPin(t, srv, `{"instanceId":`+strconv.FormatInt(inst.ID, 10)+`,"issueKey":"SHARED-12"}`)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	var created pinDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("decoding %s: %v", rec.Body.String(), err)
	}
	if created.Summary != "Weekly standup" || created.Status != "In Progress" {
		t.Errorf("summary/status = %q/%q, want the looked-up values",
			created.Summary, created.Status)
	}

	pins, err := db.Pins(context.Background())
	if err != nil {
		t.Fatalf("reading pins: %v", err)
	}
	if len(pins) != 1 || pins[0].StatusCache != "In Progress" {
		t.Errorf("stored pins = %+v, want one carrying the status", pins)
	}
}

// A 404 from Jira means the key does not exist here. instanceErrorFor maps that
// to account_not_found with a 502, which is right for a /myself probe and badly
// wrong for this, so the branch has to come first.
func TestPostPinRejectsAKeyThatDoesNotExist(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	jiraSrv := jiraIssueServer(t, "", "", http.StatusNotFound)
	inst := seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", jiraSrv.URL)

	rec := postPin(t, srv, `{"instanceId":`+strconv.FormatInt(inst.ID, 10)+`,"issueKey":"NOPE-1"}`)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
	if !strings.Contains(rec.Body.String(), "issue_not_found") {
		t.Errorf("body = %s, want issue_not_found", rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "account_not_found") {
		t.Error("a missing issue was reported as a missing account")
	}
}

func TestPostPinRejectsADuplicate(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	jiraSrv := jiraIssueServer(t, "Weekly standup", "In Progress", http.StatusOK)
	inst := seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", jiraSrv.URL)
	body := `{"instanceId":` + strconv.FormatInt(inst.ID, 10) + `,"issueKey":"SHARED-12"}`
	postPin(t, srv, body)

	rec := postPin(t, srv, body)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusConflict)
	}
	if !strings.Contains(rec.Body.String(), "pin_exists") {
		t.Errorf("body = %s, want pin_exists", rec.Body.String())
	}
}

func TestPostPinRejectsAnUnknownInstance(t *testing.T) {
	srv, _, _ := newServerWithStore(t)

	rec := postPin(t, srv, `{"instanceId":404,"issueKey":"SHARED-12"}`)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
	if !strings.Contains(rec.Body.String(), "instance_not_found") {
		t.Errorf("body = %s, want instance_not_found", rec.Body.String())
	}
}

func TestPostPinRejectsABlankKey(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	inst := seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", "https://api.example")

	rec := postPin(t, srv, `{"instanceId":`+strconv.FormatInt(inst.ID, 10)+`,"issueKey":"  "}`)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestPostPinRejectsAMalformedBody(t *testing.T) {
	srv, _, _ := newServerWithStore(t)

	rec := postPin(t, srv, `{`)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```shell
docker compose run --rm --no-deps app go test ./internal/server/ -run TestPostPin -v
```

Expected: FAIL — 404 from the catch-all `/api/` route, because `POST /api/pins` is not registered.

- [ ] **Step 3: Write the handler**

Append to `internal/server/pins.go`:

```go
type createPinRequest struct {
	InstanceID int64  `json:"instanceId"`
	IssueKey   string `json:"issueKey"`
}

// handleCreatePin looks the issue up on its instance before storing anything,
// which is what makes "no such issue" a rejection rather than a pin that renders
// blank forever.
func (s *Server) handleCreatePin(w http.ResponseWriter, r *http.Request) {
	var req createPinRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "the request body is not valid JSON")
		return
	}

	key := strings.TrimSpace(req.IssueKey)
	if key == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "an issue key is required")
		return
	}

	inst, err := s.db.Instance(r.Context(), req.InstanceID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "instance_not_found", "no such instance")
			return
		}
		writeError(w, http.StatusInternalServerError, "store_failed", "could not read the instance")

		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), issueFetchTimeout)
	defer cancel()

	client, err := s.clients.forInstance(ctx, inst)
	if err != nil {
		writeInstanceError(w, err)
		return
	}

	issue, err := client.Issue(ctx, key)
	if err != nil {
		// Before the shared mapping, which reads a 404 as a missing account.
		if errors.Is(err, jira.ErrNotFound) {
			writeError(w, http.StatusNotFound, "issue_not_found",
				"no issue with that key on this instance")
			return
		}
		writeInstanceError(w, err)

		return
	}

	pin, err := s.db.CreatePin(r.Context(), store.PinInput{
		InstanceID:   inst.ID,
		IssueKey:     issue.Key,
		SummaryCache: issue.Summary,
		StatusCache:  issue.Status,
	})
	if err != nil {
		if errors.Is(err, store.ErrPinExists) {
			writeError(w, http.StatusConflict, "pin_exists",
				"that issue is already pinned on this instance")
			return
		}
		writeError(w, http.StatusInternalServerError, "store_failed", "could not store the pin")

		return
	}

	writeJSON(w, http.StatusCreated, pinDTOFrom(*pin, *inst))
}
```

Add `"context"`, `"encoding/json"`, `"strings"` and the `jira` import. **Check `forInstance`'s signature** in `clients.go` — `issues.go` calls it as `s.clients.forInstance(ctx, &inst)` with a pointer to a local copy; match whatever it actually takes.

Register in `server.go`:

```go
	s.mux.HandleFunc("POST /api/pins", s.handleCreatePin)
```

- [ ] **Step 4: Run the tests to verify they pass**

```shell
docker compose run --rm --no-deps app go test ./internal/server/ -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```shell
git add internal/server/pins.go internal/server/pins_test.go internal/server/server.go
git commit -m "feat(api): pin an issue, validated against its instance first"
```

---

### Task 7: `GET /api/pins?refresh=1`

**Files:**
- Modify: `internal/server/pins.go`
- Test: `internal/server/pins_test.go`

**Interfaces:**
- Consumes: `fanOutInstances` (Task 4), `store.SetPinCache` (Task 1), `jira.Client.Issue` (Task 2), `instanceErrorBody` from `issues.go`.
- Produces: the `refresh=1` branch of `handleListPins`.

- [ ] **Step 1: Write the failing tests**

Append to `internal/server/pins_test.go`:

```go
func TestRefreshRewritesTheCaches(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	jiraSrv := jiraIssueServer(t, "Renamed standup", "Done", http.StatusOK)
	inst := seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", jiraSrv.URL)
	if _, err := db.CreatePin(context.Background(), store.PinInput{
		InstanceID: inst.ID, IssueKey: "SHARED-12",
		SummaryCache: "Weekly standup", StatusCache: "In Progress",
	}); err != nil {
		t.Fatalf("creating the pin: %v", err)
	}

	rec, body := getPins(t, srv, "?refresh=1")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if body[0].Summary != "Renamed standup" || body[0].Status != "Done" {
		t.Errorf("summary/status = %q/%q, want the refreshed values",
			body[0].Summary, body[0].Status)
	}

	stored, err := db.Pins(context.Background())
	if err != nil {
		t.Fatalf("reading pins: %v", err)
	}
	if stored[0].SummaryCache != "Renamed standup" || stored[0].StatusCache != "Done" {
		t.Errorf("stored caches = %q/%q; a refresh must persist, not just render",
			stored[0].SummaryCache, stored[0].StatusCache)
	}
}

// The property this endpoint shares with the assigned fan-out. The healthy
// instance is DELAYED on purpose: with both at zero the failing goroutine
// cancels its sibling only after that sibling has already stored its result,
// and the test passes while the property is broken.
func TestRefreshKeepsWorkingPinsWhenOneInstanceFails(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	slow := jiraIssueServerWithDelay(t, "Refreshed", "Done", http.StatusOK, 150*time.Millisecond)
	broken := jiraIssueServer(t, "", "", http.StatusUnauthorized)
	good := seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", slow.URL)
	bad := seedInstance(t, db, sealer, "Personal", "https://personal.atlassian.net", broken.URL)
	for _, seed := range []struct {
		id  int64
		key string
	}{{good.ID, "SHARED-12"}, {bad.ID, "MISC-3"}} {
		if _, err := db.CreatePin(context.Background(), store.PinInput{
			InstanceID: seed.id, IssueKey: seed.key,
			SummaryCache: "cached", StatusCache: "cached",
		}); err != nil {
			t.Fatalf("creating the pin %q: %v", seed.key, err)
		}
	}

	rec, body := getPins(t, srv, "?refresh=1")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; one bad instance is data, not a failed request",
			rec.Code, http.StatusOK)
	}
	if body[0].Summary != "Refreshed" {
		t.Errorf("summary = %q, want Refreshed; a sibling's failure blanked it", body[0].Summary)
	}
	if body[1].Error == nil {
		t.Fatal("the failed pin carries no error")
	}
	if body[1].Error.Code != "credentials_rejected" {
		t.Errorf("code = %q, want credentials_rejected", body[1].Error.Code)
	}
	// A failed refresh must never destroy what was already known.
	if body[1].Summary != "cached" {
		t.Errorf("summary = %q, want the cached value kept", body[1].Summary)
	}
}

// A pin whose issue was deleted in Jira stays pinned. Removing a user's pin
// because a call said 404 is not this endpoint's decision to make.
func TestRefreshDoesNotUnpinAMissingIssue(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	jiraSrv := jiraIssueServer(t, "", "", http.StatusNotFound)
	inst := seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", jiraSrv.URL)
	if _, err := db.CreatePin(context.Background(), store.PinInput{
		InstanceID: inst.ID, IssueKey: "GONE-1", SummaryCache: "Was here", StatusCache: "Open",
	}); err != nil {
		t.Fatalf("creating the pin: %v", err)
	}

	_, body := getPins(t, srv, "?refresh=1")

	if len(body) != 1 {
		t.Fatalf("got %d pins, want the pin kept", len(body))
	}
	if body[0].Error == nil {
		t.Error("the pin carries no error after a failed refresh")
	}
	if body[0].Summary != "Was here" {
		t.Errorf("summary = %q, want the cached value kept", body[0].Summary)
	}
}
```

Add a delay-capable variant beside `jiraIssueServer`:

```go
func jiraIssueServerWithDelay(
	t *testing.T, summary, status string, code int, delay time.Duration,
) *httptest.Server {
	t.Helper()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(delay)
		if code != http.StatusOK {
			w.WriteHeader(code)
			return
		}
		_, _ = w.Write([]byte(`{"key":"SHARED-12","fields":{"summary":"` + summary +
			`","status":{"name":"` + status + `"}}}`))
	}))
	t.Cleanup(srv.Close)

	return srv
}
```

Add `"time"` to the imports.

- [ ] **Step 2: Run the tests to verify they fail**

```shell
docker compose run --rm --no-deps app go test ./internal/server/ -run TestRefresh -v
```

Expected: FAIL — the caches are returned unchanged, because `refresh=1` is ignored.

- [ ] **Step 3: Write the refresh branch**

In `internal/server/pins.go`, replace `handleListPins` with:

```go
func (s *Server) handleListPins(w http.ResponseWriter, r *http.Request) {
	pins, instances, ok := s.pinsWithInstances(w, r)
	if !ok {
		return
	}

	dtos := make([]pinDTO, 0, len(pins))
	for _, pin := range pins {
		dtos = append(dtos, pinDTOFrom(pin, instances[pin.InstanceID]))
	}

	if r.URL.Query().Get("refresh") == "1" {
		s.refreshPins(r, dtos, pins, instances)
	}

	writeJSON(w, http.StatusOK, dtos)
}

// refreshPins re-reads every pin from Jira and rewrites its cache in place.
//
// The fan-out is over instances rather than pins: two pins on one site share a
// client, which also keeps forInstance's first-use api_base_url repair from
// running twice concurrently against the same row.
//
// It never returns an error. A per-pin failure is that pin's error field, and
// the cached values it already had are left exactly as they were.
func (s *Server) refreshPins(
	r *http.Request, dtos []pinDTO, pins []store.Pin, instances map[int64]store.Instance,
) {
	byInstance := map[int64][]int{}
	ordered := []store.Instance{}
	for i, pin := range pins {
		if _, seen := byInstance[pin.InstanceID]; !seen {
			ordered = append(ordered, instances[pin.InstanceID])
		}
		byInstance[pin.InstanceID] = append(byInstance[pin.InstanceID], i)
	}

	fanOutInstances(r.Context(), ordered, issueFetchTimeout,
		func(ctx context.Context, inst store.Instance) struct{} {
			client, err := s.clients.forInstance(ctx, &inst)
			if err != nil {
				for _, i := range byInstance[inst.ID] {
					dtos[i].Error = instanceErrorBody(err)
				}

				return struct{}{}
			}

			for _, i := range byInstance[inst.ID] {
				issue, err := client.Issue(ctx, pins[i].IssueKey)
				if err != nil {
					dtos[i].Error = instanceErrorBody(err)
					continue
				}

				dtos[i].Summary = issue.Summary
				dtos[i].Status = issue.Status

				if err := s.db.SetPinCache(r.Context(), pins[i].ID, issue.Summary, issue.Status); err != nil {
					log.Printf("caching pin %d: %v", pins[i].ID, err)
				}
			}

			return struct{}{}
		})
}
```

Add `"log"` to the imports. `dtos` is written by index from one goroutine per instance, and each index belongs to exactly one instance, so there is no shared write.

- [ ] **Step 4: Run the tests to verify they pass**

```shell
docker compose run --rm --no-deps app go test ./internal/server/ -v
```

Expected: PASS.

- [ ] **Step 5: Prove the sibling guard bites here too**

Temporarily change `refreshPins`'s callback to `return` an error path that cancels — the simplest break is to give `fanOutInstances` the mutation from Task 4 again — and confirm `TestRefreshKeepsWorkingPinsWhenOneInstanceFails` **fails**. Revert, and confirm it passes.

- [ ] **Step 6: Commit**

```shell
git add internal/server/pins.go internal/server/pins_test.go
git commit -m "feat(api): refresh every pin without letting one failure blank the rest"
```

---

### Task 8: `GET /api/issues/search`

**Files:**
- Create: `internal/server/issue_search.go`
- Test: `internal/server/issue_search_test.go`
- Modify: `internal/server/server.go`

**Interfaces:**
- Consumes: `fanOutInstances` (Task 4), `jira.Client.Issue` (Task 2), `jira.Client.SearchText` (Task 3), `browseURL`, `instanceErrorBody`.
- Produces: `{"results": [...], "errors": [...]}` with `issueHitDTO{InstanceID, InstanceName, Key, Summary, Status, URL}` and `instanceFailureDTO{InstanceID, InstanceName, Error}`.

- [ ] **Step 1: Write the failing tests**

Create `internal/server/issue_search_test.go`:

```go
package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type searchBody struct {
	Results []issueHitDTO        `json:"results"`
	Errors  []instanceFailureDTO `json:"errors"`
}

func searchIssues(t *testing.T, srv *Server, query string) (*httptest.ResponseRecorder, searchBody) {
	t.Helper()

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/issues/search?q="+query, nil))

	var body searchBody
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decoding %s: %v", rec.Body.String(), err)
		}
	}

	return rec, body
}

func TestSearchReturnsHitsFromEveryInstance(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	first := jiraSearchServer(t, "WORK", http.StatusOK, 0)
	second := jiraSearchServer(t, "PERS", http.StatusOK, 0)
	seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", first.URL)
	seedInstance(t, db, sealer, "Personal", "https://personal.atlassian.net", second.URL)

	rec, body := searchIssues(t, srv, "security")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if len(body.Results) != 2 {
		t.Fatalf("got %d results, want one per instance", len(body.Results))
	}
	if body.Results[0].InstanceName != "Work" || body.Results[1].InstanceName != "Personal" {
		t.Errorf("results = %+v, want them labelled and in store order", body.Results)
	}
	if body.Results[0].URL != "https://work.atlassian.net/browse/WORK-1" {
		t.Errorf("url = %q, want the browse URL", body.Results[0].URL)
	}
	if len(body.Errors) != 0 {
		t.Errorf("errors = %+v, want none", body.Errors)
	}
}

// The floor the browser debounces to, enforced server-side so a hand-made
// request cannot fan a one-character query across every site.
func TestSearchUnderTwoCharactersReachesNoInstance(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	jiraSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("a one-character query reached Jira at %s", r.URL.Path)
	}))
	t.Cleanup(jiraSrv.Close)
	seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", jiraSrv.URL)

	rec, body := searchIssues(t, srv, "s")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if len(body.Results) != 0 || len(body.Errors) != 0 {
		t.Errorf("body = %+v, want both arrays empty", body)
	}
	// The view iterates both without a null check.
	if !strings.Contains(rec.Body.String(), `"results":[]`) ||
		!strings.Contains(rec.Body.String(), `"errors":[]`) {
		t.Errorf("body = %s, want empty arrays rather than null", rec.Body.String())
	}
}

func TestSearchReportsAFailingInstanceBesideTheOthersResults(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	// Delayed on purpose: with both at zero the failing goroutine cancels its
	// sibling only after that sibling has stored its result, and this test would
	// pass while the property it names is broken.
	good := jiraSearchServer(t, "WORK", http.StatusOK, 150*time.Millisecond)
	bad := jiraSearchServer(t, "PERS", http.StatusUnauthorized, 0)
	seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", good.URL)
	seedInstance(t, db, sealer, "Personal", "https://personal.atlassian.net", bad.URL)

	rec, body := searchIssues(t, srv, "security")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if len(body.Results) != 1 {
		t.Errorf("got %d results, want 1; a sibling's failure blanked it", len(body.Results))
	}
	if len(body.Errors) != 1 || body.Errors[0].InstanceName != "Personal" {
		t.Fatalf("errors = %+v, want Personal named", body.Errors)
	}
	if body.Errors[0].Error.Code != "credentials_rejected" {
		t.Errorf("code = %q, want credentials_rejected", body.Errors[0].Error.Code)
	}
}
```

A key-shaped query needs a stub answering both endpoints; add these two tests with a server that routes on the path:

```go
func jiraSearchAndIssueServer(t *testing.T, issueStatus int) *httptest.Server {
	t.Helper()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, "/rest/api/3/issue/"):
			if issueStatus != http.StatusOK {
				w.WriteHeader(issueStatus)
				return
			}
			_, _ = w.Write([]byte(`{"key":"WORK-1","fields":{"summary":"Exact hit",` +
				`"status":{"name":"To Do"}}}`))
		case r.URL.Path == "/rest/api/3/search/jql":
			_, _ = w.Write([]byte(`{"issues":[{"key":"WORK-1","fields":{` +
				`"summary":"Exact hit","status":{"name":"To Do"}}}]}`))
		default:
			t.Errorf("unexpected path %q", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)

	return srv
}

// key = "..." is a JQL error when the project does not exist, so a key-shaped
// query goes through the single-issue lookup instead, where a miss costs
// nothing.
func TestSearchListsAnExactKeyHitOnce(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	jiraSrv := jiraSearchAndIssueServer(t, http.StatusOK)
	seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", jiraSrv.URL)

	_, body := searchIssues(t, srv, "WORK-1")

	if len(body.Results) != 1 {
		t.Fatalf("got %d results, want the exact hit listed once", len(body.Results))
	}
	if body.Results[0].Key != "WORK-1" {
		t.Errorf("key = %q, want WORK-1", body.Results[0].Key)
	}
}

func TestSearchIgnoresAKeyLookupThatMisses(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	jiraSrv := jiraSearchAndIssueServer(t, http.StatusNotFound)
	seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", jiraSrv.URL)

	_, body := searchIssues(t, srv, "WORK-1")

	if len(body.Errors) != 0 {
		t.Errorf("errors = %+v; a key that is not here is an ordinary answer", body.Errors)
	}
	if len(body.Results) != 1 {
		t.Errorf("got %d results, want the summary match still returned", len(body.Results))
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```shell
docker compose run --rm --no-deps app go test ./internal/server/ -run TestSearch -v
```

Expected: FAIL — `undefined: issueHitDTO`.

- [ ] **Step 3: Write the handler**

Create `internal/server/issue_search.go`:

```go
package server

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strings"

	"github.com/dgerrese/work-dashboard/internal/jira"
	"github.com/dgerrese/work-dashboard/internal/store"
)

// searchLimit caps one instance's summary matches. This backs a type-ahead: a
// longer list is scrolled past, not read.
const searchLimit = 10

// minSearchQuery is the floor below which no instance is reached. The browser
// debounces to the same number; enforcing it here means a hand-made request
// cannot fan a one-character query across every site.
const minSearchQuery = 2

// issueKeyPattern is Jira's key shape. A query matching it gets an exact lookup
// as well as a summary search, because `key = "..."` in JQL is an error rather
// than an empty result when the project does not exist.
var issueKeyPattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]*-[0-9]+$`)

type issueHitDTO struct {
	InstanceID   int64  `json:"instanceId"`
	InstanceName string `json:"instanceName"`
	Key          string `json:"key"`
	Summary      string `json:"summary"`
	Status       string `json:"status"`
	URL          string `json:"url"`
}

type instanceFailureDTO struct {
	InstanceID   int64      `json:"instanceId"`
	InstanceName string     `json:"instanceName"`
	Error        *errorBody `json:"error"`
}

type issueSearchResponseDTO struct {
	Results []issueHitDTO        `json:"results"`
	Errors  []instanceFailureDTO `json:"errors"`
}

// instanceSearchResult is one instance's share of the answer: its hits, or the
// reason it has none. Both are never set at once.
type instanceSearchResult struct {
	hits    []issueHitDTO
	failure *instanceFailureDTO
}

// handleSearchIssues answers with issues matching q across every instance,
// flattened into one ordered list because one combobox renders it.
func (s *Server) handleSearchIssues(w http.ResponseWriter, r *http.Request) {
	response := issueSearchResponseDTO{Results: []issueHitDTO{}, Errors: []instanceFailureDTO{}}

	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(query) < minSearchQuery {
		writeJSON(w, http.StatusOK, response)
		return
	}

	instances, err := s.db.Instances(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed",
			"could not read the stored instances")
		return
	}

	results := fanOutInstances(r.Context(), instances, issueFetchTimeout,
		func(ctx context.Context, inst store.Instance) instanceSearchResult {
			return s.searchOneInstance(ctx, inst, query)
		})

	for _, result := range results {
		response.Results = append(response.Results, result.hits...)
		if result.failure != nil {
			response.Errors = append(response.Errors, *result.failure)
		}
	}

	writeJSON(w, http.StatusOK, response)
}

// searchOneInstance never returns an error: one site being unreachable is part
// of the answer, and an error would cancel every sibling through the group's
// context.
func (s *Server) searchOneInstance(
	ctx context.Context, inst store.Instance, query string,
) instanceSearchResult {
	fail := func(err error) instanceSearchResult {
		return instanceSearchResult{failure: &instanceFailureDTO{
			InstanceID: inst.ID, InstanceName: inst.Name, Error: instanceErrorBody(err),
		}}
	}

	client, err := s.clients.forInstance(ctx, &inst)
	if err != nil {
		return fail(err)
	}

	hits := []issueHitDTO{}
	exact := ""

	if issueKeyPattern.MatchString(query) {
		key := strings.ToUpper(query)
		// A miss is an ordinary answer to "is this key here", not a failure.
		if issue, err := client.Issue(ctx, key); err == nil {
			exact = issue.Key
			hits = append(hits, hitFrom(inst, *issue))
		} else if !errors.Is(err, jira.ErrNotFound) {
			return fail(err)
		}
	}

	found, err := client.SearchText(ctx, query, searchLimit)
	if err != nil {
		return fail(err)
	}

	for _, issue := range found {
		if issue.Key == exact {
			continue
		}
		hits = append(hits, hitFrom(inst, issue))
	}

	return instanceSearchResult{hits: hits}
}

func hitFrom(inst store.Instance, issue jira.Issue) issueHitDTO {
	return issueHitDTO{
		InstanceID:   inst.ID,
		InstanceName: inst.Name,
		Key:          issue.Key,
		Summary:      issue.Summary,
		Status:       issue.Status,
		URL:          browseURL(inst.SiteURL, issue.Key),
	}
}
```

Register in `server.go`, **before** the `/api/` catch-all:

```go
	s.mux.HandleFunc("GET /api/issues/search", s.handleSearchIssues)
```

- [ ] **Step 4: Run the tests to verify they pass**

```shell
docker compose run --rm --no-deps app go test ./internal/server/ -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```shell
git add internal/server/issue_search.go internal/server/issue_search_test.go internal/server/server.go
git commit -m "feat(api): search every instance by key and by title"
```

---

### Task 9: The frontend's types, API client and the Pinned card

**Files:**
- Modify: `web/src/types.ts`, `web/src/api.ts`, `web/src/views/today.ts`
- Test: `.claude/e2e/tests/pins.spec.ts`

**Interfaces:**
- Consumes: the endpoints from Tasks 5–8; `wd-card`, `wd-alert`, `wd-button`, `wd-ticket-row`.
- Produces: `Pin`, `IssueHit`, `InstanceFailure`, `IssueSearchResponse` in `types.ts`; `listPins`, `createPin`, `deletePin`, `searchIssues` in `api.ts`; in `today.ts` the Pinned card, `refreshPins(regions: Regions, options?: { refresh?: boolean }): Promise<void>`, `pinRow(pin: Pin, onUnpin: () => void): HTMLElement`, and `currentPins(regions: Regions): Pin[]` returning the last `listPins()` result. Tasks 10 and 11 call all three by those names.

- [ ] **Step 1: Write the failing spec**

Create `.claude/e2e/tests/pins.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";

interface StubPin {
  id: number;
  instanceId: number;
  instanceName: string;
  key: string;
  summary: string;
  status: string;
  url: string;
  error: { code: string; message: string } | null;
}

function pin(id: number, instanceName: string, key: string, summary: string): StubPin {
  return {
    id,
    instanceId: id,
    instanceName,
    key,
    summary,
    status: "In Progress",
    url: `https://example.atlassian.net/browse/${key}`,
    error: null,
  };
}

/**
 * Stubs /api/pins. The route pattern must not also swallow /api/issues/search,
 * which is why it is anchored with the query-string wildcard rather than a bare
 * suffix.
 */
async function stubPins(page: Page, ...responses: StubPin[][]): Promise<void> {
  let calls = 0;

  await page.route("**/api/pins**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    const index = Math.min(calls, responses.length - 1);
    calls += 1;
    await route.fulfill({ status: 200, json: responses[index] });
  });
}

async function stubIssues(page: Page, groups: unknown[]): Promise<void> {
  await page.route("**/api/issues", async (route) => {
    await route.fulfill({ status: 200, json: { instances: groups } });
  });
}

test("pinned issues render above the assigned cards", async ({ page }) => {
  await stubPins(page, [pin(1, "Ridgeline", "SHARED-12", "Weekly standup")]);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);

  await page.goto("/today");

  const card = page.locator("wd-card").filter({ hasText: "Pinned" });
  await expect(card.getByText("SHARED-12")).toBeVisible();
  await expect(card.getByText("Weekly standup")).toBeVisible();
  await expect(card.getByText("Ridgeline")).toBeVisible();
});

test("an issue that is both pinned and assigned appears once", async ({ page }) => {
  await stubPins(page, [pin(1, "Ridgeline", "SHARED-12", "Weekly standup")]);
  await stubIssues(page, [
    {
      id: 1,
      name: "Ridgeline",
      error: null,
      issues: [
        {
          key: "SHARED-12",
          summary: "Weekly standup",
          status: "In Progress",
          url: "https://example.atlassian.net/browse/SHARED-12",
        },
        {
          key: "WORK-412",
          summary: "Fix the CSV export encoding",
          status: "In Progress",
          url: "https://example.atlassian.net/browse/WORK-412",
        },
      ],
    },
  ]);

  await page.goto("/today");

  await expect(page.getByText("SHARED-12")).toHaveCount(1);
  await expect(page.getByText("WORK-412")).toHaveCount(1);
});

test("the pinned card renders when every instance fails", async ({ page }) => {
  await stubPins(page, [pin(1, "Ridgeline", "SHARED-12", "Weekly standup")]);
  await stubIssues(page, [
    {
      id: 1,
      name: "Ridgeline",
      issues: [],
      error: { code: "instance_unreachable", message: "the Jira site could not be reached" },
    },
  ]);

  await page.goto("/today");

  await expect(page.getByText("SHARED-12")).toBeVisible();
  await expect(page.getByText("the Jira site could not be reached")).toBeVisible();
});

test("no pins shows nothing pinned", async ({ page }) => {
  await stubPins(page, []);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);

  await page.goto("/today");

  await expect(page.getByText("Nothing pinned.")).toBeVisible();
});

// With no instances there can be no pins either — the cascade took them with the
// last instance — so a Pinned card would be a control with nothing to do.
test("no instances configured hides the pinned card entirely", async ({ page }) => {
  await stubPins(page, []);
  await stubIssues(page, []);

  await page.goto("/today");

  await expect(page.getByText("No Jira instances yet.")).toBeVisible();
  await expect(page.locator("wd-card").filter({ hasText: "Pinned" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pin an issue" })).toHaveCount(0);
});
```

**Check #5's exact empty-state wording** in `web/src/views/today.ts` before writing that last assertion — the spec quotes it as "No Jira instances yet." and the test must match the shipped string, not the quotation.

- [ ] **Step 2: Run the spec to verify it fails**

```shell
make test-e2e
```

Expected: FAIL — no Pinned card exists.

- [ ] **Step 3: Add the types**

Append to `web/src/types.ts`:

```ts
export interface Pin {
  id: number;
  instanceId: number;
  instanceName: string;
  key: string;
  summary: string;
  status: string;
  url: string;
  error: ApiErrorBody | null;
}

export interface IssueHit {
  instanceId: number;
  instanceName: string;
  key: string;
  summary: string;
  status: string;
  url: string;
}

export interface InstanceFailure {
  instanceId: number;
  instanceName: string;
  error: ApiErrorBody;
}

export interface IssueSearchResponse {
  results: IssueHit[];
  errors: InstanceFailure[];
}
```

- [ ] **Step 4: Add the API calls**

Append to `web/src/api.ts`:

```ts
export function listPins(options?: { refresh?: boolean }): Promise<Pin[]> {
  return request<Pin[]>(options?.refresh === true ? "/api/pins?refresh=1" : "/api/pins");
}

export function createPin(instanceId: number, issueKey: string): Promise<Pin> {
  return request<Pin>("/api/pins", {
    method: "POST",
    body: JSON.stringify({ instanceId, issueKey }),
  });
}

export function deletePin(id: number): Promise<void> {
  return request<void>(`/api/pins/${id}`, { method: "DELETE" });
}

/**
 * The signal is required rather than optional: type-ahead is the first place in
 * this app where a second request can overtake the first, and the last response
 * to arrive is not reliably the last one asked for.
 */
export function searchIssues(query: string, signal: AbortSignal): Promise<IssueSearchResponse> {
  return request<IssueSearchResponse>(
    `/api/issues/search?q=${encodeURIComponent(query)}`,
    { signal },
  );
}
```

Import the new types, and give `request()` a `signal` pass-through: read its current signature in `web/src/api.ts` and add `signal?: AbortSignal` to whatever options type it takes, forwarding it to `fetch`.

- [ ] **Step 5: Render the Pinned card**

In `web/src/views/today.ts`, extend the `Regions` interface with the card's own regions and render it above the existing header:

```ts
interface Regions {
  pinnedCard: HTMLElement;
  pinnedList: HTMLElement;
  pinnedForm: HTMLElement;
  header: HTMLElement;
  refresh: HTMLElement;
  results: HTMLElement;
}
```

`render()` builds the Pinned `wd-card` with `pinnedList` and `pinnedForm` as persistent children, appends it before the header, and starts both fetches independently:

```ts
  // Independent on purpose: the Pinned card paints from the store alone and
  // must not wait on a fan-out that may be slow or failing.
  void refreshPins(regions);
  await refreshResults(regions);
```

`refreshPins` calls `listPins()`, stores the result in a module-free closure variable threaded through `Regions`, renders the rows, and re-renders the assigned cards so the dedupe applies. Row markup, per the design:

```ts
function pinRow(pin: Pin, onUnpin: () => void): HTMLElement {
  const item = document.createElement("li");
  item.className = "flex items-center gap-3";

  const instance = document.createElement("span");
  instance.className = "shrink-0 text-sm text-ink-muted";
  instance.textContent = pin.instanceName;

  // wd-ticket-row sets its own className in connectedCallback, so a utility
  // applied from outside would be discarded; the wrapper carries flex-1.
  const wrapper = document.createElement("div");
  wrapper.className = "min-w-0 flex-1";
  const row = document.createElement("wd-ticket-row");
  row.setAttribute("key", pin.key);
  row.setAttribute("summary", pin.summary);
  row.setAttribute("status", pin.status);
  row.setAttribute("url", pin.url);
  wrapper.append(row);

  const unpin = button("Unpin", "secondary");
  unpin.addEventListener("click", onUnpin);

  item.append(instance, wrapper, unpin);

  return item;
}
```

Dedupe where the assigned response is rendered:

```ts
const pinnedKeys = new Set(pins.map((p) => `${p.instanceId}:${p.key}`));
const visible = group.issues.filter((issue) => !pinnedKeys.has(`${group.id}:${issue.key}`));
```

Empty state: a muted `<p>` reading `Nothing pinned.` in `pinnedList`. A failed `listPins()`: a `wd-alert` in `pinnedList` and the form region emptied.

- [ ] **Step 6: Run the spec to verify it passes**

```shell
make tsc && make test-e2e
```

Expected: PASS.

- [ ] **Step 7: Commit**

```shell
git add web/src/types.ts web/src/api.ts web/src/views/today.ts .claude/e2e/tests/pins.spec.ts
git commit -m "feat(web): the Pinned card, rendered from the store alone"
```

---

### Task 10: `wd-combobox` and the pin flow

**Files:**
- Create: `web/src/components/wd-combobox.ts`
- Modify: `web/src/views/today.ts`
- Test: `.claude/e2e/tests/pins.spec.ts`

**Interfaces:**
- Consumes: `searchIssues`, `createPin` (Task 9).
- Produces: `<wd-combobox label placeholder>`, emitting three events — `search` (`CustomEvent<string>`, the debounced query), `select` (`CustomEvent<IssueHit>`) and `cancel` (`CustomEvent<void>`) — with the public methods `focusInput(): void`, `setResults(results: IssueHit[], failures: InstanceFailure[]): void`, `setSearching(): void`, `setBusy(busy: boolean): void` and `setDisabledKeys(keys: Set<string>): void`.

- [ ] **Step 1: Write the failing spec**

Append to `.claude/e2e/tests/pins.spec.ts`:

```ts
async function stubSearch(page: Page, results: unknown[], errors: unknown[] = []): Promise<void> {
  await page.route("**/api/issues/search**", async (route) => {
    await route.fulfill({ status: 200, json: { results, errors } });
  });
}

const sharedHit = {
  instanceId: 1,
  instanceName: "Ridgeline",
  key: "SHARED-40",
  summary: "Vendor security review",
  status: "To Do",
  url: "https://example.atlassian.net/browse/SHARED-40",
};

test("searching finds issues across instances and pinning one adds it", async ({ page }) => {
  await stubPins(page, [], [pin(9, "Ridgeline", "SHARED-40", "Vendor security review")]);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
  await stubSearch(page, [
    sharedHit,
    {
      instanceId: 2,
      instanceName: "Personal",
      key: "MISC-15",
      summary: "Security questionnaire",
      status: "Open",
      url: "https://example.atlassian.net/browse/MISC-15",
    },
  ]);
  await page.route("**/api/pins", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 201,
      json: pin(9, "Ridgeline", "SHARED-40", "Vendor security review"),
    });
  });

  await page.goto("/today");
  await page.getByRole("button", { name: "Pin an issue" }).click();
  await page.getByRole("combobox", { name: "Find an issue" }).fill("security");

  const options = page.getByRole("option");
  await expect(options).toHaveCount(2);
  await expect(options.first()).toContainText("SHARED-40");
  await expect(options.nth(1)).toContainText("Personal");

  await options.first().click();

  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(page.getByText("Vendor security review")).toBeVisible();
});

test("an already pinned issue cannot be chosen", async ({ page }) => {
  await stubPins(page, [pin(1, "Ridgeline", "SHARED-40", "Vendor security review")]);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
  await stubSearch(page, [{ ...sharedHit, instanceId: 1 }]);

  await page.goto("/today");
  await page.getByRole("button", { name: "Pin an issue" }).click();
  await page.getByRole("combobox", { name: "Find an issue" }).fill("security");

  const option = page.getByRole("option").first();
  await expect(option).toContainText("Pinned");
  await expect(option).toBeDisabled();
});

test("the keyboard pins without the mouse", async ({ page }) => {
  await stubPins(page, [], [pin(9, "Ridgeline", "SHARED-40", "Vendor security review")]);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
  await stubSearch(page, [sharedHit]);
  await page.route("**/api/pins", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 201,
      json: pin(9, "Ridgeline", "SHARED-40", "Vendor security review"),
    });
  });

  await page.goto("/today");
  await page.getByRole("button", { name: "Pin an issue" }).click();
  const box = page.getByRole("combobox", { name: "Find an issue" });
  await box.fill("security");
  await expect(page.getByRole("option")).toHaveCount(1);

  await box.press("ArrowDown");
  await box.press("Enter");

  await expect(page.getByText("Vendor security review")).toBeVisible();
});

test("a query under two characters searches nothing", async ({ page }) => {
  await stubPins(page, []);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
  let searched = false;
  await page.route("**/api/issues/search**", async (route) => {
    searched = true;
    await route.fulfill({ status: 200, json: { results: [], errors: [] } });
  });

  await page.goto("/today");
  await page.getByRole("button", { name: "Pin an issue" }).click();
  await page.getByRole("combobox", { name: "Find an issue" }).fill("s");
  await page.waitForTimeout(600);

  expect(searched).toBe(false);
  await expect(page.getByText("Two characters to start.")).toBeVisible();
});

test("a query with no matches says so and names the query back", async ({ page }) => {
  await stubPins(page, []);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
  await stubSearch(page, []);

  await page.goto("/today");
  await page.getByRole("button", { name: "Pin an issue" }).click();
  await page.getByRole("combobox", { name: "Find an issue" }).fill("zzz");

  await expect(page.getByText("No issues match “zzz”.")).toBeVisible();
  await expect(page.getByRole("option")).toHaveCount(0);
});

test("every instance failing shows an error rather than an empty list", async ({ page }) => {
  await stubPins(page, []);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
  await stubSearch(page, [], [
    {
      instanceId: 1,
      instanceName: "Ridgeline",
      error: { code: "instance_unreachable", message: "the Jira site could not be reached" },
    },
  ]);

  await page.goto("/today");
  await page.getByRole("button", { name: "Pin an issue" }).click();
  await page.getByRole("combobox", { name: "Find an issue" }).fill("security");

  await expect(page.getByText("the Jira site could not be reached")).toBeVisible();
});

test("an instance that cannot be searched is named beside the results", async ({ page }) => {
  await stubPins(page, []);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
  await stubSearch(page, [sharedHit], [
    {
      instanceId: 2,
      instanceName: "Personal",
      error: { code: "instance_unreachable", message: "the Jira site could not be reached" },
    },
  ]);

  await page.goto("/today");
  await page.getByRole("button", { name: "Pin an issue" }).click();
  await page.getByRole("combobox", { name: "Find an issue" }).fill("security");

  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByText("Personal could not be searched.")).toBeVisible();
});
```

- [ ] **Step 2: Run the spec to verify it fails**

```shell
make test-e2e
```

Expected: FAIL — no combobox.

- [ ] **Step 3: Write the component**

Create `web/src/components/wd-combobox.ts`. It owns the input, the listbox and the keyboard; it owns nothing about Jira.

```ts
import "./wd-alert";

import type { InstanceFailure, IssueHit } from "../types";

/**
 * A searchable select. Light DOM, like every wd-* component.
 *
 * It debounces and enforces the two-character floor itself, because each pause
 * costs one Jira call per instance: this is the difference between a search and
 * a denial-of-service against the owner's own sites.
 *
 * Focus never leaves the input. The active option is tracked by index and
 * mirrored into aria-activedescendant, which is what makes the pattern work for
 * a screen reader.
 */
export class WdCombobox extends HTMLElement {
  static readonly debounceMs = 350;
  static readonly minQuery = 2;

  private input: HTMLInputElement | undefined;
  private listbox: HTMLElement | undefined;
  private hint: HTMLElement | undefined;
  private results: IssueHit[] = [];
  private failures: InstanceFailure[] = [];
  private disabledKeys = new Set<string>();
  private active = 0;
  private searching = false;
  private searched = false;
  private timer: number | undefined;

  connectedCallback(): void {
    this.className = "block";
    if (this.input) return;

    const label = document.createElement("label");
    label.className = "mb-1 block text-sm font-medium text-ink";
    label.textContent = this.getAttribute("label") ?? "";
    label.htmlFor = "wd-combobox-input";

    const wrapper = document.createElement("div");
    wrapper.className = "relative";

    this.input = document.createElement("input");
    this.input.id = "wd-combobox-input";
    this.input.type = "text";
    this.input.autocomplete = "off";
    this.input.role = "combobox";
    this.input.setAttribute("aria-autocomplete", "list");
    this.input.setAttribute("aria-expanded", "false");
    this.input.setAttribute("aria-controls", "wd-combobox-listbox");
    this.input.placeholder = this.getAttribute("placeholder") ?? "";
    this.input.className =
      "w-full rounded-md border border-edge px-3 py-1.5 text-sm " +
      "focus:border-ink focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";

    this.listbox = document.createElement("div");
    this.listbox.id = "wd-combobox-listbox";
    this.listbox.setAttribute("role", "listbox");
    this.listbox.className =
      "absolute inset-x-0 top-10 z-10 max-h-60 overflow-y-auto rounded-md " +
      "border border-edge bg-raised shadow-lg";
    this.listbox.hidden = true;

    this.hint = document.createElement("p");
    this.hint.className = "mt-1 text-xs text-ink-muted";
    this.hint.textContent = "Searches every instance. Two characters to start.";

    wrapper.append(this.input, this.listbox);
    this.append(label, wrapper, this.hint);

    this.input.addEventListener("input", () => {
      this.scheduleSearch();
    });
    this.input.addEventListener("keydown", (event) => {
      this.onKeyDown(event);
    });
  }

  focusInput(): void {
    this.input?.focus();
  }

  setDisabledKeys(keys: Set<string>): void {
    this.disabledKeys = keys;
    this.renderOptions();
  }

  setResults(results: IssueHit[], failures: InstanceFailure[]): void {
    this.results = results;
    this.failures = failures;
    this.searching = false;
    this.searched = true;
    this.active = 0;
    this.renderOptions();
  }

  /** Clears the previous results rather than leaving them: a list that lags the
   *  query reads as a wrong answer, not as a stale one. */
  setSearching(): void {
    this.results = [];
    this.failures = [];
    this.searching = true;
    this.searched = false;
    this.active = 0;
    this.renderOptions();
  }

  setBusy(busy: boolean): void {
    if (this.input) this.input.disabled = busy;
    if (busy) this.close();
  }

  get query(): string {
    return this.input?.value.trim() ?? "";
  }

  private scheduleSearch(): void {
    window.clearTimeout(this.timer);
    const query = this.input?.value.trim() ?? "";

    if (query.length < WdCombobox.minQuery) {
      this.close();
      if (this.hint) this.hint.hidden = false;
      return;
    }
    if (this.hint) this.hint.hidden = true;

    this.timer = window.setTimeout(() => {
      this.setSearching();
      this.dispatchEvent(new CustomEvent<string>("search", { detail: query }));
    }, WdCombobox.debounceMs);
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (this.results.length === 0) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      this.active = (this.active + delta + this.results.length) % this.results.length;
      this.renderOptions();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const hit = this.results[this.active];
      if (hit) this.choose(hit);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      this.dispatchEvent(new CustomEvent("cancel"));
    }
  }

  private choose(hit: IssueHit): void {
    if (this.disabledKeys.has(`${hit.instanceId}:${hit.key}`)) return;
    this.dispatchEvent(new CustomEvent<IssueHit>("select", { detail: hit }));
  }

  private close(): void {
    this.results = [];
    this.failures = [];
    this.searching = false;
    this.searched = false;
    if (this.listbox) this.listbox.hidden = true;
    this.input?.setAttribute("aria-expanded", "false");
    this.input?.removeAttribute("aria-activedescendant");
  }

  private noticeLine(text: string): HTMLElement {
    const line = document.createElement("p");
    line.className = "px-3 py-2 text-sm text-ink-muted";
    line.textContent = text;

    return line;
  }

  private renderOptions(): void {
    const listbox = this.listbox;
    const input = this.input;
    if (!listbox || !input) return;

    listbox.replaceChildren();

    if (this.searching) {
      listbox.append(this.noticeLine("Searching…"));
      listbox.hidden = false;
      input.setAttribute("aria-expanded", "true");
      input.removeAttribute("aria-activedescendant");

      return;
    }

    // Every instance failed: there is nothing to choose from, so this is an
    // error rather than a footnote under results.
    if (this.results.length === 0 && this.failures.length > 0) {
      const alert = document.createElement("wd-alert");
      alert.setAttribute("tone", "error");
      alert.setAttribute("message", this.failures[0]?.error.message ?? "The search failed.");
      listbox.append(alert);
      listbox.hidden = false;
      input.setAttribute("aria-expanded", "true");
      input.removeAttribute("aria-activedescendant");

      return;
    }

    if (this.searched && this.results.length === 0) {
      // The query is named back because ~ matches word prefixes: an empty result
      // is usually the query's shape rather than an empty Jira.
      listbox.append(this.noticeLine(`No issues match “${this.query}”.`));
      listbox.hidden = false;
      input.setAttribute("aria-expanded", "true");
      input.removeAttribute("aria-activedescendant");

      return;
    }

    this.results.forEach((hit, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.id = `wd-combobox-option-${index}`;
      option.setAttribute("role", "option");
      const pinned = this.disabledKeys.has(`${hit.instanceId}:${hit.key}`);
      option.disabled = pinned;
      option.setAttribute("aria-selected", index === this.active ? "true" : "false");
      option.className =
        "flex w-full items-baseline gap-3 px-3 py-2 text-left " +
        (index === this.active ? "bg-surface " : "") +
        "disabled:opacity-100";

      const instance = document.createElement("span");
      instance.className = "shrink-0 text-sm text-ink-muted";
      instance.textContent = hit.instanceName;

      const key = document.createElement("span");
      key.className = "shrink-0 font-mono text-sm font-medium";
      key.textContent = hit.key;

      const summary = document.createElement("span");
      summary.className = "flex-1 text-sm";
      summary.textContent = hit.summary;

      const tail = document.createElement("span");
      tail.className = "shrink-0 text-xs text-ink-muted";
      tail.textContent = pinned ? "Pinned" : hit.status;

      option.append(instance, key, summary, tail);
      option.addEventListener("click", () => {
        this.choose(hit);
      });
      listbox.append(option);
    });

    if (this.failures.length > 0) {
      const failed = document.createElement("p");
      failed.className = "border-t border-edge px-3 py-2 text-xs text-ink-muted";
      failed.textContent = `${this.failures.map((f) => f.instanceName).join(", ")} could not be searched.`;
      listbox.append(failed);
    }

    const open = this.results.length > 0 || this.failures.length > 0;
    listbox.hidden = !open;
    input.setAttribute("aria-expanded", open ? "true" : "false");
    if (open && this.results.length > 0) {
      input.setAttribute("aria-activedescendant", `wd-combobox-option-${this.active}`);
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }
}

customElements.define("wd-combobox", WdCombobox);
```

The `aria-label` the spec queries by comes from the `<label>`'s `for`, so `label` must be set before insertion.

- [ ] **Step 4: Wire the form into `today.ts`**

Add `import "../components/wd-combobox";` to the imports, then replace the collapsed-button-only `pinnedForm` content from Task 9 with these two functions and call `showPinButton(regions)` wherever Task 9 rendered the button:

```ts
function showPinButton(regions: Regions): void {
  const open = button("Pin an issue", "secondary");
  open.addEventListener("click", () => {
    showPinForm(regions);
  });
  regions.pinnedForm.className = "mt-3 border-t border-edge pt-3";
  regions.pinnedForm.replaceChildren(open);
}

function showPinForm(regions: Regions): void {
  const combobox = document.createElement("wd-combobox") as WdCombobox;
  combobox.setAttribute("label", "Find an issue");
  combobox.setAttribute("placeholder", "Search by key or title");

  const alertSlot = document.createElement("div");
  const actions = document.createElement("div");
  actions.className = "flex gap-2";
  const cancel = button("Cancel", "secondary");
  actions.append(cancel);

  regions.pinnedForm.className = "mt-3 space-y-3 border-t border-edge pt-3";
  regions.pinnedForm.replaceChildren(combobox, alertSlot, actions);

  // Set after insertion: connectedCallback builds the input, so there is nothing
  // to focus before it runs.
  combobox.focusInput();
  combobox.setDisabledKeys(pinnedKeysOf(regions));

  // One controller per form, replaced on each keystroke pause. Without this a
  // slow first search can land after a fast second one and paint over it.
  let inFlight: AbortController | undefined;

  combobox.addEventListener("search", (event) => {
    const query = (event as CustomEvent<string>).detail;
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;

    void searchIssues(query, controller.signal)
      .then((response) => {
        combobox.setResults(response.results, response.errors);
      })
      .catch((error: unknown) => {
        // An abort is this code's own doing, not a failure to report.
        if (error instanceof DOMException && error.name === "AbortError") return;
        combobox.setResults([], []);
        alertSlot.replaceChildren(alertFor("error", messageOf(error)));
      });
  });

  combobox.addEventListener("select", (event) => {
    const hit = (event as CustomEvent<IssueHit>).detail;
    inFlight?.abort();
    alertSlot.replaceChildren();
    combobox.setBusy(true);

    void createPin(hit.instanceId, hit.key)
      .then(async () => {
        showPinButton(regions);
        await refreshPins(regions);
      })
      .catch((error: unknown) => {
        combobox.setBusy(false);
        alertSlot.replaceChildren(alertFor("error", messageOf(error)));
      });
  });

  combobox.addEventListener("cancel", () => {
    inFlight?.abort();
    showPinButton(regions);
  });

  cancel.addEventListener("click", () => {
    inFlight?.abort();
    showPinButton(regions);
  });
}

/** The keys the combobox must refuse, so a duplicate is visible rather than a
 *  rejection the user only meets after choosing. */
function pinnedKeysOf(regions: Regions): Set<string> {
  return new Set(currentPins(regions).map((pin) => `${pin.instanceId}:${pin.key}`));
}
```

`currentPins(regions)` is the accessor Task 9 introduced for the last `listPins()` result; if Task 9 stored the pins directly on `Regions`, read them from there instead of adding a second accessor. Import `WdCombobox` as a type from `../components/wd-combobox`, and `IssueHit` from `../types`.

`refreshPins` must call `combobox.setDisabledKeys(...)` when a form is open — simplest is for `refreshPins` to end by calling `pinnedKeysOf` and pushing it into any `wd-combobox` currently inside `regions.pinnedForm`.

- [ ] **Step 5: Run the specs to verify they pass**

```shell
make tsc && make lint && make test-e2e
```

Expected: PASS on both Firefox and Chromium.

- [ ] **Step 6: Commit**

```shell
git add web/src/components/wd-combobox.ts web/src/views/today.ts .claude/e2e/tests/pins.spec.ts
git commit -m "feat(web): pin by searching every instance at once"
```

---

### Task 11: Unpin, and Refresh covering both lists

**Files:**
- Modify: `web/src/views/today.ts`
- Test: `.claude/e2e/tests/pins.spec.ts`

**Interfaces:**
- Consumes: `deletePin`, `listPins({refresh: true})`.
- Produces: no new exports.

- [ ] **Step 1: Write the failing spec**

Append to `.claude/e2e/tests/pins.spec.ts`:

```ts
test("unpinning removes the row without a reload", async ({ page }) => {
  await stubPins(page, [pin(1, "Ridgeline", "SHARED-12", "Weekly standup")], []);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
  await page.route("**/api/pins/1", async (route) => {
    await route.fulfill({ status: 204, body: "" });
  });

  await page.goto("/today");
  await expect(page.getByText("SHARED-12")).toBeVisible();

  await page.getByRole("button", { name: "Unpin" }).click();

  await expect(page.getByText("SHARED-12")).toHaveCount(0);
  await expect(page.getByText("Nothing pinned.")).toBeVisible();
});

test("refresh updates the pinned card as well as the assigned one", async ({ page }) => {
  await stubPins(
    page,
    [pin(1, "Ridgeline", "SHARED-12", "Weekly standup")],
    [pin(1, "Ridgeline", "SHARED-12", "Renamed standup")],
  );
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);

  await page.goto("/today");
  await expect(page.getByText("Weekly standup")).toBeVisible();

  await page.getByRole("button", { name: "Refresh" }).click();

  await expect(page.getByText("Renamed standup")).toBeVisible();
});

test("a pin whose refresh failed keeps its cached values", async ({ page }) => {
  const stale = pin(1, "Ridgeline", "SHARED-12", "Weekly standup");
  const failed = {
    ...stale,
    error: { code: "instance_unreachable", message: "the Jira site could not be reached" },
  };
  await stubPins(page, [stale], [failed]);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);

  await page.goto("/today");
  await page.getByRole("button", { name: "Refresh" }).click();

  await expect(page.getByText("Weekly standup")).toBeVisible();
  await expect(page.getByText("the Jira site could not be reached")).toBeVisible();
});
```

- [ ] **Step 2: Run the specs to verify they fail**

```shell
make test-e2e
```

Expected: FAIL — Unpin does nothing and Refresh leaves the Pinned card alone.

- [ ] **Step 3: Implement**

Wire `pinRow`'s `onUnpin`. No confirmation dialog: `time_entries` have no foreign key to `pinned_issues`, so unpinning destroys nothing — unlike #29's instance removal, whose cascade does.

```ts
function unpin(regions: Regions, pin: Pin, row: HTMLElement): void {
  const control = row.querySelector("wd-button");
  control?.setAttribute("disabled", "");

  void deletePin(pin.id)
    .then(async () => {
      await refreshPins(regions);
    })
    .catch((error: unknown) => {
      control?.removeAttribute("disabled");
      regions.pinnedList.prepend(alertFor("error", messageOf(error)));
    });
}
```

Render a per-pin error beside its row when `pin.error` is non-null, leaving `summary` and `status` exactly as they came — a failed refresh must never blank a row:

```ts
  if (pin.error) {
    const failure = document.createElement("span");
    failure.className = "shrink-0 text-xs text-danger-ink";
    failure.textContent = pin.error.message;
    item.append(failure);
  }
```

Extend the Refresh handler so one button covers both lists:

```ts
  refresh.addEventListener("click", () => {
    void refreshEverything(regions);
  });

async function refreshEverything(regions: Regions): Promise<void> {
  regions.refresh.setAttribute("disabled", "");
  try {
    // Settled rather than all: a failing pins refresh must not stop the assigned
    // cards updating, and each already renders its own failure.
    await Promise.allSettled([
      refreshResults(regions),
      refreshPins(regions, { refresh: true }),
    ]);
  } finally {
    regions.refresh.removeAttribute("disabled");
  }
}
```

`refreshResults` currently disables and re-enables the button in its own `finally`; move that responsibility to `refreshEverything` so the button does not re-enable while the pins call is still in flight. `refreshPins` takes `options?: { refresh?: boolean }` and passes it straight to `listPins`.

- [ ] **Step 4: Run the whole gate**

```shell
make verify
make test-e2e
```

Expected: both green. Paste the output.

- [ ] **Step 5: Commit**

```shell
git add web/src/views/today.ts .claude/e2e/tests/pins.spec.ts
git commit -m "feat(web): unpin, and one Refresh for both lists"
```

---

## After the tasks

1. **Whole-branch review** — `superpowers:requesting-code-review` on the most capable tier, over the complete diff. **Not optional:** #5's branch had all three task reviews pass while its central property was unguarded, and only a cross-task read found it. Pay particular attention to Task 4's extraction, which moved code three endpoints depend on.
2. **Fix wave, then a scoped re-review** of the fixes only.
3. **`make verify` and `make test-e2e`**, both green, output pasted.
4. **Open the pull request.** #5 merged as PR #38 on 2026-08-20 and this branch is rebased onto
   `main`, so there is nothing left to stack on — it is an ordinary pull request against `main`.
   Its body references `Closes #6`. **No label move follows**: `status:review` was deleted on
   2026-08-20, and the open pull request *is* the review state.

5. **Update the handoff** — `docs/superpowers/plans/2026-08-12-handoff.md` — with #6's state and anything a later session should not have to rediscover. Do not push it separately; it rides the end-of-day batch.
6. **Delete this plan's SDD workspace**, as `subagent-driven-development` requires. Anything worth keeping goes into the handoff first.

**Do not merge to `main` locally.** The pull request is the ending.
