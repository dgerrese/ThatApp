package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/dgerrese/work-dashboard/internal/store"
)

func getPins(t *testing.T, srv *Server, query string) (*httptest.ResponseRecorder, []pinDTO) {
	t.Helper()

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/pins"+query, nil))

	var body []pinDTO
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decoding the response %s: %v", rec.Body.String(), err)
		}
	}

	return rec, body
}

func TestGetPinsReadsTheStoreAndNamesTheInstance(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	inst := seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", "https://api.example")
	if _, err := db.CreatePin(context.Background(), store.PinInput{
		InstanceID: inst.ID, IssueKey: "SHARED-12",
		SummaryCache: "Weekly standup", StatusCache: "In Progress",
	}); err != nil {
		t.Fatalf("creating the pin: %v", err)
	}

	rec, body := getPins(t, srv, "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if len(body) != 1 {
		t.Fatalf("got %d pins, want 1", len(body))
	}
	pin := body[0]
	if pin.InstanceName != "Work" {
		t.Errorf("instanceName = %q, want Work; the browser must not have to resolve the id",
			pin.InstanceName)
	}
	if pin.Summary != "Weekly standup" || pin.Status != "In Progress" {
		t.Errorf("summary/status = %q/%q, want the cached values", pin.Summary, pin.Status)
	}
	if pin.URL != "https://work.atlassian.net/browse/SHARED-12" {
		t.Errorf("url = %q, want the browse URL", pin.URL)
	}
	if pin.Error != nil {
		t.Errorf("error = %v on a plain GET, want nil", pin.Error)
	}
}

// The whole point of the cache columns: no Jira call on load. The seeded
// instance points at a server that fails the test if it is ever reached.
func TestGetPinsMakesNoJiraRequest(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	jiraSrv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		t.Errorf("a plain GET /api/pins reached Jira at %s", r.URL.Path)
	}))
	t.Cleanup(jiraSrv.Close)
	inst := seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", jiraSrv.URL)
	if _, err := db.CreatePin(context.Background(), store.PinInput{
		InstanceID: inst.ID, IssueKey: "SHARED-12", SummaryCache: "Standup", StatusCache: "Open",
	}); err != nil {
		t.Fatalf("creating the pin: %v", err)
	}

	rec, _ := getPins(t, srv, "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestGetPinsWithNoneStoredIsAnEmptyArray(t *testing.T) {
	srv, _, _ := newServerWithStore(t)

	rec, _ := getPins(t, srv, "")

	// Asserted on the raw body: decoding cannot tell [] from null, and the view
	// iterates the array.
	if strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Errorf("body = %s, want []", rec.Body.String())
	}
}

func TestDeletePinRemovesIt(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	inst := seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", "https://api.example")
	pin, err := db.CreatePin(context.Background(), store.PinInput{
		InstanceID: inst.ID, IssueKey: "SHARED-12", SummaryCache: "Standup", StatusCache: "Open",
	})
	if err != nil {
		t.Fatalf("creating the pin: %v", err)
	}

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete,
		"/api/pins/"+strconv.FormatInt(pin.ID, 10), nil))

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNoContent)
	}
	_, body := getPins(t, srv, "")
	if len(body) != 0 {
		t.Errorf("got %d pins after the delete, want 0", len(body))
	}
}

func TestDeleteMissingPinIsNotFound(t *testing.T) {
	srv, _, _ := newServerWithStore(t)

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/api/pins/404", nil))

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
	if !strings.Contains(rec.Body.String(), "pin_not_found") {
		t.Errorf("body = %s, want the pin_not_found code", rec.Body.String())
	}
}

func TestDeletePinRejectsANonNumericID(t *testing.T) {
	srv, _, _ := newServerWithStore(t)

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/api/pins/abc", nil))

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

// jiraIssueServer stands in for one site's single-issue endpoint. status other
// than 200 makes the lookup fail.
func jiraIssueServer(t *testing.T, summary, status string, code int) *httptest.Server {
	t.Helper()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
	}))
	t.Cleanup(srv.Close)

	return srv
}

func postPin(t *testing.T, srv *Server, body string) *httptest.ResponseRecorder {
	t.Helper()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/pins", strings.NewReader(body))
	srv.ServeHTTP(rec, req)

	return rec
}

// The summary and status that get cached come from the server's own lookup,
// never from the browser: the client sends an id and a key and nothing else.
func TestPostPinCachesWhatTheLookupReturned(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	jiraSrv := jiraIssueServer(t, "Weekly standup", "In Progress", http.StatusOK)
	inst := seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", jiraSrv.URL)

	rec := postPin(t, srv, `{"instanceId":`+strconv.FormatInt(inst.ID, 10)+`,"issueKey":"SHARED-12"}`)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	var created pinDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("decoding %s: %v", rec.Body.String(), err)
	}
	if created.Summary != "Weekly standup" || created.Status != "In Progress" {
		t.Errorf("summary/status = %q/%q, want the looked-up values",
			created.Summary, created.Status)
	}

	pins, err := db.Pins(context.Background())
	if err != nil {
		t.Fatalf("reading pins: %v", err)
	}
	if len(pins) != 1 || pins[0].StatusCache != "In Progress" {
		t.Errorf("stored pins = %+v, want one carrying the status", pins)
	}
}

// A 404 from Jira means the key does not exist here. instanceErrorFor maps that
// to account_not_found with a 502, which is right for a /myself probe and badly
// wrong for this, so the branch has to come first.
func TestPostPinRejectsAKeyThatDoesNotExist(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	jiraSrv := jiraIssueServer(t, "", "", http.StatusNotFound)
	inst := seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", jiraSrv.URL)

	rec := postPin(t, srv, `{"instanceId":`+strconv.FormatInt(inst.ID, 10)+`,"issueKey":"NOPE-1"}`)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
	var body errorBody
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decoding %s: %v", rec.Body.String(), err)
	}
	if body.Code != "issue_not_found" {
		t.Errorf("code = %q, want issue_not_found", body.Code)
	}
	if body.Code == "account_not_found" {
		t.Error("a missing issue was reported as a missing account")
	}
}

func TestPostPinRejectsADuplicate(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	jiraSrv := jiraIssueServer(t, "Weekly standup", "In Progress", http.StatusOK)
	inst := seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", jiraSrv.URL)
	body := `{"instanceId":` + strconv.FormatInt(inst.ID, 10) + `,"issueKey":"SHARED-12"}`
	postPin(t, srv, body)

	rec := postPin(t, srv, body)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusConflict)
	}
	if !strings.Contains(rec.Body.String(), "pin_exists") {
		t.Errorf("body = %s, want pin_exists", rec.Body.String())
	}
}

func TestPostPinRejectsAnUnknownInstance(t *testing.T) {
	srv, _, _ := newServerWithStore(t)

	rec := postPin(t, srv, `{"instanceId":404,"issueKey":"SHARED-12"}`)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
	if !strings.Contains(rec.Body.String(), "instance_not_found") {
		t.Errorf("body = %s, want instance_not_found", rec.Body.String())
	}
}

func TestPostPinRejectsABlankKey(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	inst := seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", "https://api.example")

	rec := postPin(t, srv, `{"instanceId":`+strconv.FormatInt(inst.ID, 10)+`,"issueKey":"  "}`)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestPostPinRejectsAMalformedBody(t *testing.T) {
	srv, _, _ := newServerWithStore(t)

	rec := postPin(t, srv, `{`)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}
