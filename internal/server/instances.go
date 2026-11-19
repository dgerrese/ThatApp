package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/dgerrese/ThatApp/internal/atlassian"
	"github.com/dgerrese/ThatApp/internal/jira"
	"github.com/dgerrese/ThatApp/internal/store"
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

// instancePositions indexes instances by their 0-based position in this
// slice — store.Instances' created_at order, which is what instanceHue.ts in
// the browser keys its per-instance hue off of. Handlers join it into their
// DTOs from here rather than have the browser fetch /api/instances to resolve
// an id, which would be a round trip to answer a question the server already
// had in hand.
func instancePositions(instances []store.Instance) map[int64]int {
	positions := make(map[int64]int, len(instances))
	for i, inst := range instances {
		positions[inst.ID] = i
	}

	return positions
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
	fields, ok := decodeInstanceRequest(w, r, true)
	if !ok {
		return
	}

	apiBase, err := s.clients.apiBaseForSite(r.Context(), fields.SiteURL)
	if err != nil {
		writeInstanceError(w, err)
		return
	}

	// Verify before storing: an instance must not be storable in a state that
	// silently returns nothing.
	if !verifyJiraCredentials(w, r, apiBase, fields.Email, fields.Token) {
		return
	}

	sealed, err := s.sealer.Seal(fields.Token)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "seal_failed", "could not encrypt the API token")
		return
	}

	inst, err := s.db.CreateInstance(r.Context(), store.InstanceInput{
		Name: fields.Name, SiteURL: fields.SiteURL, APIBaseURL: apiBase, Email: fields.Email, TokenEnc: sealed,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not store the instance")
		return
	}

	writeJSON(w, http.StatusCreated, dtoFromInstance(*inst))
}

// instanceFields is the request body validated for both POST and PATCH: a
// trimmed name and email, a normalized site URL, and the token exactly as the
// client sent it. Token requirements differ per verb — POST requires a
// non-empty one, PATCH treats an empty one as "keep the stored one" — so that
// distinction stays with the caller.
type instanceFields struct {
	Name    string
	Email   string
	SiteURL string
	Token   string
}

// decodeInstanceRequest reads and validates the fields common to POST and
// PATCH bodies, in the order each field is checked: name, email, then
// (only when requireToken) the token, then the site URL. It writes the error
// response itself and returns ok=false on any failure, so callers can return
// immediately.
func decodeInstanceRequest(w http.ResponseWriter, r *http.Request, requireToken bool) (instanceFields, bool) {
	var req instanceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "the request body is not valid JSON")
		return instanceFields{}, false
	}

	name := strings.TrimSpace(req.Name)
	email := strings.TrimSpace(req.Email)
	if name == "" {
		writeError(w, http.StatusBadRequest, "invalid_name", "a name is required")
		return instanceFields{}, false
	}
	if email == "" {
		writeError(w, http.StatusBadRequest, "invalid_email", "an account email is required")
		return instanceFields{}, false
	}
	if requireToken && req.Token == "" {
		writeError(w, http.StatusBadRequest, "missing_token", "an API token is required")
		return instanceFields{}, false
	}
	siteURL, err := atlassian.NormalizeSiteURL(req.SiteURL)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_site_url", err.Error())
		return instanceFields{}, false
	}

	return instanceFields{Name: name, Email: email, SiteURL: siteURL, Token: req.Token}, true
}

// verifyJiraCredentials confirms email and token authenticate against apiBase.
// It writes the error response itself and returns false on any failure, so
// callers can return immediately.
func verifyJiraCredentials(w http.ResponseWriter, r *http.Request, apiBase, email, token string) bool {
	client, err := jira.New(apiBase, email, token)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_site_url", err.Error())
		return false
	}
	if _, err := client.Myself(r.Context()); err != nil {
		writeInstanceError(w, err)
		return false
	}

	return true
}

