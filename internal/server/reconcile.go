package server

import (
	"codeberg.org/DionGerrese/ThatApp/internal/jira"
	"codeberg.org/DionGerrese/ThatApp/internal/store"
)

// fetchAction is what one remote worklog does to local state. A string rather
// than an int so a failing test names the action rather than an ordinal.
type fetchAction string

const (
	// actionCreate: no local entry claims this worklog, so it becomes one.
	actionCreate fetchAction = "create"
	// actionOverwrite: the local entry is clean and older, so Jira's copy wins.
	actionOverwrite fetchAction = "overwrite"
	// actionKeepLocal: the local entry carries an edit that was never pushed.
	// Nothing is touched, and the report names it — the user is the only one who
	// can choose between the two texts.
	actionKeepLocal fetchAction = "keep-local"
	// actionLeave: the local entry is clean and nothing about the worklog is
	// newer, so there is nothing to do and nothing to report.
	actionLeave fetchAction = "leave"
)

// reconcileWorklog decides what one worklog does to the entry that claims it.
//
// Youngest wins, with two deliberate exceptions.
//
// A dirty entry always wins, whatever the timestamps say. Following youngest-wins
// there would discard an edit the user typed and never sent, which is the one
// outcome no synchronisation rule is worth — so youngest-wins applies only where
// nothing local is at stake.
//
// Where the two cannot be ordered, local leads. The timestamps come from two
// clocks — this machine's and the Jira server's — so equal values, a missing
// remote timestamp, or any skew that makes the comparison meaningless all fall
// the same way: do nothing, because doing nothing is the reversible choice.
func reconcileWorklog(remote jira.RemoteWorklog, local *store.Entry) fetchAction {
	if local == nil {
		return actionCreate
	}

	if pushStateOf(*local) == "dirty" {
		return actionKeepLocal
	}

	if remote.Updated.IsZero() || !remote.Updated.After(local.UpdatedAt) {
		return actionLeave
	}

	return actionOverwrite
}
