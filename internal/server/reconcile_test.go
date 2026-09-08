package server

import (
	"testing"
	"time"

	"codeberg.org/DionGerrese/ThatApp/internal/jira"
	"codeberg.org/DionGerrese/ThatApp/internal/store"
)

func TestReconcileWorklog(t *testing.T) {
	pushedAt := time.Date(2026, 9, 8, 10, 0, 0, 0, time.UTC)

	// clean builds an entry whose updated_at does not exceed pushed_at, which is
	// what pushStateOf reads as "pushed".
	clean := func(updated time.Time) *store.Entry {
		return &store.Entry{
			ID: 1, WorklogID: "10001", PushedAt: &pushedAt, UpdatedAt: updated,
		}
	}
	dirty := func() *store.Entry {
		return &store.Entry{
			ID: 1, WorklogID: "10001", PushedAt: &pushedAt,
			UpdatedAt: pushedAt.Add(time.Minute),
		}
	}

	tests := []struct {
		name    string
		updated time.Time
		local   *store.Entry
		want    fetchAction
	}{
		{
			name:    "nothing local holds this worklog",
			updated: pushedAt,
			local:   nil,
			want:    actionCreate,
		},
		{
			name:    "the local entry has changes that were never pushed",
			updated: pushedAt.Add(time.Hour),
			local:   dirty(),
			want:    actionKeepLocal,
		},
		{
			name:    "clean, and the worklog is younger",
			updated: pushedAt.Add(time.Hour),
			local:   clean(pushedAt.Add(-time.Hour)),
			want:    actionOverwrite,
		},
		{
			name:    "clean, and the local row is younger",
			updated: pushedAt.Add(-time.Hour),
			local:   clean(pushedAt),
			want:    actionLeave,
		},
		{
			name:    "clean, and the two are the same instant",
			updated: pushedAt,
			local:   clean(pushedAt),
			want:    actionLeave,
		},
		{
			name:    "clean, and the worklog carries no update time at all",
			updated: time.Time{},
			local:   clean(pushedAt.Add(-time.Hour)),
			want:    actionLeave,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			remote := jira.RemoteWorklog{ID: "10001", IssueKey: "RID-1", Updated: test.updated}

			if got := reconcileWorklog(remote, test.local); got != test.want {
				t.Fatalf("action = %q, want %q", got, test.want)
			}
		})
	}
}
