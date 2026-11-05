# Team view — a PM reads a team's worklogs and exports them

**Date:** 2026-11-04
**Supersedes:** nothing. It narrows no existing rule; "multi-user support" stays out of scope.
**Superseded by:** nothing

## Intent

Project managers in the organisation want to use ThatApp. They need two things the app does not do
today: **see how much time a team logged**, and **make a report from that time**. The report goes
into a spreadsheet or onto a screen in a meeting.

The owner's decisions in the 2026-11-04 brainstorm settle where the data comes from. Every person
already pushes their time to Jira as worklogs. Jira is therefore the shared record, and a PM's
ThatApp only has to read it. No server is shared and no data leaves Jira to reach the PM.

## Goals

- A PM keeps one team: a list of people.
- A PM picks a date range and sees each person's hours in a grid.
- A PM narrows the view to one project or one board, or leaves it unscoped.
- A PM exports the same selection as CSV, one line per worklog.

## Non-goals

- **Multi-user support.** Every person runs their own ThatApp. The PM's instance is an ordinary
  instance with one more view. There is no "PM mode", no login, and no shared database.
- **Unpushed time.** An entry that is not pushed is a draft. The person keeps it private until they
  push. The team view shows Jira worklogs only.
- **Roles other than PM.** The owner scoped this to PMs for now.
- **More than one team.** One team for now.
- **Totals, pivots or charts in the export.** The spreadsheet does that.

## Anti-goals

- ThatApp adds **no permission rules of its own**. The PM's Jira token decides what the PM can read.
  A project the PM cannot see in Jira is absent from the view and from the export.
- A person with accounts on two instances must **never show as two rows**, and their time must
  **never count twice**.
- A failure on one instance must **never look like zero hours**. The view says which instance did
  not answer, in the same way the end-of-day push reports per-entry failure.

## Decisions (the owner's)

1. **Data source:** pushed worklogs, read from Jira with the PM's own API token, across all the
   PM's configured instances.
2. **Team:** one saved list of people.
3. **Scope filter:** none, one project, or one board.
4. **Range:** quick ranges plus a free range with two date fields. The PM thinks mainly in weeks
   and quarters.
5. **Grid granularity:** a week range shows one column per day. A month or quarter range shows one
   column per week.
6. **People with more than one account:** most people have one Atlassian account across all
   instances, but the design must support a person with a separate account on a client instance.
7. **Layout**, from the wireframe on the local browser companion: filters on top (people, range,
   scope, "Export CSV"), the grid below. Each row and each column has a total. A click on a person
   opens that person's issues for the same range and scope.
8. **Completeness:** the report holds every worklog in the range, or says plainly that it does not.
   A warning on a short total is not acceptable as the design.
9. **Size:** a team of about 50 people; the longest range is one year.
10. **Delivery:** several tickets, in their own milestone, "Team reporting".

## How it works

### The team

A team member is **one display name with one or more Jira accounts**. An account is an
`(instance, accountId)` pair.

- The PM adds a person through a Jira user search on one instance.
- An Atlassian account has the same `accountId` on every Cloud site it can reach. The app therefore
  looks up that `accountId` on each other configured instance and attaches each match to the same
  person automatically.
- The PM can attach another account by hand, for a person with a separate account on a client
  instance. The PM can also remove an attached account.
- *Claude's call:* the cross-instance lookup runs once, when the PM adds the person. A removal is a
  plain delete and stays removed. An instance configured later attaches nothing by itself; the PM
  attaches the account by hand.

The team lives in the PM's own SQLite store, like the instances and the pinned issues.

### Reading the worklogs

**The report must be complete** (the owner's decision). A total that is silently short is the
anti-goal above, and a warning on a report does not make it usable in a meeting.

That rules out the read path of the Week fetch (`internal/jira/worklogs_read.go`) as the source.
Its search step uses JQL's worklog functions, and those consider only the 100 most recent worklogs
of an issue. A team logs far more worklogs on a busy issue than one person does, so the search can
miss an issue entirely, and nothing in the response says so.

The source is Jira's instance-wide worklog feed in its place:

- `GET /rest/api/3/worklog/updated?since=<ms>` lists the IDs of every worklog changed since a time
  that the token can see. It pages with `nextPage` until `lastPage`.
- `POST /rest/api/3/worklog/list` returns up to 1000 worklogs by ID.
- `GET /rest/api/3/worklog/deleted?since=<ms>` lists the IDs of deleted worklogs.

The feed returns every visible worklog on the instance, not only the team's. The app keeps only
those whose author is a team account on that instance.

**Size** (the owner's numbers): a team of about 50 people, and a range of at most one year.

*Claude's call, which follows from the size:* the app keeps **a local copy** of the team's worklogs
in SQLite, per instance, and does not read Jira each time the PM opens the view. A year for 50 people
is far too much to read on every view.

- The first sync of an instance reads from one year before today.
- Each later sync reads `updated` and `deleted` from the last sync time, and applies the changes.
- The view reads the local copy only. It shows when each instance last synced, and it has a control
  to sync now.
- A sync that fails on one instance leaves that instance's copy as it was. The view says the copy is
  stale and why, in the same way the end-of-day push reports per-entry failure.
- A team change resets the copy: adding an account means its older worklogs are absent from the
  copy, so that instance syncs from one year back again.

The range picker does not allow more than one year.

### The day boundary

A worklog belongs to the day of its `started` time in the **PM's** `THAT_TIMEZONE`. Team members
can sit in other timezones; the report uses one boundary so that its days and weeks add up. This is
the same rule the app already applies to its own entries.

### The grid

- A range of up to 14 days shows one column per day. A longer range shows one column per ISO week.
  A week at the edge of a free range counts only the days inside the range.
- Day columns show hours and minutes, as Week does. Week columns show decimal hours.
- A person with no time in the range still shows, with zeros, because "nobody logged" is the
  information.

### The export

CSV, one line per worklog, for the full range and the same filters. The export does not depend on
the grid's granularity.

Columns: date, person, Jira account, instance, issue key, issue summary, project, hours, comment.

## Constraints

Every hard constraint in `CLAUDE.md` holds. The ones this view meets most directly:

- The view loads by dynamic `import()`, so the initial response stays under 14kB.
- Reusable controls are `that-*` WebComponents in light DOM.
- No test contacts a real Jira instance.
- Firefox first, Chromium second.

## Left to the builder

- The API surface for the team and for the report.
- How the scope filter lists projects and boards across instances.
- The CSV encoding details (separator, decimal mark, header row).
- How the click-through to one person's issues looks.

## Still open

- **The visual design.** The 2026-11-04 wireframe settles layout only, not the app's visual
  language. A design session on the local browser companion settles it before planning, per the
  rule for UI the design does not draw.
- **Where the view sits in navigation**, and what the view shows before the PM adds anyone.

## Tickets

All in the "Team reporting" milestone, each depending on the one before it:

1. #336 — the saved team and its Jira accounts.
2. #337 — the local worklog copy and its sync. Depends on #336.
3. #338 — the team view grid, with people and range. Depends on #337.
4. #339 — scope by project or board. Depends on #338.
5. #340 — CSV export. Depends on #338.
