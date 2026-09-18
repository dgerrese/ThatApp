# Pins test gaps (#57) Implementation Plan

**Date:** 2026-09-18
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three gaps in `internal/server/pins_test.go` that would let a real pins regression through.

**Architecture:** Tests only. One shared Jira-issue handler that both stub servers use, so the delayed one asserts the path too; a table-driven test driving a 401 and a 500 through `POST /api/pins`; and a refresh test with two pins on one instance where the first is missing. Each is shown failing against a deliberately broken version of the code it guards, and the break is reverted.

**Tech Stack:** Go standard library (`net/http/httptest`, `testing`).

**Spec:** Codeberg issue #57 — `tea api "repos/{owner}/{repo}/issues/57"`.

## Global Constraints

- No Go on the host: `docker compose run --rm --no-deps app go test ./internal/server/ -run … -v`, `make test-go`, `make verify`.
- **Tests only.** No production code changes. If a new test finds a real defect, stop and report it — do not fold a fix in.
- No test contacts a real Jira instance.
- Table-driven tests with `t.Run` subtests where there is more than one case.
- The owner's dev stack (`app`, `web`) is theirs: never `make down`, never stop/restart/recreate it.
- Comments are few and explain a non-obvious why.
- Commit unsigned with `git -c commit.gpgsign=false commit …` if signing fails; **never push**.

---

### Task 1: Three pins tests that can fail

**Files:**
- Modify: `internal/server/pins_test.go`

**Interfaces:** none shared with other tasks.

**The breaks.** Each step proves its test by breaking production code in the working tree, running the
test (FAIL), and restoring the file with `git checkout -- <file>` before moving on. Never commit a
break. Paste each failure into the report with the exact edit that caused it.

- [ ] **Step 1: One handler for both Jira-issue stubs**

Replace `jiraIssueServer` and `jiraIssueServerWithDelay` (currently lines ~164-204) with:

```go
// jiraIssueHandler stands in for one site's single-issue endpoint. A code other
// than 200 makes the lookup fail. Both stub servers below share it, so neither
// can stay green against a client calling the wrong Jira path.
func jiraIssueHandler(t *testing.T, summary, status string, code int) http.HandlerFunc {
	t.Helper()

	return func(w http.ResponseWriter, r *http.Request) {
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
	}
}

func jiraIssueServer(t *testing.T, summary, status string, code int) *httptest.Server {
	t.Helper()

	srv := httptest.NewServer(jiraIssueHandler(t, summary, status, code))
	t.Cleanup(srv.Close)

	return srv
}

func jiraIssueServerWithDelay(
	t *testing.T, summary, status string, code int, delay time.Duration,
) *httptest.Server {
	t.Helper()

	handle := jiraIssueHandler(t, summary, status, code)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(delay)
		handle(w, r)
	}))
	t.Cleanup(srv.Close)

	return srv
}
```

Run `docker compose run --rm --no-deps app go test ./internal/server/ -run 'Pin|Refresh' -v` — all
green.

**Break:** in `internal/jira/`, change the path the single-issue lookup requests (find it with
`grep -rn '/rest/api/3/issue/' internal/jira`) to `/rest/api/3/issues/`. Run
`go test ./internal/server/ -run TestRefreshKeepsWorkingPinsWhenOneInstanceFails -v` — it uses the
delayed server — and show it FAILS with `unexpected path`. (Against the old helper it would have
passed.) Restore.

- [ ] **Step 2: A non-404 Jira failure through `POST /api/pins`**

Add after `TestPostPinRejectsAKeyThatDoesNotExist`:

```go
// Only a 404 is special-cased on the pin path; every other Jira failure must
// reach the shared mapping, the same one the refresh path uses.
func TestPostPinReportsOtherJiraFailuresThroughTheSharedMapping(t *testing.T) {
	cases := []struct {
		name       string
		jiraStatus int
		wantStatus int
		wantCode   string
	}{
		{"rejected credentials", http.StatusUnauthorized, http.StatusUnauthorized, "credentials_rejected"},
		{"a failing site", http.StatusInternalServerError, http.StatusBadGateway, "instance_unreachable"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv, db, sealer := newServerWithStore(t)
			jiraSrv := jiraIssueServer(t, "", "", tc.jiraStatus)
			inst := seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", jiraSrv.URL)

			rec := postPin(t, srv, `{"instanceId":`+strconv.FormatInt(inst.ID, 10)+`,"issueKey":"SHARED-12"}`)

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d; body %s", rec.Code, tc.wantStatus, rec.Body.String())
			}
			var body errorBody
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("decoding %s: %v", rec.Body.String(), err)
			}
			if body.Code != tc.wantCode {
				t.Errorf("code = %q, want %q", body.Code, tc.wantCode)
			}
			pins, err := db.Pins(context.Background())
			if err != nil {
				t.Fatalf("reading pins: %v", err)
			}
			if len(pins) != 0 {
				t.Errorf("stored %d pins after a failed lookup, want none", len(pins))
			}
		})
	}
}
```

