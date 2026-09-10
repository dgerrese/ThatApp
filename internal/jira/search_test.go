package jira_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"slices"
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
	// Pinned whole rather than by substring: the ORDER BY is what puts the most
	// recently touched work at the top of the Today view, and a Contains check
	// would not notice it disappearing.
	wantJQL := "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC"
	if got.JQL != wantJQL {
		t.Errorf("jql = %q, want %q", got.JQL, wantJQL)
	}
	// Omitting fields, or naming the wrong ones, makes Jira return ids only and
	// every summary would render blank.
	for _, field := range []string{"summary", "status"} {
		if !slices.Contains(got.Fields, field) {
			t.Errorf("fields = %v, missing %q", got.Fields, field)
		}
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
	want := `summary ~ "security*" ORDER BY updated DESC`
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
	client := newTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
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
	client := newTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
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

func TestSearchTextEscapesTheQueryIntoTheJQL(t *testing.T) {
	tests := []struct {
		name  string
		query string
		want  string
	}{
		{
			name:  "quotes and backslashes are escaped",
			query: `say "hi"`,
			want:  `summary ~ "say \"hi\"*" ORDER BY updated DESC`,
		},
		{
			// A query already containing a wildcard must not be double-wildcarded:
			// SearchText appends its own trailing `*`, and "secur**" is a 400 from
			// Jira rather than a broader match.
			name:  "a trailing wildcard the user already typed is not doubled",
			query: `secur*`,
			want:  `summary ~ "secur*" ORDER BY updated DESC`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got struct {
				JQL string `json:"jql"`
			}
			client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
					t.Errorf("decoding the request: %v", err)
				}
				_, _ = w.Write([]byte(`{"issues":[]}`))
			})

			if _, err := client.SearchText(context.Background(), tt.query, 10); err != nil {
				t.Fatalf("SearchText: %v", err)
			}

			if got.JQL != tt.want {
				t.Errorf("jql = %q, want %q", got.JQL, tt.want)
			}
		})
	}
}

func TestSearchTextAddsAKeyClauseOnlyWhenTheQueryLooksLikeAKey(t *testing.T) {
	tests := []struct {
		name  string
		query string
		want  string
	}{
		{
			name:  "a key-shaped query searches the key and the summary",
			query: "RIDGE-4102",
			want:  `(key = "RIDGE-4102" OR summary ~ "RIDGE-4102*") ORDER BY updated DESC`,
		},
		{
			name:  "an ordinary word searches the summary alone",
			query: "capacity",
			want:  `summary ~ "capacity*" ORDER BY updated DESC`,
		},
		{
			name:  "a lowercase key still counts as a key",
			query: "ridge-4102",
			want:  `(key = "ridge-4102" OR summary ~ "ridge-4102*") ORDER BY updated DESC`,
		},
		{
			name:  "a hyphenated word is not a key",
			query: "capacity-review",
			want:  `summary ~ "capacity-review*" ORDER BY updated DESC`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got struct {
				JQL string `json:"jql"`
			}
			client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
					t.Errorf("decoding the request: %v", err)
				}
				_, _ = w.Write([]byte(`{"issues":[]}`))
			})

			if _, err := client.SearchText(context.Background(), tt.query, 10); err != nil {
				t.Fatalf("SearchText: %v", err)
			}

			if got.JQL != tt.want {
				t.Errorf("jql = %q, want %q", got.JQL, tt.want)
			}
		})
	}
}
