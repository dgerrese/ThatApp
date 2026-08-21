# Work Dashboard — Design

- **Date:** 2026-08-04
- **Status:** Approved
- **Author:** Dion Gerrese, with Claude

## Purpose

A personal PWA that serves as a daily work dashboard. It surfaces the Jira tickets assigned to
one user across several Jira Cloud instances, and it records the time spent on them.

Time is entered locally throughout the day, pushed to Jira as worklogs at end of day, and
reviewed in a weekly rollup before the organisation's weekly timesheet submission. The user
thinks in days; the organisation reports in weeks. The app owns that translation.

Single user, self-hosted, runs in Docker.

## Binding constraints

These come from the project owner and are not open for reinterpretation during implementation:

- **Everything runs in Docker.** No Go, Node, or database toolchain on the host.
- **No JavaScript frameworks.** Vanilla JS only; TypeScript is permitted for stricter typing.
- **Tailwind CSS** for all styling.
- **Keep files small.** HTTP responses under 14kB are materially faster than responses above it
  (the TCP initial congestion window is roughly 10 packets), so the initial document must stay
  under that budget.
- **Reusable UI is built as native WebComponents** — cards, alert boxes, buttons and similar.
- **Development goes by GitHub issues.** Every task has an issue; every issue has a PR.
- The repository is **private**.

## Scope

**In scope for v1:** multiple Jira Cloud instances; a list of issues assigned to the user across
all of them; pinned issues for logging miscellaneous or shared work; manual time entry; a
start/stop timer; end-of-day push of the day's entries to Jira as worklogs; editing entries after
they have been pushed; a weekly rollup view; PWA install and offline shell.

**Explicitly out of scope for v1:** creating, editing or transitioning Jira issues; comments;
attachments; multi-user support; any Jira Server or Data Center instance; access from outside
`localhost` (see ticket 13).

## Architecture

A single Go binary serves both the static PWA and the JSON API. SQLite holds all state.

```
Browser (PWA: vanilla TS + WebComponents + Tailwind)
   │  fetch('/api/…')  — same origin, so no CORS
   ▼
Go binary
   ├─ static handler   (go:embed in prod, disk in dev)
   ├─ /api/* handlers
   ├─ jira client      (one per configured instance)
   └─ sqlite store     (modernc.org/sqlite — pure Go, no cgo)
   │  HTTPS, Basic auth (email:api-token)
   ▼
Jira Cloud instance A, B, C…  (fanned out concurrently)
```

A backend is not optional. Jira Cloud's REST API sends no CORS headers permitting browser
origins, and a browser-held API token would be readable by anything running on the page. The
server exists to hold credentials and to proxy.

Requests that hit several instances — the assigned-issues list, the end-of-day push — fan out
concurrently with `golang.org/x/sync/errgroup`. One slow or unreachable instance must not
serialise the others.

### Development versus production asset serving

`go:embed` compiles the built frontend into the binary, which is ideal for deployment and
hostile to iteration: every CSS change would require a full Go rebuild.

The static handler therefore takes an `fs.FS`. Two small files select which one, chosen by build
tag: production embeds `web/dist`, development serves it from disk while a watcher rebuilds the
frontend on change. The handler itself is unaware of the difference.

### Container layout

A multi-stage Dockerfile: a Node stage builds the frontend with esbuild and the Tailwind CLI, a
Go stage compiles the binary with the built assets embedded, and the final stage is `scratch` —
roughly 15MB with no runtime dependencies. A named volume holds the SQLite database file.

## Data model

