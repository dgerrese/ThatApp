package server

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"time"

	"codeberg.org/DionGerrese/ThatApp/internal/jira"
	"codeberg.org/DionGerrese/ThatApp/internal/store"
)

// pushInstanceTimeout bounds one instance's whole sequence of worklog creates,
// not a single call — jira.Client already bounds each call itself. It is
// generous because a long day is many entries against the same site, and the
// cost of cutting a push short is a worklog created in Jira that no local row
// records.
const pushInstanceTimeout = 2 * time.Minute

type pushResultDTO struct {
	EntryID    int64      `json:"entryId"`
	IssueKey   string     `json:"issueKey"`
	InstanceID int64      `json:"instanceId"`
	Status     string     `json:"status"`
	WorklogID  string     `json:"worklogId,omitempty"`
	Error      *errorBody `json:"error,omitempty"`
}

type pushResponseDTO struct {
	Day     string          `json:"day"`
	Results []pushResultDTO `json:"results"`
}

// handlePushDay turns one local day's entries into Jira worklogs.
//
// It answers 200 whenever the day could be read: a Jira site refusing a worklog
// is data about that entry, not a failure of this request. Per-entry results are
// the only honest report, because the push is deliberately not transactional.
func (s *Server) handlePushDay(w http.ResponseWriter, r *http.Request) {
	// Held for the whole handler, not just the write: two concurrent pushes
	// must not both read the same entry as unpushed before either records a
	// worklog_id, which is what would create a duplicate worklog in Jira. The
	// second request, once it gets the lock, sees the worklog_ids the first
	// one wrote and correctly reports those entries as "skipped".
	s.pushMu.Lock()
	defer s.pushMu.Unlock()

	today := s.now().In(s.cfg.Location).Format(dayLayout)

	day, ok := dayParam(w, r, "day", today)
	if !ok {
		return
	}

	instances, err := s.db.Instances(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not read the stored instances")
		return
	}

	entries, err := s.db.EntriesForDay(r.Context(), day, day)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not read the logged time")
		return
	}

	byInstance := make(map[int64][]store.Entry, len(instances))
	for _, entry := range entries {
		byInstance[entry.InstanceID] = append(byInstance[entry.InstanceID], entry)
	}

	groups := fanOutInstances(r.Context(), instances, pushInstanceTimeout,
		func(ctx context.Context, inst store.Instance) []pushResultDTO {
			return s.pushInstanceEntries(ctx, inst, byInstance[inst.ID])
		})

	results := make([]pushResultDTO, 0, len(entries))
	covered := make(map[int64]bool, len(entries))
	for _, group := range groups {
		for _, result := range group {
			results = append(results, result)
			covered[result.EntryID] = true
		}
	}

	// An entry whose instance is no longer configured is reachable by no
	// goroutine above, and silently dropping it would report a clean push over
	// time that never left the machine.
	for _, entry := range entries {
		if covered[entry.ID] {
			continue
		}
		results = append(results, pushResultDTO{
			EntryID:    entry.ID,
			IssueKey:   entry.IssueKey,
			InstanceID: entry.InstanceID,
			Status:     "failed",
			Error: &errorBody{
				Code:    "instance_missing",
				Message: "the Jira instance this entry belongs to is no longer configured",
			},
		})
	}

	// Sorted by entry id so the order is the caller's to rely on and a test's to
	// assert, rather than an accident of which instance answered first.
	sort.Slice(results, func(i, j int) bool { return results[i].EntryID < results[j].EntryID })

	writeJSON(w, http.StatusOK, pushResponseDTO{Day: day, Results: results})
}

