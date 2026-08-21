package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/dgerrese/work-dashboard/internal/jira"
	"github.com/dgerrese/work-dashboard/internal/store"
)

// pinDTO is one pin as the Pinned card needs it. InstanceName is joined in here
// rather than resolved in the browser, which would be a round trip to answer a
// question the server already had in hand. Error stays nil on this plain GET,
// which reads the cache only and reaches no Jira instance; a later ticket that
// adds a refresh path is what gives it a value.
type pinDTO struct {
	ID           int64      `json:"id"`
	InstanceID   int64      `json:"instanceId"`
	InstanceName string     `json:"instanceName"`
	Key          string     `json:"key"`
	Summary      string     `json:"summary"`
	Status       string     `json:"status"`
	URL          string     `json:"url"`
	Error        *errorBody `json:"error"`
}

func pinDTOFrom(pin store.Pin, inst store.Instance) pinDTO {
	return pinDTO{
		ID:           pin.ID,
		InstanceID:   pin.InstanceID,
		InstanceName: inst.Name,
		Key:          pin.IssueKey,
		Summary:      pin.SummaryCache,
		Status:       pin.StatusCache,
		URL:          browseURL(inst.SiteURL, pin.IssueKey),
	}
}

// handleListPins answers with every pin from the store, joined with the
// instance it belongs to. It reads two tables and calls no Jira client, so it
// answers even when every configured instance is unreachable.
func (s *Server) handleListPins(w http.ResponseWriter, r *http.Request) {
	pins, instances, ok := s.pinsWithInstances(w, r)
	if !ok {
		return
	}

	dtos := make([]pinDTO, 0, len(pins))
	for _, pin := range pins {
		dtos = append(dtos, pinDTOFrom(pin, instances[pin.InstanceID]))
	}

	writeJSON(w, http.StatusOK, dtos)
}

// pinsWithInstances reads both tables and indexes the instances by id. A pin
// whose instance is missing cannot exist — the foreign key cascades — so the
// lookup is total.
func (s *Server) pinsWithInstances(
	w http.ResponseWriter, r *http.Request,
) ([]store.Pin, map[int64]store.Instance, bool) {
	pins, err := s.db.Pins(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not read the stored pins")
		return nil, nil, false
	}

	instances, err := s.db.Instances(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed",
			"could not read the stored instances")
		return nil, nil, false
	}

	byID := make(map[int64]store.Instance, len(instances))
	for _, inst := range instances {
		byID[inst.ID] = inst
	}

	return pins, byID, true
}

// pinIDFromPath reads the {id} wildcard, answering 400 for a non-numeric id
// itself. This differs from instanceIDFromPath, which reports a missing or
// malformed id as 404: an instance id living in a browser-typed URL and a pin
// id following a click on a store-generated integer are not the same kind of
// input, so a garbled pin id is the client's mistake rather than a route that
// simply doesn't exist.
func pinIDFromPath(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid_request", "the pin id must be a positive integer")
		return 0, false
	}

	return id, true
}

// handleDeletePin unpins an issue. It contacts no Jira instance: unpinning is
// purely a store operation, and an unreachable site must not strand a pin the
// user is trying to remove.
func (s *Server) handleDeletePin(w http.ResponseWriter, r *http.Request) {
	id, ok := pinIDFromPath(w, r)
	if !ok {
		return
	}

	if err := s.db.DeletePin(r.Context(), id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "pin_not_found", "no such pin")
			return
		}
		writeError(w, http.StatusInternalServerError, "store_failed", "could not remove the pin")

		return
	}

	w.WriteHeader(http.StatusNoContent)
}

type createPinRequest struct {
	InstanceID int64  `json:"instanceId"`
	IssueKey   string `json:"issueKey"`
}

// handleCreatePin looks the issue up on its instance before storing anything,
// which is what makes "no such issue" a rejection rather than a pin that renders
// blank forever.
func (s *Server) handleCreatePin(w http.ResponseWriter, r *http.Request) {
	var req createPinRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "the request body is not valid JSON")
		return
	}

	key := strings.TrimSpace(req.IssueKey)
	if key == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "an issue key is required")
		return
	}

	inst, err := s.db.Instance(r.Context(), req.InstanceID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "instance_not_found", "no such instance")
			return
		}
		writeError(w, http.StatusInternalServerError, "store_failed", "could not read the instance")

		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), issueFetchTimeout)
	defer cancel()

	client, err := s.clients.forInstance(ctx, inst)
	if err != nil {
		writeInstanceError(w, err)
		return
	}

	issue, err := client.Issue(ctx, key)
	if err != nil {
		// Before the shared mapping, which reads a 404 as a missing account.
		if errors.Is(err, jira.ErrNotFound) {
			writeError(w, http.StatusNotFound, "issue_not_found",
				"no issue with that key on this instance")
			return
		}
		writeInstanceError(w, err)

		return
	}

	pin, err := s.db.CreatePin(r.Context(), store.PinInput{
		InstanceID:   inst.ID,
		IssueKey:     issue.Key,
		SummaryCache: issue.Summary,
		StatusCache:  issue.Status,
	})
	if err != nil {
		if errors.Is(err, store.ErrPinExists) {
			writeError(w, http.StatusConflict, "pin_exists",
				"that issue is already pinned on this instance")
			return
		}
		writeError(w, http.StatusInternalServerError, "store_failed", "could not store the pin")

		return
	}

	writeJSON(w, http.StatusCreated, pinDTOFrom(*pin, *inst))
}
