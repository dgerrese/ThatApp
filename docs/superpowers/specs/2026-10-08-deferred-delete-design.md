# #280 — A delete of a pushed entry waits for Push

**Date:** 2026-10-08
**Supersedes:** the deletion paragraph of *Push semantics* in
[`2026-08-04-thatapp-design.md`](2026-08-04-thatapp-design.md), which this ticket rewrites
**Superseded by:** nothing

Deleting an entry Jira already holds deletes the Jira worklog in the same request today
(`handleDeleteEntry`, `internal/server/entries.go`). Every other change to Jira waits for Push. This
makes the delete wait too. The behaviour decisions are the owner's from refinement (2026-10-07, on
the ticket); the visual decisions are the owner's from the design session of 2026-10-08, held on the
local browser companion.

## Decisions

### From refinement

1. **Only an entry with a `worklog_id` waits.** An unpushed entry has nothing in Jira; its delete
   stays local and immediate, as today.
2. **A pending delete counts in no total** — not the dialog's, Today's rows, the rail's, Week's cells
   or Week's day totals. Totals show what Jira will hold after the push.
3. **A pending delete can be restored** before the push. Restore returns the entry to the push
   state it had before: pushed or dirty.
4. **The MCP `delete_entry` tool may delete a pushed entry**, because a delete now only marks it.
   The refusal #253 added (`entryReachedJira`, `mcpJiraDeleteRefusal`) is removed.

### From the design session

5. **The entry dialog row (option C).** A pending-delete row keeps its place and its layout. Its
   duration and comment are struck through and drawn in `--color-ink-muted`. The new mark (decision
   6) sits in the mark slot. **Restore takes the delete slot** — the control that caused the state is
   where it is undone — and the edit slot stays empty, holding its width, so nothing in the row
   moves. Restore is a glyph button like its neighbours: a drawn undo arrow, tooltip
   `restore entry`, accessible name `Restore the HH:MM entry`.
6. **The mark (A1): a slashed ring.** The dirty ring with a slash inside it, like a "no entry" sign,
   in `--color-dirty` — a pending delete is "Jira holds it and Jira is now wrong", which is dirty's
   reason for its hue. Drawn as SVG on a 9×9 box: a circle of radius 3.75 with a 1.5 stroke, and a
   slash from (2.15, 6.85) to (6.85, 2.15), 1.5 stroke, round caps, stopping at the ring's inner
   edge. Words: **`deleted at next push`**. It is the first mark drawn as SVG; the other four stay
   CSS-drawn.

   ```svg
   <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true">
     <circle cx="4.5" cy="4.5" r="3.75" fill="none" stroke="currentColor" stroke-width="1.5"/>
     <path d="M2.15 6.85 6.85 2.15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
   </svg>
   ```
7. **Week uses the new mark (option A).** A pending delete is a state of its own in the rollup,
   ranked **not pushed > deleted at next push > edited since pushed > pushed**. A cell, and a day
   total, wear the mark of their worst entry, as now. **A cell whose only entries are pending deletes
   keeps its `—` and also wears the mark**, so it does not read as a day with nothing on it. Its
   popover reads `No time logged · deleted at next push · click to edit`, and its accessible name
   names the state the same way; a cell with time reads `1h 30m · deleted at next push · click to
   edit`.
8. **Today draws nothing new.** A Today row shows only its total, which leaves pending deletes out —
   a ticket whose only time today is a pending delete reads `Log 0:00`. The rail counts a pending
   delete in `N entries to push`, and Push stays enabled while one waits. Seeing and restoring it
   happen in the entry dialog.
9. **The confirm wording.** For an entry with a `worklog_id`:

   > **Delete this entry?**
   > 1h 30m logged at 10:15 will be deleted at the next push. You can restore it until then.
   > [Delete]

   It deliberately does not name Jira. An unpushed entry keeps today's text
   (`… will be removed.`), which stays true because that delete is immediate.

## State

A nullable `deleted_at` column on `time_entries`, added by a migration. **The state is derived from
columns, never stored as a flag**, as *Where correctness lives* requires:

| State | Condition | Push action |
|---|---|---|
| Unpushed | `worklog_id IS NULL` | create the worklog, store the id, set `pushed_at` |
| Pushed, clean | `worklog_id NOT NULL AND deleted_at IS NULL AND updated_at <= pushed_at` | none |
| Pushed, dirty | `worklog_id NOT NULL AND deleted_at IS NULL AND (pushed_at IS NULL OR updated_at > pushed_at)` | update the worklog, set `pushed_at` |
| **Pending delete** | `worklog_id NOT NULL AND deleted_at IS NOT NULL` | delete the worklog (a Jira 404 counts as success), then delete the row |

