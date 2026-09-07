# Edit after push, and a week's fetch — design

**Date:** 2026-09-07
**Supersedes:** nothing. It extends ticket 10 of the sequence in
[`2026-08-04-thatapp-design.md`](2026-08-04-thatapp-design.md), which stays the design of record for
everything this document does not touch.
**Superseded by:** nothing

This is the design for #10. The ticket was written as corrections after a push; the owner widened it
on 2026-09-07 to carry a week's fetch as well, and #113 was closed and folded in rather than
declined. The two belong together: they are the same round trip, they turn on the same derived
state, and they meet on the same column.

## Why one ticket

The app writes worklogs and never reads them. Every worklog it knows about is one it created, so
anything logged in Jira's own interface, or by another tool, or by this app before a database was
lost, is invisible here. Meanwhile an entry already pushed cannot be corrected without leaving for
Jira.

Both halves are `worklog_id`. Corrections use it to address an existing worklog; the fetch uses it
to recognise one. Splitting them would mean writing the same reconciliation twice.

## Half one: corrections after a push

Unchanged from the ticket, and from the state table in the design of record. Push state stays
**derived**, never stored.

| State | Condition | Push does |
| --- | --- | --- |
| Unpushed | `worklog_id IS NULL` | creates the worklog, stores the id, sets `pushed_at` |
| Pushed, clean | `worklog_id NOT NULL AND updated_at <= pushed_at` | nothing at all, no request |
| Pushed, dirty | `worklog_id NOT NULL AND updated_at > pushed_at` | updates that worklog, sets `pushed_at` |

**Deleting** an entry that carries a `worklog_id` deletes the Jira worklog first and removes the
local row only once Jira confirms. Any other failure leaves the row and reports. An entry with no
`worklog_id` is purely local and makes no request.

**A worklog Jira no longer has** answers 404, which the client already maps to a sentinel error. On
a delete that is confirmation, because the outcome already matches the intent, so the local row
goes. On an update it means the worklog was deleted in Jira, so the entry is created afresh and the
new id stored. Neither case needs a trip to Jira's interface to unstick, and a repeat push stays
idempotent.

**The lost update closes here.** #9 serialises pushes against each other but not against an edit
arriving mid-push, so an edit landing between the read and the mark is silently lost. Marking an
entry pushed becomes conditional on the `updated_at` the push read before it called Jira. If an edit
landed in between, no row is affected, the entry stays dirty, and the next push sends the newer
text. The worklog is still created, so nothing is duplicated in Jira.

## Half two: a week's fetch

A control in Week reads that week's worklogs from Jira and reconciles them against local entries.

### Finding the worklogs

Jira has no endpoint for "my worklogs in a date range", and worklogs hang off issues, so the issue
set has to be found first.

1. **One search per instance** for the issues with your time that week:
   `worklogAuthor = currentUser() AND worklogDate >= <from> AND worklogDate <= <to>`. The search
   endpoint is to be confirmed against live documentation at implementation time, per the standing
   note in the design of record: Cloud moved search to `POST /rest/api/3/search/jql`.
2. **One call per issue returned**, for that issue's worklogs, narrowed with `startedAfter` and
   `startedBefore`. Both take epoch milliseconds.
3. **Filter locally.** Worklogs whose author is not you are dropped. So are any whose start, resolved
   in `THAT_TIMEZONE`, falls outside the week.

**Both ends carry a day of slack.** `worklogDate` resolves against the Jira server's timezone rather
than yours, so a worklog at a week boundary can be a day out in the search. Asking for a day either
side and filtering locally on the real start makes the boundary the app's own, which is the same
rule the rest of this system already follows.

**Cost.** One search plus one call per issue you actually logged against that week, which for one
person's timesheet is a handful, and it uses the token and permissions the app already has.

**Known limit, accepted.** Where a single issue holds more than 100 worklog entries, Jira's JQL
worklog functions only consider the 100 most recent, so such an issue could be missed by the search.
The per-issue read is unaffected. This is remote for a personal timesheet and is not designed around.

### Reconciling what comes back