func (s *Server) handleUpdateInstance(w http.ResponseWriter, r *http.Request) {
	id, ok := idFromPath(w, r, "no such instance")
	if !ok {
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

	fields, ok := decodeInstanceRequest(w, r, false)
	if !ok {
		return
	}

	// An empty token means "keep the stored one", so re-verification never
	// forces the credential to be re-entered.
	token := fields.Token
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
	apiBase, err := s.clients.apiBaseForSite(r.Context(), fields.SiteURL)
	if err != nil {
		writeInstanceError(w, err)
		return
	}

	// Every write that stores an instance re-verifies, with no exception for a
	// rename. A rule with no exceptions is harder to erode than one carrying a
	// special case, and a stored instance nothing has checked is the failure
	// this whole ticket exists to prevent.
	if !verifyJiraCredentials(w, r, apiBase, fields.Email, token) {
		return
	}

	if err := s.db.UpdateInstance(r.Context(), id, store.InstanceInput{
		Name: fields.Name, SiteURL: fields.SiteURL, APIBaseURL: apiBase, Email: fields.Email, TokenEnc: sealed,
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
	id, ok := idFromPath(w, r, "no such instance")
	if !ok {
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

// connectionTestDTO reports who Jira resolved the credentials to. The account
// id is the assertion: a 2xx from any endpoint is not one, which is why this
// route exists at all.
type connectionTestDTO struct {
	AccountID   string `json:"accountId"`
	DisplayName string `json:"displayName"`
}

func (s *Server) handleTestInstance(w http.ResponseWriter, r *http.Request) {
	id, ok := idFromPath(w, r, "no such instance")
	if !ok {
		return
	}

	inst, err := s.db.Instance(r.Context(), id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "not_found", "no such instance")
			return
		}
		writeError(w, http.StatusInternalServerError, "store_failed", "could not read the instance")
		return
	}

	client, err := s.clients.forInstance(r.Context(), inst)
	if err != nil {
		writeInstanceError(w, err)
		return
	}

	me, err := client.Myself(r.Context())
	if err != nil {
		writeInstanceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, connectionTestDTO{
		AccountID: me.AccountID, DisplayName: me.DisplayName,
	})
}

// instanceErrorFor maps the errors a Jira round trip produces onto a status, a
// stable code and a message. Rejected credentials are the user's to fix in
// Settings; an unreachable site is not a server fault, so neither is a 500.
//
// It returns the mapping rather than writing it, because the assigned-issues
// fan-out embeds the same code and message in a response that is otherwise a
// success.
func instanceErrorFor(err error) (status int, code, message string) {
	switch {
	case errors.Is(err, atlassian.ErrTenantUnreadable):
		status, code, message = http.StatusBadGateway, "tenant_unreadable",
			"could not read the site's tenant info; check the site URL and that the site is reachable"
	case errors.Is(err, jira.ErrUnauthorized):
		status, code, message = http.StatusUnauthorized, "credentials_rejected",
			"Jira did not accept the API token for this request; check the token and its scopes"
	case errors.Is(err, jira.ErrForbidden):
		status, code, message = http.StatusForbidden, "permission_denied",
			"your Jira account lacks permission for this"
	case errors.Is(err, jira.ErrRateLimited):
		var limited *jira.RateLimitError
		wait := "shortly"
		if errors.As(err, &limited) && limited.Wait > 0 {
			wait = "in " + waitPhrase(limited.Wait)
		}
		status, code, message = http.StatusServiceUnavailable, "rate_limited",
			"Jira is rate-limiting requests; try again "+wait
	case errors.Is(err, jira.ErrNotFound):
		status, code, message = http.StatusBadGateway, "account_not_found",
			"the site answered but this account has no access to it; check the site URL and account email"
	case errors.Is(err, jira.ErrUnreachable):
		status, code, message = http.StatusBadGateway, "instance_unreachable", "the Jira site could not be reached"
	default:
		status, code, message = http.StatusInternalServerError, "unexpected", "an unexpected error occurred"
	}

	// A cancelled request is the browser leaving, not Jira failing: the issue
	// search cancels its in-flight fetch on every debounced keystroke, and
	// leaving Today/Week mid-fan-out does the same. context.DeadlineExceeded
	// is still logged — that is a real timeout.
	if !errors.Is(err, context.Canceled) {
		// Jira's own words live only in err (CB#79); the response deliberately
		// carries a fixed message, so this line is the one place they survive.
		// A body carrying its own newlines (a proxy's HTML error page, say)
		// would otherwise spread this one failure across several log lines.
		text := strings.ReplaceAll(strings.ReplaceAll(err.Error(), "\r\n", " "), "\n", " ")
		log.Printf("instance error, answered %s: %s", code, text)
	}

	return status, code, message
}

// waitPhrase renders a Retry-After wait for a person: seconds under a minute,
// whole minutes (rounded up) from there. It rounds once, to whole seconds,
// and branches on that — rounding minutes separately would turn a 59.4s wait
// into "60 seconds" instead of "1 minute".
func waitPhrase(wait time.Duration) string {
	seconds := int(math.Ceil(wait.Seconds()))
	if seconds < 60 {
		if seconds == 1 {
			return "1 second"
		}
		return fmt.Sprintf("%d seconds", seconds)
	}
	minutes := (seconds + 59) / 60
	if minutes == 1 {
		return "1 minute"
	}
	return fmt.Sprintf("%d minutes", minutes)
}

func writeInstanceError(w http.ResponseWriter, err error) {
	status, code, message := instanceErrorFor(err)
	writeError(w, status, code, message)
}
