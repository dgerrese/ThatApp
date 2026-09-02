package server

import "codeberg.org/DionGerrese/ThatApp/internal/store"

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
