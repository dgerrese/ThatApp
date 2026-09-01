// Package server wires the HTTP routes for the dashboard.
package server

import (
	"errors"
	"io/fs"
	"net/http"
	"path"
	"strings"
	"sync"
	"time"

	"codeberg.org/DionGerrese/ThatApp/internal/config"
	"codeberg.org/DionGerrese/ThatApp/internal/crypto"
	"codeberg.org/DionGerrese/ThatApp/internal/store"
)

// Server routes API requests and serves the PWA's static assets.
type Server struct {
	cfg     *config.Config
	assets  fs.FS
	db      *store.Store
	sealer  *crypto.Sealer
	clients *instanceClients
	mux     *http.ServeMux
	// now reads the wall clock. Tests replace it to place a request at a
	// chosen instant, which is the only way to prove which local day an entry
	// lands on when cfg.Location is hours away from the machine's clock.
	now func() time.Time
	// pushMu serialises handlePushDay: without it, two concurrent pushes can
	// both read the same entry as unpushed before either writes worklog_id,
	// creating a duplicate worklog in real Jira. A push is a once-a-day
	// operation, so serialising it costs nothing — the alternative is a
	// duplicate a user can only undo by hand in Jira's own UI.
	pushMu sync.Mutex
}

// New builds a Server that serves its static files from assets. Production
// passes an embedded filesystem; development passes one backed by web/dist.
func New(cfg *config.Config, assets fs.FS, db *store.Store, sealer *crypto.Sealer) *Server {
	s := &Server{
		cfg:    cfg,
		assets: assets,
		db:     db,
		sealer: sealer,
		mux:    http.NewServeMux(),
		now:    time.Now,
	}
	s.clients = newInstanceClients(db, sealer)

	s.mux.HandleFunc("GET /api/health", s.handleHealth)
	s.mux.HandleFunc("GET /api/instances", s.handleListInstances)
	s.mux.HandleFunc("POST /api/instances", s.handleCreateInstance)
	s.mux.HandleFunc("PATCH /api/instances/{id}", s.handleUpdateInstance)
	s.mux.HandleFunc("DELETE /api/instances/{id}", s.handleDeleteInstance)
	s.mux.HandleFunc("POST /api/instances/{id}/test", s.handleTestInstance)
	s.mux.HandleFunc("GET /api/issues", s.handleListIssues)
	s.mux.HandleFunc("GET /api/issues/search", s.handleSearchIssues)
	s.mux.HandleFunc("GET /api/pins", s.handleListPins)
	s.mux.HandleFunc("POST /api/pins", s.handleCreatePin)
	s.mux.HandleFunc("DELETE /api/pins/{id}", s.handleDeletePin)
	s.mux.HandleFunc("GET /api/entries", s.handleListEntries)
	s.mux.HandleFunc("POST /api/entries", s.handleCreateEntry)
	s.mux.HandleFunc("PATCH /api/entries/{id}", s.handleUpdateEntry)
	s.mux.HandleFunc("DELETE /api/entries/{id}", s.handleDeleteEntry)
	s.mux.HandleFunc("POST /api/push", s.handlePushDay)
	s.mux.HandleFunc("/api/", handleAPINotFound)
	s.mux.HandleFunc("/", s.handleAsset)

	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func handleAPINotFound(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotFound, "not_found", "no such endpoint")
}

// handleAsset serves a file from the asset filesystem, falling back to the app
// shell so that client-side routes such as /week survive a page refresh.
func (s *Server) handleAsset(w http.ResponseWriter, r *http.Request) {
	name := path.Clean(strings.TrimPrefix(r.URL.Path, "/"))
	if name == "" || name == "." {
		name = "index.html"
	}

	if _, err := fs.Stat(s.assets, name); err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			http.Error(w, "asset lookup failed", http.StatusInternalServerError)
			return
		}
		name = "index.html"
	}

	// ServeFileFS types manifest.json as application/json from its extension;
	// it is a web app manifest, and browsers key on the more specific type.
	if name == "manifest.json" {
		w.Header().Set("Content-Type", "application/manifest+json")
	}
	http.ServeFileFS(w, r, s.assets, name)
}