Check the expected statuses and codes against `instanceErrorFor` in `internal/server/instances.go`
before running; if one differs, use the real one and say so — this ticket documents the contract, it
does not change it.

Run it: PASS. **Break:** in `internal/server/pins.go`'s create handler, replace the non-404 branch's
`writeInstanceError(w, err)` with `writeError(w, http.StatusInternalServerError, "unexpected", "boom")`.
Run: FAIL on both cases. Restore.

- [ ] **Step 3: A missing issue does not stop its instance's other pins refreshing**

Add after `TestRefreshDoesNotUnpinAMissingIssue`:

```go
// The refresh loop walks one instance's pins in order. A pin whose issue is
// gone must be reported and skipped, not end the walk for the pins after it.
func TestRefreshKeepsGoingPastAMissingIssueOnTheSameInstance(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	jiraSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/rest/api/3/issue/GONE-1":
			w.WriteHeader(http.StatusNotFound)
		case "/rest/api/3/issue/SHARED-1":
			_, _ = w.Write([]byte(`{"key":"SHARED-1","fields":{"summary":"Refreshed","status":{"name":"Done"}}}`))
		default:
			t.Errorf("unexpected path %q", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(jiraSrv.Close)
	inst := seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", jiraSrv.URL)
	// The missing one first, so a walk that stops at it never reaches the other.
	for _, key := range []string{"GONE-1", "SHARED-1"} {
		if _, err := db.CreatePin(context.Background(), store.PinInput{
			InstanceID: inst.ID, IssueKey: key, SummaryCache: "cached", StatusCache: "cached",
		}); err != nil {
			t.Fatalf("creating the pin %q: %v", key, err)
		}
	}

	_, body := getPins(t, srv, "?refresh=1")

	byKey := map[string]pinDTO{}
	for _, pin := range body {
		byKey[pin.Key] = pin
	}
	gone, ok := byKey["GONE-1"]
	if !ok || gone.Error == nil || gone.Error.Code != "issue_not_found" || gone.Summary != "cached" {
		t.Errorf("GONE-1 = %+v, want kept with its cache and an issue_not_found error", gone)
	}
	shared, ok := byKey["SHARED-1"]
	if !ok || shared.Error != nil || shared.Summary != "Refreshed" || shared.Status != "Done" {
		t.Errorf("SHARED-1 = %+v, want the refreshed values and no error", shared)
	}

	stored, err := db.Pins(context.Background())
	if err != nil {
		t.Fatalf("reading pins: %v", err)
	}
	if len(stored) != 2 {
		t.Fatalf("stored pins = %d, want both kept", len(stored))
	}
	for _, pin := range stored {
		want := map[string]string{"GONE-1": "cached", "SHARED-1": "Refreshed"}[pin.IssueKey]
		if pin.SummaryCache != want {
			t.Errorf("stored %s summary = %q, want %q", pin.IssueKey, pin.SummaryCache, want)
		}
	}
}
```

If `db.Pins` does not return pins in creation order, or the refresh loop walks them in some other
order, read `refreshPins` in `internal/server/pins.go` and make sure `GONE-1` is walked first — say
how in the report.

Run it: PASS. **Break:** change the `continue` in the refresh loop's error branch to `break`. Run:
FAIL (SHARED-1 not refreshed). Restore.

- [ ] **Step 4: Gates**

`make test-go` then `make verify`. Expected: all green, `verify: OK`. Confirm `git diff --stat` shows
only `internal/server/pins_test.go`.

- [ ] **Step 5: Commit**

```bash
git add internal/server/pins_test.go
git commit -m "test(#57): close three pins test gaps a regression could slip through"
```
