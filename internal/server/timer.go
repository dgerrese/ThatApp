package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"codeberg.org/DionGerrese/ThatApp/internal/store"
)

// validRound reports whether round is one of the two directions the stop
// dialog offers; the zero value ("") is deliberately not one of them, so an
// omitted round is rejected the same way an unknown one is.
func validRound(round store.Rounding) bool {
	return round == store.RoundUp || round == store.RoundDown
}

// timerDTO is the timer in progress, if any. The browser computes elapsed time
// from startedAt itself, so there is no server tick to render. InstanceName and
// InstancePosition are joined in exactly as entryDTOFrom does, so the rail can
// draw a split slice for the running instance without a second fetch.
type timerDTO struct {
	InstanceID       int64  `json:"instanceId"`
	InstanceName     string `json:"instanceName"`
	InstancePosition int    `json:"instancePosition"`
	IssueKey         string `json:"issueKey"`
	StartedAt        string `json:"startedAt"`
}

func (s *Server) timerDTOFrom(timer store.Timer, inst store.Instance, position int) timerDTO {
	return timerDTO{
		InstanceID:       timer.InstanceID,
		InstanceName:     inst.Name,
		InstancePosition: position,
		IssueKey:         timer.IssueKey,
		StartedAt:        timer.StartedAt.In(s.cfg.Location).Format(time.RFC3339),
	}
}

// runningTimerDTO builds the DTO for a running timer, or nil when its
// instance cannot be found in a since-read instance index. handleGetTimer
// reads the timer and the instance index as two separate store calls, so a
// delete landing between them is a real (if narrow) race — and the store
// cascades a timer away with its instance, so nil here is what the truth
// catches up to a moment later, not a DTO with its name and position blanked
// out to the zero value a missing map key would otherwise silently hand back.
func (s *Server) runningTimerDTO(
	running *store.Timer, instances map[int64]store.Instance, positions map[int64]int,
) *timerDTO {
	if running == nil {
		return nil
	}
	inst, found := instances[running.InstanceID]
	if !found {
		return nil
	}
	dto := s.timerDTOFrom(*running, inst, positions[running.InstanceID])

	return &dto
}

// timerStateResponse is what GET /api/timer answers with: the timer now
// running, if any, and the entry a midnight close just created, if any.
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
	if running != nil || closed != nil {
		instances, positions, ok := s.instanceIndex(w, r)
		if !ok {
			return
		}
		resp.Running = s.runningTimerDTO(running, instances, positions)
		if closed != nil {
			dto := s.entryDTOFrom(*closed, instances[closed.InstanceID], positions[closed.InstanceID])
			resp.Stopped = &dto
		}
	}

	writeJSON(w, http.StatusOK, resp)
}

// expectedTimerRequest names the run the stop dialog was confirmed for, so a
// stale tab cannot close a timer another tab started since (CB#226). StartedAt
// is a time.Time so a malformed one fails the body's decode, the 400 any
// malformed field gets.
type expectedTimerRequest struct {
	InstanceID int64     `json:"instanceId"`
	IssueKey   string    `json:"issueKey"`
	StartedAt  time.Time `json:"startedAt"`
}

// storeTimer is the expectation as the store compares it: nil when the request
// named none, which keeps today's unchecked close.
func (e *expectedTimerRequest) storeTimer() *store.Timer {
	if e == nil {
		return nil
	}

	return &store.Timer{InstanceID: e.InstanceID, IssueKey: e.IssueKey, StartedAt: e.StartedAt}
}

// startTimerRequest is the body POST /api/timer/start accepts: the timer to
// start, and — when one is already running — the direction and description
// the stop dialog confirmed for closing it.
type startTimerRequest struct {
	InstanceID int64                 `json:"instanceId"`
	IssueKey   string                `json:"issueKey"`
	Round      store.Rounding        `json:"round"`
	Comment    string                `json:"comment"`
	Expected   *expectedTimerRequest `json:"expected"`
}

