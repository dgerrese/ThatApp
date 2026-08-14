package server

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/dgerrese/work-dashboard/internal/atlassian"
	"github.com/dgerrese/work-dashboard/internal/jira"
	"github.com/dgerrese/work-dashboard/internal/store"
)

// instanceDTO is the response shape. It is written out rather than reusing
// store.Instance so that adding a field to the store struct cannot leak a token
// into a response.
type instanceDTO struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	SiteURL    string `json:"siteUrl"`
	APIBaseURL string `json:"apiBaseUrl"`
	Email      string `json:"email"`
	CreatedAt  string `json:"createdAt"`
}

func dtoFromInstance(inst store.Instance) instanceDTO {
	return instanceDTO{
		ID:         inst.ID,
		Name:       inst.Name,
		SiteURL:    inst.SiteURL,
		APIBaseURL: inst.APIBaseURL,
		Email:      inst.Email,
		CreatedAt:  inst.CreatedAt.Format(time.RFC3339),
	}
}

// instanceRequest is the body POST and PATCH accept. An empty Token on PATCH
// means "keep the stored one".
type instanceRequest struct {
	Name    string `json:"name"`
	SiteURL string `json:"siteUrl"`
	Email   string `json:"email"`
	Token   string `json:"token"`
}

func (s *Server) handleListInstances(w http.ResponseWriter, r *http.Request) {
	instances, err := s.db.Instances(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not read the stored instances")
		return
	}

	dtos := make([]instanceDTO, 0, len(instances))
	for _, inst := range instances {
		dtos = append(dtos, dtoFromInstance(inst))
	}

	writeJSON(w, http.StatusOK, dtos)
}

func (s *Server) handleCreateInstance(w http.ResponseWriter, r *http.Request) {
	var req instanceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "the request body is not valid JSON")
		return
	}

	name := strings.TrimSpace(req.Name)
	email := strings.TrimSpace(req.Email)
	if name == "" {
		writeError(w, http.StatusBadRequest, "invalid_name", "a name is required")
		return
	}
	if email == "" {
		writeError(w, http.StatusBadRequest, "invalid_email", "an account email is required")
		return
	}
	if req.Token == "" {
		writeError(w, http.StatusBadRequest, "missing_token", "an API token is required")
		return
	}
	siteURL, err := atlassian.NormalizeSiteURL(req.SiteURL)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_site_url", err.Error())
		return
	}

	apiBase, err := s.clients.apiBaseForSite(r.Context(), siteURL)
	if err != nil {
		writeInstanceError(w, err)
		return
	}

	// Verify before storing: an instance must not be storable in a state that
	// silently returns nothing.
	client, err := jira.New(apiBase, email, req.Token)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_site_url", err.Error())
		return
	}
	if _, err := client.Myself(r.Context()); err != nil {
		writeInstanceError(w, err)
		return
	}

	sealed, err := s.sealer.Seal(req.Token)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "seal_failed", "could not encrypt the API token")
		return
	}

	inst, err := s.db.CreateInstance(r.Context(), store.InstanceInput{
		Name: name, SiteURL: siteURL, APIBaseURL: apiBase, Email: email, TokenEnc: sealed,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not store the instance")
		return
	}

	writeJSON(w, http.StatusCreated, dtoFromInstance(*inst))
}

// instanceIDFromPath reads the {id} wildcard. A non-numeric id is a 404 rather
// than a 400: the path simply does not name an instance.
func instanceIDFromPath(r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}

	return id, true
}

func (s *Server) handleUpdateInstance(w http.ResponseWriter, r *http.Request) {
	id, ok := instanceIDFromPath(r)
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "no such instance")
		return
	}

	existing, err := s.db.Instance(r.Context(), id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "not_found", "no such instance")
			return
		}
		writeError(w, http.StatusInternalServerError, "store_failed", "could not read the instance")
		return
	}

	var req instanceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "the request body is not valid JSON")
		return
	}

	name := strings.TrimSpace(req.Name)
	email := strings.TrimSpace(req.Email)
	if name == "" {
		writeError(w, http.StatusBadRequest, "invalid_name", "a name is required")
		return
	}
	if email == "" {
		writeError(w, http.StatusBadRequest, "invalid_email", "an account email is required")
		return
	}
	siteURL, err := atlassian.NormalizeSiteURL(req.SiteURL)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_site_url", err.Error())
		return
	}

	// An empty token means "keep the stored one", so re-verification never
	// forces the credential to be re-entered.
	token := req.Token
	sealed := existing.TokenEnc
	if token == "" {
		token, err = s.sealer.Open(existing.TokenEnc)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "seal_failed", "could not read the stored token")
			return
		}
	} else {
		sealed, err = s.sealer.Seal(token)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "seal_failed", "could not encrypt the API token")
			return
		}
	}

	// The site URL may have changed, so the API base is resolved afresh rather
	// than reused.
	apiBase, err := s.clients.apiBaseForSite(r.Context(), siteURL)
	if err != nil {
		writeInstanceError(w, err)
		return
	}

	// Every write that stores an instance re-verifies, with no exception for a
	// rename. A rule with no exceptions is harder to erode than one carrying a
	// special case, and a stored instance nothing has checked is the failure
	// this whole ticket exists to prevent.
	client, err := jira.New(apiBase, email, token)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_site_url", err.Error())
		return
	}
	if _, err := client.Myself(r.Context()); err != nil {
		writeInstanceError(w, err)
		return
	}

	if err := s.db.UpdateInstance(r.Context(), id, store.InstanceInput{
		Name: name, SiteURL: siteURL, APIBaseURL: apiBase, Email: email, TokenEnc: sealed,
	}); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "not_found", "no such instance")
			return
		}
		writeError(w, http.StatusInternalServerError, "store_failed", "could not update the instance")
		return
	}

	updated, err := s.db.Instance(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not read the updated instance")
		return
	}

	writeJSON(w, http.StatusOK, dtoFromInstance(*updated))
}

// handleDeleteInstance removes an instance and, through the schema's
// ON DELETE CASCADE, its pins, time entries and timer. It contacts Jira not at
// all: there is nothing left to verify, and a site being down must not strand a
// row the user is trying to remove.
func (s *Server) handleDeleteInstance(w http.ResponseWriter, r *http.Request) {
	id, ok := instanceIDFromPath(r)
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "no such instance")
		return
	}

	if err := s.db.DeleteInstance(r.Context(), id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "not_found", "no such instance")
			return
		}
		writeError(w, http.StatusInternalServerError, "store_failed", "could not delete the instance")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// writeInstanceError maps the errors a Jira round trip produces onto statuses.
// Rejected credentials are the user's to fix in Settings; an unreachable site is
// not a server fault, so neither is a 500.
func writeInstanceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, atlassian.ErrTenantUnreadable):
		writeError(w, http.StatusBadGateway, "tenant_unreadable",
			"could not read the site's tenant info; check the site URL and that the site is reachable")
	case errors.Is(err, jira.ErrUnauthorized):
		writeError(w, http.StatusUnauthorized, "credentials_rejected",
			"Jira rejected the email and API token")
	case errors.Is(err, jira.ErrUnreachable):
		writeError(w, http.StatusBadGateway, "instance_unreachable", "the Jira site could not be reached")
	default:
		writeError(w, http.StatusInternalServerError, "unexpected", err.Error())
	}
}
