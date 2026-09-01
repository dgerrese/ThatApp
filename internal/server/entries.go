package server

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"codeberg.org/DionGerrese/ThatApp/internal/store"
)

// dayLayout is the wire form of a local date: the format `day` is stored in and
// the only one `from` and `to` are accepted in.
const dayLayout = "2006-01-02"

// maxEntrySeconds is a full day. A longer entry is a mistyped duration rather
// than work, and it would break the day total it is supposed to feed.
const maxEntrySeconds = 24 * 60 * 60

// entryDTO is one logged entry as the dialog and the rail need it. InstanceName
// and InstancePosition are joined in here rather than resolved in the browser,
// which would be a round trip to answer a question the server already had in
// hand; position is the 0-based index into store.Instances' created_at order,
// which is what instanceHue.ts keys its colour off.
type entryDTO struct {
	ID               int64  `json:"id"`
	InstanceID       int64  `json:"instanceId"`
	InstanceName     string `json:"instanceName"`
	InstancePosition int    `json:"instancePosition"`
	IssueKey         string `json:"issueKey"`
	Day              string `json:"day"`
	StartedAt        string `json:"startedAt"`
	Seconds          int    `json:"seconds"`
	Comment          string `json:"comment"`
	PushState        string `json:"pushState"`
}

// pushStateOf reports whether an entry has reached Jira, and whether it has been
// edited since. It is computed from worklog_id, pushed_at and updated_at on every
// read rather than stored, which is what makes a repeated push idempotent for free.
func pushStateOf(e store.Entry) string {
	if e.WorklogID == "" || e.PushedAt == nil {
		return "unpushed"
	}
	if e.UpdatedAt.After(*e.PushedAt) {
		return "dirty"
	}

	return "pushed"
}

// entryDTOFrom renders one row for the browser. started_at is normalised to UTC
// on write, so it is converted back to the configured zone here: the dialog
// shows the wall clock the entry was made at without the browser having to know
// THAT_TIMEZONE, or having to agree with it.
func (s *Server) entryDTOFrom(entry store.Entry, inst store.Instance, position int) entryDTO {
	return entryDTO{
		ID:               entry.ID,
		InstanceID:       entry.InstanceID,
		InstanceName:     inst.Name,
		InstancePosition: position,
		IssueKey:         entry.IssueKey,
		Day:              entry.Day,
		StartedAt:        entry.StartedAt.In(s.cfg.Location).Format(time.RFC3339),
		Seconds:          entry.Seconds,
		Comment:          entry.Comment,
		PushState:        pushStateOf(entry),
	}
}

// instanceIndex reads every instance and returns it indexed by id alongside its
// 0-based position in that same created_at order. An entry whose instance is
// missing cannot exist — the foreign key cascades — so both lookups are total
// for a stored entry, and POST uses the id lookup to answer instance_not_found.
//
// Totality holds only when the instances are read before the entries: an
// instance deleted between the two reads has cascaded its entries out of the
// later read, where the other order would join those entries against a map
// that no longer holds their instance.
func (s *Server) instanceIndex(
	w http.ResponseWriter, r *http.Request,
) (map[int64]store.Instance, map[int64]int, bool) {
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

	return byID, instancePositions(instances), true
}

// handleListEntries answers with the entries in an inclusive from/to range,
// oldest first. Both bounds default to today resolved in THAT_TIMEZONE, so the
// rail's call is a bare GET /api/entries and the browser never computes a date.
func (s *Server) handleListEntries(w http.ResponseWriter, r *http.Request) {
	today := s.now().In(s.cfg.Location).Format(dayLayout)

	from, ok := dayParam(w, r, "from", today)
	if !ok {
		return
	}
	to, ok := dayParam(w, r, "to", today)
	if !ok {
		return
	}
	// Lexicographic order is chronological for YYYY-MM-DD, both bounds having
	// been parsed into that shape above.
	if from > to {
		writeError(w, http.StatusBadRequest, "invalid_request", "from must not be after to")
		return
	}

	// Instances first — see instanceIndex on why this order is load-bearing.
	instances, positions, ok := s.instanceIndex(w, r)
	if !ok {
		return
	}

	entries, err := s.db.EntriesForDay(r.Context(), from, to)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not read the logged time")
		return
	}

	dtos := make([]entryDTO, 0, len(entries))
	for _, entry := range entries {
		dtos = append(dtos,
			s.entryDTOFrom(entry, instances[entry.InstanceID], positions[entry.InstanceID]))
	}

	writeJSON(w, http.StatusOK, dtos)
}

// dayParam reads one inclusive YYYY-MM-DD bound, falling back to fallback when
// it is absent. time.Parse rejects both a malformed date and an impossible one —
// 2026-02-30 is "day out of range", not 2 March — so a bound that parses is one
// the store can compare against.
func dayParam(w http.ResponseWriter, r *http.Request, name, fallback string) (string, bool) {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return fallback, true
	}

	if _, err := time.Parse(dayLayout, raw); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request",
			name+" must be a date of the form YYYY-MM-DD")
		return "", false
	}

	return raw, true
}

// createEntryRequest is the body POST accepts. day and startedAt are absent on
// purpose: the server stamps both, so a browser cannot post itself into another
// day, and a client sending them anyway has them dropped here.
type createEntryRequest struct {
	InstanceID int64  `json:"instanceId"`
	IssueKey   string `json:"issueKey"`
	Seconds    int    `json:"seconds"`
	Comment    string `json:"comment"`
}

