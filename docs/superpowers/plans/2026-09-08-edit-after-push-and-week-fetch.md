# Edit after push, and a week's fetch — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-09-08
**Supersedes:** nothing
**Superseded by:** nothing

**Goal:** Let an already-pushed entry be corrected or deleted through Jira, and let a week pull its
worklogs back from Jira into local entries.

**Architecture:** Both halves turn on `worklog_id`. Corrections extend the existing push: a dirty
entry updates its worklog instead of being skipped, a deleted entry deletes its worklog first, and
the mark that records a push becomes conditional on the `updated_at` the push read. The fetch is a
new endpoint that searches each instance for issues carrying your worklogs that week, reads those
issues' worklogs, and reconciles them against local entries by `worklog_id` — creating, updating,
or standing back where a local edit has not been pushed.

**Tech Stack:** Go standard library, `modernc.org/sqlite`, `golang.org/x/sync/errgroup`, vanilla
TypeScript, Tailwind CSS v4, Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-07-edit-after-push-and-week-fetch-design.md`](../specs/2026-09-07-edit-after-push-and-week-fetch-design.md)
— approved 2026-09-08. Read it alongside this plan; every task argues from it.

---

## Global Constraints

Copied from `CLAUDE.md` and the spec. Every task's requirements implicitly include these.

- **Nothing runs bare on this host.** No Go, Node or npm. Drive everything through `make` or
  `docker compose`. Single-test example:
  `docker compose run --rm --no-deps app go test ./internal/store/ -run TestX -v`
- **No test contacts a real Jira instance.** Jira calls are exercised against an `httptest.Server`.
- **Go: standard library first.** The approved non-stdlib set is `modernc.org/sqlite` and
  `golang.org/x/sync`. Wrap errors with `%w` and what was attempted.
- **Go tests are table-driven** with `t.Run` subtests, using `httptest` and `testing/fstest`.
- **TypeScript is `strict` with `noUncheckedIndexedAccess`.** Do not weaken `tsconfig.json`. No
  `any`, no `as any`, no non-null assertion.
- **No JavaScript frameworks.** Reusable UI is a `that-*` WebComponent in **light DOM**. One-off
  controls in one view are plain elements — `weekControls` in `web/src/views/week.ts` is the
  precedent and this plan follows it.
- **Push state is derived, never stored.** `pushStateOf` computes it from `worklog_id`, `pushed_at`
  and `updated_at`. No task adds a flag column.
- **The day boundary is `THAT_TIMEZONE`.** The container clock is UTC. Anything deciding which day
  time belongs to resolves against `s.cfg.Location`.
- **Copy names no service.** The fetch control reads **Fetch worklogs**. Do not write "Jira" into
  any string this plan adds. Existing strings that say it are #116's, not this ticket's.
- **Every commit carries the trailer:**

  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XEdXA9ZDvXGcwmfXtovHZZ
  ```

- **Both gates must be green before the pull request:** `make verify` and `make test-e2e`. Paste
  their output. On this host the e2e suite may need the inotify workaround: `make build-web`, then
  `docker compose up -d --no-deps app`, then the Playwright profile with `--no-deps`.

---

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `internal/store/migrations/2026-09-08_100000_worklog_id_unique.sql` | One local entry per Jira worklog, enforced |
| `internal/jira/worklogs_read.go` | The two read calls: issues with your worklogs, and one issue's worklogs |
| `internal/jira/worklogs_read_test.go` | Their `httptest` coverage |
| `internal/server/fetch.go` | `POST /api/week/fetch`: the handler, the per-instance work, the DTOs |
| `internal/server/reconcile.go` | The pure decision: what one remote worklog does to local state |
| `internal/server/reconcile_test.go` | The whole matrix, table-driven |
| `internal/server/fetch_test.go` | The handler end to end against `httptest` Jira |
| `web/src/fetch-report.ts` | The one rendering of a finished fetch |
| `web/src/fetch-report.test.ts` | Its unit coverage |
| `.claude/e2e/tests/fetch.spec.ts` | The browser spec for the control and its three reports |

**Modified:**

| File | Change |
| --- | --- |
| `internal/store/entries.go` | The guarded mark, the fetch's reads and writes |
| `internal/server/push.go` | Dirty entries update; the guarded mark; delete through Jira |
| `internal/server/entries.go` | `handleDeleteEntry` deletes the worklog first |
| `internal/server/server.go` | One route |
| `web/src/icons.ts` | The `fetch` glyph |
| `web/src/types.ts` | `WeekFetchResponse` and its parts |
| `web/src/api.ts` | `fetchWeek` |
| `web/src/views/week.ts` | The control, the rule, the report wiring |
| `.forgejo/workflows/e2e.yml` | The new spec file in `paths:` |

**Task order is the dependency order.** Tasks 1–4 are the corrections half and touch no fetch code.
Tasks 5–8 build the fetch bottom-up. Tasks 9–11 are the browser. Task 12 is the end-to-end suite.

---

### Task 1: The guarded mark — closing #9's lost update

`MarkEntryPushed` writes `worklog_id` and `pushed_at` unconditionally. An edit landing between the
push's read and that write is silently lost: the row is stamped pushed, `updated_at` is older than
`pushed_at`, and the entry reads clean while carrying text Jira never saw. The fix is to make the
mark conditional on the `updated_at` the push actually read.

**Files:**
- Modify: `internal/store/entries.go` (after `MarkEntryPushed`, around line 195)
- Modify: `internal/server/push.go:150-170`
- Test: `internal/store/entries_test.go`, `internal/server/push_test.go`

**Interfaces:**
- Consumes: `store.Entry`, `store.Store`
- Produces: `func (s *Store) MarkEntryPushedIfUnchanged(ctx context.Context, id int64, worklogID string, pushedAt time.Time, expected time.Time) (bool, error)` — `false` with a nil error means an
  edit landed and no row was written. Used by Tasks 2 and 7.

- [ ] **Step 1: Write the failing test**

In `internal/store/entries_test.go`:

