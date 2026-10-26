# ThatApp

A personal PWA that surfaces the Jira issues assigned to one user across several Jira Cloud
instances and logs time against them. Time is entered locally through the day, pushed to Jira as
worklogs at end of day, and reviewed in a weekly rollup before the organisation's weekly timesheet
submission. Single user, self-hosted, runs in Docker.

**The design of record is `docs/superpowers/specs/2026-08-04-thatapp-design.md`.** Read it
before answering "how is this supposed to work" — it holds the architecture, data model, API
surface, push semantics and the 13-ticket sequence. This file holds the rules for working in the
repo; it does not repeat the design.

> **Status:** tickets 1 (scaffolding) and 2 (store) have shipped; the commands below describe the
> repo as it stands. Plans for shipped tickets live in `docs/superpowers/plans/`.

## Hard constraints

These come from the project owner. They are not preferences and not open to reinterpretation.

- **Local development runs in Docker.** There is no Go, Node or npm on the host, so never run them
  bare here — drive everything through `make` or `docker compose`. This is a rule about *this
  machine*, not about the software: CI runs the same tools natively, because a Forgejo Actions job
  is itself a container and Codeberg's hosted runners provide no Docker daemon inside one. See
  `.forgejo/workflows/`.
- **No JavaScript frameworks.** Vanilla JS only; TypeScript is permitted for typing.
- **Tailwind CSS v4** for all styling. v4 is CSS-first — there is no `tailwind.config.js`; theme
  values live in `@theme` in `web/src/styles.css`.
- **Keep files small, and keep the initial HTTP response under 14kB.** That number is the TCP
  initial congestion window. `index.html` carries the app shell and inlined critical CSS only;
  views load through dynamic `import()`.
- **Reusable UI is a native WebComponent** registered as `that-*`, using **light DOM, never shadow
  DOM** — shadow roots stop Tailwind utilities reaching component internals.
- **Browser support is Firefox and Chromium.** Firefox is the primary target — it is what the owner
  uses — with Chromium covered for occasional switching. **Safari and WebKit are an explicit
  non-goal**, not an unaddressed gap: do not raise them as missing coverage, and do not add WebKit
  to the e2e matrix. This also means the phone in ticket 13 is an Android device.
- **One issue, one branch, one pull request.** Project-design changes are the one exception — see
  *Workflow*. A branch cut from another open branch gets a pull request based on that branch, not
  `main`. The `ticket-workflow` skill covers stacking.
- **Never merge a branch into `main` locally.** Every branch reaches `main` through a pull request
  the owner merges, and nothing else. This is absolute: it holds for a green branch, an approved
  one, a one-line fix, a documentation typo, and a branch the owner said they were happy with. Do
  not run `git merge` onto `main`, do not fast-forward it, and do not offer merging locally as an
  option to choose from. If a skill or a tool presents that choice, this constraint overrides it.

## Commands

```shell
make help        # list targets
make up          # start the dev stack (its port is THAT_PORT — read it, never assume)
make down        # stop it and drop its volumes
make verify      # the full merge gate — lint, tsc, tests
make test-go     # Go suite only
make test-e2e    # Playwright suite — brings the app stack up itself
make lint        # golangci-lint + eslint
make tsc         # frontend type check
make build-web   # build the frontend into web/dist
make image       # dry-run the release image build against a throwaway registry
```

**The dev stack's port is `THAT_PORT` in `.env`, and it is not always the default.** Read it — or
read the published port out of `docker compose ps` — before opening a browser, a `curl` or a test
against the running app. A machine may already run the released image beside the dev stack, and that
one answers on the default port. Pointing at the wrong one does not fail: it serves a working app
built from different code, which reads as a stale build and costs an hour.

Anything not covered by a `make` target runs through Compose:

```shell
docker compose run --rm --no-deps app go test ./internal/server/ -run TestHealth -v
docker compose run --rm --no-deps web npm install
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test'
```

