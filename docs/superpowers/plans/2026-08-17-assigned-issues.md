# Assigned Issues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GET /api/issues` fans out to every configured Jira instance concurrently, and a Today view at `/today` renders each instance's assigned issues in its own card.

**Architecture:** A new `internal/server/issues.go` loads the stored instances, then fetches each one's assigned issues in its own goroutine under `errgroup`, writing into a preallocated slot so the response order is the store's order. Every goroutine returns `nil` — a per-instance failure becomes an `error` field on that instance's group rather than a failed request. The frontend adds a `wd-ticket-row` component and a `today.ts` view that renders one `wd-card` per instance, and the router gains a redirect so `/` lands on `/today`.

**Tech Stack:** Go 1.26 standard library plus `golang.org/x/sync/errgroup`; `modernc.org/sqlite` through the existing store; vanilla TypeScript with native WebComponents in light DOM; Tailwind CSS v4 semantic tokens; Playwright for the browser suite. Everything runs in Docker.

**Spec:** `docs/superpowers/specs/2026-08-17-assigned-issues-design.md`

## Global Constraints

- **Everything runs in Docker.** There is no Go, Node or npm on the host. Never run them bare.
- **No JavaScript frameworks.** Vanilla TS only.
- **Tailwind v4, semantic tokens only.** Use `bg-surface`, `bg-raised`, `text-ink`, `text-ink-muted`, `text-link`, `border-edge`, `divide-edge`, and the tone families (`border-danger-edge`, `bg-danger-tint`, `text-danger-ink`, …). **A stock colour utility — `bg-white`, `text-gray-700`, `text-red-600` — or a `dark:` variant is a regression** against #30's criterion.
- **WebComponents use light DOM, never shadow DOM.** Register as `wd-*`.
- **`index.html` stays under 14kB.** It is 1314 bytes; this plan adds one nav link.
- **TypeScript is `strict` with `noUncheckedIndexedAccess`.** No `any`, no `as any`, no non-null assertion (`!`) to get past a type error.
- **Go: standard library first.** The only permitted non-stdlib additions are `modernc.org/sqlite` and `golang.org/x/sync`. Wrap errors with `%w` and context about what was attempted. Table-driven tests with `t.Run` where there are cases to table; `httptest` rather than real network.
- **No test ever contacts a real Jira instance.** Go tests use `httptest` fakes. **Playwright specs must stub `/api/issues`** — see the warning in Task 2, Step 1.
- **Comments are few.** A comment earns its place for a non-obvious "why", a workaround for external behaviour, or a subtle invariant. Never narrate the next line.
- **Naming:** a function's name must let a reader predict what it returns without opening it. `process`, `handle`, `build` and direction-hiding nouns fail that test.
- **Browsers are Firefox and Chromium.** Firefox is primary. **Never add WebKit** to the Playwright matrix.
- **Commit after every task**, with the body explaining why rather than what.

## File structure

| File | Responsibility |
|---|---|
| `internal/server/issues.go` *(create)* | The `GET /api/issues` handler, its DTOs, the per-instance fetch and the `/browse/` URL. |
| `internal/server/issues_test.go` *(create)* | Handler tests, including the concurrency proof. |
| `internal/server/instances.go` *(modify)* | `writeInstanceError` splits so the mapping is reusable without writing a response. |
| `internal/server/server.go` *(modify)* | Route registration. |
| `go.mod`, `go.sum` *(modify)* | Add `golang.org/x/sync`. |
| `web/src/types.ts` *(modify)* | `Issue`, `InstanceIssues`, `IssuesResponse`. |
| `web/src/api.ts` *(modify)* | `listIssues()`. |
| `web/src/components/wd-ticket-row.ts` *(create)* | One issue row: key, summary, status, and the Jira link when there is one. |
| `web/src/views/today.ts` *(create)* | The view: header with Refresh, one card per instance, four view states. |
| `web/src/router.ts` *(modify)* | The `/today` route, the `/` redirect, and the reworded unknown-path fallback. |
| `web/index.html` *(modify)* | A Today link in the shell nav. |
| `.claude/e2e/tests/today.spec.ts` *(create)* | The view's browser coverage and the redirect's regression test. |
| `.claude/e2e/tests/smoke.spec.ts`, `theme.spec.ts`, `settings.spec.ts` *(modify)* | Every spec that lands on `/` now meets Today, so each needs an `/api/issues` stub. |

Three tasks. Task 1 is the whole server change and is independently shippable. Task 2 is the view at `/today`, reachable by URL and fully testable before anything redirects to it. Task 3 makes `/` lead there and repairs the existing specs that assumed `/` showed a placeholder — deliberately last, because it is the only task that changes behaviour the current suite asserts.

## How to run things

```shell
make verify                                    # lint + tsc + go test ./...   (no stack needed)
make test-e2e                                  # Playwright, brings the app stack up itself
docker compose run --rm --no-deps app go test ./internal/server/ -run TestGetIssues -v
docker compose run --rm --no-deps app go test ./internal/server/ -run TestGetIssuesFansOut -v
docker compose run --rm --no-deps web npm run fmt
docker compose --profile e2e run --build --rm playwright sh -c \
  'npm ci --no-audit --no-fund && npx playwright test today.spec.ts --project=firefox'
```

`make verify` does **not** run Playwright, so a green `verify` can sit on top of a red branch. Both gates are required before the pull request. **Do not run `make down`** — it drops the volumes, destroying the dev database, which holds real Jira instances with sealed tokens.

---

### Task 1: `GET /api/issues` and the concurrent fan-out

**Files:**
- Create: `internal/server/issues.go`
- Create: `internal/server/issues_test.go`
- Modify: `internal/server/instances.go:316-336` (split `writeInstanceError`)
- Modify: `internal/server/server.go:38-45` (register the route)
- Modify: `go.mod`, `go.sum`

**Interfaces:**
- Consumes: `store.Store.Instances(ctx) ([]store.Instance, error)` ordered by `created_at, id`; `store.Instance{ID int64, Name, SiteURL, APIBaseURL, Email string, TokenEnc []byte, CreatedAt time.Time}`; `(*instanceClients).forInstance(ctx, *store.Instance) (*jira.Client, error)`; `(*jira.Client).SearchAssigned(ctx) ([]jira.Issue, error)` where `jira.Issue{Key, Summary, Status string}`; `writeJSON(w, status, payload)`; `writeError(w, status, code, message)`; `errorBody{Code, Message string}` from `json.go`.
- Produces: `GET /api/issues` answering `{"instances":[{"id","name","issues":[{"key","summary","status","url"}],"error":null|{"code","message"}}]}`. Go identifiers later tasks do not touch, but the reviewer will check: `issueDTO`, `instanceIssuesDTO`, `issuesResponseDTO`, `(*Server).handleListIssues`, `(*Server).issuesForInstance`, `browseURL`, `instanceErrorFor`, `instanceErrorBody`.