// startTimerResponse is what POST /api/timer/start answers with: the timer now
// running, the entry the switch produced (if any), and whether that switch
// discarded the run it closed.
type startTimerResponse struct {
	Running   *timerDTO `json:"running"`
	Stopped   *entryDTO `json:"stopped"`
	Discarded bool      `json:"discarded"`
}

// handleStartTimer stops whatever timer is running, as StopTimer would, then
// starts the new one. Both happen in the store's one transaction, so the
// response's "stopped" is the entry that switch produced, if any. Round and
// comment govern only the timer being closed; starting with nothing running
// ignores them. An `expected` run that is not the one running is refused with
// 409 timer_changed, changing nothing (CB#226).
func (s *Server) handleStartTimer(w http.ResponseWriter, r *http.Request) {
	var req startTimerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "the request body is not valid JSON")
		return
	}

	if req.Round != "" && !validRound(req.Round) {
		writeError(w, http.StatusBadRequest, "invalid_request", `round must be "up" or "down"`)
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

	running, stopped, wasRunning, err := s.db.StartTimer(r.Context(), inst.ID, key, s.now(), s.cfg.Location,
		store.TimerClose{Round: req.Round, Comment: req.Comment, Expected: req.Expected.storeTimer()})
	if errors.Is(err, store.ErrTimerChanged) {
		writeError(w, http.StatusConflict, "timer_changed", "The timer changed in another tab.")
		return
	}
	if errors.Is(err, store.ErrRoundingRequired) {
		writeError(w, http.StatusBadRequest, "invalid_request", "a timer is running: round is required to stop it")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not start the timer")
		return
	}

	runningDTO := s.timerDTOFrom(*running, inst, positions[inst.ID])
	resp := startTimerResponse{Running: &runningDTO, Discarded: wasRunning && stopped == nil}
	if stopped != nil {
		// instances and positions were already read above for req.InstanceID; the
		// switched-away entry's instance is in the same map, so this reuses it
		// rather than reading the instances table a second time.
		dto := s.entryDTOFrom(*stopped, instances[stopped.InstanceID], positions[stopped.InstanceID])
		resp.Stopped = &dto
	}

	writeJSON(w, http.StatusOK, resp)
}

// stopTimerRequest is the body POST /api/timer/stop requires: the direction
// the stop dialog confirmed, and its optional description.
type stopTimerRequest struct {
	Round    store.Rounding        `json:"round"`
	Comment  string                `json:"comment"`
	Expected *expectedTimerRequest `json:"expected"`
}

// stopTimerResponse is what POST /api/timer/stop answers with. Discarded is
// true only when a timer was running and its run rounded down to zero —
// nothing running is not an error and not a discard.
type stopTimerResponse struct {
	Stopped   *entryDTO `json:"stopped"`
	Discarded bool      `json:"discarded"`
}

// handleStopTimer ends whatever timer is running, landing its run on the
// 15-minute grid in the direction the stop dialog confirmed. A malformed body
// or a round that is neither "up" nor "down" is refused; nothing running still
// answers 200 with both fields empty, matching the store's own "not an error"
// reading of that case. An `expected` run that is not the one running is
// refused with 409 timer_changed, changing nothing (CB#226).
func (s *Server) handleStopTimer(w http.ResponseWriter, r *http.Request) {
	var req stopTimerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "the request body is not valid JSON")
		return
	}
	if !validRound(req.Round) {
		writeError(w, http.StatusBadRequest, "invalid_request", `round must be "up" or "down"`)
		return
	}

	entry, wasRunning, err := s.db.StopTimer(r.Context(), s.now(), s.cfg.Location,
		store.TimerClose{Round: req.Round, Comment: req.Comment, Expected: req.Expected.storeTimer()})
	if errors.Is(err, store.ErrTimerChanged) {
		writeError(w, http.StatusConflict, "timer_changed", "The timer changed in another tab.")
		return
	}
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
