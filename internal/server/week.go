package server

import (
	"net/http"
	"sort"
	"time"

	"codeberg.org/DionGerrese/ThatApp/internal/store"
)

// pushStateRank orders the three derived states by how much they still need
// doing. A cell is a sum of entries that can disagree, and the marker it shows
// is the worst of them — imprecise, and never falsely reassuring, which is the
// side to err on when the reader is about to submit a timesheet.
//
// unpushed outranks dirty deliberately: dirty time is in Jira and merely stale,
// unpushed time is not there at all.
var pushStateRank = map[string]int{"pushed": 0, "dirty": 1, "unpushed": 2}

// worstPushState reports the state a cell or a day shows, or nil when it holds
// no entries at all — which is what makes the JSON field null rather than a
// fourth state the browser would have to know about.
func worstPushState(entries []store.Entry) *string {
	if len(entries) == 0 {
		return nil
	}

	worst := pushStateOf(entries[0])
	for _, entry := range entries[1:] {
		if state := pushStateOf(entry); pushStateRank[state] > pushStateRank[worst] {
			worst = state
		}
	}

	return &worst
}

// weekCellDTO is one ticket's time on one day. PushState is nil exactly when the
// cell holds no entries, which is what keeps "empty" from being a fourth state
// the browser has to know about.
type weekCellDTO struct {
	Seconds   int     `json:"seconds"`
	PushState *string `json:"pushState"`
}

type weekDayDTO struct {
	Day       string  `json:"day"`
	Seconds   int     `json:"seconds"`
	PushState *string `json:"pushState"`
}

// weekRowDTO carries the instance the way entryDTO does — id, name and the
// 0-based position instanceHue keys its dot off — so a row needs no second call
// to colour itself.
type weekRowDTO struct {
	InstanceID       int64         `json:"instanceId"`
	InstanceName     string        `json:"instanceName"`
	InstancePosition int           `json:"instancePosition"`
	IssueKey         string        `json:"issueKey"`
	Cells            []weekCellDTO `json:"cells"`
	Seconds          int           `json:"seconds"`
}

// weekRollupDTO is aggregated here rather than in the browser: the day boundary
// and the derived push state both live on this side, and sending raw entries
// would put a second copy of each in the client.
//
// Cells align to Days by position, not by key, and both are always exactly seven
// long — a client cannot then render a ragged row.
type weekRollupDTO struct {
	Start string `json:"start"`
	End   string `json:"end"`
	// The Mondays either side, so moving between weeks costs the browser no date
	// arithmetic. Sent rather than derived there for the same reason Start
	// defaults here: THAT_TIMEZONE decides where a day falls, and nothing in the
	// browser is allowed a second opinion.
	PrevStart string `json:"prevStart"`
	NextStart string `json:"nextStart"`
	// ISO 8601 week number of Start, from time.ISOWeek() — sent for the same
	// reason PrevStart and NextStart are: the browser does no calendar
	// arithmetic, and ISO week numbering goes wrong in hand-written TypeScript
	// exactly at year boundaries.
	WeekNumber int          `json:"weekNumber"`
	Days       []weekDayDTO `json:"days"`
	Rows       []weekRowDTO `json:"rows"`
	Seconds    int          `json:"seconds"`
}

const daysInWeek = 7

// weekRangeParam reads the `start` query parameter as the Monday a week begins
// on, and returns that instant with the inclusive text bounds of its week.
//
// Parsed rather than trusted: dayParam proves it is a date, not that it is a
// Monday. A start that is not one is rejected rather than snapped to its own
// week's Monday, so two different values cannot return identical bodies.
//
// Shared by the week read and the week fetch, which must agree on what a week
// is: a fetch that filtered against a different range than the grid renders
// would report time the user cannot see.
func (s *Server) weekRangeParam(
	w http.ResponseWriter, r *http.Request,
) (startAt time.Time, start, end string, ok bool) {
	today := s.now().In(s.cfg.Location)

	start, ok = dayParam(w, r, "start", mondayOf(today))
	if !ok {
		return time.Time{}, "", "", false
	}

	startAt, err := time.ParseInLocation(dayLayout, start, s.cfg.Location)
	if err != nil || startAt.Weekday() != time.Monday {
		writeError(w, http.StatusBadRequest, "start_not_monday",
			"start must be a Monday, of the form YYYY-MM-DD")
		return time.Time{}, "", "", false
	}

	return startAt, start, startAt.AddDate(0, 0, daysInWeek-1).Format(dayLayout), true
}