- [ ] **Step 1: Add the errgroup dependency**

`golang.org/x/sync` is on `CLAUDE.md`'s approved list but has never been fetched, so it is absent from `go.mod`. Pin the version rather than taking `@latest`, so the plan and the lockfile agree:

```shell
docker compose run --rm --no-deps app go get golang.org/x/sync@v0.22.0
```

Expected: `go.mod` gains `require golang.org/x/sync v0.22.0` and `go.sum` gains its two lines. The proxy was reachable from this container when the plan was written, and v0.22.0 was current.

**Do not run `go mod tidy` yet.** Nothing imports the package until Step 5, and `tidy` removes a module no file imports — it would delete the requirement you just added and leave you debugging a missing import. Step 7 runs it, after `issues.go` exists.

If the `go get` fails with a network error, that is a **blocker**: stop, move the ticket to `status:blocked` and report it. Do not vendor the package by hand and do not hand-roll the fan-out with `sync.WaitGroup` to avoid the dependency — the acceptance criterion names `errgroup`.

- [ ] **Step 2: Split the instance error mapping**

The per-instance path needs the same error mapping the top-level writer uses, without writing a response. Replace `writeInstanceError` at the bottom of `internal/server/instances.go` (currently lines 316-336) with these two functions. The mapping bodies are unchanged — only the shape is:

```go
// instanceErrorFor maps the errors a Jira round trip produces onto a status, a
// stable code and a message. Rejected credentials are the user's to fix in
// Settings; an unreachable site is not a server fault, so neither is a 500.
//
// It returns the mapping rather than writing it, because the assigned-issues
// fan-out embeds the same code and message in a response that is otherwise a
// success.
func instanceErrorFor(err error) (status int, code, message string) {
	switch {
	case errors.Is(err, atlassian.ErrTenantUnreadable):
		return http.StatusBadGateway, "tenant_unreadable",
			"could not read the site's tenant info; check the site URL and that the site is reachable"
	case errors.Is(err, jira.ErrUnauthorized):
		return http.StatusUnauthorized, "credentials_rejected",
			"Jira rejected the email and API token"
	case errors.Is(err, jira.ErrNotFound):
		return http.StatusBadGateway, "account_not_found",
			"the site answered but this account has no access to it; check the site URL and account email"
	case errors.Is(err, jira.ErrUnreachable):
		return http.StatusBadGateway, "instance_unreachable", "the Jira site could not be reached"
	default:
		log.Printf("unexpected instance error: %v", err)
		return http.StatusInternalServerError, "unexpected", "an unexpected error occurred"
	}
}

func writeInstanceError(w http.ResponseWriter, err error) {
	status, code, message := instanceErrorFor(err)
	writeError(w, status, code, message)
}
```

Every existing caller of `writeInstanceError` is unchanged. Nothing else in `instances.go` moves — in particular **do not** split the file: the handoff's condition for that was #5's issue routes landing in it, and they land in `issues.go` instead.

- [ ] **Step 3: Write the failing tests**

Create `internal/server/issues_test.go`. These are the five acceptance criteria, and the last one is the criterion a refactor to a plain loop would fail:

```go
package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/dgerrese/work-dashboard/internal/crypto"
	"github.com/dgerrese/work-dashboard/internal/store"
)

// jiraSearchServer stands in for one Jira site's search endpoint. keyPrefix
// names the issue it returns, status other than 200 makes the search fail, and
// delay is what makes the fan-out's concurrency observable.
//
// It answers only the search path: a request to anything else is a test bug
// worth failing loudly for, not something to answer with an empty result.
func jiraSearchServer(t *testing.T, keyPrefix string, status int, delay time.Duration) *httptest.Server {
	t.Helper()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if delay > 0 {
			time.Sleep(delay)
		}
		if r.URL.Path != "/rest/api/3/search/jql" {
			t.Errorf("unexpected path %q", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if status != http.StatusOK {
			w.WriteHeader(status)
			return
		}
		_, _ = w.Write([]byte(`{"issues":[{"key":"` + keyPrefix + `-1","fields":{` +
			`"summary":"First thing","status":{"name":"In Progress"}}}]}`))
	}))
	t.Cleanup(srv.Close)

	return srv
}

// seedInstance stores an instance whose API base is already the fake site, so
// forInstance needs no tenant-info lookup and the fan-out reaches nothing but
// the stub. siteURL is stored as given, including empty, which is how a migrated
// row is reproduced.
func seedInstance(
	t *testing.T, db *store.Store, sealer *crypto.Sealer, name, siteURL, apiBase string,
) *store.Instance {
	t.Helper()

	sealed, err := sealer.Seal("token-" + name)
	if err != nil {
		t.Fatalf("sealing the token for %q: %v", name, err)
	}

	inst, err := db.CreateInstance(context.Background(), store.InstanceInput{
		Name: name, SiteURL: siteURL, APIBaseURL: apiBase,
		Email: "me@example.com", TokenEnc: sealed,
	})
	if err != nil {
		t.Fatalf("creating instance %q: %v", name, err)
	}

	return inst
}

// getIssues calls the endpoint and returns both the recorder and the decoded
// body, so a test can assert on the status and the payload without repeating the
// decode.
func getIssues(t *testing.T, srv *Server) (*httptest.ResponseRecorder, issuesResponseDTO) {
	t.Helper()

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/issues", nil))

	var body issuesResponseDTO
	if rec.Code == http.StatusOK {
		// Decoded from a copy: decoding rec.Body directly drains it, and one test
		// asserts on the raw JSON afterwards to tell an empty array from null.
		if err := json.NewDecoder(strings.NewReader(rec.Body.String())).Decode(&body); err != nil {
			t.Fatalf("decoding body: %v", err)
		}
	}

	return rec, body
}

func TestGetIssuesReturnsEveryInstancesIssues(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	work := jiraSearchServer(t, "WORK", http.StatusOK, 0)
	personal := jiraSearchServer(t, "PERS", http.StatusOK, 0)
	seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", work.URL)
	seedInstance(t, db, sealer, "Personal", "https://personal.atlassian.net", personal.URL)

	rec, body := getIssues(t, srv)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body)
	}
	if len(body.Instances) != 2 {
		t.Fatalf("got %d instance groups, want 2", len(body.Instances))
	}
	// Order is the store's — created_at, id — not the order the goroutines
	// happened to finish in.
	if body.Instances[0].Name != "Work" || body.Instances[1].Name != "Personal" {
		t.Errorf("names = %q, %q; want Work, Personal",
			body.Instances[0].Name, body.Instances[1].Name)
	}
	if len(body.Instances[0].Issues) != 1 {
		t.Fatalf("Work has %d issues, want 1", len(body.Instances[0].Issues))
	}

	issue := body.Instances[0].Issues[0]
	if issue.Key != "WORK-1" {
		t.Errorf("key = %q, want WORK-1", issue.Key)
	}
	if issue.Summary != "First thing" {
		t.Errorf("summary = %q, want First thing", issue.Summary)
	}
	if issue.Status != "In Progress" {
		t.Errorf("status = %q, want In Progress", issue.Status)
	}
	if issue.URL != "https://work.atlassian.net/browse/WORK-1" {
		t.Errorf("url = %q, want https://work.atlassian.net/browse/WORK-1", issue.URL)
	}
	if body.Instances[0].Error != nil {
		t.Errorf("Work carries an error: %+v", body.Instances[0].Error)
	}
}

// The criterion: one failing instance must not blank the list.
func TestGetIssuesKeepsWorkingInstancesWhenOneFails(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	work := jiraSearchServer(t, "WORK", http.StatusOK, 0)
	broken := jiraSearchServer(t, "PERS", http.StatusUnauthorized, 0)
	seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", work.URL)
	seedInstance(t, db, sealer, "Personal", "https://personal.atlassian.net", broken.URL)

	rec, body := getIssues(t, srv)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; a broken instance is data, not a failed request", rec.Code, http.StatusOK)
	}
	if len(body.Instances[0].Issues) != 1 {
		t.Errorf("Work has %d issues, want 1; a sibling's failure blanked it", len(body.Instances[0].Issues))
	}

	failed := body.Instances[1]
	if failed.Error == nil {
		t.Fatal("Personal carries no error")
	}
	if failed.Error.Code != "credentials_rejected" {
		t.Errorf("code = %q, want credentials_rejected", failed.Error.Code)
	}
	// Not nil: the view iterates without a null check.
	if failed.Issues == nil {
		t.Error("issues is null for the failed instance, want an empty array")
	}
}

func TestGetIssuesWithNoInstancesIsAnEmptyList(t *testing.T) {
	srv, _, _ := newServerWithStore(t)

	rec, body := getIssues(t, srv)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if len(body.Instances) != 0 {
		t.Errorf("got %d instance groups, want 0", len(body.Instances))
	}
	// Asserted on the raw body: decoding cannot tell [] from null, and the view
	// iterates the array.
	if !strings.Contains(rec.Body.String(), `"instances":[]`) {
		t.Errorf("body = %s, want instances as an empty array", rec.Body.String())
	}
}

// A row migrated from a gateway URL has no site to link to. It must still return
// its issues, with no URL rather than a malformed one.
func TestGetIssuesOmitsTheURLWithoutASiteURL(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	site := jiraSearchServer(t, "WORK", http.StatusOK, 0)
	seedInstance(t, db, sealer, "Migrated", "", site.URL)

	_, body := getIssues(t, srv)

	if len(body.Instances) != 1 || len(body.Instances[0].Issues) != 1 {
		t.Fatalf("got %+v, want one instance with one issue", body.Instances)
	}
	if got := body.Instances[0].Issues[0].URL; got != "" {
		t.Errorf("url = %q, want empty for an instance with no site URL", got)
	}
}

// The concurrency criterion. Two instances that each take fetchDelay must
// together take closer to one delay than to two. A refactor to a serial loop
// fails this and nothing else.
func TestGetIssuesFansOutConcurrently(t *testing.T) {
	const fetchDelay = 200 * time.Millisecond
	const budget = 350 * time.Millisecond

	srv, db, sealer := newServerWithStore(t)
	first := jiraSearchServer(t, "WORK", http.StatusOK, fetchDelay)
	second := jiraSearchServer(t, "PERS", http.StatusOK, fetchDelay)
	seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", first.URL)
	seedInstance(t, db, sealer, "Personal", "https://personal.atlassian.net", second.URL)

	start := time.Now()
	rec, body := getIssues(t, srv)
	elapsed := time.Since(start)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if len(body.Instances) != 2 {
		t.Fatalf("got %d instance groups, want 2", len(body.Instances))
	}
	if elapsed > budget {
		t.Errorf("took %v for two %v instances, want under %v; the fan-out is serial",
			elapsed, fetchDelay, budget)
	}
}
```

- [ ] **Step 4: Run them and watch them fail**

```shell
docker compose run --rm --no-deps app go test ./internal/server/ -run TestGetIssues -v
```

Expected: **compilation failure**, not test failures — `undefined: issuesResponseDTO` and `undefined: issueDTO`. That is the right RED here: the DTOs the tests decode into do not exist yet. Paste the output into the task report.

- [ ] **Step 5: Write the handler**

Create `internal/server/issues.go`:

```go
package server

import (
	"context"
	"net/http"
	"strings"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/dgerrese/work-dashboard/internal/store"
)

// issueFetchTimeout bounds one instance's fetch. jira.Client allows itself 30s
// per call, which is too long here: the response waits on every instance, so a
// single stalled site would hold the whole list open. Bounding each instance
// separately means a stalled one reports its own error while the rest render.
const issueFetchTimeout = 15 * time.Second

// issueDTO is one issue as the Today view needs it. The URL is built here rather
// than in the browser because the site URL is server-side state, and a migrated
// row has none — which the empty string carries without the client having to
// know why.
type issueDTO struct {
	Key     string `json:"key"`
	Summary string `json:"summary"`
	Status  string `json:"status"`
	URL     string `json:"url"`
}

// instanceIssuesDTO groups one instance's issues, or the reason it has none.
// Error is nil on success; Issues is never nil, so the view can iterate it
// without a null check.
type instanceIssuesDTO struct {
	ID     int64      `json:"id"`
	Name   string     `json:"name"`
	Issues []issueDTO `json:"issues"`
	Error  *errorBody `json:"error"`
}

type issuesResponseDTO struct {
	Instances []instanceIssuesDTO `json:"instances"`
}

// handleListIssues answers with every configured instance's assigned issues,
// fetched concurrently. It returns 200 whenever the instance list itself could be
// read: one unreachable Jira site is data about that instance, not a failure of
// this request.
func (s *Server) handleListIssues(w http.ResponseWriter, r *http.Request) {
	instances, err := s.db.Instances(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not read the stored instances")
		return
	}

	// Preallocated and written by index, so the response order is the store's
	// order without a mutex and without sorting afterwards.
	groups := make([]instanceIssuesDTO, len(instances))

	// errgroup is here for Wait and its context, not for error propagation: every
	// goroutine returns nil on purpose. The first failure must not cancel the
	// others, so a failure is recorded in that instance's own slot instead.
	group, ctx := errgroup.WithContext(r.Context())
	for i, inst := range instances {
		group.Go(func() error {
			groups[i] = s.issuesForInstance(ctx, inst)
			return nil
		})
	}
	_ = group.Wait()

	writeJSON(w, http.StatusOK, issuesResponseDTO{Instances: groups})
}

// issuesForInstance fetches one instance's assigned issues. It never returns an
// error: a per-instance failure is part of the response, and returning one would
// cancel every sibling through the errgroup's context.
func (s *Server) issuesForInstance(ctx context.Context, inst store.Instance) instanceIssuesDTO {
	group := instanceIssuesDTO{ID: inst.ID, Name: inst.Name, Issues: []issueDTO{}}

	ctx, cancel := context.WithTimeout(ctx, issueFetchTimeout)
	defer cancel()

	client, err := s.clients.forInstance(ctx, &inst)
	if err != nil {
		group.Error = instanceErrorBody(err)
		return group
	}

	issues, err := client.SearchAssigned(ctx)
	if err != nil {
		group.Error = instanceErrorBody(err)
		return group
	}

	for _, issue := range issues {
		group.Issues = append(group.Issues, issueDTO{
			Key:     issue.Key,
			Summary: issue.Summary,
			Status:  issue.Status,
			URL:     browseURL(inst.SiteURL, issue.Key),
		})
	}

	return group
}

// instanceErrorBody is the mapping the top-level writer uses, as a body to embed
// in a response that is otherwise a success. The status is dropped deliberately:
// the enclosing response is a 200.
func instanceErrorBody(err error) *errorBody {
	_, code, message := instanceErrorFor(err)

	return &errorBody{Code: code, Message: message}
}

// browseURL is the human-facing link to an issue. An instance migrated from a
// gateway URL has no site to link to, and the empty string is how the view learns
// to render the key as plain text instead of a dead anchor.
func browseURL(siteURL, key string) string {
	if siteURL == "" {
		return ""
	}

	return strings.TrimSuffix(siteURL, "/") + "/browse/" + key
}
```

