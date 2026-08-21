package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type searchBody struct {
	Results []issueHitDTO        `json:"results"`
	Errors  []instanceFailureDTO `json:"errors"`
}

func searchIssues(t *testing.T, srv *Server, query string) (*httptest.ResponseRecorder, searchBody) {
	t.Helper()

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/issues/search?q="+query, nil))

	var body searchBody
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decoding %s: %v", rec.Body.String(), err)
		}
	}

	return rec, body
}

func TestSearchReturnsHitsFromEveryInstance(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	first := jiraSearchServer(t, "WORK", http.StatusOK, 0)
	second := jiraSearchServer(t, "PERS", http.StatusOK, 0)
	seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", first.URL)
	seedInstance(t, db, sealer, "Personal", "https://personal.atlassian.net", second.URL)

	rec, body := searchIssues(t, srv, "security")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if len(body.Results) != 2 {
		t.Fatalf("got %d results, want one per instance", len(body.Results))
	}
	if body.Results[0].InstanceName != "Work" || body.Results[1].InstanceName != "Personal" {
		t.Errorf("results = %+v, want them labelled and in store order", body.Results)
	}
	if body.Results[0].URL != "https://work.atlassian.net/browse/WORK-1" {
		t.Errorf("url = %q, want the browse URL", body.Results[0].URL)
	}
	if len(body.Errors) != 0 {
		t.Errorf("errors = %+v, want none", body.Errors)
	}
}

// The floor the browser debounces to, enforced server-side so a hand-made
// request cannot fan a one-character query across every site.
func TestSearchUnderTwoCharactersReachesNoInstance(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	jiraSrv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		t.Errorf("a one-character query reached Jira at %s", r.URL.Path)
	}))
	t.Cleanup(jiraSrv.Close)
	seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", jiraSrv.URL)

	rec, body := searchIssues(t, srv, "s")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if len(body.Results) != 0 || len(body.Errors) != 0 {
		t.Errorf("body = %+v, want both arrays empty", body)
	}
	// The view iterates both without a null check.
	if !strings.Contains(rec.Body.String(), `"results":[]`) ||
		!strings.Contains(rec.Body.String(), `"errors":[]`) {
		t.Errorf("body = %s, want empty arrays rather than null", rec.Body.String())
	}
}

// A single CJK glyph is one rune but three UTF-8 bytes; counting bytes would
// clear the floor and fan this out to every instance, precisely what the floor
// exists to stop.
func TestSearchUnderTwoCharactersCountsRunesNotBytes(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	jiraSrv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		t.Errorf("a one-rune query reached Jira at %s", r.URL.Path)
	}))
	t.Cleanup(jiraSrv.Close)
	seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", jiraSrv.URL)

	rec, body := searchIssues(t, srv, "情")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if len(body.Results) != 0 || len(body.Errors) != 0 {
		t.Errorf("body = %+v, want both arrays empty", body)
	}
}

func TestSearchReportsAFailingInstanceBesideTheOthersResults(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	// Delayed on purpose: with both at zero the failing goroutine cancels its
	// sibling only after that sibling has stored its result, and this test would
	// pass while the property it names is broken.
	good := jiraSearchServer(t, "WORK", http.StatusOK, 150*time.Millisecond)
	bad := jiraSearchServer(t, "PERS", http.StatusUnauthorized, 0)
	seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", good.URL)
	seedInstance(t, db, sealer, "Personal", "https://personal.atlassian.net", bad.URL)

	rec, body := searchIssues(t, srv, "security")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if len(body.Results) != 1 {
		t.Errorf("got %d results, want 1; a sibling's failure blanked it", len(body.Results))
	}
	if len(body.Errors) != 1 || body.Errors[0].InstanceName != "Personal" {
		t.Fatalf("errors = %+v, want Personal named", body.Errors)
	}
	if body.Errors[0].Error.Code != "credentials_rejected" {
		t.Errorf("code = %q, want credentials_rejected", body.Errors[0].Error.Code)
	}
}

func jiraSearchAndIssueServer(t *testing.T, issueStatus int) *httptest.Server {
	t.Helper()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, "/rest/api/3/issue/"):
			if issueStatus != http.StatusOK {
				w.WriteHeader(issueStatus)
				return
			}
			_, _ = w.Write([]byte(`{"key":"WORK-1","fields":{"summary":"Exact hit",` +
				`"status":{"name":"To Do"}}}`))
		case r.URL.Path == "/rest/api/3/search/jql":
			_, _ = w.Write([]byte(`{"issues":[{"key":"WORK-1","fields":{` +
				`"summary":"Text hit","status":{"name":"To Do"}}}]}`))
		default:
			t.Errorf("unexpected path %q", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)

	return srv
}

// key = "..." is a JQL error when the project does not exist, so a key-shaped
// query goes through the single-issue lookup instead, where a miss costs
// nothing.
//
// The stub's issue and search endpoints return the same key with different
// summaries ("Exact hit" vs "Text hit"), so this proves three things at once:
// the key lookup actually ran (nothing else could produce "Exact hit"), it
// leads its instance's results, and the dedupe kept that copy rather than the
// text search's.
func TestSearchListsAnExactKeyHitOnce(t *testing.T) {
	for _, query := range []string{"WORK-1", "work-1"} {
		t.Run(query, func(t *testing.T) {
			srv, db, sealer := newServerWithStore(t)
			jiraSrv := jiraSearchAndIssueServer(t, http.StatusOK)
			seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", jiraSrv.URL)

			_, body := searchIssues(t, srv, query)

			if len(body.Results) != 1 {
				t.Fatalf("got %d results, want the exact hit listed once", len(body.Results))
			}
			if body.Results[0].Key != "WORK-1" {
				t.Errorf("key = %q, want WORK-1", body.Results[0].Key)
			}
			if body.Results[0].Summary != "Exact hit" {
				t.Errorf("summary = %q, want the issue lookup's copy to lead and survive dedupe",
					body.Results[0].Summary)
			}
		})
	}
}

func TestSearchIgnoresAKeyLookupThatMisses(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	jiraSrv := jiraSearchAndIssueServer(t, http.StatusNotFound)
	seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", jiraSrv.URL)

	_, body := searchIssues(t, srv, "WORK-1")

	if len(body.Errors) != 0 {
		t.Errorf("errors = %+v; a key that is not here is an ordinary answer", body.Errors)
	}
	if len(body.Results) != 1 {
		t.Errorf("got %d results, want the summary match still returned", len(body.Results))
	}
}
