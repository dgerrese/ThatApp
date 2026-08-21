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
