# Work Dashboard

A personal PWA that surfaces the Jira issues assigned to one user across several Jira Cloud
instances and logs time against them. Time is entered locally through the day, pushed to Jira as
worklogs at end of day, and reviewed in a weekly rollup before the organisation's weekly timesheet
submission. Single user, self-hosted, runs in Docker.

**The design of record is `docs/superpowers/specs/2026-08-04-work-dashboard-design.md`.** Read it
before answering "how is this supposed to work" — it holds the architecture, data model, API
surface, push semantics and the 13-ticket sequence. This file holds the rules for working in the
repo; it does not repeat the design.

> **Status:** tickets 1 (scaffolding) and 2 (store) have shipped; the commands below describe the
> repo as it stands. Plans for shipped tickets live in `docs/superpowers/plans/`.

## Hard constraints

These come from the project owner. They are not preferences and not open to reinterpretation.

- **Everything runs in Docker.** There is no Go, Node or npm on the host. Never run them bare.
- **No JavaScript frameworks.** Vanilla JS only; TypeScript is permitted for typing.
- **Tailwind CSS v4** for all styling. v4 is CSS-first — there is no `tailwind.config.js`; theme
  values live in `@theme` in `web/src/styles.css`.
- **Keep files small, and keep the initial HTTP response under 14kB.** That number is the TCP
  initial congestion window. `index.html` carries the app shell and inlined critical CSS only;
  views load through dynamic `import()`.
- **Reusable UI is a native WebComponent** registered as `wd-*`, using **light DOM, never shadow
  DOM** — shadow roots stop Tailwind utilities reaching component internals.
- **One issue, one branch, one pull request.** Project-design changes are the one exception — see
  *Workflow*.

## Commands

```shell
make help        # list targets
make up          # start the dev stack on localhost:8080
make down        # stop it and drop its volumes
make verify      # the full merge gate — lint, tsc, tests
make test-go     # Go suite only
make test-e2e    # Playwright suite — brings the app stack up itself
make lint        # golangci-lint + eslint
make tsc         # frontend type check
make build-web   # build the frontend into web/dist
```

Anything not covered by a `make` target runs through Compose:

```shell
docker compose run --rm --no-deps app go test ./internal/server/ -run TestHealth -v
docker compose run --rm --no-deps web npm install
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test'
```

`make verify` and `make test-e2e` together are the source of truth for whether a change is green.
Both run in CI, but on different triggers: `verify` deliberately needs no running stack and runs
on every pull request; `test-e2e` builds the frontend and waits on the app's healthcheck, so it
runs in its own CI workflow, gated to pull requests that touch the frontend or the rig itself —
that gate is the `paths:` list in `.github/workflows/e2e.yml`, which must name every file the rig
depends on. Never claim work is done without pasting their output.

## Layout

```
cmd/server/        entrypoint
internal/config/   runtime configuration, validated at boot
internal/server/   HTTP routes: /api/* and static assets
web/               frontend source and the built dist/
  embed.go         assets embedded into the binary  (//go:build !dev)
  assets_dev.go    assets read from disk            (//go:build dev)
  src/components/  wd-* WebComponents
  src/views/       lazily imported views
.claude/e2e/       Playwright rig: its image, config and tests/
.claude/skills/    repo-local skills, starting with ticket-workflow
docs/superpowers/  specs and plans
```

The server takes its assets as an `fs.FS`, which is what lets the build tag swap embedded assets
for on-disk ones without the server knowing, and what lets its tests run against `fstest.MapFS`
with no build step.

## Conventions

**Go** — standard library first. A dependency needs a reason the stdlib cannot meet; the approved
non-stdlib set is `modernc.org/sqlite` and `golang.org/x/sync`. Wrap errors with `%w` and context
about what was attempted. Table-driven tests with `t.Run` subtests, using `httptest` and
`testing/fstest` rather than real network or filesystem.

