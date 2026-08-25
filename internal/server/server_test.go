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
		"app.css":       {Data: []byte(":root{color:red}")},
		"sw.js":         {Data: []byte("self.addEventListener('install', () => {});")},
		"manifest.json": {Data: []byte(`{"name":"Work Dashboard"}`)},
		"icon.svg":      {Data: []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`)},
		"icon-192.png":  {Data: []byte("\x89PNG\r\n\x1a\n")},
		// "wOF2" is the woff2 signature, and it has to be real bytes: the
		// extension is not in Go's builtin mime table, so the type this file
		// answers with comes from http.DetectContentType sniffing it.
		"inter.woff2": {Data: []byte("wOF2\x00\x01\x00\x00")},
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

// TestAssetContentTypes covers one path per extension in the service worker's
// EXTENSION_CONTENT_TYPES (web/src/sw.ts). That table is the worker's and these
// types are the server's, and precacheShell throws — killing the whole install,
// leaving a fresh profile with no worker at all — the moment one of them
// answers with something the other does not expect. Nothing else fails them
// together: the e2e workflow's paths: list does not name internal/.
//
// ".woff2" is the one that cannot be read off Go's builtin mime table, because
// it is not in it. http.DetectContentType sniffs the "wOF2" signature to
// font/woff2 instead, which is what keeps the prod target's FROM scratch image
// — no /etc/mime.types to fall back on — serving fonts the worker accepts.
func TestAssetContentTypes(t *testing.T) {
	tests := []struct {
		path            string
		wantContentType string
	}{
		// "/" rather than "/index.html": ServeFileFS redirects any path ending
		// in /index.html to "./", so "/" is the request that actually types the
		// shell — and the one the worker's precache fetch lands on.
		{"/", "text/html; charset=utf-8"},
		{"/app.js", "text/javascript; charset=utf-8"},
		{"/app.css", "text/css; charset=utf-8"},
		{"/manifest.json", "application/manifest+json"},
		{"/icon.svg", "image/svg+xml"},
		{"/icon-192.png", "image/png"},
		{"/inter.woff2", "font/woff2"},
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