Two things not to "tidy":

- **No `i, inst := i, inst` inside the loop.** Go 1.22 made loop variables per-iteration, and `go.mod` says 1.26; the old shadowing trick is now dead code that `copyloopvar` flags.
- **`_ = group.Wait()` is deliberate.** Wait can only ever return nil here because no goroutine returns an error, and the assignment is what keeps `errcheck` honest about that being a choice.

`inst` is passed by value and `forInstance` takes a pointer to that copy: when it resolves and persists a missing `api_base_url`, the database write still happens and only the local copy's field is updated. That is the same behaviour the connection-test handler already has.

- [ ] **Step 6: Register the route**

In `internal/server/server.go`, after the instances routes and before the `/api/` catch-all:

```go
	s.mux.HandleFunc("POST /api/instances/{id}/test", s.handleTestInstance)
	s.mux.HandleFunc("GET /api/issues", s.handleListIssues)
	s.mux.HandleFunc("/api/", handleAPINotFound)
```

- [ ] **Step 7: Run the tests and watch them pass**

```shell
docker compose run --rm --no-deps app go mod tidy
docker compose run --rm --no-deps app go test ./internal/server/ -run TestGetIssues -v
```

`tidy` belongs here rather than in Step 1: now that `issues.go` imports `errgroup`, it keeps the requirement instead of dropping it. Check `go.mod` afterwards — `golang.org/x/sync v0.22.0` must be in the direct `require` block, with no `// indirect` comment.

Expected: all five tests PASS. If `TestGetIssuesFansOutConcurrently` fails on time, do **not** raise the budget — that assertion is the acceptance criterion. Check that `group.Go` really wraps the fetch and that nothing between the loop and `Wait` blocks.

Then the whole suite, since Step 2 changed a function four handlers call:

```shell
docker compose run --rm --no-deps app go test ./...
```

- [ ] **Step 8: Verify and commit**

```shell
make verify 2>&1 | tee /tmp/task1-verify.log
```

Expected: ends in `verify: OK`. Paste it into the task report; a task that cannot show it is not done.

```shell
git add go.mod go.sum internal/server/issues.go internal/server/issues_test.go \
  internal/server/instances.go internal/server/server.go
git commit -m "$(cat <<'EOF'
feat(api): assigned issues fanned out across every instance

GET /api/issues answers 200 whenever the instance list could be read: one
unreachable Jira site is data about that instance, not a failure of the
request, so each group carries either its issues or its own error.

Every goroutine returns nil deliberately. errgroup is here for Wait and
its context, not its error propagation — the first failure cancelling the
rest is exactly the behaviour the ticket exists to prevent.
EOF
)"
```

---

### Task 2: The Today view at `/today`

**Files:**
- Create: `web/src/components/wd-ticket-row.ts`
- Create: `web/src/views/today.ts`
- Create: `.claude/e2e/tests/today.spec.ts`
- Modify: `web/src/types.ts` (append)
- Modify: `web/src/api.ts:1` (import) and end of file (new function)
- Modify: `web/src/router.ts:10-12` (add the route)

**Interfaces:**
- Consumes: `GET /api/issues` from Task 1, exactly as its shape is written there; `request<T>` and `ApiError` from `api.ts`; `ApiErrorBody` from `types.ts`; the `wd-card` (attribute `heading`), `wd-button` (attributes `label`, `variant`, `disabled`) and `wd-alert` (attributes `tone`, `message`) components.
- Produces: `render(root: HTMLElement): Promise<void>` from `views/today.ts`, the shape `router.ts` requires; `listIssues(): Promise<IssuesResponse>`; the `wd-ticket-row` element with attributes `key`, `summary`, `status`, `url`; the types `Issue`, `InstanceIssues`, `IssuesResponse`. Task 3 consumes the route registration and nothing else from this task.

- [ ] **Step 1: Write the failing spec**

Create `.claude/e2e/tests/today.spec.ts`.

**Read this before writing the stub.** `make test-e2e` runs the `app` service against the `wd-data` volume — the developer's dev database, which holds real Jira instances with real sealed tokens. A spec that renders Today **without** stubbing `/api/issues` makes the server fan out to a real Jira site, which breaks `CLAUDE.md`'s "no test ever contacts a real Jira instance" and makes the spec slow and flaky. Every test that reaches Today stubs `/api/issues`. No exceptions.