```sql
CREATE TABLE instances (
  id             INTEGER PRIMARY KEY,
  name           VARCHAR(120) NOT NULL,  -- display name, e.g. "Acme"
  base_url       VARCHAR(255) NOT NULL,  -- https://acme.atlassian.net
  email          VARCHAR(255) NOT NULL,
  api_token_enc  BLOB NOT NULL,          -- AES-GCM, key from WD_SECRET_KEY
  created_at     DATETIME NOT NULL
);

CREATE TABLE pinned_issues (
  id             INTEGER PRIMARY KEY,
  instance_id    INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  issue_key      VARCHAR(20) NOT NULL,   -- ABC-123
  summary_cache  TEXT,                   -- so pins render without a Jira round trip
  status_cache   TEXT,                   -- written with it, so a refresh survives a reload
  created_at     DATETIME NOT NULL,
  UNIQUE(instance_id, issue_key)
);

CREATE TABLE time_entries (
  id             INTEGER PRIMARY KEY,
  instance_id    INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  issue_key      VARCHAR(20) NOT NULL,
  day            DATE NOT NULL,          -- YYYY-MM-DD, user's local date
  started_at     DATETIME NOT NULL,      -- RFC3339, clock time work began
  seconds        INTEGER NOT NULL,
  comment        TEXT,
  worklog_id     VARCHAR(32),            -- NULL until pushed to Jira
  pushed_at      DATETIME,               -- NULL until pushed
  created_at     DATETIME NOT NULL,
  updated_at     DATETIME NOT NULL
);
CREATE INDEX idx_entries_day ON time_entries(day);
CREATE INDEX idx_entries_issue_day ON time_entries(instance_id, issue_key, day);

CREATE TABLE timers (
  id             INTEGER PRIMARY KEY CHECK (id = 1),   -- at most one running timer
  instance_id    INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  issue_key      VARCHAR(20) NOT NULL,
  started_at     DATETIME NOT NULL
);
```

**At most one timer runs at a time**, enforced by the `CHECK (id = 1)` constraint. Starting a
timer while another is running stops the first — creating its time entry — and then starts the
new one. This is a single-user app tracking one person's attention; two concurrent timers would
record time that person did not spend.

### Dates and time zones

`day` is the user's **local** date, not UTC. The container's clock is very likely UTC while the
user is not, so the boundary between days must not be decided by the server's zone.

The user's zone is configured once via the `WD_TIMEZONE` environment variable (an IANA name such
as `Europe/Amsterdam`), and the server resolves local dates and worklog `started` timestamps
against it. The app refuses to start on an unset or unparseable value. Deriving the zone from the
browser instead was rejected: the end-of-day push and the weekly rollup both need to agree on
where a day ends even when no browser is open.

### Why entries are not unique per ticket per day

A ticket may have several entries on the same day, each with its own comment and start time. This
matches how Jira models worklogs — many per issue — and it makes the push mapping one-to-one:
**one time entry is exactly one Jira worklog**. Creating is a `POST`, editing is a `PUT` to a
known worklog ID, and deleting is a `DELETE` on it.

Stopping the timer therefore creates a new entry rather than accumulating into an existing one,
which also preserves an honest record of when each block of work happened.

### Credentials at rest

API tokens are encrypted with AES-GCM using a key read from the `WD_SECRET_KEY` environment
variable, so possession of the SQLite file alone does not yield working Jira credentials. The app
refuses to start if the variable is absent or malformed — failing loudly at boot is far better
than silently writing plaintext tokens nobody notices until the phone ticket exposes them to the
network.

## Push semantics

An entry's push state is derived, never stored as a separate flag:

| State | Condition | Push action |
|---|---|---|
| Unpushed | `worklog_id IS NULL` | `POST` worklog, store returned ID, set `pushed_at` |
| Pushed, clean | `worklog_id NOT NULL AND updated_at <= pushed_at` | none |
| Pushed, dirty | `worklog_id NOT NULL AND updated_at > pushed_at` | `PUT` worklog, set `pushed_at` |

Deleting an entry that has a `worklog_id` deletes the corresponding Jira worklog first; the local
row is removed only once Jira confirms. Deletion of an unpushed entry is purely local.

Because state is derived, pushing the same day repeatedly is safe and idempotent.

### Partial failure

A push covering several instances may succeed for some and fail for others. It is **not**
all-or-nothing and it is not transactional across instances. Each entry is pushed independently;
the response reports per-entry success or failure with the error. Entries that failed keep
`worklog_id IS NULL` and are retried by the next push. The UI must show which entries did not
make it rather than reporting a blanket success.

