package server_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"codeberg.org/DionGerrese/ThatApp/internal/config"
	"codeberg.org/DionGerrese/ThatApp/internal/server"
	"codeberg.org/DionGerrese/ThatApp/internal/update"
)

type fakeUpdates update.Status

func (f fakeUpdates) Status() update.Status { return update.Status(f) }

func TestVersionEndpoint(t *testing.T) {
	tests := []struct {
		name    string
		version string
		updates *fakeUpdates
		want    string
	}{
		{"no checker", "dev", nil, `{"version":"dev","latest":null,"error":""}`},
		{"newer release", "2026.47.1", &fakeUpdates{Latest: &update.Release{Version: "2026.49.1", URL: "https://x.test/r"}}, `{"version":"2026.47.1","latest":{"version":"2026.49.1","url":"https://x.test/r"},"error":""}`},
		{"check failed", "2026.47.1", &fakeUpdates{Err: "boom"}, `{"version":"2026.47.1","latest":null,"error":"boom"}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := server.New(&config.Config{Version: tt.version}, fstest.MapFS{}, nil, nil)
			if tt.updates != nil {
				srv.Updates = *tt.updates
			}

			rec := httptest.NewRecorder()
			srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/version", nil))

			if got := rec.Body.String(); got != tt.want+"\n" {
				t.Errorf("body = %q, want %q", got, tt.want)
			}
		})
	}
}
