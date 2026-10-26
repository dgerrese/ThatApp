# Day planning — refinement drafts (2026-10-26)

Milestone "Day planning" holds four owner ideas from 2026-09-07/09. None has comments. All sit at
`status/needs-refinement`, with no type label. The milestone is a feature set the owner approved
as scope, so the "no enhancement while scope is undetermined" rule no longer blocks a label.

Facts that apply to all four (checked in code today):
- The design of record has no todo, retro, timeline or calendar concept. Views are Today and Week
  only (`web/src/views/today.ts` 1272 lines, `week.ts` 617). The rail (`web/index.html:68`) holds the
  total, timer, push button and nav.
- No spec or prototype (`docs/superpowers/prototypes/2026-09-03-app-prototype.html`, the visual
  language specs) draws any of these four. Grep for calendar/todo/retro/timeline/meeting finds nothing
  relevant. So each needs a design session.
- **`time_entries.started_at` is a server stamp, not "when the work happened".** `createEntryRequest`
  has no startedAt field (`internal/server/entries.go:207-218`); `startedAtForDay` (`entries.go:190`)
  answers `now` for today or local midnight for another day; PATCH never edits it (`entries.go:297`).
  `types.ts:137` says it "never will be" editable. A manual entry logged at 17:00 for a morning
  meeting starts at 17:00. This matters for #130 and #132.
- Credentials model: AES-GCM `crypto.Sealer` (`internal/crypto/crypto.go`) with `THAT_SECRET_KEY`;
  tokens in `instances.api_token_enc` (`internal/store/instances.go:57`). Any new secret reuses it.
- Migrations are dated SQL files in `internal/store/migrations/`. Dependency rule: stdlib plus
  `modernc.org/sqlite` and `x/sync` only (CLAUDE.md); any parser dependency needs owner approval.
- Suggested order inside the milestone: #111 and #133 are independent and small-to-medium; #130 and
  #132 both lean on the "when did the work happen" question and should be decided together.

---

## #111 A todo list, with due dates and an optional link to a ticket

**Still valid?** Yes. Nothing exists: no todo table, route or view (store has entries, instances,
pins, timers only; `internal/store/migrations/` has five files, none for todos).

**Problem.** The owner has things that must happen in a day that are not logged time and often not a
Jira issue. The app has nowhere to keep them, so they live outside it. The ticket's open list is long
because every piece (placement, done, markdown, link semantics, push) is undecided.

**Approach (recommended).** A local-only list, never pushed to Jira.
- Table `todos(id, body TEXT, due_day DATE NULL, instance_id NULL REFERENCES instances ON DELETE SET NULL, issue_key NULL, done_at DATETIME NULL, created_at, updated_at)`.
  `due_day` is a plain `YYYY-MM-DD` local date, same convention as `time_entries.day`.
- "Done" is `done_at IS NOT NULL`, derived like push state, not a boolean flag. Done todos grey out
  and sort to the bottom; a toggle hides them.
- Overdue means `due_day < today` where today is resolved server-side in `THAT_TIMEZONE`. The
  server sends an `overdue` boolean or today's date; the browser never decides, so a browser in a
  different zone cannot disagree with Week/Today.
- Markdown shown as source in v1 (a `<textarea>` and `white-space: pre-wrap`). Rendering needs a
  sanitised renderer; with no framework and a stdlib-first rule that is a dependency or a hand-rolled
  subset, and the owner has not asked for formatting. Alternative: a tiny safe subset (bold, italic,
  links, checklists) rendered client-side; costs a parser and an XSS surface.
- Ticket link stores `(instance_id, issue_key)` only, no cached summary. The row shows the key;
  summary/status come from the issue list already loaded on Today when present. If the ticket is no
  longer assigned the link stays and renders as a plain key. Deleting an instance nulls the link
  (todo survives).
- Placement is a design-session decision (see below). API: `GET/POST /api/todos`,
  `PATCH/DELETE /api/todos/:id`. Optionally an MCP tool later (`internal/server/mcp_tools.go` exists);
  out of scope here.

