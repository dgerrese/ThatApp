package jira_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestSearchAssignedSendsBoundedJQLAndNamedFields(t *testing.T) {
	var got struct {
		JQL        string   `json:"jql"`
		Fields     []string `json:"fields"`
		MaxResults int      `json:"maxResults"`
	}
	var gotMethod, gotPath string

	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath = r.Method, r.URL.Path
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &got)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"issues":[]}`))
	})

	if _, err := client.SearchAssigned(context.Background()); err != nil {
		t.Fatalf("SearchAssigned: %v", err)
	}

	if gotMethod != http.MethodPost {
		t.Errorf("method = %s, want POST", gotMethod)
	}
	if gotPath != "/rest/api/3/search/jql" {
		t.Errorf("path = %s, want /rest/api/3/search/jql", gotPath)
	}
	if !strings.Contains(got.JQL, "assignee = currentUser()") {
		t.Errorf("jql = %q, missing the assignee clause", got.JQL)
	}
	if !strings.Contains(got.JQL, "statusCategory != Done") {
		t.Errorf("jql = %q, missing the statusCategory clause", got.JQL)
	}
	// Omitting fields makes Jira return ids only, which would render an empty list.
	if len(got.Fields) == 0 {
		t.Error("fields was empty; Jira returns ids only unless fields are named")
	}
	if got.MaxResults <= 0 {
		t.Errorf("maxResults = %d, want a positive page size", got.MaxResults)
	}
}

func TestSearchAssignedFollowsNextPageToken(t *testing.T) {
	var tokens []string
	pages := []string{
		`{"issues":[{"key":"ABC-1","fields":{"summary":"first","status":{"name":"In Progress"}}}],"nextPageToken":"page2"}`,
		`{"issues":[{"key":"ABC-2","fields":{"summary":"second","status":{"name":"To Do"}}}],"nextPageToken":"page3"}`,
		// Last page: nextPageToken is absent, which is how Jira signals the end.
		`{"issues":[{"key":"ABC-3","fields":{"summary":"third","status":{"name":"To Do"}}}]}`,
	}
	call := 0

	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			NextPageToken string `json:"nextPageToken"`
		}
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &body)
		tokens = append(tokens, body.NextPageToken)

		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, pages[call])
		call++
	})

	issues, err := client.SearchAssigned(context.Background())
	if err != nil {
		t.Fatalf("SearchAssigned: %v", err)
	}

	if len(issues) != 3 {
		t.Fatalf("got %d issues, want 3 across three pages", len(issues))
	}
	want := []string{"ABC-1", "ABC-2", "ABC-3"}
	for i, issue := range issues {
		if issue.Key != want[i] {
			t.Errorf("issue[%d].Key = %s, want %s", i, issue.Key, want[i])
		}
	}
	if issues[0].Summary != "first" {
		t.Errorf("summary = %q, want %q", issues[0].Summary, "first")
	}
	if issues[0].Status != "In Progress" {
		t.Errorf("status = %q, want %q", issues[0].Status, "In Progress")
	}

	// First request carries no token; each later one carries the previous response's.
	wantTokens := []string{"", "page2", "page3"}
	for i, tok := range wantTokens {
		if tokens[i] != tok {
			t.Errorf("request %d token = %q, want %q", i, tokens[i], tok)
		}
	}
}

func TestSearchAssignedStopsOnRepeatedToken(t *testing.T) {
	// A server that always returns the same token would page forever. The client
	// must not depend on the server being well behaved.
	client := newTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"issues":[{"key":"ABC-1","fields":{"summary":"s","status":{"name":"To Do"}}}],"nextPageToken":"same"}`)
	})

	done := make(chan struct{})
	go func() {
		defer close(done)
		if _, err := client.SearchAssigned(context.Background()); err == nil {
			t.Error("SearchAssigned looped on a repeating token without erroring")
		}
	}()

	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("SearchAssigned did not terminate on a repeating nextPageToken")
	}
}

func TestSearchAssignedReturnsEmptyNotNil(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"issues":[]}`)
	})

	issues, err := client.SearchAssigned(context.Background())
	if err != nil {
		t.Fatalf("SearchAssigned: %v", err)
	}
	if issues == nil {
		t.Error("issues is nil; want an empty slice so it encodes as [] not null")
	}
	if len(issues) != 0 {
		t.Errorf("got %d issues, want 0", len(issues))
	}
}