```go
func TestMarkEntryPushedIfUnchanged(t *testing.T) {
	tests := []struct {
		name       string
		editBefore bool
		wantMarked bool
	}{
		{name: "marks an entry nothing touched", editBefore: false, wantMarked: true},
		{name: "refuses an entry edited since it was read", editBefore: true, wantMarked: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			s := newTestStore(t)
			inst := createTestInstance(t, s)
			entry, err := s.CreateEntry(t.Context(), store.EntryInput{
				InstanceID: inst.ID, IssueKey: "RID-1", Day: "2026-09-08",
				StartedAt: time.Date(2026, 9, 8, 9, 0, 0, 0, time.UTC), Seconds: 3600,
			})
			if err != nil {
				t.Fatalf("creating an entry: %v", err)
			}

			read := entry.UpdatedAt

			if test.editBefore {
				// A second of separation, because updated_at is stored at
				// RFC3339's one-second resolution: without it the "edited"
				// case would write the same value it read and pass wrongly.
				time.Sleep(1100 * time.Millisecond)
				if _, err := s.UpdateEntry(t.Context(), entry.ID, 7200, "typed while pushing"); err != nil {
					t.Fatalf("editing the entry: %v", err)
				}
			}

			marked, err := s.MarkEntryPushedIfUnchanged(
				t.Context(), entry.ID, "10001", time.Now().UTC(), read)
			if err != nil {
				t.Fatalf("marking pushed: %v", err)
			}
			if marked != test.wantMarked {
				t.Fatalf("marked = %v, want %v", marked, test.wantMarked)
			}

			after, err := s.Entry(t.Context(), entry.ID)
			if err != nil {
				t.Fatalf("re-reading the entry: %v", err)
			}
			if test.wantMarked && after.WorklogID != "10001" {
				t.Fatalf("worklog id = %q, want 10001", after.WorklogID)
			}
			if !test.wantMarked {
				if after.WorklogID != "" {
					t.Fatalf("worklog id = %q, want it left empty so the next push retries", after.WorklogID)
				}
				if after.Seconds != 7200 {
					t.Fatalf("seconds = %d, want the edit kept at 7200", after.Seconds)
				}
			}
		})
	}
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `docker compose run --rm --no-deps app go test ./internal/store/ -run TestMarkEntryPushedIfUnchanged -v`
Expected: FAIL — `s.MarkEntryPushedIfUnchanged undefined`.

- [ ] **Step 3: Write the store method**

In `internal/store/entries.go`, directly after `MarkEntryPushed`:

```go
// MarkEntryPushedIfUnchanged records the worklog an entry became, but only if
// the entry has not been edited since the caller read it. It reports whether the
// row was written.
//
// This is what closes #9's lost update. A push reads an entry, calls Jira, then
// marks it — and an edit arriving in that window used to be stamped pushed and
// silently never sent. Guarding on the updated_at the caller read means such an
// edit leaves no row affected, the entry stays dirty, and the next push sends
// the newer text. The worklog is still created, so nothing is duplicated.
//
// A false return is not an error: it is the guard doing its job.
func (s *Store) MarkEntryPushedIfUnchanged(
	ctx context.Context, id int64, worklogID string, pushedAt, expected time.Time,
) (bool, error) {
	result, err := s.db.ExecContext(ctx,
		`UPDATE time_entries SET worklog_id = ?, pushed_at = ?
		  WHERE id = ? AND updated_at = ?`,
		worklogID,
		pushedAt.UTC().Truncate(time.Second).Format(time.RFC3339),
		id,
		expected.UTC().Truncate(time.Second).Format(time.RFC3339),
	)
	if err != nil {
		return false, fmt.Errorf("recording worklog %s for entry %d: %w", worklogID, id, err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("counting rows updated for entry %d: %w", id, err)
	}

	return affected == 1, nil
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `docker compose run --rm --no-deps app go test ./internal/store/ -run TestMarkEntryPushedIfUnchanged -v`
Expected: PASS, both subtests.

- [ ] **Step 5: Write the failing handler test**

In `internal/server/push_test.go`, add a case asserting that an entry edited during the Jira call
comes back `pushed` with its worklog id but stays dirty in the store. Use an `httptest` Jira whose
worklog handler edits the entry before answering:

```go
func TestPushDayKeepsAnEditThatLandedMidPush(t *testing.T) {
	env := newPushEnv(t)
	entry := env.createEntry(t, "RID-1", 3600, "before")

	env.jira.createWorklog = func() (string, error) {
		// The edit the guard exists for: it lands after the push read the
		// entry and before the push marks it.
		time.Sleep(1100 * time.Millisecond)
		if _, err := env.store.UpdateEntry(t.Context(), entry.ID, 7200, "typed mid-push"); err != nil {
			return "", err
		}

		return "10001", nil
	}

	resp := env.push(t, entry.Day)

	if got := resp.Results[0].Status; got != "pushed" {
		t.Fatalf("status = %q, want pushed: the worklog really was created", got)
	}

	after, err := env.store.Entry(t.Context(), entry.ID)
	if err != nil {
		t.Fatalf("re-reading the entry: %v", err)
	}
	if after.WorklogID != "" {
		t.Fatalf("worklog id = %q, want empty so the next push sends the newer text", after.WorklogID)
	}
	if after.Comment != "typed mid-push" {
		t.Fatalf("comment = %q, want the edit kept", after.Comment)
	}
}
```

If `newPushEnv` and its `createWorklog` hook do not exist in the file's current helpers, build them
from the existing push tests' setup rather than inventing a second harness — read the top of
`internal/server/push_test.go` first and extend what is there.

- [ ] **Step 6: Run it and watch it fail**

Run: `docker compose run --rm --no-deps app go test ./internal/server/ -run TestPushDayKeepsAnEditThatLandedMidPush -v`
Expected: FAIL — the entry comes back carrying `10001`, and the edit is lost.

- [ ] **Step 7: Use the guard in the push**

In `internal/server/push.go`, `pushInstanceEntries`. Replace the `s.db.MarkEntryPushed(...)` call
with the guarded one. The comment above it explains why the return value is discarded:

```go
		// Recorded immediately, per entry, rather than batched at the end: the
		// worklog exists in Jira from here on, and a crash before the write
		// would leave the next push creating a duplicate.
		//
		// WithoutCancel is the same scenario without the crash. ctx descends
		// from the request, which net/http cancels the moment the browser goes
		// away, and database/sql refuses to execute on a cancelled context.
		//
		// The boolean is deliberately discarded. False means an edit landed
		// while Jira was answering: the worklog was still created, so this push
		// succeeded and says so, and the entry stays dirty for the next one to
		// update rather than duplicate.
		if _, err := s.db.MarkEntryPushedIfUnchanged(
			context.WithoutCancel(ctx), entry.ID, worklogID, s.now().UTC(), entry.UpdatedAt,
		); err != nil {
			result.Status = "failed"
			result.WorklogID = worklogID
			result.Error = &errorBody{
				Code: "store_failed",
				Message: "the worklog was created but could not be recorded here; " +
					"pushing again would log the time twice",
			}
			results = append(results, result)
			continue
		}

		result.Status = "pushed"
		result.WorklogID = worklogID
		results = append(results, result)
```

- [ ] **Step 8: Run both suites**

Run: `docker compose run --rm --no-deps app go test ./internal/store/ ./internal/server/ -v`
Expected: PASS, including the two new tests and every existing push test.

- [ ] **Step 9: Delete the now-unused method if nothing calls it**

Run: `docker compose run --rm --no-deps app grep -rn "MarkEntryPushed(" --include=*.go .`
If the only hits are its own definition and its own test, delete `MarkEntryPushed` and its test:
two ways to record a push is exactly the drift #106 is filed about. If something else still calls
it, leave it and say so in the task report.

- [ ] **Step 10: Commit**

```bash
git add internal/store/entries.go internal/store/entries_test.go internal/server/push.go internal/server/push_test.go
git commit -m "fix(#10): marking an entry pushed is conditional on the text that was sent

An edit landing between the push's read and its mark was stamped pushed and
never sent. The mark now names the updated_at the push read, so such an edit
affects no row, the entry stays dirty, and the next push carries the newer
text. The worklog is still created, so nothing duplicates.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XEdXA9ZDvXGcwmfXtovHZZ"
```

---

### Task 2: A dirty entry updates its worklog

`pushInstanceEntries` skips anything whose state is not `unpushed`, so a corrected entry never
reaches Jira. Per the spec's state table, `dirty` must update the worklog it already has, and a 404
means the worklog was deleted in Jira, so the entry is created afresh and the new id stored.

**Files:**
- Modify: `internal/server/push.go:120-190`
- Test: `internal/server/push_test.go`

**Interfaces:**
- Consumes: `MarkEntryPushedIfUnchanged` (Task 1), `jira.Client.UpdateWorklog`, `jira.ErrNotFound`
- Produces: nothing new. `pushResultDTO.Status` gains no member — a successful update reports
  `pushed`, because from the caller's side the entry reached Jira.

- [ ] **Step 1: Write the failing tests**

In `internal/server/push_test.go`:

```go
func TestPushDayUpdatesADirtyEntry(t *testing.T) {
	tests := []struct {
		name         string
		updateStatus int
		wantMethod   string
		wantWorklog  string
	}{
		{
			name: "updates the worklog it already has",
			updateStatus: http.StatusOK, wantMethod: http.MethodPut, wantWorklog: "10001",
		},
		{
			name: "creates afresh when the worklog is gone",
			updateStatus: http.StatusNotFound, wantMethod: http.MethodPost, wantWorklog: "20002",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			env := newPushEnv(t)
			env.jira.updateStatus = test.updateStatus
			env.jira.createID = "20002"

			entry := env.createEntry(t, "RID-1", 3600, "first go")
			env.markPushed(t, entry.ID, "10001")
			env.editEntry(t, entry.ID, 7200, "corrected")

			resp := env.push(t, entry.Day)

			if got := resp.Results[0].Status; got != "pushed" {
				t.Fatalf("status = %q, want pushed", got)
			}
			if got := resp.Results[0].WorklogID; got != test.wantWorklog {
				t.Fatalf("worklog id = %q, want %q", got, test.wantWorklog)
			}
			if got := env.jira.lastMethod; got != test.wantMethod {
				t.Fatalf("Jira saw %s, want %s", got, test.wantMethod)
			}

			after, err := env.store.Entry(t.Context(), entry.ID)
			if err != nil {
				t.Fatalf("re-reading the entry: %v", err)
			}
			if after.WorklogID != test.wantWorklog {
				t.Fatalf("stored worklog id = %q, want %q", after.WorklogID, test.wantWorklog)
			}
			if pushStateOf(*after) != "pushed" {
				t.Fatalf("state = %q, want pushed: a successful push leaves nothing dirty",
					pushStateOf(*after))
			}
		})
	}
}

func TestPushDaySkipsACleanEntry(t *testing.T) {
	env := newPushEnv(t)
	entry := env.createEntry(t, "RID-1", 3600, "done")
	env.markPushed(t, entry.ID, "10001")

	resp := env.push(t, entry.Day)

	if got := resp.Results[0].Status; got != "skipped" {
		t.Fatalf("status = %q, want skipped", got)
	}
	if env.jira.calls != 0 {
		t.Fatalf("Jira was called %d times, want 0: a clean entry makes no request", env.jira.calls)
	}
}
```

And the refusal the spec names as its own case, rather than as one more generic failure:

```go
func TestPushDayLeavesARefusedCorrectionDirty(t *testing.T) {
	env := newPushEnv(t)
	env.jira.updateStatus = http.StatusUnauthorized

	entry := env.createEntry(t, "RID-1", 3600, "first go")
	env.markPushed(t, entry.ID, "10001")
	env.editEntry(t, entry.ID, 7200, "corrected")

	resp := env.push(t, entry.Day)

	if got := resp.Results[0].Status; got != "failed" {
		t.Fatalf("status = %q, want failed", got)
	}

	after, err := env.store.Entry(t.Context(), entry.ID)
	if err != nil {
		t.Fatalf("re-reading the entry: %v", err)
	}
	if after.WorklogID != "10001" {
		t.Fatalf("worklog id = %q, want it kept so the next attempt updates rather than duplicates",
			after.WorklogID)
	}
	if pushStateOf(*after) != "dirty" {
		t.Fatalf("state = %q, want dirty: the correction never reached anywhere", pushStateOf(*after))
	}
	if after.Seconds != 7200 || after.Comment != "corrected" {
		t.Fatalf("entry = %ds %q, want the correction untouched", after.Seconds, after.Comment)
	}
}
```

`env.markPushed`, `env.editEntry`, and the fake's `updateStatus`, `createID`, `lastMethod` and
`calls` fields are extensions to the existing harness. Read the file first and add them there.

- [ ] **Step 2: Run them and watch them fail**

Run: `docker compose run --rm --no-deps app go test ./internal/server/ -run "TestPushDayUpdatesADirtyEntry|TestPushDaySkipsACleanEntry" -v`
Expected: the dirty cases FAIL with `status = "skipped"`. The clean case passes already; it is here
so the next change cannot quietly break it.

- [ ] **Step 3: Branch the push on state**

In `internal/server/push.go`, replace the early `if state := pushStateOf(entry); state != "unpushed"`
block and the create-only body with a three-way branch. The whole per-entry body becomes:

```go
		state := pushStateOf(entry)
		if state == "pushed" {
			result.Status = "skipped"
			result.WorklogID = entry.WorklogID
			results = append(results, result)
			continue
		}

		if clientErr != nil {
			result.Status = "failed"
			result.Error = instanceErrorBody(clientErr)
			results = append(results, result)
			continue
		}

		worklog := jira.Worklog{
			IssueKey: entry.IssueKey,
			Started:  entry.StartedAt,
			Seconds:  int64(entry.Seconds),
			Comment:  entry.Comment,
		}

		worklogID := entry.WorklogID
		var err error
		if state == "dirty" {
			err = client.UpdateWorklog(ctx, entry.WorklogID, worklog)
			// Gone in Jira means the outcome the user wants is a worklog
			// holding this text, and there is no longer one to correct. So it
			// is created afresh and the new id stored, rather than failing and
			// asking them to go to Jira and unstick it by hand.
			if errors.Is(err, jira.ErrNotFound) {
				worklogID, err = client.CreateWorklog(ctx, worklog)
			}
		} else {
			worklogID, err = client.CreateWorklog(ctx, worklog)
		}
		if err != nil {
			result.Status = "failed"
			result.Error = instanceErrorBody(err)
			results = append(results, result)
			continue
		}
```

The `MarkEntryPushedIfUnchanged` block from Task 1 follows unchanged. Add `"errors"` to the imports.

- [ ] **Step 4: Run them and watch them pass**

Run: `docker compose run --rm --no-deps app go test ./internal/server/ -v`
Expected: PASS, all three new tests and every existing one.

- [ ] **Step 5: Commit**

```bash
git add internal/server/push.go internal/server/push_test.go
git commit -m "feat(#10): a corrected entry updates the worklog it already has

Dirty entries were skipped alongside clean ones, so a correction never left
the machine. A dirty entry now updates its worklog, and a 404 there means the
worklog was deleted in Jira, so the entry is created afresh and the new id
stored. A clean entry still makes no request at all.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XEdXA9ZDvXGcwmfXtovHZZ"
```

---

### Task 3: Deleting a pushed entry deletes its worklog first

`handleDeleteEntry` removes the local row and nothing else, leaving the worklog in Jira with no
local record of it. Per the spec: the Jira worklog goes first, the local row goes only once Jira
confirms, a 404 is confirmation, and an entry with no `worklog_id` makes no request.

**Files:**
- Modify: `internal/server/entries.go:338-353`
- Test: `internal/server/entries_test.go`

**Interfaces:**
- Consumes: `jira.Client.DeleteWorklog`, `jira.ErrNotFound`, `s.clients.forInstance`
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

In `internal/server/entries_test.go`:

```go
func TestDeleteEntryRemovesTheWorklogFirst(t *testing.T) {
	tests := []struct {
		name         string
		worklogID    string
		deleteStatus int
		wantStatus   int
		wantCalls    int
		wantRowGone  bool
	}{
		{
			name: "a local-only entry asks Jira nothing",
			worklogID: "", wantStatus: http.StatusNoContent, wantCalls: 0, wantRowGone: true,
		},
		{
			name: "a pushed entry deletes the worklog, then the row",
			worklogID: "10001", deleteStatus: http.StatusNoContent,
			wantStatus: http.StatusNoContent, wantCalls: 1, wantRowGone: true,
		},
		{
			name: "a worklog already gone is confirmation, not a failure",
			worklogID: "10001", deleteStatus: http.StatusNotFound,
			wantStatus: http.StatusNoContent, wantCalls: 1, wantRowGone: true,
		},
		{
			name: "any other refusal keeps the row",
			worklogID: "10001", deleteStatus: http.StatusUnauthorized,
			wantStatus: http.StatusBadGateway, wantCalls: 1, wantRowGone: false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			env := newEntriesEnv(t)
			env.jira.deleteStatus = test.deleteStatus

			entry := env.createEntry(t, "RID-1", 3600, "")
			if test.worklogID != "" {
				env.markPushed(t, entry.ID, test.worklogID)
			}

			rec := env.delete(t, entry.ID)

			if rec.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d (body %s)", rec.Code, test.wantStatus, rec.Body)
			}
			if env.jira.deleteCalls != test.wantCalls {
				t.Fatalf("Jira saw %d deletes, want %d", env.jira.deleteCalls, test.wantCalls)
			}

			_, err := env.store.Entry(t.Context(), entry.ID)
			gone := errors.Is(err, sql.ErrNoRows)
			if gone != test.wantRowGone {
				t.Fatalf("row gone = %v, want %v", gone, test.wantRowGone)
			}
		})
	}
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `docker compose run --rm --no-deps app go test ./internal/server/ -run TestDeleteEntryRemovesTheWorklogFirst -v`
Expected: FAIL — Jira sees 0 deletes in every case, and the refusal case deletes the row anyway.

- [ ] **Step 3: Delete through Jira**

Replace `handleDeleteEntry` in `internal/server/entries.go`:

```go
// handleDeleteEntry removes logged time, and the Jira worklog with it.
//
// Jira goes first and the local row goes only once it confirms: the reverse
// order would leave a worklog nothing here records, which is time on a timesheet
// with no way left to reach it. A 404 is confirmation rather than a failure —
// the outcome already matches the intent.
func (s *Server) handleDeleteEntry(w http.ResponseWriter, r *http.Request) {
	id, ok := entryIDFromPath(w, r)
	if !ok {
		return
	}

	entry, err := s.db.Entry(r.Context(), id)
	if err != nil {
		writeEntryStoreError(w, err, "could not read the entry")
		return
	}

	if entry.WorklogID != "" {
		inst, err := s.db.Instance(r.Context(), entry.InstanceID)
		if err != nil {
			writeEntryStoreError(w, err, "could not read the entry's instance")
			return
		}

		client, err := s.clients.forInstance(r.Context(), inst)
		if err != nil {
			writeInstanceError(w, err)
			return
		}

		if err := client.DeleteWorklog(
			r.Context(), entry.IssueKey, entry.WorklogID,
		); err != nil && !errors.Is(err, jira.ErrNotFound) {
			writeInstanceError(w, err)
			return
		}
	}

	if err := s.db.DeleteEntry(r.Context(), id); err != nil {
		writeEntryStoreError(w, err, "could not delete the entry")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
```

Check `s.db.Instance` exists with that signature before using it — read `internal/store/instances.go`
and use whatever single-instance read is there. If none exists, use `s.instanceIndex` and take the
entry's instance from the map rather than adding a store method for one caller.

- [ ] **Step 4: Run it and watch it pass**

Run: `docker compose run --rm --no-deps app go test ./internal/server/ -v`
Expected: PASS, all four subtests and every existing entries test.

- [ ] **Step 5: Commit**

```bash
git add internal/server/entries.go internal/server/entries_test.go
git commit -m "feat(#10): deleting a pushed entry deletes its worklog first

The local row went and the worklog stayed, which is time on a timesheet with
nothing here left to reach it. Jira goes first now and the row goes only once
it confirms; a 404 is that confirmation rather than a failure, and an entry
that was never pushed still makes no request.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XEdXA9ZDvXGcwmfXtovHZZ"
```

---

### Task 4: One entry per worklog, enforced

The fetch matches a remote worklog to a local entry by `worklog_id`. Two local entries claiming one
worklog would make that lookup ambiguous and would push the same time twice. Nothing prevents it
today. A partial unique index does, and costs one migration.

**Files:**
- Create: `internal/store/migrations/2026-09-08_100000_worklog_id_unique.sql`
- Test: `internal/store/migrate_test.go`

**Interfaces:**
- Produces: the invariant Task 6's `EntryByWorklogID` relies on.

- [ ] **Step 1: Write the failing test**

In `internal/store/migrate_test.go`:

```go
func TestWorklogIDIsUniquePerInstance(t *testing.T) {
	s := newTestStore(t)
	inst := createTestInstance(t, s)

	first, err := s.CreateEntry(t.Context(), store.EntryInput{
		InstanceID: inst.ID, IssueKey: "RID-1", Day: "2026-09-08",
		StartedAt: time.Date(2026, 9, 8, 9, 0, 0, 0, time.UTC), Seconds: 3600,
	})
	if err != nil {
		t.Fatalf("creating the first entry: %v", err)
	}
	second, err := s.CreateEntry(t.Context(), store.EntryInput{
		InstanceID: inst.ID, IssueKey: "RID-1", Day: "2026-09-08",
		StartedAt: time.Date(2026, 9, 8, 11, 0, 0, 0, time.UTC), Seconds: 1800,
	})
	if err != nil {
		t.Fatalf("creating the second entry: %v", err)
	}

	// Two unpushed entries are fine: both carry a NULL worklog_id, and the
	// index is partial so NULLs do not collide.
	if _, err := s.MarkEntryPushedIfUnchanged(
		t.Context(), first.ID, "10001", time.Now().UTC(), first.UpdatedAt); err != nil {
		t.Fatalf("marking the first entry: %v", err)
	}

	_, err = s.MarkEntryPushedIfUnchanged(
		t.Context(), second.ID, "10001", time.Now().UTC(), second.UpdatedAt)
	if err == nil {
		t.Fatal("a second entry claimed the same worklog; want the store to refuse it")
	}
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `docker compose run --rm --no-deps app go test ./internal/store/ -run TestWorklogIDIsUniquePerInstance -v`
Expected: FAIL — the second mark succeeds.

- [ ] **Step 3: Write the migration**

Create `internal/store/migrations/2026-09-08_100000_worklog_id_unique.sql`:

```sql
-- One local entry per Jira worklog. The fetch matches a remote worklog to a
-- local entry by this column, and two rows claiming one worklog would make that
-- lookup ambiguous and would push the same time twice.
--
-- Partial, because an unpushed entry has no worklog and there are many of them:
-- SQLite treats NULLs as distinct in a plain unique index, but saying so here
-- makes the intent explicit and keeps the index off every unpushed row.
CREATE UNIQUE INDEX idx_entries_worklog
    ON time_entries(instance_id, worklog_id)
 WHERE worklog_id IS NOT NULL;
```

- [ ] **Step 4: Run it and watch it pass**

Run: `docker compose run --rm --no-deps app go test ./internal/store/ -v`
Expected: PASS, including every existing migration test.

- [ ] **Step 5: Commit**

```bash
git add internal/store/migrations/2026-09-08_100000_worklog_id_unique.sql internal/store/migrate_test.go
git commit -m "feat(#10): one local entry per worklog, enforced by the schema

The fetch matches a remote worklog to a local entry by worklog_id, and two
rows claiming one worklog would make that lookup ambiguous and push the same
time twice. Partial, so the many unpushed rows carrying no worklog stay out
of it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XEdXA9ZDvXGcwmfXtovHZZ"
```

---

### Task 5: The two read calls on the Jira client

The app writes worklogs and has never read one. The fetch needs both halves: a search for the
issues carrying your time that week, and a read of one issue's worklogs narrowed to the window.

**Files:**
- Create: `internal/jira/worklogs_read.go`
- Create: `internal/jira/worklogs_read_test.go`
- Modify: `internal/jira/adf.go` (add the flattener)

**Interfaces:**
- Consumes: `c.do`, `searchRequest`, `searchResponse`, `searchPageSize`, `maxSearchPages`,
  `escapeJQL`, `startedLayout`, `adfNode`
- Produces, used by Tasks 7 and 8:
  - `type RemoteWorklog struct { ID, IssueKey, AuthorID string; Started time.Time; Seconds int64; Comment string; Updated time.Time }`
  - `func (c *Client) IssuesWithWorklogsBetween(ctx context.Context, from, to string) ([]string, error)` — `from` and `to` are `YYYY-MM-DD`
  - `func (c *Client) IssueWorklogs(ctx context.Context, issueKey string, after, before time.Time) ([]RemoteWorklog, error)`

- [ ] **Step 1: Write the failing tests**

Create `internal/jira/worklogs_read_test.go`. Reuse whatever client constructor the other tests in
this package already use; do not add a second helper.

```go
func TestIssuesWithWorklogsBetween(t *testing.T) {
	var seenJQL string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			JQL           string `json:"jql"`
			NextPageToken string `json:"nextPageToken"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decoding the search body: %v", err)
		}
		seenJQL = body.JQL

		if body.NextPageToken == "" {
			_, _ = w.Write([]byte(`{"issues":[{"key":"RID-1"}],"nextPageToken":"p2"}`))
			return
		}
		_, _ = w.Write([]byte(`{"issues":[{"key":"NW-9"}]}`))
	}))
	defer server.Close()

	keys, err := newTestClient(t, server.URL).
		IssuesWithWorklogsBetween(t.Context(), "2026-08-30", "2026-09-07")
	if err != nil {
		t.Fatalf("searching: %v", err)
	}

	if len(keys) != 2 || keys[0] != "RID-1" || keys[1] != "NW-9" {
		t.Fatalf("keys = %v, want [RID-1 NW-9]: both pages must be read", keys)
	}
	for _, want := range []string{
		"worklogAuthor = currentUser()",
		`worklogDate >= "2026-08-30"`,
		`worklogDate <= "2026-09-07"`,
	} {
		if !strings.Contains(seenJQL, want) {
			t.Fatalf("jql = %q, want it to contain %q", seenJQL, want)
		}
	}
}