**Acceptance criteria**
- [ ] Migration adds `todos`; store tests cover create, update, done, delete, and the instance-delete behaviour (link nulled, todo kept).
- [ ] A todo needs a non-empty body; due day and ticket link are optional; an invalid day (`2026-02-30`) is a 400.
- [ ] Overdue is computed on the server in `THAT_TIMEZONE`. Table-driven test: with the clock set to 23:30 UTC and zone Europe/Amsterdam, a todo due "today local" is not overdue and one due yesterday local is; run at a UTC-vs-local day boundary so a refactor to `time.Now().UTC()` fails.
- [ ] Marking done sets `done_at`; marking undone clears it; no stored flag.
- [ ] A linked todo shows its ticket key; a link to an unassigned or unknown ticket still renders.
- [ ] Nothing about todos is sent to Jira and the push button, rail total and Week totals are unaffected (test: push with todos present makes no extra request).
- [ ] UI: new `that-*` light-DOM component(s) as needed, keyboard operable, works in light and dark theme, e2e in Firefox and Chromium, screenshots in both themes on the PR.
- [ ] `index.html` stays under 14kB (the view loads via `import()`).

**Out of scope.** Pushing todos anywhere, recurring todos, reminders/notifications, sub-tasks,
manual ordering, rendering markdown (unless the owner asks), todos from calendar events (#132),
todo-to-worklog conversion.

**Questions for the owner**
1. Where does it live: its own view, a section of Today, or both? Recommended: a section on Today (the day is the unit; todos due today are what a day contains), with no new nav entry in v1. This changes the design session and the view count.
2. Is the due date required? Recommended: optional (a todo with no date is "someday" and sorts last), since the ticket says plenty of things do not have a date.
3. Should markdown render? Recommended: no, show as source in v1; add rendering later if wanted.

**Design session needed?** Yes. No drawing shows a todo list, a done state, an overdue state or a
ticket-link chip. Questions for the session: placement on Today vs own view and how it shares the
page with the issue tables; row anatomy (checkbox, body, due, ticket chip); what overdue looks like
without breaking the "running" colour rule; completed todos (grey vs hidden toggle); the add/edit
control (inline vs dialog, reusing `that-dialog-blocks`); empty state; ticket picker (reuse
`that-issue-search`); phone width.

**Type label.** `enhancement` (clear addition, not in the initial design).

**Size.** L: new table, API, component(s), a Today section plus design session, tests in both layers.
Could be M if the owner picks "section of Today, source markdown, no hand ordering".

**Dependencies.** None hard. Soft: #131 (ticket details modal) could be the target of a todo's ticket
chip; #132 may later produce todos. Placement interacts with #130 (both want screen space on Today).

---

## #133 Retro notes for a week, carried into the sprint retro

**Still valid?** Yes. Nothing exists. The FFSRETRO board is a Jira board in one of the owner's
instances; the app's Jira client reads issues and writes worklogs only (`internal/jira/`:
search, issue, myself, worklog, worklogs_read; no issue creation). The design of record lists
"creating, editing or transitioning Jira issues" as explicitly out of scope (design doc, Scope).

**Problem.** Weekly rollup says how time was spent but not how the week went. The owner writes
went-well and needs-improvement notes straight onto a Jira board at sprint retro, away from the week
they describe, and has to remember them. What the app should do about FFSRETRO is the size-deciding
question.

**Approach (recommended).** Local notes, attached to a week, exported by copy.
- Table `retro_notes(id, week_start DATE, kind TEXT CHECK (kind IN ('well','improve')), body TEXT, instance_id NULL, issue_key NULL, created_at, updated_at)`.
  `week_start` is the Monday of the local week (reuse `mondayOf`, `internal/server/week.go:161`), so
  the Monday-boundary question is answered by the same code Week uses, in `THAT_TIMEZONE`.
  Two lists (`kind`), not free text: the retro board has two columns and two lists export cleanly.
