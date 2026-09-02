package server

import (
	"testing"
	"time"

	"codeberg.org/DionGerrese/ThatApp/internal/store"
)

// entryInState builds the minimal entry that pushStateOf will read as `state`.
// updated is only meaningful for "dirty", where it must be after pushed.
func entryInState(state string) store.Entry {
	pushed := time.Date(2026, 9, 9, 10, 0, 0, 0, time.UTC)

	switch state {
	case "unpushed":
		return store.Entry{UpdatedAt: pushed}
	case "pushed":
		return store.Entry{WorklogID: "1", PushedAt: &pushed, UpdatedAt: pushed}
	case "dirty":
		return store.Entry{WorklogID: "1", PushedAt: &pushed, UpdatedAt: pushed.Add(time.Hour)}
	}

	panic("unknown state " + state)
}

func TestWorstPushState(t *testing.T) {
	cases := []struct {
		name  string
		given []string
		want  string
	}{
		{"no entries at all", nil, ""},
		{"one unpushed", []string{"unpushed"}, "unpushed"},
		{"one pushed", []string{"pushed"}, "pushed"},
		{"one dirty", []string{"dirty"}, "dirty"},
		{"all pushed", []string{"pushed", "pushed"}, "pushed"},
		{"pushed and unpushed reads unpushed", []string{"pushed", "unpushed"}, "unpushed"},
		{"unpushed and pushed, order does not matter", []string{"unpushed", "pushed"}, "unpushed"},
		{"pushed and dirty reads dirty", []string{"pushed", "dirty"}, "dirty"},
		{"dirty and unpushed reads unpushed", []string{"dirty", "unpushed"}, "unpushed"},
		{"unpushed beats dirty whatever the order", []string{"unpushed", "dirty"}, "unpushed"},
		{"all three reads unpushed", []string{"pushed", "dirty", "unpushed"}, "unpushed"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			entries := make([]store.Entry, 0, len(tc.given))
			for _, state := range tc.given {
				entries = append(entries, entryInState(state))
			}

			got := worstPushState(entries)

			if tc.want == "" {
				if got != nil {
					t.Fatalf("got %q, want nil", *got)
				}
				return
			}
			if got == nil {
				t.Fatalf("got nil, want %q", tc.want)
			}
			if *got != tc.want {
				t.Fatalf("got %q, want %q", *got, tc.want)
			}
		})
	}
}