## API surface

```
GET     /api/instances
POST    /api/instances
PATCH   /api/instances/:id
DELETE  /api/instances/:id
POST    /api/instances/:id/test          verify credentials against Jira

GET     /api/issues                      assigned issues, all instances, fanned out
GET     /api/issues/search?q=            issue search, all instances, fanned out

GET     /api/pins
POST    /api/pins
DELETE  /api/pins/:id

GET     /api/entries?from=&to=
POST    /api/entries
PATCH   /api/entries/:id
DELETE  /api/entries/:id

GET     /api/timer
POST    /api/timer/start
POST    /api/timer/stop                  creates a time entry

POST    /api/push?day=YYYY-MM-DD         end-of-day push; per-entry results
GET     /api/week?start=YYYY-MM-DD       weekly rollup
```

Errors return a JSON body with a stable machine-readable `code` and a human-readable `message`.
HTTP status reflects the class of failure; a Jira instance being unreachable is a `502`, not a
`500`.

## Jira integration

Jira Cloud REST API v3, authenticated with HTTP Basic using the account email as username and an
Atlassian API token as password.

Three operations are needed:

- **Assigned issues** — a JQL search for `assignee = currentUser() AND statusCategory != Done`,
  ordered by `updated DESC`.
- **Create worklog** — `POST /rest/api/3/issue/{key}/worklog`
- **Update worklog** — `PUT /rest/api/3/issue/{key}/worklog/{id}`
- **Delete worklog** — `DELETE /rest/api/3/issue/{key}/worklog/{id}`

Two details to confirm against live documentation at implementation time rather than trusting
this document: Atlassian moved Cloud's search to `POST /rest/api/3/search/jql` and deprecated the
older `GET /rest/api/3/search`, so the search endpoint must be verified; and worklog comments on
v3 are Atlassian Document Format, not plain strings.

The `started` field on a worklog is required by Jira, which is why `time_entries.started_at`
exists. Timer entries record the real start. Manual entries default to the time the entry was
created and remain editable.

## Frontend

```
web/
  index.html            app shell, inlined critical CSS
  src/
    main.ts
    api.ts              typed fetch wrappers
    types.ts            hand-written mirror of the Go response structs
    router.ts
    components/
      wd-card.ts  wd-button.ts  wd-alert.ts
      wd-ticket-row.ts  wd-time-entry.ts  wd-timer.ts
    views/
      today.ts  week.ts  settings.ts      lazy-loaded via import()
  sw.ts
  manifest.json
```

**Custom elements use light DOM, not shadow DOM.** Shadow roots would prevent Tailwind's utility
classes from reaching component internals, forcing per-component style duplication. Light DOM
keeps Tailwind working normally and keeps components small.

Since the backend is Go, there is no shared type definition between server and client.
`types.ts` is a hand-written mirror of the Go response structs. The API surface is small enough
that this is a modest cost, and drift surfaces immediately in the UI.

### Meeting the 14kB budget

`index.html` carries the app shell and inlined critical CSS only. Each view is a separate module
loaded on demand with dynamic `import()`. The service worker caches modules after first load, so
the budget matters most on a cold start.

### Views

- **Today** — assigned issues and pinned issues, each row offering a timer and a duration field.
  Shows the day's total and a push button, with per-entry push state visible.
- **Week** — a grid of tickets against Monday–Sunday. Each cell sums that ticket's entries for
  that day. Per-day and per-ticket totals, and push status per day.
- **Settings** — instance CRUD with a test-connection button.

## Testing

Go carries most of the weight: the standard `testing` package with `httptest` for handlers, and a
fake Jira server for client tests. **No test ever contacts a real Jira instance.**

