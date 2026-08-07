# Work Dashboard

A personal PWA that surfaces the Jira issues assigned to one user across several Jira Cloud
instances and logs time against them. Time is entered locally through the day, pushed to Jira as
worklogs at end of day, and reviewed in a weekly rollup before the organisation's weekly timesheet
submission. Single user, self-hosted, runs in Docker.

**The design of record is `docs/superpowers/specs/2026-08-04-work-dashboard-design.md`.** Read it
before answering "how is this supposed to work" — it holds the architecture, data model, API
surface, push semantics and the 13-ticket sequence. This file holds the rules for working in the
repo; it does not repeat the design.

> **Status:** scaffolding is not yet implemented. The implementation plan for ticket 1 is at
> `docs/superpowers/plans/2026-08-07-scaffolding.md`. Commands below describe the repo as that plan
> builds it.

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
- **One issue, one branch, one pull request.**

## Commands

```shell
make help        # list targets
make up          # start the dev stack on localhost:8080
make down        # stop it and drop its volumes
make verify      # the full merge gate — lint, tsc, tests
make test-go     # Go suite only
make lint        # golangci-lint + eslint
make tsc         # frontend type check
make build-web   # build the frontend into web/dist
```

Anything not covered by a `make` target runs through Compose:

```shell
docker compose run --rm --no-deps app go test ./internal/server/ -run TestHealth -v
docker compose run --rm --no-deps web npm install
docker compose --profile e2e run --rm playwright npx playwright test
```

`make verify` is the single source of truth for whether a change is green. It is what GitHub
Actions runs on every pull request. Never claim work is done without pasting its output.

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
.claude/agents/    developer, project-manager, reviewer
.claude/e2e/       Playwright specs (reviewer-owned)
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

## Workflow

Development goes by GitHub issues in `dgerrese/work-dashboard`. Every task has an issue; every
issue has a branch and a pull request. Three agents in `.claude/agents/` run the cycle:

- **project-manager** — owns the issue backlog, dispatches the developer then the reviewer, opens
  the PR on a pass, loops on failures. Never edits application code.
- **developer** — implements one issue under strict TDD, ships the minimum diff that satisfies the
  acceptance criteria, reports improvement opportunities rather than acting on them. Commits on a
  branch; never pushes.
- **reviewer** — runs `make verify` independently, checks the diff against the criteria, drives
  Playwright for UI changes, returns PASS or FAIL. Never fixes the code it reviews.

Issue state is tracked with `status:*` labels, since GitHub issues only have open and closed.

**Merging is always the user's call.** No agent merges a pull request or closes an issue.
