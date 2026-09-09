# The entries dialog, scoped to a day

**Date:** 2026-09-09
**Ticket:** [#105](https://codeberg.org/DionGerrese/ThatApp/issues/105)
**Supersedes:** nothing
**Superseded by:** nothing

**Corrects:** [`2026-08-04-thatapp-design.md`](2026-08-04-thatapp-design.md) and
[`2026-08-21-manual-time-entry-design.md`](2026-08-21-manual-time-entry-design.md), both of which
say a browser may never post itself into another day. See *What the old rule was protecting*.

This document holds what the design session of 2026-09-09 settled, and only that. The gap itself,
its cause and its acceptance criteria are in the ticket; the parts of the fix that were already
settled when the ticket was refined are not restated here.

---

## What the session was for

Every cell in Week opens this dialog, and the dialog does not know which day it was opened for, so a
past Monday's cell lists today's entries and logs against today. Scoping it is settled. **How the
dialog then says which day it is showing was never drawn** — the prototype only ever draws it for
today, and the header omits the day deliberately, on the reasoning that the day is the whole
dialog's subject rather than one fact in it. That reasoning held only while the subject was always
today.

Three placements went up on the browser companion, each drawn as the dialog Week opens: no summary
line, because Week's rows carry keys only.

## Decision 1 — the day takes the line under the key

The identity row is unchanged: the instance's dot, its name as an eyebrow, the middot, the key, the
day's total, and Close. **The day is written in full on the line beneath it** — `Tuesday 8 September`
— in the ink-muted 14px the summary line already uses.

The two rejected placements, and why:

- **In the identity row**, as another tracked eyebrow after the key. One voice, but a long instance
  name, a key and a day then compete with the total across one row, and the day arrives abbreviated
  because that is all that fits.
- **Labelling the total.** The figure is that day's, so the day naming it directly is defensible,
  but it puts the dialog's subject furthest from where reading starts and makes the header taller.

A past day is the unusual case and the one most worth being unambiguous about, which is what decided
it: the full date beats an abbreviation squeezed between two other facts.

## Decision 2 — every dialog names its day, not only a scoped one

The owner chose this over the narrower rule that only Week's dialogs name a day. **A dialog states
its subject, whichever view opened it.** Where a summary also exists — Today's rows carry one — the
day sits above it and the summary follows, so the header reads identity, then day, then what the
ticket is about.

That has a consequence the narrower rule did not, and it is the reason Decision 3 exists.

## Decision 3 — the day comes from the server, so `GET /api/entries` gains an envelope

**The browser may not work out what today is.** The day is the user's local date resolved in
`THAT_TIMEZONE`, and the container's clock is almost certainly UTC; the end-of-day push and the
weekly rollup have to agree on where a day ends with no browser open to ask. Week can name its day
because the rollup response carries it. Today passes no day at all, precisely so no date is derived
in the browser — and a day with nothing logged carries no entries to read a date from either.

So the response says it:

```json
{ "today": "2026-09-09", "entries": [ … ] }
```

**The field is `today`, not `day`.** A ranged read — Week's, and the dialog's own scoped read — would
otherwise invite `day` to be read as the range's day, which it is not. `today` means the same thing
in every response: the date the server resolved when it answered.

Two alternatives were put and declined. A separate `GET /api/today` keeps every existing shape
intact but adds a second round trip for one field the entries read is already making. Naming the day
only when one travels with the dialog costs nothing on the wire, but leaves the dialog silent about
its subject in the view where the app spends most of its time.

**This is a breaking change to a shape every consumer reads**, which is the cost the owner accepted:
`listEntries` in the frontend's API module, the rail's boot read, its pre-push check and its
announcement path, Today's totals, the dialog's own read, the Go handler and its tests, and every
end-to-end stub that answers `/api/entries` with a bare array.

## Decision 4 — the empty line names the day it is empty for

`Nothing logged against this ticket on Tuesday 8 September.` when the dialog is scoped, keeping
`Nothing logged against this ticket today.` when it is not. The wording mirrors the header's own, so
the two agree rather than describing the same day two ways.

The abbreviated form was declined for the same reason as Decision 1's, and "that day" was declined
because it leans on a header the line may be read apart from.

## What the old rule was protecting

Both specs corrected by this ticket say a browser cannot post itself into another day. The thing
that rule protected is that **an entry whose `started_at` contradicts its `day` is unconstructible**,
and that survives: the client still never sends a start time, and the server still stamps it —
local midnight in `THAT_TIMEZONE` for a backdated entry. What changes is only that the client may
name the day it means.

Reconciling a week before the timesheet goes in is what this app is for, and a week that cannot be
corrected is the larger cost.

## Out of scope

Unchanged from the ticket: editing `started_at`, moving an entry between days, a summary column on
Week's rows, and the dialog's remaining drift from the prototype, which is #117's.