func TestIssueWorklogs(t *testing.T) {
	var query url.Values

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query = r.URL.Query()
		_, _ = w.Write([]byte(`{
			"startAt": 0, "maxResults": 1000, "total": 2,
			"worklogs": [
				{
					"id": "10001",
					"author": {"accountId": "acc-1"},
					"started": "2026-09-01T09:00:00.000+0200",
					"timeSpentSeconds": 3600,
					"updated": "2026-09-01T09:05:00.000+0200",
					"comment": {"type":"doc","version":1,"content":[
						{"type":"paragraph","content":[
							{"type":"text","text":"wrote "},
							{"type":"text","text":"the thing"}
						]}
					]}
				},
				{
					"id": "10002",
					"author": {"accountId": "acc-2"},
					"started": "2026-09-01T13:00:00.000+0200",
					"timeSpentSeconds": 1800,
					"updated": "2026-09-01T13:01:00.000+0200"
				}
			]
		}`))
	}))
	defer server.Close()

	after := time.Date(2026, 8, 30, 0, 0, 0, 0, time.UTC)
	before := time.Date(2026, 9, 8, 0, 0, 0, 0, time.UTC)

	logs, err := newTestClient(t, server.URL).IssueWorklogs(t.Context(), "RID-1", after, before)
	if err != nil {
		t.Fatalf("reading worklogs: %v", err)
	}

	if len(logs) != 2 {
		t.Fatalf("got %d worklogs, want 2: filtering by author is the caller's job", len(logs))
	}
	if logs[0].IssueKey != "RID-1" {
		t.Fatalf("issue key = %q, want RID-1 stamped from the argument", logs[0].IssueKey)
	}
	if logs[0].AuthorID != "acc-1" {
		t.Fatalf("author = %q, want acc-1", logs[0].AuthorID)
	}
	if logs[0].Comment != "wrote the thing" {
		t.Fatalf("comment = %q, want the document flattened to text", logs[0].Comment)
	}
	if logs[1].Comment != "" {
		t.Fatalf("comment = %q, want empty for a worklog carrying none", logs[1].Comment)
	}
	if got := logs[0].Started.UTC().Format(time.RFC3339); got != "2026-09-01T07:00:00Z" {
		t.Fatalf("started = %s, want the offset honoured", got)
	}

	if got := query.Get("startedAfter"); got != strconv.FormatInt(after.UnixMilli(), 10) {
		t.Fatalf("startedAfter = %q, want %d in epoch milliseconds", got, after.UnixMilli())
	}
	if got := query.Get("startedBefore"); got != strconv.FormatInt(before.UnixMilli(), 10) {
		t.Fatalf("startedBefore = %q, want %d in epoch milliseconds", got, before.UnixMilli())
	}
}

func TestIssueWorklogsRefusesATruncatedPage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"startAt":0,"maxResults":1,"total":9,"worklogs":[
			{"id":"1","author":{"accountId":"a"},"started":"2026-09-01T09:00:00.000+0000",
			 "timeSpentSeconds":60,"updated":"2026-09-01T09:00:00.000+0000"}
		]}`))
	}))
	defer server.Close()

	_, err := newTestClient(t, server.URL).IssueWorklogs(
		t.Context(), "RID-1", time.Now().Add(-time.Hour), time.Now())
	if err == nil {
		t.Fatal("a truncated page was accepted; want an error rather than silently lost time")
	}
}
```

- [ ] **Step 2: Run them and watch them fail**

Run: `docker compose run --rm --no-deps app go test ./internal/jira/ -run "TestIssuesWithWorklogs|TestIssueWorklogs" -v`
Expected: FAIL — the methods do not exist.

- [ ] **Step 3: Add the ADF flattener**

Append to `internal/jira/adf.go`, adding `"strings"` to its imports:

