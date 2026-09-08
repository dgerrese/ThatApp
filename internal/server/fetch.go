package server

import (
	"context"
	"net/http"
	"sort"
	"time"

	"codeberg.org/DionGerrese/ThatApp/internal/store"
)

// fetchInstanceTimeout bounds one instance's whole sequence — the identity call,
// the search, and one worklog read per issue found — rather than a single call,
// which jira.Client already bounds itself.
const fetchInstanceTimeout = 2 * time.Minute

// fetchSlackDays is the day either side of the week that the search asks for.
//
// JQL's worklogDate resolves against the Jira server's timezone rather than the
// user's, so a worklog at a week boundary can be a day out in the search. Asking
// wide and filtering locally on the real start makes the boundary this app's own,
// which is the rule the rest of the system already follows.
const fetchSlackDays = 1

type keptLocalDTO struct {
	Day        string `json:"day"`
	IssueKey   string `json:"issueKey"`
	InstanceID int64  `json:"instanceId"`
}

type fetchFailureDTO struct {
	InstanceID   int64     `json:"instanceId"`
	InstanceName string    `json:"instanceName"`
	Error        errorBody `json:"error"`
}

type fetchResponseDTO struct {
	Start     string            `json:"start"`
	End       string            `json:"end"`
	Created   int               `json:"created"`
	Updated   int               `json:"updated"`
	KeptLocal []keptLocalDTO    `json:"keptLocal"`
	Failures  []fetchFailureDTO `json:"failures"`
}

// fetchOutcome is one instance's contribution, before they are summed.
type fetchOutcome struct {
	created   int
	updated   int
	keptLocal []keptLocalDTO
	failure   *fetchFailureDTO
}

// handleFetchWeek pulls a week's worklogs into local entries.
//
// It answers 200 whenever the week could be read: an instance refusing the call
// is data about that instance, not a failure of this request, and the instances
// that answered still applied their results.
func (s *Server) handleFetchWeek(w http.ResponseWriter, r *http.Request) {
	// The same lock the push takes, for the same reason in mirror image. A push
	// creating a worklog for a local entry while a fetch is creating a local
	// entry for that same worklog would leave the time recorded twice, and
	// neither side can see the other's half-finished work.
	s.pushMu.Lock()
	defer s.pushMu.Unlock()

	startAt, start, end, ok := s.weekRangeParam(w, r)
	if !ok {
		return
	}

	instances, err := s.db.Instances(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed",
			"could not read the stored instances")
		return
	}

	// The window handed to Jira, in instants: from the start of the slack day
	// before the week to the start of the slack day after it. Both are resolved
	// in the configured zone, so the boundary is the user's midnight rather than
	// the container's.
	after := startAt.AddDate(0, 0, -fetchSlackDays)
	before := startAt.AddDate(0, 0, daysInWeek+fetchSlackDays)

	searchFrom := after.Format(dayLayout)
	searchTo := before.AddDate(0, 0, -1).Format(dayLayout)

	outcomes := fanOutInstances(r.Context(), instances, fetchInstanceTimeout,
		func(ctx context.Context, inst store.Instance) fetchOutcome {
			return s.fetchInstanceWeek(ctx, inst, fetchWindow{
				start: start, end: end,
				searchFrom: searchFrom, searchTo: searchTo,
				after: after, before: before,
			})
		})

	body := fetchResponseDTO{
		Start: start, End: end,
		KeptLocal: []keptLocalDTO{}, Failures: []fetchFailureDTO{},
	}
	for _, outcome := range outcomes {
		body.Created += outcome.created
		body.Updated += outcome.updated
		body.KeptLocal = append(body.KeptLocal, outcome.keptLocal...)
		if outcome.failure != nil {
			body.Failures = append(body.Failures, *outcome.failure)
		}
	}

	// Sorted so the report reads in the order the week does, and so a test
	// asserts on an order rather than on whichever instance answered first.
	sort.Slice(body.KeptLocal, func(i, j int) bool {
		if body.KeptLocal[i].Day != body.KeptLocal[j].Day {
			return body.KeptLocal[i].Day < body.KeptLocal[j].Day
		}

		return body.KeptLocal[i].IssueKey < body.KeptLocal[j].IssueKey
	})

	writeJSON(w, http.StatusOK, body)
}

