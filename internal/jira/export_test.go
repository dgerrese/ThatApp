package jira

import "time"

// SetClockForTest swaps the clock Retry-After dates are measured against and
// returns a func that restores it.
func SetClockForTest(clock func() time.Time) func() {
	previous := now
	now = clock
	return func() { now = previous }
}
