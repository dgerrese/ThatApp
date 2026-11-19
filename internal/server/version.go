package server

import (
	"net/http"

	"github.com/dgerrese/ThatApp/internal/update"
)

type versionBody struct {
	Version string          `json:"version"`
	Latest  *update.Release `json:"latest"`
	Error   string          `json:"error"`
}

func (s *Server) handleVersion(w http.ResponseWriter, _ *http.Request) {
	body := versionBody{Version: s.cfg.Version}
	if s.Updates != nil {
		st := s.Updates.Status()
		body.Latest, body.Error = st.Latest, st.Err
	}

	writeJSON(w, http.StatusOK, body)
}