**TypeScript** — `strict` with `noUncheckedIndexedAccess`. Do not weaken `tsconfig.json`, and do
not reach for `any`, `as any` or a non-null assertion to get past a type error; the error is
usually right.

**No test ever contacts a real Jira instance.** Jira client tests run against an `httptest.Server`
standing in for the API.

**Comments** — write few. A comment earns its place when the code cannot speak for itself: a
non-obvious "why", a workaround for external behaviour, a subtle invariant. Do not narrate what
the next line does.

**Naming** — a function's name must let a reader predict what it returns without opening it. Bare
verbs (`process`, `handle`, `build`) and direction-hiding nouns fail that test.

## Environment

Configuration is read from the environment at boot and validated; the server refuses to start on
anything missing or malformed. Copy `.env.example` to `.env` and fill it in.

- `WD_SECRET_KEY` — 32 bytes, base64-encoded. Encrypts Jira API tokens at rest.
- `WD_TIMEZONE` — IANA name. Decides where the day boundary falls for time entries. Deliberately
  not derived from the browser: the end-of-day push and weekly rollup must agree on where a day
  ends even when no browser is open.
- `WD_ADDR`, `WD_DB_PATH`, `WD_PORT` — have defaults.

Adding a `WD_*` variable is a public API change. It must be documented in `.env.example`, and it is
only justified when a value must genuinely differ per environment. A lookup table the code always
reads the same way is a constant, not configuration.

## Where correctness lives

Two things carry most of this system's risk, and most bugs worth fearing will trace back to one of
them. Test them harder than anything else.

- **Derived push state.** Whether an entry is unpushed, clean or dirty is computed from
  `worklog_id`, `updated_at` and `pushed_at` — never stored as a flag. That is what makes pushing
  the same day repeatedly idempotent, and it is what a stored flag would quietly break. A push
  across instances is not transactional: each entry succeeds or fails on its own, failures keep
  `worklog_id IS NULL` for the next attempt, and the UI must show which entries did not make it.
- **The day boundary.** `day` is the user's local date, resolved against `WD_TIMEZONE`, while the
  container's clock is almost certainly UTC. Anything that decides which day an entry belongs to —
  entry creation, the end-of-day push, the weekly rollup — must agree, including when no browser is
  open to ask.

Both are worth a table-driven test that a plausible refactor would fail.

## Workflow

Development goes by GitHub issues in `dgerrese/work-dashboard`. Every change to the *product* has
an issue, a branch and a pull request. Changes to how the project is *run* — `CLAUDE.md`,
`.claude/**`, process documents — need no issue and go in their own pull request; split a change
that touches both.

Tickets move through seven statuses, tracked by a single `status:*` label per issue — closed ones
included, where the label records which kind of closed it is:

```
intake → refinement → ready → review → done
   ↓                    ↓
declined             blocked (from anywhere)
```

Three moves are the owner's alone: **intake → refinement** (approval), **intake → declined**, and
**review → done** (the merge). A green `make verify`, a passing CI run and an approving review are
not the merge signal — the owner saying so is. Create an intake ticket and stop; never approve your
own.

**Blocked is a hard stop.** The moment a blocker appears, move the ticket to `status:blocked`, say
what blocked it, and stop. Do not lower a threshold, skip a test, reshape the scope to dodge it, or
pick up another ticket to stay busy.

Work inside "Ready" runs through the superpowers skills: brainstorm → branch in place → plan →
subagent execution under TDD → code review → finish the branch and open the pull request. There is
no bespoke agent team — the `.claude/agents/` definitions were removed once ticket 1 shipped
through this loop instead.

**Invoke the `ticket-workflow` skill** whenever work starts, a ticket changes status, or a blocker
appears. It holds the label mechanics, the `gh` commands, what each status requires and the loop in
full — including the standing decision on worktrees and why the whole-branch review is not
optional.

`docs/superpowers/plans/2026-08-12-handoff.md` is where a session resumes from: current state,
decisions not to reopen, and what is still open.
