# Plan — manual time entry and the day total (#7)

**Date:** 2026-08-21
**Supersedes:** nothing
**Superseded by:** nothing

Turns #7's approved design into a store layer, an `/api/entries` resource, a duration control, the
entry dialog, the row trigger that opens it, and the rail's first live data. The design is
`docs/superpowers/specs/2026-08-21-manual-time-entry-design.md`, approved 2026-08-21; where a
question is open, that document answers it.

Nothing here talks to Jira. The worklog push is #9, and no test in this ticket needs a fake Jira
server.

## What the design already settles

Read the spec for the whole of it. The decisions this plan works under, none reopened here: the
dialog is the only manual surface; the duration control is a glued stepper you can type into,
always landing on a quarter hour; `started_at` is never edited, so `PATCH` carries `seconds` and
`comment` only; every destructive action confirms; the rail owns its own data; and the API
deliberately does **not** enforce the 15-minute grid, because #8's timer will produce 7m13s.

Two things were settled in the browser on 2026-08-21 and are recorded in the spec rather than
rediscovered here: the trigger is the row's duration cell carrying a **"Log" hint** that expands on
hover, and editing loads the entry into the **single foot form**, whose field row is identical in
both modes.

## Three facts found while planning

**The spec's event name breaks a rule #6 set.** `that-combobox.ts` dispatches `that-search`,
`that-select` and `that-cancel`, because a custom event named `select` collided with the native
text-selection event in light DOM and crashed a handler. The spec names this ticket's event
`entries-changed`. Nothing native is called that, so it is not the same bug — but the rule as
recorded is that every custom event this app raises is prefixed. **Use `that-entries-changed`**, and
treat the spec's unprefixed spelling as the slip it is rather than a third convention.

**No migration is needed, and the schema is already right.** `time_entries` and both its indexes
came in `2026-08-07_120000_initial.sql`, and `idx_entries_issue_day (instance_id, issue_key, day)`
is exactly the lookup the dialog performs. `worklog_id` and `pushed_at` exist and stay `NULL` — this
ticket reads them and writes neither, because push state is derived and #9 owns it.

**`Server` has no clock to inject yet.** `internal/server/server.go` holds `cfg`, `assets`, `db`,
`sealer`, `clients`, `mux` and nothing else. The day-boundary test is unprovable without an injected
instant — you cannot make the test machine be 11pm in Auckland — so the field is a prerequisite of
the API task, not a refinement of it. `cfg.Location` is already a validated `*time.Location`, so
nothing parses a zone name at request time.

## Tasks

Each task ends green before the next begins. `make verify` after every task; `make test-e2e` after
every task from 4 on. **Every implementation task is TDD: the failing output goes in the task report,
and a task that cannot show its RED is not done.**

Task 2 must land before task 3. Task 4 must land before tasks 5 and 6. Nothing else is ordered.

---

### Task 1 — the store

**Create** `internal/store/entries.go` — `Entry`, `EntryInput`, and `EntriesForDay(ctx, from, to)`,
`EntriesForIssueDay(ctx, instanceID, key, day)`, `CreateEntry`, `UpdateEntry(ctx, id, seconds,
comment)`, `DeleteEntry`.
**Create** `internal/store/entries_test.go`.

Consumes `openTestStore` and `createTestInstance` from the existing test files, and `scanner`,
`nullable` and `errNoRowsIfUnaffected` from `instances.go`. Both read paths return oldest first and
an empty slice rather than nil, matching `Instances` and `Pins`.

**Test:** a round trip including an empty comment; `EntriesForDay` oldest-first and empty-not-nil;
`EntriesForIssueDay` filtering on all three columns; `DeleteEntry` on a missing id giving
`sql.ErrNoRows`; an instance's removal cascading to its entries.

**`UpdateEntry` is verified by reading the row back** — asserting `seconds` and `comment` changed
while `day` and `started_at` did not. #6's review found a "never unpins" test reading a snapshot
taken before the code under test ran; that shape is not repeated here.

**Verify:** `make test-go`.

---

### Task 2 — the injected clock

**Modify** `internal/server/server.go`: `Server` gains `now func() time.Time`, defaulted to
`time.Now` in `New`, with a test-only setter or direct field assignment from within the package.

Nothing else changes. This is its own task because task 3's central test depends on it and because a
clock threaded through later is a clock threaded through badly.

**Verify:** `make verify`.

---

### Task 3 — the API

**Create** `internal/server/entries.go` — `GET/POST/PATCH/DELETE /api/entries`, registered in
`server.go` beside the pins routes. `instances.go` and `issues.go` are untouched.
**Create** `internal/server/entries_test.go`.