// handleWeek answers with a Monday-to-Sunday rollup. start defaults to the
// current week's Monday resolved in THAT_TIMEZONE, so the browser never computes
// one — the same reason handleListEntries defaults its bounds to today.
func (s *Server) handleWeek(w http.ResponseWriter, r *http.Request) {
	startAt, start, end, ok := s.weekRangeParam(w, r)
	if !ok {
		return
	}

	// Instances first — see instanceIndex on why this order is load-bearing.
	instances, positions, ok := s.instanceIndex(w, r)
	if !ok {
		return
	}

	entries, err := s.db.EntriesForDay(r.Context(), start, end)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not read the logged time")
		return
	}

	writeJSON(w, http.StatusOK, rollUp(startAt, entries, instances, positions))
}

// mondayOf is the local date of the Monday on or before t. Go's Weekday puts
// Sunday at 0, so a Sunday is six days after its Monday rather than one before
// the next — the off-by-one this exists to state once.
func mondayOf(t time.Time) string {
	back := (int(t.Weekday()) + 6) % daysInWeek

	return t.AddDate(0, 0, -back).Format(dayLayout)
}

// rowKey identifies a grid row. The same issue key in two instances is two rows,
// which is why the instance is half of the key.
type rowKey struct {
	instanceID int64
	issueKey   string
}

func rollUp(
	startAt time.Time,
	entries []store.Entry,
	instances map[int64]store.Instance,
	positions map[int64]int,
) weekRollupDTO {
	days := make([]string, daysInWeek)
	index := make(map[string]int, daysInWeek)
	for i := range days {
		days[i] = startAt.AddDate(0, 0, i).Format(dayLayout)
		index[days[i]] = i
	}

	byCell := make(map[rowKey][][]store.Entry)
	byDay := make([][]store.Entry, daysInWeek)
	for _, entry := range entries {
		at, ok := index[entry.Day]
		if !ok {
			continue
		}
		key := rowKey{instanceID: entry.InstanceID, issueKey: entry.IssueKey}
		if _, seen := byCell[key]; !seen {
			byCell[key] = make([][]store.Entry, daysInWeek)
		}
		byCell[key][at] = append(byCell[key][at], entry)
		byDay[at] = append(byDay[at], entry)
	}

	keys := make([]rowKey, 0, len(byCell))
	for key := range byCell {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		left, right := positions[keys[i].instanceID], positions[keys[j].instanceID]
		if left != right {
			return left < right
		}

		return keys[i].issueKey < keys[j].issueKey
	})

	_, weekNumber := startAt.ISOWeek()

	rollup := weekRollupDTO{
		Start:      days[0],
		End:        days[daysInWeek-1],
		PrevStart:  startAt.AddDate(0, 0, -daysInWeek).Format(dayLayout),
		NextStart:  startAt.AddDate(0, 0, daysInWeek).Format(dayLayout),
		WeekNumber: weekNumber,
		Days:       make([]weekDayDTO, daysInWeek),
		Rows:       make([]weekRowDTO, 0, len(keys)),
	}

	for i, day := range days {
		seconds := 0
		for _, entry := range byDay[i] {
			seconds += entry.Seconds
		}
		rollup.Days[i] = weekDayDTO{Day: day, Seconds: seconds, PushState: worstPushState(byDay[i])}
		rollup.Seconds += seconds
	}

	for _, key := range keys {
		row := weekRowDTO{
			InstanceID:       key.instanceID,
			InstanceName:     instances[key.instanceID].Name,
			InstancePosition: positions[key.instanceID],
			IssueKey:         key.issueKey,
			Cells:            make([]weekCellDTO, daysInWeek),
		}
		for i, cell := range byCell[key] {
			seconds := 0
			for _, entry := range cell {
				seconds += entry.Seconds
			}
			row.Cells[i] = weekCellDTO{Seconds: seconds, PushState: worstPushState(cell)}
			row.Seconds += seconds
		}
		rollup.Rows = append(rollup.Rows, row)
	}

	return rollup
}
