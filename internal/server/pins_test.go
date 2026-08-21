package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

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

func jiraIssueServerWithDelay(
	t *testing.T, summary, status string, code int, delay time.Duration,
) *httptest.Server {
	t.Helper()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(delay)
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

func TestRefreshRewritesTheCaches(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	jiraSrv := jiraIssueServer(t, "Renamed standup", "Done", http.StatusOK)
	inst := seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", jiraSrv.URL)
	if _, err := db.CreatePin(context.Background(), store.PinInput{
		InstanceID: inst.ID, IssueKey: "SHARED-12",
		SummaryCache: "Weekly standup", StatusCache: "In Progress",
	}); err != nil {
		t.Fatalf("creating the pin: %v", err)
	}

	rec, body := getPins(t, srv, "?refresh=1")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if body[0].Summary != "Renamed standup" || body[0].Status != "Done" {
		t.Errorf("summary/status = %q/%q, want the refreshed values",
			body[0].Summary, body[0].Status)
	}

	stored, err := db.Pins(context.Background())
	if err != nil {
		t.Fatalf("reading pins: %v", err)
	}
	if stored[0].SummaryCache != "Renamed standup" || stored[0].StatusCache != "Done" {
		t.Errorf("stored caches = %q/%q; a refresh must persist, not just render",
			stored[0].SummaryCache, stored[0].StatusCache)
	}
}

// The property this endpoint shares with the assigned fan-out. The healthy
// instance is DELAYED on purpose: with both at zero the failing goroutine
// cancels its sibling only after that sibling has already stored its result,
// and the test passes while the property is broken.
func TestRefreshKeepsWorkingPinsWhenOneInstanceFails(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	slow := jiraIssueServerWithDelay(t, "Refreshed", "Done", http.StatusOK, 150*time.Millisecond)
	broken := jiraIssueServer(t, "", "", http.StatusUnauthorized)
	good := seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", slow.URL)
	bad := seedInstance(t, db, sealer, "Personal", "https://personal.atlassian.net", broken.URL)
	for _, seed := range []struct {
		id  int64
		key string
	}{{good.ID, "SHARED-12"}, {bad.ID, "MISC-3"}} {
		if _, err := db.CreatePin(context.Background(), store.PinInput{
			InstanceID: seed.id, IssueKey: seed.key,
			SummaryCache: "cached", StatusCache: "cached",
		}); err != nil {
			t.Fatalf("creating the pin %q: %v", seed.key, err)
		}
	}

	rec, body := getPins(t, srv, "?refresh=1")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; one bad instance is data, not a failed request",
			rec.Code, http.StatusOK)
	}
	if body[0].Summary != "Refreshed" {
		t.Errorf("summary = %q, want Refreshed; a sibling's failure blanked it", body[0].Summary)
	}
	if body[1].Error == nil {
		t.Fatal("the failed pin carries no error")
	}
	if body[1].Error.Code != "credentials_rejected" {
		t.Errorf("code = %q, want credentials_rejected", body[1].Error.Code)
	}
	// A failed refresh must never destroy what was already known.
	if body[1].Summary != "cached" {
		t.Errorf("summary = %q, want the cached value kept", body[1].Summary)
	}

	// The DTO alone cannot tell "left untouched" from "read before the refresh
	// ran and never written back" — only the store proves the cache survived.
	stored, err := db.Pins(context.Background())
	if err != nil {
		t.Fatalf("reading pins: %v", err)
	}
	if len(stored) != 2 {
		t.Fatalf("stored pins = %d, want both kept", len(stored))
	}
	if stored[1].SummaryCache != "cached" || stored[1].StatusCache != "cached" {
		t.Errorf("stored cache = %q/%q, want it untouched by a failed refresh",
			stored[1].SummaryCache, stored[1].StatusCache)
	}
}

// A pin whose issue was deleted in Jira stays pinned. Removing a user's pin
// because a call said 404 is not this endpoint's decision to make.
func TestRefreshDoesNotUnpinAMissingIssue(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	jiraSrv := jiraIssueServer(t, "", "", http.StatusNotFound)
	inst := seedInstance(t, db, sealer, "Work", "https://work.atlassian.net", jiraSrv.URL)
	if _, err := db.CreatePin(context.Background(), store.PinInput{
		InstanceID: inst.ID, IssueKey: "GONE-1", SummaryCache: "Was here", StatusCache: "Open",
	}); err != nil {
		t.Fatalf("creating the pin: %v", err)
	}

	_, body := getPins(t, srv, "?refresh=1")

	if len(body) != 1 {
		t.Fatalf("got %d pins, want the pin kept", len(body))
	}
	if body[0].Error == nil {
		t.Fatal("the pin carries no error after a failed refresh")
	}
	// A deleted or moved issue is a 404 from Jira, which the shared instance-error
	// mapping reads as "no access to this account" — wrong to the point of
	// misleading. This must agree with the POST /api/pins path, which already
	// special-cases it.
	if body[0].Error.Code != "issue_not_found" {
		t.Errorf("error code = %q, want %q (not %q)",
			body[0].Error.Code, "issue_not_found", "account_not_found")
	}
	if body[0].Summary != "Was here" {
		t.Errorf("summary = %q, want the cached value kept", body[0].Summary)
	}

	// The response body is built from the pre-refresh store snapshot, so it
	// cannot by itself prove nothing was unpinned — only reading the store
	// back after the request can.
	stored, err := db.Pins(context.Background())
	if err != nil {
		t.Fatalf("reading pins: %v", err)
	}
	if len(stored) != 1 {
		t.Fatalf("stored pins = %d, want the pin kept", len(stored))
	}
	if stored[0].SummaryCache != "Was here" {
		t.Errorf("stored cache = %q, want it untouched by a failed refresh", stored[0].SummaryCache)
	}
}

// Two pins on one instance must resolve one client between them, not one each:
// a second concurrent forInstance call on the same row races the first-use
// api_base_url repair. A row with no api_base_url forces that repair to run,
// so the tenant-info endpoint's hit count is the property's only witness — the
// issue responses themselves would look identical either way.
func TestRefreshSharesOneClientPerInstance(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	var tenantInfoHits int32
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/_edge/tenant_info":
			atomic.AddInt32(&tenantInfoHits, 1)
			_, _ = w.Write([]byte(`{"cloudId":"7c41e2b6"}`))
		case strings.HasPrefix(r.URL.Path, "/rest/api/3/issue/"):
			_, _ = w.Write([]byte(`{"key":"SHARED-1","fields":{"summary":"Refreshed","status":{"name":"Done"}}}`))
		default:
			t.Errorf("unexpected path %q", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(site.Close)
	pointAtSite(srv, site)

	// apiBase left blank: forInstance must resolve it, which is what makes the
	// hit count meaningful. seedInstance's own fake-Jira-URL pattern bypasses
	// resolution entirely and would not exercise this path.
	inst := seedInstance(t, db, sealer, "Work", site.URL, "")
	for _, key := range []string{"SHARED-1", "SHARED-2"} {
		if _, err := db.CreatePin(context.Background(), store.PinInput{
			InstanceID: inst.ID, IssueKey: key, SummaryCache: "cached", StatusCache: "cached",
		}); err != nil {
			t.Fatalf("creating the pin %q: %v", key, err)
		}
	}

	rec, _ := getPins(t, srv, "?refresh=1")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if got := atomic.LoadInt32(&tenantInfoHits); got != 1 {
		t.Errorf("tenant_info hits = %d, want 1; two pins on one instance resolved it separately", got)
	}
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