// fetchWindow carries the week twice over: as the text bounds an entry's day is
// checked against, and as the instants Jira's search and reads are given.
type fetchWindow struct {
	start, end           string
	searchFrom, searchTo string
	after, before        time.Time
}

// fetchInstanceWeek reads and reconciles one instance. It never returns an
// error — a refusal is the outcome, reported beside the instances that worked.
func (s *Server) fetchInstanceWeek(
	ctx context.Context, inst store.Instance, window fetchWindow,
) fetchOutcome {
	// Declared before any call can fail, and closed over by fail below, so a
	// failure midway through the loop reports what this instance already
	// wrote rather than discarding it. Without this, a second issue's read
	// failing after the first issue's worklogs had already been created would
	// report the instance as having created nothing — wrong, and in exactly
	// the way CLAUDE.md asks a push failure not to be: silent about what did
	// land.
	outcome := fetchOutcome{keptLocal: []keptLocalDTO{}}

	fail := func(err error) fetchOutcome {
		outcome.failure = &fetchFailureDTO{
			InstanceID: inst.ID, InstanceName: inst.Name, Error: *instanceErrorBody(err),
		}

		return outcome
	}

	client, err := s.clients.forInstance(ctx, &inst)
	if err != nil {
		return fail(err)
	}

	// Whose worklogs to keep. The search asks Jira for the current user's, but
	// the per-issue read answers with every author's, so the account has to be
	// known here to filter on.
	me, err := client.Myself(ctx)
	if err != nil {
		return fail(err)
	}

	keys, err := client.IssuesWithWorklogsBetween(ctx, window.searchFrom, window.searchTo)
	if err != nil {
		return fail(err)
	}

	local, err := s.db.EntriesWithWorklogs(ctx, inst.ID)
	if err != nil {
		return fail(err)
	}

	now := s.now().UTC()

	for _, key := range keys {
		worklogs, err := client.IssueWorklogs(ctx, key, window.after, window.before)
		if err != nil {
			return fail(err)
		}

		for _, remote := range worklogs {
			if remote.AuthorID != me.AccountID {
				continue
			}

			// The day the entry belongs to is the user's, resolved here, which
			// is what makes the slack day either side harmless: a worklog the
			// wide search caught but the week does not hold is dropped.
			day := remote.Started.In(s.cfg.Location).Format(dayLayout)
			if day < window.start || day > window.end {
				continue
			}

			var claimed *store.Entry
			if entry, held := local[remote.ID]; held {
				claimed = &entry
			}

			// claimed is looked up by worklog_id, so it can never be unpushed —
			// reconcileWorklog only ever sees it as dirty or clean.
			switch reconcileWorklog(remote, claimed) {
			case actionCreate:
				if _, err := s.db.CreateFetchedEntry(ctx, store.EntryInput{
					InstanceID: inst.ID, IssueKey: remote.IssueKey, Day: day,
					StartedAt: remote.Started, Seconds: int(remote.Seconds),
					Comment: remote.Comment,
				}, remote.ID, now); err != nil {
					return fail(err)
				}
				outcome.created++

			case actionOverwrite:
				if err := s.db.OverwriteEntryFromWorklog(ctx, claimed.ID, day,
					remote.Started, int(remote.Seconds), remote.Comment, now); err != nil {
					return fail(err)
				}
				outcome.updated++

			case actionKeepLocal:
				outcome.keptLocal = append(outcome.keptLocal, keptLocalDTO{
					Day: claimed.Day, IssueKey: claimed.IssueKey, InstanceID: inst.ID,
				})

			case actionLeave:
			}
		}
	}

	return outcome
}
