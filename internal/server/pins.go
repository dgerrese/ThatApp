package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"codeberg.org/DionGerrese/ThatApp/internal/jira"
	"codeberg.org/DionGerrese/ThatApp/internal/store"
)

// pinDTO is one pin as the Pinned card needs it. InstanceName is joined in here
// rather than resolved in the browser, which would be a round trip to answer a
// question the server already had in hand. Error stays nil on a plain GET,
// which reads the cache only and reaches no Jira instance; it is set per-row by
// a refresh that could not reach that pin's instance or issue.
type pinDTO struct {
	ID               int64      `json:"id"`
	InstanceID       int64      `json:"instanceId"`
	InstanceName     string     `json:"instanceName"`
	InstancePosition int        `json:"instancePosition"`
	Key              string     `json:"key"`
	Summary          string     `json:"summary"`
	Status           string     `json:"status"`
	URL              string     `json:"url"`
	Error            *errorBody `json:"error"`
}

func pinDTOFrom(pin store.Pin, inst store.Instance, position int) pinDTO {
	return pinDTO{
		ID:               pin.ID,
		InstanceID:       pin.InstanceID,
		InstanceName:     inst.Name,
		InstancePosition: position,
		Key:              pin.IssueKey,
		Summary:          pin.SummaryCache,
		Status:           pin.StatusCache,
		URL:              browseURL(inst.SiteURL, pin.IssueKey),
	}
}

// handleListPins answers with every pin from the store, joined with the
// instance it belongs to. It reads two tables and calls no Jira client, so it
// answers even when every configured instance is unreachable — unless
// ?refresh=1 asks it to re-look-up every pin first.
func (s *Server) handleListPins(w http.ResponseWriter, r *http.Request) {
	pins, instances, positions, ok := s.pinsWithInstances(w, r)
	if !ok {
		return
	}

	dtos := make([]pinDTO, 0, len(pins))
	for _, pin := range pins {
		dtos = append(dtos, pinDTOFrom(pin, instances[pin.InstanceID], positions[pin.InstanceID]))
	}

	if r.URL.Query().Get("refresh") == "1" {
		s.refreshPins(r, dtos, pins, instances)
	}

	writeJSON(w, http.StatusOK, dtos)
}

// refreshPins re-reads every pin from Jira and rewrites its cache in place.
//
// The fan-out is over instances rather than pins: two pins on one site share a
// client, which also keeps forInstance's first-use api_base_url repair from
// running twice concurrently against the same row.
//
// It never returns an error. A per-pin failure is that pin's error field, and
// the cached values it already had are left exactly as they were.
func (s *Server) refreshPins(
	r *http.Request, dtos []pinDTO, pins []store.Pin, instances map[int64]store.Instance,
) {
	byInstance := map[int64][]int{}
	ordered := []store.Instance{}
	for i, pin := range pins {
		if _, seen := byInstance[pin.InstanceID]; !seen {
			ordered = append(ordered, instances[pin.InstanceID])
		}
		byInstance[pin.InstanceID] = append(byInstance[pin.InstanceID], i)
	}

	fanOutInstances(r.Context(), ordered, issueFetchTimeout,
		func(ctx context.Context, inst store.Instance) struct{} {
			client, err := s.clients.forInstance(ctx, &inst)
			if err != nil {
				for _, i := range byInstance[inst.ID] {
					dtos[i].Error = instanceErrorBody(err)
				}

				return struct{}{}
			}

			for _, i := range byInstance[inst.ID] {
				issue, err := client.Issue(ctx, pins[i].IssueKey)
				if err != nil {
					// Before the shared mapping, which reads a 404 as a missing account.
					if errors.Is(err, jira.ErrNotFound) {
						dtos[i].Error = &errorBody{
							Code:    "issue_not_found",
							Message: "no issue with that key on this instance",
						}
					} else {
						dtos[i].Error = instanceErrorBody(err)
					}
					continue
				}

				dtos[i].Summary = issue.Summary
				dtos[i].Status = issue.Status

				if err := s.db.SetPinCache(r.Context(), pins[i].ID, issue.Summary, issue.Status); err != nil {
					log.Printf("caching pin %d: %v", pins[i].ID, err)
				}
			}

			return struct{}{}
		})
}

// pinsWithInstances reads both tables and indexes the instances by id, plus by
// their 0-based position in that same read for pinDTO.InstancePosition. A pin
// whose instance is missing cannot exist — the foreign key cascades — so both
// lookups are total.
func (s *Server) pinsWithInstances(
	w http.ResponseWriter, r *http.Request,
) ([]store.Pin, map[int64]store.Instance, map[int64]int, bool) {
	pins, err := s.db.Pins(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not read the stored pins")
		return nil, nil, nil, false
	}

	instances, err := s.db.Instances(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed",
			"could not read the stored instances")
		return nil, nil, nil, false
	}

	byID := make(map[int64]store.Instance, len(instances))
	positions := make(map[int64]int, len(instances))
	for i, inst := range instances {
		byID[inst.ID] = inst
		positions[inst.ID] = i
	}

	return pins, byID, positions, true
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

	// Read before anything is stored, alongside the single-instance lookup
	// above: a failure here must not report success after CreatePin has
	// already written the row.
	instances, err := s.db.Instances(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not read the stored instances")
		return
	}
	position, ok := instancePositions(instances)[inst.ID]
	if !ok {
		// Unreachable in practice: inst was just read from the same store, in
		// the same request, and the foreign key guarantees it is one of
		// instances. Refusing outright is what stands between that and
		// silently painting this pin with instance 0's hue.
		log.Printf("instance %d missing from its own position index", inst.ID)
		writeError(w, http.StatusInternalServerError, "store_failed", "could not place the instance")

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

	writeJSON(w, http.StatusCreated, pinDTOFrom(*pin, *inst, position))
}