`make verify` and `make test-e2e` together are the source of truth for whether a change is green.
CI runs the same checks on different triggers: `verify` needs no running stack and runs on every
pull request that changes more than documentation (`docs/**`, any `*.md`, `.claude/skills/**`); the
end-to-end suite builds the frontend and waits on the app's health endpoint, so it runs in its own
workflow, gated to pull requests that touch the frontend or the rig itself — that gate is the
`paths:` list in `.forgejo/workflows/e2e.yml`, which must name every file the rig depends on and
ends by excluding Markdown. A docs-only pull request therefore runs no CI at all (#167). Never
claim work is done without pasting their output.

**CI does not use Compose, and the two can drift.** `make verify` drives each tool through a
container; `.forgejo/workflows/verify.yml` invokes the same tools directly, and splits them across
two jobs because Codeberg caps a hosted job at ten minutes. Nothing enforces that the two stay
equivalent — change one and you must change the other by hand. The end-to-end workflow points the
Playwright rig at `localhost` through `THAT_BASE_URL` rather than the Compose alias, which is why
it needs no test changes.

## Layout

```
cmd/server/        entrypoint
internal/config/   runtime configuration, validated at boot
internal/server/   HTTP routes: /api/* and static assets
web/               frontend source and the built dist/
  embed.go         assets embedded into the binary  (//go:build !dev)
  assets_dev.go    assets read from disk            (//go:build dev)
  src/components/  that-* WebComponents
  src/views/       lazily imported views
.claude/e2e/       Playwright rig: its image, config and tests/
.claude/skills/    repo-local skills: ticket-workflow, autopilot, eod, retro
docs/superpowers/  specs and plans
scripts/           release-image.sh: assembles and pushes the release image (#122)
README.md          how a colleague runs a release
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

**Ponytail** — the `ponytail` plugin, enabled for this repository in `.claude/settings.json`, sets how
code is written here: understand the change first, then take the smallest thing that works — reuse
what the repository already has, then the standard library, then the platform, before writing new
code. It shortens the solution, never the reading. It never overrides this file: the hard
constraints, the tests *Where correctness lives* asks for, test-driven development with mutation (the
`ticket-workflow` skill), validation, error handling and accessibility all stand as written, and
ponytail's own "one small check" testing rule is replaced by them. A deliberate shortcut with a known
limit is marked with a `ponytail:` comment naming the limit and what replaces it — a comment that
earns its place under the rule above.

## Environment

Configuration is read from the environment at boot and validated; the server refuses to start on
anything missing or malformed. Copy `.env.example` to `.env` and fill it in.

- `THAT_SECRET_KEY` — 32 bytes, base64-encoded. Encrypts Jira API tokens at rest.
- `THAT_TIMEZONE` — IANA name. Decides where the day boundary falls for time entries. Deliberately
  not derived from the browser: the end-of-day push and weekly rollup must agree on where a day
  ends even when no browser is open.
- `THAT_ADDR`, `THAT_DB_PATH`, `THAT_PORT` — have defaults.

Adding a `THAT_*` variable is a public API change. It must be documented in `.env.example`, and it is
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
- **The day boundary.** `day` is the user's local date, resolved against `THAT_TIMEZONE`, while the
  container's clock is almost certainly UTC. Anything that decides which day an entry belongs to —
  entry creation, the end-of-day push, the weekly rollup — must agree, including when no browser is
  open to ask.

Both are worth a table-driven test that a plausible refactor would fail.

## Workflow

Development goes by Codeberg issues in `DionGerrese/ThatApp`. Every change to the *product* has
an issue, a branch and a pull request. Changes to how the project is *run* — `CLAUDE.md`,
`.claude/**`, process documents — need no issue and go in their own pull request; split a change
that touches both. A change to user documentation alone, such as `README.md`, needs no issue either:
it gets a branch and a pull request titled `[Docs]`.

Open tickets carry exactly one `status/*` label; closed ones carry none, because Codeberg already
records how an issue ended:

```
          (owner asks)
                ↓
intake → needs-refinement → todo → in-progress → (open PR) → merged & closed
   ↓                                   ↓
closed as not planned,             blocked (from anywhere)
labelled wontfix
```

Review and done are **not labels**. An open pull request saying `Closes #<n>` is the review state,
and a closed issue is the finished one — so the label comes off when the issue closes. A pull
request closed *without* merging is the one gap: move the ticket back to `status/in-progress` by
hand.

`bug` and `enhancement` are a second, optional axis recording whether a ticket is a defect or new
capability. At most one, and plenty of tickets are neither.

`priority/high` and `priority/low` are a third, answering what to pick up next, and **priority is the
first thing to read**. Within one priority band, **a `bug` comes before a non-bug** — shipped work
that does not work is a worse state than work that does not exist — so two `priority/high` tickets
are not a tie when one of them is a defect. The scope is exclusive, and **normal priority carries no
label at all** — an unlabelled ticket is normal, not
untriaged, so there is no `priority/normal` to add. Priority is the owner's to set; suggest, do not
relabel. Every open issue also carries a **milestone**, a scoped feature set in the way of an epic;
that is a separate question from priority, and the milestone descriptions on Codeberg say what each
one admits. A new ticket goes into the milestone whose description fits it. A ticket that fits none
is raised with the owner, because a new milestone is theirs to create. The owner retired the
release-shaped `v1` and `v2` for feature sets on 2026-10-26.

**Cutting the branch is what moves a ticket to `status/in-progress`.** The trigger is the branch
existing, not a judgement about how far the work has got: a ticket with `issue-<n>-<slug>` pushed is
in progress even when that branch carries only a design and a plan. That makes `status/todo` mean
"nobody has started this" rather than "started or not, who knows".

**Intake is for tickets you raise yourself** — a problem noticed in passing, a gap in the spec.
Those start at `status/intake` and stop there. **A ticket the owner asks for arrives already
approved**, because the asking is the approval: create it at `status/needs-refinement` and skip
intake altogether.

**Work on a ticket starts on the owner's word and nothing else.** Not the handoff naming what comes
next, not a lull in the conversation with the board in view, and not an offer to start that drew no
reply — **silence is not a go-ahead**. An offer left unanswered while the conversation moved on is
dead: ask again, never resume it. Say what is next and stop there. What this governs is *starting*;
once the go-ahead is given the work runs to its end without further prompting, and a finished green
branch is pushed and opened as a pull request rather than offered as a choice.

Two moves are the owner's alone: **approving an intake** and **declining one** (closing it as not
planned). So is **the merge**, which is what finishes a ticket — a green `make verify`, a passing CI
run and an approving review are not that signal; the owner saying so is. Never approve your own.

The merge is theirs in the literal sense too: **merging into `main` locally is forbidden**, per the
hard constraint above. Finishing a branch means pushing it and opening a pull request — those are
the only two endings, alongside leaving the branch alone.

**A locked 1Password vault never stops local work.** Commits are SSH-signed through 1Password, which
holds no keys while the vault is locked, so `git commit` fails. That is not a blocker and not a
question for the owner: retry the same commit unsigned with `git -c commit.gpgsign=false commit …`
and carry on, noting the last signed commit in the session's ledger. The vault matters at exactly
one point — **nothing unsigned reaches the remote, ever.** Before pushing, re-sign the range and
check it:

```shell
git rebase --exec 'git commit --amend --no-edit -S' <last-signed-commit>
git log --format='%h %G?' <last-signed-commit>..HEAD    # every line must read G
git diff <old-tip> HEAD                                 # must be empty
```

Every subagent that may commit is told both halves: commit unsigned rather than stop, and never
push.

**Blocked is a hard stop.** The moment a blocker appears, move the ticket to `status/blocked`, say
what blocked it, and stop. Do not lower a threshold, skip a test, reshape the scope to dodge it, or
pick up another ticket to stay busy. The one exception is an autonomous run, where there is nobody
to stop for — see the `autopilot` skill below.

Work inside "Ready" runs through the superpowers skills: brainstorm → branch in place → plan →
subagent execution under TDD → code review → finish the branch and open the pull request. There is
no bespoke agent team — the `.claude/agents/` definitions were removed once ticket 1 shipped
through this loop instead.

**A ticket that puts something on screen the design does not already draw runs an interactive
design session first.** A new control, a moved one, a new report, a state no mark expresses yet:
if the visual design language, the ticket's design document or the prototype does not show it,
settle it with the owner on the local browser companion before planning, never by reasoning out
what the design would probably have wanted.

**Where the design does draw it, the work is verified against the drawing before anyone reports
done** — by whoever builds it, and again by whoever reviews it. The report says what was compared
and what was found; "looks right" is not a comparison. A difference the ticket forces is reported
to the owner so the design is updated, never absorbed silently, because the next ticket reads the
drawing rather than the diff. **A ticket that changes the interface also attaches screenshots of what
it built to its pull request** — `.claude/tools/pr-attach.sh` uploads them, as Forgejo attachments
rather than repository files.

The `ticket-workflow` skill holds both tests, how the session runs, and why #117 exists.

**Invoke the `ticket-workflow` skill** whenever work starts, a ticket changes status, or a blocker
appears. It holds the label mechanics, the `tea` commands, what each status requires and the loop in
full — including the standing decision on worktrees and why the whole-branch review is not
optional.

**Invoke the `autopilot` skill when the owner hands the board over and leaves** — "work the board",
"carry on without me", "keep going while I'm out". It wraps `ticket-workflow` without altering it,
and settles the three things that skill leaves to someone in the room: tickets are taken from the
milestone the owner names, in priority order; a blocker parks its own ticket rather than stopping
the run; and a question is either a blocker or a recorded default. The run is the owner's to start; never assume
one. Outside a run, **blocked stays the hard stop described above.**

`docs/superpowers/plans/handoff.md` is where a session resumes from: current state, decisions not to
reopen, and what is still open. It carries **no dated entries** — the day-by-day narrative lives in
`docs/superpowers/plans/handoff/YYYY-MM-DD.md`, one file per day. Read `handoff.md` always; read a
day only to learn how something came to be. Anything a later session must not rediscover gets
promoted from the day's file into `handoff.md` on the day it happens, so no daily file is ever
load-bearing.

**A rule the owner sets goes into the document that governs it on the day it is set** — `CLAUDE.md`
or the skill — on a `[Process]` branch. A day file is not read and this machine's memory does not
leave this machine, so neither is a home for a rule. On 2026-09-21 the owner set in-progress tickets
first; the rule reached only a day file, and the 2026-09-30 run walked past #123.

**Invoke the `eod` skill when the day ends** — the owner saying "eod", "that's me for today" or
"shutting down". The end of the day propagates: running subagents are signalled to wrap up and
report, and their reports go into the day's handoff. It then leaves nothing running, nothing that
exists only on this machine, and a `handoff.md` whose claims have been checked rather than assumed.
It pushes and it reports; it never merges, deletes a branch, force-pushes or closes anything.

**Invoke the `retro` skill** when the owner asks for a retrospective. It reads finished tickets for
the failures that recurred or cost something, and puts each proposed rule change to the owner one at
a time. It changes how the project is *run* and nothing else — anything it wants changed in the
product is an intake ticket like any other.
