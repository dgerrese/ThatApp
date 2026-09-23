package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"codeberg.org/DionGerrese/ThatApp/internal/store"
)

func decodeTimerState(t *testing.T, rec *httptest.ResponseRecorder) timerStateResponse {
	t.Helper()

	var body timerStateResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decoding %s: %v", rec.Body.String(), err)
	}

	return body
}

func decodeStopTimer(t *testing.T, rec *httptest.ResponseRecorder) stopTimerResponse {
	t.Helper()

	var body stopTimerResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decoding %s: %v", rec.Body.String(), err)
	}

	return body
}

func TestGetTimerWithNothingRunningIsEmpty(t *testing.T) {
	srv, _, _ := serverInZone(t, "Europe/Amsterdam",
		time.Date(2026, 8, 21, 12, 5, 0, 0, time.UTC))

	rec := callEntries(t, srv, http.MethodGet, "/api/timer", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	body := decodeTimerState(t, rec)
	if body.Running != nil || body.Stopped != nil {
		t.Errorf("body = %+v, want both nil", body)
	}
}

func TestStartTimerThenGetReportsIt(t *testing.T) {
	srv, _, inst := serverInZone(t, "Europe/Amsterdam",
		time.Date(2026, 8, 21, 12, 5, 0, 0, time.UTC))

	rec := callEntries(t, srv, http.MethodPost, "/api/timer/start",
		`{"instanceId":`+strconv.FormatInt(inst.ID, 10)+`,"issueKey":"RIDGE-4929"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("start status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	started := decodeTimerState(t, rec)
	if started.Running == nil {
		t.Fatalf("running = nil, want the started timer")
	}
	if started.Running.InstanceID != inst.ID || started.Running.IssueKey != "RIDGE-4929" {
		t.Errorf("running = %+v, want instance %d / RIDGE-4929", started.Running, inst.ID)
	}
	if started.Running.StartedAt != "2026-08-21T14:05:00+02:00" {
		t.Errorf("startedAt = %q, want the clock's instant in the configured zone", started.Running.StartedAt)
	}
	if started.Stopped != nil {
		t.Errorf("stopped = %+v, want nil; nothing was running to switch away from", started.Stopped)
	}

	rec = callEntries(t, srv, http.MethodGet, "/api/timer", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("get status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	got := decodeTimerState(t, rec)
	if got.Running == nil || *got.Running != *started.Running {
		t.Errorf("get running = %+v, want %+v", got.Running, started.Running)
	}
}

// TestStopTimerAfter25MinutesLogsTheEntry pins the DTO the brief asks to
// prove: the entry the stop reports must match, field for field, what
// GET /api/entries renders for the same day.
func TestStopTimerAfter25MinutesLogsTheEntry(t *testing.T) {
	start := time.Date(2026, 8, 21, 12, 5, 0, 0, time.UTC)
	srv, _, inst := serverInZone(t, "Europe/Amsterdam", start)

	rec := callEntries(t, srv, http.MethodPost, "/api/timer/start",
		`{"instanceId":`+strconv.FormatInt(inst.ID, 10)+`,"issueKey":"RIDGE-4929"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("start status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	srv.now = func() time.Time { return start.Add(25 * time.Minute) }
	rec = callEntries(t, srv, http.MethodPost, "/api/timer/stop", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("stop status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	stopped := decodeStopTimer(t, rec)
	if stopped.Discarded {
		t.Errorf("discarded = true, want false; the run was 25 minutes")
	}
	if stopped.Stopped == nil {
		t.Fatalf("stopped = nil, want the logged entry")
	}
	if stopped.Stopped.Seconds != 25*60 {
		t.Errorf("seconds = %d, want %d", stopped.Stopped.Seconds, 25*60)
	}
	if stopped.Stopped.IssueKey != "RIDGE-4929" || stopped.Stopped.InstanceID != inst.ID {
		t.Errorf("stopped entry = %+v, want RIDGE-4929 on instance %d", stopped.Stopped, inst.ID)
	}

	// GET /api/timer now reports nothing running.
	rec = callEntries(t, srv, http.MethodGet, "/api/timer", "")
	got := decodeTimerState(t, rec)
	if got.Running != nil {
		t.Errorf("running = %+v after stop, want nil", got.Running)
	}

	// The entry DTO the stop reported must match what /api/entries renders for
	// the same day — a timer-made entry is indistinguishable from a manual one.
	rec = callEntries(t, srv, http.MethodGet, "/api/entries", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("entries status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	listed := decodeEntries(t, rec)
	if len(listed) != 1 {
		t.Fatalf("got %d entries, want 1; body %s", len(listed), rec.Body.String())
	}
	if listed[0] != *stopped.Stopped {
		t.Errorf("GET /api/entries = %+v, want it to match the stop's entry %+v",
			listed[0], *stopped.Stopped)
	}
}

func TestStopTimerUnderAMinuteDiscardsIt(t *testing.T) {
	start := time.Date(2026, 8, 21, 12, 5, 0, 0, time.UTC)
	srv, db, inst := serverInZone(t, "Europe/Amsterdam", start)

	rec := callEntries(t, srv, http.MethodPost, "/api/timer/start",
		`{"instanceId":`+strconv.FormatInt(inst.ID, 10)+`,"issueKey":"RIDGE-4929"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("start status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	srv.now = func() time.Time { return start.Add(30 * time.Second) }
	rec = callEntries(t, srv, http.MethodPost, "/api/timer/stop", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("stop status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	stopped := decodeStopTimer(t, rec)
	if !stopped.Discarded {
		t.Errorf("discarded = false, want true; the run was under a minute")
	}
	if stopped.Stopped != nil {
		t.Errorf("stopped = %+v, want nil; a discarded run logs nothing", stopped.Stopped)
	}
	if len(allEntries(t, db)) != 0 {
		t.Errorf("stored entries after a discarded stop, want none")
	}
}

func TestStopTimerWithNothingRunningIsNotAnError(t *testing.T) {
	srv, _, _ := serverInZone(t, "Europe/Amsterdam",
		time.Date(2026, 8, 21, 12, 5, 0, 0, time.UTC))

	rec := callEntries(t, srv, http.MethodPost, "/api/timer/stop", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	stopped := decodeStopTimer(t, rec)
	if stopped.Discarded {
		t.Errorf("discarded = true, want false; nothing was running")
	}
	if stopped.Stopped != nil {
		t.Errorf("stopped = %+v, want nil", stopped.Stopped)
	}
}

// TestStartTimerSwitchesFromTheRunningOne: starting a second timer stops the
// first, as StopTimer would, and the switch's start reports the first
// timer's entry as "stopped" — the same design property #8 draws for the row
// control and the rail alike.
func TestStartTimerSwitchesFromTheRunningOne(t *testing.T) {
	start := time.Date(2026, 8, 21, 12, 5, 0, 0, time.UTC)
	srv, _, inst := serverInZone(t, "Europe/Amsterdam", start)

	rec := callEntries(t, srv, http.MethodPost, "/api/timer/start",
		`{"instanceId":`+strconv.FormatInt(inst.ID, 10)+`,"issueKey":"FIRST-1"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("first start status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	srv.now = func() time.Time { return start.Add(5 * time.Minute) }
	rec = callEntries(t, srv, http.MethodPost, "/api/timer/start",
		`{"instanceId":`+strconv.FormatInt(inst.ID, 10)+`,"issueKey":"SECOND-2"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("second start status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	switched := decodeTimerState(t, rec)
	if switched.Running == nil || switched.Running.IssueKey != "SECOND-2" {
		t.Errorf("running = %+v, want SECOND-2", switched.Running)
	}
	if switched.Stopped == nil {
		t.Fatalf("stopped = nil, want the first timer's entry")
	}
	if switched.Stopped.IssueKey != "FIRST-1" || switched.Stopped.Seconds != 5*60 {
		t.Errorf("stopped = %+v, want FIRST-1 at %d seconds", switched.Stopped, 5*60)
	}
}

// TestGetTimerClosesAnOvernightTimer pins decision 6: a read that finds a
// timer whose start day has passed closes it at its start day's local
// midnight and reports the entry it earned as "stopped", with nothing running.
func TestGetTimerClosesAnOvernightTimer(t *testing.T) {
	const zone = "Europe/Amsterdam"
	loc, err := time.LoadLocation(zone)
	if err != nil {
		t.Fatalf("loading zone %q: %v", zone, err)
	}
	start := time.Date(2026, 8, 21, 22, 0, 0, 0, time.UTC) // 2026-08-22 00:00 +02:00 local
	srv, db, inst := serverInZone(t, zone, start)

	if _, _, _, err := db.StartTimer(t.Context(), inst.ID, "OVERNIGHT-1", start, loc, store.TimerClose{}); err != nil {
		t.Fatalf("seeding the running timer: %v", err)
	}

	// 25 hours later is still deep in local day 23, well past local midnight of
	// the 22nd — the start day the timer must close against.
	nextDay := start.Add(25 * time.Hour)
	srv.now = func() time.Time { return nextDay }

	rec := callEntries(t, srv, http.MethodGet, "/api/timer", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	got := decodeTimerState(t, rec)
	if got.Running != nil {
		t.Errorf("running = %+v, want nil; the overnight timer should have closed", got.Running)
	}
	if got.Stopped == nil {
		t.Fatalf("stopped = nil, want the entry the midnight close earned")
	}
	if got.Stopped.IssueKey != "OVERNIGHT-1" || got.Stopped.Day != "2026-08-22" {
		t.Errorf("stopped = %+v, want OVERNIGHT-1 on 2026-08-22", got.Stopped)
	}
}

func TestStartTimerRejectsABlankKey(t *testing.T) {
	srv, _, inst := serverInZone(t, "Europe/Amsterdam",
		time.Date(2026, 8, 21, 12, 5, 0, 0, time.UTC))

	rec := callEntries(t, srv, http.MethodPost, "/api/timer/start",
		`{"instanceId":`+strconv.FormatInt(inst.ID, 10)+`,"issueKey":"  "}`)

	assertRejected(t, rec, http.StatusBadRequest, "invalid_request")
}

func TestStartTimerRejectsAMalformedBody(t *testing.T) {
	srv, _, _ := serverInZone(t, "Europe/Amsterdam",
		time.Date(2026, 8, 21, 12, 5, 0, 0, time.UTC))

	rec := callEntries(t, srv, http.MethodPost, "/api/timer/start", `{`)

	assertRejected(t, rec, http.StatusBadRequest, "invalid_request")
}

func TestStartTimerRejectsAnUnknownInstance(t *testing.T) {
	srv, _, _ := serverInZone(t, "Europe/Amsterdam",
		time.Date(2026, 8, 21, 12, 5, 0, 0, time.UTC))

	rec := callEntries(t, srv, http.MethodPost, "/api/timer/start",
		`{"instanceId":404,"issueKey":"RIDGE-4929"}`)

	assertRejected(t, rec, http.StatusNotFound, "instance_not_found")
}
