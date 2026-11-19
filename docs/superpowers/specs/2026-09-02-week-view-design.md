# Week view — rollup grid, per-cell push state, and a rail that follows the view — design

**Date:** 2026-09-02
**Supersedes:** nothing
**Superseded by:** [`2026-09-10-week-rows-and-global-search-design.md`](2026-09-10-week-rows-and-global-search-design.md),
for the grid's row rule alone (decision 1) — settled for CB#84 and CB#139. Everything else in this
document still governs.

The design for [CB#11](https://codeberg.org/DionGerrese/ThatApp/issues/11). A grid of tickets against
Monday–Sunday, backed by `GET /api/week?start=YYYY-MM-DD`, with push state on every cell and the
ability to push an unsettled day without leaving the view.

The design of record settles the endpoint path and one sentence of intent — *a grid of tickets
against Monday–Sunday, each cell summing that ticket's entries for that day, per-day and per-ticket
totals, and push status per day* — and nothing else. Everything below was settled in brainstorming
on 2026-09-02.

**This ticket also changes the rail's contract**, which is shipped code from CB#7 and CB#9. That is not
scope creep discovered late; it is the direct consequence of decision 6 and was taken deliberately.
See *What this ticket grew into*.

## Decisions taken in brainstorming

1. **Rows are flat, one per instance-and-ticket pair.** Not grouped under instance bands. The
   instance is a dot before the issue key, which the visual language explicitly permits in a
   week-grid cell, "where the reader already knows it". Grouping was rejected: it roughly doubles
   the rows to answer a question — how much went to each instance this week — that the rail's split
   now answers for free.

2. **Push state lives in the cell, not the day column header.** The design of record's phrase is
   "push status per day", but a day is not uniformly anything: it can hold pushed, unpushed and
   dirty entries at once, and one pip in a column header has to pick a winner and lie slightly. A
   per-cell marker points at the time it describes.

3. **Three states, as a marker before the figure.** Filled amber (85) for time Jira does not have;
   a hollow magenta (330) ring for an entry pushed and since edited, where Jira's copy is stale;
   nothing at all for settled. Filled against hollow means shape carries the distinction as well as
   hue.

   **This extends the palette.** `2026-08-20-visual-design-language.md` assigns green 150 to running,
   amber 85 to not-pushed and red 25 to failed, and names no colour for dirty — the state did not
   exist on screen before this ticket. Magenta 330 is the primary, so using it here is a deliberate
   extension rather than a reuse, and **the visual-design-language spec gains a line for it** rather
   than being quietly contradicted. The hollow ring is what keeps it from reading as a primary
   action.

   The marker is **inline, with no reserved gutter**. An earlier draft reserved the marker's width
   in every cell to stop the digits drifting. That was wrong: the columns are right-aligned, so the
   figure ends at the same edge whether or not a marker precedes it, and the marker hangs off to the
   left. There was never a drift to correct.

4. **A cell that mixes states takes the worse one — "worst wins".** Order: unpushed beats dirty
   beats pushed. A cell holding one pushed entry and one typed since reads as never-pushed. This is
   imprecise and never falsely reassuring, and the action is identical either way. The same rule
   gives a day column its state.

5. **Every figure is `totalFigure` — `Nh Nm`, never `H:MM`.** `web/src/format.ts` reserves the colon
   for timers on the rule that "a colon somewhere you cannot press play is a bug, not a formatting
   preference". Every number in a rollup is a sum, so the whole grid, both totals rows and the rail
   are `Nh Nm`. A cell with no entries renders an em dash rather than `0h 00m`. This makes the grid
   materially wider than a `H:MM` grid would be, which is the main reason decision 9 defers the
   phone.

6. **The rail follows the view.** Previously the rail described today, always, from every view. That
   is unambiguous only while Today is the sole view with time in it. Beside a week grid reading
   33h 45m, an unlabelled rail figure reading 4h 00m is a trap — and the rail carries no label at
   all today.

   So the rail's period becomes the view's period. On Today it is today; on Week it is the displayed
   week. Every region keeps its job — hero total, instance split, timer, unpushed summary, Push — and
   only the period changes. **A new period label above the hero figure is what makes the figure
   honest**, and it is the smallest part of the change that carries the most of its value.

   The alternative — label the rail "today" and put per-day Push buttons in the grid's totals row —
   was rejected by the owner in favour of one Push control that always means "send what I am looking
   at". That is the stronger model to hold in your head, at the cost of rewriting a contract CB#9
   shipped.

7. **The rail still never computes a date.** Its own comment says so, and the reason survives: the
   end-of-day push and the weekly rollup must agree on where a day ends when no browser is open. The
   view *tells* the rail which period it is showing; the rail sums rows the server already stamped.
   Nothing here derives a day from the browser clock.

8. **Push sends every day holding unpushed or dirty entries, one request per day, in order.** `POST
   /api/push?day=` is unchanged and stays per-day. One press issues one call per such day,
   sequentially — sequential so the merged report is attributable and deterministically ordered, and
   so a bad week does not fan several days of requests at Jira at once.

   **A dirty day is pushable, and offers Push, as of CB#121.** `handlePushDay` skips only entries
   already `pushed`; a `dirty` one now gets a `PUT` to its known `worklog_id`, updating the worklog
   Jira already holds. The rule this replaces forbade exactly that — updating a worklog Jira already
   had was "CB#10's whole subject and does not exist yet", so skipping everything a Push touched was
   safer than offering a control that would. That was right when it was written. CB#10 shipped on
   2026-09-08 and is that same capability, so it is the rule's precondition that expired, not its
   reasoning. Nothing about the hollow marker changes: it still tells the truth about Jira holding a
   stale copy, only Push is now the fix for it rather than a dead end.

   This is also where the rail's warning turns out to have had two separate problems, not one. Its
   **total** was wrong from the start: `web/src/rail.ts` has always summed every entry regardless of
   push state, never only unpushed time. Its **count** was merely out of date, until CB#121 made it
   agree — it counts **unpushed and dirty** entries, not time, via `isPending`; the rail's line reads
   "N entries to push", never a duration.

9. **The phone is deferred to [#6](https://github.com/dgerrese/ThatApp/issues/6).** A seven-column grid of `Nh Nm` figures does not fit 380px.
   Horizontal scroll was rejected because it puts the week total off-screen, and a rollup you cannot
   see all of is not a rollup; a second stacked-by-day layout was rejected as a second layout to
   build and test inside an already-grown ticket. CB#11 targets the desktop it will be used on, and
   this is a written-down gap rather than a surprise for [#6](https://github.com/dgerrese/ThatApp/issues/6).

## The grid

Columns are Monday through Sunday, then a row total. The footer carries per-day totals and the week
total. `font-variant-numeric: tabular-nums` throughout, per the visual language's rule that figures
stacking in a column are tabular.

**Row order is instance position, then issue key.** Instance position is the 0-based index into
`store.Instances`' `created_at` order — the same key `instance-hue.ts` colours from, so a row's dot
and its position agree. The same issue key in two instances is two rows, and they sort apart.

**A row with nothing logged against it in the displayed week is an ordinary row**, as of decision 1
of [`2026-09-10-week-rows-and-global-search-design.md`](2026-09-10-week-rows-and-global-search-design.md)
(CB#84, CB#139). It takes its place in the grid's existing order, carries no mark of any kind, and shows
an em dash in each of its seven day cells and in its row total — a zero would claim the week holds
something it does not.

This replaces the rule as first written here, that a row appears only once it has an entry and the
grid is not a list of assigned or pinned tickets. That held only while the grid had no other reason
to show a ticket; CB#139 gives it one (a pinned ticket, whether or not it was worked this week) and CB#84
gives it another (a ticket just pulled in by search, before anything is logged against it), and
both need a row to sit in before either is true of it. **A row that is there because it is pinned or
because it was just searched for is now indistinguishable from a worked one, deliberately** — the
grid shows what you are working on this week, not why each line is present.

**A pinned row belongs to the current week only.** `/api/week` seeds one for every pinned ticket the
rollup does not already carry, but only when the requested week is the one containing today, resolved
in `THAT_TIMEZONE` — the same expression `weekRangeParam` already uses for its own default, so the
two cannot disagree about which week that is. Navigating to a closed week shows what that week
actually contained, not what happens to be pinned now: a week is a settled record of what was worked,
and letting today's pin list leak into last month's row set would make a past week's shape depend on
a decision made after that week closed. **Do not simplify this into seeding every week** — a
search-added row (CB#84) carries no such limit, but it is never persisted; it lives only in the
browser's `addedTickets` for as long as the view stays open, so it cannot leak across a reload the way
a server-seeded row would.

## Push, and reporting a push that half-failed

**The report renderer moves out of Today into a shared module.** `renderPushReport` and
`failureList` in `web/src/views/today.ts` become `web/src/push-report.ts`, exporting a function that
takes a `PushResponse` and returns `Node[]`; each view places those nodes where it wants them.
Today keeps its region; Week renders them below the grid.

**This extraction is required, not a tidiness preference.** That renderer splits failures whose code
is `store_failed` from the rest, and the split is a safety property: those entries *did* reach Jira
and only the local record failed, so pressing Push again logs the time in Jira twice and nothing in
this app can undo it. A second implementation of that report is a second chance to get that wrong.
It is the same reasoning `CLAUDE.md` applies to derived push state — one implementation, not two.

The merged report **names the day as well as the entry**, because on Week one press covers several
days and "RID-204 — 502 from Ridgeline" alone does not say which day to look at.

**Nothing shifts when the report appears.** The report renders *below* the grid, so the grid never
moves under a press. There is no verdict line above the grid — decision 6 moved that sentence into
the rail's unpushed region, which is the one place it can sit without pushing the grid down. The
rail reserves that region's height so a week going from clean to unsettled moves nothing either.
This was the owner's stated priority and it generalises to every region that appears and disappears.

**A failed cell takes a red (25) marker, and that marker is transient.** It comes from the last push
response held in the view, not from `/api/week`, and it does not survive a refetch — a re-read
reports those entries as unpushed again, which is what they are. Worst wins applies: a cell holding
any failed entry shows the failed marker.

## Navigation

`/week?start=YYYY-MM-DD`, with `start` omitted meaning the current week's Monday resolved in
`THAT_TIMEZONE`. Previous and next arrows either side of a "This week" control, each a `pushState`
navigation so Back works and any week is a linkable address.

The Week entry in `web/index.html`'s nav is currently an inert `<span aria-disabled="true">`, placed
there by CB#12 with a comment naming CB#11 as its owner. It becomes an anchor. This is the same
reserved-markup pattern `#rail-timer` carries for CB#8 — **open `web/index.html` before implementing,
rather than adding a second Week link beside the disabled one.**

## The endpoint

```
GET /api/week?start=YYYY-MM-DD
```

**The response is pre-aggregated**, not a list of entries the browser sums. The endpoint is named a
rollup, the acceptance criteria require totals, and aggregating on the server keeps the day boundary
and the push-state derivation in the one place that already owns both.

```jsonc
{
  "start": "2026-09-07",
  "end": "2026-09-13",
  "days": [
    { "day": "2026-09-07", "seconds": 25200, "pushState": "pushed" }
    // ... exactly 7, Monday first
  ],
  "rows": [
    {
      "instanceId": 1,
      "instanceName": "Ridgeline",
      "instancePosition": 0,
      "issueKey": "RID-118",
      "cells": [
        { "seconds": 0, "pushState": null }
        // ... exactly 7, index-aligned with `days`
      ],
      "seconds": 24300
    }
  ],
  "seconds": 121500
}
```

`cells` is aligned to `days` **by position, not by key**, and is always exactly seven long. A client
cannot then render a ragged row, and the alignment cannot drift.

`pushState` is `null` exactly when the cell holds no entries, and otherwise one of `unpushed`,
`pushed` or `dirty` — the same three strings `pushStateOf` already returns.

**Errors.** A `start` that parses but is not a Monday is a `400` with a stable code
`start_not_monday`. It is never silently reinterpreted as the Monday of its week: a caller who asked
for the wrong thing should learn that, and a silent shift makes two different `start` values return
identical bodies. A malformed date reuses `dayParam`'s existing validation.

**An empty week is a `200`** with `rows: []`, seven zeroed days with `pushState: null`, and
`seconds: 0`. The view renders an empty state; it is not an error to have taken a week off.

## Where correctness lives

Both of the project's named risk areas are in play, so both get a table-driven test a plausible
refactor would fail.

**The day boundary.** `start` is a local date in `THAT_TIMEZONE` and the Monday check is made
against that zone, not the container's UTC clock. `day` is already stored as a local date string, so
the week is `store.EntriesForDay(start, end)` — an inclusive string range, which is exactly what
that method already provides. **No new store method is needed.**

**Derived push state.** Cell and day states come from `pushStateOf` and are never stored. What is
new is the *aggregation* — worst wins — and that ordering is what a refactor would most plausibly
get backwards, so it is tested directly rather than only through a handler.

## Testing

**Go**, table-driven with `httptest`:

- a `start` that is not a Monday is rejected `400` with `start_not_monday`
- a week with no entries returns `200` and an empty grid
- cells sum only that ticket's entries on that day; row, day and week totals agree with the cells
- the same issue key in two instances produces two rows, ordered by instance position
- worst wins, as its own table: every combination of entry states in one cell
- the week is resolved in `THAT_TIMEZONE` while the process clock is UTC

**Playwright**, exercising the acceptance criteria rather than asserting a 200:

- a ticket with entries on two days shows both cells and a correct row total
- an unsettled day is pushable from the rail, and the grid settles afterwards
- a half-failed push names the day and the entry, and the `store_failed` case says not to retry

## What this ticket grew into

CB#11's written acceptance criteria describe a read-only grid. Two brainstorming decisions took it
past that, both the owner's:

- **the view can push** (decision 6), which brings in CB#9's partial-failure reporting, and
- **the rail becomes period-scoped** (decision 6 again), which changes shipped CB#7 and CB#9 code.

These stay in one ticket rather than splitting, because they cannot ship apart: a rail that follows
the view has nothing to follow until Week exists, and a Week view without it ships an unlabelled
rail figure next to a week total, which is the trap that motivated the change. **The issue body must
be updated to match this spec before planning.**

## Files

| Path | Change |
|---|---|
| `internal/server/week.go` | new — the handler and its aggregation |
| `web/src/views/week.ts` | new — the view, lazily imported |
| `web/src/push-report.ts` | new — the report renderer, extracted from Today |
| `web/src/views/today.ts` | the report renderer moves out; Today imports it |
| `web/src/rail.ts` | becomes period-driven rather than today-only |
| `web/src/router.ts` | `/week` route |
| `web/index.html` | Week nav becomes an anchor; the rail gains its period label |

## Out of scope

- **The phone and any narrow layout.** [#6](https://github.com/dgerrese/ThatApp/issues/6), per decision 9.
- **Editing or deleting entries from the grid.** The week reviews and pushes; it does not edit.
- **Everything in CB#10.** Nothing here needed it — `pushStateOf` and `EntriesForDay` both shipped with
  CB#9 — and CB#11 did not wait on it. The consequence held at the time: a dirty cell showed its marker
  and could not be acted on from here, because CB#10 did not exist yet. **The view did not gain that
  for free.** CB#10 shipped on 2026-09-08, and pushing a corrected day from here still did nothing,
  because the rail's own filter — untouched by CB#10 — still admitted only never-pushed entries.
  Closing that gap is CB#121; see decision 8 above.