One worklog at a time, matched to a local entry by `worklog_id`.

| What is found | What happens |
| --- | --- |
| No local entry carries that id | Create one |
| The local entry has unpushed changes (`updated_at > pushed_at`) | **Local wins.** Nothing is touched |
| The local entry is clean | The younger of the two wins |
| The two cannot be ordered | **Local leads** |

**Younger means** the local row's `updated_at` against the worklog's own `updated` timestamp. They
come from two clocks, so equal values, a missing remote timestamp, or any skew that makes the
comparison meaningless all fall to the last row: local leads.
| A local entry whose worklog did not come back | Left alone |

**Local always wins while it is dirty.** Following "youngest wins" into that case would discard an
edit the user typed and never sent, which is the one outcome no synchronisation rule is worth.
Youngest-wins therefore applies only where nothing local is at stake.

**Nothing Jira returns deletes local time.** A worklog missing from the response is not evidence of
anything: it may be outside the slack window, on an issue the search did not return, or deleted by
someone else. Deleting local time on that basis would be irreversible, and the app has no other copy.

### The entry a fetch creates

A created entry takes its instance and issue key from the search, its duration and start from the
worklog, its day from that start resolved in `THAT_TIMEZONE`, and the worklog's id. Its `updated_at` and
`pushed_at` are both the moment of the fetch, with `pushed_at` never earlier, so the derived state
reads **clean**: it came from Jira, and a push must not send it straight back.

**Its comment costs something, and this is the one loss in the design.** Worklog comments on this
API version are structured documents rather than strings. A created entry stores a flattened
plain-text form. If that entry is later edited and pushed back, it goes as plain text, so any
formatting the worklog carried in Jira is lost at that point. The alternative, storing and
round-tripping the document form, would put a Jira representation in the local schema for the sake
of formatting this app never shows.

### The control and its report

A fetch control joins Week's control row, which already shares one height across three controls. It
disables while running. On finishing it reports what it did — created, updated, left alone — and
instances fail independently, reported separately, exactly as the push's partial failures already
are. A fetch that fails on one instance still applies the other's results.

## The API surface

One new endpoint, fetching a week: it takes the week, runs the fetch across every configured
instance, and returns the counts and the per-instance failures. It is an addition to the surface
described in the design of record, which is why this document exists rather than a plan alone.

## Testing

**No test contacts a real Jira instance**, as always. The client's calls are exercised against an
`httptest.Server` standing in for the API.

- **Table-driven over the whole reconciliation matrix**: absent, dirty, clean and younger, clean and
  older, equal, and missing remotely. This is the table a plausible refactor must fail.
- **The day boundary**, in a non-UTC `THAT_TIMEZONE` against a UTC container clock, including a
  worklog whose start falls either side of midnight and one the slack window catches.
- **The guarded update**, interleaving an edit between the read and the mark, asserting the entry
  stays dirty and no duplicate worklog is created.
- **Both 404 paths**, on update and on delete.
- **A browser spec** for the fetch control, its disabled state and its report, and for editing an
  already-pushed entry and re-pushing it.

## Out of scope

- **Periodic synchronisation.** Jira's updated-worklogs feed is keyed on change time rather than the
  day recorded, and is instance-wide, which makes it the wrong shape for "this week" and the right
  shape for a background sync. The owner's standing decision is that it comes back for that, later.
- **Clockwork and Tempo.** Clockwork's API is real but is Pro only, needs its own token per instance,
  and only exists where the app is installed. Not relevant here.
- **The weekly view itself** (#11, shipped) and everything already filed: #105, #106, #107, #108,
  #109, #110.

## The risk this design cannot remove

**The token cannot write worklogs**, established on 2026-09-01: reads succeed, but creating a
worklog returns `401 {"code":401,"message":"Unauthorized; scope does not match"}`. Whether it can
**read** worklogs at the scope these two calls need has never been established at all.

So the first task of the plan proves both calls against the real instance before anything is built
on them. If the token cannot read worklogs either, that is a blocker: the ticket moves to
`status/blocked` and stops, rather than being built blind against a stub that will not match
production.
