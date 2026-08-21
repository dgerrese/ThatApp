package server

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"

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
