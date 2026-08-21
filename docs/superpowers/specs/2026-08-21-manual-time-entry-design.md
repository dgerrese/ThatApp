# Manual time entry — duration input and day total — design

**Date:** 2026-08-21
**Supersedes:** nothing
**Superseded by:** nothing

The design for [#7](https://github.com/dgerrese/work-dashboard/issues/7). Time is typed against a
ticket, stored locally, and shown as the day's total. `GET/POST/PATCH/DELETE /api/entries` back it,
a modal dialog per ticket is the only manual way in, and the rail carries the total and the split.

The design of record settles the `time_entries` table and the endpoint paths and nothing else about
this ticket. Nothing here talks to Jira: the worklog push is #9.

## Decisions taken in brainstorming

1. **The dialog is the only manual surface.** `ManualDialog.dc.html` — M4, "one component, two
   anchorings" — centred on the desktop and anchored to the bottom edge on the phone. M1's
   row-opens-in-place and M2's popover are both superseded by it, and **M3's type-into-the-row fast
   path is dropped**: time arrives through the timer (#8) or through this dialog, and nothing else.
   The owner settled this on 2026-08-21.
2. **The duration control is a glued stepper you can type into.** `−` / field / `+` as one bordered
   group. This overrides the boards, which draw a plain `00:00` text field in both M1 and M4 — the
   ticket's "picker-style control, not a free-text field" criterion stands and the boards' typed
   field is what gives way. See *The duration control*.
3. **Every committed duration is a multiple of 15 minutes.** The constraint lives in the control,
   not in a preference — there is no toggle. The API is deliberately looser; see decision 8.
4. **`started_at` is never edited.** It defaults to creation time and is sent to Jira because a
   worklog requires it. The start time does not matter in practice, so it is displayed muted in the
   entry list — the only thing distinguishing two entries with the same duration and no comment —
   and nothing edits it. `PATCH` therefore accepts `seconds` and `comment` only.
5. **#7 builds the whole dialog**: list, add, edit and delete. #10 is titled *edit after push* and
   is about reconciling worklogs that already exist in Jira, not about local editing. Shipping
   without delete would make every mistyped entry permanent for two tickets.
6. **Every destructive action confirms.** Deleting an entry destroys a record of work, so it goes
   through `wd-confirm`. #6 argued the opposite for Unpin and was right there for the opposite
   reason: unpinning destroys nothing. This is a standing rule, and it binds #10's worklog deletion
   too.
7. **The rail owns its own data.** A shell-level module fetches today's entries and re-renders on an
   `entries-changed` event. The alternative — Today pushing totals into the rail — leaves the rail
   stale on Settings and forces #11 to teach it the same trick again. A server-computed summary
   endpoint was rejected as duplicating what the entries response already carries.
8. **The API does not enforce the 15-minute grid.** #8's timer will produce a run of 7m13s. The grid
   is a property of the manual control, not of the resource, and a test pins that so the tightening
   fails a gate rather than #8.

## The store — `internal/store/entries.go`

**No migration.** `time_entries` and both its indexes were created in the initial migration, and
`idx_entries_issue_day (instance_id, issue_key, day)` is exactly the lookup the dialog performs.

```go
type Entry struct {
    ID         int64
    InstanceID int64
    IssueKey   string
    Day        string      // YYYY-MM-DD, the user's local date
    StartedAt  time.Time
    Seconds    int
    Comment    string
    WorklogID  string      // empty until #9 pushes
    PushedAt   *time.Time  // nil until #9 pushes
    CreatedAt  time.Time
    UpdatedAt  time.Time
}

type EntryInput struct {
    InstanceID int64
    IssueKey   string
    Day        string
    StartedAt  time.Time
    Seconds    int
    Comment    string
}

func (s *Store) EntriesForDay(ctx context.Context, from, to string) ([]Entry, error)
func (s *Store) EntriesForIssueDay(ctx context.Context, instanceID int64, key, day string) ([]Entry, error)
func (s *Store) CreateEntry(ctx context.Context, in EntryInput) (*Entry, error)
func (s *Store) UpdateEntry(ctx context.Context, id int64, seconds int, comment string) (*Entry, error)
func (s *Store) DeleteEntry(ctx context.Context, id int64) error
```

Both read paths return oldest first and an empty slice rather than nil, matching `Instances` and
`Pins`. `UpdateEntry` and `DeleteEntry` reuse `errNoRowsIfUnaffected`, so a missing id is
`sql.ErrNoRows` rather than a silent success. `worklog_id` and `pushed_at` are read but never
written here — push state stays derived, and #7 must not introduce a flag.

## The day boundary

**Resolved once, server-side, at creation.** `POST /api/entries` stamps two fields from one instant:

```go
now := s.now()                                   // injected, see below
started := now
day := now.In(s.cfg.Location).Format("2006-01-02")
```

The browser never computes a date. It reads the `day` the server stamped and groups by it, which is
what makes the rail's client-side summing safe.

**The handler takes its clock as a `func() time.Time`.** The acceptance criterion asks for a test
with the container at UTC and `WD_TIMEZONE=Pacific/Auckland` proving an entry near the boundary
lands on the right local day, and that is unprovable without an injected instant — you cannot make
the test machine be 11pm. `internal/server.Server` gains a `now func() time.Time` field defaulting to `time.Now`; the
zone is already validated at boot and held as `cfg.Location`, a `*time.Location`, so nothing parses
a timezone name at request time.

## The API — `internal/server/entries.go`

```
GET    /api/entries?from=&to=     bare array, oldest first
POST   /api/entries               201, the created row
PATCH  /api/entries/{id}          200, the updated row
DELETE /api/entries/{id}          204
```

Its own file; `instances.go` and `issues.go` are untouched.

### The row

```json
{ "id": 4, "instanceId": 1, "instanceName": "Ridgeline", "instancePosition": 0,
  "issueKey": "RIDGE-4929", "day": "2026-08-21", "startedAt": "2026-08-21T14:05:00+02:00",
  "seconds": 1800, "comment": "Refinement" }
```

A bare array, matching `/api/instances` and `/api/pins`: entries are a CRUD resource, not a fan-out
report. `instanceName` and `instancePosition` are joined in by the handler from the instances it
already loads — the rail's split draws the same coloured dots #6 introduced, and `instancePosition`
is the same 0-based index into `store.Instances`'s `created_at` order.

**Push state is deliberately absent.** Every entry in #7 is unpushed, and naming the derived state
before #9 owns it would invent vocabulary the pushing ticket has to live with. **The board does draw
it** — an "In Jira" check and an amber "Not pushed" dot on each entry row — so its absence here is a
deferral to #9 and not an oversight in reading the board. The entry row's layout leaves the slot.

### `GET`

`from` and `to` are optional, inclusive, `YYYY-MM-DD`, and **both default to today** — resolved in
`WD_TIMEZONE` — so the rail's call is a bare `GET /api/entries`. #11's week grid reuses the same
endpoint with a range. A malformed date or `from` after `to` is 400 `invalid_request`.

### `POST`

Body: `{ "instanceId": 1, "issueKey": "RIDGE-4929", "seconds": 1800, "comment": "" }`.

**`day` and `startedAt` are never accepted from the client**, so a browser cannot post itself into
another day. Rejections, in order:

1. A malformed body, a blank `issueKey`, or a missing `instanceId` — 400 `invalid_request`.
2. An unknown `instanceId` — 404 `instance_not_found`.
3. `seconds` of zero or less, or over 24 hours — 400 `invalid_request`.

`POST` does **not** verify the issue exists: no Jira call anywhere in this ticket. The keys come
from rows already on screen.

### `PATCH` and `DELETE`

`PATCH` accepts `seconds`, `comment`, or both — at least one — and moves `updated_at`, which is
what makes an entry dirty for #10. It never changes `day` or `started_at`. `DELETE` answers 204.
Both answer 404 `entry_not_found`.

**A non-numeric id is 400 `invalid_request`**, following `/api/pins/{id}`. `/api/instances/{id}`
answers 404 for the same input by documented design; this makes it two routes to one, which turns
[#55](https://github.com/dgerrese/work-dashboard/issues/55) into "change instances to match" rather
than an open question.

## The duration control — `web/src/components/wd-duration.ts`

One bordered group: `−`, a field, `+`. Radius on the outside only, hairline dividers between, and
the focus ring on the group via `:focus-within` rather than on the input alone.

`−`/`+` and ↑/↓ move by 15 minutes. Typed digits fill `HHMM` from the right and commit on Enter or
blur, reformatted to `H:MM`. `inputmode="numeric"`, so the phone in #53 gets a number pad.

### The parse rule

Strip everything that is not a digit. The last two digits are minutes; whatever precedes them is
hours. Minutes of 60 or more carry. Round to the nearest 15 minutes, except that **any non-zero
input keeps at least one step** — typing a number and getting nothing back reads as broken.

| Typed | Stored | Why |
|---|---|---|
| `300` | 3h 00m | last two are minutes, the rest are hours |
| `1100` | 11h 00m | as above |
| `45` | 0h 45m | two digits or fewer are minutes |
| `7` | 0h 15m | 0h 07m, snapped up rather than to zero |
| `130` | 1h 30m | |
| `175` | 2h 15m | minutes over 59 carry |
| `8:15` | 8h 15m | a colon is accepted and ignored |
| `0` | 0h 00m | the only way to reach zero |
| `12345` | refused | more than four digits |
| over 24h | refused | |

This table is the specification. It is the kind of rule a later reader "simplifies" — `7` → 0h 15m
in particular looks like a bug until you know that rounding to nearest gives 0h 00m.

## The dialog — `web/src/components/wd-entry-dialog.ts`

Two components rather than the ticket's single `wd-time-entry.ts`: the control above, reusable by
#8, and the dialog here.

**The trigger** is the row's duration cell, on assigned and pinned rows alike: a `<button>` showing
that ticket's total for the day — `0:00` when there is none — with `aria-haspopup="dialog"`. It
stays a button because #8 adds its start/stop control beside it.

**The board draws that cell as a plain `<span>`**, and gives the row exactly one control — #8's play
circle. Nothing about opening this dialog was ever drawn, so it was settled with the owner in the
browser on 2026-08-21, in the app's own tokens and typeface, the way the duration control was
settled. **The cell carries a "Log" hint**: 12px, uppercase, `--color-primary`, to the left of the
figure, expanding from zero width on hover and on `:focus-visible`. It answers the one real weakness
of an affordance that exists only on hover, and draws nothing permanent into the resting row.

**The hint widens the button, so the summary re-truncates while it is out.** Measured, not reasoned:
the top row's title reads "Retry a worklog push that faile…" at rest and "Retry a worklog push that
f…" while hovered, and the status shifts left with it. Three arrangements that hold the row still
were built and shown; the owner chose this one on 2026-08-21 knowing the cost. **That is a
consequence, not a defect** — it is not to be "fixed" into a reserved-width variant without going
back to the owner.

**Two alternatives were rejected**, recorded so they are not re-proposed. A separate `+` button puts
three controls at the row's right edge the moment #8 lands. Making the whole row the target cannot
be a `<button>` at all — the row holds the key's link and will hold #8's play control, and a button
may contain neither — so it would need `tabindex`, `role` and hand-written Enter/Space handling,
which is the reimplementation `wd-button` and `wd-confirm` exist to avoid, on the most-used control
in the app.

**The modal follows `wd-confirm`**: a native `<dialog>` opened with `showModal()`, which supplies
the focus trap, the inert background, the top layer, Esc dismissal and focus returning to the
trigger. Its deliberate no-dismiss-on-backdrop rule carries over, and so does its trap — Preflight's
`* { margin: 0 }` is author origin and beats the UA's `dialog { margin: auto }`, so the dialog lands
top-left in both target browsers unless margin is set explicitly.

**Its header is the board's**, and the earlier draft of this document omitted all of it: the summary
as an `<h2>`, a muted `KEY · Instance · Status` line beneath, the ticket's total for the day at 22px
on the right, and a round Close button — in a 560px card. Adopted unchanged.

**Inside:** the day's entries for that one ticket, each showing its start time muted, its duration,
its comment, and edit and delete. Empty reads "Nothing logged against this ticket today."

**The dialog holds exactly one duration control — the form at its foot** — and editing loads the
entry into it. The alternative, turning the row itself into an editor, puts a second `wd-duration`
on screen and gives one dialog two places to type. Settled with the owner on 2026-08-21 against
three other arrangements.

**In edit mode the field row does not change.** The mode is named on a line of its own — 11px
uppercase, "Editing the 09:15 entry", with the dismissing `×` at that line's right end — leaving
stepper, comment and one primary button exactly as they sit when adding. Measured: the comment field
is 298px adding and 335px editing, the only arrangement tested where it *grows*, because "Save" is
narrower than "Add entry". Every alternative put the mode or its Cancel inside the field row and cost
the comment between 11px and 83px. **The cost is height, not width, and that is the point.**

**Cancel stays visible.** Esc alone will not do: #29 added Cancel to Settings' edit mode precisely
because it was missing, and the argument carries here unchanged.

**The row being edited is the only one left undimmed**, which is what binds the foot form to a
particular entry.

**Deleting confirms**, per decision 6, through `wd-confirm`. That opens a modal `<dialog>` from
inside a modal `<dialog>`: the top layer is a stack and both target browsers support it, but Esc
must close only the confirmation, leaving the entry dialog open with focus back on its row. That is
asserted rather than assumed.

**The dialog is appended to the view root, never inside the row that opened it.** Today still
re-renders its list wholesale, and #6 handed this ticket that as a precondition. With all input in a
modal, rows carry nothing to lose — but only while a re-render cannot reach the dialog. Nested in a
row, a refresh landing mid-edit destroys the element being typed into, which is #29's bug in new
clothes.

After every mutation the dialog refreshes its list, the trigger's total updates, and an
`entries-changed` event goes up for the rail — the same event #8 and #9 will dispatch.

## The rail

#44's spec assigns two of its rows to this ticket: the 46px day total, and the instance split —
bar, then per-instance figures — with the total heading the split.

A shell-level module owns both. It calls `GET /api/entries`, sums `seconds` for the total, groups by
`instanceId` for the split, and draws each instance's dot from `instancePosition` via
`paintInstanceDot`. It renders on load and on every `entries-changed`. Living in the shell rather
than in Today is what keeps it correct on Settings and on #11's Week view without either knowing it
exists.

Three rules from #44 that bind it: a total is `Nh Nm` — `5h 15m`, `0h 00m` — never `H:MM`, which is
reserved for durations you can start and stop; every figure carries `tabular-nums`; and with nothing
logged there is **no split bar at all**, not a bar of zero width, so the existing "Nothing to split
yet" line stays until there is something to divide.

It never computes a date. It sums rows the server already stamped.

## Testing

### The day boundary

Table-driven over the injected clock. The cases that matter are the ones where UTC and the local
date disagree, in both directions — a test at `11:30Z` in Auckland passes even against a handler
that ignores the timezone entirely, because UTC agrees on that instant.

| Instant (UTC) | `WD_TIMEZONE` | Local | `day` must be | UTC would say |
|---|---|---|---|---|
| `2026-08-21T13:00:00Z` | Pacific/Auckland | 22nd, 01:00 | `2026-08-22` | `2026-08-21` |
| `2026-08-21T02:00:00Z` | America/Los_Angeles | 20th, 19:00 | `2026-08-20` | `2026-08-21` |

Two zones of opposite sign, so neither a hardcoded offset nor a dropped conversion survives.
**Proven by mutation:** replace the conversion with `now.UTC().Format(...)`, watch both rows fail,
restore, and put both outputs in the task report.

### Store

A round trip including an empty comment; `EntriesForDay` oldest-first and empty-not-nil;
`EntriesForIssueDay` filtering by all three columns; `DeleteEntry` on a missing id as
`sql.ErrNoRows`; an instance's removal cascading to its entries. `UpdateEntry` is verified **by
reading the row back**, asserting `seconds` and `comment` changed while `day` and `started_at` did
not — #6's review found a test asserting against a snapshot taken before the code under test ran,
and that shape is not repeated here.

### Handlers

No fake Jira server, because nothing calls Jira. The rejection order and codes; `GET` defaulting to
today and filtering a range; a malformed date and `from` after `to`; a non-numeric id. Two carry
their reasoning in their names:

- **`POST` ignores a client-supplied `day` and `startedAt`** — the body sends both, deliberately
  wrong, and the stored row carries the server's values.
- **`POST` accepts seconds that are not a multiple of 900** — so the tightening decision 8 forbids
  fails a gate instead of breaking #8 weeks later.

### Playwright

Assertions target the posted payload, not only the rendered text: typing `300` must send
`seconds: 10800` and `7` must send `900`. A control that renders `3h 00m` while posting the wrong
integer is the class of defect this project keeps finding.

- Add, edit and delete each move the row total **and** the rail total with no reload.
- Deleting raises the confirmation; **Esc closes only the confirmation**, the entry dialog stays
  open, focus returns to the row.
- The dialog opens from a pinned row as well as an assigned one.
- After adding an entry on Today, **navigating to Settings still shows the right rail total** —
  which fails if anything about the rail is wired through the Today view.
- **Pressing Refresh with the dialog open leaves it open** and its mid-edit state intact.
- **The trigger opens from the keyboard** — Tab reaches the duration cell and Enter opens the
  dialog, which is the property that made it a `<button>` rather than a clickable row.
- **Editing binds the foot form to one entry**: pressing edit loads that entry's duration and
  comment into the foot, Save posts a `PATCH` for that id, and Cancel leaves the entry unchanged.

The parse rule is a pure function and the obvious first customer for
[#51](https://github.com/dgerrese/work-dashboard/issues/51)'s frontend unit runner, which does not
exist yet. Until it does, it is covered through Playwright, and #51 should absorb it.

## Out of scope

- **The timer** — #8. This ticket adds no start/stop control, and leaves room in the row for one.
- **Anything that talks to Jira** — #9. No worklog is created, no push state is displayed.
- **Editing `started_at`**, per decision 4.
- **The week's totals** — #11 reuses `GET /api/entries` with a range; this ticket serves today.
- **Reordering or grouping entries** beyond oldest-first.

## Acceptance criteria, mapped

| Criterion | Where it is met |
|---|---|
| `GET/POST/PATCH/DELETE /api/entries` served and covered by handler tests | *The API*, *Testing* |
| `day` resolved in `WD_TIMEZONE`, proven by a boundary test | *The day boundary*, and the two-zone table |
| A new entry defaults `started_at` to creation time | *The day boundary* |
| Zero or negative duration rejected with 400 | *`POST`*, rejection 3 |
| Several entries per ticket per day, each with its own comment and start time | `EntriesForIssueDay`; the dialog lists them |
| `PATCH` updates `updated_at` | *`PATCH` and `DELETE`* |
| Duration entered through a picker-style control, not a free-text field | *The duration control* |
| The API takes integer seconds and parses no duration strings | *`POST`*; the browser parses |
| Today shows the day's running total, updating without a reload | *The rail*, plus the Playwright assertions |
| A Playwright spec covers picking a duration and seeing the day total change | *Testing* |

**Three criteria changed meaning during brainstorming**, and the issue body was corrected to match
this document on 2026-08-21, when the owner approved it:

- **"…and it remains editable afterwards"** (of `started_at`) — it is not editable; decision 4.
- **"The Today view shows the day's running total"** understates the scope: #44's spec assigns the
  rail's 46px total *and* the per-instance split to this ticket, and the rail is app-wide.
- **"picker-style control"** survives, but it is a stepper you can type into rather than a set of
  fixed options, and it overrides the boards' plain text field.

**Two criteria were added in the same edit**, both in this document's scope and neither in the
original body: deleting an entry confirms through `wd-confirm` (decision 6, now a standing rule),
and the API does not enforce the 15-minute grid (decision 8, pinned by a test so the tightening
fails a gate rather than #8).

## Corrections to other documents

- `docs/superpowers/specs/2026-08-04-work-dashboard-design.md` line 238 says manual entries "default
  to the time the entry was created and remain editable". The second half is now false; this ticket
  corrects that line, as #6 corrected the `pinned_issues` block.
- The boards draw a plain `00:00` text field for duration in `ManualExpand.dc.html` and
  `ManualDialog.dc.html`. Superseded by *The duration control*; the canvas files are records of what
  was approved on 2026-08-20 and are not edited.

## Diffed against the sources

This document was diffed against `ManualDialog.dc.html` before it became binding, which is the rule
#6 produced after two of its divergences reached a finished branch. Four gaps came out of it, and
each is resolved above rather than left in the diff: the dialog's header and Close were on the board
and missing here, and are adopted; the per-entry push chip is on the board and is deferred to #9 by
argument; and the trigger and the editing affordance were in this document with **nothing drawn
anywhere** — both were settled with the owner in the browser on 2026-08-21.

**Designing the undrawn parts in the browser is the method, not an improvisation.** It is what
settled the duration control on the same day, and both of #6's divergences were things nobody could
see until they were built. Where this document specifies something the boards do not draw, that is
where to look first.