`GET` takes optional inclusive `from`/`to`, both defaulting to today resolved in `THAT_TIMEZONE`.
`POST` stamps `day` and `startedAt` from one instant and **never accepts either from the client**.
The response is a bare array; `instanceName` and `instancePosition` are joined in from the instances
the handler already loads. Rejection order for `POST`: malformed body, blank `issueKey` or missing
`instanceId` → 400 `invalid_request`; unknown `instanceId` → 404 `instance_not_found`; `seconds`
zero, negative or over 24h → 400 `invalid_request`. A non-numeric id is 400 `invalid_request`,
following `/api/pins/{id}`.

**The day boundary is the test that matters**, table-driven over the injected clock:

| Instant (UTC) | `THAT_TIMEZONE` | Local | `day` must be | UTC would say |
|---|---|---|---|---|
| `2026-08-21T13:00:00Z` | Pacific/Auckland | 22nd, 01:00 | `2026-08-22` | `2026-08-21` |
| `2026-08-21T02:00:00Z` | America/Los_Angeles | 20th, 19:00 | `2026-08-20` | `2026-08-21` |

Two zones of opposite sign, so neither a hardcoded offset nor a dropped conversion survives.
**Proven by mutation:** replace the conversion with `now.UTC().Format(...)`, watch both rows fail,
restore, and put both outputs in the task report.

Two more tests carry their reasoning in their names: **`POST` ignores a client-supplied `day` and
`startedAt`** (the body sends both, deliberately wrong), and **`POST` accepts seconds that are not a
multiple of 900**, so the tightening the design forbids fails a gate instead of breaking #8.

**Verify:** `make verify`, with the mutation output pasted.

---

### Task 4 — the duration control

**Create** `web/src/components/that-duration.ts` — `−` / field / `+` as one bordered group, radius on
the outside only, hairline dividers between, focus ring on the group via `:focus-within`.
`−`/`+` and ↑/↓ move by 15 minutes; typed digits commit on Enter or blur; `inputmode="numeric"`.
**Create** the parse rule as an exported pure function, and cover it under `node:test` beside
`web/src/format.test.ts` — the same deliberately rudimentary shape #44 landed, not wired into
`make verify`, for #51 to absorb.

The table in the spec is the specification: `300` → 3h, `1100` → 11h, `45` → 45m, **`7` → 0h 15m**,
`175` → 2h 15m, `8:15` → 8h 15m, `0` → zero, `12345` refused, over 24h refused.

**`7` → 0h 15m is the line a later reader will "simplify".** Rounding to nearest gives zero, and a
control that swallows what you typed reads as broken. The test must fail if someone drops the
minimum-one-step clause.

**Verify:** `docker compose run --rm --no-deps web node --test src/components/that-duration.test.ts`,
plus `make verify`.

---

### Task 5 — the dialog

**Create** `web/src/components/that-entry-dialog.ts`.
**Modify** `web/src/api.ts` and `web/src/types.ts` — `listEntries`, `createEntry`, `updateEntry`,
`deleteEntry`, and the `Entry` type carrying `instanceName` and `instancePosition`.

A native `<dialog>` opened with `showModal()`, following `that-confirm`: no backdrop dismissal, and an
explicit margin, because Preflight's `* { margin: 0 }` beats the UA's `dialog { margin: auto }` and
the dialog otherwise lands top-left in both target browsers.

**The header is the board's:** the summary as an `<h2>`, a muted `KEY · Instance · Status` line, the
ticket's day total at 22px, and a round Close — in a 560px card. Then the entries, each showing its
start time muted, its duration, its comment, edit and delete. Empty reads "Nothing logged against
this ticket today."

**The foot form is the only place anything is typed**, and editing loads the entry into it. In edit
mode the field row does not change: the mode is named on a line of its own — 11px uppercase,
"Editing the 09:15 entry", with the dismissing `×` at that line's right end — and the row being
edited is the only one left undimmed. **Cancel stays visible**; Esc alone will not do, for the
reason #29 recorded.

**Deleting confirms** through `confirmDestructive`. That opens a modal `<dialog>` from inside a
modal `<dialog>`: **Esc must close only the confirmation**, leaving the entry dialog open with focus
back on its row. Assert it, do not assume it.

**The dialog is appended to the view root, never inside the row that opened it** — Today still
re-renders wholesale, and a refresh landing mid-edit would destroy the element being typed into,
which is #29's bug in new clothes.

After every mutation the dialog refreshes its list, the trigger's total updates, and a
`that-entries-changed` event goes up for the rail.

