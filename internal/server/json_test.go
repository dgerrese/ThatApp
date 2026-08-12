package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"testing/fstest"
	"time"

	"github.com/dgerrese/work-dashboard/internal/config"
	"github.com/dgerrese/work-dashboard/internal/crypto"
	"github.com/dgerrese/work-dashboard/internal/store"
)

// newTestServer builds a Server over a real store in a temp directory and a
// sealer with a throwaway key.
func newTestServer(t *testing.T) (*Server, *store.Store, *crypto.Sealer) {
	t.Helper()

	db, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("opening store: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	sealer, err := crypto.NewSealer(make([]byte, crypto.KeySize))
	if err != nil {
		t.Fatalf("building sealer: %v", err)
	}

	cfg := &config.Config{Addr: ":8080", Location: time.UTC}

	return New(cfg, fstest.MapFS{}, db, sealer), db, sealer
}

func TestNewWiresTheStoreAndSealerItWasGiven(t *testing.T) {
	s, db, sealer := newTestServer(t)

	if s.db != db {
		t.Error("s.db is not the store passed to New")
	}
	if s.sealer != sealer {
		t.Error("s.sealer is not the sealer passed to New")
	}
}

func TestWriteJSONSetsStatusAndContentType(t *testing.T) {
	rec := httptest.NewRecorder()

	writeJSON(rec, http.StatusCreated, map[string]string{"name": "Work"})

	if rec.Code != http.StatusCreated {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusCreated)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", got)
	}

	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decoding body: %v", err)
	}
	if body["name"] != "Work" {
		t.Errorf("body[name] = %q, want %q", body["name"], "Work")
	}
}

func TestWriteErrorCarriesCodeAndMessage(t *testing.T) {
	rec := httptest.NewRecorder()

	writeError(rec, http.StatusBadRequest, "invalid_site_url", "site URL is required")

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}

	var body errorBody
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decoding body: %v", err)
	}
	if body.Code != "invalid_site_url" {
		t.Errorf("code = %q, want invalid_site_url", body.Code)
	}
	if body.Message != "site URL is required" {
		t.Errorf("message = %q, want the supplied message", body.Message)
	}
}