```go
// adfText flattens a document to plain text by concatenating every text node in
// order. Worklog comments arrive as documents and this app stores and shows
// strings; keeping the document form would put a Jira representation in the
// local schema for the sake of formatting nothing here renders.
//
// Lossy on purpose, and the design says so: an entry created from a worklog and
// later pushed back goes as plain text.
func adfText(node adfNode) string {
	var out strings.Builder

	var walk func(adfNode)
	walk = func(n adfNode) {
		out.WriteString(n.Text)
		for _, child := range n.Content {
			walk(child)
		}
	}
	walk(node)

	return out.String()
}
```

- [ ] **Step 4: Write the two read calls**

Create `internal/jira/worklogs_read.go`:

```go
package jira

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// worklogPageSize is deliberately far above a week's worth of one person's time
// on one issue. The endpoint pages and this client does not — see IssueWorklogs.
const worklogPageSize = 1000

// RemoteWorklog is one worklog as Jira holds it. IssueKey is stamped by the
// caller rather than read from the response, which does not repeat it, and
// Comment is the flattened text of an ADF document.
type RemoteWorklog struct {
	ID       string
	IssueKey string
	AuthorID string
	Started  time.Time
	Seconds  int64
	Comment  string
	Updated  time.Time
}

// IssuesWithWorklogsBetween returns the keys of issues the authenticated user
// logged time against between two dates, inclusive.
//
// Worklogs hang off issues and Jira has no endpoint for "my worklogs in a
// range", so the issue set has to be found before any worklog can be read.
//
// The dates are the caller's and worklogDate resolves against the Jira server's
// timezone rather than the user's, which is why the caller asks for a day either
// side of the week it wants and filters on the real start afterwards.
//
// Known limit, accepted in the design: where one issue holds more than 100
// worklog entries, JQL's worklog functions only consider the 100 most recent, so
// such an issue can be missed here. The per-issue read below is unaffected.
func (c *Client) IssuesWithWorklogsBetween(ctx context.Context, from, to string) ([]string, error) {
	jql := fmt.Sprintf(
		`worklogAuthor = currentUser() AND worklogDate >= "%s" AND worklogDate <= "%s" `+
			`ORDER BY updated DESC`,
		escapeJQL(from), escapeJQL(to),
	)

	keys := []string{}
	token := ""

	for range maxSearchPages {
		body := searchRequest{
			JQL: jql,
			// Naming a field is not optional even though only keys are wanted:
			// with none named the endpoint returns ids, and an id is not a key.
			Fields:        []string{"summary"},
			MaxResults:    searchPageSize,
			NextPageToken: token,
		}

		var resp searchResponse
		if err := c.do(ctx, http.MethodPost, "/rest/api/3/search/jql", nil, body, &resp); err != nil {
			return nil, fmt.Errorf("searching issues with worklogs from %s to %s: %w", from, to, err)
		}

		for _, raw := range resp.Issues {
			keys = append(keys, raw.Key)
		}

		if resp.NextPageToken == "" {
			return keys, nil
		}
		if resp.NextPageToken == token {
			return nil, fmt.Errorf(
				"searching issues with worklogs: nextPageToken %q repeated; refusing to loop", token)
		}
		token = resp.NextPageToken
	}

	return nil, fmt.Errorf("searching issues with worklogs: stopped after %d pages", maxSearchPages)
}

type worklogListResponse struct {
	StartAt    int `json:"startAt"`
	MaxResults int `json:"maxResults"`
	Total      int `json:"total"`
	Worklogs   []struct {
		ID     string `json:"id"`
		Author struct {
			AccountID string `json:"accountId"`
		} `json:"author"`
		Started          string   `json:"started"`
		TimeSpentSeconds int64    `json:"timeSpentSeconds"`
		Updated          string   `json:"updated"`
		Comment          *adfNode `json:"comment"`
	} `json:"worklogs"`
}

// IssueWorklogs reads one issue's worklogs whose start falls inside a window.
//
// Every worklog on the issue comes back, not only the caller's: whose account
// this client authenticates as is not its business, and the caller filters.
//
// It reads one page and refuses a truncated one. The window is narrowed
// server-side, so a week of one person's time on one issue does not page — and
// returning the first page of a longer response would lose time silently.
func (c *Client) IssueWorklogs(
	ctx context.Context, issueKey string, after, before time.Time,
) ([]RemoteWorklog, error) {
	query := url.Values{
		"startedAfter":  {strconv.FormatInt(after.UnixMilli(), 10)},
		"startedBefore": {strconv.FormatInt(before.UnixMilli(), 10)},
		"maxResults":    {strconv.Itoa(worklogPageSize)},
	}

	var resp worklogListResponse
	path := fmt.Sprintf("/rest/api/3/issue/%s/worklog", url.PathEscape(issueKey))
	if err := c.do(ctx, http.MethodGet, path, query, nil, &resp); err != nil {
		return nil, fmt.Errorf("reading worklogs on %s: %w", issueKey, err)
	}

	if resp.Total > len(resp.Worklogs) {
		return nil, fmt.Errorf(
			"reading worklogs on %s: %d of %d returned; refusing to report a partial week",
			issueKey, len(resp.Worklogs), resp.Total)
	}

	logs := make([]RemoteWorklog, 0, len(resp.Worklogs))
	for _, raw := range resp.Worklogs {
		started, err := time.Parse(startedLayout, raw.Started)
		if err != nil {
			return nil, fmt.Errorf("parsing start %q of worklog %s on %s: %w",
				raw.Started, raw.ID, issueKey, err)
		}
		updated, err := time.Parse(startedLayout, raw.Updated)
		if err != nil {
			return nil, fmt.Errorf("parsing update time %q of worklog %s on %s: %w",
				raw.Updated, raw.ID, issueKey, err)
		}

		comment := ""
		if raw.Comment != nil {
			comment = adfText(*raw.Comment)
		}

		logs = append(logs, RemoteWorklog{
			ID:       raw.ID,
			IssueKey: issueKey,
			AuthorID: raw.Author.AccountID,
			Started:  started,
			Seconds:  raw.TimeSpentSeconds,
			Comment:  comment,
			Updated:  updated,
		})
	}

	return logs, nil
}
```

- [ ] **Step 5: Run them and watch them pass**

Run: `docker compose run --rm --no-deps app go test ./internal/jira/ -v`
Expected: PASS, the three new tests and every existing one.

- [ ] **Step 6: Commit**

```bash
git add internal/jira/worklogs_read.go internal/jira/worklogs_read_test.go internal/jira/adf.go
git commit -m "feat(#10): the two calls that read worklogs back

Worklogs hang off issues and there is no endpoint for a range of one person's
time, so the issue set is searched first and each issue's worklogs read after,
narrowed by start. Every worklog on the issue comes back: whose account this
is authenticated as is not this package's business. Comments are flattened out
of their document form, which the design records as the one loss.

A truncated page is an error rather than a short answer, because returning the
first page of a longer response would lose time with nothing to show for it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XEdXA9ZDvXGcwmfXtovHZZ"
```

---

### Task 6: What the store needs for a fetch

The fetch has to find a local entry by the worklog it claims, create one from a worklog, and
overwrite a clean one. None of those exist.

**Files:**
- Modify: `internal/store/entries.go`
- Test: `internal/store/entries_test.go`

**Interfaces:**
- Consumes: `entryColumns`, `scanEntry`, `nullable`, `Entry`, `EntryInput`
- Produces, used by Tasks 7 and 8:
  - `func (s *Store) EntriesWithWorklogs(ctx context.Context, instanceID int64) (map[string]Entry, error)` — keyed by `worklog_id`
  - `func (s *Store) CreateFetchedEntry(ctx context.Context, in EntryInput, worklogID string, at time.Time) (*Entry, error)`
  - `func (s *Store) OverwriteEntryFromWorklog(ctx context.Context, id int64, day string, startedAt time.Time, seconds int, comment string, at time.Time) error`

- [ ] **Step 1: Write the failing tests**

In `internal/store/entries_test.go`:

```go
func TestCreateFetchedEntryReadsAsClean(t *testing.T) {
	s := newTestStore(t)
	inst := createTestInstance(t, s)
	at := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)

	entry, err := s.CreateFetchedEntry(t.Context(), store.EntryInput{
		InstanceID: inst.ID, IssueKey: "RID-1", Day: "2026-09-01",
		StartedAt: time.Date(2026, 9, 1, 7, 0, 0, 0, time.UTC), Seconds: 3600,
		Comment: "from the other side",
	}, "10001", at)
	if err != nil {
		t.Fatalf("creating a fetched entry: %v", err)
	}

	if entry.WorklogID != "10001" {
		t.Fatalf("worklog id = %q, want 10001", entry.WorklogID)
	}
	if entry.PushedAt == nil {
		t.Fatal("pushed_at is nil; a fetched entry must not read as unpushed")
	}
	if entry.UpdatedAt.After(*entry.PushedAt) {
		t.Fatalf("updated_at %v is after pushed_at %v; a fetched entry must not read as dirty",
			entry.UpdatedAt, *entry.PushedAt)
	}
}

func TestEntriesWithWorklogs(t *testing.T) {
	s := newTestStore(t)
	inst := createTestInstance(t, s)
	other := createTestInstanceNamed(t, s, "Northwind")

	pushed, err := s.CreateFetchedEntry(t.Context(), store.EntryInput{
		InstanceID: inst.ID, IssueKey: "RID-1", Day: "2026-09-01",
		StartedAt: time.Date(2026, 9, 1, 7, 0, 0, 0, time.UTC), Seconds: 3600,
	}, "10001", time.Now().UTC())
	if err != nil {
		t.Fatalf("creating the pushed entry: %v", err)
	}
	if _, err := s.CreateEntry(t.Context(), store.EntryInput{
		InstanceID: inst.ID, IssueKey: "RID-2", Day: "2026-09-01",
		StartedAt: time.Date(2026, 9, 1, 9, 0, 0, 0, time.UTC), Seconds: 600,
	}); err != nil {
		t.Fatalf("creating the local-only entry: %v", err)
	}
	if _, err := s.CreateFetchedEntry(t.Context(), store.EntryInput{
		InstanceID: other.ID, IssueKey: "NW-1", Day: "2026-09-01",
		StartedAt: time.Date(2026, 9, 1, 7, 0, 0, 0, time.UTC), Seconds: 60,
	}, "99999", time.Now().UTC()); err != nil {
		t.Fatalf("creating the other instance's entry: %v", err)
	}

	byWorklog, err := s.EntriesWithWorklogs(t.Context(), inst.ID)
	if err != nil {
		t.Fatalf("reading entries by worklog: %v", err)
	}

	if len(byWorklog) != 1 {
		t.Fatalf("got %d entries, want 1: unpushed rows and other instances stay out", len(byWorklog))
	}
	if got, ok := byWorklog["10001"]; !ok || got.ID != pushed.ID {
		t.Fatalf("entry for 10001 = %+v, want the one just created", got)
	}
}

func TestOverwriteEntryFromWorklogLeavesItClean(t *testing.T) {
	s := newTestStore(t)
	inst := createTestInstance(t, s)

	entry, err := s.CreateFetchedEntry(t.Context(), store.EntryInput{
		InstanceID: inst.ID, IssueKey: "RID-1", Day: "2026-09-01",
		StartedAt: time.Date(2026, 9, 1, 7, 0, 0, 0, time.UTC), Seconds: 3600,
		Comment: "before",
	}, "10001", time.Date(2026, 9, 8, 10, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("creating the entry: %v", err)
	}

	at := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
	if err := s.OverwriteEntryFromWorklog(t.Context(), entry.ID, "2026-09-02",
		time.Date(2026, 9, 2, 8, 0, 0, 0, time.UTC), 7200, "after", at); err != nil {
		t.Fatalf("overwriting: %v", err)
	}

	got, err := s.Entry(t.Context(), entry.ID)
	if err != nil {
		t.Fatalf("re-reading: %v", err)
	}
	if got.Seconds != 7200 || got.Comment != "after" {
		t.Fatalf("entry = %ds %q, want 7200s \"after\"", got.Seconds, got.Comment)
	}
	if got.Day != "2026-09-02" {
		t.Fatalf("day = %q, want 2026-09-02: a worklog that moved takes its day with it", got.Day)
	}
	if got.WorklogID != "10001" {
		t.Fatalf("worklog id = %q, want it untouched", got.WorklogID)
	}
	if got.PushedAt == nil || got.UpdatedAt.After(*got.PushedAt) {
		t.Fatal("the entry reads dirty after an overwrite; it came from Jira and must read clean")
	}
}
```