**Verify:** `make verify`, then `make test-e2e`.

---

### Task 6 — the trigger

**Modify** `web/src/components/that-ticket-row.ts` and the pinned rows in `web/src/views/today.ts`, so
assigned and pinned rows alike carry the duration cell.

A `<button aria-haspopup="dialog">` showing that ticket's total for the day — `0:00` when there is
none — with a **"Log" hint** at 12px uppercase in `--color-primary` to its left, expanding from zero
width on hover and on `:focus-visible`. It stays a button because #8 adds its start/stop control
beside it.

**The hint widens the button and the summary re-truncates while it is out.** Measured on 2026-08-21:
"Retry a worklog push that faile…" at rest, "Retry a worklog push that f…" hovered. The owner chose
this knowing the cost. **It is a consequence, not a defect — do not reserve the width to "fix" it.**

**Verify:** `make verify`, then `make test-e2e`.

---

### Task 7 — the rail

**Create** a shell-level module owning the rail's total and split, and **modify** `web/index.html`
where #44 left those two regions in their resting state with a comment naming this ticket.

It calls `GET /api/entries`, sums `seconds` for the total, groups by `instanceId` for the split, and
draws each instance's dot from `instancePosition` via `paintInstanceDot`. It renders on load and on
every `that-entries-changed`. **Living in the shell rather than in Today is the whole point** — it is
what keeps it right on Settings and on #11's Week view without either knowing it exists.

Three rules from #44 bind it: a total is `Nh Nm` and never `H:MM`; every figure carries
`tabular-nums`; and with nothing logged there is **no split bar at all**, so #44's "Nothing to split
yet" line stays until there is something to divide.

It never computes a date. It sums rows the server already stamped.

**Verify:** `index.html` stays under 14kB. `make verify`, then `make test-e2e`.

---

### Task 8 — the gates

**Create** `.claude/e2e/tests/entries.spec.ts`.
**Modify** `docs/superpowers/specs/2026-08-04-thatapp-design.md` — line 238 says manual
entries "default to the time the entry was created and remain editable"; the second half is now
false, and this ticket corrects it as #6 corrected the `pinned_issues` block.

**Assertions target the posted payload, not only the rendered text**: typing `300` must send
`seconds: 10800`, and `7` must send `900`. A control that renders `3h 00m` while posting the wrong
integer is the class of defect this project keeps finding.

- Add, edit and delete each move the row total **and** the rail total with no reload.
- Deleting raises the confirmation; Esc closes only the confirmation, the dialog stays open, focus
  returns to the row.
- The dialog opens from a pinned row as well as an assigned one.
- After adding an entry on Today, **navigating to Settings still shows the right rail total** —
  which fails if anything about the rail is wired through the Today view.
- Pressing Refresh with the dialog open leaves it open and its mid-edit state intact.
- The trigger opens from the keyboard: Tab reaches the duration cell, Enter opens the dialog.
- Editing binds the foot form to one entry: edit loads it, Save `PATCH`es that id, Cancel changes
  nothing.

`.github/workflows/e2e.yml` needs no change — its `paths:` list already carries `web/**` and
`.claude/e2e/**`. Confirm that rather than assuming it.

**Verify:** `make verify` and `make test-e2e` green on Firefox and Chromium, output pasted into the
pull request.

---

## Working rules carried from #6

**Write the plan's test, then ask whether it would fail if the code it guards were wrong.** Six
defects were found in #6's plan-supplied material, every one an assertion aimed at the wrong
observable — a path `net/http` had already decoded, a mutation returning an always-nil `ctx.Err()`,
a snapshot read before the code under test ran, two lookups the implementation never made, a title
promising ordering it never asserted, and a Tailwind token that has never existed here. Treat "no,
it would still pass" as a defect to fix rather than scope to defend.

**`.claude/e2e/` has no `.prettierrc.json`,** so prettier run from that directory reflows at 80
instead of `web/`'s 100 and silently rewrote 68 lines during #6. Do not format from there.

**A stale bundle can survive a rebuild.** `/app.js` is unhashed and cacheable while `build.mjs`
never cleans `dist/`. Hard-reload before believing any frontend measurement.

## What this ticket does not do

The timer and its start/stop control (#8) — the row leaves space for it. Anything that talks to Jira
(#9): no worklog, no push state displayed, and the per-entry "In Jira" / "Not pushed" chip the board
draws is deferred there. Editing `started_at`, ever. The week's totals (#11), which reuse
`GET /api/entries` with a range. Reordering or grouping entries beyond oldest-first. Wiring the
frontend test gate (#51).
