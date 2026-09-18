package jira

import (
	"errors"
	"time"
)

// The HTTP layer switches on these to choose a status code: an unreachable
// instance is a 502, not a 500, and rejected credentials are the user's problem
// to fix in Settings rather than a server fault.
var (
	// ErrUnauthorized means Jira rejected the credentials (401).
	ErrUnauthorized = errors.New("jira: credentials rejected")
	// ErrForbidden means the credentials were accepted but this account may not
	// do this (403) — a permission, not a login, problem.
	ErrForbidden = errors.New("jira: permission denied")
	// ErrRateLimited means Jira asked the caller to slow down (429). The error
	// statusError returns is a *RateLimitError carrying how long to wait.
	ErrRateLimited = errors.New("jira: rate limited")
	// ErrNotFound means the issue or worklog does not exist (404).
	ErrNotFound = errors.New("jira: not found")
	// ErrUnreachable means the instance could not be reached or failed (5xx or
	// a transport failure).
	ErrUnreachable = errors.New("jira: instance unreachable")
)

// RateLimitError is a 429. Wait is how long Jira asked the caller to wait; zero
// when it gave no usable Retry-After.
type RateLimitError struct {
	Wait time.Duration
}

func (e *RateLimitError) Error() string { return ErrRateLimited.Error() }

func (e *RateLimitError) Unwrap() error { return ErrRateLimited }
