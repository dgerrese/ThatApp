package jira

import (
	"testing"
)

// A quote in the query would otherwise close the JQL string literal early and
// turn the rest of it into syntax.
func TestEscapeJQLEscapesQuotesAndBackslashes(t *testing.T) {
	tests := []struct {
		name  string
		query string
		want  string
	}{
		{"plain", `security`, `security`},
		{"quote", `He said "hi"`, `He said \"hi\"`},
		{"backslash", `a\b`, `a\\b`},
		{"both", `a\"b`, `a\\\"b`},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := escapeJQL(tc.query); got != tc.want {
				t.Errorf("escapeJQL(%q) = %q, want %q", tc.query, got, tc.want)
			}
		})
	}
}