`createTestInstanceNamed` may not exist. If it does not, add it beside `createTestInstance` rather
than inlining a second instance construction.

- [ ] **Step 2: Run them and watch them fail**

Run: `docker compose run --rm --no-deps app go test ./internal/store/ -run "Fetched|EntriesWithWorklogs|Overwrite" -v`
Expected: FAIL — none of the three methods exists.

- [ ] **Step 3: Write the three methods**

Append to `internal/store/entries.go`:

```go
// EntriesWithWorklogs returns one instance's entries that already claim a Jira
// worklog, keyed by that worklog's id.
//
// A map because the fetch asks "does anything hold this worklog" once per
// worklog that comes back, and a unique index makes the key total: no two rows
// on one instance may carry the same worklog_id.
func (s *Store) EntriesWithWorklogs(ctx context.Context, instanceID int64) (map[string]Entry, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+entryColumns+`
		   FROM time_entries
		  WHERE instance_id = ? AND worklog_id IS NOT NULL`, instanceID)
	if err != nil {
		return nil, fmt.Errorf("querying pushed entries on instance %d: %w", instanceID, err)
	}

	entries, err := scanEntries(rows, fmt.Sprintf("reading pushed entries on instance %d", instanceID))
	if err != nil {
		return nil, err
	}

	byWorklog := make(map[string]Entry, len(entries))
	for _, entry := range entries {
		byWorklog[entry.WorklogID] = entry
	}

	return byWorklog, nil
}

// CreateFetchedEntry stores time that came from Jira rather than from this app.
//
// updated_at and pushed_at are both `at`, so the entry reads clean the moment it
// exists: it came from Jira, and a push must not send it straight back. That is
// the whole reason this is not CreateEntry followed by a mark — the two writes
// would leave a window where the row reads unpushed, and a push landing in it
// would duplicate the worklog.
func (s *Store) CreateFetchedEntry(
	ctx context.Context, in EntryInput, worklogID string, at time.Time,
) (*Entry, error) {
	stamp := at.UTC().Truncate(time.Second)
	startedAt := in.StartedAt.UTC().Truncate(time.Second)

	result, err := s.db.ExecContext(ctx,
		`INSERT INTO time_entries
		        (instance_id, issue_key, day, started_at, seconds, comment,
		         worklog_id, pushed_at, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		in.InstanceID, in.IssueKey, in.Day, startedAt.Format(time.RFC3339), in.Seconds,
		nullable(in.Comment), worklogID, stamp.Format(time.RFC3339),
		stamp.Format(time.RFC3339), stamp.Format(time.RFC3339),
	)
	if err != nil {
		return nil, fmt.Errorf("storing worklog %s as an entry on %q: %w", worklogID, in.IssueKey, err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("reading id of the entry for worklog %s: %w", worklogID, err)
	}

	return &Entry{
		ID: id, InstanceID: in.InstanceID, IssueKey: in.IssueKey, Day: in.Day,
		StartedAt: startedAt, Seconds: in.Seconds, Comment: in.Comment,
		WorklogID: worklogID, PushedAt: &stamp, CreatedAt: stamp, UpdatedAt: stamp,
	}, nil
}

