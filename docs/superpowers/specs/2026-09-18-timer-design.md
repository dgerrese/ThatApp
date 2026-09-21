# Timer (#8) — design

**Date:** 2026-09-18
**Supersedes:** nothing
**Superseded by:** nothing

The design of record (`2026-08-04-thatapp-design.md`) already fixes the rules: one timer at a time,
stopping creates a new entry, timer state lives on the server, and `timers` exists in the schema with
`CHECK (id = 1)`. Issue #8 adds the midnight cap. This document records what the design session and
the owner settled on 2026-09-18, and how the parts fit.

## Decisions (owner, 2026-09-18)

1. **Row control:** a play/stop icon button in each Today row's action column, beside the pin (option
   A of the session). It is always visible and muted at rest, like the pin. Every Today table gets it
   (Pinned, Off-list and each instance card). Week gets none.
2. **Marks:** play is a rounded triangle and stop a rounded square, in the house icon stroke (1.9,
   round caps and joins).
3. **Running row:** the stop button, the key and the Today figure wear `--color-running`. The Today
   figure ticks up live: the day's logged seconds plus the running elapsed.

   **Hover and focus take the primary colour, as every other row control does** — settled with the
   owner on 2026-09-21, after the build raised a state these decisions had not covered. The stop is a
   control first and a status second, so it follows the pin's `hover:text-primary
   focus-visible:text-primary` rather than holding the running tone through hover. The key and the
   Today figure are not controls and keep `--color-running` throughout, so the row still reads as
   running while the pointer is on the button.
4. **Rail:** the running line (`dot · KEY · elapsed`) replaces "No timer running" while a timer runs,
   and **a stop button follows the elapsed time**, always visible, in `--color-running-rail` with the
   rail's hover wash, so a timer can be stopped from any view.
5. **Under a minute is discarded.** A stop, or a switch to another ticket, after less than 60 s
   creates no entry. Jira would reject such a worklog anyway. The stop reports that nothing was
   logged.
6. **An overnight timer is closed by the server.** Any read of the timer finds a timer whose start
   day (in `THAT_TIMEZONE`) is before today's, stops it at local midnight of its start day, creates
   the capped entry (subject to 5), and reports nothing running.

The rail's elapsed time follows the prototype's drawing (`42:18`): minutes and seconds under an
hour, `H:MM:SS` from an hour on, ticking every second. The row's Today figure keeps its drawn `H:MM`.

## Server

**Store** (`internal/store/timers.go`). Each call takes `now` and the location, so no store method
reads the clock:

- `RunningTimer(ctx, now, loc) (*Timer, *Entry, error)`: the running timer, or nil. If the timer's
  start day is before `now`'s local day, it closes it first (decision 6) and returns the created
  entry, which is nil if the run was discarded.
- `StartTimer(ctx, instanceID, issueKey, now, loc) (*Timer, *Entry, error)`: stops any running timer
  as `StopTimer` would, then starts the new one, in **one transaction**. Returns the new timer and the
  entry the stopped one created, if any.
- `StopTimer(ctx, now, loc) (*Entry, stopped bool, error)`: nothing running → `stopped == false`.
  Otherwise it deletes the row and creates the entry in one transaction. The end is
  `min(now, local midnight after the start day)`, `started_at` is the timer's start, `day` is the
  start's local day, and under 60 s there is no entry (decision 5).

**HTTP** (`internal/server/timer.go`), JSON shaped like the other endpoints:

- `GET /api/timer` → `200 {"running": null}` or `{"running": {"instanceId", "issueKey",
  "startedAt"}}`. The browser computes elapsed from `startedAt`, so there is no server tick. A
  midnight close also returns `"stopped": <entry>`.
- `POST /api/timer/start` with `{"instanceId", "issueKey"}` → `200 {"running": {…}, "stopped":
  <entry or null>}`. An unknown instance is `404 instance_not_found`, and a blank key is
  `400 invalid_request`.
- `POST /api/timer/stop` → `200 {"stopped": <entry or null>, "discarded": bool}`. With nothing
  running it answers `{"stopped": null, "discarded": false}` and is not an error.

Entries are rendered exactly as `/api/entries` renders them (the existing DTO).

## Browser

- **`web/src/timer-state.ts`** holds the one running timer, read once at start-up and after every
  start or stop. It exposes `onTimerChanged`, like `entries-changed.ts`, and a single 1-second tick
  that runs only while a timer runs. A stop or start that created an entry calls
  `announceEntriesChanged()`, so every total refreshes through the existing path.
- **`that-timer`** (`web/src/components/that-timer.ts`, light DOM) is the row's play/stop button. It
  takes the row's instance and key, renders play or stop from `timer-state`, and starts or stops on
  click. Its accessible name is "start timer" or "stop timer".
- **`that-ticket-row`** puts a `that-timer` before the pin in `c-act`. While its ticket runs, it tints
  the key and adds the live elapsed time to the Today figure.
- **Rail** (`rail.ts` plus the `#rail-timer` slot in `index.html`): the running line with its stop
  button, or "No timer running".
- A discarded stop says so once, in the same place a push report appears. Wording: "Under a minute —
  nothing logged."

## Testing

- **Store:** table-driven tests for start, stop, switch and every decision above, including the
  midnight cap and the discard, across `THAT_TIMEZONE`s where the UTC day differs from the local
  day. The day boundary is one of the two places `CLAUDE.md` says to test hardest.
- **Handlers:** `httptest` for the three endpoints, including an empty stop and an unknown instance.
- **e2e (Firefox and Chromium):** start a timer, reload, and the timer is still running with its
  elapsed time preserved (the ticket's criterion). Switching tickets stops the first. Stopping from
  the rail works on Week.
- **Prototype:** it draws the row control idle and running, and the rail's stop, and the build is
  compared against it.