// handleCreateEntry logs time against an issue. It contacts no Jira instance and
// does not verify the issue exists: the keys come from rows already on screen,
// and an unreachable site must not stop time being recorded against it.
func (s *Server) handleCreateEntry(w http.ResponseWriter, r *http.Request) {
	var req createEntryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "the request body is not valid JSON")
		return
	}

	key := strings.TrimSpace(req.IssueKey)
	if key == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "an issue key is required")
		return
	}
	if req.InstanceID <= 0 {
		writeError(w, http.StatusBadRequest, "invalid_request", "an instance id is required")
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

	if !validEntrySeconds(w, req.Seconds) {
		return
	}

	// One reading of the clock, not two: a second call could land the other side
	// of midnight and file the entry on a day its own start time contradicts.
	now := s.now()

	entry, err := s.db.CreateEntry(r.Context(), store.EntryInput{
		InstanceID: inst.ID,
		IssueKey:   key,
		Day:        now.In(s.cfg.Location).Format(dayLayout),
		StartedAt:  now,
		Seconds:    req.Seconds,
		Comment:    req.Comment,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not log the time")
		return
	}

	writeJSON(w, http.StatusCreated, s.entryDTOFrom(*entry, inst, positions[inst.ID]))
}

// validEntrySeconds rejects a duration that cannot be a day's work. It
// deliberately does not require a multiple of 900: the 15-minute grid is a
// property of the manual control, and #8's timer will produce a run of 7m13s.
func validEntrySeconds(w http.ResponseWriter, seconds int) bool {
	if seconds <= 0 || seconds > maxEntrySeconds {
		writeError(w, http.StatusBadRequest, "invalid_request",
			"seconds must be between 1 and "+strconv.Itoa(maxEntrySeconds))
		return false
	}

	return true
}

// updateEntryRequest is the body PATCH accepts. Both fields are pointers so that
// an absent one can be told from a cleared one: {"comment":""} erases a comment,
// while omitting it keeps what is stored.
type updateEntryRequest struct {
	Seconds *int    `json:"seconds"`
	Comment *string `json:"comment"`
}

// entryIDFromPath reads the {id} wildcard, answering 400 for a non-numeric id
// itself, as /api/pins/{id} does: an entry id follows a click on a
// store-generated integer, so a garbled one is the client's mistake rather than
// a route that does not exist.
func entryIDFromPath(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid_request",
			"the entry id must be a positive integer")
		return 0, false
	}

	return id, true
}

// handleUpdateEntry rewrites a duration, a comment, or both. It never touches
// day or started_at: the start time is not editable, and moving an entry between
// days would let the browser rewrite history the server stamped.
//
// The entry is read before the duration is validated, mirroring POST, where an
// unknown instance is reported ahead of a bad duration: a PATCH to an id that
// does not exist is a missing entry whatever else the body says. The read costs
// nothing extra, because a PATCH carrying one field has to read the other back
// anyway.
//
// Read-modify-write here is not atomic, and deliberately so. Two concurrent
// PATCHes for one id — one sending seconds, one sending a comment — can both
// read before either writes, and the second write puts the stale half back,
// discarding one edit. It is a logical lost update rather than a Go data race,
// so -race would never see it, and SQLite's own locking cannot help: the two
// statements are separate transactions by the time they reach it. Tolerated
// because this is a single-user app driven by one browser, where the two edits
// are one person typing in one modal. #8 is where it stops being hypothetical:
// a running timer PATCHing seconds while the foot form holds an open comment is
// exactly this interleaving, and that ticket has to decide what to do about it.
func (s *Server) handleUpdateEntry(w http.ResponseWriter, r *http.Request) {
	id, ok := entryIDFromPath(w, r)
	if !ok {
		return
	}

	var req updateEntryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "the request body is not valid JSON")
		return
	}
	if req.Seconds == nil && req.Comment == nil {
		writeError(w, http.StatusBadRequest, "invalid_request",
			"a duration, a comment, or both are required")
		return
	}

	existing, err := s.db.Entry(r.Context(), id)
	if err != nil {
		writeEntryStoreError(w, err, "could not read the entry")
		return
	}

	if req.Seconds != nil && !validEntrySeconds(w, *req.Seconds) {
		return
	}

	seconds := existing.Seconds
	if req.Seconds != nil {
		seconds = *req.Seconds
	}
	comment := existing.Comment
	if req.Comment != nil {
		comment = *req.Comment
	}

	// Read before anything is stored, as POST does: a failure here must not
	// report failure after UpdateEntry has already rewritten the row.
	instances, positions, ok := s.instanceIndex(w, r)
	if !ok {
		return
	}

	entry, err := s.db.UpdateEntry(r.Context(), id, seconds, comment)
	if err != nil {
		writeEntryStoreError(w, err, "could not update the entry")
		return
	}

	writeJSON(w, http.StatusOK,
		s.entryDTOFrom(*entry, instances[entry.InstanceID], positions[entry.InstanceID]))
}

// handleDeleteEntry removes logged time. Like unpinning, it is purely a store
// operation: nothing has been pushed to Jira yet, and #9 owns what deleting a
// pushed entry means.
func (s *Server) handleDeleteEntry(w http.ResponseWriter, r *http.Request) {
	id, ok := entryIDFromPath(w, r)
	if !ok {
		return
	}

	if err := s.db.DeleteEntry(r.Context(), id); err != nil {
		writeEntryStoreError(w, err, "could not delete the entry")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// writeEntryStoreError turns the store's missing-row error into a 404 and
// anything else into a 500, so every entry route reports a vanished id the same
// way.
func writeEntryStoreError(w http.ResponseWriter, err error, failure string) {
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "entry_not_found", "no such entry")
		return
	}

	writeError(w, http.StatusInternalServerError, "store_failed", failure)
}