Playwright covers the UI, running in its own Docker Compose profile behind `make test-e2e`. It is
deliberately outside `make test` and `make verify`: those must pass with no stack running and start
nothing, whereas the Playwright suite brings `app` up and blocks on its healthcheck before the first
test — the opposite contract. Specs exercise the
acceptance criteria of the ticket that introduced them — the user-visible behaviour promised —
rather than merely asserting that a page returns 200.

## Linting and the verification gate

All of it runs in Docker; nothing is installed on the host.

- **Go** — `golangci-lint` (govet, staticcheck, errcheck, ineffassign, unused) plus `gofumpt`
  for formatting, run from the `golangci/golangci-lint` image.
- **Frontend** — ESLint 9 with flat config and `typescript-eslint`; Prettier for formatting, with
  `prettier-plugin-tailwindcss` to sort Tailwind class names canonically and remove a whole
  category of diff noise; `tsc --noEmit` for type checking.

Make targets:

```
make fmt      gofumpt + prettier --write
make lint     golangci-lint + eslint
make tsc      tsc --noEmit
make test     go test ./...
make verify   lint + tsc + test — the merge gate
make test-e2e Playwright, separately — brings the app stack up itself
```

`make verify` and `make test-e2e` together are the source of truth for whether a change is green.
`verify` deliberately needs no running stack: it is run before any task is reported done,
independently again at review, and by GitHub Actions on every pull request. `test-e2e` is out of
that loop by design — it starts the stack and waits on `app`'s healthcheck — and runs in its own CI
workflow, gated to pull requests that touch the frontend or the rig itself.

## Development workflow

> **Superseded 2026-08-07.** This section originally specified a bespoke three-agent team
> (project-manager, developer, reviewer) under `.claude/agents/`. Those definitions were written
> but never run: ticket 1 shipped through the superpowers skills instead, and the agent team was
> removed rather than maintained alongside a second workflow that did the same job.

Work runs through the superpowers skills: `writing-plans` decomposes an issue into tasks,
`subagent-driven-development` executes them with a fresh subagent per task and a review after
each, `test-driven-development` governs implementation, and `finishing-a-development-branch`
pushes and opens the pull request.

The whole-branch review at the end of that loop is load-bearing, not ceremony. On ticket 1 every
one of the seven task reviews passed while the branch still carried a Critical defect, because
each reviewer saw only its own diff and each diff was correct in isolation.

The backlog lives in GitHub issues, one pull request per issue. Merging is always the project
owner's decision.

## Ticket sequence

| # | Ticket | Delivers |
|---|---|---|
| 1 | Scaffolding | Docker, Compose, Makefile, Go module, FE build, lint config, CI |
| 2 | Store | SQLite schema, migrations, repository layer |
| 3 | Jira client | Instance model, auth, token encryption, fake-server tests |
| 4 | Settings view | Instance CRUD, connection test |
| 5 | Assigned issues | Concurrent fan-out, Today view |
| 6 | Pinned issues | Pin and unpin, logging against shared tickets |
| 7 | Manual entry | Duration input, day total |
| 8 | Timer | Start and stop, survives a page reload |
| 9 | End-of-day push | Day's entries become Jira worklogs, partial-failure reporting |
| 10 | Edit after push | Worklog update and delete by ID |
| 11 | Week view | Rollup grid, per-day push status |
| 12 | PWA shell | Manifest, service worker, offline |
| 13 | LAN and HTTPS | *Deferred* — phone access, TLS, app-level auth |

Ticket 1 includes the lint configuration and CI workflow so that the verification gate exists
before any feature code does.

## Decisions deferred

- **Access from the phone** (ticket 13). Service workers require HTTPS anywhere other than
  `localhost`, so this needs a locally-trusted certificate and app-level authentication before
  the dashboard can be exposed to the local network. Deliberately excluded from v1 so a working
  dashboard arrives sooner.
- **Jira Server / Data Center support.** All instances are Cloud today. The Jira client is
  structured per-instance so an adapter could be added, but no such adapter is built.
- **Generated TypeScript types from Go structs.** Hand-written for now; revisit if drift becomes
  a real annoyance rather than a theoretical one.
