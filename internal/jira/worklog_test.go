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

// adfText digs the single text node out of a minimal ADF document, returning ""
// when the document carries no text at all.
func adfText(t *testing.T, doc map[string]any) string {
	t.Helper()

	content, ok := doc["content"].([]any)
	if !ok || len(content) == 0 {
		return ""
	}
	paragraph, ok := content[0].(map[string]any)
	if !ok {
		return ""
	}
	inner, ok := paragraph["content"].([]any)
	if !ok || len(inner) == 0 {
		return ""
	}
	node, ok := inner[0].(map[string]any)
	if !ok {
		return ""
	}
	text, _ := node["text"].(string)

	return text
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
	// The wrapping is the part worth asserting: a helper that produced a valid
	// but empty doc would satisfy the type and version checks above while every
	// pushed worklog carried a blank comment.
	if got := adfText(t, comment); got != "wrote the plan" {
		t.Errorf("comment text = %q, want %q", got, "wrote the plan")
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

func TestUpdateWorklogWireFormat(t *testing.T) {
	var (
		gotMethod, gotPath, gotQuery string
		gotBody                      map[string]any
	)

	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath, gotQuery = r.Method, r.URL.Path, r.URL.RawQuery
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)
		_, _ = io.WriteString(w, `{"id":"10101"}`)
	})

	err := client.UpdateWorklog(context.Background(), "10101", jira.Worklog{
		IssueKey: "ABC-1", Started: amsterdamTime(t), Seconds: 900, Comment: "corrected",
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

	// Update carries the same duration, timestamp and estimate semantics as
	// create. Asserting only method and path here would let the whole query
	// string and body be deleted without a single test noticing.
	if got := gotBody["started"]; got != "2026-08-10T14:30:00.000+0200" {
		t.Errorf("started = %v, want 2026-08-10T14:30:00.000+0200", got)
	}
	if got := gotBody["timeSpentSeconds"]; got != float64(900) {
		t.Errorf("timeSpentSeconds = %v, want 900", got)
	}
	comment, ok := gotBody["comment"].(map[string]any)
	if !ok {
		t.Fatalf("comment = %#v, want an ADF object", gotBody["comment"])
	}
	if got := adfText(t, comment); got != "corrected" {
		t.Errorf("comment text = %q, want %q", got, "corrected")
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

func TestUpdateWorklogClearsAnEmptiedComment(t *testing.T) {
	var gotBody map[string]any
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)
		_, _ = io.WriteString(w, `{"id":"10101"}`)
	})

	err := client.UpdateWorklog(context.Background(), "10101", jira.Worklog{
		IssueKey: "ABC-1", Started: amsterdamTime(t), Seconds: 900,
	})
	if err != nil {
		t.Fatalf("UpdateWorklog: %v", err)
	}

	// A PUT leaves omitted fields unchanged, so omitting the comment the way
	// create does would strand the old text in Jira with no way to remove it.
	comment, ok := gotBody["comment"].(map[string]any)
	if !ok {
		t.Fatalf("comment = %#v, want an explicit empty ADF document, not an absent field", gotBody["comment"])
	}
	if got := adfText(t, comment); got != "" {
		t.Errorf("comment text = %q, want it empty", got)
	}
}

func TestDeleteWorklogTargetsTheKnownID(t *testing.T) {
	var gotMethod, gotPath, gotQuery string
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath, gotQuery = r.Method, r.URL.Path, r.URL.RawQuery
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

	// deleteWorklog defaults notifyUsers to true just as add and update do.
	// Ticket 10 deletes the Jira worklog whenever a pushed entry is removed, so
	// without this every correction emails the whole watcher list.
	values, err := url.ParseQuery(gotQuery)
	if err != nil {
		t.Fatalf("ParseQuery(%q): %v", gotQuery, err)
	}
	if values.Get("notifyUsers") != "false" {
		t.Errorf("notifyUsers = %q, want false", values.Get("notifyUsers"))
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
