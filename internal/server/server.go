// Package server wires the HTTP routes for the dashboard.
package server

import (
	"errors"
	"io/fs"
	"net/http"
	"path"
	"strings"

	"github.com/dgerrese/work-dashboard/internal/config"
	"github.com/dgerrese/work-dashboard/internal/crypto"
	"github.com/dgerrese/work-dashboard/internal/store"
)

// Server routes API requests and serves the PWA's static assets.
type Server struct {
	cfg     *config.Config
	assets  fs.FS
	db      *store.Store
	sealer  *crypto.Sealer
	clients *instanceClients
	mux     *http.ServeMux
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
	}
	s.clients = newInstanceClients(db, sealer)

	s.mux.HandleFunc("GET /api/health", s.handleHealth)
	s.mux.HandleFunc("GET /api/instances", s.handleListInstances)
	s.mux.HandleFunc("POST /api/instances", s.handleCreateInstance)
	s.mux.HandleFunc("PATCH /api/instances/{id}", s.handleUpdateInstance)
	s.mux.HandleFunc("DELETE /api/instances/{id}", s.handleDeleteInstance)
	s.mux.HandleFunc("POST /api/instances/{id}/test", s.handleTestInstance)
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

	http.ServeFileFS(w, r, s.assets, name)
}