- A note belongs to a week, not a day. Rationale: the owner said "at the end of a week". A day is
  recoverable from `created_at` if ever wanted.
- A note may name a ticket (optional, same shape as #111).
- Sprint view: a sprint is "multiple weeks", and the app has no sprint concept. Recommended: the
  user picks a range of weeks (default last N) and sees all notes grouped well / improve, with a
  **Copy as text** button that produces markdown to paste into the board. No sprint table.
- Where it lives: a panel on Week for the displayed week (the notes sit next to the rollup they
  describe), plus a range view reached from Week.
- FFSRETRO: v1 does nothing automatic. Alternative: write cards to the board via the Jira REST API
  (create issue). That breaks the "no creating issues" scope line, needs the board's project/issue
  type/field mapping (and each retro board column is often a status or a label), needs a write path
  and partial-failure handling, and is the part that would make this L/XL. Defer to its own ticket if
  copy-paste proves annoying.

**Acceptance criteria**
- [ ] Migration adds `retro_notes`; store tests for create/update/delete and for listing a range of weeks.
- [ ] A note's `week_start` is always a Monday in `THAT_TIMEZONE`. Table-driven test: a note created Sunday 23:30 local (Monday 00:00 UTC next day is already past, or the reverse near the boundary) lands in the week the owner is in, not the UTC week; fails if `time.Now().UTC()` is used.
- [ ] Notes filed for a week appear on that week's Week view and only there; changing the displayed week changes the notes.
- [ ] Two kinds, `well` and `improve`; any other value is a 400; empty body is a 400.
- [ ] A range view lists notes across selected weeks grouped by kind and week; copy produces deterministic markdown (test on the formatter, golden string).
- [ ] No request goes to Jira for notes (test with a failing Jira stub: notes still save and export).
- [ ] UI in both themes, light-DOM `that-*` components, e2e on Firefox and Chromium, screenshots on the PR.

**Out of scope.** Writing to FFSRETRO or any Jira issue, a sprint entity or sprint dates from Jira's
sprint API, team voting/grouping, per-day notes, notes on past weeks being locked after
submission, reminders to write notes on Friday.

**Questions for the owner**
1. What should the app do about FFSRETRO: nothing, copy as text, or create cards on the board? Recommended: copy as text. Creating cards turns a M into an L/XL and crosses the "no creating issues" scope line.
2. How is a sprint defined for the range view: you pick the weeks by hand, or a fixed length (for example 2 weeks)? Recommended: pick a week range by hand, default to the last two weeks; no sprint concept.
3. Is a note tied to a week only, or does it also need a day? Recommended: week only.

**Design session needed?** Yes. The Week design (`2026-09-02-week-view-design.md`,
`2026-09-03-today-and-week-design.md`) and prototype draw the grid only; no notes panel, no
two-list control, no range view. Questions for the session: where the panel sits on Week (below grid,
side, dialog); how the two lists are laid out; add/edit interaction; the range selector and sprint
view; the Copy control and its feedback (toasts exist, `that-toast`); empty state; phone width.

**Type label.** `enhancement`.

**Size.** M if copy-only (table, CRUD API, Week panel, range view, formatter). XL if cards are
written to Jira.

**Dependencies.** None hard. Uses Week (shipped). Shares the optional ticket-link shape with #111, so
building #111 first lets both reuse one ticket-link component and column pair.

---

## #130 A timeline of worklogs across the bottom of the screen, like a video editor

**Still valid?** Yes, but the premise needs a correction. A timeline places blocks by clock time, and
the app does not reliably have it (see below).

**Problem.** Time is entered as durations against tickets; there is no picture of how a day is laid
out. The owner wants a horizontal timeline of a day's worklogs along the bottom of the screen. The
data it needs does not exist yet: `started_at` is stamped by the server when an entry is logged, or
local midnight for a past day (`internal/server/entries.go:190-205`), and cannot be edited
(`entries.go:297`, `web/src/types.ts:137`). Only entries made by the timer start at the real clock
time of the work (timer stop creates the entry from the timer's start; see `internal/server/timer.go`).
A manual "1h" logged at 17:00 would draw at 17:00, which is wrong.

**Approach (recommended).** Two steps, and the owner chooses how far to go.
- Read-only picture first, scoped to one day (the day on screen in Today). Blocks are
  `started_at` to `started_at + seconds`, in `THAT_TIMEZONE`, coloured per instance. Timer entries are
  truthful; manual entries are not, so the picture must either mark them as "unplaced" (stacked in a
  tray) or the owner accepts approximate positions. Overlaps stack in lanes. The running timer shows
  as a growing block ending at now (it reads the same `timers` row the rail uses).
- Midnight: blocks are clipped to the local day; an entry starting 23:50 with 30 min length is cut at
  local midnight in the picture only (the stored `day` stays that of `started_at`). The server decides
  the day, not the browser.
- Alternative (bigger): an editable timeline where the owner drags to create and resize entries, and
  `started_at` becomes user-settable. That reverses a recorded invariant ("`startedAt` is not here
  and never will be"), touches the Jira worklog `started` the push sends, interacts with the 15-minute
  grid from #185 and the stop dialog, and needs overlap rules. Larger by a ticket or two; do it as a
  follow-up once the read-only picture proves useful.
- Placement: a fixed band at the bottom of the main column, collapsible, or part of Today only.

**Acceptance criteria** (read-only version)
- [ ] `GET /api/entries` (or a dedicated endpoint) returns `startedAt` as local RFC 3339 and a block can be positioned from it; test with zone Europe/Amsterdam and the server in UTC.
- [ ] Day-boundary test: an entry starting 23:45 local with 60 min is drawn only on the start day and clipped at local midnight; an entry starting 00:10 local (22:10 UTC the day before) belongs to the local day, not the UTC day. A refactor to UTC fails it.
- [ ] Entries with the same instance share a colour with the existing instance mapping; overlapping entries do not hide each other.
- [ ] The running timer appears as a block ending at now and updates (same clock source as the rail).
- [ ] Pending-delete entries (`deleted_at` set) are not drawn (design doc: they count in no total).
- [ ] An entry whose start is not a real clock time (manual/past-day) is drawn according to the owner's decision on question 1; whichever is chosen has a test.
- [ ] Keyboard and screen-reader access: blocks are focusable with a text alternative (ticket, duration); works in both themes; phone layout does not overflow.
- [ ] E2E on Firefox and Chromium; screenshots in both themes.

**Out of scope.** Creating, resizing or dragging entries; week-wide zoom; calendar events (#132);
changing `started_at` semantics (unless the owner picks the editable variant).

**Questions for the owner**
1. Read-only picture, or an editable control? And since manual entries have no real start time, how should they appear: in a separate "unplaced" tray, or at their stamped time anyway? Recommended: read-only, day-scoped, unplaced tray for manual entries. This decides whether the ticket is M or XL.
2. Should the owner be able to give a manual entry a start time (so it can sit correctly on the timeline)? Recommended: not in this ticket; if yes it is its own ticket because it changes the API and push.
3. Is it on Today only, or on every view? Recommended: Today only.

**Design session needed?** Yes. Nothing draws a timeline, a bottom band, a lane or a block. Questions
for the session: band height and whether it collapses; time axis range (whole day vs work hours,
zoom); block colour, label and the tooltip content (`that-tooltip` exists); how overlap lanes look;
the unplaced tray; how a running block looks against "running colour only for the timer";
hover/selection linking to the Today row; phone behaviour; interplay with the rail's bottom area and a
possible todo section (#111).

**Type label.** `enhancement`.

**Size.** M read-only (endpoint tweak, one component, one band); XL editable.

**Dependencies.** Soft: #8 timer (shipped, the running block). Strongly related to #132, which also
wants clock-time blocks (meetings) on the same axis; decide them in one session or build #130 first
and let #132 draw meetings on it.

---

## #132 Meetings from the calendar, and a worklog made from one

**Still valid?** Yes. No calendar code, no config, no table exists. Nothing in the design covers it.

**Problem.** Meeting time is logged by reading the calendar in a second window and retyping it. The
owner wants meetings listed in the app and a worklog created from one, with some meetings mapping to
fixed meeting tickets. Everything about how the calendar is reached, and what "attended" means, is
open.

**Calendar sources, realistically.** The owner's work calendars are probably Microsoft 365/Outlook
(Akzo Nobel, FrieslandCampina instances exist as Jira connections) and possibly Google. Facts, to be
confirmed with the owner:
- **ICS/iCal feed URL.** Both Google ("secret address in iCal format") and Outlook/M365 (publish
  calendar, ICS link) can expose one. App fetches the URL with a plain GET and parses RFC 5545. The
  URL is the credential, so it is stored like an API token (Sealer, `THAT_SECRET_KEY`). No OAuth, no
  app registration, no refresh. Fits the single-user self-hosted model best. Limits: many corporate
  tenants disable publishing external ICS links; feeds can lag (Google up to hours); recurring events
  need RRULE expansion, `EXDATE`, and time zones (VTIMEZONE) handled correctly; attendance/RSVP is
  usually not in the feed in a usable way. Needs a parser: stdlib has none, and writing RFC 5545
  recurrence expansion by hand is a well-known trap. A dependency such as `arran4/golang-ical` plus
  an RRULE library would need owner approval (CLAUDE.md allows only `modernc.org/sqlite` and
  `x/sync`). Recommended path: dependency approval, or support only non-recurring plus simple
  recurrence as a stated limit.
- **CalDAV** (Google, iCloud, Nextcloud): app credentials per account; plain HTTP REPORT queries;
  needs an app password. M365 does not offer CalDAV. Adds an XML dialect and auth. Not recommended
  first.
- **Microsoft Graph API** (`/me/calendarView`): the best data (RSVP response, attendees, online
  meeting), but needs an Entra app registration, delegated OAuth with refresh tokens, and a redirect
  URI to a self-hosted app on localhost. A work tenant usually requires admin consent for
  `Calendars.Read`, which the owner may not be able to get. Encrypted refresh token fits the Sealer,
  but the OAuth callback fits badly until ticket 13 (LAN/HTTPS) exists.
- **Google Calendar API:** same OAuth shape; a personal-use app stays in "testing" mode with refresh
  tokens expiring after 7 days unless published; more friction than the ICS secret link.
- **Manual import (paste/upload an .ics file):** zero credentials, works behind any admin policy;
  weakest in freshness.

**Approach (recommended).** ICS feed URLs, any number, each stored encrypted; fetched server-side
on demand (no background poller; the app has none today) and cached briefly; events for a day are
projected into `THAT_TIMEZONE`.
- Table `calendars(id, name, url_enc BLOB, created_at)`, mirroring `instances` (sealed with the
  existing `Sealer`). Settings dialog gains a calendars section with a test-fetch button, like the
  instance test connection.
- Events are not stored (read through); the only persisted mapping is
  `meeting_mappings(id, match_kind, match_value, instance_id, issue_key)`, with a match on a
  normalised event title (or a recurring series UID) to a ticket, remembered when the owner picks one.
- Meetings appear on Today as a list for that day (start/end local, title); each has a "Log time"
  action that opens the existing entry dialog (`that-entry-dialog`) prefilled with duration and
  comment = title, ticket = the remembered mapping or a picker (`that-issue-search`).
- "Attended" is not knowable from an ICS feed. Recommended: the app does not guess; every event is
  shown and the owner picks the ones to log; declined events can be hidden if the feed carries
  `PARTSTAT` (Google's does; Outlook's often does not).
- Day boundary: the visible day is a local day in `THAT_TIMEZONE`. All-day events (`DATE` values) are
  floating dates, not instants, and must not shift by zone; events crossing midnight appear on both
  days or on the start day (decide). The server expands recurrences within the local day window.
- Created entries get `started_at` from the event: this is the first case where a start time is
  known and the owner wants it kept. The stamp rule (`entries.go:190`) forbids it today; deciding
  whether an event-based entry may carry the event start is part of this ticket, tied to #130.
- Alternative: Microsoft Graph with OAuth. Richer (RSVP, real attendance) but needs tenant admin
  consent and an OAuth redirect on a LAN app; much larger.

**Acceptance criteria**
- [ ] Migration adds `calendars` (sealed URL) and the mapping table; the URL is never returned by the API after save (same rule as the Jira token) and is encrypted at rest (test: raw column differs from the URL, opens with the Sealer).
- [ ] Settings: add, test and remove a calendar; test reports the specific failure (unreachable, not an ICS, 401/403), per the owner's rule that every failure says what went wrong (#176).
- [ ] Fetch client has a timeout and size cap; tests use an `httptest.Server`; no test contacts a real calendar.
- [ ] `GET /api/meetings?day=YYYY-MM-DD` returns that local day's events (title, local start/end, calendar). Table-driven tests: an event 23:30-00:30 UTC for a user in Europe/Amsterdam falls on the correct local day; an all-day event is on its own date regardless of zone; DST-change day; a recurring weekly event with an `EXDATE`; a cancelled instance.
- [ ] "Log time" opens the entry dialog prefilled; submitting creates a normal entry (same push semantics: unpushed until pushed, one entry = one worklog).
- [ ] Choosing a ticket for a meeting remembers the mapping; the next occurrence of the same series/title is prefilled and the owner can override it.
- [ ] An event already logged is marked so it cannot be logged twice by accident.
- [ ] If the feed fails, Today still works and says which calendar failed and why.
- [ ] UI in both themes, e2e on Firefox and Chromium with a stub ICS served by the test rig, screenshots in both themes.
- [ ] `.env.example` untouched (no new env var needed; calendars are configured in Settings). If a `THAT_*` var turns out needed, document it there.

**Out of scope.** Writing to the calendar, accepting/declining invites, attendee lists, Graph/Google
OAuth (unless the owner chooses it), background sync, notifications, auto-logging meetings without
confirmation, attendance detection, multi-account calendar merging rules.

**Questions for the owner**
1. Which calendar do you need: Outlook/M365, Google, or both, and can you create an ICS/published link from it (corporate tenants often disable it)? Recommended: ICS URL. If the work tenant blocks it, the choice becomes OAuth/Graph (admin consent, much larger) or manual .ics import. This decides the ticket's size.
2. May the app take a dependency for iCalendar parsing and recurrence (stdlib has none)? Recommended: yes, one small vetted library; hand-written RRULE expansion is the main correctness risk.
3. Should a log-from-meeting entry keep the meeting's real start time (a start-time exception to the server-stamp rule), or is the duration enough? Recommended: keep the start, since it also lets #130 draw it correctly. This is the same question as #130's question 2, so settle both together.

**Design session needed?** Yes. Nothing draws a meeting list, a calendar setting, or a "log from
meeting" action. Questions for the session: where meetings appear (Today section, the timeline from
#130, or Week); row anatomy and the "logged" state; the ticket mapping picker and how a remembered
mapping is shown and changed; the Settings section for calendars (reuses the instance pattern);
all-day and multi-day events; what a failing calendar looks like; phone width.

**Type label.** `enhancement`.

**Size.** L as ICS-read-only with a parser dependency (parser, recurrence, tz, settings, mapping,
Today list, dialog integration). XL if OAuth (Graph or Google) is chosen.

**Dependencies.** Soft: #130 (clock-time axis and the start-time question), #111 (todo from a
meeting, deferred). Uses the shipped entry dialog and Settings. If OAuth is chosen, it also depends
on ticket 13 (LAN/HTTPS) or a localhost-only callback.
