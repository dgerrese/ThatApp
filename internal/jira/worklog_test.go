package jira_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/dgerrese/work-dashboard/internal/jira"
)

func amsterdamTime(t *testing.T) time.Time {
	t.Helper()

	loc, err := time.LoadLocation("Europe/Amsterdam")
	if err != nil {
		t.Fatalf("LoadLocation: %v", err)
	}

	return time.Date(2026, 8, 10, 14, 30, 0, 0, loc)
}

func TestCreateWorklogWireFormat(t *testing.T) {
	var (
		gotMethod, gotPath, gotQuery string
		gotBody                      map[string]any
	)

	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath, gotQuery = r.Method, r.URL.Path, r.URL.RawQuery
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":"10101"}`)
	})

	id, err := client.CreateWorklog(context.Background(), jira.Worklog{
		IssueKey: "ABC-1",
		Started:  amsterdamTime(t),
		Seconds:  5400,
		Comment:  "wrote the plan",
	})
	if err != nil {
		t.Fatalf("CreateWorklog: %v", err)
	}

	if id != "10101" {
		t.Errorf("id = %q, want %q", id, "10101")
	}
	if gotMethod != http.MethodPost {
		t.Errorf("method = %s, want POST", gotMethod)
	}
	if gotPath != "/rest/api/3/issue/ABC-1/worklog" {
		t.Errorf("path = %s, want /rest/api/3/issue/ABC-1/worklog", gotPath)
	}

	// Jira rejects an offset containing a colon, which is exactly what
	// time.RFC3339 produces. Amsterdam is UTC+2 in August.
	if got := gotBody["started"]; got != "2026-08-10T14:30:00.000+0200" {
		t.Errorf("started = %v, want 2026-08-10T14:30:00.000+0200", got)
	}
	if got := gotBody["timeSpentSeconds"]; got != float64(5400) {
		t.Errorf("timeSpentSeconds = %v, want 5400", got)
	}
	if _, present := gotBody["timeSpent"]; present {
		t.Error("timeSpent was sent alongside timeSpentSeconds; Jira rejects both together")
	}

	// v3 takes the comment as an Atlassian Document Format node, not a string.
	comment, ok := gotBody["comment"].(map[string]any)
	if !ok {
		t.Fatalf("comment = %#v, want an ADF object", gotBody["comment"])
	}
	if comment["type"] != "doc" || comment["version"] != float64(1) {
		t.Errorf("comment = %#v, want type doc and version 1", comment)
	}

	values, err := url.ParseQuery(gotQuery)
	if err != nil {
		t.Fatalf("ParseQuery(%q): %v", gotQuery, err)
	}
	if values.Get("adjustEstimate") != "auto" {
		t.Errorf("adjustEstimate = %q, want auto", values.Get("adjustEstimate"))
	}
	if values.Get("notifyUsers") != "false" {
		t.Errorf("notifyUsers = %q, want false", values.Get("notifyUsers"))
	}
}

func TestCreateWorklogOmitsEmptyComment(t *testing.T) {
	var gotBody map[string]any
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)
		_, _ = io.WriteString(w, `{"id":"1"}`)
	})

	if _, err := client.CreateWorklog(context.Background(), jira.Worklog{
		IssueKey: "ABC-1", Started: amsterdamTime(t), Seconds: 60,
	}); err != nil {
		t.Fatalf("CreateWorklog: %v", err)
	}

	if _, present := gotBody["comment"]; present {
		t.Error("an empty comment was sent as a field; it must be omitted entirely")
	}
}

func TestCreateWorklogRejectsBadInput(t *testing.T) {
	client := newTestClient(t, func(_ http.ResponseWriter, _ *http.Request) {
		t.Error("a request reached the server; validation should have failed first")
	})

	tests := []struct {
		name string
		w    jira.Worklog
	}{
		{"no issue key", jira.Worklog{Started: time.Now(), Seconds: 60}},
		{"zero seconds", jira.Worklog{IssueKey: "ABC-1", Started: time.Now()}},
		{"negative seconds", jira.Worklog{IssueKey: "ABC-1", Started: time.Now(), Seconds: -1}},
		{"zero started", jira.Worklog{IssueKey: "ABC-1", Seconds: 60}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := client.CreateWorklog(context.Background(), tt.w); err == nil {
				t.Error("CreateWorklog accepted invalid input; want an error")
			}
		})
	}
}

func TestUpdateWorklogTargetsTheKnownID(t *testing.T) {
	var gotMethod, gotPath string
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath = r.Method, r.URL.Path
		_, _ = io.WriteString(w, `{"id":"10101"}`)
	})

	err := client.UpdateWorklog(context.Background(), "10101", jira.Worklog{
		IssueKey: "ABC-1", Started: amsterdamTime(t), Seconds: 900,
	})
	if err != nil {
		t.Fatalf("UpdateWorklog: %v", err)
	}

	if gotMethod != http.MethodPut {
		t.Errorf("method = %s, want PUT", gotMethod)
	}
	if gotPath != "/rest/api/3/issue/ABC-1/worklog/10101" {
		t.Errorf("path = %s, want /rest/api/3/issue/ABC-1/worklog/10101", gotPath)
	}
}

func TestDeleteWorklogTargetsTheKnownID(t *testing.T) {
	var gotMethod, gotPath string
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath = r.Method, r.URL.Path
		w.WriteHeader(http.StatusNoContent)
	})

	if err := client.DeleteWorklog(context.Background(), "ABC-1", "10101"); err != nil {
		t.Fatalf("DeleteWorklog: %v", err)
	}

	if gotMethod != http.MethodDelete {
		t.Errorf("method = %s, want DELETE", gotMethod)
	}
	if gotPath != "/rest/api/3/issue/ABC-1/worklog/10101" {
		t.Errorf("path = %s, want /rest/api/3/issue/ABC-1/worklog/10101", gotPath)
	}
}

func TestWorklogNotFoundMapsToSentinel(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	})

	if err := client.DeleteWorklog(context.Background(), "ABC-1", "nope"); !errors.Is(err, jira.ErrNotFound) {
		t.Errorf("error = %v, want it to wrap ErrNotFound", err)
	}
}

func TestIssueKeyIsPathEscaped(t *testing.T) {
	var gotEscaped string
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotEscaped = r.URL.EscapedPath()
		w.WriteHeader(http.StatusNoContent)
	})

	// Issue keys arrive from Jira and from pinned-issue input. A key carrying a
	// slash must not be able to redirect the request to another path.
	if err := client.DeleteWorklog(context.Background(), "AB/C-1", "1"); err != nil {
		t.Fatalf("DeleteWorklog: %v", err)
	}

	want := "/rest/api/3/issue/AB%2FC-1/worklog/1"
	if gotEscaped != want {
		t.Errorf("escaped path = %s, want %s", gotEscaped, want)
	}
}
