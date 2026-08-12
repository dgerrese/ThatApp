package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

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
