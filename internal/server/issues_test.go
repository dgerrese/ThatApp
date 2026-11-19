package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/dgerrese/ThatApp/internal/crypto"
	"github.com/dgerrese/ThatApp/internal/store"
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
	work := jiraSearchServer(t, "WORK", http.StatusOK, 150*time.Millisecond)
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
