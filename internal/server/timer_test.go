package server

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
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

func decodeStartTimer(t *testing.T, rec *httptest.ResponseRecorder) startTimerResponse {
	t.Helper()

	var body startTimerResponse
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
	rec = callEntries(t, srv, http.MethodPost, "/api/timer/stop",
		`{"round":"up","comment":"Traced the export"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("stop status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	stopped := decodeStopTimer(t, rec)
	if stopped.Discarded {
		t.Errorf("discarded = true, want false; the run was 25 minutes rounded up")
	}
	if stopped.Stopped == nil {
		t.Fatalf("stopped = nil, want the logged entry")
	}
	if stopped.Stopped.Seconds != 1800 {
		t.Errorf("seconds = %d, want %d; 25 minutes rounds up to the next 15-minute step", stopped.Stopped.Seconds, 1800)
	}
	if stopped.Stopped.Comment != "Traced the export" {
		t.Errorf("comment = %q, want %q", stopped.Stopped.Comment, "Traced the export")
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

// TestStopTimerRoundedDownUnderFifteenMinutesDiscardsIt is the dialog's other
// destructive path: "down" on a run short of the grid throws it away, which is
// why the dialog must name the discard rather than round silently to zero.
func TestStopTimerRoundedDownUnderFifteenMinutesDiscardsIt(t *testing.T) {
	start := time.Date(2026, 8, 21, 12, 5, 0, 0, time.UTC)
	srv, db, inst := serverInZone(t, "Europe/Amsterdam", start)

	rec := callEntries(t, srv, http.MethodPost, "/api/timer/start",
		`{"instanceId":`+strconv.FormatInt(inst.ID, 10)+`,"issueKey":"RIDGE-4929"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("start status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	srv.now = func() time.Time { return start.Add(7 * time.Minute) }
	rec = callEntries(t, srv, http.MethodPost, "/api/timer/stop", `{"round":"down"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("stop status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	stopped := decodeStopTimer(t, rec)
	if !stopped.Discarded {
		t.Errorf("discarded = false, want true; 7 minutes rounded down floors to zero")
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

	rec := callEntries(t, srv, http.MethodPost, "/api/timer/stop", `{"round":"down"}`)

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

// TestStopTimerRejectsAMissingOrUnknownRound covers the 400 the dialog exists
// to force: a stop that names no direction, or one the store would not
// recognise, must refuse rather than default — and must leave the timer
// running so the user can still confirm it properly.
func TestStopTimerRejectsAMissingOrUnknownRound(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{"empty body", ""},
		{"empty object", "{}"},
		{"unknown direction", `{"round":"sideways"}`},
		{"wrong case", `{"round":"UP"}`},
		{"malformed json", "{"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			start := time.Date(2026, 8, 21, 12, 5, 0, 0, time.UTC)
			srv, _, inst := serverInZone(t, "Europe/Amsterdam", start)

			rec := callEntries(t, srv, http.MethodPost, "/api/timer/start",
				`{"instanceId":`+strconv.FormatInt(inst.ID, 10)+`,"issueKey":"RIDGE-4929"}`)
			if rec.Code != http.StatusOK {
				t.Fatalf("start status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
			}

			rec = callEntries(t, srv, http.MethodPost, "/api/timer/stop", test.body)
			assertRejected(t, rec, http.StatusBadRequest, "invalid_request")

			rec = callEntries(t, srv, http.MethodGet, "/api/timer", "")
			got := decodeTimerState(t, rec)
			if got.Running == nil || got.Running.IssueKey != "RIDGE-4929" {
				t.Errorf("running = %+v after a rejected stop, want RIDGE-4929 still running", got.Running)
			}
		})
	}
}

// TestStartTimerSwitchesFromTheRunningOne: starting a second timer stops the
// first, as StopTimer would, and the switch's start reports the first
// timer's entry as "stopped" — the same design property #8 draws for the row
// control and the rail alike. The rounding and comment are the second
// timer's stop dialog choice, applied to the first timer's run.
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
		`{"instanceId":`+strconv.FormatInt(inst.ID, 10)+`,"issueKey":"SECOND-2","round":"up","comment":"Paired on it"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("second start status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	switched := decodeStartTimer(t, rec)
	if switched.Discarded {
		t.Errorf("discarded = true, want false; 5 minutes rounds up to 15")
	}
	if switched.Running == nil || switched.Running.IssueKey != "SECOND-2" {
		t.Errorf("running = %+v, want SECOND-2", switched.Running)
	}
	if switched.Stopped == nil {
		t.Fatalf("stopped = nil, want the first timer's entry")
	}
	if switched.Stopped.IssueKey != "FIRST-1" || switched.Stopped.Seconds != 900 {
		t.Errorf("stopped = %+v, want FIRST-1 at %d seconds", switched.Stopped, 900)
	}
	if switched.Stopped.Comment != "Paired on it" {
		t.Errorf("comment = %q, want %q", switched.Stopped.Comment, "Paired on it")
	}
}

// TestStartTimerSwitchRoundedDownToZeroDiscards mirrors the stop dialog's
// discard path, reached through a switch instead of a plain stop.
func TestStartTimerSwitchRoundedDownToZeroDiscards(t *testing.T) {
	start := time.Date(2026, 8, 21, 12, 5, 0, 0, time.UTC)
	srv, _, inst := serverInZone(t, "Europe/Amsterdam", start)

	rec := callEntries(t, srv, http.MethodPost, "/api/timer/start",
		`{"instanceId":`+strconv.FormatInt(inst.ID, 10)+`,"issueKey":"FIRST-1"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("first start status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	srv.now = func() time.Time { return start.Add(5 * time.Minute) }
	rec = callEntries(t, srv, http.MethodPost, "/api/timer/start",
		`{"instanceId":`+strconv.FormatInt(inst.ID, 10)+`,"issueKey":"SECOND-2","round":"down"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("second start status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	switched := decodeStartTimer(t, rec)
	if !switched.Discarded {
		t.Errorf("discarded = false, want true; 5 minutes rounded down floors to zero")
	}
	if switched.Stopped != nil {
		t.Errorf("stopped = %+v, want nil; a discarded switch logs nothing", switched.Stopped)
	}
	if switched.Running == nil || switched.Running.IssueKey != "SECOND-2" {
		t.Errorf("running = %+v, want SECOND-2", switched.Running)
	}
}

// TestStartTimerWithATimerRunningAndNoRoundIsRefused is the switch's half of
// the same 400 the stop dialog forces: a second start cannot silently decide
// how the first timer's run lands.
func TestStartTimerWithATimerRunningAndNoRoundIsRefused(t *testing.T) {
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
	assertRejected(t, rec, http.StatusBadRequest, "invalid_request")

	rec = callEntries(t, srv, http.MethodGet, "/api/timer", "")
	got := decodeTimerState(t, rec)
	if got.Running == nil || got.Running.IssueKey != "FIRST-1" {
		t.Errorf("running = %+v after a refused switch, want FIRST-1 still running", got.Running)
	}
}

// TestStartTimerWithNothingRunningIgnoresTheChoice: starting the first timer
// of the day has nothing to close, so a rounding or comment meant for that
// close is simply unused rather than rejected.
func TestStartTimerWithNothingRunningIgnoresTheChoice(t *testing.T) {
	srv, _, inst := serverInZone(t, "Europe/Amsterdam",
		time.Date(2026, 8, 21, 12, 5, 0, 0, time.UTC))

	rec := callEntries(t, srv, http.MethodPost, "/api/timer/start",
		`{"instanceId":`+strconv.FormatInt(inst.ID, 10)+`,"issueKey":"RIDGE-4929","round":"down","comment":"x"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("start status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	started := decodeStartTimer(t, rec)
	if started.Discarded {
		t.Errorf("discarded = true, want false; nothing was running to close")
	}
	if started.Running == nil || started.Running.IssueKey != "RIDGE-4929" {
		t.Errorf("running = %+v, want RIDGE-4929", started.Running)
	}
	if started.Stopped != nil {
		t.Errorf("stopped = %+v, want nil", started.Stopped)
	}
}

// TestStartTimerRejectsAnUnknownRound covers the same 400 as the stop
// endpoint, reached with nothing running: a malformed round is refused
// whether or not it would even be used.
func TestStartTimerRejectsAnUnknownRound(t *testing.T) {
	srv, _, inst := serverInZone(t, "Europe/Amsterdam",
		time.Date(2026, 8, 21, 12, 5, 0, 0, time.UTC))

	rec := callEntries(t, srv, http.MethodPost, "/api/timer/start",
		`{"instanceId":`+strconv.FormatInt(inst.ID, 10)+`,"issueKey":"RIDGE-4929","round":"sideways"}`)

	assertRejected(t, rec, http.StatusBadRequest, "invalid_request")
}

// TestTimerReportsTheRunningInstancesNameAndPosition pins that the rail can
// draw a split slice for the running instance's colour without a second
// fetch: both the start response and GET /api/timer answer its name and
// 0-based position, joined the same way entryDTO joins them.
func TestTimerReportsTheRunningInstancesNameAndPosition(t *testing.T) {
	s, db, sealer := newServerWithStore(t)
	loc, err := time.LoadLocation("Europe/Amsterdam")
	if err != nil {
		t.Fatalf("loading zone: %v", err)
	}
	s.cfg.Location = loc
	s.now = func() time.Time { return time.Date(2026, 8, 21, 12, 5, 0, 0, time.UTC) }

	seedInstance(t, db, sealer, "First", "", "https://api.example")
	second := seedInstance(t, db, sealer, "Second", "", "https://api.example")

	rec := callEntries(t, s, http.MethodPost, "/api/timer/start",
		`{"instanceId":`+strconv.FormatInt(second.ID, 10)+`,"issueKey":"RIDGE-4929"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("start status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	started := decodeTimerState(t, rec)
	if started.Running == nil {
		t.Fatalf("running = nil, want the started timer")
	}
	if started.Running.InstanceName != "Second" || started.Running.InstancePosition != 1 {
		t.Errorf("start running = %+v, want name Second, position 1", started.Running)
	}

	rec = callEntries(t, s, http.MethodGet, "/api/timer", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("get status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	got := decodeTimerState(t, rec)
	if got.Running == nil {
		t.Fatalf("running = nil, want the started timer")
	}
	if got.Running.InstanceName != "Second" || got.Running.InstancePosition != 1 {
		t.Errorf("get running = %+v, want name Second, position 1", got.Running)
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

// TestAStoppedTimersCommentReachesJiraOnPush is the acceptance criterion the
// whole ticket serves: the description typed in the stop dialog must arrive at
// Jira as the worklog's comment, and a blank one must omit the field entirely
// rather than send an empty comment node, exactly as internal/jira/worklog.go's
// createRequest already does for a manual entry.
func TestAStoppedTimersCommentReachesJiraOnPush(t *testing.T) {
	tests := []struct {
		name        string
		comment     string
		wantComment bool
	}{
		{"a comment reaches Jira as the worklog comment", "Traced the export", true},
		{"a blank comment omits the Jira field entirely", "", false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var worklogBody []byte
			jiraSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodPost && strings.Contains(r.URL.Path, "/worklog") {
					worklogBody, _ = io.ReadAll(r.Body)
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusCreated)
					_ = json.NewEncoder(w).Encode(map[string]string{"id": "wl-1"})
					return
				}
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write([]byte(`{}`))
			}))
			t.Cleanup(jiraSrv.Close)

			s, db, sealer := newServerWithStore(t)
			inst := seedInstance(t, db, sealer, "Work", "", jiraSrv.URL)

			loc, err := time.LoadLocation("Europe/Amsterdam")
			if err != nil {
				t.Fatalf("loading zone: %v", err)
			}
			s.cfg.Location = loc

			start := time.Date(2026, 8, 21, 12, 5, 0, 0, time.UTC)
			s.now = func() time.Time { return start }

			rec := callEntries(t, s, http.MethodPost, "/api/timer/start",
				`{"instanceId":`+strconv.FormatInt(inst.ID, 10)+`,"issueKey":"RIDGE-4929"}`)
			if rec.Code != http.StatusOK {
				t.Fatalf("start status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
			}

			s.now = func() time.Time { return start.Add(20 * time.Minute) }
			rec = callEntries(t, s, http.MethodPost, "/api/timer/stop",
				`{"round":"up","comment":"`+test.comment+`"}`)
			if rec.Code != http.StatusOK {
				t.Fatalf("stop status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body.String())
			}
			stopped := decodeStopTimer(t, rec)
			if stopped.Stopped == nil {
				t.Fatalf("stopped = nil, want the logged entry")
			}

			pushDay(t, s, stopped.Stopped.Day)

			var fields map[string]json.RawMessage
			if err := json.Unmarshal(worklogBody, &fields); err != nil {
				t.Fatalf("decoding worklog body %s: %v", worklogBody, err)
			}
			_, hasComment := fields["comment"]
			if hasComment != test.wantComment {
				t.Errorf("worklog body carries a comment key = %v, want %v; body %s",
					hasComment, test.wantComment, worklogBody)
			}
			if test.wantComment && !strings.Contains(string(worklogBody), test.comment) {
				t.Errorf("worklog body %s does not contain %q", worklogBody, test.comment)
			}
		})
	}
}
