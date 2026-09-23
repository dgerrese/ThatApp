package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"codeberg.org/DionGerrese/ThatApp/internal/store"
)

// timerDTO is the timer in progress, if any. The browser computes elapsed time
// from startedAt itself, so there is no server tick to render.
type timerDTO struct {
	InstanceID int64  `json:"instanceId"`
	IssueKey   string `json:"issueKey"`
	StartedAt  string `json:"startedAt"`
}

func (s *Server) timerDTOFrom(timer store.Timer) timerDTO {
	return timerDTO{
		InstanceID: timer.InstanceID,
		IssueKey:   timer.IssueKey,
		StartedAt:  timer.StartedAt.In(s.cfg.Location).Format(time.RFC3339),
	}
}

// timerStateResponse is what GET /api/timer and POST /api/timer/start answer
// with: the timer now running, if any, and the entry a midnight close or a
// switch just created, if any.
type timerStateResponse struct {
	Running *timerDTO `json:"running"`
	Stopped *entryDTO `json:"stopped"`
}

// entryDTOForClosedTimer renders the entry a timer close produced, joined
// against its instance exactly as /api/entries renders one — the store shares
// one INSERT for a timer-made entry and a manual one, and this is the render
// path proving the two stay indistinguishable over HTTP too.
func (s *Server) entryDTOForClosedTimer(
	w http.ResponseWriter, r *http.Request, entry *store.Entry,
) (entryDTO, bool) {
	instances, positions, ok := s.instanceIndex(w, r)
	if !ok {
		return entryDTO{}, false
	}

	return s.entryDTOFrom(*entry, instances[entry.InstanceID], positions[entry.InstanceID]), true
}

// handleGetTimer answers the timer in progress. A timer whose start day has
// passed is closed by the store as part of reading it, so this can also carry
// a just-created entry back in "stopped".
func (s *Server) handleGetTimer(w http.ResponseWriter, r *http.Request) {
	running, closed, err := s.db.RunningTimer(r.Context(), s.now(), s.cfg.Location)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not read the timer")
		return
	}

	var resp timerStateResponse
	if running != nil {
		dto := s.timerDTOFrom(*running)
		resp.Running = &dto
	}
	if closed != nil {
		dto, ok := s.entryDTOForClosedTimer(w, r, closed)
		if !ok {
			return
		}
		resp.Stopped = &dto
	}

	writeJSON(w, http.StatusOK, resp)
}

// startTimerRequest is the body POST /api/timer/start accepts.
type startTimerRequest struct {
	InstanceID int64  `json:"instanceId"`
	IssueKey   string `json:"issueKey"`
}

// handleStartTimer stops whatever timer is running, as StopTimer would, then
// starts the new one. Both happen in the store's one transaction, so the
// response's "stopped" is the entry that switch produced, if any.
func (s *Server) handleStartTimer(w http.ResponseWriter, r *http.Request) {
	var req startTimerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "the request body is not valid JSON")
		return
	}

	key := strings.TrimSpace(req.IssueKey)
	if key == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "an issue key is required")
		return
	}

	instances, positions, ok := s.instanceIndex(w, r)
	if !ok {
		return
	}
	inst, found := instances[req.InstanceID]
	if !found {
		writeError(w, http.StatusNotFound, "instance_not_found", "no such instance")
		return
	}

	running, stopped, _, err := s.db.StartTimer(r.Context(), inst.ID, key, s.now(), s.cfg.Location, store.TimerClose{})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not start the timer")
		return
	}

	runningDTO := s.timerDTOFrom(*running)
	resp := timerStateResponse{Running: &runningDTO}
	if stopped != nil {
		// instances and positions were already read above for req.InstanceID; the
		// switched-away entry's instance is in the same map, so this reuses it
		// rather than reading the instances table a second time.
		dto := s.entryDTOFrom(*stopped, instances[stopped.InstanceID], positions[stopped.InstanceID])
		resp.Stopped = &dto
	}

	writeJSON(w, http.StatusOK, resp)
}

// stopTimerResponse is what POST /api/timer/stop answers with. Discarded is
// true only when a timer was running and its run fell short of
// store.MinTimerSeconds — nothing running is not an error and not a discard.
type stopTimerResponse struct {
	Stopped   *entryDTO `json:"stopped"`
	Discarded bool      `json:"discarded"`
}

// handleStopTimer ends whatever timer is running. Nothing running answers
// 200 with both fields empty, matching the store's own "not an error" reading
// of that case.
func (s *Server) handleStopTimer(w http.ResponseWriter, r *http.Request) {
	entry, wasRunning, err := s.db.StopTimer(r.Context(), s.now(), s.cfg.Location, store.TimerClose{})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not stop the timer")
		return
	}

	resp := stopTimerResponse{Discarded: wasRunning && entry == nil}
	if entry != nil {
		dto, ok := s.entryDTOForClosedTimer(w, r, entry)
		if !ok {
			return
		}
		resp.Stopped = &dto
	}

	writeJSON(w, http.StatusOK, resp)
}
