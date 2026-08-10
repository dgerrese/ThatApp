package jira

import "errors"

// The HTTP layer switches on these to choose a status code: an unreachable
// instance is a 502, not a 500, and rejected credentials are the user's problem
// to fix in Settings rather than a server fault.
var (
	// ErrUnauthorized means Jira rejected the credentials (401 or 403).
	ErrUnauthorized = errors.New("jira: credentials rejected")
	// ErrNotFound means the issue or worklog does not exist (404).
	ErrNotFound = errors.New("jira: not found")
	// ErrUnreachable means the instance could not be reached or failed (5xx or
	// a transport failure).
	ErrUnreachable = errors.New("jira: instance unreachable")
)