An unpushed row never carries `deleted_at`: its delete removes the row.

**Setting and clearing `deleted_at` never touches `updated_at` or `pushed_at`.** That is what lets
Restore return the entry to exactly the state it had — pushed stays pushed, dirty stays dirty — with
nothing to remember. A plausible refactor that stamps `updated_at` on every write would turn every
restored entry dirty; a table-driven test pins it.

The API's `pushState` gains a fourth value, **`deleted`**. A cached shell that does not know it
falls back to `unpushed` through `knownPushState`, the existing safe direction.

## API

- **`DELETE /api/entries/{id}`** — with a `worklog_id`: set `deleted_at`, make no Jira call, answer
  204. Without one: delete the row, as today. Still under `pushMu`. Deleting an entry already
  pending delete is a no-op 204.
- **`POST /api/entries/{id}/restore`** — new. Clears `deleted_at` and answers 200 with the entry.
  404 when the entry does not exist; 409 when it is not pending delete. Under `pushMu`.
- **`PATCH /api/entries/{id}`** — answers 409 for a pending-delete entry. Restore first.
- **`GET /api/entries`** — returns pending-delete rows with `pushState: "deleted"`, so the dialog can
  draw them. Every client-side sum skips them: the dialog total, Today's row and instance totals,
  and the rail's total and split (`that-entry-dialog.ts`, `views/today.ts`, `rail.ts`).
- **`GET /api/week`** — cell and day `seconds` leave pending deletes out; `pushState` ranks
  `deleted` as decision 7 says. A cell with only pending deletes has `seconds: 0` and
  `pushState: "deleted"`, which is how the grid tells it from an empty cell (`pushState: null`).

## Push

`POST /api/push?day=` also handles the day's pending deletes: `DeleteWorklog` on the entry's
instance, a Jira 404 counted as success, then the local row is deleted. A failure keeps the row and
its `deleted_at`, is reported per entry like any other failure, and is retried by the next push. The
result gives a deleted entry a status that says it was deleted, so the push report can name it. A
repeated push after a successful delete makes no request for that entry — its row is gone.

The push is still not transactional across instances: each entry succeeds or fails on its own.

## Fetch

A remote worklog whose id matches a pending-delete row is left alone. Fetch does not re-create the
row, overwrite it or clear its marker: **the delete wins.** A pending-delete row whose worklog did
not come back is left alone, as fetch already treats any such row
([`2026-09-07-edit-after-push-and-week-fetch-design.md`](2026-09-07-edit-after-push-and-week-fetch-design.md));
the next push's 404 then settles it.

## MCP

`delete_entry` deletes a pushed entry by marking it, through the same store call as the HTTP
handler, and its refusal for entries that reached Jira is removed with `entryReachedJira` and
`mcpJiraDeleteRefusal`. The entry-listing tools report `pushState: "deleted"` and leave pending
deletes out of their totals, matching the API.

## Documents this ticket changes

- **Design of record**, *Push semantics*: the state table gains the pending-delete row, and the
  deletion paragraph is rewritten for the deferred delete.
- **The visual language** (`2026-08-20-visual-design-language.md`, *Roles*): the slashed ring joins
  disc, ring and triangle, with its words and why it shares dirty's hue.
- `handoff.md`: the note to remove the MCP refusal when #280 lands is settled by this ticket.

## Testing

- **Table-driven, store and server**: the derived state over every combination of `worklog_id`,
  `updated_at`, `pushed_at` and `deleted_at`; delete then restore returns pushed to pushed and dirty
  to dirty; push idempotence — a second push after a successful delete makes no request; a failed
  Jira delete keeps the row and marker; a Jira 404 counts as success; fetch leaves a pending-delete
  row untouched; the Week rank with `deleted` among the other three; restore's 404 and 409; PATCH's
  409.
- **Jira** is an `httptest.Server`, as always.
- **Playwright**: the struck row, its mark and Restore in the delete slot; restore brings the entry
  and its total back; the confirm text for a pushed and an unpushed entry; a Week cell with time and
  a pending delete, and an emptied cell's `—` with the mark and its popover; Today's row total and the
  rail's count. Firefox and Chromium.
- **Screenshots** of the dialog row and the Week cells, light and dark, on the pull request.

## Out of scope

- Deleting a worklog in Jira that has no local entry.
- Any change to how an unpushed entry is deleted.
- Bulk delete.
- A push mark on Today's rows.
