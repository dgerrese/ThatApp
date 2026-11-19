package server

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/dgerrese/ThatApp/internal/store"
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

// pushStateOf reports whether an entry has reached Jira, whether what Jira
// holds is current, and whether a delete is waiting for the push. It is
// computed from worklog_id, deleted_at, pushed_at and updated_at on every read
// rather than stored, which is what makes a repeated push idempotent for free.
//
// A worklog id is the whole of "it reached Jira": an entry carrying one but no
// pushed_at is dirty, not unpushed. That is the state a push leaves behind when
// an edit lands while Jira is answering — the worklog exists and holds the older
// text — and reading it as unpushed is what would have the next push create a
// second worklog for the same time.
//
// A pending delete outranks dirty and pushed: whatever Jira holds, the push's
// next act is to delete it. Unpushed outranks it, because Jira holds nothing
// for such a row and its delete removes the row instead of marking it.
func pushStateOf(e store.Entry) string {
	if e.WorklogID == "" {
		return "unpushed"
	}
	if e.DeletedAt != nil {
		return "deleted"
	}
	if e.PushedAt == nil || e.UpdatedAt.After(*e.PushedAt) {
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

// entriesResponse is what GET /api/entries answers with. Today names the date
// the server resolved in THAT_TIMEZONE, the same value in a ranged read or a
// bare one — a dialog with no day of its own to name is why it exists, and
// that is true whatever range was asked for.
type entriesResponse struct {
	Today   string     `json:"today"`
	Entries []entryDTO `json:"entries"`
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

	writeJSON(w, http.StatusOK, entriesResponse{Today: today, Entries: dtos})
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

// startedAtForDay resolves the instant a created entry starts at. day absent
// answers s.now(), one reading of the clock; day present answers local
// midnight of that day in THAT_TIMEZONE instead, without touching the clock at
// all. It shares dayParam's time.Parse rule, so 2026-02-30 is a day out of
// range rather than 2 March, and answers false having already written the 400.
func (s *Server) startedAtForDay(w http.ResponseWriter, day string) (time.Time, bool) {
	if day == "" {
		return s.now(), true
	}

	parsed, err := time.Parse(dayLayout, day)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request",
			"day must be a date of the form YYYY-MM-DD")
		return time.Time{}, false
	}

	y, m, d := parsed.Date()

	return time.Date(y, m, d, 0, 0, 0, 0, s.cfg.Location), true
}

// createEntryRequest is the body POST accepts. startedAt has no field here: the
// server always stamps it, so a client sending one has it dropped. Day does,
// now — CB#105 lets a Week cell open the dialog for a day that is not today, and
// day is how it says which one; absent still means today, from the server's
// own clock.
type createEntryRequest struct {
	InstanceID int64  `json:"instanceId"`
	IssueKey   string `json:"issueKey"`
	Day        string `json:"day"`
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

	startedAt, ok := s.startedAtForDay(w, req.Day)
	if !ok {
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

	entry, err := s.db.CreateEntry(r.Context(), store.EntryInput{
		InstanceID: inst.ID,
		IssueKey:   key,
		Day:        startedAt.In(s.cfg.Location).Format(dayLayout),
		StartedAt:  startedAt,
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
// property of the manual control, and CB#8's timer will produce a run of 7m13s.
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
// are one person typing in one modal. CB#8 is where it stops being hypothetical:
// a running timer PATCHing seconds while the foot form holds an open comment is
// exactly this interleaving, and that ticket has to decide what to do about it.
func (s *Server) handleUpdateEntry(w http.ResponseWriter, r *http.Request) {
	id, ok := idFromPath(w, r, "no such entry")
	if !ok {
		return
	}

	existing, err := s.db.Entry(r.Context(), id)
	if err != nil {
		writeEntryStoreError(w, err, "could not read the entry")
		return
	}
	if pushStateOf(*existing) == "deleted" {
		writeError(w, http.StatusConflict, "entry_pending_delete",
			"the entry is waiting to be deleted at the next push; restore it first")
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

// handleDeleteEntry removes logged time. An entry Jira holds a worklog for is
// only marked: the next push deletes the worklog, as it carries every other
// change to Jira, and until then the entry can be restored. One Jira has never
// seen goes at once. Deleting an entry already marked changes nothing.
func (s *Server) handleDeleteEntry(w http.ResponseWriter, r *http.Request) {
	id, ok := idFromPath(w, r, "no such entry")
	if !ok {
		return
	}

	// The push's lock, held from the read that decides whether this entry has
	// a worklog through to the write. Outside it, a delete reads an entry a
	// push is halfway through — worklog_id still empty — and drops the row the
	// push was about to record its new worklog in, leaving time in Jira that
	// nothing here can reach.
	s.pushMu.Lock()
	defer s.pushMu.Unlock()

	entry, err := s.db.Entry(r.Context(), id)
	if err != nil {
		writeEntryStoreError(w, err, "could not read the entry")
		return
	}

	if entry.WorklogID != "" {
		if err := s.db.MarkEntryDeleted(r.Context(), id, s.now()); err != nil {
			writeEntryStoreError(w, err, "could not delete the entry")
			return
		}
		w.WriteHeader(http.StatusNoContent)

		return
	}

	if err := s.db.DeleteEntry(r.Context(), id); err != nil {
		writeEntryStoreError(w, err, "could not delete the entry")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// handleRestoreEntry takes back a delete that is waiting for the push and
// answers with the entry in the push state it had before — the delete wrote
// nothing but the mark. Under the push's lock, so a restore cannot land between
// a push deleting the worklog and deleting the row: it waits, and then finds
// the row gone.
func (s *Server) handleRestoreEntry(w http.ResponseWriter, r *http.Request) {
	id, ok := idFromPath(w, r, "no such entry")
	if !ok {
		return
	}

	s.pushMu.Lock()
	defer s.pushMu.Unlock()

	entry, err := s.db.Entry(r.Context(), id)
	if err != nil {
		writeEntryStoreError(w, err, "could not read the entry")
		return
	}
	if pushStateOf(*entry) != "deleted" {
		writeError(w, http.StatusConflict, "entry_not_pending_delete",
			"the entry is not waiting to be deleted")
		return
	}

	instances, positions, ok := s.instanceIndex(w, r)
	if !ok {
		return
	}

	restored, err := s.db.RestoreEntry(r.Context(), id)
	if err != nil {
		writeEntryStoreError(w, err, "could not restore the entry")
		return
	}

	writeJSON(w, http.StatusOK,
		s.entryDTOFrom(*restored, instances[restored.InstanceID], positions[restored.InstanceID]))
}

// writeEntryStoreError turns the store's missing-row error into a 404 and
// anything else into a 500, so every entry route reports a vanished id the same
// way.
func writeEntryStoreError(w http.ResponseWriter, err error, failure string) {
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "not_found", "no such entry")
		return
	}

	writeError(w, http.StatusInternalServerError, "store_failed", failure)
}
