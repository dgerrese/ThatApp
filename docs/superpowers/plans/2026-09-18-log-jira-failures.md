# Log Jira failures (#79) Implementation Plan

**Date:** 2026-09-18
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Jira failure the server maps is logged once with the method, path, status and Jira's own body, so `docker compose logs app` shows what Jira objected to.

**Architecture:** `statusError` (`internal/jira/client.go`) already wraps method, path and Jira's body into every error it returns; it gains the numeric status in one uniform format, since only its default branch carries the number today. `instanceErrorFor` (`internal/server/instances.go`) — the single function every Jira failure passes through — classifies first, then logs once for every case with the code it chose. Nothing a response carries changes.

**Tech Stack:** Go standard library (`log`, `net/http/httptest`).

**Spec:** Codeberg issue #79 — `tea api "repos/{owner}/{repo}/issues/79"`.

## Global Constraints

- No Go on the host: `make test-go`, `make verify`, or `docker compose run --rm --no-deps app go test ./internal/... -run … -v`.
- Standard library only.
- No test contacts a real Jira instance: Jira is an `httptest.Server`.
- The status, code and message of every response are unchanged.
- No logged line may carry the account email or the API token.
- Table-driven tests with `t.Run` subtests.
- Comments are few and explain a non-obvious why.
- The owner's dev stack (`app`, `web`) is theirs: never `make down`, never stop/restart/recreate it.
- Commit unsigned with `git -c commit.gpgsign=false commit …` if signing fails; **never push**.

---

### Task 1: Log every mapped Jira failure, with its status and body

**Files:**
- Modify: `internal/jira/client.go` (`statusError`)
- Modify: `internal/server/instances.go` (`instanceErrorFor`)
- Test: `internal/server/instances_test.go` (new table-driven test)

**Interfaces:** none shared with other tasks.

- [ ] **Step 1: Write the failing test**

Add to `internal/server/instances_test.go` (add imports `bytes`, `context`, `log` as needed):

```go
// #79: what Jira said is only useful if something records it. Every mapped
// failure — classified or not — is logged once with the request, the status
// and Jira's own body, and never with the credentials that made the request.
func TestInstanceErrorForLogsWhatJiraSaid(t *testing.T) {
	cases := []struct {
		name     string
		status   int
		body     string
		wantCode string
	}{
		{"a 401", http.StatusUnauthorized, `{"code":401,"message":"Unauthorized; scope does not match"}`, "credentials_rejected"},
		{"a 403", http.StatusForbidden, `{"errorMessages":["You do not have permission"]}`, "credentials_rejected"},
		{"a 404", http.StatusNotFound, `{"errorMessages":["Issue does not exist"]}`, "account_not_found"},
		{"a 5xx", http.StatusBadGateway, `upstream exploded`, "instance_unreachable"},
		{"an unmapped status", http.StatusTeapot, `short and stout`, "unexpected"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			jiraSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			t.Cleanup(jiraSrv.Close)

			client, err := jira.New(jiraSrv.URL, "me@example.com", "s3cret-token")
			if err != nil {
				t.Fatalf("building the client: %v", err)
			}
			_, jiraErr := client.Myself(context.Background())
			if jiraErr == nil {
				t.Fatal("Myself() succeeded against a failing server")
			}

			var logged bytes.Buffer
			previous := log.Writer()
			log.SetOutput(&logged)
			t.Cleanup(func() { log.SetOutput(previous) })

			_, code, _ := instanceErrorFor(jiraErr)

			if code != tc.wantCode {
				t.Errorf("code = %q, want %q (the response contract must not move)", code, tc.wantCode)
			}
			line := logged.String()
			if n := strings.Count(line, "\n"); n != 1 {
				t.Errorf("logged %d lines, want exactly 1: %q", n, line)
			}
			for _, want := range []string{"/rest/api/3/myself", strconv.Itoa(tc.status), tc.body} {
				if !strings.Contains(line, want) {
					t.Errorf("log line %q does not contain %q", line, want)
				}
			}
			for _, secret := range []string{"me@example.com", "s3cret-token"} {
				if strings.Contains(line, secret) {
					t.Errorf("log line %q leaks %q", line, secret)
				}
			}
		})
	}
}
```

Before running, check `internal/jira/myself.go` for the exact path `Myself` requests and use it in the
expected strings if it is not `/rest/api/3/myself`. Check the codes against `instanceErrorFor` as it
stands; if one differs, use the real one — this test must not change the contract.

- [ ] **Step 2: Run it to verify it fails**

Run: `docker compose run --rm --no-deps app go test ./internal/server/ -run TestInstanceErrorForLogsWhatJiraSaid -v`
Expected: FAIL — the four classified cases log nothing ("logged 0 lines"); the unmapped case logs one
line. Paste the output.

- [ ] **Step 3: Carry the status in every Jira error**

In `internal/jira/client.go`, `statusError`'s four return statements become one uniform shape that
carries the numeric status:

```go
	switch {
	case resp.StatusCode == http.StatusUnauthorized, resp.StatusCode == http.StatusForbidden:
		return fmt.Errorf("%s %s -> %d: %w: %s", method, path, resp.StatusCode, ErrUnauthorized, detail)
	case resp.StatusCode == http.StatusNotFound:
		return fmt.Errorf("%s %s -> %d: %w: %s", method, path, resp.StatusCode, ErrNotFound, detail)
	case resp.StatusCode >= 500:
		return fmt.Errorf("%s %s -> %d: %w: %s", method, path, resp.StatusCode, ErrUnreachable, detail)
	default:
		return fmt.Errorf("%s %s -> %d: unexpected status: %s", method, path, resp.StatusCode, detail)
	}
```

- [ ] **Step 4: Log once, after classifying**

In `internal/server/instances.go`, `instanceErrorFor` becomes: the existing switch assigns
`status, code, message` instead of returning them (the default branch keeps its values but drops its
own `log.Printf`), then one line logs every case and the function returns:

```go
	// Jira's own words live only in err (#79); the response deliberately
	// carries a fixed message, so this line is the one place they survive.
	log.Printf("instance error, answered %s: %v", code, err)

	return status, code, message
```

Update the function's doc comment only if it now says something false.

- [ ] **Step 5: Run the test, then the packages**

`docker compose run --rm --no-deps app go test ./internal/server/ -run TestInstanceErrorForLogsWhatJiraSaid -v` — PASS, 5/5.
Then `make test-go` — every package green; if any existing test asserted on the old error string
format, update its expectation to the new one and list each such change in the report.

- [ ] **Step 6: Gates**

`make verify`. Expected: `verify: OK`. (No frontend change; `make test-e2e` is not required.)

- [ ] **Step 7: Commit**

```bash
git add internal/jira/client.go internal/server/instances.go internal/server/instances_test.go
git commit -m "fix(#79): every mapped Jira failure is logged with its status and Jira's own body"
```