// pushInstanceEntries pushes one instance's entries in order, sequentially: they
// share a site and a rate limit, so parallelism here buys nothing and risks
// throttling. It never returns an error — see fanOutInstances on why.
func (s *Server) pushInstanceEntries(
	ctx context.Context, inst store.Instance, entries []store.Entry,
) []pushResultDTO {
	if len(entries) == 0 {
		return nil
	}

	results := make([]pushResultDTO, 0, len(entries))

	client, clientErr := s.clients.forInstance(ctx, &inst)
	for _, entry := range entries {
		result := pushResultDTO{
			EntryID:    entry.ID,
			IssueKey:   entry.IssueKey,
			InstanceID: entry.InstanceID,
		}

		state := pushStateOf(entry)
		if state == "pushed" {
			result.Status = "skipped"
			result.WorklogID = entry.WorklogID
			results = append(results, result)
			continue
		}

		if clientErr != nil {
			result.Status = "failed"
			result.Error = instanceErrorBody(clientErr)
			results = append(results, result)
			continue
		}

		if state == "deleted" {
			results = append(results, s.deleteWorklogThenEntry(ctx, client, entry, result))
			continue
		}

		worklog := jira.Worklog{
			IssueKey: entry.IssueKey,
			Started:  entry.StartedAt,
			Seconds:  int64(entry.Seconds),
			Comment:  entry.Comment,
		}

		worklogID := entry.WorklogID
		var err error
		if state == "dirty" {
			err = client.UpdateWorklog(ctx, entry.WorklogID, worklog)
			// Gone in Jira means the outcome the user wants is a worklog
			// holding this text, and there is no longer one to correct. So it
			// is created afresh and the new id stored, rather than failing and
			// asking them to go to Jira and unstick it by hand.
			if errors.Is(err, jira.ErrNotFound) {
				worklogID, err = client.CreateWorklog(ctx, worklog)
			}
		} else {
			worklogID, err = client.CreateWorklog(ctx, worklog)
		}
		if err != nil {
			result.Status = "failed"
			result.Error = instanceErrorBody(err)
			results = append(results, result)
			continue
		}

		// Recorded immediately, per entry, rather than batched at the end: the
		// worklog exists in Jira from here on, and a crash before the write
		// would leave the next push creating a duplicate.
		//
		// WithoutCancel is the same scenario without the crash. ctx descends
		// from the request, which net/http cancels the moment the browser goes
		// away, and database/sql refuses to execute on a cancelled context.
		//
		// The boolean is deliberately discarded. False means an edit landed
		// while Jira was answering, which withholds the mark but not the
		// worklog id: the worklog exists, this push created it and says so,
		// and the entry reads dirty — so the next push updates that worklog
		// instead of creating a second one for the same time.
		if _, err := s.db.RecordWorklogMarkingPushedIfUnchanged(
			context.WithoutCancel(ctx), entry.ID, worklogID, s.now().UTC(), entry.UpdatedAt,
		); err != nil {
			result.Status = "failed"
			result.WorklogID = worklogID
			result.Error = &errorBody{
				Code: "store_failed",
				Message: "the worklog was created but could not be recorded here; " +
					"pushing again would log the time twice",
			}
			results = append(results, result)
			continue
		}

		result.Status = "pushed"
		result.WorklogID = worklogID
		results = append(results, result)
	}

	return results
}

// deleteWorklogThenEntry carries out a delete that waited for the push (CB#280).
// Jira goes first and the row only once it confirms, a 404 counting as
// confirmation: the reverse order would leave a worklog nothing here records. A
// refusal keeps the row and its mark, so the next push tries again.
func (s *Server) deleteWorklogThenEntry(
	ctx context.Context, client *jira.Client, entry store.Entry, result pushResultDTO,
) pushResultDTO {
	result.WorklogID = entry.WorklogID

	if err := client.DeleteWorklog(ctx, entry.IssueKey, entry.WorklogID); err != nil &&
		!errors.Is(err, jira.ErrNotFound) {
		result.Status = "failed"
		result.Error = instanceErrorBody(err)

		return result
	}

	// WithoutCancel for the reason the worklog record above gives. Not
	// store_failed: that code tells the reader not to push again, and here
	// pushing again is the fix.
	if err := s.db.DeleteEntry(context.WithoutCancel(ctx), entry.ID); err != nil {
		result.Status = "failed"
		result.Error = &errorBody{
			Code: "delete_unrecorded",
			Message: "the worklog was deleted in Jira but the entry could not be removed here; " +
				"pushing again finishes it",
		}

		return result
	}

	result.Status = "deleted"

	return result
}