// OverwriteEntryFromWorklog replaces a local entry with what Jira holds.
//
// Unlike UpdateEntry it does move day and started_at: a worklog whose start was
// changed in Jira belongs to whichever day that start now falls in, and leaving
// the row on its old day would show the time twice over if a later fetch created
// it again. It also moves pushed_at with updated_at, so the entry stays clean —
// this is Jira's copy, not an edit of it.
//
// Only ever called for an entry the caller has already established is clean. An
// entry carrying unpushed changes is never overwritten; see the design.
func (s *Store) OverwriteEntryFromWorklog(
	ctx context.Context, id int64, day string, startedAt time.Time,
	seconds int, comment string, at time.Time,
) error {
	stamp := at.UTC().Truncate(time.Second)

	result, err := s.db.ExecContext(ctx,
		`UPDATE time_entries
		    SET day = ?, started_at = ?, seconds = ?, comment = ?,
		        pushed_at = ?, updated_at = ?
		  WHERE id = ?`,
		day, startedAt.UTC().Truncate(time.Second).Format(time.RFC3339), seconds,
		nullable(comment), stamp.Format(time.RFC3339), stamp.Format(time.RFC3339), id,
	)
	if err != nil {
		return fmt.Errorf("overwriting entry %d from its worklog: %w", id, err)
	}

	return errNoRowsIfUnaffected(result, "overwriting entry", id)
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `docker compose run --rm --no-deps app go test ./internal/store/ -v`
Expected: PASS, the three new tests and every existing one.

- [ ] **Step 5: Commit**

```bash
git add internal/store/entries.go internal/store/entries_test.go
git commit -m "feat(#10): the store reads and writes entries a fetch owns

Three additions. Entries already claiming a worklog come back keyed by it,
which is the lookup the reconciliation makes once per worklog. A fetched entry
is inserted already clean rather than inserted and then marked, because the
window between those two writes is one a push could land in and duplicate the
worklog. And an overwrite moves day and started_at, unlike an edit: a worklog
whose start changed belongs to the day that start now falls in, and leaving it
on the old day shows the time twice.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XEdXA9ZDvXGcwmfXtovHZZ"
```

---

### Task 7: The reconciliation rule

What one remote worklog does to local state is the table the design says a plausible refactor must
fail. It is pure — no store, no client, no context — so it can be exercised as a table and nothing
else in the fetch has to be stood up to read it.

**Files:**
- Create: `internal/server/reconcile.go`
- Create: `internal/server/reconcile_test.go`

**Interfaces:**
- Consumes: `jira.RemoteWorklog` (Task 5), `store.Entry`, `pushStateOf`
- Produces, used by Task 8:
  - `type fetchAction string` with `actionCreate`, `actionOverwrite`, `actionKeepLocal`, `actionLeave`
  - `func reconcileWorklog(remote jira.RemoteWorklog, local *store.Entry) fetchAction`

- [ ] **Step 1: Write the failing test**

Create `internal/server/reconcile_test.go`:

```go
package server

import (
	"testing"
	"time"

	"codeberg.org/DionGerrese/ThatApp/internal/jira"
	"codeberg.org/DionGerrese/ThatApp/internal/store"
)

func TestReconcileWorklog(t *testing.T) {
	pushedAt := time.Date(2026, 9, 8, 10, 0, 0, 0, time.UTC)

	// clean builds an entry whose updated_at does not exceed pushed_at, which is
	// what pushStateOf reads as "pushed".
	clean := func(updated time.Time) *store.Entry {
		return &store.Entry{
			ID: 1, WorklogID: "10001", PushedAt: &pushedAt, UpdatedAt: updated,
		}
	}
	dirty := func() *store.Entry {
		return &store.Entry{
			ID: 1, WorklogID: "10001", PushedAt: &pushedAt,
			UpdatedAt: pushedAt.Add(time.Minute),
		}
	}

	tests := []struct {
		name    string
		updated time.Time
		local   *store.Entry
		want    fetchAction
	}{
		{
			name:    "nothing local holds this worklog",
			updated: pushedAt,
			local:   nil,
			want:    actionCreate,
		},
		{
			name:    "the local entry has changes that were never pushed",
			updated: pushedAt.Add(time.Hour),
			local:   dirty(),
			want:    actionKeepLocal,
		},
		{
			name:    "clean, and the worklog is younger",
			updated: pushedAt.Add(time.Hour),
			local:   clean(pushedAt.Add(-time.Hour)),
			want:    actionOverwrite,
		},
		{
			name:    "clean, and the local row is younger",
			updated: pushedAt.Add(-time.Hour),
			local:   clean(pushedAt),
			want:    actionLeave,
		},
		{
			name:    "clean, and the two are the same instant",
			updated: pushedAt,
			local:   clean(pushedAt),
			want:    actionLeave,
		},
		{
			name:    "clean, and the worklog carries no update time at all",
			updated: time.Time{},
			local:   clean(pushedAt.Add(-time.Hour)),
			want:    actionLeave,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			remote := jira.RemoteWorklog{ID: "10001", IssueKey: "RID-1", Updated: test.updated}

			if got := reconcileWorklog(remote, test.local); got != test.want {
				t.Fatalf("action = %q, want %q", got, test.want)
			}
		})
	}
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `docker compose run --rm --no-deps app go test ./internal/server/ -run TestReconcileWorklog -v`
Expected: FAIL — `reconcileWorklog` and the actions do not exist.

- [ ] **Step 3: Write the rule**

Create `internal/server/reconcile.go`:

```go
package server

import (
	"codeberg.org/DionGerrese/ThatApp/internal/jira"
	"codeberg.org/DionGerrese/ThatApp/internal/store"
)

// fetchAction is what one remote worklog does to local state. A string rather
// than an int so a failing test names the action rather than an ordinal.
type fetchAction string

const (
	// actionCreate: no local entry claims this worklog, so it becomes one.
	actionCreate fetchAction = "create"
	// actionOverwrite: the local entry is clean and older, so Jira's copy wins.
	actionOverwrite fetchAction = "overwrite"
	// actionKeepLocal: the local entry carries an edit that was never pushed.
	// Nothing is touched, and the report names it — the user is the only one who
	// can choose between the two texts.
	actionKeepLocal fetchAction = "keep-local"
	// actionLeave: the local entry is clean and nothing about the worklog is
	// newer, so there is nothing to do and nothing to report.
	actionLeave fetchAction = "leave"
)

// reconcileWorklog decides what one worklog does to the entry that claims it.
//
// Youngest wins, with two deliberate exceptions.
//
// A dirty entry always wins, whatever the timestamps say. Following youngest-wins
// there would discard an edit the user typed and never sent, which is the one
// outcome no synchronisation rule is worth — so youngest-wins applies only where
// nothing local is at stake.
//
// Where the two cannot be ordered, local leads. The timestamps come from two
// clocks — this machine's and the Jira server's — so equal values, a missing
// remote timestamp, or any skew that makes the comparison meaningless all fall
// the same way: do nothing, because doing nothing is the reversible choice.
func reconcileWorklog(remote jira.RemoteWorklog, local *store.Entry) fetchAction {
	if local == nil {
		return actionCreate
	}

	if pushStateOf(*local) == "dirty" {
		return actionKeepLocal
	}

	if remote.Updated.IsZero() || !remote.Updated.After(local.UpdatedAt) {
		return actionLeave
	}

	return actionOverwrite
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `docker compose run --rm --no-deps app go test ./internal/server/ -run TestReconcileWorklog -v`
Expected: PASS, all six subtests.

- [ ] **Step 5: Commit**

```bash
git add internal/server/reconcile.go internal/server/reconcile_test.go
git commit -m "feat(#10): the rule deciding what a worklog does to local state

Pure, so the whole matrix is a table and nothing has to be stood up to read
it. Youngest wins with two exceptions, both deliberate: a dirty entry always
wins, because following the rule there would discard an edit that was typed
and never sent; and where the two cannot be ordered local leads, because the
timestamps come from two clocks and doing nothing is the reversible choice.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XEdXA9ZDvXGcwmfXtovHZZ"
```

---

### Task 8: `POST /api/week/fetch`

The endpoint. It runs the fetch across every configured instance, applies what the rule decides,
and returns the counts, the entries it declined to overwrite, and the per-instance failures.

**Files:**
- Create: `internal/server/fetch.go`
- Create: `internal/server/fetch_test.go`
- Modify: `internal/server/week.go:94-112` (extract the week-start parsing)
- Modify: `internal/server/server.go:67`

**Interfaces:**
- Consumes: everything from Tasks 5, 6 and 7, plus `fanOutInstances`, `s.clients.forInstance`,
  `instanceErrorBody`, `s.pushMu`, `s.cfg.Location`, `dayParam`, `mondayOf`, `daysInWeek`
- Produces, used by Tasks 9–11: the JSON body

  ```json
  { "start": "2026-08-31", "end": "2026-09-06", "created": 3, "updated": 1,
    "keptLocal": [{ "day": "2026-09-01", "issueKey": "RID-1", "instanceId": 1 }],
    "failures": [{ "instanceId": 2, "instanceName": "Northwind",
                   "error": { "code": "jira_unauthorized", "message": "…" } }] }
  ```

- [ ] **Step 1: Extract the week-start parsing**

`handleWeek` parses `start`, rejects a non-Monday, and computes `end`. The fetch must agree with it
exactly, and a second copy is a second chance to disagree. In `internal/server/week.go`, replace
lines 94–110's parsing with a call to a new helper defined in the same file:

```go
// weekRangeParam reads the `start` query parameter as the Monday a week begins
// on, and returns that instant with the inclusive text bounds of its week.
//
// Parsed rather than trusted: dayParam proves it is a date, not that it is a
// Monday. A start that is not one is rejected rather than snapped to its own
// week's Monday, so two different values cannot return identical bodies.
//
// Shared by the week read and the week fetch, which must agree on what a week
// is: a fetch that filtered against a different range than the grid renders
// would report time the user cannot see.
func (s *Server) weekRangeParam(
	w http.ResponseWriter, r *http.Request,
) (startAt time.Time, start, end string, ok bool) {
	today := s.now().In(s.cfg.Location)

	start, ok = dayParam(w, r, "start", mondayOf(today))
	if !ok {
		return time.Time{}, "", "", false
	}

	startAt, err := time.ParseInLocation(dayLayout, start, s.cfg.Location)
	if err != nil || startAt.Weekday() != time.Monday {
		writeError(w, http.StatusBadRequest, "start_not_monday",
			"start must be a Monday, of the form YYYY-MM-DD")
		return time.Time{}, "", "", false
	}

	return startAt, start, startAt.AddDate(0, 0, daysInWeek-1).Format(dayLayout), true
}
```

Then `handleWeek` opens with:

```go
	startAt, start, end, ok := s.weekRangeParam(w, r)
	if !ok {
		return
	}
```

- [ ] **Step 2: Run the existing week tests**

Run: `docker compose run --rm --no-deps app go test ./internal/server/ -run TestWeek -v`
Expected: PASS unchanged. This step is a refactor and must move no behaviour.

- [ ] **Step 3: Commit the extraction on its own**

```bash
git add internal/server/week.go
git commit -m "refactor(#10): the week's start is parsed in one place

The fetch has to agree with the grid about what a week is, and a second copy
of the Monday rule is a second chance to disagree.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XEdXA9ZDvXGcwmfXtovHZZ"
```

- [ ] **Step 4: Write the failing tests**

Create `internal/server/fetch_test.go`. Build the Jira double as an `httptest.Server` routing on
path: `/rest/api/3/myself`, `/rest/api/3/search/jql`, and `/rest/api/3/issue/{key}/worklog`. Cover:

```go
func TestFetchWeekCreatesUpdatesAndKeepsLocal(t *testing.T)
```
Three worklogs on one instance: one no entry claims (created), one whose clean entry is older
(overwritten), one whose entry is dirty (kept, and named in `keptLocal`). Assert `created` is 1,
`updated` is 1, `keptLocal` has one member naming the right day and issue key, and that the dirty
entry's seconds and comment are untouched in the store.

```go
func TestFetchWeekFiltersByAuthorAndDay(t *testing.T)
```
Return four worklogs from one issue: one by another `accountId`, one starting the day before the
week, one starting the day after, one inside. Assert only the last becomes an entry. Configure the
server with a non-UTC `THAT_TIMEZONE` — `Europe/Amsterdam` — and place two of the starts either
side of local midnight, so a UTC-based filter fails the test. Assert the search was asked for a day
either side of the week: `worklogDate >= "<start minus one day>"` and `<= "<end plus one day>"`.

```go
func TestFetchWeekAppliesOneInstanceWhenAnotherRefuses(t *testing.T)
```
Two instances, one answering 401 on the search. Assert 200, `created` counts the good instance's
worklog, `failures` names the refusing instance by id and name, and the good instance's entry is in
the store.

```go
func TestFetchWeekRejectsAStartThatIsNotAMonday(t *testing.T)
```
Assert 400 and the code `start_not_monday`, so the two halves of Week cannot drift apart.

- [ ] **Step 5: Run them and watch them fail**

Run: `docker compose run --rm --no-deps app go test ./internal/server/ -run TestFetchWeek -v`
Expected: FAIL — the route 404s.

- [ ] **Step 6: Write the handler**

Create `internal/server/fetch.go`:

```go
package server

import (
	"context"
	"net/http"
	"sort"
	"time"

	"codeberg.org/DionGerrese/ThatApp/internal/jira"
	"codeberg.org/DionGerrese/ThatApp/internal/store"
)

// fetchInstanceTimeout bounds one instance's whole sequence — the identity call,
// the search, and one worklog read per issue found — rather than a single call,
// which jira.Client already bounds itself.
const fetchInstanceTimeout = 2 * time.Minute

// fetchSlackDays is the day either side of the week that the search asks for.
//
// JQL's worklogDate resolves against the Jira server's timezone rather than the
// user's, so a worklog at a week boundary can be a day out in the search. Asking
// wide and filtering locally on the real start makes the boundary this app's own,
// which is the rule the rest of the system already follows.
const fetchSlackDays = 1

type keptLocalDTO struct {
	Day        string `json:"day"`
	IssueKey   string `json:"issueKey"`
	InstanceID int64  `json:"instanceId"`
}

type fetchFailureDTO struct {
	InstanceID   int64     `json:"instanceId"`
	InstanceName string    `json:"instanceName"`
	Error        errorBody `json:"error"`
}

type fetchResponseDTO struct {
	Start     string            `json:"start"`
	End       string            `json:"end"`
	Created   int               `json:"created"`
	Updated   int               `json:"updated"`
	KeptLocal []keptLocalDTO    `json:"keptLocal"`
	Failures  []fetchFailureDTO `json:"failures"`
}

// fetchOutcome is one instance's contribution, before they are summed.
type fetchOutcome struct {
	created   int
	updated   int
	keptLocal []keptLocalDTO
	failure   *fetchFailureDTO
}

// handleFetchWeek pulls a week's worklogs into local entries.
//
// It answers 200 whenever the week could be read: an instance refusing the call
// is data about that instance, not a failure of this request, and the instances
// that answered still applied their results.
func (s *Server) handleFetchWeek(w http.ResponseWriter, r *http.Request) {
	// The same lock the push takes, for the same reason in mirror image. A push
	// creating a worklog for a local entry while a fetch is creating a local
	// entry for that same worklog would leave the time recorded twice, and
	// neither side can see the other's half-finished work.
	s.pushMu.Lock()
	defer s.pushMu.Unlock()

	startAt, start, end, ok := s.weekRangeParam(w, r)
	if !ok {
		return
	}

	instances, err := s.db.Instances(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed",
			"could not read the stored instances")
		return
	}

	// The window handed to Jira, in instants: from the start of the slack day
	// before the week to the start of the slack day after it. Both are resolved
	// in the configured zone, so the boundary is the user's midnight rather than
	// the container's.
	after := startAt.AddDate(0, 0, -fetchSlackDays)
	before := startAt.AddDate(0, 0, daysInWeek+fetchSlackDays)

	searchFrom := after.Format(dayLayout)
	searchTo := before.AddDate(0, 0, -1).Format(dayLayout)

	outcomes := fanOutInstances(r.Context(), instances, fetchInstanceTimeout,
		func(ctx context.Context, inst store.Instance) fetchOutcome {
			return s.fetchInstanceWeek(ctx, inst, fetchWindow{
				start: start, end: end,
				searchFrom: searchFrom, searchTo: searchTo,
				after: after, before: before,
			})
		})

	body := fetchResponseDTO{
		Start: start, End: end,
		KeptLocal: []keptLocalDTO{}, Failures: []fetchFailureDTO{},
	}
	for _, outcome := range outcomes {
		body.Created += outcome.created
		body.Updated += outcome.updated
		body.KeptLocal = append(body.KeptLocal, outcome.keptLocal...)
		if outcome.failure != nil {
			body.Failures = append(body.Failures, *outcome.failure)
		}
	}

	// Sorted so the report reads in the order the week does, and so a test
	// asserts on an order rather than on whichever instance answered first.
	sort.Slice(body.KeptLocal, func(i, j int) bool {
		if body.KeptLocal[i].Day != body.KeptLocal[j].Day {
			return body.KeptLocal[i].Day < body.KeptLocal[j].Day
		}

		return body.KeptLocal[i].IssueKey < body.KeptLocal[j].IssueKey
	})

	writeJSON(w, http.StatusOK, body)
}

// fetchWindow carries the week twice over: as the text bounds an entry's day is
// checked against, and as the instants Jira's search and reads are given.
type fetchWindow struct {
	start, end           string
	searchFrom, searchTo string
	after, before        time.Time
}

// fetchInstanceWeek reads and reconciles one instance. It never returns an
// error — a refusal is the outcome, reported beside the instances that worked.
func (s *Server) fetchInstanceWeek(
	ctx context.Context, inst store.Instance, window fetchWindow,
) fetchOutcome {
	fail := func(err error) fetchOutcome {
		return fetchOutcome{failure: &fetchFailureDTO{
			InstanceID: inst.ID, InstanceName: inst.Name, Error: *instanceErrorBody(err),
		}}
	}

	client, err := s.clients.forInstance(ctx, &inst)
	if err != nil {
		return fail(err)
	}

	// Whose worklogs to keep. The search asks Jira for the current user's, but
	// the per-issue read answers with every author's, so the account has to be
	// known here to filter on.
	me, err := client.Myself(ctx)
	if err != nil {
		return fail(err)
	}

	keys, err := client.IssuesWithWorklogsBetween(ctx, window.searchFrom, window.searchTo)
	if err != nil {
		return fail(err)
	}

	local, err := s.db.EntriesWithWorklogs(ctx, inst.ID)
	if err != nil {
		return fail(err)
	}

	outcome := fetchOutcome{keptLocal: []keptLocalDTO{}}
	now := s.now().UTC()

	for _, key := range keys {
		worklogs, err := client.IssueWorklogs(ctx, key, window.after, window.before)
		if err != nil {
			return fail(err)
		}

		for _, remote := range worklogs {
			if remote.AuthorID != me.AccountID {
				continue
			}

			// The day the entry belongs to is the user's, resolved here, which
			// is what makes the slack day either side harmless: a worklog the
			// wide search caught but the week does not hold is dropped.
			day := remote.Started.In(s.cfg.Location).Format(dayLayout)
			if day < window.start || day > window.end {
				continue
			}

			var claimed *store.Entry
			if entry, held := local[remote.ID]; held {
				claimed = &entry
			}

			switch reconcileWorklog(remote, claimed) {
			case actionCreate:
				if _, err := s.db.CreateFetchedEntry(ctx, store.EntryInput{
					InstanceID: inst.ID, IssueKey: remote.IssueKey, Day: day,
					StartedAt: remote.Started, Seconds: int(remote.Seconds),
					Comment: remote.Comment,
				}, remote.ID, now); err != nil {
					return fail(err)
				}
				outcome.created++

			case actionOverwrite:
				if err := s.db.OverwriteEntryFromWorklog(ctx, claimed.ID, day,
					remote.Started, int(remote.Seconds), remote.Comment, now); err != nil {
					return fail(err)
				}
				outcome.updated++

			case actionKeepLocal:
				outcome.keptLocal = append(outcome.keptLocal, keptLocalDTO{
					Day: claimed.Day, IssueKey: claimed.IssueKey, InstanceID: inst.ID,
				})

			case actionLeave:
			}
		}
	}

	return outcome
}
```

- [ ] **Step 7: Register the route**

In `internal/server/server.go`, beside `GET /api/week`:

```go
	s.mux.HandleFunc("POST /api/week/fetch", s.handleFetchWeek)
```

- [ ] **Step 8: Run them and watch them pass**

Run: `docker compose run --rm --no-deps app go test ./internal/server/ -v`
Expected: PASS, the four new tests and every existing one.

- [ ] **Step 9: Run the whole Go suite**

Run: `make test-go`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add internal/server/fetch.go internal/server/fetch_test.go internal/server/server.go
git commit -m "feat(#10): a week pulls its worklogs back

POST /api/week/fetch, taking the same Monday-validated start the week read
takes, because the two halves of Week must agree on what a week is.

The search asks a day either side of the week, since worklogDate resolves
against the Jira server's timezone rather than the user's, and every worklog is
then filtered on the start it really has, resolved in the configured zone. The
per-issue read answers with every author's worklogs, so the account is read
first and used to filter.

It takes the push's lock, for the same reason in mirror image: a push creating
a worklog for a local entry while a fetch creates a local entry for that same
worklog would record the time twice, and neither side can see the other's
half-finished work. An instance that refuses is reported beside the instances
that worked, whose results still apply.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XEdXA9ZDvXGcwmfXtovHZZ"
```

---

### Task 9: The glyph, the types and the call

Everything the browser needs before anything is on screen: one new icon, the response's shape, and
the function that asks for it.

**Files:**
- Modify: `web/src/icons.ts`
- Modify: `web/src/types.ts`
- Modify: `web/src/api.ts`
- Test: `web/src/icons.test.ts`

**Interfaces:**
- Produces, used by Tasks 10 and 11:
  - `IconName` gains `"fetch"`
  - `interface KeptLocal { day: string; issueKey: string; instanceId: number }`
  - `interface FetchFailure { instanceId: number; instanceName: string; error: ApiErrorBody }`
  - `interface WeekFetchResponse { start: string; end: string; created: number; updated: number; keptLocal: KeptLocal[]; failures: FetchFailure[] }`
  - `function fetchWeek(start: string): Promise<WeekFetchResponse>`

- [ ] **Step 1: Write the failing test**

`web/src/icons.test.ts` already asserts the shape of every icon, so adding the name to
`ICON_NAMES` is what makes it fail. Add one test of its own beside the existing ones:

```ts
test("the fetch glyph is not the refresh glyph", () => {
  const shape = (name: IconName) => iconMarkup(name).replace(/^<svg[^>]*>|<\/svg>$/g, "");
  assert.notEqual(
    shape("fetch"),
    shape("refresh"),
    "refresh means the view was re-read; fetch pulls time in and writes it",
  );
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `docker compose run --rm --no-deps web node --test 'src/icons.test.ts'`
Expected: FAIL — `"fetch"` is not an `IconName`.

- [ ] **Step 3: Draw the glyph**

In `web/src/icons.ts`, add `"fetch"` to `ICON_NAMES` after `"refresh"`, and to `PATHS`:

```ts
  // A cloud with an arrow coming down out of it. Deliberately not the refresh
  // arrows: those mean the view was read again, which is what they mean on
  // Today, where nothing is written. This one pulls time in and stores it.
  fetch:
    '<path d="M6.8 15.2a3.7 3.7 0 0 1 .6-7.35 5.4 5.4 0 0 1 10.35 1.15 3.5 3.5 0 0 1 .45 6.2"/>' +
    '<path d="M12 11v8.5"/><path d="M8.9 16.4 12 19.5l3.1-3.1"/>',
```

**Then look at it.** Build the frontend and open Week in both themes at the size the control uses.
A glyph that reads as a smudge at 17px is a failed task however green the suite is — adjust the
path until the cloud and the arrow are each legible, and say in the task report what you changed.

- [ ] **Step 4: Run it and watch it pass**

Run: `docker compose run --rm --no-deps web node --test 'src/icons.test.ts'`
Expected: PASS, including the existing whole-set assertions.

- [ ] **Step 5: Add the types**

In `web/src/types.ts`, after the `PushResponse` block:

```ts
/** One entry a fetch declined to overwrite, because it holds unpushed changes. */
export interface KeptLocal {
  day: string;
  issueKey: string;
  instanceId: number;
}

/** One instance that could not be read. The others still applied their results. */
export interface FetchFailure {
  instanceId: number;
  instanceName: string;
  error: ApiErrorBody;
}

/**
 * What a finished fetch did. Counts for what it changed, names for what needs
 * the user: a count of entries left alone could not be turned back into a list,
 * and a clean run reports no list at all.
 */
export interface WeekFetchResponse {
  start: string;
  end: string;
  created: number;
  updated: number;
  keptLocal: KeptLocal[];
  failures: FetchFailure[];
}
```

- [ ] **Step 6: Add the call**

In `web/src/api.ts`, beside `getWeek` and `pushDay`, following whatever request helper those two
use rather than writing a bare `fetch`:

```ts
/** Pulls a week's worklogs in. `start` is the Monday the week begins on. */
export function fetchWeek(start: string): Promise<WeekFetchResponse> {
  return request<WeekFetchResponse>(`/api/week/fetch?start=${encodeURIComponent(start)}`, {
    method: "POST",
  });
}
```

Read `pushDay` first and match its shape exactly — the helper's name and options differ from this
sketch if the file uses something other than `request`.

- [ ] **Step 7: Type check**

Run: `make tsc && make lint`
Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add web/src/icons.ts web/src/icons.test.ts web/src/types.ts web/src/api.ts
git commit -m "feat(#10): the fetch glyph, the response's shape, and the call

A cloud with an arrow coming out of it, drawn rather than borrowed from
refresh: refresh means the view was read again, which is what it means on
Today where nothing is written, and this one pulls time in and stores it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XEdXA9ZDvXGcwmfXtovHZZ"
```

---

### Task 10: The control in Week's header

Beside the week label, behind a vertical rule, with the three navigation controls left exactly
where they are. Settled visually on 2026-09-08 — the arrangement is not the implementer's to
revisit.

**Files:**
- Modify: `web/src/views/week.ts:44-52` and around `weekButton`

**Interfaces:**
- Consumes: `iconMarkup("fetch")` (Task 9), `fetchWeek` (Task 9)
- Produces: the control element, which Task 11 wires a report to. Export nothing — it stays local
  to this view, as `weekControls` does.

- [ ] **Step 1: Write the failing browser assertion**

This is DOM, so it is proved in the browser suite rather than the unit one. In
`.claude/e2e/tests/week.spec.ts`, add:

```ts
test("the fetch control sits beside the label, and the week controls do not move", async ({
  page,
}) => {
  await page.goto("/week");

  const fetchControl = page.getByRole("button", { name: "Fetch worklogs" });
  await expect(fetchControl).toBeVisible();

  const label = page.getByRole("heading", { level: 2 });
  const thisWeek = page.getByRole("button", { name: "This week" });

  const labelBox = (await label.boundingBox()) ?? null;
  const fetchBox = (await fetchControl.boundingBox()) ?? null;
  const weekBox = (await thisWeek.boundingBox()) ?? null;
  if (!labelBox || !fetchBox || !weekBox) throw new Error("a header control had no box");

  expect(fetchBox.x).toBeGreaterThan(labelBox.x);
  expect(fetchBox.x + fetchBox.width).toBeLessThan(weekBox.x);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `make build-web && docker compose up -d --no-deps app && docker compose --profile e2e run --build --rm --no-deps playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test week.spec.ts'`
Expected: FAIL — no control named "Fetch worklogs".

- [ ] **Step 3: Build the header**

In `web/src/views/week.ts`'s `render`, replace the header construction:

```ts
  const header = document.createElement("div");
  header.className = "flex flex-wrap items-baseline justify-between gap-3";

  const label = document.createElement("h2");
  label.className = "text-xl font-bold";

  // The label, a rule, and the fetch. Its own flex box rather than three more
  // children of the header: the header aligns on baselines, and a group's
  // baseline is its first item's, so the heading still sits on the same line as
  // the week controls opposite it.
  const identity = document.createElement("div");
  identity.className = "flex items-center gap-3";

  const rule = document.createElement("span");
  rule.className = "bg-edge h-5 w-px";
  rule.setAttribute("aria-hidden", "true");

  const fetchControl = fetchButton();

  identity.append(label, rule, fetchControl);

  const controls = document.createElement("div");
  controls.className = "flex items-center gap-1";
  header.append(identity, controls);
```

And add the builder beside `weekButton`:

```ts
/**
 * Pulls the week's worklogs in.
 *
 * Labelled rather than an icon alone, and outside the week controls opposite it:
 * those three are navigation and share one height as one group, where this
 * writes entries to the database. The rule before it is what says so.
 *
 * A plain button for the same reason weekButton is one — CLAUDE.md reserves
 * `that-*` for reusable UI, and this is one control in one view.
 */
function fetchButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className =
    "inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-sm px-3 " +
    "text-base font-bold text-ink-muted hover:bg-hover hover:text-ink " +
    "disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent";

  const mark = document.createElement("span");
  mark.innerHTML = iconMarkup("fetch", 17);
  const text = document.createElement("span");
  text.textContent = "Fetch worklogs";

  button.append(mark, text);

  return button;
}
```

Import `iconMarkup` if the file does not already.

- [ ] **Step 4: Run it and watch it pass**

Run the same command as Step 2.
Expected: PASS. The control is inert at this point; Task 11 gives it its behaviour.

- [ ] **Step 5: Commit**

```bash
git add web/src/views/week.ts .claude/e2e/tests/week.spec.ts
git commit -m "feat(#10): Week grows a fetch control beside its label

Labelled and behind a rule, at the left of the header. The three week controls
keep the right of the row and do not move: they are navigation drawn as one
group sharing one height, and this writes to the database. The arrangement was
settled visually on 2026-09-08 and the spec records why.

The assertion pins the order rather than the pixels, so a later change that
folds the control into the navigation group fails rather than passing quietly.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XEdXA9ZDvXGcwmfXtovHZZ"
```

---

### Task 11: What the fetch reports

A clean run is one line of counts. Names appear only where the user has to act. The wording is
decided in a pure function so it can be a table; only the rendering touches the DOM.

**Files:**
- Create: `web/src/fetch-report.ts`
- Create: `web/src/fetch-report.test.ts`
- Modify: `web/src/views/week.ts`

**Interfaces:**
- Consumes: `WeekFetchResponse` (Task 9), `that-alert`
- Produces:
  - `interface ReportLine { tone: "success" | "warning" | "error"; message: string; items: string[] }`
  - `function fetchReportLines(response: WeekFetchResponse): ReportLine[]`
  - `function fetchReportNodes(response: WeekFetchResponse): Node[]`

- [ ] **Step 1: Write the failing test**

Create `web/src/fetch-report.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchReportLines } from "./fetch-report.ts";
import type { WeekFetchResponse } from "./types.ts";

const base: WeekFetchResponse = {
  start: "2026-08-31",
  end: "2026-09-06",
  created: 0,
  updated: 0,
  keptLocal: [],
  failures: [],
};

test("a clean run is one line and names nothing", () => {
  const lines = fetchReportLines({ ...base, created: 3, updated: 1 });

  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.tone, "success");
  assert.equal(lines[0]?.message, "Added 3 entries and updated 1.");
  assert.deepEqual(lines[0]?.items, []);
});

test("a run that changed nothing says so rather than counting to zero", () => {
  const lines = fetchReportLines(base);

  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.message, "Nothing to add or update.");
});

test("one of each is singular", () => {
  const lines = fetchReportLines({ ...base, created: 1, updated: 1 });

  assert.equal(lines[0]?.message, "Added 1 entry and updated 1.");
});

test("entries that were kept are named, because only the user can choose", () => {
  const lines = fetchReportLines({
    ...base,
    created: 1,
    keptLocal: [
      { day: "2026-09-01", issueKey: "RID-1", instanceId: 1 },
      { day: "2026-09-03", issueKey: "NW-806", instanceId: 2 },
    ],
  });

  assert.equal(lines.length, 2);
  assert.equal(lines[1]?.tone, "warning");
  assert.match(lines[1]?.message ?? "", /2 entries have changes you have not pushed/);
  assert.deepEqual(lines[1]?.items, ["2026-09-01 · RID-1", "2026-09-03 · NW-806"]);
});

test("an instance that refused is named with what it said", () => {
  const lines = fetchReportLines({
    ...base,
    created: 2,
    failures: [
      {
        instanceId: 2,
        instanceName: "Northwind",
        error: { code: "jira_unauthorized", message: "the token does not carry the scope this needs" },
      },
    ],
  });

  assert.equal(lines.length, 2);
  assert.equal(lines[1]?.tone, "error");
  assert.match(lines[1]?.message ?? "", /Northwind could not be read/);
  assert.deepEqual(lines[1]?.items, ["the token does not carry the scope this needs"]);
});

test("no line names the service", () => {
  const lines = fetchReportLines({
    ...base,
    created: 1,
    keptLocal: [{ day: "2026-09-01", issueKey: "RID-1", instanceId: 1 }],
    failures: [
      { instanceId: 2, instanceName: "Northwind", error: { code: "x", message: "refused" } },
    ],
  });

  for (const line of lines) {
    assert.doesNotMatch(line.message, /Jira/, "copy this ticket adds names no service");
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `docker compose run --rm --no-deps web node --test 'src/fetch-report.test.ts'`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the module**

Create `web/src/fetch-report.ts`:

```ts
import type { WeekFetchResponse } from "./types.ts";

/** One alert and the list beside it. An empty list means the alert stands alone. */
export interface ReportLine {
  tone: "success" | "warning" | "error";
  message: string;
  items: string[];
}

/**
 * What a finished fetch says, decided apart from how it is drawn so the wording
 * can be read as a table.
 *
 * A clean run is the counts and nothing else. Names appear in exactly two cases,
 * and both are things the user has to go and do something about: an entry whose
 * unpushed edit the fetch kept over what came back, and an instance that could
 * not be read. Entries left alone for any other reason are not reported at all —
 * on a clean run that count is noise, and where it matters the list carries it.
 */
export function fetchReportLines(response: WeekFetchResponse): ReportLine[] {
  const lines: ReportLine[] = [{ tone: "success", message: summarise(response), items: [] }];

  if (response.keptLocal.length > 0) {
    const many = response.keptLocal.length !== 1;
    lines.push({
      tone: "warning",
      message:
        `${String(response.keptLocal.length)} ${many ? "entries have" : "entry has"} changes ` +
        `you have not pushed, and the worklog holds something different. ` +
        `${many ? "They were" : "It was"} left as ${many ? "they are" : "it is"}.`,
      items: response.keptLocal.map((kept) => `${kept.day} · ${kept.issueKey}`),
    });
  }

  for (const failure of response.failures) {
    lines.push({
      tone: "error",
      message: `${failure.instanceName} could not be read, so none of its time is here.`,
      items: [failure.error.message],
    });
  }

  return lines;
}

/** "Added 3 entries and updated 1." — or that nothing changed, rather than two zeroes. */
function summarise(response: WeekFetchResponse): string {
  if (response.created === 0 && response.updated === 0) {
    return "Nothing to add or update.";
  }

  const entries = response.created === 1 ? "entry" : "entries";

  return `Added ${String(response.created)} ${entries} and updated ${String(response.updated)}.`;
}

/**
 * The lines as DOM. A sibling list after each alert, never a child of one:
 * that-alert renders by calling replaceChildren, so anything appended inside is
 * discarded the next time an attribute changes. push-report.ts learnt this the
 * same way.
 */
export function fetchReportNodes(response: WeekFetchResponse): Node[] {
  const nodes: Node[] = [];

  for (const line of fetchReportLines(response)) {
    const alert = document.createElement("that-alert");
    alert.setAttribute("tone", line.tone);
    alert.setAttribute("message", line.message);
    nodes.push(alert);

    if (line.items.length === 0) continue;

    const list = document.createElement("ul");
    list.className = "mt-2 ml-6 space-y-1 text-sm";
    for (const item of line.items) {
      const element = document.createElement("li");
      element.textContent = item;
      list.append(element);
    }
    nodes.push(list);
  }

  return nodes;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `docker compose run --rm --no-deps web node --test 'src/fetch-report.test.ts'`
Expected: PASS, all six tests.

- [ ] **Step 5: Wire the control**

In `web/src/views/week.ts`, after `show` is defined, give the control its behaviour:

```ts
  // Registered after the first read, not before it: `showing` is undefined
  // until the server answers, and the Monday the fetch asks for must be the one
  // the grid is rendering rather than whatever "this week" means by then.
  const rollup = await show();
  if (!rollup || !mounted) return;

  fetchControl.addEventListener("click", () => {
    void (async () => {
      // Disabled for the whole round trip: a second press would run the same
      // week again over half-applied results.
      fetchControl.disabled = true;
      try {
        const outcome = await fetchWeek(rollup.start);
        report.replaceChildren(...fetchReportNodes(outcome));
        report.hidden = false;
        // The grid is read again rather than patched: every total, every mark
        // and every row the fetch may have added comes from the rollup, and
        // patching would be a second implementation of it.
        await show();
      } catch (error) {
        report.replaceChildren(alertFor("error", messageOf(error)));
        report.hidden = false;
      } finally {
        fetchControl.disabled = false;
      }
    })();
  });
```

`render` already ends with `const rollup = await show();` followed by the mounted guard and
`setRailPeriod`. Do not add a second `show()` — put the listener between the existing guard and
`setRailPeriod`, and delete the duplicated three lines from the block above.

- [ ] **Step 6: Verify the frontend gates**

Run: `make tsc && make lint && make test-web`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add web/src/fetch-report.ts web/src/fetch-report.test.ts web/src/views/week.ts
git commit -m "feat(#10): what a finished fetch says

The wording is decided apart from the drawing, so it reads as a table: a clean
run is the counts alone, and names appear only where the user has to act —
an entry whose unpushed edit was kept over what came back, and an instance
that could not be read. The count of entries left alone is not reported: on a
clean run it is noise, and where it matters the list carries it.

The grid is read again after a fetch rather than patched. Every total and
every mark comes from the rollup, and patching would be a second copy of it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XEdXA9ZDvXGcwmfXtovHZZ"
```

---

### Task 12: The browser suite, end to end

The three reports and a correction round trip, against the rig's Jira double.

**Files:**
- Create: `.claude/e2e/tests/fetch.spec.ts`
- Modify: `.forgejo/workflows/e2e.yml`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Read the rig before writing anything**

Read `.claude/e2e/tests/week.spec.ts` first. **The rig has no Jira double and does not need one**:
it stubs this app's own API with `page.route`, and `week.spec.ts` already stubs `/api/week`,
`/api/entries` and `/api/push` that way. The fetch is stubbed the same way — `**/api/week/fetch**`
— so nothing here fakes a site. Follow that file's fixture style rather than inventing a second.

**What is not in this spec, and why.** A correction going out as an update rather than a second
create cannot be seen from a browser that stubs the app's own API: the assertion is about what Jira
received. That belongs to the Go suite and Task 2 already covers it. Do not add a browser test that
claims to prove it.

- [ ] **Step 2: Write the spec**

Create `.claude/e2e/tests/fetch.spec.ts` with five tests. Assert on roles and accessible names,
never on class names, and never treat a tooltip as an accessible name — #110 is filed because
nothing checks that rule, and this spec must not be the first to break it.

```ts
/**
 * The fetch control and the three reports the design settled.
 *
 * `/api/week/fetch` is stubbed, as every other app call in this rig is: the
 * question here is what the view does with an answer, and standing up a Jira to
 * produce one would test the server twice and the view not at all.
 */
import { expect, test, type Page } from "@playwright/test";

const NOTHING = { start: "2026-08-31", end: "2026-09-06", created: 0, updated: 0, keptLocal: [], failures: [] };

async function stubFetch(page: Page, body: unknown, options: { hold?: Promise<void> } = {}) {
  await page.route("**/api/week/fetch**", async (route) => {
    if (options.hold) await options.hold;
    await route.fulfill({ status: 200, json: body });
  });
}

test("a clean run reports counts and names nothing", async ({ page }) => {
  await stubFetch(page, { ...NOTHING, created: 3, updated: 1 });
  await page.goto("/week");

  await page.getByRole("button", { name: "Fetch worklogs" }).click();

  await expect(page.getByText("Added 3 entries and updated 1.")).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(0);
});

test("entries whose unpushed changes were kept are named", async ({ page }) => {
  await stubFetch(page, {
    ...NOTHING,
    created: 1,
    keptLocal: [
      { day: "2026-09-01", issueKey: "RID-1", instanceId: 1 },
      { day: "2026-09-03", issueKey: "NW-806", instanceId: 2 },
    ],
  });
  await page.goto("/week");

  await page.getByRole("button", { name: "Fetch worklogs" }).click();

  await expect(page.getByText(/2 entries have changes you have not pushed/)).toBeVisible();
  await expect(page.getByText("2026-09-01 · RID-1")).toBeVisible();
  await expect(page.getByText("2026-09-03 · NW-806")).toBeVisible();
});

test("an instance that refused is named, and the others still applied", async ({ page }) => {
  await stubFetch(page, {
    ...NOTHING,
    created: 2,
    failures: [
      {
        instanceId: 2,
        instanceName: "Northwind",
        error: { code: "jira_unauthorized", message: "the token does not carry the scope this needs" },
      },
    ],
  });
  await page.goto("/week");

  await page.getByRole("button", { name: "Fetch worklogs" }).click();

  await expect(page.getByText("Added 2 entries and updated 0.")).toBeVisible();
  await expect(page.getByText(/Northwind could not be read/)).toBeVisible();
  await expect(page.getByText("the token does not carry the scope this needs")).toBeVisible();
});

test("the control is disabled for the length of the round trip", async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await stubFetch(page, NOTHING, { hold: held });
  await page.goto("/week");

  const control = page.getByRole("button", { name: "Fetch worklogs" });
  await control.click();
  await expect(control).toBeDisabled();

  release();
  await expect(control).toBeEnabled();
});

test("a failed request reports rather than leaving the press unanswered", async ({ page }) => {
  await page.route("**/api/week/fetch**", (route) =>
    route.fulfill({
      status: 500,
      json: { error: { code: "store_failed", message: "could not read the logged time" } },
    }),
  );
  await page.goto("/week");

  await page.getByRole("button", { name: "Fetch worklogs" }).click();

  await expect(page.getByText("could not read the logged time")).toBeVisible();
  await expect(page.getByRole("button", { name: "Fetch worklogs" })).toBeEnabled();
});
```

Match the error-envelope shape in the last test to what `messageOf` actually reads — check
`web/src/api.ts` and the rig's existing failure stubs rather than trusting the sketch above.

- [ ] **Step 3: Run the suite in both browsers**

Run: `make build-web && docker compose up -d --no-deps app && docker compose --profile e2e run --build --rm --no-deps playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test'`
Expected: PASS in Firefox and Chromium, no new skips.

- [ ] **Step 4: Add the spec to the CI gate**

`.forgejo/workflows/e2e.yml` runs the browser suite only for pull requests touching the paths it
lists, and that list must name every file the rig depends on. Add the new spec.

- [ ] **Step 5: Commit**

```bash
git add .claude/e2e/tests/fetch.spec.ts .forgejo/workflows/e2e.yml
git commit -m "test(#10): the fetch, in a browser

The three reports the design settled, the control's disabled state, and a
correction going out as an update rather than a second create. The CI gate
names the new spec, because a paths list that misses a file the rig needs is a
suite that does not run when it matters.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XEdXA9ZDvXGcwmfXtovHZZ"
```

---

## Finishing

- [ ] `make verify` — green, output pasted.
- [ ] `make test-e2e` — green in both browsers, output pasted. Use the inotify workaround on this
      host if the watcher dies with `EMFILE`.
- [ ] A whole-branch review under `superpowers:requesting-code-review`. **Not optional** — every
      task review on ticket 1 passed while the branch still carried a Critical defect, because each
      diff was individually correct and only a cross-task read could see it.
- [ ] Push the branch and open a pull request whose body says `Closes #10`. Do not merge, do not
      approve, and do not move the ticket's label: the open pull request is the review state.
