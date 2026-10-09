# A delete of a pushed entry waits for Push — Implementation Plan

**Date:** 2026-10-09
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deleting an entry Jira already holds only marks it (`deleted_at`); the next push deletes the Jira worklog and then the row, the entry can be restored until then, and a pending delete counts in no total and wears its own mark — the slashed ring — in the entry dialog and on Week (#280).

**Architecture:** One nullable column, `time_entries.deleted_at`, and a fourth derived state, `deleted`, read by `pushStateOf` from `worklog_id` + `deleted_at` (never a flag). `DELETE /api/entries/{id}` marks instead of calling Jira; a new `POST /api/entries/{id}/restore` clears the mark; `PATCH` refuses a marked entry; the push gains a delete branch; the fetch's reconciliation leaves a marked row alone; Week's sums skip it and its rank slots between unpushed and dirty. The MCP refusal from #253 goes, because the delete it guarded no longer reaches Jira. In the browser, `PUSH_MARKS` gains `deleted` (an SVG mark), one helper `countsInTotals` is used by every client-side sum, and the dialog row strikes itself and swaps Delete for Restore.

**Tech Stack:** Go standard library + `modernc.org/sqlite` (already approved); TypeScript (vanilla, light-DOM `that-*` components); Tailwind v4 utilities; `node --test` with happy-dom for unit tests; Playwright (Firefox and Chromium).

**Spec:** `docs/superpowers/specs/2026-10-08-deferred-delete-design.md` (decisions 1–9, *State*, *API*, *Push*, *Fetch*, *MCP*, *Testing*). Ticket: Codeberg #280 (body and its acceptance criteria are binding; its one comment is the 2026-10-08 block, since lifted by the design session). Design of record: `docs/superpowers/specs/2026-08-04-thatapp-design.md` (*Push semantics*). Visual language: `docs/superpowers/specs/2026-08-20-visual-design-language.md` (*Roles*). The design session's drawings: `.superpowers/brainstorm/333584-1791464716/content/01-dialog-row.html` (option C), `03-mark-a-clean.html` (A1), `04-week-cell.html` (option A).

## Global Constraints

- All tooling through `make` or `docker compose`; never Go, Node or npm on the host. Nothing in this plan needs the dev stack; if you open it anyway, `THAT_PORT` in `.env` is `8081` — read it, do not assume.
- **Go:** standard library first; no new dependency, no new `THAT_*` variable. Wrap errors with `%w` and what was attempted. Table-driven tests with `t.Run`; Jira is always an `httptest.Server` — **no test contacts a real Jira instance.**
- **The state stays derived.** `pushStateOf` reads `worklog_id`, `deleted_at`, `pushed_at`, `updated_at`; nothing stores a state. **Setting and clearing `deleted_at` never touches `updated_at` or `pushed_at`** — Task 1 pins it.
- Wire values, verbatim from the spec: `pushState` `"deleted"`; mark words **`deleted at next push`**; tooltip `restore entry`; accessible name `Restore the HH:MM entry`; confirm body for an entry with a worklog `<figure> logged at <HH:MM> will be deleted at the next push. You can restore it until then.`, for one without `<figure> logged at <HH:MM> will be removed.`; Week popovers `No time logged · deleted at next push · click to edit` and `1h 30m · deleted at next push · click to edit`. Rank: **not pushed > deleted at next push > edited since pushed > pushed**.
- The slashed ring, verbatim: a 9×9 SVG, `<circle cx="4.5" cy="4.5" r="3.75" fill="none" stroke="currentColor" stroke-width="1.5"/>` and `<path d="M2.15 6.85 6.85 2.15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`, in `--color-dirty` (`text-dirty`). The other marks stay CSS-drawn.
- Frontend: vanilla TS, `strict` + `noUncheckedIndexedAccess`; no `any`, no `as any`, no `!`. Light DOM only. Firefox and Chromium only — never add WebKit.
- Comments: few; a non-obvious why only. Names say what they return.
- **TDD, per task.** RED must fail on an **assertion**, for the reason the test names — never a compile error (a task's first step adds the bare declarations its tests need) and never a timeout on a typo'd locator. The task report quotes the RED line. A test marked *guard* passes before its task's change and is proven entirely by mutation. **Every assertion a task adds is proven by mutation**: break the guarded code by hand, run that one test, show it red, restore, show it green; the report lists each mutation with its red line.
- Commands:

  ```shell
  # One Go test (or a regex of them)
  docker compose run --build --rm --no-deps app go test ./internal/server/ -run 'TestDeleteEntryWaitsForPush' -count=1 -v
  docker compose run --build --rm --no-deps app go test ./internal/store/ -run 'TestDeletedAt' -count=1 -v
  # The Go suite
  make test-go
  # Format, then lint
  docker compose run --rm --no-deps lint golangci-lint fmt
  make lint
  # Frontend unit tests: one file, or all of them
  docker compose run --build --rm --no-deps web node --test src/push-marks.test.ts
  make test-web
  # Prettier on web/src only (never on .claude/e2e — it has no config)
  docker compose run --rm --no-deps web npx prettier --write src/push-marks.ts
  # Type check
  make tsc
  # One e2e spec — the rig's own disposable app-e2e; always clean up around it
  docker compose --profile e2e rm --stop --force app-e2e
  docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test deferred-delete.spec.ts --reporter=line'
  docker compose --profile e2e rm --stop --force app-e2e
  ```

  Add `-g "<title fragment>"` to the Playwright command to run one test (every mutation run).
- Commits: if `git commit` fails on signing (a locked 1Password vault), retry the same commit with `git -c commit.gpgsign=false commit …` and carry on; note the last signed commit in the report. **Never push.** Never merge into `main`.
- Branch: `issue-280-deferred-delete`, already checked out. Do not switch, stash or reset.
- `docs/superpowers/plans/handoff.md` is not touched by this plan.

## Rulings made before execution

The spec decides behaviour and drawing; these are the places it is silent. The controller's, reversible by the owner.

1. **A day total whose only entries are pending deletes** gets the same treatment as such a cell (decision 7): a muted `—` wearing the slashed ring. The spec names the cell; a footer reading a plain `—` under a marked cell would say the day holds nothing.
2. **The push report** counts deletes the way the fetch report counts its two figures: `Pushed 2 entries and deleted 1.`; with no deletes it reads exactly as today (`Pushed 1 entry.`).
3. **A delete Jira took but the store could not record** (the row survived `DeleteEntry`) is failure code **`delete_unrecorded`**, not `store_failed`. `store_failed` makes the report say "do not push again"; here pushing again is the fix, because the next attempt's 404 counts as success.
4. **409 codes:** `PATCH` on a pending delete → `entry_pending_delete`; restore of an entry not pending delete → `entry_not_pending_delete`.
5. **Focus:** after a deferred delete, focus goes to that row's Restore (it sits where Delete was); after a restore, to that row's Delete. A row that is gone (an unpushed delete) falls back to Close, as today.
6. **Restore is drawn in `text-ink` at rest**, as the drawing (option C) has it; the other row glyphs stay `text-ink-muted`.
7. **The rail's push confirmation leaves pending deletes out of its total.** Its `N entries totalling X` still counts every pending entry in `N`, deletes included, because each one is work the push sends; but `X` sums only `countsInTotals` entries, because the design's decision 2 says a pending delete counts in no total. Set by the controller on 2026-10-09; the owner may reverse it.
8. **No `restore_entry` MCP tool.** The spec does not ask for one, and `TestMCPToolsListIsExactlyTheTen` pins ten.

## Review Focus

1. **A restore landing while a push is deleting the same entry** must wait for the push and then answer 404 — never 200 for a row the push is about to remove. Task 2's `TestRestoreWaitsForTheLockAPushHolds`.
2. **Jira deleted the worklog but the local row could not be removed**: the push must report it as a retryable failure (`delete_unrecorded`), never `store_failed`, whose report tells the user not to push again. Task 3's `TestPushReportsADeleteTheStoreLostAsRetryable`; Task 7's push-report guard.
3. **A pending delete on an entry edited since its push** must be pushed as one `DELETE` — never a `PUT` correction, never a fresh `POST`. Task 3's "an entry edited before its delete is deleted, not corrected" case.
4. **A ticket off Today's list whose only time today is a pending delete** must keep its off-list row (`Log 0:00`), or Restore becomes unreachable from Today. Task 7's off-list e2e test.
5. **Pressing Delete twice** (a double click, a second tab, the MCP tool after the app) must answer 204 and keep the first `deleted_at` stamp. Task 2's `TestDeletingAPendingDeleteAgainChangesNothing`.

---

### Task 1: The `deleted_at` column and the derived `deleted` state

**Files:**
- Create: `internal/store/migrations/2026-10-09_100000_entry_deleted_at.sql`
- Modify: `internal/store/entries.go` (`Entry`, `entryColumns`, `scanEntry`, two new methods)
- Modify: `internal/server/entries.go` (`pushStateOf` only)
- Test: `internal/store/entries_test.go`, `internal/server/entries_test.go`

**Interfaces:**
- Consumes: `errNoRowsIfUnaffected(result sql.Result, action string, id int64) error` (`internal/store/instances.go`); test helpers `openTestStore`, `createTestInstance`, `createTestEntry`.
- Produces:
  - `store.Entry.DeletedAt *time.Time`
  - `func (s *Store) MarkEntryDeleted(ctx context.Context, id int64, at time.Time) error` — sets `deleted_at` only if unset; missing id → wraps `sql.ErrNoRows`.
  - `func (s *Store) RestoreEntry(ctx context.Context, id int64) (*Entry, error)` — clears `deleted_at`, returns the row; missing id → wraps `sql.ErrNoRows`.
  - `pushStateOf(store.Entry) string` now also returns `"deleted"`.

- [ ] **Step 1: Bare declarations.** In `internal/store/entries.go`, add the field to `Entry` (after `PushedAt`):

```go
	DeletedAt  *time.Time
```

and, at the end of the file, two stubs:

```go
func (s *Store) MarkEntryDeleted(ctx context.Context, id int64, at time.Time) error {
	return nil
}

func (s *Store) RestoreEntry(ctx context.Context, id int64) (*Entry, error) {
	return s.Entry(ctx, id)
}
```

- [ ] **Step 2: Write the failing store tests.** Append to `internal/store/entries_test.go`:

```go
// samePushColumns fails the test when got differs from want in any column the
// push state is read from.
func samePushColumns(t *testing.T, when string, want, got Entry) {
	t.Helper()

	if got.WorklogID != want.WorklogID {
		t.Errorf("%s: WorklogID = %q, want %q", when, got.WorklogID, want.WorklogID)
	}
	if !got.UpdatedAt.Equal(want.UpdatedAt) {
		t.Errorf("%s: UpdatedAt = %v, want %v", when, got.UpdatedAt, want.UpdatedAt)
	}
	switch {
	case (got.PushedAt == nil) != (want.PushedAt == nil):
		t.Errorf("%s: PushedAt = %v, want %v", when, got.PushedAt, want.PushedAt)
	case got.PushedAt != nil && want.PushedAt != nil && !got.PushedAt.Equal(*want.PushedAt):
		t.Errorf("%s: PushedAt = %v, want %v", when, *got.PushedAt, *want.PushedAt)
	}
}

// Restore returns an entry to exactly the state it had, with nothing
// remembered, only because marking and clearing deleted_at move neither
// updated_at nor pushed_at. A refactor that stamps updated_at on every write
// would turn every restored entry dirty.
func TestDeletedAtLeavesThePushColumnsAlone(t *testing.T) {
	updated := time.Date(2026, 10, 9, 9, 0, 0, 0, time.UTC)

	cases := []struct {
		name      string
		worklogID string
		pushedAt  any
	}{
		{"pushed and clean", "10001", updated.Add(time.Hour).Format(time.RFC3339)},
		{"pushed, then edited", "10002", updated.Add(-time.Hour).Format(time.RFC3339)},
		{"a worklog with no mark", "10003", nil},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := openTestStore(t)
			inst := createTestInstance(t, s)
			ctx := context.Background()

			created := createTestEntry(t, s, EntryInput{
				InstanceID: inst.ID, IssueKey: "RIDGE-1", Day: "2026-10-09",
				StartedAt: updated, Seconds: 900,
			})
			if _, err := s.db.Exec(
				`UPDATE time_entries SET worklog_id = ?, pushed_at = ?, updated_at = ? WHERE id = ?`,
				tc.worklogID, tc.pushedAt, updated.Format(time.RFC3339), created.ID,
			); err != nil {
				t.Fatalf("putting the entry in state %q: %v", tc.name, err)
			}
			before, err := s.Entry(ctx, created.ID)
			if err != nil {
				t.Fatalf("reading the entry: %v", err)
			}

			first := time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)
			if err := s.MarkEntryDeleted(ctx, created.ID, first); err != nil {
				t.Fatalf("MarkEntryDeleted() returned error: %v", err)
			}
			marked, err := s.Entry(ctx, created.ID)
			if err != nil {
				t.Fatalf("reading the marked entry: %v", err)
			}
			if marked.DeletedAt == nil || !marked.DeletedAt.Equal(first) {
				t.Fatalf("DeletedAt = %v, want %v", marked.DeletedAt, first)
			}
			samePushColumns(t, "after the mark", *before, *marked)

			if err := s.MarkEntryDeleted(ctx, created.ID, first.Add(time.Hour)); err != nil {
				t.Fatalf("a second MarkEntryDeleted() returned error: %v", err)
			}
			again, err := s.Entry(ctx, created.ID)
			if err != nil {
				t.Fatalf("reading the twice-marked entry: %v", err)
			}
			if again.DeletedAt == nil || !again.DeletedAt.Equal(first) {
				t.Errorf("DeletedAt = %v after a second delete, want the first stamp %v",
					again.DeletedAt, first)
			}

			restored, err := s.RestoreEntry(ctx, created.ID)
			if err != nil {
				t.Fatalf("RestoreEntry() returned error: %v", err)
			}
			if restored.DeletedAt != nil {
				t.Errorf("DeletedAt = %v after the restore, want nil", *restored.DeletedAt)
			}
			samePushColumns(t, "after the restore", *before, *restored)
		})
	}
}

func TestDeletedAtOnAMissingEntryIsErrNoRows(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	if err := s.MarkEntryDeleted(ctx, 404, time.Now()); !errors.Is(err, sql.ErrNoRows) {
		t.Errorf("MarkEntryDeleted(404) = %v, want sql.ErrNoRows", err)
	}
	if _, err := s.RestoreEntry(ctx, 404); !errors.Is(err, sql.ErrNoRows) {
		t.Errorf("RestoreEntry(404) = %v, want sql.ErrNoRows", err)
	}
}
```

The `RestoreEntry(404)` half is a *guard* (the stub's `s.Entry` already wraps `sql.ErrNoRows`).

- [ ] **Step 3: Write the failing state test.** In `internal/server/entries_test.go`, in `TestPushStateOfDerivesFromTheTwoColumnsAndUpdatedAt`, add after `pushed := base.Add(time.Minute)`:

```go
	deleted := base.Add(2 * time.Minute)
```

and append these cases to its `cases` slice:

```go
		{
			name:  "pushed, then deleted",
			entry: store.Entry{WorklogID: "10123", PushedAt: &pushed, UpdatedAt: base, DeletedAt: &deleted},
			want:  "deleted",
		},
		{
			// Whatever Jira holds, the push's next act is to delete it.
			name:  "edited after the push, then deleted",
			entry: store.Entry{WorklogID: "10123", PushedAt: &base, UpdatedAt: pushed, DeletedAt: &deleted},
			want:  "deleted",
		},
		{
			name:  "a worklog id with no pushed_at, then deleted",
			entry: store.Entry{WorklogID: "10123", UpdatedAt: base, DeletedAt: &deleted},
			want:  "deleted",
		},
		{
			// An unpushed delete removes the row, so this row should not exist;
			// if it does, Jira holds nothing and the push must still create.
			name:  "a deleted_at without a worklog id is not a pending delete",
			entry: store.Entry{UpdatedAt: base, DeletedAt: &deleted},
			want:  "unpushed",
		},
```

- [ ] **Step 4: Run them; see RED.**

Run: `docker compose run --build --rm --no-deps app go test ./internal/store/ -run 'TestDeletedAt' -count=1 -v` and `docker compose run --build --rm --no-deps app go test ./internal/server/ -run 'TestPushStateOf' -count=1 -v`
Expected: `TestDeletedAtLeavesThePushColumnsAlone/*` FAIL on `DeletedAt = <nil>, want 2026-10-09 12:00:00 +0000 UTC`; `TestDeletedAtOnAMissingEntryIsErrNoRows` FAIL on `MarkEntryDeleted(404) = <nil>`; the three `…then deleted` cases FAIL on `pushStateOf() = "pushed"`/`"dirty"`, want `"deleted"`. The last new case passes (guard).

- [ ] **Step 5: The migration.** Create `internal/store/migrations/2026-10-09_100000_entry_deleted_at.sql`:

```sql
-- A delete of an entry Jira holds waits for the next push (#280). A timestamp
-- rather than a flag, so the push state stays derived from columns: a
-- worklog_id with a deleted_at is a pending delete.
ALTER TABLE time_entries ADD COLUMN deleted_at DATETIME;
```

- [ ] **Step 6: Read the column.** In `internal/store/entries.go`:

`entryColumns` becomes:

```go
const entryColumns = `id, instance_id, issue_key, CAST(day AS TEXT) AS day, started_at, seconds,
	comment, worklog_id, pushed_at, created_at, updated_at, deleted_at`
```

In `scanEntry`, add `deletedAt sql.NullString` to the `var` block, scan it last (`&comment, &worklogID, &pushedAt, &createdAt, &updatedAt, &deletedAt,`), and replace the `if pushedAt.Valid { … }` block with:

```go
	for _, field := range []struct {
		column string
		text   sql.NullString
		into   **time.Time
	}{
		{"pushed_at", pushedAt, &entry.PushedAt},
		{"deleted_at", deletedAt, &entry.DeletedAt},
	} {
		if !field.text.Valid {
			continue
		}
		parsed, err := time.Parse(time.RFC3339, field.text.String)
		if err != nil {
			return nil, fmt.Errorf("parsing %s %q: %w", field.column, field.text.String, err)
		}
		*field.into = &parsed
	}
```

Add one paragraph to the `Entry` doc comment, after the one ending "never stored as a flag.":

```go
// DeletedAt is set while a delete waits for the push (#280). Only an entry with
// a worklog is ever marked — one Jira has never seen is removed at once — and
// the mark is the only column a delete or a restore writes.
```

- [ ] **Step 7: The two methods.** Replace the stubs with:

```go
// MarkEntryDeleted records that the entry's delete waits for the next push. A
// second call keeps the first stamp. It writes deleted_at and nothing else:
// updated_at and pushed_at are what the push state is read from, and leaving
// them alone is what lets RestoreEntry hand back exactly the state the entry
// had — pushed stays pushed, dirty stays dirty. A missing id yields an error
// wrapping sql.ErrNoRows.
func (s *Store) MarkEntryDeleted(ctx context.Context, id int64, at time.Time) error {
	result, err := s.db.ExecContext(ctx,
		`UPDATE time_entries SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ?`,
		at.UTC().Truncate(time.Second).Format(time.RFC3339), id)
	if err != nil {
		return fmt.Errorf("marking entry %d deleted: %w", id, err)
	}

	return errNoRowsIfUnaffected(result, "marking entry deleted", id)
}

// RestoreEntry takes back a delete that is waiting for the push and returns
// the row. Like MarkEntryDeleted it touches no other column. A missing id
// yields an error wrapping sql.ErrNoRows.
func (s *Store) RestoreEntry(ctx context.Context, id int64) (*Entry, error) {
	result, err := s.db.ExecContext(ctx,
		`UPDATE time_entries SET deleted_at = NULL WHERE id = ?`, id)
	if err != nil {
		return nil, fmt.Errorf("restoring entry %d: %w", id, err)
	}
	if err := errNoRowsIfUnaffected(result, "restoring entry", id); err != nil {
		return nil, err
	}

	return s.Entry(ctx, id)
}
```

- [ ] **Step 8: Derive the state.** In `internal/server/entries.go`, `pushStateOf` becomes:

```go
// pushStateOf reports whether an entry has reached Jira, whether what Jira
// holds is current, and whether a delete is waiting for the push. It is
// computed from worklog_id, deleted_at, pushed_at and updated_at on every read
// rather than stored, which is what makes a repeated push idempotent for free.
//
// A worklog id is the whole of "it reached Jira": an entry carrying one but no
// pushed_at is dirty, not unpushed. That is the state a push leaves behind when
// an edit lands while Jira is answering — the worklog exists and holds the older
// text — and reading it as unpushed is what would have the next push create a
// second worklog for the same time.
//
// A pending delete outranks dirty and pushed: whatever Jira holds, the push's
// next act is to delete it. Unpushed outranks it, because Jira holds nothing
// for such a row and its delete removes the row instead of marking it.
func pushStateOf(e store.Entry) string {
	if e.WorklogID == "" {
		return "unpushed"
	}
	if e.DeletedAt != nil {
		return "deleted"
	}
	if e.PushedAt == nil || e.UpdatedAt.After(*e.PushedAt) {
		return "dirty"
	}

	return "pushed"
}
```

- [ ] **Step 9: Run them; see GREEN.** Same two commands as Step 4, then `make test-go`. Expected: PASS; the full suite still green (no caller marks anything yet).

- [ ] **Step 10: Mutations** (one test each; red, restore, green; report the red line):
  1. In `MarkEntryDeleted`, also `SET updated_at = ?` to `at` → `TestDeletedAtLeavesThePushColumnsAlone/*` red on `after the mark: UpdatedAt`.
  2. Drop `COALESCE(deleted_at, ?)` for a bare `?` → red on `after a second delete, want the first stamp`.
  3. In `RestoreEntry`, also `SET pushed_at = NULL` → `pushed and clean` and `pushed, then edited` red on `after the restore: PushedAt`.
  4. In `RestoreEntry`, `SET deleted_at = deleted_at` → red on `DeletedAt = … after the restore, want nil`.
  5. Drop `errNoRowsIfUnaffected` from `MarkEntryDeleted` (return nil) → `TestDeletedAtOnAMissingEntryIsErrNoRows` red; drop it from `RestoreEntry` and return `&Entry{}, nil` → same test red on `RestoreEntry(404)`.
  6. In `scanEntry`, drop the `deleted_at` element of the loop → red on `DeletedAt = <nil>`.
  7. In `pushStateOf`, move the `DeletedAt` check above the `WorklogID` check → `a deleted_at without a worklog id…` red; move it below the dirty check → `edited after the push, then deleted` and `a worklog id with no pushed_at, then deleted` red.

- [ ] **Step 11: Format, lint, commit.**

```bash
docker compose run --rm --no-deps lint golangci-lint fmt
make lint
git add internal/store/migrations/2026-10-09_100000_entry_deleted_at.sql internal/store/entries.go \
  internal/store/entries_test.go internal/server/entries.go internal/server/entries_test.go
git commit -m "feat(#280): deleted_at, and a pending delete derived from it

The mark is the only column a delete or a restore writes, so restoring
returns an entry to exactly the push state it had.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DhrQjSkmUmfVxLZHhaYLwQ"
```

---

### Task 2: DELETE marks, restore takes it back, PATCH refuses a marked entry

**Files:**
- Modify: `internal/server/entries.go` (`handleDeleteEntry`, new `handleRestoreEntry`, `handleUpdateEntry`)
- Modify: `internal/server/server.go` (one route)
- Test: `internal/server/entries_test.go` (replace `TestDeleteEntryRemovesTheWorklogFirst`; new tests), `internal/server/push_test.go` (rewrite `TestDeleteWhileAPushIsInFlightStillRemovesTheWorklog`)

**Interfaces:**
- Consumes (Task 1): `MarkEntryDeleted`, `RestoreEntry`, `Entry.DeletedAt`, `pushStateOf` → `"deleted"`. Codebase: `idFromPath`, `writeEntryStoreError`, `writeError`, `writeJSON`, `s.instanceIndex`, `s.entryDTOFrom`, `s.pushMu`, `s.now`. Test helpers: `newEntriesEnv` / `entriesEnv{s, store, inst, jira}` with `createEntry`, `markPushed`, `delete`; `makeEntryDirty`; `callEntries`, `decodeEntry`, `decodeEntries`, `assertRejected`; `newPushEnv`.
- Produces:
  - `POST /api/entries/{id}/restore` → 200 `entryDTO`; 404 `not_found`; 409 `entry_not_pending_delete`.
  - `DELETE /api/entries/{id}` → 204; with a worklog it marks and makes no Jira call.
  - `PATCH /api/entries/{id}` → 409 `entry_pending_delete` for a pending delete.
  - test helpers `(*entriesEnv).restore(t, id) *httptest.ResponseRecorder`, `(*entriesEnv).stored(t, id) store.Entry`.

- [ ] **Step 1: Test helpers.** In `internal/server/entries_test.go`, after `(*entriesEnv).delete`, add:

```go
func (env *entriesEnv) restore(t *testing.T, entryID int64) *httptest.ResponseRecorder {
	t.Helper()

	return callEntries(t, env.s, http.MethodPost,
		"/api/entries/"+strconv.FormatInt(entryID, 10)+"/restore", "")
}

// stored reads one entry back, failing the test if it is gone.
func (env *entriesEnv) stored(t *testing.T, entryID int64) store.Entry {
	t.Helper()

	entry, err := env.store.Entry(t.Context(), entryID)
	if err != nil {
		t.Fatalf("reading entry %d back: %v", entryID, err)
	}

	return *entry
}
```

- [ ] **Step 2: Write the failing tests.** Delete `TestDeleteEntryRemovesTheWorklogFirst` and its doc comment, and put in its place:

```go
// #280: a delete waits for the push like every other change to Jira. Only an
// entry Jira has never seen goes at once; one it holds is marked, and Jira
// hears nothing until the push.
func TestDeleteEntryWaitsForPush(t *testing.T) {
	tests := []struct {
		name        string
		pushed      bool
		dirty       bool
		wantRowGone bool
	}{
		{name: "an unpushed entry goes at once", wantRowGone: true},
		{name: "a pushed entry is marked", pushed: true},
		{name: "an entry edited since its push is marked", pushed: true, dirty: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			env := newEntriesEnv(t)
			entry := env.createEntry(t, "RID-1", 3600, "")
			if test.pushed {
				env.markPushed(t, entry.ID, "10001")
			}
			if test.dirty {
				makeEntryDirty(t, env.store, entry.ID, 5400, "reworded")
			}

			rec := env.delete(t, entry.ID)

			if rec.Code != http.StatusNoContent {
				t.Fatalf("status = %d, want 204 (body %s)", rec.Code, rec.Body)
			}
			if env.jira.deleteCalls != 0 {
				t.Fatalf("Jira saw %d deletes, want none: a delete waits for the push", env.jira.deleteCalls)
			}

			after, err := env.store.Entry(t.Context(), entry.ID)
			gone := errors.Is(err, sql.ErrNoRows)
			if gone != test.wantRowGone {
				t.Fatalf("row gone = %v, want %v", gone, test.wantRowGone)
			}
			if gone {
				return
			}
			if got := pushStateOf(*after); got != "deleted" {
				t.Fatalf("state = %q, want deleted", got)
			}
		})
	}
}

func TestListEntriesCarriesAPendingDelete(t *testing.T) {
	env := newEntriesEnv(t)
	entry := env.createEntry(t, "RID-1", 3600, "")
	env.markPushed(t, entry.ID, "10001")
	env.delete(t, entry.ID)

	got := decodeEntries(t, callEntries(t, env.s, http.MethodGet,
		"/api/entries?from=2026-08-31&to=2026-08-31", ""))

	if len(got) != 1 || got[0].PushState != "deleted" {
		t.Fatalf("entries = %+v, want the one entry, pushState deleted", got)
	}
}

func TestDeletingAPendingDeleteAgainChangesNothing(t *testing.T) {
	env := newEntriesEnv(t)
	entry := env.createEntry(t, "RID-1", 3600, "")
	env.markPushed(t, entry.ID, "10001")

	first := time.Date(2026, 8, 31, 17, 0, 0, 0, time.UTC)
	env.s.now = func() time.Time { return first }
	env.delete(t, entry.ID)

	env.s.now = func() time.Time { return first.Add(time.Hour) }
	rec := env.delete(t, entry.ID)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("second delete status = %d, want 204", rec.Code)
	}
	if after := env.stored(t, entry.ID); after.DeletedAt == nil || !after.DeletedAt.Equal(first) {
		t.Fatalf("DeletedAt = %v, want the first delete's %v", after.DeletedAt, first)
	}
	if env.jira.deleteCalls != 0 {
		t.Fatalf("Jira saw %d deletes, want none", env.jira.deleteCalls)
	}
}

// Restore is what makes the deferred delete safe to offer. The state comes back
// because the delete wrote nothing but the mark — Task 1 pins that at the
// store; this pins it through the two requests a person makes.
func TestRestoreReturnsTheEarlierPushState(t *testing.T) {
	for _, tc := range []struct {
		name  string
		dirty bool
		want  string
	}{
		{"a pushed entry comes back pushed", false, "pushed"},
		{"an edited entry comes back dirty", true, "dirty"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			env := newEntriesEnv(t)
			entry := env.createEntry(t, "RID-1", 3600, "")
			env.markPushed(t, entry.ID, "10001")
			if tc.dirty {
				makeEntryDirty(t, env.store, entry.ID, 5400, "reworded")
			}
			before := env.stored(t, entry.ID)
			env.delete(t, entry.ID)

			rec := env.restore(t, entry.ID)

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body)
			}
			if got := decodeEntry(t, rec); got.ID != entry.ID || got.PushState != tc.want {
				t.Fatalf("restored %+v, want entry %d in state %s", got, entry.ID, tc.want)
			}
			after := env.stored(t, entry.ID)
			if after.DeletedAt != nil {
				t.Errorf("DeletedAt = %v after the restore, want nil", *after.DeletedAt)
			}
			if !after.UpdatedAt.Equal(before.UpdatedAt) {
				t.Errorf("UpdatedAt = %v, want %v untouched", after.UpdatedAt, before.UpdatedAt)
			}
			if env.jira.deleteCalls != 0 {
				t.Errorf("Jira saw %d deletes, want none", env.jira.deleteCalls)
			}
		})
	}
}

func TestRestoreAMissingEntryIsNotFound(t *testing.T) {
	env := newEntriesEnv(t)

	for _, target := range []string{"/api/entries/404/restore", "/api/entries/abc/restore"} {
		t.Run(target, func(t *testing.T) {
			assertRejected(t, callEntries(t, env.s, http.MethodPost, target, ""),
				http.StatusNotFound, "not_found")
		})
	}
}

func TestRestoreRefusesAnEntryNotWaitingToBeDeleted(t *testing.T) {
	for _, tc := range []struct {
		name   string
		pushed bool
	}{
		{"an unpushed entry", false},
		{"a pushed entry never deleted", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			env := newEntriesEnv(t)
			entry := env.createEntry(t, "RID-1", 3600, "")
			if tc.pushed {
				env.markPushed(t, entry.ID, "10001")
			}

			assertRejected(t, env.restore(t, entry.ID), http.StatusConflict, "entry_not_pending_delete")
		})
	}
}

func TestPatchAPendingDeleteIsAConflict(t *testing.T) {
	env := newEntriesEnv(t)
	entry := env.createEntry(t, "RID-1", 3600, "first go")
	env.markPushed(t, entry.ID, "10001")
	env.delete(t, entry.ID)
	before := env.stored(t, entry.ID)

	rec := callEntries(t, env.s, http.MethodPatch,
		"/api/entries/"+strconv.FormatInt(entry.ID, 10), `{"seconds":1800}`)

	assertRejected(t, rec, http.StatusConflict, "entry_pending_delete")
	after := env.stored(t, entry.ID)
	if after.Seconds != 3600 || !after.UpdatedAt.Equal(before.UpdatedAt) {
		t.Fatalf("entry = %ds updated %v, want 3600s and %v untouched",
			after.Seconds, after.UpdatedAt, before.UpdatedAt)
	}
}

// Review focus 1. A push deletes the worklog and then the row under pushMu; a
// restore landing between the two would answer 200 for a row about to vanish.
// The lock is held here by hand, standing in for that push.
func TestRestoreWaitsForTheLockAPushHolds(t *testing.T) {
	env := newEntriesEnv(t)
	entry := env.createEntry(t, "RID-1", 3600, "")
	env.markPushed(t, entry.ID, "10001")
	env.delete(t, entry.ID)

	env.s.pushMu.Lock()
	answered := make(chan int, 1)
	go func() {
		rec := httptest.NewRecorder()
		env.s.ServeHTTP(rec, httptest.NewRequest(http.MethodPost,
			"/api/entries/"+strconv.FormatInt(entry.ID, 10)+"/restore", nil))
		answered <- rec.Code
	}()

	select {
	case code := <-answered:
		env.s.pushMu.Unlock()
		t.Fatalf("restore answered %d while a push held the lock", code)
	case <-time.After(200 * time.Millisecond):
	}

	if err := env.store.DeleteEntry(t.Context(), entry.ID); err != nil {
		t.Fatalf("deleting the row as the push would: %v", err)
	}
	env.s.pushMu.Unlock()

	select {
	case code := <-answered:
		if code != http.StatusNotFound {
			t.Fatalf("restore = %d, want 404: the push removed the row first", code)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the restore never answered")
	}
}
```

In `internal/server/push_test.go`, replace `TestDeleteWhileAPushIsInFlightStillRemovesTheWorklog` and its doc comment with:

```go
// TestDeleteDuringAPushMarksTheWorklogThePushCreated is #10's Important 5 under
// #280. A delete landing while the push creates the worklog must wait for the
// lock, then read the worklog id the push recorded and mark the entry — rather
// than read an empty id and drop the row, which leaves time in Jira nothing
// here can reach. Jira hears nothing from the delete itself.
func TestDeleteDuringAPushMarksTheWorklogThePushCreated(t *testing.T) {
	env := newPushEnv(t)
	entry := env.createEntry(t, "RID-1", 3600, "work")

	deleted := make(chan int, 1)
	env.jira.createWorklog = func() (string, error) {
		go func() {
			rec := httptest.NewRecorder()
			env.s.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete,
				"/api/entries/"+strconv.FormatInt(entry.ID, 10), nil))
			deleted <- rec.Code
		}()
		// Long enough for that request to reach the handler, which is where it
		// must then wait rather than read an entry the push is halfway through.
		time.Sleep(300 * time.Millisecond)

		return "wl-1", nil
	}

	resp := env.push(t, entry.Day)
	if got := resp.Results[0].Status; got != "pushed" {
		t.Fatalf("push status = %q, want pushed: the worklog really was created", got)
	}

	select {
	case code := <-deleted:
		if code != http.StatusNoContent {
			t.Fatalf("DELETE /api/entries = %d, want 204", code)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the delete never answered")
	}

	if got := env.jira.deletedWorklogs(); len(got) != 0 {
		t.Fatalf("Jira was asked to delete %v, want nothing: a delete waits for the push", got)
	}
	after, err := env.store.Entry(context.Background(), entry.ID)
	if err != nil {
		t.Fatalf("reading the entry back = %v, want it kept and marked", err)
	}
	if after.WorklogID != "wl-1" || pushStateOf(*after) != "deleted" {
		t.Fatalf("entry = worklog %q state %q, want wl-1 and deleted", after.WorklogID, pushStateOf(*after))
	}
}
```

(`errors` and `database/sql` may now be unused in `push_test.go`; `make lint`/the compiler will say — remove only what is reported. Task 3 uses both again.)

- [ ] **Step 3: Run them; see RED.**

Run: `docker compose run --build --rm --no-deps app go test ./internal/server/ -run 'TestDeleteEntryWaitsForPush|TestListEntriesCarriesAPendingDelete|TestDeletingAPendingDeleteAgain|TestRestore|TestPatchAPendingDelete|TestDeleteDuringAPush' -count=1 -v`
Expected: `TestDeleteEntryWaitsForPush/a pushed…` and `/an entry edited…` FAIL on `Jira saw 1 deletes, want none`; `TestListEntriesCarriesAPendingDelete` FAIL on `entries = [], want the one entry`; `TestDeletingAPendingDeleteAgainChangesNothing` FAIL on `second delete status = 404, want 204` (the first delete removed the row); `TestRestoreReturnsTheEarlierPushState/*` FAIL on `status = 404, want 200`; `TestRestoreRefuses…` FAIL on `status = 404, want 409`; `TestPatchAPendingDeleteIsAConflict` FAIL in `env.stored` (row gone) — re-run after Step 4's DELETE change to see it fail on `status = 200, want 409`; `TestRestoreWaitsForTheLockAPushHolds` FAIL on `restore answered 404 while a push held the lock`; `TestDeleteDuringAPush…` FAIL on `Jira was asked to delete [wl-1], want nothing`. `TestRestoreAMissingEntryIsNotFound` passes (guard: the `/api/` catch-all answers `not_found`).

- [ ] **Step 4: DELETE marks.** Replace `handleDeleteEntry` in `internal/server/entries.go`:

```go
// handleDeleteEntry removes logged time. An entry Jira holds a worklog for is
// only marked: the next push deletes the worklog, as it carries every other
// change to Jira, and until then the entry can be restored. One Jira has never
// seen goes at once. Deleting an entry already marked changes nothing.
func (s *Server) handleDeleteEntry(w http.ResponseWriter, r *http.Request) {
	id, ok := idFromPath(w, r, "no such entry")
	if !ok {
		return
	}

	// The push's lock, held from the read that decides whether this entry has
	// a worklog through to the write. Outside it, a delete reads an entry a
	// push is halfway through — worklog_id still empty — and drops the row the
	// push was about to record its new worklog in, leaving time in Jira that
	// nothing here can reach.
	s.pushMu.Lock()
	defer s.pushMu.Unlock()

	entry, err := s.db.Entry(r.Context(), id)
	if err != nil {
		writeEntryStoreError(w, err, "could not read the entry")
		return
	}

	if entry.WorklogID != "" {
		if err := s.db.MarkEntryDeleted(r.Context(), id, s.now()); err != nil {
			writeEntryStoreError(w, err, "could not delete the entry")
			return
		}
		w.WriteHeader(http.StatusNoContent)

		return
	}

	if err := s.db.DeleteEntry(r.Context(), id); err != nil {
		writeEntryStoreError(w, err, "could not delete the entry")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
```

Remove the `jira` import from `entries.go` if the compiler reports it unused.

- [ ] **Step 5: Restore.** Add after `handleDeleteEntry`:

```go
// handleRestoreEntry takes back a delete that is waiting for the push and
// answers with the entry in the push state it had before — the delete wrote
// nothing but the mark. Under the push's lock, so a restore cannot land between
// a push deleting the worklog and deleting the row: it waits, and then finds
// the row gone.
func (s *Server) handleRestoreEntry(w http.ResponseWriter, r *http.Request) {
	id, ok := idFromPath(w, r, "no such entry")
	if !ok {
		return
	}

	s.pushMu.Lock()
	defer s.pushMu.Unlock()

	entry, err := s.db.Entry(r.Context(), id)
	if err != nil {
		writeEntryStoreError(w, err, "could not read the entry")
		return
	}
	if pushStateOf(*entry) != "deleted" {
		writeError(w, http.StatusConflict, "entry_not_pending_delete",
			"the entry is not waiting to be deleted")
		return
	}

	instances, positions, ok := s.instanceIndex(w, r)
	if !ok {
		return
	}

	restored, err := s.db.RestoreEntry(r.Context(), id)
	if err != nil {
		writeEntryStoreError(w, err, "could not restore the entry")
		return
	}

	writeJSON(w, http.StatusOK,
		s.entryDTOFrom(*restored, instances[restored.InstanceID], positions[restored.InstanceID]))
}
```

In `internal/server/server.go`, after the `DELETE /api/entries/{id}` line:

```go
	s.mux.HandleFunc("POST /api/entries/{id}/restore", s.handleRestoreEntry)
```

- [ ] **Step 6: PATCH refuses.** In `handleUpdateEntry`, directly after the `existing, err := s.db.Entry(…)` error check:

```go
	if pushStateOf(*existing) == "deleted" {
		writeError(w, http.StatusConflict, "entry_pending_delete",
			"the entry is waiting to be deleted at the next push; restore it first")
		return
	}
```

- [ ] **Step 7: Run them; see GREEN.** Step 3's command, then `make test-go`. Expected: PASS. (`TestMCPDeleteEntryNeverReachesJira` still passes: the MCP guard refuses before the handler runs. Task 5 removes it.)

- [ ] **Step 8: Mutations** (one test each; red, restore, green):
  1. In `handleDeleteEntry`, drop the `WorklogID != ""` branch → `TestDeleteEntryWaitsForPush` pushed/edited cases red on `row gone = true`.
  2. Put a `client.DeleteWorklog` call back before `MarkEntryDeleted` (copy from `git show HEAD~1:internal/server/entries.go`) → red on `Jira saw 1 deletes`.
  3. Remove the restore route → `TestRestoreReturnsTheEarlierPushState` red on `status = 404`.
  4. Drop the `!= "deleted"` check in `handleRestoreEntry` → both `TestRestoreRefuses…` cases red on `status = 200, want 409`.
  5. Answer 409 instead of `writeEntryStoreError` when the read fails → `TestRestoreAMissingEntryIsNotFound/404` red.
  6. Remove the `pushMu` lines from `handleRestoreEntry` → `TestRestoreWaitsForTheLockAPushHolds` red.
  7. Remove the PATCH 409 block → `TestPatchAPendingDeleteIsAConflict` red on `status = 200`.
  8. Replace `COALESCE(deleted_at, ?)` with `?` in the store → `TestDeletingAPendingDeleteAgainChangesNothing` red.
  9. Remove the `pushMu` lines from `handleDeleteEntry` → `TestDeleteDuringAPush…` red (`reading the entry back = … no rows`).

- [ ] **Step 9: Format, lint, commit.**

```bash
docker compose run --rm --no-deps lint golangci-lint fmt
make lint
git add internal/server/entries.go internal/server/server.go internal/server/entries_test.go internal/server/push_test.go
git commit -m "feat(#280): a delete of an entry Jira holds marks it; restore takes it back

DELETE asks Jira nothing now. POST /api/entries/{id}/restore clears the
mark under the push's lock, and PATCH refuses a marked entry.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DhrQjSkmUmfVxLZHhaYLwQ"
```

---

### Task 3: The push deletes the worklog, then the row

**Files:**
- Modify: `internal/server/push.go` (one branch, one new function)
- Test: `internal/server/push_test.go`

**Interfaces:**
- Consumes (Task 1–2): `pushStateOf` → `"deleted"`, `MarkEntryDeleted`, `DeleteEntry`. Codebase: `jira.Client.DeleteWorklog(ctx, issueKey, id string) error`, `jira.ErrNotFound`, `instanceErrorBody`, `pushResultDTO`, `errorBody`. Test helpers `newPushEnv`, `pushEnv{createEntry, markPushed, editEntry, push}`, `hookableJira{calls, lastMethod, deletedWorklogs()}`.
- Produces: push result `Status: "deleted"` (with `WorklogID`); failure code `delete_unrecorded`; `hookableJira.deleteStatus int`, `hookableJira.onDelete func()`; `(*pushEnv).markDeleted(t, id)`.

- [ ] **Step 1: Steer the fake's DELETE.** In `push_test.go`, add to `hookableJira` (beside `updateStatus`):

```go
	// deleteStatus answers worklog DELETE, 204 when zero; onDelete runs first,
	// which is the window between Jira confirming and the row going.
	deleteStatus int
	onDelete     func()
```

and in `newPushEnv`'s handler, the `case http.MethodDelete:` becomes:

```go
		case http.MethodDelete:
			env.jira.mu.Lock()
			env.jira.deleted = append(env.jira.deleted,
				path.Base(r.URL.Path))
			env.jira.mu.Unlock()
			if env.jira.onDelete != nil {
				env.jira.onDelete()
			}
			status := env.jira.deleteStatus
			if status == 0 {
				status = http.StatusNoContent
			}
			w.WriteHeader(status)
```

After `(*pushEnv).editEntry`, add:

```go
// markDeleted stands in for DELETE /api/entries/{id} on an entry Jira holds.
func (env *pushEnv) markDeleted(t *testing.T, entryID int64) {
	t.Helper()

	if err := env.store.MarkEntryDeleted(context.Background(), entryID, time.Now()); err != nil {
		t.Fatalf("marking entry %d deleted: %v", entryID, err)
	}
}
```

- [ ] **Step 2: Write the failing tests.** Append to `push_test.go`:

```go
// #280's push half. Jira first and the row only once it confirms, a 404 being
// confirmation; a refusal keeps the row and its mark for the next push.
func TestPushDeletesAPendingDelete(t *testing.T) {
	tests := []struct {
		name         string
		dirty        bool
		deleteStatus int
		wantStatus   string
		wantRowGone  bool
	}{
		{
			name: "Jira deletes the worklog, then the row goes", deleteStatus: http.StatusNoContent,
			wantStatus: "deleted", wantRowGone: true,
		},
		{
			// Review focus 3: the correction the entry carried is moot.
			name: "an entry edited before its delete is deleted, not corrected", dirty: true,
			deleteStatus: http.StatusNoContent, wantStatus: "deleted", wantRowGone: true,
		},
		{
			name: "a worklog already gone counts as deleted", deleteStatus: http.StatusNotFound,
			wantStatus: "deleted", wantRowGone: true,
		},
		{
			name: "a refused delete keeps the row and its mark", deleteStatus: http.StatusInternalServerError,
			wantStatus: "failed",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			env := newPushEnv(t)
			env.jira.deleteStatus = test.deleteStatus
			entry := env.createEntry(t, "RID-1", 3600, "work")
			env.markPushed(t, entry.ID, "10001")
			if test.dirty {
				env.editEntry(t, entry.ID, 5400, "reworded")
			}
			env.markDeleted(t, entry.ID)

			resp := env.push(t, entry.Day)

			if len(resp.Results) != 1 || resp.Results[0].Status != test.wantStatus {
				t.Fatalf("results = %+v, want one %s", resp.Results, test.wantStatus)
			}
			if test.wantStatus == "failed" && resp.Results[0].Error == nil {
				t.Fatal("a failed delete carries no error for the report to name")
			}
			if got := env.jira.deletedWorklogs(); len(got) != 1 || got[0] != "10001" {
				t.Fatalf("Jira was asked to delete %v, want [10001]", got)
			}
			if env.jira.calls != 1 || env.jira.lastMethod != http.MethodDelete {
				t.Fatalf("Jira saw %d worklog calls, the last a %s; want one DELETE",
					env.jira.calls, env.jira.lastMethod)
			}

			after, err := env.store.Entry(t.Context(), entry.ID)
			gone := errors.Is(err, sql.ErrNoRows)
			if gone != test.wantRowGone {
				t.Fatalf("row gone = %v, want %v", gone, test.wantRowGone)
			}
			if !gone && pushStateOf(*after) != "deleted" {
				t.Fatalf("state = %q after a refused delete, want deleted so the next push retries",
					pushStateOf(*after))
			}
		})
	}
}

// Retry, then idempotence: the push after a refusal tries again, and the push
// after a success finds no row and asks Jira nothing.
func TestPushRetriesARefusedDeleteAndThenAsksNothing(t *testing.T) {
	env := newPushEnv(t)
	env.jira.deleteStatus = http.StatusInternalServerError
	entry := env.createEntry(t, "RID-1", 3600, "work")
	env.markPushed(t, entry.ID, "10001")
	env.markDeleted(t, entry.ID)

	if got := env.push(t, entry.Day).Results[0].Status; got != "failed" {
		t.Fatalf("first push status = %q, want failed", got)
	}

	env.jira.deleteStatus = http.StatusNoContent
	if got := env.push(t, entry.Day).Results[0].Status; got != "deleted" {
		t.Fatalf("second push status = %q, want deleted", got)
	}

	third := env.push(t, entry.Day)
	if len(third.Results) != 0 {
		t.Fatalf("third push results = %+v, want none", third.Results)
	}
	if env.jira.calls != 2 {
		t.Fatalf("Jira saw %d worklog calls over three pushes, want 2", env.jira.calls)
	}
}

// Review focus 2. The worklog is gone from Jira and the row survived, so
// pushing again is the fix — the next attempt's 404 counts as success. Reported
// as store_failed, the report would tell the user the opposite.
func TestPushReportsADeleteTheStoreLostAsRetryable(t *testing.T) {
	env := newPushEnv(t)
	entry := env.createEntry(t, "RID-1", 3600, "work")
	env.markPushed(t, entry.ID, "10001")
	env.markDeleted(t, entry.ID)
	env.jira.onDelete = func() { _ = env.store.Close() }

	got := env.push(t, entry.Day).Results[0]

	if got.Status != "failed" || got.Error == nil || got.Error.Code != "delete_unrecorded" {
		t.Fatalf("result = %+v (error %+v), want failed with delete_unrecorded", got, got.Error)
	}
}
```

- [ ] **Step 3: Run them; see RED.**

Run: `docker compose run --build --rm --no-deps app go test ./internal/server/ -run 'TestPushDeletesAPendingDelete|TestPushRetriesARefusedDelete|TestPushReportsADeleteTheStoreLost' -count=1 -v`
Expected: every case FAIL on `results = [{… Status:pushed …}], want one deleted` (or `want one failed`): a `deleted` entry falls through to `CreateWorklog` today. `TestPushRetries…` FAIL on `first push status = "pushed"`; `TestPushReports…` FAIL on `want failed with delete_unrecorded`.

- [ ] **Step 4: Implement.** In `pushInstanceEntries`, directly after the `if clientErr != nil { … continue }` block:

```go
		if state == "deleted" {
			results = append(results, s.deleteWorklogThenEntry(ctx, client, entry, result))
			continue
		}
```

Add after `pushInstanceEntries`:

```go
// deleteWorklogThenEntry carries out a delete that waited for the push (#280).
// Jira goes first and the row only once it confirms, a 404 counting as
// confirmation: the reverse order would leave a worklog nothing here records. A
// refusal keeps the row and its mark, so the next push tries again.
func (s *Server) deleteWorklogThenEntry(
	ctx context.Context, client *jira.Client, entry store.Entry, result pushResultDTO,
) pushResultDTO {
	result.WorklogID = entry.WorklogID

	if err := client.DeleteWorklog(ctx, entry.IssueKey, entry.WorklogID); err != nil &&
		!errors.Is(err, jira.ErrNotFound) {
		result.Status = "failed"
		result.Error = instanceErrorBody(err)

		return result
	}

	// WithoutCancel for the reason the worklog record above gives. Not
	// store_failed: that code tells the reader not to push again, and here
	// pushing again is the fix.
	if err := s.db.DeleteEntry(context.WithoutCancel(ctx), entry.ID); err != nil {
		result.Status = "failed"
		result.Error = &errorBody{
			Code: "delete_unrecorded",
			Message: "the worklog was deleted in Jira but the entry could not be removed here; " +
				"pushing again finishes it",
		}

		return result
	}

	result.Status = "deleted"

	return result
}
```

- [ ] **Step 5: Run them; see GREEN.** Step 3's command, then `make test-go`. Expected: PASS.

- [ ] **Step 6: Mutations** (one test each):
  1. Remove the `state == "deleted"` branch → every `TestPushDeletesAPendingDelete` case red (`Status:pushed`).
  2. Drop `&& !errors.Is(err, jira.ErrNotFound)` → `a worklog already gone…` red (`want one deleted`, got failed).
  3. Delete the row before the Jira call → `a refused delete keeps the row…` red on `row gone = true`.
  4. Skip `DeleteEntry` on success → the three success cases red on `row gone = false`, and `TestPushRetries…` red (third push has a result).
  5. Use `Code: "store_failed"` → `TestPushReportsADeleteTheStoreLostAsRetryable` red.
  6. In the dirty path, call `client.UpdateWorklog` before deleting (`_ = client.UpdateWorklog(ctx, entry.WorklogID, jira.Worklog{IssueKey: entry.IssueKey})` at the top of `deleteWorklogThenEntry`) → `an entry edited before its delete…` and the other cases red on `want one DELETE` (calls 2).

- [ ] **Step 7: Format, lint, commit.**

```bash
docker compose run --rm --no-deps lint golangci-lint fmt
make lint
git add internal/server/push.go internal/server/push_test.go
git commit -m "feat(#280): push deletes a pending delete's worklog, then its row

A Jira 404 counts as success; a refusal keeps the row and its mark for the
next push; a row the store could not remove is a retryable failure.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DhrQjSkmUmfVxLZHhaYLwQ"
```

---

### Task 4: The fetch leaves a pending delete alone

**Files:**
- Modify: `internal/server/reconcile.go`
- Test: `internal/server/reconcile_test.go`, `internal/server/fetch_test.go`

**Interfaces:**
- Consumes (Task 1): `pushStateOf` → `"deleted"`, `MarkEntryDeleted`. Test helpers `newFetchJiraServer`, `rawWorklog`, `fetchEnv`, `seedInstance`, `seedEntry`, `markEntryPushed`, `callFetchWeek`, `decodeFetchWeek`, `allEntries`.
- Produces: `reconcileWorklog` returns `actionLeave` for a pending delete.

- [ ] **Step 1: Write the failing tests.** In `reconcile_test.go`'s `TestReconcileWorklog`, after the `dirty` builder add:

```go
	// pendingDelete marks an entry the user deleted; the push has not run yet.
	pendingDelete := func(local *store.Entry) *store.Entry {
		deletedAt := pushedAt.Add(2 * time.Hour)
		local.DeletedAt = &deletedAt

		return local
	}
```

and append to `tests`:

```go
		{
			// The delete wins: overwriting would bring back time the user removed.
			name:    "the local entry waits to be deleted, and the worklog is younger",
			updated: pushedAt.Add(3 * time.Hour),
			local:   pendingDelete(clean(pushedAt.Add(-time.Hour))),
			want:    actionLeave,
		},
		{
			// Not keep-local either: that reports it, and there is nothing to choose.
			name:    "the local entry was edited, then deleted",
			updated: pushedAt.Add(3 * time.Hour),
			local:   pendingDelete(dirty()),
			want:    actionLeave,
		},
```

Append to `fetch_test.go`:

```go
// #280: a fetch must not re-create, overwrite or un-mark a pending delete. The
// remote copy here is younger and has moved a day, so every other rule would
// rewrite the row.
func TestFetchWeekLeavesAPendingDeleteAlone(t *testing.T) {
	loc, err := time.LoadLocation("Europe/Amsterdam")
	if err != nil {
		t.Fatalf("loading zone: %v", err)
	}

	jiraSrv := newFetchJiraServer(t, "me-1")
	jiraSrv.searchIssues = []string{"WORK-1"}
	srv := jiraSrv.start()

	s, db, sealer := fetchEnv(t, "Europe/Amsterdam", time.Date(2026, 9, 2, 12, 0, 0, 0, time.UTC))
	inst := seedInstance(t, db, sealer, "Work", "", srv.URL)

	entry := seedEntry(t, db, store.EntryInput{
		InstanceID: inst.ID, IssueKey: "WORK-1", Day: "2026-09-02",
		StartedAt: time.Date(2026, 9, 2, 9, 0, 0, 0, loc), Seconds: 1800, Comment: "old",
	})
	marked := markEntryPushed(t, db, entry.ID, "wl-D")
	if err := db.MarkEntryDeleted(context.Background(), entry.ID,
		time.Date(2026, 9, 2, 11, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("marking the entry deleted: %v", err)
	}

	jiraSrv.worklogs["WORK-1"] = []rawWorklog{{
		id: "wl-D", accountID: "me-1",
		started: time.Date(2026, 9, 3, 10, 0, 0, 0, loc),
		updated: marked.UpdatedAt.Add(time.Hour),
		seconds: 5400,
	}}

	rec := callFetchWeek(t, s, "/api/week/fetch?start=2026-08-31")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	body := decodeFetchWeek(t, rec)

	if body.Created != 0 || body.Updated != 0 || len(body.KeptLocal) != 0 {
		t.Errorf("created %d, updated %d, keptLocal %+v; want nothing done and nothing reported",
			body.Created, body.Updated, body.KeptLocal)
	}
	stored := allEntries(t, db)
	if len(stored) != 1 {
		t.Fatalf("stored %d entries, want the one: the worklog was re-created", len(stored))
	}
	after := stored[0]
	if after.Seconds != 1800 || after.Day != "2026-09-02" || pushStateOf(after) != "deleted" {
		t.Errorf("entry = %ds on %s in state %q, want 1800s on 2026-09-02, still deleted",
			after.Seconds, after.Day, pushStateOf(after))
	}
}
```

- [ ] **Step 2: Run them; see RED.**

Run: `docker compose run --build --rm --no-deps app go test ./internal/server/ -run 'TestReconcileWorklog|TestFetchWeekLeavesAPendingDeleteAlone' -count=1 -v`
Expected: `…waits to be deleted, and the worklog is younger` FAIL on `action = "overwrite", want "leave"`; `…edited, then deleted` FAIL on `action = "overwrite"` (the dirty check no longer fires: the state reads `deleted`); `TestFetchWeekLeavesAPendingDeleteAlone` FAIL on `created 0, updated 1` and `entry = 5400s on 2026-09-03`.

- [ ] **Step 3: Implement.** In `reconcileWorklog`, directly after the `if local == nil` block:

```go
	// The delete wins over anything Jira says: the user asked for this worklog
	// to go, and overwriting the row would bring back time they removed. The
	// push's DELETE settles it, a 404 included.
	if pushStateOf(*local) == "deleted" {
		return actionLeave
	}
```

and extend the function's doc comment's list of exceptions — replace "with two deliberate exceptions." with "with three deliberate exceptions.", and add before "A dirty entry always wins":

```go
// A pending delete is left alone whatever the timestamps say (#280).
//
```

- [ ] **Step 4: Run them; see GREEN.** Step 2's command, then `make test-go`.

- [ ] **Step 5: Mutations:**
  1. Remove the `deleted` check → both new reconcile cases and the fetch test red.
  2. Return `actionKeepLocal` for it → both reconcile cases red, fetch test red on `keptLocal`.
  3. In the fetch test only, drop the `MarkEntryDeleted` call → red on `updated 1` (proves the test exercises the mark, not something else).

- [ ] **Step 6: Commit.**

```bash
docker compose run --rm --no-deps lint golangci-lint fmt
make lint
git add internal/server/reconcile.go internal/server/reconcile_test.go internal/server/fetch_test.go
git commit -m "feat(#280): a week fetch leaves a pending delete alone

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DhrQjSkmUmfVxLZHhaYLwQ"
```

---

### Task 5: Week leaves pending deletes out and ranks them; MCP may delete a pushed entry

**Files:**
- Modify: `internal/server/week.go` (`pushStateRank`, new `countedSeconds`, `rollUp`'s two sums)
- Modify: `internal/server/mcp_tools.go` (remove `mcpJiraDeleteRefusal`, `entryReachedJira` and the `delete_entry` guard; three descriptions)
- Test: `internal/server/week_test.go`, `internal/server/mcp_tools_test.go`

**Interfaces:**
- Consumes (Tasks 1–2): `pushStateOf`, `MarkEntryDeleted`, `DELETE /api/entries/{id}` marking. Test helpers `entryInState`, `serverInZone`, `seedEntry`, `callWeek`, `decodeWeek`, `newEntriesEnv`, `callTool`, `makeEntryDirty`.
- Produces: `func countedSeconds(entries []store.Entry) int`; `pushStateRank["deleted"] == 2`, `["unpushed"] == 3`.

- [ ] **Step 1: Write the failing Week tests.** In `week_test.go`, add a case to `entryInState`'s switch:

```go
	case "deleted":
		deleted := pushed.Add(2 * time.Hour)
		return store.Entry{WorklogID: "1", PushedAt: &pushed, UpdatedAt: pushed, DeletedAt: &deleted}
```

append to `TestWorstPushState`'s `cases`:

```go
		{"one deleted", []string{"deleted"}, "deleted"},
		{"pushed and deleted reads deleted", []string{"pushed", "deleted"}, "deleted"},
		{"deleted beats dirty whatever the order", []string{"deleted", "dirty"}, "deleted"},
		{"dirty and deleted reads deleted", []string{"dirty", "deleted"}, "deleted"},
		{"unpushed beats deleted", []string{"deleted", "unpushed"}, "unpushed"},
		{"all four reads unpushed", []string{"pushed", "dirty", "deleted", "unpushed"}, "unpushed"},
```

and append:

```go
// #280: every total says what Jira will hold after the push. Monday holds a
// pushed hour and a pending-delete half hour; Tuesday holds only a pending
// delete, which still marks its cell and its day — that is how the grid tells
// it from a day with nothing on it.
func TestWeekLeavesPendingDeletesOutOfItsTotals(t *testing.T) {
	srv, db, inst := serverInZone(t, "Europe/Amsterdam", time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC))
	ctx := context.Background()

	seed := func(day string, hour, seconds int, deleted bool) {
		t.Helper()
		entry := seedEntry(t, db, store.EntryInput{
			InstanceID: inst.ID, IssueKey: "WORK-1", Day: day,
			StartedAt: time.Date(2026, 9, 7, hour, 0, 0, 0, time.UTC), Seconds: seconds,
		})
		if _, err := db.RecordWorklogMarkingPushedIfUnchanged(
			ctx, entry.ID, "w-"+strconv.FormatInt(entry.ID, 10), time.Now().UTC(), entry.UpdatedAt,
		); err != nil {
			t.Fatalf("marking entry pushed: %v", err)
		}
		if deleted {
			if err := db.MarkEntryDeleted(ctx, entry.ID, time.Now()); err != nil {
				t.Fatalf("marking entry deleted: %v", err)
			}
		}
	}
	seed("2026-09-07", 9, 3600, false)
	seed("2026-09-07", 11, 1800, true)
	seed("2026-09-08", 9, 900, true)

	got := decodeWeek(t, callWeek(t, srv, "/api/week?start=2026-09-07"))

	monday, tuesday := got.Rows[0].Cells[0], got.Rows[0].Cells[1]
	if monday.Seconds != 3600 || monday.PushState == nil || *monday.PushState != "deleted" {
		t.Errorf("Monday cell = %d %v, want 3600 deleted", monday.Seconds, monday.PushState)
	}
	if tuesday.Seconds != 0 || tuesday.PushState == nil || *tuesday.PushState != "deleted" {
		t.Errorf("Tuesday cell = %d %v, want 0 deleted", tuesday.Seconds, tuesday.PushState)
	}
	if got.Days[0].Seconds != 3600 || got.Days[1].Seconds != 0 {
		t.Errorf("day totals = %d, %d; want 3600, 0", got.Days[0].Seconds, got.Days[1].Seconds)
	}
	if got.Days[1].PushState == nil || *got.Days[1].PushState != "deleted" {
		t.Errorf("Tuesday's day state = %v, want deleted", got.Days[1].PushState)
	}
	if got.Rows[0].Seconds != 3600 || got.Seconds != 3600 {
		t.Errorf("row total %d, week total %d; want 3600 and 3600", got.Rows[0].Seconds, got.Seconds)
	}
}
```

(Add `"strconv"` to `week_test.go`'s imports.)

- [ ] **Step 2: Rewrite the MCP delete tests.** In `mcp_tools_test.go`, replace `TestMCPDeleteEntryNeverReachesJira` (and its comment) with:

```go
// #280: a delete only marks an entry Jira holds, so delete_entry may delete
// any entry and still never write to Jira. newEntriesEnv's fake counts deletes.
func TestMCPDeleteEntryNeverReachesJira(t *testing.T) {
	for _, tc := range []struct {
		name                string
		pushed, editedSince bool
	}{
		{"an entry never pushed is removed", false, false},
		{"an entry pushed to Jira waits for the next push", true, false},
		{"an entry edited since its push waits for the next push", true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			env := newEntriesEnv(t)
			entry := env.createEntry(t, "RIDGE-1", 900, "")
			if tc.pushed {
				env.markPushed(t, entry.ID, "wl-1")
			}
			if tc.editedSince {
				makeEntryDirty(t, env.store, entry.ID, 1200, "Reworded")
			}

			got := callTool(t, env.s, "delete_entry", `{"id":`+strconv.FormatInt(entry.ID, 10)+`}`)

			if got.IsError || got.text() != "No Content" {
				t.Errorf("isError %v, text %q; want No Content", got.IsError, got.text())
			}
			if env.jira.deleteCalls != 0 {
				t.Errorf("Jira saw %d worklog deletes, want none", env.jira.deleteCalls)
			}
			after, err := env.store.Entry(context.Background(), entry.ID)
			if !tc.pushed {
				if !errors.Is(err, sql.ErrNoRows) {
					t.Errorf("reading the entry back = %v, want it gone", err)
				}
				return
			}
			if err != nil || pushStateOf(*after) != "deleted" {
				t.Errorf("entry = %+v (err %v), want it kept, waiting to be deleted", after, err)
			}
		})
	}
}

// The listing tools are the API's own bodies, so a pending delete reads there
// exactly as it does for the browser: in the list, and in no total.
func TestMCPListingToolsShowAPendingDeleteAsTheAPIDoes(t *testing.T) {
	env := newEntriesEnv(t)
	entry := env.createEntry(t, "RIDGE-1", 3600, "")
	env.markPushed(t, entry.ID, "wl-1")
	callTool(t, env.s, "delete_entry", `{"id":`+strconv.FormatInt(entry.ID, 10)+`}`)

	listed := callTool(t, env.s, "list_entries", `{"from":"2026-08-31","to":"2026-08-31"}`)
	if !strings.Contains(listed.text(), `"pushState":"deleted"`) {
		t.Errorf("list_entries = %s, want the entry with pushState deleted", listed.text())
	}

	var week weekRollupDTO
	if err := json.Unmarshal([]byte(callTool(t, env.s, "get_week", `{"start":"2026-08-31"}`).text()), &week); err != nil {
		t.Fatalf("decoding get_week: %v", err)
	}
	if week.Seconds != 0 || week.Days[0].PushState == nil || *week.Days[0].PushState != "deleted" {
		t.Errorf("get_week total %d, Monday %v; want 0 and deleted", week.Seconds, week.Days[0].PushState)
	}
}
```

Delete `TestMCPDeleteEntryFailsClosedWhenTheEntryCannotBeRead` and its comment. Add `"database/sql"` and `"errors"` to the imports if missing.

- [ ] **Step 3: Run them; see RED.**

Run: `docker compose run --build --rm --no-deps app go test ./internal/server/ -run 'TestWorstPushState|TestWeekLeavesPendingDeletes|TestMCPDeleteEntryNeverReachesJira|TestMCPListingTools' -count=1 -v`
Expected: `deleted beats dirty whatever the order` FAIL on `got "dirty", want "deleted"` (rank 0 for an unknown key); `unpushed beats deleted` passes by accident of order — it is pinned by mutation 3 below; `TestWeekLeavesPendingDeletes…` FAIL on `Monday cell = 5400`; the two pushed MCP cases FAIL on `isError true, text "This entry has reached Jira…"`; `TestMCPListingTools…` FAIL on `get_week total 3600`. (`list_entries` passes — the DELETE inside it is refused, so the first assertion fails too: `want the entry with pushState deleted`.)

- [ ] **Step 4: Week.** In `week.go`, replace `pushStateRank` and its comment:

```go
// pushStateRank orders the derived states by how much they still need doing. A
// cell is a sum of entries that can disagree, and the marker it shows is the
// worst of them — imprecise, and never falsely reassuring, which is the side to
// err on when the reader is about to submit a timesheet.
//
// unpushed outranks dirty deliberately: dirty time is in Jira and merely stale,
// unpushed time is not there at all. deleted sits between them, the owner's
// order (#280): Jira holds time it should not, which outranks stale text.
var pushStateRank = map[string]int{"pushed": 0, "dirty": 1, "deleted": 2, "unpushed": 3}

// countedSeconds is the time a cell or a day shows. A pending delete is left
// out: every total says what Jira will hold once the push has run.
func countedSeconds(entries []store.Entry) int {
	seconds := 0
	for _, entry := range entries {
		if pushStateOf(entry) != "deleted" {
			seconds += entry.Seconds
		}
	}

	return seconds
}
```

In `rollUp`, the day loop becomes:

```go
	for i, day := range days {
		seconds := countedSeconds(byDay[i])
		rollup.Days[i] = weekDayDTO{Day: day, Seconds: seconds, PushState: worstPushState(byDay[i])}
		rollup.Seconds += seconds
	}
```

and the cell loop:

```go
		for i, cell := range byCell[key] {
			seconds := countedSeconds(cell)
			row.Cells[i] = weekCellDTO{Seconds: seconds, PushState: worstPushState(cell)}
			row.Seconds += seconds
		}
```

Update the `weekCellDTO` comment's first sentence to: "One ticket's time on one day, pending deletes left out. PushState is nil exactly when the cell holds no entries; a cell holding only pending deletes has Seconds 0 and PushState "deleted"."

- [ ] **Step 5: MCP.** In `mcp_tools.go`: delete `mcpJiraDeleteRefusal`, `entryReachedJira` (with its `ponytail:` comment) and, in `mcpCallTool`, the whole `if tool.Name == "delete_entry" { … }` block. Remove the imports the compiler then reports unused (`database/sql`, `errors`, `fmt`, as reported). Replace three descriptions:

`list_entries`:

```go
		Description: "Logged time entries in an inclusive date range, oldest first. Each has its push " +
			"state: unpushed (not in Jira yet), pushed, dirty (edited since its push), or deleted " +
			"(its Jira worklog is deleted at the user's next push; it counts in no total and can be " +
			"restored in the app until then). Dates are YYYY-MM-DD in the server's timezone " +
			"(THAT_TIMEZONE), and both default to today there; the response's today field names that date.",
```

`get_week`:

```go
		Description: "A Monday-to-Sunday rollup of logged time: per issue per day, with day totals and " +
			"each cell's push state. Entries waiting to be deleted count in no total. start must be a " +
			"Monday, YYYY-MM-DD; it defaults to this week's Monday in the server's timezone (THAT_TIMEZONE).",
```

`delete_entry`:

```go
		Description: "Delete an entry. One not yet in Jira is removed at once. One that has reached Jira " +
			"(pushed or dirty) is marked deleted: its Jira worklog is deleted at the user's next push, " +
			"and the user can restore it in the app until then. Nothing is written to Jira by this tool.",
```

In `TestMCPToolsListIsExactlyTheTen`'s neighbourhood nothing changes (still ten tools).

- [ ] **Step 6: Run them; see GREEN.** Step 3's command, then `make test-go`.

- [ ] **Step 7: Mutations:**
  1. `countedSeconds` counts every entry → `TestWeekLeavesPendingDeletes…` red on `Monday cell = 5400`, `TestMCPListingTools…` red on `get_week total 3600`.
  2. Give `deleted` rank 0 → `pushed and deleted reads deleted` red (first of equals wins).
  3. Give `deleted` rank 4 → `unpushed beats deleted` and `all four reads unpushed` red.
  4. Give `deleted` rank 1 (equal to dirty; the first of equals wins) → `dirty and deleted reads deleted` red.
  5. Put the `delete_entry` guard back (`git show HEAD~1:internal/server/mcp_tools.go`) → both pushed MCP cases red.

- [ ] **Step 8: Commit.**

```bash
docker compose run --rm --no-deps lint golangci-lint fmt
make lint
git add internal/server/week.go internal/server/week_test.go internal/server/mcp_tools.go internal/server/mcp_tools_test.go
git commit -m "feat(#280): Week leaves pending deletes out and ranks them; MCP may delete a pushed entry

A delete only marks now, so #253's refusal for entries that reached Jira
has nothing left to guard.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DhrQjSkmUmfVxLZHhaYLwQ"
```

---

### Task 6: The entry dialog — the slashed ring, the struck row, Restore and the confirm

**Files:**
- Modify: `web/src/types.ts` (`Entry.pushState`, `PushResult.status`, `WeekCell`/`WeekDay.pushState`)
- Modify: `web/src/push-marks.ts` (`PushMark.markup`, `deleted`, `countsInTotals`)
- Modify: `web/src/icons.ts` (`undo`)
- Modify: `web/src/api.ts` (`restoreEntry`)
- Modify: `web/src/components/that-entry-dialog.ts`
- Test: `web/src/push-marks.test.ts`, `web/src/icons.test.ts`, `.claude/e2e/tests/deferred-delete.spec.ts` (new)

**Interfaces:**
- Consumes (Tasks 1–2): `GET /api/entries` with `pushState: "deleted"`, `DELETE /api/entries/{id}`, `POST /api/entries/{id}/restore` → `Entry`.
- Produces (Task 7 relies on these):
  - `Entry["pushState"]`: `"unpushed" | "pushed" | "dirty" | "deleted"`; `PushResult["status"]` gains `"deleted"`; `WeekCell`/`WeekDay` `pushState` gain `"deleted"`.
  - `PUSH_MARKS.deleted = { words: "deleted at next push", tone: "text-dirty", shape: "size-[9px]", markup: <svg> }`; `PushMark.markup?: string`.
  - `export function countsInTotals(entry: Pick<Entry, "pushState">): boolean` in `web/src/push-marks.ts`.
  - `export function restoreEntry(id: number): Promise<Entry>` in `web/src/api.ts`.
  - icon name `"undo"`.
  - e2e helpers in `deferred-delete.spec.ts`: `entry()`, `stubEntries()`, `openToday()`, `trigger()`, `dialog()`, `rows()`, colour constants.

- [ ] **Step 1: Types and bare declarations.** In `web/src/types.ts`:

```ts
  /** Derived server-side from worklog_id, deleted_at, pushed_at and updated_at — never stored.
   *  `deleted` is a delete waiting for the push (#280): shown, restorable, and counted in no total. */
  pushState: "unpushed" | "pushed" | "dirty" | "deleted";
```

`PushResult.status` becomes `"pushed" | "skipped" | "failed" | "deleted";`. `WeekCell.pushState` and `WeekDay.pushState` become `"unpushed" | "pushed" | "dirty" | "deleted" | null;`, and `WeekCell`'s comment gains: "A cell holding only pending deletes has `seconds: 0` and `pushState: "deleted"`."

In `web/src/push-marks.ts`, add `markup?: string;` to `PushMark` (doc: `/** SVG drawn inside the shape's box, for the one mark a border cannot draw. */`), a placeholder entry in `PUSH_MARKS` so it compiles:

```ts
  deleted: {
    words: "",
    tone: "",
    shape: "",
    markup: "",
  },
```

and at the end:

```ts
export function countsInTotals(entry: Pick<Entry, "pushState">): boolean {
  return entry !== entry;
}
```

In `web/src/api.ts`, after `deleteEntry`:

```ts
export function restoreEntry(id: number): Promise<Entry> {
  return Promise.reject(new Error(String(id)));
}
```

- [ ] **Step 2: Write the failing unit tests.** In `web/src/push-marks.test.ts`: import `countsInTotals` too; in the first test's expected object add `deleted: "deleted at next push",`; and append:

```ts
test("deleted is dirty's ring with a slash, drawn on the 9 box the design session drew", () => {
  const mark = PUSH_MARKS.deleted;
  assert.equal(mark.tone, PUSH_MARKS.dirty.tone, "a pending delete wears dirty's hue");
  assert.ok(mark.shape.split(" ").includes("size-[9px]"), "the slashed ring is not 9px");
  assert.match(mark.markup, /viewBox="0 0 9 9"/);
  assert.match(
    mark.markup,
    /<circle cx="4\.5" cy="4\.5" r="3\.75" fill="none" stroke="currentColor" stroke-width="1\.5"\/>/,
  );
  assert.match(
    mark.markup,
    /<path d="M2\.15 6\.85 6\.85 2\.15" stroke="currentColor" stroke-width="1\.5" stroke-linecap="round"\/>/,
  );
  assert.match(mark.markup, /aria-hidden="true"/);
});

test("a pending delete counts in no total, and every other state does", () => {
  for (const state of ["unpushed", "pushed", "dirty"] as const) {
    assert.equal(countsInTotals({ pushState: state }), true, state);
  }
  assert.equal(countsInTotals({ pushState: "deleted" }), false);
});
```

and in the `knownPushState` test add `assert.equal(knownPushState("deleted"), "deleted");`.

In `web/src/icons.test.ts`, append:

```ts
test("undo is transcribed from the design session's #m-undo", () => {
  // Pasted verbatim from .superpowers/brainstorm/333584-1791464716/content/01-dialog-row.html.
  assert.match(
    iconMarkup("undo"),
    /<path d="M9 6\.5 4\.5 11 9 15\.5"\/><path d="M4\.5 11h10a5 5 0 0 1 0 10h-3"\/>/,
  );
});
```

(`iconMarkup("undo")` is a type error until Step 6 adds the name; `node --test` strips types, so the run fails on the assertion — `PATHS.undo` is `undefined` — not on compilation. `make tsc` is run only after Step 6.)

- [ ] **Step 3: Write the failing e2e tests.** Create `.claude/e2e/tests/deferred-delete.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";

/**
 * #280: a delete of an entry Jira holds waits for the push. /api/entries is
 * stubbed with the server's own rules — DELETE marks a pushed or dirty entry
 * and removes an unpushed one, POST …/restore takes the mark back — for the
 * reason entries.spec.ts gives: the e2e stack shares the dev database.
 */
type State = "unpushed" | "pushed" | "dirty" | "deleted";

interface StubEntry {
  id: number;
  instanceId: number;
  instanceName: string;
  instancePosition: number;
  issueKey: string;
  day: string;
  startedAt: string;
  seconds: number;
  comment: string;
  pushState: State;
}

interface Recorder {
  deleted: number[];
  restored: number[];
}

const DAY = "2026-08-22";

/** Transcribed from @theme in web/src/styles.css, light side. */
const INK_LIGHT = "oklch(0.195 0.009 55)";
const INK_MUTED_LIGHT = "oklch(0.465 0.01 55)";
const INK_FAINT_LIGHT = "oklch(0.62 0.008 60)";
const DIRTY_LIGHT = "oklch(0.5 0.21 330)";

function entry(
  id: number,
  issueKey: string,
  seconds: number,
  pushState: State,
  clock = "09:15",
): StubEntry {
  return {
    id,
    instanceId: 1,
    instanceName: "Ridgeline",
    instancePosition: 0,
    issueKey,
    day: DAY,
    startedAt: `${DAY}T${clock}:00+02:00`,
    seconds,
    comment: `comment ${String(id)}`,
    pushState,
  };
}

async function stubEntries(page: Page, seed: StubEntry[]): Promise<Recorder> {
  const entries = [...seed];
  const before = new Map<number, State>();
  const recorder: Recorder = { deleted: [], restored: [] };

  await page.route("**/api/entries**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const id = Number(/\/api\/entries\/(\d+)/.exec(url.pathname)?.[1] ?? 0);
    const found = entries.find((candidate) => candidate.id === id);

    if (request.method() === "GET") {
      await route.fulfill({ status: 200, json: { today: DAY, entries } });

      return;
    }
    if (request.method() === "DELETE" && found) {
      recorder.deleted.push(id);
      if (found.pushState === "unpushed") {
        entries.splice(entries.indexOf(found), 1);
      } else if (found.pushState !== "deleted") {
        before.set(id, found.pushState);
        found.pushState = "deleted";
      }
      await route.fulfill({ status: 204, body: "" });

      return;
    }
    if (request.method() === "POST" && url.pathname.endsWith("/restore") && found) {
      recorder.restored.push(id);
      const earlier = before.get(id);
      if (found.pushState !== "deleted" || earlier === undefined) {
        await route.fulfill({
          status: 409,
          json: { code: "entry_not_pending_delete", message: "the entry is not waiting to be deleted" },
        });

        return;
      }
      found.pushState = earlier;
      await route.fulfill({ status: 200, json: found });

      return;
    }
    await route.fulfill({ status: 404, json: { code: "not_found", message: "no such entry" } });
  });

  return recorder;
}

/** One instance with WORK-412 assigned, nothing pinned, and `seed` logged today. */
async function openToday(page: Page, seed: StubEntry[]): Promise<Recorder> {
  const recorder = await stubEntries(page, seed);
  await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));
  await page.route("**/api/issues", (route) =>
    route.fulfill({
      status: 200,
      json: {
        instances: [
          {
            id: 1,
            name: "Ridgeline",
            issues: [
              {
                key: "WORK-412",
                summary: "Fix the CSV export encoding",
                status: "In Progress",
                url: "https://work.atlassian.net/browse/WORK-412",
              },
            ],
            error: null,
          },
        ],
      },
    }),
  );
  await page.route("**/api/issues/search**", (route) =>
    route.fulfill({ status: 200, json: { results: [], errors: [] } }),
  );
  await page.goto("/today");

  return recorder;
}

function trigger(page: Page, key: string) {
  return page.getByRole("button", { name: new RegExp(`Log time against ${key}`) });
}

function dialog(page: Page) {
  return page.locator("that-entry-dialog dialog");
}

function rows(page: Page) {
  return dialog(page).locator("ul > li");
}

async function confirmDelete(page: Page, clock: string): Promise<void> {
  await dialog(page).getByRole("button", { name: `Delete the ${clock} entry` }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
}

test("deleting a pushed entry strikes its row, marks it, and puts Restore where Delete was", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  const recorder = await openToday(page, [
    entry(1, "WORK-412", 5400, "pushed"),
    entry(2, "WORK-412", 3600, "pushed", "11:00"),
  ]);
  await trigger(page, "WORK-412").click();
  await expect(dialog(page).locator("#that-entry-dialog-total")).toHaveText("2h 30m");

  const row = rows(page).nth(0);
  const deleteBox = await row.getByRole("button", { name: "Delete the 09:15 entry" }).boundingBox();
  const markBox = await row.getByRole("img").boundingBox();

  await confirmDelete(page, "09:15");

  expect(recorder.deleted).toEqual([1]);
  await expect(rows(page)).toHaveCount(2);
  const restore = row.getByRole("button", { name: "Restore the 09:15 entry" });
  await expect(restore).toBeVisible();
  await expect(row.getByRole("button", { name: /^(Edit|Delete) the 09:15 entry$/ })).toHaveCount(0);

  const mark = row.getByRole("img");
  await expect(mark).toHaveAttribute("aria-label", "deleted at next push");
  await expect(mark).toHaveCSS("color", DIRTY_LIGHT);
  await expect(mark.locator("svg circle")).toHaveCount(1);

  // By class, not by text: the comment's cut-text tooltip carries the same words.
  for (const text of [row.locator("span.font-mono"), row.locator("span.truncate")]) {
    await expect(text).toHaveCSS("text-decoration-line", "line-through");
    await expect(text).toHaveCSS("text-decoration-color", INK_FAINT_LIGHT);
    await expect(text).toHaveCSS("color", INK_MUTED_LIGHT);
  }
  await expect(restore).toHaveCSS("color", INK_LIGHT);
  await expect(dialog(page).locator("#that-entry-dialog-total")).toHaveText("1h 00m");

  // Option C: Restore takes the delete slot and the edit slot keeps its width,
  // so nothing in the row moves.
  const restoreBox = await restore.boundingBox();
  expect(restoreBox?.x).toBeCloseTo(deleteBox?.x ?? -1, 0);
  expect(restoreBox?.y).toBeCloseTo(deleteBox?.y ?? -1, 0);
  expect((await mark.boundingBox())?.x).toBeCloseTo(markBox?.x ?? -1, 0);

  // Focus lands on the control that undoes what was just pressed.
  await expect(restore).toBeFocused();
  await restore.hover();
  await expect(row.locator("that-tooltip", { hasText: "restore entry" })).toBeVisible();
});

test("restore brings the entry, its earlier state and the dialog's total back", async ({ page }) => {
  const recorder = await openToday(page, [entry(1, "WORK-412", 5400, "dirty")]);
  await trigger(page, "WORK-412").click();
  await confirmDelete(page, "09:15");
  await expect(dialog(page).locator("#that-entry-dialog-total")).toHaveText("0h 00m");

  await rows(page).nth(0).getByRole("button", { name: "Restore the 09:15 entry" }).click();

  expect(recorder.restored).toEqual([1]);
  const row = rows(page).nth(0);
  await expect(row.getByRole("img")).toHaveAttribute("aria-label", "edited since it was pushed");
  await expect(row.locator("span.font-mono")).toHaveCSS("text-decoration-line", "none");
  await expect(dialog(page).locator("#that-entry-dialog-total")).toHaveText("1h 30m");
  await expect(row.getByRole("button", { name: "Delete the 09:15 entry" })).toBeFocused();
});

test("the confirm says when the delete happens: at the next push for an entry Jira holds, now for one it does not", async ({
  page,
}) => {
  await openToday(page, [
    entry(1, "WORK-412", 5400, "pushed"),
    entry(2, "WORK-412", 3600, "dirty", "11:00"),
    entry(3, "WORK-412", 900, "unpushed", "13:00"),
  ]);
  await trigger(page, "WORK-412").click();

  for (const [clock, body] of [
    ["09:15", "1h 30m logged at 09:15 will be deleted at the next push. You can restore it until then."],
    ["11:00", "1h 00m logged at 11:00 will be deleted at the next push. You can restore it until then."],
    ["13:00", "0h 15m logged at 13:00 will be removed."],
  ] as const) {
    await dialog(page).getByRole("button", { name: `Delete the ${clock} entry` }).click();
    await expect(page.getByText(body, { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText(body, { exact: true })).toHaveCount(0);
  }
});

test("deleting an unpushed entry removes its row at once", async ({ page }) => {
  const recorder = await openToday(page, [
    entry(1, "WORK-412", 5400, "pushed"),
    entry(2, "WORK-412", 3600, "unpushed", "11:00"),
  ]);
  await trigger(page, "WORK-412").click();

  await confirmDelete(page, "11:00");

  expect(recorder.deleted).toEqual([2]);
  await expect(rows(page)).toHaveCount(1);
  await expect(dialog(page).getByRole("button", { name: /Restore/ })).toHaveCount(0);
});
```

- [ ] **Step 4: Run them; see RED.**

Run: `docker compose run --build --rm --no-deps web node --test src/push-marks.test.ts src/icons.test.ts`
Expected: FAIL on the `words` deepEqual (`deleted: ''`), on `a pending delete wears dirty's hue`, on `countsInTotals` (`true` expected), and on the undo path (`…>undefined</svg>`).

Run the e2e spec (Global Constraints form, `deferred-delete.spec.ts`).
Expected: the first three tests FAIL on their assertions — `Restore the 09:15 entry` never appears (the stub marked it; the dialog still draws Edit and Delete), `toHaveText("0h 00m")` gets `1h 30m`, the confirm body reads `… will be removed.`; `deleting an unpushed entry…` passes (guard).

- [ ] **Step 5: The mark and the helper.** In `web/src/push-marks.ts`, above `PUSH_MARKS`:

```ts
/** #280's slashed ring: dirty's ring with a slash stopping at its inner edge,
 *  like a "no entry" sign, as the design session of 2026-10-08 drew it. */
const SLASHED_RING =
  '<svg class="block" width="9" height="9" viewBox="0 0 9 9" aria-hidden="true">' +
  '<circle cx="4.5" cy="4.5" r="3.75" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
  '<path d="M2.15 6.85 6.85 2.15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
  "</svg>";
```

replace the placeholder with:

```ts
  deleted: {
    words: "deleted at next push",
    // Dirty's hue: Jira holds this time, and what Jira holds is now wrong.
    tone: "text-dirty",
    shape: "size-[9px]",
    markup: SLASHED_RING,
  },
```

and `countsInTotals` with:

```ts
/** Whether an entry counts in a total. A pending delete does not: every total
 *  says what Jira will hold once the push has run (#280). */
export function countsInTotals(entry: Pick<Entry, "pushState">): boolean {
  return entry.pushState !== "deleted";
}
```

Update `PushMark.shape`'s doc to "A drawn silhouette: disc, ring, triangle, slashed ring — one each, so no two states are told apart by hue alone."

- [ ] **Step 6: The undo glyph and the call.** In `web/src/icons.ts`, add `"undo",` to `ICON_NAMES` (after `"trash"`) and to `PATHS`:

```ts
  // #280's Restore, transcribed from the design session's #m-undo (2026-10-08).
  undo: '<path d="M9 6.5 4.5 11 9 15.5"/><path d="M4.5 11h10a5 5 0 0 1 0 10h-3"/>',
```

In `web/src/api.ts`, replace the stub:

```ts
/** Takes back a delete that is waiting for the push (#280), answering with the
 *  entry in the push state it had before. */
export function restoreEntry(id: number): Promise<Entry> {
  return request<Entry>(`/api/entries/${id}/restore`, { method: "POST" });
}
```

- [ ] **Step 7: The dialog.** In `web/src/components/that-entry-dialog.ts`:

Imports: `restoreEntry` joins the `../api` import; `countsInTotals` joins the `../push-marks` import.

Replace `ICON_BUTTON_BASE` and its two derivatives:

```ts
const ICON_BUTTON_FRAME =
  "hover:bg-hover focus-visible:bg-hover flex size-[34px] shrink-0 " +
  "cursor-pointer items-center justify-center rounded-sm";

const ICON_BUTTON_BASE = `text-ink-muted ${ICON_BUTTON_FRAME}`;

const ICON_BUTTON = `${ICON_BUTTON_BASE} hover:text-ink focus-visible:text-ink`;

/** Delete is the one irreversible thing on a row, and the only control in the
 *  app that announces itself before it is pressed. */
const ICON_BUTTON_DESTRUCTIVE = `${ICON_BUTTON_BASE} hover:text-failed focus-visible:text-failed`;

/** Restore is ink at rest, as the design session drew it: it is the one
 *  control on a struck row, and muted would sink it into the strike. */
const ICON_BUTTON_RESTORE = `text-ink ${ICON_BUTTON_FRAME}`;

/** A pending delete's duration and comment: struck, in the muted ink, with the
 *  strike itself in the faint mark colour (#280, option C). */
const STRUCK = ["text-ink-muted", "line-through", "decoration-ink-faint"];
```

(keep the existing long comment above `ICON_BUTTON_BASE`, moved above `ICON_BUTTON_FRAME`).

In `renderEntries`, the total line becomes:

```ts
    total.textContent = totalFigure(
      this.entries.filter(countsInTotals).reduce((sum, entry) => sum + entry.seconds, 0),
    );
```

In `entryRow`: after `duration.textContent = …` add `if (pending) duration.classList.add(...STRUCK);` with `const pending = entry.pushState === "deleted";` as the method's first line; after the comment's `if (entry.comment === "") { … }` block add `if (pending) comment.classList.add(...STRUCK);`. Replace the `editId` constant and the `actions` block with:

```ts
    const time = clockTime(entry.startedAt);
    const actions = document.createElement("div");
    actions.className = "flex shrink-0 items-center gap-1.5";
    if (pending) {
      // The edit slot stays, empty, so Restore lands exactly where Delete was
      // and nothing in the row moves.
      const editSlot = document.createElement("span");
      editSlot.className = "size-[34px] shrink-0";
      actions.append(
        editSlot,
        ...rowAction(
          "undo",
          `Restore the ${time} entry`,
          "restore entry",
          ICON_BUTTON_RESTORE,
          this.restoreId(entry),
          () => {
            void this.restore(entry);
          },
        ),
      );
    } else {
      actions.append(
        ...rowAction(
          "edit",
          `Edit the ${time} entry`,
          "edit entry",
          ICON_BUTTON,
          `that-entry-edit-${this.sequence}-${entry.id}`,
          () => {
            this.startEditing(entry);
          },
        ),
        ...rowAction(
          "trash",
          `Delete the ${time} entry`,
          "delete entry",
          ICON_BUTTON_DESTRUCTIVE,
          this.deleteId(entry),
          () => {
            void this.confirmAndDelete(entry);
          },
        ),
      );
    }
```

In `pushMark`, the `else if (state.shape !== undefined)` branch becomes:

```ts
    } else if (state.shape !== undefined) {
      const shape = document.createElement("span");
      shape.className = state.shape;
      if (state.markup !== undefined) shape.innerHTML = state.markup;
      holder.append(shape);
    }
```

Replace `confirmAndDelete`:

```ts
  private async confirmAndDelete(entry: Entry): Promise<void> {
    const logged = `${totalFigure(entry.seconds)} logged at ${clockTime(entry.startedAt)}`;
    // An entry Jira holds waits for the push and can be restored until then;
    // one it does not goes now. Neither wording names Jira (#280, decision 9).
    const waits = entry.pushState === "pushed" || entry.pushState === "dirty";
    const confirmed = await confirmDestructive({
      heading: "Delete this entry?",
      body: waits
        ? `${logged} will be deleted at the next push. You can restore it until then.`
        : `${logged} will be removed.`,
      confirmLabel: "Delete",
    });
    if (!confirmed) return;

    this.clearNotice();
    try {
      await deleteEntry(entry.id);
      // An entry being edited that is then deleted leaves the foot form bound
      // to a row that is gone or can no longer be edited.
      if (this.editing?.id === entry.id) this.stopEditing();
      await this.afterMutation();
      this.focusOrFallback(this.restoreId(entry));
    } catch (error) {
      this.showFailure(error, "Could not delete the entry.");
    }
  }

  private async restore(entry: Entry): Promise<void> {
    this.clearNotice();
    try {
      await restoreEntry(entry.id);
      await this.afterMutation();
      this.focusOrFallback(this.deleteId(entry));
    } catch (error) {
      this.showFailure(error, "Could not restore the entry.");
    }
  }

  private deleteId(entry: Entry): string {
    return `that-entry-delete-${this.sequence}-${entry.id}`;
  }

  private restoreId(entry: Entry): string {
    return `that-entry-restore-${this.sequence}-${entry.id}`;
  }

  /** Delete and Restore share a slot, so after either the other is where focus
   *  goes; a row that is gone falls back to Close. */
  private focusOrFallback(id: string): void {
    const control = this.dialog?.querySelector<HTMLElement>(`#${id}`);
    if (control) control.focus();
    else this.refocusIfLostFromDialog();
  }
```

`rowAction`'s signature becomes `(icon: "edit" | "trash" | "undo", description: string, words: string, className: string, id: string, act: () => void)`, with `button.className = className;`; update its doc's last sentence to name "restore entry" too.

- [ ] **Step 8: Run them; see GREEN.** Prettier on the touched `web/src` files, then `make tsc`, `make test-web`, `make lint`, and the e2e spec. Expected: all PASS in Firefox and Chromium. Also run `entries.spec.ts` (its delete and mark tests touch this code): `npx playwright test entries.spec.ts`.

- [ ] **Step 9: Mutations** (one test each; red, restore, green):
  1. Remove the `if (pending)` actions branch (always Edit + Delete) → "deleting a pushed entry…" red on `Restore the 09:15 entry` toBeVisible.
  2. Drop `editSlot` from the append → red on `restoreBox.x` toBeCloseTo.
  3. Drop `duration.classList.add(...STRUCK)` → red on `text-decoration-line`; drop `decoration-ink-faint` from `STRUCK` → red on `text-decoration-color`.
  4. `ICON_BUTTON_RESTORE = ICON_BUTTON` → red on restore `color` (ink-muted).
  5. `tone: "text-pending"` on `deleted` → unit red (`wears dirty's hue`) and e2e red on mark `color`.
  6. Drop the `markup` line in `pushMark` → red on `svg circle` count.
  7. Total without `.filter(countsInTotals)` → red on `toHaveText("1h 00m")`.
  8. `countsInTotals` returns `true` → unit red.
  9. `waits = entry.pushState === "pushed"` → confirm test red on the `11:00` (dirty) body; `waits = true` → red on the `13:00` body.
  10. In `restore`, skip `afterMutation` → "restore brings…" red on `edited since it was pushed`.
  11. `focusOrFallback(this.deleteId(entry))` after a delete → red on `restore` toBeFocused.
  12. Alter one coordinate in `PATHS.undo` → icons test red; in `SLASHED_RING` → push-marks test red.

- [ ] **Step 10: Commit.**

```bash
git add web/src/types.ts web/src/push-marks.ts web/src/push-marks.test.ts web/src/icons.ts web/src/icons.test.ts \
  web/src/api.ts web/src/components/that-entry-dialog.ts .claude/e2e/tests/deferred-delete.spec.ts
git commit -m "feat(#280): the entry dialog strikes a pending delete and offers Restore

The slashed ring marks it, Restore takes the delete slot, and the confirm
says when the delete happens.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DhrQjSkmUmfVxLZHhaYLwQ"
```

---

### Task 7: Week's cells and day totals, Today, the rail and the push report

**Files:**
- Modify: `web/src/week-grid.ts` (`markerFor`, `ticketCell`, `dayTotal`)
- Modify: `web/src/views/today.ts` (`refreshTotals`)
- Modify: `web/src/rail.ts` (`paintFigures`)
- Modify: `web/src/push-report.ts` (imports, success line)
- Test: `web/src/week-grid.test.ts`, `web/src/push-report.test.ts` (new), `.claude/e2e/tests/deferred-delete.spec.ts`

**Interfaces:**
- Consumes (Task 6): `PUSH_MARKS.deleted`, `PushMark.markup`, `countsInTotals`, the `"deleted"` unions; e2e helpers in `deferred-delete.spec.ts`. Codebase: `pushReportLines(responses, unanswered, options?)`, `ReportLine`.
- Produces: nothing later tasks consume.

- [ ] **Step 1: Write the failing unit tests.** Append to `web/src/week-grid.test.ts`:

```ts
test("a cell holding a pending delete wears the slashed ring beside its figure", () => {
  const grid = weekGrid(
    rollup([row({ byDay: { 1: { seconds: 5400, pushState: "deleted" } } })]),
    noFailures(),
    noop,
  );
  const button = cellButton(grid, 0, 1);
  const mark = button.querySelector("span[aria-hidden='true']");

  assert.ok(mark?.classList.contains("text-dirty"), "the mark is not in dirty's hue");
  assert.ok(mark?.querySelector("svg circle"), "the mark is not the slashed ring");
  assert.equal(button.textContent, "1h 30m");
  assert.equal(
    button.getAttribute("aria-label"),
    "ABC-1, Tue 8, 1h 30m, deleted at next push, click to edit",
  );
  assert.equal(
    button.parentElement?.querySelector("that-tooltip")?.textContent,
    "1h 30m · deleted at next push · click to edit",
  );
});

test("a cell whose only entries wait to be deleted keeps its dash and wears the mark", () => {
  const grid = weekGrid(
    rollup([row({ byDay: { 2: { seconds: 0, pushState: "deleted" } } })]),
    noFailures(),
    noop,
  );
  const button = cellButton(grid, 0, 2);

  assert.ok(button.querySelector("span[aria-hidden='true'] svg"), "the emptied cell lost its mark");
  assert.equal(button.textContent, "—");
  assert.equal(
    button.getAttribute("aria-label"),
    "ABC-1, Wed 9, no time logged, deleted at next push, click to edit",
  );
  assert.equal(
    button.parentElement?.querySelector("that-tooltip")?.textContent,
    "No time logged · deleted at next push · click to edit",
  );
});

test("a day whose only entries wait to be deleted shows a muted dash wearing the mark", () => {
  const grid = weekGrid(
    rollup([row({ byDay: { 2: { seconds: 0, pushState: "deleted" } } })], {
      2: { pushState: "deleted" },
    }),
    noFailures(),
    noop,
  );
  const wednesday = footCells(grid)[2];
  const mark = wednesday?.querySelector("[role='img']");

  assert.equal(mark?.getAttribute("aria-label"), "deleted at next push");
  assert.ok(mark?.querySelector("svg"), "the day's mark is not the slashed ring");
  assert.ok(wednesday?.classList.contains("text-ink-muted"), "the emptied day is not muted");
  assert.equal(wednesday?.lastChild?.textContent, "—");
});
```

Create `web/src/push-report.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { pushReportLines } from "./push-report.ts";
import type { PushResult } from "./types.ts";

function result(entryId: number, status: PushResult["status"], code?: string): PushResult {
  return {
    entryId,
    issueKey: `RIDGE-${String(entryId)}`,
    instanceId: 1,
    status,
    ...(code === undefined ? {} : { error: { code, message: `${code} happened` } }),
  };
}

test("a clean push names its deletes beside what it pushed", () => {
  const lines = pushReportLines(
    [{ day: "2026-10-09", results: [result(1, "pushed"), result(2, "pushed"), result(3, "deleted")] }],
    [],
  );

  assert.deepEqual(
    lines.map((line) => [line.tone, line.message]),
    [["success", "Pushed 2 entries and deleted 1."]],
  );
});

test("a push with no deletes reads as it always has", () => {
  const lines = pushReportLines([{ day: "2026-10-09", results: [result(1, "pushed")] }], []);

  assert.deepEqual(lines.map((line) => line.message), ["Pushed 1 entry."]);
});

// Review focus 2: Jira deleted the worklog and the row survived. Pushing again
// is the fix, so this is offered a retry — never the store_failed line that
// tells the reader to stop.
test("a delete the store could not record is offered a retry", () => {
  const lines = pushReportLines(
    [{ day: "2026-10-09", results: [result(1, "failed", "delete_unrecorded")] }],
    [],
  );

  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.tone, "warning");
  assert.match(lines[0]?.message ?? "", /Press Push worklogs again/);
});
```

The third test is a *guard*.

In `web/src/push-report.ts`, change the three imports to carry `.ts` (`"./fetch-report.ts"`, `"./toast.ts"`, `"./types.ts"`) — the same form `week-grid.ts` uses — so `node --test` can load the module.

- [ ] **Step 2: Write the failing e2e tests.** Append to `.claude/e2e/tests/deferred-delete.spec.ts`:

```ts
test("a ticket whose only time today is a pending delete reads Log 0:00, and the rail still has it to push", async ({
  page,
}) => {
  await openToday(page, [entry(1, "WORK-412", 5400, "deleted")]);

  await expect(trigger(page, "WORK-412")).toHaveText("Log0:00");
  await expect(page.locator("#rail-total")).toHaveText("0h 00m");
  await expect(page.locator("#rail-unpushed")).toHaveText("1 entry to push");
  await expect(page.getByRole("button", { name: "Push worklogs" })).toBeEnabled();
});

test("deleting and restoring move Today's row and the rail out and back", async ({ page }) => {
  await openToday(page, [entry(1, "WORK-412", 5400, "pushed")]);
  await expect(page.locator("#rail-total")).toHaveText("1h 30m");
  await expect(page.locator("#rail-unpushed")).toHaveText("Nothing to push");
  await trigger(page, "WORK-412").click();

  await confirmDelete(page, "09:15");

  await expect(trigger(page, "WORK-412")).toHaveText("Log0:00");
  await expect(page.locator("#rail-total")).toHaveText("0h 00m");
  await expect(page.locator("#rail-unpushed")).toHaveText("1 entry to push");

  await rows(page).nth(0).getByRole("button", { name: "Restore the 09:15 entry" }).click();

  await expect(trigger(page, "WORK-412")).toHaveText("Log1:30");
  await expect(page.locator("#rail-total")).toHaveText("1h 30m");
  await expect(page.locator("#rail-unpushed")).toHaveText("Nothing to push");
});

// Review focus 4: the off-list row is the only way back to the dialog for a
// ticket that is neither assigned nor pinned, so it must survive its only
// entry being marked.
test("an off-list ticket whose only entry is a pending delete keeps its row", async ({ page }) => {
  await openToday(page, [entry(1, "WORK-777", 3600, "deleted")]);

  const offList = page.getByRole("region", { name: "Logged today, not on your list" });
  await expect(offList.getByText("WORK-777")).toBeVisible();
  await expect(trigger(page, "WORK-777")).toHaveText("Log0:00");
});

const WEEK = {
  start: "2026-09-07",
  end: "2026-09-13",
  prevStart: "2026-08-31",
  nextStart: "2026-09-14",
  weekNumber: 37,
  days: [
    { day: "2026-09-07", seconds: 7200, pushState: "pushed" },
    { day: "2026-09-08", seconds: 5400, pushState: "deleted" },
    { day: "2026-09-09", seconds: 0, pushState: "deleted" },
    { day: "2026-09-10", seconds: 0, pushState: null },
    { day: "2026-09-11", seconds: 0, pushState: null },
    { day: "2026-09-12", seconds: 0, pushState: null },
    { day: "2026-09-13", seconds: 0, pushState: null },
  ],
  rows: [
    {
      instanceId: 1,
      instanceName: "Ridgeline",
      instancePosition: 0,
      issueKey: "WORK-412",
      url: "https://work.atlassian.net/browse/WORK-412",
      cells: [
        { seconds: 7200, pushState: "pushed" },
        { seconds: 5400, pushState: "deleted" },
        { seconds: 0, pushState: "deleted" },
        { seconds: 0, pushState: null },
        { seconds: 0, pushState: null },
        { seconds: 0, pushState: null },
        { seconds: 0, pushState: null },
      ],
      seconds: 12600,
    },
  ],
  seconds: 12600,
};

test("Week marks a cell holding a pending delete, and an emptied cell keeps its dash with the mark", async ({
  page,
}) => {
  await page.route("**/api/entries**", (route) =>
    route.fulfill({ status: 200, json: { today: "2026-09-07", entries: [] } }),
  );
  await page.route("**/api/week**", (route) => route.fulfill({ status: 200, json: WEEK }));
  await page.goto("/week");

  const cells = page.locator("tbody tr", { hasText: "WORK-412" }).locator("td");
  const tuesday = cells.nth(1).locator("button");
  const wednesday = cells.nth(2).locator("button");

  await expect(tuesday).toHaveAttribute(
    "aria-label",
    "WORK-412, Tue 8, 1h 30m, deleted at next push, click to edit",
  );
  await expect(tuesday.locator("svg circle")).toHaveCount(1);

  await expect(wednesday).toHaveText("—");
  await expect(wednesday.locator("svg circle")).toHaveCount(1);
  await expect(wednesday).toHaveAttribute(
    "aria-label",
    "WORK-412, Wed 9, no time logged, deleted at next push, click to edit",
  );
  await wednesday.hover();
  await expect(cells.nth(2).locator("that-tooltip")).toHaveText(
    "No time logged · deleted at next push · click to edit",
  );
});
```

- [ ] **Step 3: Run them; see RED.**

Run: `docker compose run --build --rm --no-deps web node --test src/week-grid.test.ts src/push-report.test.ts`
Expected: the pending-delete cell test FAIL on `the mark is not the slashed ring` (the span has the shape class but no SVG); the emptied-cell test FAIL on `the emptied cell lost its mark`; the day test FAIL on `aria-label` (`undefined`); `a clean push names its deletes…` FAIL on `Pushed 2 entries.`; the other two pass (one is the unchanged path, one a guard).

Run the e2e spec. Expected: the Today test FAIL on `Log1:30` for `Log0:00`; the delete/restore test FAIL on `Log1:30` after the delete; the Week test FAIL on `wednesday` `toHaveText("—")`'s mark count (0). The off-list test passes (guard — `regions.entries` already lists it).

- [ ] **Step 4: Week grid.** In `web/src/week-grid.ts`, import `type PushMark` beside `PUSH_MARKS`. `markerFor` becomes:

```ts
function markerFor(
  pushState: PushState,
  failed: boolean,
): { className: string; words: string; markup: string | undefined } | undefined {
  const state = knownPushState(failed ? "failed" : (pushState ?? "pushed"));
  if (state === "pushed") return undefined;
  const mark: PushMark = PUSH_MARKS[state];

  return { className: `${mark.tone} ${mark.shape ?? ""}`, words: mark.words, markup: mark.markup };
}
```

In `ticketCell`, replace the `empty`/`words`/`figure` constants with:

```ts
  // Empty means no entries at all. A cell holding only pending deletes shows no
  // time either, but keeps its mark and opens to edit, so it never reads as a
  // day with nothing on it (#280).
  const empty = cell.pushState === null;
  const words = pushWords(cell.pushState, failed);
  const figure = cell.seconds === 0 ? "—" : totalFigure(cell.seconds);
  const spoken = cell.seconds === 0 ? "no time logged" : figure;
```

the `aria-label` non-empty branch becomes `` `${row.issueKey}, ${dayLabel}, ${spoken}, ${words}, click to edit` ``; inside the `else` (non-empty) branch, after `mark.setAttribute("aria-hidden", "true");` add `if (marker.markup !== undefined) mark.innerHTML = marker.markup;`, and the figure span's class becomes `fig.className = cell.seconds === 0 ? "text-ink-muted" : "font-mono";`; the tooltip's non-empty text becomes `` `${cell.seconds === 0 ? "No time logged" : figure} · ${words} · click to edit` ``.

In `dayTotal`, the early return's condition becomes `if (day.pushState === null) {`; inside `if (marker) { … }` add `if (marker.markup !== undefined) mark.innerHTML = marker.markup;` after the class line; and the last lines become:

```ts
  if (day.seconds === 0) td.classList.add("text-ink-muted");
  td.append(document.createTextNode(day.seconds === 0 ? "—" : totalFigure(day.seconds)));
```

Update `dayTotal`'s doc with one sentence: "A day holding only pending deletes is a muted dash that still wears its mark, like such a cell."

- [ ] **Step 5: Today and the rail.** In `web/src/views/today.ts`, import `countsInTotals` from `"../push-marks"`; in `refreshTotals` the loop becomes:

```ts
  for (const entry of entries) {
    if (!countsInTotals(entry)) continue;
    const id = totalKey(entry.instanceId, entry.issueKey);
    regions.totals.set(id, (regions.totals.get(id) ?? 0) + entry.seconds);
  }
```

(`regions.entries = entries` above it stays whole — the off-list section reads it, and review focus 4 depends on that.)

In `web/src/rail.ts`, import `countsInTotals` from `"./push-marks"`; the first two lines of `paintFigures` after the guard become:

```ts
    const counted = lastEntries.filter(countsInTotals);
    const slices = sliceByInstance(counted);
    let seconds = counted.reduce((sum, entry) => sum + entry.seconds, 0);
```

In the push button's click handler, the confirmation's sum becomes (ruling 7):

```ts
      const seconds = due.filter(countsInTotals).reduce((sum, entry) => sum + entry.seconds, 0);
```

Add to this task's e2e spec: with one pushed entry of 1h and one pending delete of 30m on the day, plus one unpushed 15m entry, the rail push confirmation's body reads `2 entries totalling 0:15` (match the exact figure format `totalFigure` produces). `isPending` is unchanged; extend `isPending`'s comment: "never sent, sent and edited since, or deleted and waiting for the push to say so."

- [ ] **Step 6: The push report.** In `web/src/push-report.ts`, in `pushReportLines` add `const deleted = all.filter((line) => line.result.status === "deleted");` beside `pushed`, and the success return's message becomes `pushedLine(pushed.length, deleted.length)`. Add at the end of the file:

```ts
/** "Pushed 2 entries." — and the deletes beside them when there were any, the
 *  way the fetch report words its two counts. */
function pushedLine(pushed: number, deleted: number): string {
  const entries = `${String(pushed)} ${pushed === 1 ? "entry" : "entries"}`;

  return deleted === 0 ? `Pushed ${entries}.` : `Pushed ${entries} and deleted ${String(deleted)}.`;
}
```

- [ ] **Step 7: Run them; see GREEN.** Prettier on the touched `web/src` files; `make tsc`; `make test-web`; `make lint`; the e2e spec; then `week.spec.ts`, `today.spec.ts`, `push.spec.ts` and `toast.spec.ts` (they cover the code this task touched).

- [ ] **Step 8: Mutations:**
  1. `const empty = cell.seconds === 0;` → emptied-cell unit test and the Week e2e red.
  2. Drop the `innerHTML = marker.markup` line in `ticketCell` → pending-delete cell unit test red; in `dayTotal` → the day test red.
  3. `dayTotal`'s early return back on `day.seconds === 0` → day test red on `aria-label`.
  4. Drop the `countsInTotals` line in `refreshTotals` → Today e2e red on `Log0:00`.
  5. `paintFigures` over `lastEntries` again → Today e2e red on `#rail-total`.
  6. `isPending` as `entry.pushState === "unpushed" || entry.pushState === "dirty"` → red on `1 entry to push` (both Today tests).
  7. The confirmation's sum over `due` again → red on the confirmation's total.
  7. `pushedLine` ignores `deleted` → push-report unit red.
  8. Put `delete_unrecorded` in the `stranded` filter (`code === "store_failed" || code === "delete_unrecorded"`) → the guard red.
  9. Filter `regions.entries` too (`regions.entries = entries.filter(countsInTotals)`) → off-list e2e red.

- [ ] **Step 9: Commit.**

```bash
git add web/src/week-grid.ts web/src/week-grid.test.ts web/src/views/today.ts web/src/rail.ts \
  web/src/push-report.ts web/src/push-report.test.ts .claude/e2e/tests/deferred-delete.spec.ts
git commit -m "feat(#280): Week, Today and the rail leave a pending delete out of their totals

A Week cell and a day total wear the slashed ring, an emptied one keeps its
dash, and the push report names the deletes it made.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DhrQjSkmUmfVxLZHhaYLwQ"
```

---

### Task 8: The design of record and the visual language, then the gate

**Files:**
- Modify: `docs/superpowers/specs/2026-08-04-thatapp-design.md` (*Data model*, *Push semantics*, *Partial failure*, *API surface*)
- Modify: `docs/superpowers/specs/2026-08-20-visual-design-language.md` (*Roles*)

- [ ] **Step 1: Data model.** In the `time_entries` block, after `updated_at`, add:

```sql
  deleted_at     DATETIME,               -- set while a delete waits for the push (#280)
```

- [ ] **Step 2: Push semantics.** Replace the section's table and the paragraph beginning "Deleting an entry that has a `worklog_id`…" and the "Because state is derived…" line with:

```markdown
| State | Condition | Push action |
|---|---|---|
| Unpushed | `worklog_id IS NULL` | `POST` worklog, store returned ID, set `pushed_at` |
| Pushed, clean | `worklog_id NOT NULL AND deleted_at IS NULL AND updated_at <= pushed_at` | none |
| Pushed, dirty | `worklog_id NOT NULL AND deleted_at IS NULL AND (pushed_at IS NULL OR updated_at > pushed_at)` | `PUT` worklog, set `pushed_at` |
| Pending delete | `worklog_id NOT NULL AND deleted_at IS NOT NULL` | `DELETE` worklog (a Jira `404` counts as success), then delete the row |

Deleting an entry waits for the push, like every other change to Jira (#280). An entry with a
`worklog_id` is only marked: `deleted_at` is set, no request goes to Jira, and from then on it
counts in no total — not the entry dialog's, Today's, the rail's or Week's. Until the push it can
be restored (`POST /api/entries/:id/restore`), which clears `deleted_at` and nothing else. Setting
and clearing `deleted_at` never touches `updated_at` or `pushed_at`, so a restored entry is back in
exactly the state it had: pushed stays pushed, dirty stays dirty. An entry without a `worklog_id`
has nothing in Jira, and its delete removes the row at once; an unpushed row never carries
`deleted_at`. A pending delete cannot be edited (`PATCH` answers `409`; restore it first), and a
week fetch leaves it alone — the delete wins over whatever Jira returns for its worklog.

Because state is derived, pushing the same day repeatedly is safe and idempotent: a second push
after a successful delete finds no row and makes no request for it.
```

- [ ] **Step 3: Partial failure.** Replace "Entries that failed keep `worklog_id IS NULL` and are retried by the next push." with:

```markdown
Entries that failed keep what made them due — `worklog_id IS NULL` for a create, a stale
`pushed_at` for an update, `deleted_at` for a delete — and are retried by the next push.
```

- [ ] **Step 4: API surface.** After `DELETE  /api/entries/:id`, add:

```
POST    /api/entries/:id/restore         take back a delete waiting for the push (#280)
```

- [ ] **Step 5: The visual language.** In *Roles*, after the paragraph ending "…it cannot be mistaken for a primary action.", add:

```markdown
**Deleted at next push** shares Dirty's hue and token: a pending delete is time Jira holds and Jira
is now wrong about, which is Dirty's reason for its hue (#280). Its shape is Dirty's ring with a
slash inside it, a "no entry" sign — drawn as SVG on a 9×9 box, a circle of radius 3.75 and a slash
from (2.15, 6.85) to (6.85, 2.15), both stroked 1.5 with round caps, the slash stopping at the
ring's inner edge. It is the one mark drawn as SVG; disc, ring and triangle stay CSS-drawn. Ring
against slashed ring is a distinction of shape, as ring against disc is, so it too survives a
monochrome screen. In a week grid it ranks under not pushed and over edited since pushed.
```

and in the paragraph beginning "Amber and red are deliberately different things", change "Dirty's distinction from not-pushed — ring against fill — relies on shape alone" to "Dirty's distinction from not-pushed — ring against fill — and deleted-at-next-push's from dirty — slashed ring against ring — rely on shape alone".

- [ ] **Step 6: The gate.**

```shell
make verify
make test-e2e
```

Expected: both green. If `make test-e2e` shows a failure outside `deferred-delete.spec.ts`, rerun that spec alone once; a second failure is a finding, not a flake — report it. Paste both outputs' last lines in the report.

- [ ] **Step 7: Commit.**

```bash
git add docs/superpowers/specs/2026-08-04-thatapp-design.md docs/superpowers/specs/2026-08-20-visual-design-language.md
git commit -m "docs(#280): push semantics and the visual language gain the pending delete

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DhrQjSkmUmfVxLZHhaYLwQ"
```

Screenshots of the dialog row and the Week cells, light and dark, are the controller's step after this plan, uploaded with `.claude/tools/pr-attach.sh`; nothing in this plan captures or commits them.

---

## Acceptance criteria → tests

| Criterion (#280) | Task | Test(s) |
|---|---|---|
| Deleting a pushed or dirty entry sets `deleted_at` and makes no request to Jira | 2 | `TestDeleteEntryWaitsForPush` (pushed, edited), `TestDeleteDuringAPushMarksTheWorklogThePushCreated` |
| Deleting an unpushed entry deletes the row at once, no Jira request | 2, 6 | `TestDeleteEntryWaitsForPush/an unpushed entry goes at once`; e2e "deleting an unpushed entry removes its row at once" |
| A pending delete is left out of Today's, Week's and the rail's totals | 5, 6, 7 | `TestWeekLeavesPendingDeletesOutOfItsTotals`; e2e "deleting a pushed entry strikes…" (dialog total), "a ticket whose only time today…", "deleting and restoring move Today's row and the rail…"; unit `countsInTotals` |
| A pending delete is shown as the design session decided — dialog, Today, Week | 6, 7 | e2e "deleting a pushed entry strikes its row…", "Week marks a cell…"; unit week-grid ×3, push-marks slashed ring; Today draws nothing new (decision 8) — "a ticket whose only time today… reads Log 0:00" |
| Restore clears `deleted_at`; the entry returns to its earlier state and counts again | 1, 2, 6, 7 | `TestDeletedAtLeavesThePushColumnsAlone`, `TestRestoreReturnsTheEarlierPushState`; e2e "restore brings the entry…", "deleting and restoring move…" |
| Restore answers 404 for a missing entry and 409 for one not pending delete | 2 | `TestRestoreAMissingEntryIsNotFound`, `TestRestoreRefusesAnEntryNotWaitingToBeDeleted` |
| Editing a pending-delete entry answers 409 | 2 | `TestPatchAPendingDeleteIsAConflict` |
| Push deletes the worklog of each pending delete on the day, then the row | 3 | `TestPushDeletesAPendingDelete` |
| A Jira 404 on that delete counts as success | 3 | `TestPushDeletesAPendingDelete/a worklog already gone…` |
| A failed Jira delete keeps the row and `deleted_at`, is reported failed, and is retried | 3 | `TestPushDeletesAPendingDelete/a refused delete…`, `TestPushRetriesARefusedDeleteAndThenAsksNothing` |
| A repeated push after a successful delete makes no request for that entry | 3 | `TestPushRetriesARefusedDeleteAndThenAsksNothing` (third push) |
| Fetch does not re-create, overwrite or un-mark a pending delete | 4 | `TestReconcileWorklog` (two cases), `TestFetchWeekLeavesAPendingDeleteAlone` |
| The rail counts a pending delete as work for Push | 7 | e2e "a ticket whose only time today…" (`1 entry to push`, Push enabled) |
| MCP `delete_entry` deletes a pushed entry by marking it; the refusal is gone | 5 | `TestMCPDeleteEntryNeverReachesJira`, `TestMCPListingToolsShowAPendingDeleteAsTheAPIDoes` |
| *Push semantics* describes the deferred delete and its state | 8 | review of Steps 1–5 |
| Table-driven tests cover the derived state, push idempotence and the fetch rule | 1, 3, 4 | `TestPushStateOfDerivesFromTheTwoColumnsAndUpdatedAt`, `TestDeletedAtLeavesThePushColumnsAlone`, `TestPushRetries…`, `TestReconcileWorklog` |
| Light and dark screenshots of the pending-delete state on the PR | — | controller, after Task 8 |
| Each new or changed assertion proven by mutation | 1–7 | each task's Mutations step |
