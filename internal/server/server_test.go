package server_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/dgerrese/work-dashboard/internal/config"
	"github.com/dgerrese/work-dashboard/internal/server"
)

// maxIndexHTMLBytes is the TCP initial congestion window: a first response
// under it needs no second round trip. See CLAUDE.md.
const maxIndexHTMLBytes = 14336

func newTestServer() *server.Server {
	cfg := &config.Config{
		Addr:     ":8080",
		DBPath:   ":memory:",
		Secret:   make([]byte, 32),
		Location: time.UTC,
	}
	assets := fstest.MapFS{
		"index.html":    {Data: []byte("<!doctype html><title>shell</title>")},
		"app.js":        {Data: []byte("console.log('app')")},
		"sw.js":         {Data: []byte("self.addEventListener('install', () => {});")},
		"manifest.json": {Data: []byte(`{"name":"Work Dashboard"}`)},
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

func TestAssetContentTypes(t *testing.T) {
	tests := []struct {
		path            string
		wantContentType string
	}{
		{"/manifest.json", "application/manifest+json"},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			res := get(t, tt.path)
			defer res.Body.Close()

			if ct := res.Header.Get("Content-Type"); ct != tt.wantContentType {
				t.Errorf("Content-Type = %q, want %q", ct, tt.wantContentType)
			}
		})
	}
}

func TestServiceWorkerIsServedAsJavaScript(t *testing.T) {
	// handleAsset falls back to index.html for anything it cannot find, so this
	// guards against /sw.js silently serving HTML under a .js name.
	res := get(t, "/sw.js")
	defer res.Body.Close()

	if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/javascript") {
		t.Errorf("Content-Type = %q, want a JavaScript type", ct)
	}
}

func TestServedIndexHTMLStaysUnderByteBudget(t *testing.T) {
	// Reads the real shipped file rather than a fixture: a fixture would keep
	// passing however large index.html actually grew. Served through the real
	// handler too, so a future transform of the body would still be measured.
	shipped, err := os.ReadFile("../../web/index.html")
	if err != nil {
		t.Fatalf("reading web/index.html: %v", err)
	}

	cfg := &config.Config{
		Addr:     ":8080",
		DBPath:   ":memory:",
		Secret:   make([]byte, 32),
		Location: time.UTC,
	}
	srv := server.New(cfg, fstest.MapFS{"index.html": {Data: shipped}}, nil, nil)

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	res := rec.Result()
	defer res.Body.Close()

	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("reading response body: %v", err)
	}
	if len(body) >= maxIndexHTMLBytes {
		t.Errorf("served index.html is %d bytes, want fewer than %d", len(body), maxIndexHTMLBytes)
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