```ts
import { expect, test, type Page } from "@playwright/test";

interface StubIssue {
  key: string;
  summary: string;
  status: string;
  url: string;
}

interface StubGroup {
  id: number;
  name: string;
  issues: StubIssue[];
  error: { code: string; message: string } | null;
}

/**
 * Stubs /api/issues so these specs cover the view; the fan-out has its own
 * httptest coverage. It is also what keeps the browser away from real Jira: the
 * e2e stack shares the dev database, so an unstubbed Today would fan out to
 * whatever instances are configured in it.
 *
 * Each call to the endpoint takes the next response, and the last one repeats,
 * so a Refresh test can hand over two different lists.
 */
async function stubIssues(page: Page, ...responses: StubGroup[][]): Promise<void> {
  let calls = 0;

  await page.route("**/api/issues", async (route) => {
    const index = Math.min(calls, responses.length - 1);
    calls += 1;
    await route.fulfill({ status: 200, json: { instances: responses[index] } });
  });
}

function group(id: number, name: string, issues: StubIssue[]): StubGroup {
  return { id, name, issues, error: null };
}

const workIssue: StubIssue = {
  key: "WORK-412",
  summary: "Fix the CSV export encoding",
  status: "In Progress",
  url: "https://work.atlassian.net/browse/WORK-412",
};

const personalIssue: StubIssue = {
  key: "PERS-7",
  summary: "Renew the domain",
  status: "To Do",
  url: "https://personal.atlassian.net/browse/PERS-7",
};

test("both instances' issues render under their own headings", async ({ page }) => {
  await stubIssues(page, [group(1, "Work", [workIssue]), group(2, "Personal", [personalIssue])]);
  await page.goto("/today");

  await expect(page.getByRole("heading", { name: "Work" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Personal" })).toBeVisible();
  await expect(page.getByText("Fix the CSV export encoding")).toBeVisible();
  await expect(page.getByText("Renew the domain")).toBeVisible();
  await expect(page.getByText("In Progress")).toBeVisible();
});

// The criterion: one instance failing must not cost the other its issues.
test("one instance failing still shows the other's issues", async ({ page }) => {
  await stubIssues(page, [
    group(1, "Work", [workIssue]),
    {
      id: 2,
      name: "Personal",
      issues: [],
      error: { code: "credentials_rejected", message: "Jira rejected the email and API token" },
    },
  ]);
  await page.goto("/today");

  await expect(page.getByText("Fix the CSV export encoding")).toBeVisible();
  await expect(page.getByText("Jira rejected the email and API token")).toBeVisible();
});

test("an issue key links to Jira, and a row with no site URL does not", async ({ page }) => {
  await stubIssues(page, [
    group(1, "Work", [workIssue, { ...personalIssue, key: "MIGR-3", url: "" }]),
  ]);
  await page.goto("/today");

  const link = page.getByRole("link", { name: "WORK-412" });
  await expect(link).toHaveAttribute("href", "https://work.atlassian.net/browse/WORK-412");
  await expect(link).toHaveAttribute("target", "_blank");
  // Without noopener the opened page gets a handle back into this one.
  await expect(link).toHaveAttribute("rel", "noopener");

  await expect(page.getByText("MIGR-3")).toBeVisible();
  await expect(page.getByRole("link", { name: "MIGR-3" })).toHaveCount(0);
});

test("an instance with nothing assigned says so", async ({ page }) => {
  await stubIssues(page, [group(1, "Work", [])]);
  await page.goto("/today");

  await expect(page.getByRole("heading", { name: "Work" })).toBeVisible();
  await expect(page.getByText("No issues assigned.")).toBeVisible();
});

// With nothing configured there is nothing to refresh, so the control that could
// only ever refetch an empty list is not on screen at all.
test("no configured instances offers Settings instead of a Refresh button", async ({ page }) => {
  await stubIssues(page, []);
  await page.goto("/today");

  await expect(page.getByText("No Jira instances yet.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeHidden();
});

test("Refresh replaces the list", async ({ page }) => {
  await stubIssues(page, [group(1, "Work", [workIssue])], [group(1, "Work", [personalIssue])]);
  await page.goto("/today");

  await expect(page.getByText("Fix the CSV export encoding")).toBeVisible();

  await page.getByRole("button", { name: "Refresh" }).click();

  await expect(page.getByText("Renew the domain")).toBeVisible();
  await expect(page.getByText("Fix the CSV export encoding")).toBeHidden();
});

test("a failed request shows the error and leaves Refresh usable", async ({ page }) => {
  await page.route("**/api/issues", (route) =>
    route.fulfill({
      status: 500,
      json: { code: "store_failed", message: "could not read the stored instances" },
    }),
  );
  await page.goto("/today");

  await expect(page.getByText("could not read the stored instances")).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
});
```

- [ ] **Step 2: Run the spec and watch it fail**

```shell
docker compose --profile e2e run --build --rm playwright sh -c \
  'npm ci --no-audit --no-fund && npx playwright test today.spec.ts --project=firefox'
```

Expected: all seven FAIL. `/today` has no registered route, so the router renders its placeholder and none of the headings, rows or buttons exist. Paste the output.

- [ ] **Step 3: Add the types**

Append to `web/src/types.ts`:

```ts
export interface Issue {
  key: string;
  summary: string;
  status: string;
  /** Empty when the instance has no site URL, which leaves nothing to link to. */
  url: string;
}

/** One instance's assigned issues, or the reason it has none. */
export interface InstanceIssues {
  id: number;
  name: string;
  issues: Issue[];
  error: ApiErrorBody | null;
}

export interface IssuesResponse {
  instances: InstanceIssues[];
}
```

`url` is a plain `string`, not optional: the Go struct has no pointer there, and under `noUncheckedIndexedAccess` an optional field costs a guard at every use for no gain.

- [ ] **Step 4: Add the API call**

In `web/src/api.ts`, extend the type import on line 1 and append the function:

```ts
import type { ApiErrorBody, ConnectionTest, Instance, InstanceDraft, IssuesResponse } from "./types";
```

```ts
export function listIssues(): Promise<IssuesResponse> {
  return request<IssuesResponse>("/api/issues");
}
```

- [ ] **Step 5: Write the row component**

Create `web/src/components/wd-ticket-row.ts`:

```ts
/**
 * One issue: its key, its summary and its status. Light DOM, so #7 and #8 can
 * append a timer and a duration field to it without a slot.
 *
 * Its own content lives in a wrapper the component owns and re-renders, rather
 * than in the host's children — the same shape wd-button uses — so that anything
 * a later ticket appends survives an attribute change.
 */
export class WdTicketRow extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["key", "summary", "status", "url"];
  }

  private body: HTMLElement | undefined;

  connectedCallback(): void {
    this.className = "flex items-baseline gap-3 py-3";

    if (!this.body) {
      this.body = document.createElement("div");
      this.body.className = "flex flex-1 items-baseline justify-between gap-3";
      this.append(this.body);
    }
    this.render();
  }

  attributeChangedCallback(): void {
    if (this.body) {
      this.render();
    }
  }

  private render(): void {
    const body = this.body;
    if (!body) return;

    const url = this.getAttribute("url") ?? "";

    const identity = document.createElement("div");
    identity.className = "flex items-baseline gap-3";
    identity.append(this.keyLabel(url), this.summary());

    const status = document.createElement("span");
    status.className = "shrink-0 text-xs text-ink-muted";
    status.textContent = this.getAttribute("status") ?? "";

    body.replaceChildren(identity, status);
  }

  /**
   * An anchor only when there is somewhere to go. An instance migrated from a
   * gateway URL has no site, and an anchor with an empty href navigates to the
   * current page instead of doing nothing.
   */
  private keyLabel(url: string): HTMLElement {
    const key = this.getAttribute("key") ?? "";

    if (url === "") {
      const span = document.createElement("span");
      span.className = "font-mono text-sm font-medium text-ink-muted";
      span.textContent = key;

      return span;
    }

    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    // Without noopener the opened page gets a window.opener handle back here.
    link.rel = "noopener";
    link.className = "font-mono text-sm font-medium text-link underline";
    link.textContent = key;

    return link;
  }

  private summary(): HTMLElement {
    const summary = document.createElement("span");
    summary.className = "text-sm";
    summary.textContent = this.getAttribute("summary") ?? "";

    return summary;
  }
}

customElements.define("wd-ticket-row", WdTicketRow);
```

- [ ] **Step 6: Write the view**

Create `web/src/views/today.ts`:

```ts
import "../components/wd-alert";
import "../components/wd-button";
import "../components/wd-card";
import "../components/wd-ticket-row";

import { ApiError, listIssues } from "../api";
import type { InstanceIssues, IssuesResponse } from "../types";

/**
 * The regions that outlive a fetch. They are threaded rather than held at module
 * scope: router.ts reuses one persistent mount point and has no navigation
 * cancellation, so module state would let a stale fetch write into a live view.
 */
interface Regions {
  header: HTMLElement;
  refresh: HTMLElement;
  results: HTMLElement;
}

export async function render(root: HTMLElement): Promise<void> {
  const container = document.createElement("div");
  container.className = "space-y-4";

  const header = document.createElement("div");
  header.className = "flex items-baseline justify-between";

  const heading = document.createElement("h2");
  heading.className = "text-lg font-medium";
  heading.textContent = "Assigned issues";

  const refresh = button("Refresh", "secondary");
  header.append(heading, refresh);

  // Hidden until the first response: there is nothing to refresh yet, and with
  // no instances configured it stays hidden for good.
  header.hidden = true;

  const results = document.createElement("div");
  results.className = "space-y-4";
  results.append(loadingLine());

  container.append(header, results);
  root.append(container);

  const regions: Regions = { header, refresh, results };
  refresh.addEventListener("click", () => {
    void load(regions);
  });

  await load(regions);
}

async function load(regions: Regions): Promise<void> {
  regions.refresh.setAttribute("disabled", "");

  try {
    // The cards already on screen stay put while this is in flight: a list that
    // blinks out and back is indistinguishable from one that broke.
    renderResponse(regions, await listIssues());
  } catch (error) {
    regions.header.hidden = false;
    regions.results.replaceChildren(alertFor("error", messageOf(error)));
  } finally {
    regions.refresh.removeAttribute("disabled");
  }
}

function renderResponse(regions: Regions, response: IssuesResponse): void {
  if (response.instances.length === 0) {
    regions.header.hidden = true;
    regions.results.replaceChildren(noInstances());
    return;
  }

  regions.header.hidden = false;
  regions.results.replaceChildren(...response.instances.map(instanceCard));
}

function instanceCard(group: InstanceIssues): HTMLElement {
  const card = document.createElement("wd-card");
  // wd-card has no observedAttributes, so the heading must be set before the
  // element is inserted; changing it afterwards silently does nothing.
  card.setAttribute("heading", group.name);

  if (group.error) {
    card.append(alertFor("error", group.error.message));

    return card;
  }

  if (group.issues.length === 0) {
    const empty = document.createElement("p");
    empty.className = "text-sm text-ink-muted";
    empty.textContent = "No issues assigned.";
    card.append(empty);

    return card;
  }

  const list = document.createElement("ul");
  list.className = "divide-y divide-edge";
  for (const issue of group.issues) {
    const item = document.createElement("li");
    const row = document.createElement("wd-ticket-row");
    row.setAttribute("key", issue.key);
    row.setAttribute("summary", issue.summary);
    row.setAttribute("status", issue.status);
    row.setAttribute("url", issue.url);
    item.append(row);
    list.append(item);
  }
  card.append(list);

  return card;
}

function loadingLine(): HTMLElement {
  const line = document.createElement("p");
  line.className = "text-sm text-ink-muted";
  line.textContent = "Loading…";

  return line;
}

function noInstances(): HTMLElement {
  const wrapper = document.createElement("div");

  const paragraph = document.createElement("p");
  paragraph.className = "text-ink-muted";
  paragraph.textContent = "No Jira instances yet. Add one to see your assigned issues.";

  const link = document.createElement("a");
  link.href = "/settings";
  link.dataset["route"] = "";
  link.className = "mt-4 inline-block font-medium text-link underline";
  link.textContent = "Open Settings";

  wrapper.append(paragraph, link);

  return wrapper;
}

// button, alertFor and messageOf are deliberate duplicates of the same three
// helpers in views/settings.ts. Extracting them into a shared module is the right
// end state, but #29 is rewriting every line of that file in an open pull
// request, and a shared module would guarantee a conflict for three six-line
// functions. Extract once #29 has merged.

function button(label: string, variant: string): HTMLElement {
  const element = document.createElement("wd-button");
  // label is the sole source of the inner button's accessible name; without it
  // role-based queries cannot find the button at all.
  element.setAttribute("label", label);
  element.setAttribute("variant", variant);

  return element;
}

function alertFor(tone: string, message: string): HTMLElement {
  const alert = document.createElement("wd-alert");
  alert.setAttribute("tone", tone);
  alert.setAttribute("message", message);

  return alert;
}

/** The server's message when there is one; ApiError carries it already. */
function messageOf(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  return "Something went wrong.";
}
```

- [ ] **Step 7: Register the route**

In `web/src/router.ts`:

```ts
const routes: Record<string, () => Promise<View>> = {
  "/settings": () => import("./views/settings"),
  "/today": () => import("./views/today"),
};
```

- [ ] **Step 8: Run the spec, then both gates**

```shell
docker compose --profile e2e run --build --rm playwright sh -c \
  'npm ci --no-audit --no-fund && npx playwright test today.spec.ts'
```

Expected: 14 passing — seven tests on Firefox and Chromium. Then the whole suite, because the frontend bundle changed:

```shell
make test-e2e 2>&1 | tee /tmp/task2-e2e.log
make verify 2>&1 | tee /tmp/task2-verify.log
```

