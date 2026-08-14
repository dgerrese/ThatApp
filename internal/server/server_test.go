package server_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
	"time"

	"github.com/dgerrese/work-dashboard/internal/config"
	"github.com/dgerrese/work-dashboard/internal/server"
)

func newTestServer() *server.Server {
	cfg := &config.Config{
		Addr:     ":8080",
		DBPath:   ":memory:",
		Secret:   make([]byte, 32),
		Location: time.UTC,
	}
	assets := fstest.MapFS{
		"index.html": {Data: []byte("<!doctype html><title>shell</title>")},
		"app.js":     {Data: []byte("console.log('app')")},
	}
	return server.New(cfg, assets, nil, nil)
}

func get(t *testing.T, path string) *http.Response {
	t.Helper()
	rec := httptest.NewRecorder()
	newTestServer().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec.Result()
}

func TestHealthReportsOK(t *testing.T) {
	res := get(t, "/api/health")
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want %d", res.StatusCode, http.StatusOK)
	}
	if ct := res.Header.Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want %q", ct, "application/json")
	}
	body, _ := io.ReadAll(res.Body)
	if got, want := string(body), "{\"status\":\"ok\"}\n"; got != want {
		t.Errorf("body = %q, want %q", got, want)
	}
}

func TestUnknownAPIPathReturnsJSON404(t *testing.T) {
	res := get(t, "/api/nope")
	defer res.Body.Close()

	if res.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want %d", res.StatusCode, http.StatusNotFound)
	}
	if ct := res.Header.Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want %q", ct, "application/json")
	}
}

func TestRootServesAppShell(t *testing.T) {
	res := get(t, "/")
	defer res.Body.Close()

	body, _ := io.ReadAll(res.Body)
	if got := string(body); got != "<!doctype html><title>shell</title>" {
		t.Errorf("body = %q, want the app shell", got)
	}
}

func TestAssetIsServedFromFS(t *testing.T) {
	res := get(t, "/app.js")
	defer res.Body.Close()

	body, _ := io.ReadAll(res.Body)
	if got := string(body); got != "console.log('app')" {
		t.Errorf("body = %q, want the app.js contents", got)
	}
}

func TestUnknownPageFallsBackToAppShell(t *testing.T) {
	// Client-side routing: /week is a view, not a file. It must still boot the shell.
	res := get(t, "/week")
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want %d", res.StatusCode, http.StatusOK)
	}
	body, _ := io.ReadAll(res.Body)
	if got := string(body); got != "<!doctype html><title>shell</title>" {
		t.Errorf("body = %q, want the app shell", got)
	}
}
