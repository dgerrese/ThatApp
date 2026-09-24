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
3. **Running row:** the stop button and the Today figure wear `--color-running`. The Today figure
   ticks up live: the day's logged seconds plus the running elapsed.

   **The key stays `--color-ink-muted`, corrected on 2026-09-22.** This session and the 2026-09-18
   one both had the key in the running tone, and it shipped that way into PR #179. The visual design
   language says the running tone is "the live timer and its stop control, and nothing else", and a
   key is neither. The owner read the built screenshots, said the green key was wrong, compared both
   states in the running app, and chose the muted key over changing the language. The stale clause
   that had granted it — in the first edition's row-key rule — was struck in the same change.

   **Hover and focus take the primary colour, as every other row control does** — settled with the
   owner on 2026-09-21, after the build raised a state these decisions had not covered. The stop is a
   control first and a status second, so it follows the pin's `hover:text-primary
   focus-visible:text-primary` rather than holding the running tone through hover. The Today figure
   is not a control and keeps `--color-running` throughout, so the row still reads as running while
   the pointer is on the button.
4. **Rail:** the running line (`dot · KEY · elapsed`) replaces "No timer running" while a timer runs,
   and **a stop button follows the elapsed time**, always visible, in `--color-running-rail` with the
   rail's hover wash, so a timer can be stopped from any view.
5. **Under a minute is discarded.** A stop, or a switch to another ticket, after less than 60 s
   creates no entry. Jira would reject such a worklog anyway. The stop reports that nothing was
   logged.

   **Superseded for the two user paths on 2026-09-23 (#185).** A stop or a switch now opens the
   stop dialog, and its down button is what discards; the 60-second floor survives on the midnight
   close only (decision 6).
6. **An overnight timer is closed by the server.** Any read of the timer finds a timer whose start
   day (in `THAT_TIMEZONE`) is before today's, stops it at local midnight of its start day, creates
   the capped entry (subject to 5), and reports nothing running.

The rail's elapsed time follows the prototype's drawing (`42:18`): minutes and seconds under an
hour, `H:MM:SS` from an hour on, ticking every second. The row's Today figure keeps its drawn `H:MM`.

## The stop dialog (#185, settled 2026-09-23)

The owner asked for this on 2026-09-22, after saying "all worklogs should be rounded to 15min".
One sentence covers every case:

> **Up is ceiling to the 15-minute grid. Down is floor to the 15-minute grid. A floor of zero
> discards the entry.**

| Run | Up | Down |
|---|---|---|
| 30 seconds | 15 min | discarded |
| 7 min | 15 min | discarded |
| 20 min | 30 min | 15 min |
| exactly 30 min | 30 min | 30 min |

**"Down" is therefore also how a mistimed run is thrown away**, and it is the only way the dialog
destroys anything. The dialog must say so plainly where the run is under 15 minutes, because there
the button's effect is a discard rather than a rounding. The rounding happens **at timer stop, in
the dialog** — not at push and not in the API — so the entry that lands is already on the grid and
pushing stays a plain copy of the local record.

### The three paths that stop a timer

| Path | Dialog? | Rounding |
|---|---|---|
| The user stops the timer (`POST /api/timer/stop`) | **Yes** | The user's choice |
| The user starts a second timer, stopping the first (`handleStartTimer`) | **Yes** | The user's choice |
| The timer crosses local midnight, closed by the store inside `RunningTimer` | **No** — nobody is there | **None. The entry stays honest.** |

The midnight close is the reason `store.MinTimerSeconds` survives. Its 60-second floor is *Jira's*
constraint, not a preference — Jira rejects a shorter worklog — so a midnight close that catches a
run of a few seconds must still discard it. The two dialog paths no longer need that floor, because
"down" is what discards there. **A stop of a timer whose start day has passed is the midnight
close and stays honest whatever the dialog chose.** A browser left open across midnight still
shows the timer running and still opens the dialog on stop, which still posts a `round` — the
server is the one that knows the start day has passed, so it closes the timer honestly at its
local midnight and **ignores the `round` it was sent**, rather than the dialog knowing not to ask.

### The dialog

Held with the owner on the browser companion. **The rounding is the button**, chosen over a
two-part toggle followed by a confirm button, and over two choice rows with a large figure: this
dialog opens on every stop, so one click decides.

- **Heading** "Stop the timer?". Under it, muted: the key in the key face, then "ran" and the run's
  honest elapsed figure, for example `OPS-10442 ran 0:20`. **That figure is `H:MM`** — the duration
  field's shape, the same `0:20` a 20-minute entry shows elsewhere — not the rail's ticking
  `M:SS`/`H:MM:SS`, because the dialog reports a finished run rather than a running clock.
- **Description**: one text field, labelled with the house eyebrow label, placeholder "Optional —
  becomes the Jira worklog comment".
- **Buttons, right-aligned, in this order:** "Keep running", then the down button, then the up
  button (primary, so Enter rounds up). **"Keep running" and the down button both use
  `that-button`'s `secondary` variant** — the ghost the prototype draws as `.btn.quiet`, since
  there is no separate `quiet` variant on the built component. "Keep running" is the one that
  cancels, leaving the timer running; the down button is the one that rounds down or discards.
  **This is reversible** — the owner may have meant the two to read differently (cancel vs. a
  live choice) and split them into two looks later.
- **Each rounding button names its result:** "Log 0:15", "Log 0:30". A run on the grid shows the same
  figure on both, and both stay.
- **Under 15 minutes, the down button reads "Discard run"**, in the `danger` variant (the failed
  tone), because there it throws the run away. The button itself carries the warning; no extra line.
- **Starting a second timer opens the same dialog** for the run it stops. Its heading names both
  tickets — "Stop OPS-10442 and start WEB-7?" — and "Keep running" cancels the start too.

**Button labels never break — set by the owner, and app-wide.** The screen first showed the
7-minute variant's labels wrapping. So `that-button` gains `whitespace-nowrap`, which applies to
every button in the app (Decision 13 of the visual language), and this dialog grows wider to hold
its button row on one line, rather than letting `max-w-sm` wrap a label.

**The run line and every button label tick with the running timer while the dialog is open**, so a
button always names what it will write rather than freezing the figure at the moment the dialog
opened.

**The "Under a minute — nothing logged." notice is retired** (reversible, owner to confirm):
every discard on a user path is now a button named "Discard run", so the notice's job is done by
the dialog itself before the stop ever commits.

## Server

**Store** (`internal/store/timers.go`). Each call takes `now` and the location, so no store method
reads the clock. #185 adds a `TimerClose` argument, carrying the dialog's choice:

```go
type TimerClose struct {
    Round   Rounding // "" (none chosen), RoundUp ("up") or RoundDown ("down")
    Comment string
}
```

- `RunningTimer(ctx, now, loc) (*Timer, *Entry, error)`: the running timer, or nil. If the timer's
  start day is before `now`'s local day, it closes it first (decision 6, honest and capped) and
  returns the created entry, which is nil if the run was discarded under the 60-second floor. It
  passes the **zero `TimerClose`** — there is nobody to have chosen a rounding on this path.
- `StartTimer(ctx, instanceID, issueKey, now, loc, choice TimerClose) (running *Timer, stopped
  *Entry, wasRunning bool, err error)`: stops any running timer as `StopTimer` would — using
  `choice` — then starts the new one, in **one transaction**. `wasRunning` reports whether there
  was a timer to stop at all; `stopped` is the entry that stop produced, if any.
- `StopTimer(ctx, now, loc, choice TimerClose) (stopped *Entry, wasRunning bool, err error)`:
  nothing running → `wasRunning == false`, `stopped == nil`. Otherwise it deletes the row and
  creates the entry in one transaction, and **which rule applies depends on the timer's start
  day, not on who called it**:
  - **The start day is `now`'s local day** (a same-day close): `choice.Round` decides. Up
    ceilings to the 15-minute grid, down floors it and a floor of zero discards (`stopped ==
    nil`). **`choice.Round` empty or unrecognised returns `ErrRoundingRequired` and writes
    nothing** — the caller must have asked the dialog first.
  - **The start day is before `now`'s local day** (the midnight close, decision 6): the entry is
    capped at local midnight of the start day, written honestly with no rounding, and
    `store.MinTimerSeconds` (60) still discards a run under a minute. **`choice.Round` and
    `choice.Comment` are ignored on this path** — a stale browser can still post a `round`, and
    the store is what has the authority to disregard it, not the caller.

**HTTP** (`internal/server/timer.go`), JSON shaped like the other endpoints:

- `GET /api/timer` → `200 {"running": null}` or `{"running": {"instanceId", "issueKey",
  "startedAt"}}`. The browser computes elapsed from `startedAt`, so there is no server tick. A
  midnight close also returns `"stopped": <entry>`.
- `POST /api/timer/start` with `{"instanceId", "issueKey", "round"?, "comment"?}` → `200
  {"running": {…}, "stopped": <entry or null>, "discarded": bool}`. An unknown instance is
  `404 instance_not_found`, a blank key is `400 invalid_request`, and so — settled by #185 — is a
  `round` present but not `"up"`/`"down"`, or a same-day timer already running with no `round`.
  Nothing running ignores `round` and `comment` rather than failing.
- `POST /api/timer/stop` with `{"round": "up"|"down", "comment": "…"}` → `200 {"stopped": <entry
  or null>, "discarded": bool}`. No body, or a `round` other than `"up"`/`"down"`, is
  `400 invalid_request` (#185) — there is no silent default. With nothing running it answers
  `{"stopped": null, "discarded": false}` and is not an error.
- **A timer whose start day has passed is closed honestly by the midnight close even when the
  user is the one who stops it** — decision 6, unchanged by #185. The 60-second floor
  (`store.MinTimerSeconds`) lives on that path only; the two dialog paths above use `round` to
  decide instead.

Entries are rendered exactly as `/api/entries` renders them (the existing DTO).

## Browser

- **`web/src/timer-state.ts`** holds the one running timer, read once at start-up and after every
  start or stop. It exposes `onTimerChanged`, like `entries-changed.ts`, and a single 1-second tick
  that runs only while a timer runs. A stop or start that created an entry calls
  `announceEntriesChanged()`, so every total refreshes through the existing path.
- **`timer-state.ts` opens `that-stop-dialog` before posting** (#185): a stop or a switch no
  longer calls the endpoint directly, it opens the dialog for the run being stopped, and only a
  confirmed "Log …" or "Discard run" click carries `round` and `comment` into the `POST`.
  "Keep running" closes the dialog and posts nothing, so the timer already running is left alone.
- **`that-timer`** (`web/src/components/that-timer.ts`, light DOM) is the row's play/stop button. It
  takes the row's instance and key, renders play or stop from `timer-state`, and starts or stops on
  click. Its accessible name is "start timer" or "stop timer".
- **`that-ticket-row`** puts a `that-timer` before the pin in `c-act`. While its ticket runs, it tints
  the key and adds the live elapsed time to the Today figure.
- **Rail** (`rail.ts` plus the `#rail-timer` slot in `index.html`): the running line with its stop
  button, or "No timer running".
- **The "Under a minute — nothing logged." notice is retired** (#185, reversible, owner to
  confirm): see *The stop dialog* above.

## Testing

- **Store:** table-driven tests for start, stop, switch and every decision above, including the
  midnight cap and the discard, across `THAT_TIMEZONE`s where the UTC day differs from the local
  day. The day boundary is one of the two places `CLAUDE.md` says to test hardest.
- **Handlers:** `httptest` for the three endpoints, including an unknown instance and #185's
  rejection cases: no body → `400`, an unrecognised `round` → `400`, a same-day switch with no
  `round` → `400`, and nothing running → `round`/`comment` ignored rather than erroring.
- **e2e (Firefox and Chromium):** start a timer, reload, and the timer is still running with its
  elapsed time preserved (the ticket's criterion). Switching tickets stops the first. Stopping from
  the rail works on Week.
- **Prototype:** it draws the row control idle and running, and the rail's stop, and the build is
  compared against it.
