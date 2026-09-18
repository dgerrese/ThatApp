# Jira error classes (#19) Implementation Plan

**Date:** 2026-09-18
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A 403 and a 429 from Jira get their own classes and honest messages, the 429 names how long to wait, and the 401 message stops blaming the email.

**Architecture:** `internal/jira` gains `ErrForbidden` and `ErrRateLimited`, plus a `RateLimitError` type that unwraps to `ErrRateLimited` and carries the `Retry-After` wait. `statusError` maps 401/403/404/429/5xx onto them. `instanceErrorFor` in `internal/server` maps each onto a status, code and message; every surface already goes through it. **This branch is stacked on `issue-79-log-jira-failures` (PR #157)**, which rewrote the same two functions; merge #157 first.

**Tech Stack:** Go standard library (`net/http`, `errors`, `time`, `strconv`), Playwright stubs.

**Spec:** Codeberg issue #19 — `tea api "repos/{owner}/{repo}/issues/19"`.

## Global Constraints

- No Go on the host: `docker compose run --rm --no-deps app go test ./internal/... -run … -v`, `make test-go`, `make verify`.
- Standard library only. Table-driven tests with `t.Run`. Jira is always an `httptest.Server`.
- Codes: 401 `credentials_rejected` (status 401), 403 `permission_denied` (status 403), 429 `rate_limited` (status 503). 404 and 5xx unchanged.
- Messages, verbatim:
  - 401: `Jira did not accept the API token for this request; check the token and its scopes`
  - 403: `your Jira account lacks permission for this`
  - 429 with a wait: `Jira is rate-limiting requests; try again in <N> seconds` (or `<N> minutes` when the wait is 60 s or more, rounded up; singular `1 second` / `1 minute`)
  - 429 without a usable wait: `Jira is rate-limiting requests; try again shortly`
- #79's logging stays exactly as it is (one line per mapped error, cancellations skipped).
- The owner's dev stack (`app`, `web`) is theirs: never `make down`, never stop/restart/recreate it.
- Comments are few and explain a non-obvious why.
- Commit unsigned with `git -c commit.gpgsign=false commit …` if signing fails; **never push**.

---

### Task 1: `internal/jira` classifies 403 and 429

**Files:**
- Modify: `internal/jira/errors.go`, `internal/jira/client.go` (`statusError`)
- Test: `internal/jira/client_test.go` (`TestStatusCodesMapToSentinelErrors`, plus a new Retry-After test)

**Interfaces:**
- Produces: `jira.ErrForbidden`, `jira.ErrRateLimited` (sentinels); `type RateLimitError struct{ Wait time.Duration }` with `Error() string` and `Unwrap() error` returning `ErrRateLimited` — a zero `Wait` means Jira gave no usable wait. `ErrUnauthorized` now means 401 only (update its doc comment).

- [ ] **Step 1: Failing tests**

In `TestStatusCodesMapToSentinelErrors`, change the `forbidden` row to want `jira.ErrForbidden`, and add
`{"rate limited", http.StatusTooManyRequests, jira.ErrRateLimited}`.

Add:

```go
func TestRateLimitCarriesTheRetryAfterWait(t *testing.T) {
	now := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name       string
		retryAfter string
		want       time.Duration
	}{
		{"seconds", "30", 30 * time.Second},
		{"an HTTP date", now.Add(2 * time.Minute).Format(http.TimeFormat), 2 * time.Minute},
		{"a date already past", now.Add(-time.Minute).Format(http.TimeFormat), 0},
		{"no header", "", 0},
		{"garbage", "soon", 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			restore := jira.SetClockForTest(func() time.Time { return now })
			t.Cleanup(restore)
			client := newTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
				if tt.retryAfter != "" {
					w.Header().Set("Retry-After", tt.retryAfter)
				}
				w.WriteHeader(http.StatusTooManyRequests)
			})

			_, err := client.SearchAssigned(context.Background())

			var limited *jira.RateLimitError
			if !errors.As(err, &limited) {
				t.Fatalf("error = %v, want a *jira.RateLimitError", err)
			}
			if limited.Wait != tt.want {
				t.Errorf("Wait = %v, want %v", limited.Wait, tt.want)
			}
			if !errors.Is(err, jira.ErrRateLimited) {
				t.Errorf("error = %v, want it to wrap ErrRateLimited", err)
			}
		})
	}
}
```

`SetClockForTest` does not exist yet: add it in a new `internal/jira/export_test.go` (package `jira`),
which only test builds compile:

```go
package jira

import "time"

// SetClockForTest swaps the clock Retry-After dates are measured against and
// returns a func that restores it.
func SetClockForTest(clock func() time.Time) func() {
	previous := now
	now = clock
	return func() { now = previous }
}
```

Run `docker compose run --rm --no-deps app go test ./internal/jira/ -v`. Expected: FAIL to compile or
FAIL on the new rows. Paste.

- [ ] **Step 2: Implement**

`internal/jira/errors.go`: add, beside the others,

```go
	// ErrForbidden means the credentials were accepted but this account may not
	// do this (403) — a permission, not a login, problem.
	ErrForbidden = errors.New("jira: permission denied")
	// ErrRateLimited means Jira asked the caller to slow down (429). The error
	// statusError returns is a *RateLimitError carrying how long to wait.
	ErrRateLimited = errors.New("jira: rate limited")
```

and, below the var block:

```go
// RateLimitError is a 429. Wait is how long Jira asked the caller to wait; zero
// when it gave no usable Retry-After.
type RateLimitError struct {
	Wait time.Duration
}

func (e *RateLimitError) Error() string { return ErrRateLimited.Error() }

func (e *RateLimitError) Unwrap() error { return ErrRateLimited }
```

Change `ErrUnauthorized`'s comment to say 401.

`internal/jira/client.go`: add `var now = time.Now` (package level, one-line comment: overridden by
tests to pin Retry-After dates). In `statusError`, split the 401/403 case and add 429, keeping #79's
` -> %d` shape:

```go
	case resp.StatusCode == http.StatusUnauthorized:
		return fmt.Errorf("%s %s -> %d: %w: %s", method, path, resp.StatusCode, ErrUnauthorized, detail)
	case resp.StatusCode == http.StatusForbidden:
		return fmt.Errorf("%s %s -> %d: %w: %s", method, path, resp.StatusCode, ErrForbidden, detail)
	case resp.StatusCode == http.StatusTooManyRequests:
		limited := &RateLimitError{Wait: retryAfter(resp.Header.Get("Retry-After"), now())}
		return fmt.Errorf("%s %s -> %d: %w: %s", method, path, resp.StatusCode, limited, detail)
```

and add:

```go
// retryAfter reads a Retry-After value, which RFC 9110 allows as whole seconds
// or an HTTP date. Anything unusable, and any date already past, is zero.
func retryAfter(value string, at time.Time) time.Duration {
	if seconds, err := strconv.Atoi(value); err == nil && seconds > 0 {
		return time.Duration(seconds) * time.Second
	}
	if when, err := http.ParseTime(value); err == nil && when.After(at) {
		return when.Sub(at)
	}
	return 0
}
```

Run the jira tests: PASS. Then `make test-go` — if any other package's test expected a 403 to be
`ErrUnauthorized`, list it; do not change `internal/server` beyond what compiles until Task 2.

- [ ] **Step 3: Commit**

```bash
git add internal/jira
git commit -m "feat(#19): Jira 403 and 429 get their own classes, and a 429 carries its wait"
```

---

### Task 2: The server answers each class honestly

**Files:**
- Modify: `internal/server/instances.go` (`instanceErrorFor`)
- Test: `internal/server/instances_test.go` (#79's `TestInstanceErrorForLogsWhatJiraSaid` table, plus a new message test)
- Modify: `.claude/e2e/tests/settings.spec.ts`, `.claude/e2e/tests/today.spec.ts` (stubbed 401 message and its assertions)

**Interfaces:**
- Consumes: `jira.ErrForbidden`, `jira.ErrRateLimited`, `*jira.RateLimitError` (Task 1).

- [ ] **Step 1: Failing tests**

In `TestInstanceErrorForLogsWhatJiraSaid`, change the 403 row's `wantCode` to `permission_denied`, and
add a 429 row (`http.StatusTooManyRequests`, body `{"message":"slow down"}`, `wantCode`
`rate_limited`).

Add a table-driven `TestInstanceErrorForTellsTheUserWhatToDo` building errors through a real client
against `httptest` (as the logging test does) and asserting status, code and the exact message for:
401 → 401/`credentials_rejected`/the 401 message; 403 → 403/`permission_denied`/the 403 message; 429
with `Retry-After: 1` → 503/`rate_limited`/`… try again in 1 second`; 429 with `Retry-After: 30` →
`… in 30 seconds`; 429 with `Retry-After: 90` → `… in 2 minutes`; 429 with no header →
`… try again shortly`. Messages verbatim from Global Constraints.

Run: FAIL. Paste.

- [ ] **Step 2: Implement**

In `instanceErrorFor`'s switch (keep #79's assign-then-log shape): add cases for `jira.ErrForbidden`
and `jira.ErrRateLimited`, and change the `ErrUnauthorized` message. For the 429 message, `errors.As`
the `*jira.RateLimitError` and format the wait with a small helper:

```go
// waitPhrase renders a Retry-After wait for a person: seconds under a minute,
// whole minutes (rounded up) from there.
func waitPhrase(wait time.Duration) string {
	if wait < time.Minute {
		seconds := int(math.Ceil(wait.Seconds()))
		if seconds == 1 {
			return "1 second"
		}
		return fmt.Sprintf("%d seconds", seconds)
	}
	minutes := int(math.Ceil(wait.Minutes()))
	if minutes == 1 {
		return "1 minute"
	}
	return fmt.Sprintf("%d minutes", minutes)
}
```

Run the server tests: PASS. `make test-go`: green.

- [ ] **Step 3: The e2e stubs**

In `settings.spec.ts` and `today.spec.ts`, the stubbed `credentials_rejected` message and every
assertion on `Jira rejected the email and API token` move to the new 401 message verbatim. Run those
two specs (mirror `make test-e2e`'s recipe): PASS on both engines.

- [ ] **Step 4: Gates**

`make verify`, then `make test-e2e`. `pwa.spec.ts` has #134's intermittent chromium crash: re-run once
and report both runs; if it crashes twice in a row, report rather than re-running further.

- [ ] **Step 5: Commit**

```bash
git add internal/server/instances.go internal/server/instances_test.go .claude/e2e/tests/settings.spec.ts .claude/e2e/tests/today.spec.ts
git commit -m "feat(#19): the server names a permission problem, a rate limit and its wait, and stops blaming the email"
```