Expected: every existing spec still passes. Nothing in this task touches `/`, so `smoke.spec.ts`, `theme.spec.ts` and `settings.spec.ts` are unaffected — if one of them fails here, something registered the redirect early and that belongs to Task 3.

Confirm the view is still lazily loaded, since the 14kB budget depends on it:

```shell
docker compose run --rm --no-deps web sh -c \
  'rm -rf dist && npm run build && ls -l dist && (grep -c "Assigned issues" dist/app.js || true)'
```

`rm -rf dist` first: `build.mjs` never cleans the directory, so any measurement taken from a dirty `dist/` is untrustworthy. The `|| true` is there because `grep -c` exits non-zero when it finds nothing, which is the outcome you want here and would otherwise read as a failed command.

Expected: `dist/app.js` stays around 1kB and the count is **0** — the view's strings live in a `chunk-*.js`, not in the entry bundle. A non-zero count means code splitting broke and the 14kB budget is being blown silently, which is exactly what happened once before in #4.

- [ ] **Step 9: Format, verify and commit**

```shell
docker compose run --rm --no-deps web npm run fmt
git diff --stat
```

Expected: only the files this task touched. Then:

```shell
git add web/src/components/wd-ticket-row.ts web/src/views/today.ts web/src/types.ts \
  web/src/api.ts web/src/router.ts .claude/e2e/tests/today.spec.ts
git commit -m "$(cat <<'EOF'
feat(web): the Today view, one card per instance

A card per instance rather than one merged list, so an instance's failure
renders where its issues would have been, and jira.Issue needs no updated
field to sort a merged list by.

wd-ticket-row renders into a wrapper it owns rather than into the host's
children, so the timer and duration field #7 and #8 append survive an
attribute change.
EOF
)"
```

---

### Task 3: `/` leads to Today, and the specs that assumed otherwise

**Files:**
- Modify: `web/src/router.ts` (the redirect, and the reworded fallback)
- Modify: `web/index.html:26-33` (the nav)
- Modify: `.claude/e2e/tests/today.spec.ts` (append the redirect test)
- Modify: `.claude/e2e/tests/smoke.spec.ts:3-16`
- Modify: `.claude/e2e/tests/theme.spec.ts:11-49`
- Modify: `.claude/e2e/tests/settings.spec.ts:96-108`

**Interfaces:**
- Consumes: the `/today` route from Task 2, and `stubIssues` from `today.spec.ts`.
- Produces: no new module interface. `/` answers as `/today`; `renderPlaceholder` keeps its name and signature and only its copy changes.

This task changes behaviour the existing suite asserts, which is why it is last and why its verification step runs the whole suite rather than one spec.

- [ ] **Step 1: Write the failing test**

Append to `.claude/e2e/tests/today.spec.ts`:

```ts
test("/ leads to Today and leaves no history trap", async ({ page }) => {
  await stubIssues(page, [group(1, "Work", [workIssue])]);
  await page.route("**/api/instances", (route) => route.fulfill({ status: 200, json: [] }));

  await page.goto("/");

  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByText("Fix the CSV export encoding")).toBeVisible();

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);

  await page.goBack();

  // replaceState, not pushState: "/" never entered the history stack, so Back
  // lands on Today instead of on "/" redirecting forward again.
  await expect(page).toHaveURL(/\/today$/);
});

test("an unknown path offers a way back to Today", async ({ page }) => {
  await page.goto("/nowhere");

  await expect(page.getByText("There is nothing at this address.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to Today" })).toBeVisible();
});
```

The second test needs no stub: an unknown path renders the fallback and never mounts a view.

- [ ] **Step 2: Run it and watch it fail**

```shell
docker compose --profile e2e run --build --rm playwright sh -c \
  'npm ci --no-audit --no-fund && npx playwright test today.spec.ts --project=firefox -g "history trap|unknown path"'
```

Expected: both FAIL. The first because `/` still renders the placeholder, so the URL never becomes `/today`; the second on the old copy, which still reads "Nothing here yet. Add a Jira instance to get started."

- [ ] **Step 3: Add the redirect**

In `web/src/router.ts`, add the map below `routes`:

```ts
/**
 * "/" is not a view of its own. The rewrite uses replaceState rather than
 * pushState: a pushed redirect leaves "/" in the history stack, so Back lands on
 * it and is redirected forward again, trapping the user on Today.
 */
const redirects: Record<string, string> = { "/": "/today" };
```

and consult it at the top of `renderCurrent`, before the route lookup:

```ts
async function renderCurrent(): Promise<void> {
  const root = mountPoint;
  if (!root) return;

  const target = redirects[window.location.pathname];
  if (target) {
    window.history.replaceState({}, "", target);
  }

  const load = routes[window.location.pathname];
  if (!load) {
    renderPlaceholder(root);
    return;
  }

  const view = await load();
  root.replaceChildren();
  await view.render(root);
}
```

- [ ] **Step 4: Reword the fallback**

Replace `renderPlaceholder` in `web/src/router.ts`. It is no longer the landing page, so it stops offering to set the app up:

```ts
/**
 * The fallback for a path with no view. "/" now leads to Today, so reaching this
 * means a genuinely unknown URL rather than the app's front door.
 */
function renderPlaceholder(root: HTMLElement): void {
  root.replaceChildren();

  const paragraph = document.createElement("p");
  paragraph.className = "text-ink-muted";
  paragraph.textContent = "There is nothing at this address.";

  const link = document.createElement("a");
  link.href = "/today";
  link.dataset["route"] = "";
  link.className = "mt-4 inline-block font-medium text-link underline";
  link.textContent = "Go to Today";

  root.append(paragraph, link);
}
```

- [ ] **Step 5: Add the nav link**

In `web/index.html`, replace the `<nav>` block:

```html
        <nav class="flex gap-4">
          <a
            href="/today"
            data-route
            class="text-sm font-medium text-ink-muted underline hover:text-ink"
            >Today</a
          >
          <a
            href="/settings"
            data-route
            class="text-sm font-medium text-ink-muted underline hover:text-ink"
            >Settings</a
          >
        </nav>
```

The `>Today</a\n>` wrapping is Prettier's, not a typo: whitespace before the closing tag would become a rendered space inside the link. Step 8 runs the formatter, which will produce exactly this.

- [ ] **Step 6: Repair the specs that assumed `/` showed a placeholder**

Four tests in `theme.spec.ts` and one in `smoke.spec.ts` navigate to `/` with no API stub, which was safe only while `/` mounted no view. Each now reaches Today, and **an unstubbed Today fans out to the dev database's real Jira instances.**

In `.claude/e2e/tests/theme.spec.ts`, add the helper below the `bodyBackground` function:

```ts
/**
 * "/" leads to Today, which fetches on render. Themeing is a property of the
 * shell rather than of any view, so the list can be empty — but it has to be
 * stubbed: the e2e stack shares the dev database, and an unstubbed Today would
 * fan out to the real Jira instances configured in it.
 */
async function stubIssues(page: Page): Promise<void> {
  await page.route("**/api/issues", (route) =>
    route.fulfill({ status: 200, json: { instances: [] } }),
  );
}
```

Replace the comment above the first test (currently lines 11-12) with nothing — the new helper carries the explanation — and add `await stubIssues(page);` before each of the four `await page.goto("/")` calls, in "follows a light OS when nothing is stored", "follows a dark OS when nothing is stored", "a stored preference is applied before the bundle loads" and "unreadable storage still themes from the OS".

In `.claude/e2e/tests/smoke.spec.ts`, rewrite the first test. It proves more than it used to: the bundle ran, the redirect fired, and a lazily imported view mounted.

```ts
test("the app shell boots and the bundle runs", async ({ page }) => {
  // Today fetches on render, and the e2e stack shares the dev database, so this
  // has to be stubbed or the fan-out reaches real Jira instances.
  await page.route("**/api/issues", (route) =>
    route.fulfill({ status: 200, json: { instances: [] } }),
  );

  await page.goto("/");

  await expect(page).toHaveTitle("Work Dashboard");
  await expect(page.getByRole("heading", { name: "Work Dashboard" })).toBeVisible();

  // The shell ships an empty #view. Seeing Today's empty state proves the bundle
  // parsed, "/" redirected, and the dynamic import() of a view resolved.
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByText("No Jira instances yet.")).toBeVisible();
});
```

The second smoke test, "an unknown route still serves the app shell", goes to `/week` and asserts only the response status and the shell heading. It needs no change and no stub — `/week` is unrouted, so it renders the fallback and fetches nothing.

In `.claude/e2e/tests/settings.spec.ts`, the last test navigates to `/`. Add the issues stub and correct the comment, which names a placeholder that is no longer there:

```ts
test("settings is reachable from the shell nav", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await page.route("**/api/issues", (route) =>
    route.fulfill({ status: 200, json: { instances: [] } }),
  );
  await page.goto("/");

  // exact: true disambiguates from the "Open Settings" link in Today's
  // no-instances state, which is on screen at "/" and whose accessible name
  // contains "Settings" as a substring.
  await page.getByRole("link", { name: "Settings", exact: true }).click();

  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Add an instance" })).toBeVisible();
});
```

**Both `exact: true` locators in that file stay.** They are load-bearing for two independent reasons — `getByText("Work")` collides with the shell's `<h1>Work Dashboard</h1>`, and the Settings link collides with an "Open Settings" link that Today's empty state still provides. Do not tidy either away.

- [ ] **Step 7: Run the spec, then the whole suite**

```shell
docker compose --profile e2e run --build --rm playwright sh -c \
  'npm ci --no-audit --no-fund && npx playwright test today.spec.ts --project=firefox -g "history trap|unknown path"'
```

Expected: both PASS. Then everything, on both browsers — this task's whole risk is in the specs it changed:

```shell
make test-e2e 2>&1 | tee /tmp/task3-e2e.log
```

Expected: every spec green, and the count is **48** — 24 per browser: the 15 that were there before this branch, plus Task 2's seven and this task's two. If the total is anything else, a test was lost rather than repaired.

If a theme test fails on a colour, check that its `stubIssues` call comes **before** `page.goto`, not after — a route registered after navigation does not catch a request the page has already made.

- [ ] **Step 8: Format, check the budget, verify and commit**

```shell
docker compose run --rm --no-deps web npm run fmt
wc -c web/index.html
```

Expected: under 14336 bytes with enormous headroom — it was 1314 and this adds one link.

```shell
make verify 2>&1 | tee /tmp/task3-verify.log
```

Expected: ends in `verify: OK`.

```shell
git add web/src/router.ts web/index.html .claude/e2e/tests/today.spec.ts \
  .claude/e2e/tests/smoke.spec.ts .claude/e2e/tests/theme.spec.ts \
  .claude/e2e/tests/settings.spec.ts
git commit -m "$(cat <<'EOF'
feat(web): / leads to Today, and the nav says so

replaceState rather than pushState: a pushed redirect leaves "/" in the
history stack, so Back lands on it and is sent forward again.

Five existing tests navigated to "/" with no API stub, which was safe only
while "/" mounted no view. The e2e stack shares the dev database, so an
unstubbed Today would fan out to real Jira instances — every spec that
reaches Today now stubs /api/issues.
EOF
)"
```

---

## Self-review against the spec

**Spec coverage.** Every section maps to a task: the response envelope, the shared error mapping, the fan-out, the per-instance timeout and `errgroup`'s deliberate non-use of error propagation are Task 1; `types.ts`, `api.ts`, `wd-ticket-row`, `today.ts` and the four view states are Task 2; the redirect, the reworded fallback and the nav link are Task 3. Both test sections are covered, Go in Task 1 Step 3 and Playwright across Tasks 2 and 3.

**One thing the spec did not foresee**, found while planning and handled in Task 3 Step 6: five existing tests navigate to `/`, and because `make test-e2e` runs the app against the dev database, an unstubbed Today would fan out to real Jira instances — breaking `CLAUDE.md`'s rule that no test ever contacts one. The plan stubs `/api/issues` in every spec that reaches Today. **The deeper fix is a disposable database for the e2e profile**, which is a rig change worth its own intake ticket rather than a silent widening of this one.

**Two spec sentences the plan deliberately does not implement.** The spec's "#6 inherits the pinned-issues layout question" and "#7 must revisit the wholesale re-render" are notes for later tickets, not work here. They belong in the handoff when this branch finishes.

**Type consistency.** `issueDTO`/`instanceIssuesDTO`/`issuesResponseDTO` in Task 1 are mirrored by `Issue`/`InstanceIssues`/`IssuesResponse` in Task 2, field for field and name for name (`url` ↔ `URL`, `error` ↔ `Error *errorBody`). `instanceErrorFor` is defined in Task 1 Step 2 and consumed by `instanceErrorBody` in Step 5. `stubIssues` is defined in Task 2 Step 1 and reused by Task 3 Step 1; `theme.spec.ts` and `smoke.spec.ts` get their own local stubs rather than importing across spec files, which the rig has no shared module for.

**Where the risk sits.** `TestGetIssuesFansOutConcurrently` is the one test whose failure means the architecture is wrong rather than a detail. It is timing-based, so it is the one test in this plan that could flake on a loaded machine — the budget is 350ms against a 400ms serial floor, which is deliberately narrow enough to catch a serial refactor and wide enough for scheduling noise. If it proves flaky in practice, the honest fix is a wider delay and a proportionally wider budget, never dropping the assertion.
