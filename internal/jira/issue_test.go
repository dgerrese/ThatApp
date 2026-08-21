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
	var gotEscaped string
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotEscaped = r.URL.EscapedPath()
		_, _ = w.Write([]byte(`{"key":"A/B-1","fields":{"summary":"s","status":{"name":"n"}}}`))
	})

	if _, err := client.Issue(context.Background(), "A/B-1"); err != nil {
		t.Fatalf("Issue: %v", err)
	}

	want := "/rest/api/3/issue/A%2FB-1"
	if gotEscaped != want {
		t.Errorf("escaped path = %s, want %s", gotEscaped, want)
	}
}

func TestIssueMapsAMissingKeyToNotFound(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	})

	_, err := client.Issue(context.Background(), "NOPE-1")

	if !errors.Is(err, jira.ErrNotFound) {
		t.Errorf("err = %v, want ErrNotFound", err)
	}
}
