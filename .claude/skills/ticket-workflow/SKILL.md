---
name: ticket-workflow
description: Use when starting any work in this repo, creating or refining a Codeberg issue, moving a ticket between statuses, opening a pull request, or the moment a blocker appears. Holds the ticket lifecycle, the label mechanics and the superpowers loop that runs underneath it.
---

# Ticket workflow

Work in this repository is tracked as Codeberg issues in `DionGerrese/ThatApp`, and every change
to the product arrives through a pull request tied to one. This skill holds the mechanics. The
rules come from the project owner and are not open to reinterpretation.

## Does this need a ticket?

**Yes** — for everything that changes the product: Go and TypeScript source, the SQLite schema, the
`/api/*` surface, `THAT_*` configuration, Docker and Compose, CI workflows, dependencies, and the
design of record under `docs/superpowers/specs/`.

**No** — only for *project design*: `CLAUDE.md`, `.claude/**` (skills, the e2e rig's own process
docs), and repository-process documents such as the handoff. These may go in their own pull request
with no issue behind them, on a branch named for the topic rather than an issue number.

The distinction is how the project is *run* versus how the product *works*. A spec describing push
semantics needs a ticket; a change to this skill does not. When a change touches both, split it.

## The five statuses

Status lives in a label, and **a `status/*` label describes open work only.** Exactly one while the
issue is open; none once it is closed. The label is the source of truth for anything Codeberg cannot
already tell you — not a board, not a comment, not a checklist.

| Status | Label | Who moves it | Meaning |
|---|---|---|---|
| Intake | `status/intake` | You, for ideas **you** raise | A raw problem or idea, a few sentences. Nothing else happens yet. |
| Needs refinement | `status/needs-refinement` | **Owner only** — except a ticket they asked for, which you create here directly | Approved, but not yet refined; the acceptance criteria are still fuzzy. |
| To do | `status/todo` | You, when refinement is genuinely finished | Acceptance criteria are complete and unambiguous. Work may start, and nobody has started it. |
| In progress | `status/in-progress` | You, when the branch is cut | `issue-<n>-<slug>` exists. Someone is on it. |
| Blocked | `status/blocked` | You, immediately, from any status | A blocker exists. Work stops. |

### What Codeberg says, so the labels do not

Three former statuses were deleted on 2026-08-20 because each restated something the forge already
knew. Read these off the issue itself rather than reaching for a label:

| Was | Read it from |
|---|---|
| `status/review` | An **open pull request** whose body says `Closes #<n>`. Opening the PR *is* the move to review — the two were always the same event. |
| `status/done` | The issue is **closed** and not labelled `wontfix`, its pull request merged. |
| `status/declined` | The issue is **closed** and labelled `wontfix`. |

**`wontfix` is load-bearing here, and was not on GitHub.** Forgejo issues are only ever open or
closed — there is no "closed as not planned" as distinct from "closed as completed", and `tea
issues close` accordingly takes no reason. GitHub recorded that distinction itself, which is why
the 2026-08-20 cleanup could drop both labels. On Codeberg only `wontfix` separates a declined
ticket from a finished one, so **never close a declined ticket without it** — unlabelled, it is
indistinguishable from work that shipped.

**A pull request closed without merging is the one gap**, because the issue is then left with no
signal at all — it has happened once, on PR#27. Move the ticket back to `status/in-progress` by
hand when that occurs.

**On closing an issue, remove its `status/*` label.** A closed issue carrying `status/in-progress`
is a lie.

### Scoped labels are exclusive, and the forge enforces it

The `status/*` labels use Forgejo's scoped-label mechanism: the `/` is a scope delimiter, and the
labels are created with `exclusive: true`, so **applying one automatically removes any other label
in the same scope**. Two consequences:

- Adding a status does not require removing the old one. `tea issues edit <n> --add-labels
  status/todo` is the whole move; the previous status falls off by itself.
- "Exactly one `status/*` label while open" is no longer a rule you can break by accident. It is
  still possible to have *none* — that is the state to watch for.

**`priority/*` is scoped and exclusive too**, on the same mechanism, so `priority/high` and
`priority/low` can never both be on one ticket and neither has to be removed to apply the other.
`bug`, `enhancement` and `wontfix` are unscoped and carry no exclusivity, so those are still applied
and removed by hand.

### Type: `bug` and `enhancement`

A second, independent axis: **is this a defect, or an addition?**

| Label | Means |
|---|---|
| `bug` | The product misbehaves relative to its spec or its own intent. |
| `enhancement` | A clear addition that is not needed to keep the app running, or is not in the initial design. |

Unlike status, type is **optional and at most one**. Plenty of tickets are neither — a refactor, a
test-infrastructure change, a documentation ticket. Do not force one on for the sake of symmetry;
an unlabelled issue is a legitimate answer.

**`enhancement` is narrower than "new work".** The owner's test, given on 2026-09-02: it is an
enhancement when the ticket is *clearly an addition* and either *is not necessary to keep the app
running* or *is not in the initial design*. Two consequences that catch most misfilings:

- **The design of record's own tickets are not enhancements.** The 13-ticket sequence *is* the
  initial design, so #8, #10, #11 and #13 carry no type. Neither does a ticket that builds
  something the visual design language already specifies, such as the phone layout. Building what
  was designed is not an addition to it.
- **The axis is about the product.** A test-rig change, a formatting gate, a refactor or an API
  reference document is not an addition to the app, whatever else it is. Those stay untyped.

A ticket whose own body says it *widens* an agreed contract rather than correcting it is the clean
case for `enhancement` — #19 is the worked example.

**No `enhancement` in a milestone whose scope is not yet determined.** The test above measures a
ticket against a design, so it has no answer until the milestone has a scope to be measured against.
Until the owner settles that scope, a ticket in such a milestone carries no type label — not a
provisional one — and it is typed only once the scope exists. Which milestones those are is the
owner's call, not something to infer from a milestone's description. Set on 2026-09-16, when v2's
scope was still open and its seven `enhancement` labels came off.

### Priority: `priority/high` and `priority/low`

A third axis, added 2026-09-08 because the board had no ordering within a milestone. It answers
**what to pick up next**, and it is independent of both status and type.

| Label | Means |
|---|---|
| `priority/high` | Ahead of normal. Pick this up before unlabelled work. |
| *(no label)* | Normal. The default, and the right answer for most of the board. |
| `priority/low` | Behind normal. Real work, but nothing waits on it. |

**Normal has no label on purpose**, so priority is only ever recorded where it differs from the
default — the same reason there is no `status/done`. Do not invent a `priority/normal`, and do not
read an unlabelled ticket as untriaged: unlabelled *is* the triaged answer unless something says
otherwise.

The scope is exclusive, so `tea issues edit <n> --add-labels priority/high` is the whole move.
Returning a ticket to normal is the one case needing the explicit removal, because there is no third
label to displace the current one:

```shell
tea issues edit <n> --add-labels priority/high
tea issues edit <n> --remove-labels priority/low      # back to normal
```

**Priority is the owner's call, not a reading of the ticket.** Raise a suggestion; do not relabel a
ticket's priority unasked. Milestone and priority are also different questions — v1 says a thing has
to be right before the app ships, `priority/high` says it should be picked up first, and a ticket can
easily be one without the other.

**Priority is read first, and `bug` breaks the tie inside a band.** Settled by the owner on
2026-09-10, when #121 and #8 were both open, both `priority/high` and both v1. Sort by priority —
`priority/high`, then unlabelled, then `priority/low` — and then, **among tickets sharing a priority,
a `bug` comes before a non-bug.** A defect is in the product the owner is already using; a feature is
not yet, so shipped work that does not work is a worse state than work that does not exist.

A `bug` does **not** jump a band. A normal-priority defect does not displace a `priority/high`
feature; priority still says which band, and the type only orders within it.

So two tickets both carrying `priority/high` are **not a tie** if one of them carries `bug`. Say
which wins and why, rather than presenting them as equals and leaving the owner to spot the
difference. This changes what you *recommend*, not what you *label* — priority is still the owner's
to set.

**Cutting the branch is what moves a ticket to `status/in-progress`.** The trigger is the branch
existing — not the first line of implementation code, and not a judgement about how far the work has
got. A ticket whose branch carries only a design and a plan is in progress. Move the label in the
same breath as `git checkout -b`, so `status/todo` can be read as "untouched" without checking.

**Opening the pull request is the last thing you do to a ticket unaided.** It carries no label
move any more — the open pull request is the review state. After that the ticket is the owner's
until they say what happens next.

**Every pull request title starts with a prefix saying what kind it is:**

| Kind | Prefix | Example |
|---|---|---|
| A ticket's work | `[#<issue>]` | `[#83] Today's tables sort on every column` |
| A project-design change (no issue) | `[Process]` | `[Process] A branch built on another open branch is stacked` |
| The day's handoff | `[Handoff]` | `[Handoff] Record 2026-09-18` (see the `eod` skill) |

The prefix is the first thing read in the open pull request list, and it sorts that list by what
each PR is before anyone opens one. The ticket number goes in the prefix even though the body says
`Closes #<n>`, because the list shows titles, not bodies. A pull request opened without a prefix is
renamed as soon as it is noticed. Set by the owner on 2026-09-18.

### Transitions you may never make yourself

- **Intake → Needs refinement.** The owner approves an intake ticket. Create it, then stop and ask.
  This governs *promotion*, not where a ticket enters. A ticket the owner asked for never sits in
  intake at all — it is created at `status/needs-refinement`, because the asking was the approval.
  What you may never do is promote an intake **you** raised.
- **Declining an intake.** The owner labels it `wontfix` and closes it. Never
  pre-empt it.
- **Closing a finished ticket.** The merge is the owner's, and so is the close. A green
  `make verify`, a passing CI run, an approving review and a branch that looks merged are none of
  them that signal. Merging the pull request closes the issue through `Closes #<n>`; strip the
  `status/*` label when it does.

**Merging into `main` locally is forbidden outright** — a hard constraint in `CLAUDE.md`, not a
preference. A branch reaches `main` through a pull request the owner merges and no other way, no
matter how green or how small it is. `superpowers:finishing-a-development-branch` offers "merge back
to main locally" as its first option; in this repo that option does not exist. Present only the
other two — push and open a pull request, or leave the branch as it is — and say why the third is
missing rather than silently dropping it.

### Blocked is a hard stop

The moment a blocker appears — a decision only the owner can make, an external dependency that
fails, a requirement that turns out to be contradictory, a gate that cannot legitimately pass —
move the ticket to `status/blocked`, comment on the issue with what blocked it and what you tried,
and stop.

**Do not design around a blocker.** Specifically, do not:

- lower a threshold, disable a lint rule or add a suppression to get green;
- skip, weaken or delete a test that is telling the truth;
- widen or narrow the ticket's scope to dodge the obstacle;
- start a different ticket to keep busy.

The owner decides how to proceed. A blocked ticket that sat still is a better outcome than an
unblocked one that got there by moving the goalposts.

## Commands

The forge is Codeberg, so the CLI is `tea`, not `gh`. It reads the repository from the git remote;
`tea login list` shows whether this machine is authenticated.

```shell
# An idea you raised: create at intake, then stop and wait for approval
tea issues create --labels status/intake --title "..." --description "..."

# A ticket the owner asked for: skip intake, the asking was the approval
tea issues create --labels status/needs-refinement --title "..." --description "..."

# Move a ticket. The status labels are exclusive, so adding the new one drops
# the old one; there is no --remove-labels to pair with it.
tea issues edit <n> --add-labels status/todo
tea issues edit <n> --add-labels status/in-progress

# Closing. `tea issues close` takes no reason - Forgejo has none - so the
# distinction between finished and declined lives entirely in `wontfix`.
tea issues edit <n> --remove-labels status/in-progress && tea issues close <n>
tea issues edit <n> --remove-labels status/intake --add-labels wontfix && tea issues close <n>

# Type, when it is genuinely one or the other
tea issues edit <n> --add-labels bug

# See the board
tea issues list --labels status/todo
tea issues list --labels status/in-progress       # what is actually being worked on
tea pulls list --state open                       # what is waiting on the owner
tea issues list --state all --output json

# Comment when a status change needs explaining
tea comment <n> "..."
```

Creating the `status/*` labels needs the API rather than `tea labels create`, which has no flag for
exclusivity:

```shell
# {owner} and {repo} are filled in from the current repository. A request with a
# body defaults to POST, so no --method is needed.
tea api "repos/{owner}/{repo}/labels" \
  -d '{"name":"status/todo","color":"#0e8a16","exclusive":true}'
```

### Two Codeberg limits worth knowing before you hit them

**Issue creation is rate limited to 17 in 5 minutes.** Creating issues in bulk — a batch of intake
tickets, a migration — must be paced at roughly one every 20 seconds or the API starts returning
`NewIssue: ... rate limited` mid-run. Ordinary single-ticket work never notices this.

**The token cannot create or delete repositories.** Those endpoints require the `write:user` scope,
which this project's token deliberately does not carry: the ticket workflow never needs it, and a
standing credential that can delete repositories is a poor trade for saving a manual step. Create
and delete repositories in the web interface.

Never leave an **open** issue with no `status/*` label, and never leave a **closed** one carrying a
`status/*` label at all. Two statuses at once is no longer possible — the scope is exclusive — so
the only failure left is the absent one. If you find an issue in either state, say so rather than
guessing which is right.

## What each status actually involves

**Intake.** A short problem or idea statement, and **only for ideas you raise yourself**. Do not
research, do not design, do not estimate. Create it and stop. Discoveries made mid-ticket — a bug
noticed in passing, a gap in the spec — belong here, not in the ticket you are working on. A ticket
the owner asked for does not pass through here; create it at `status/needs-refinement`.

**Refinement.** Research properly: read the relevant code, check the design of record, resolve open
questions with the owner. Finish by rewriting the issue body to hold the problem, the approach,
explicit acceptance criteria, and anything deliberately out of scope. Refinement is over when
nothing about the ticket is still fuzzy — not when you have run out of patience with it.

**Ready.** Work may begin, and nobody has begun it. **"May begin" is not "begin":** a ticket at
`status/todo` waits for the owner to say start it. Naming it as next is the whole job until then,
and an offer to start that went unanswered is not an answer. See the loop below.

**In progress.** The branch exists. Everything from cutting it to opening the pull request happens
under this label — design, plan and implementation alike. A ticket sitting here with no commits for
days is the signal it is meant to give: work was started and left.

**Review.** The pull request is open and linked to the issue with `Closes #<n>`. Nothing further
happens on the ticket until the owner responds.

**Done.** The owner has confirmed the merge. The issue is closed and keeps the label.

**Blocked.** Nothing happens until the owner responds.

**Declined.** The owner rejected the intake. The issue is closed and keeps the label, so the idea
is not redrafted later.

## The superpowers loop, from "Ready" to "Review"

1. **`superpowers:brainstorming`** — before any code, when an issue needs design the spec does not
   already settle. Most tickets do not: the design of record answers them and the acceptance
   criteria are the only open work. **A ticket that puts something new on screen is never one of
   those** — see *When a ticket changes the UI* below.
2. **`superpowers:using-git-worktrees`** — after design approval. **Standing decision for this
   repo: branch in place, no worktree.** Compose derives its project name from the directory, so a
   worktree gets its own images and volumes and rebuilds everything from cold. Invoke the skill,
   then apply this decision unless a ticket genuinely needs the isolation. Branch name:
   `issue-<n>-<short-slug>`. **Move the ticket to `status/in-progress` in the same breath as
   creating the branch** — that is the trigger, and a branch that exists under `status/todo` is the
   exact ambiguity the label was added to remove. The decision is settled: the owner dropped the
   plan to make worktrees cheap on 2026-09-16 and does not intend to use them.
3. **`superpowers:writing-plans`** — turns the acceptance criteria into a plan under
   `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`, decomposed into bite-sized tasks with exact file
   paths, complete code and verification steps. New plans and specs open with a **Date**,
   **Supersedes** and **Superseded by** header, so which document is current never has to be
   inferred from filenames. Existing documents are not retrofitted.
4. **`superpowers:subagent-driven-development`** — executes the plan with a fresh subagent per task
   and a two-stage review after each. `superpowers:executing-plans` is the batched alternative when
   human checkpoints are wanted instead.
5. **`superpowers:test-driven-development`** — governs every implementation task. RED before GREEN,
   and the failing output belongs in the task report; a task that cannot show it is not done.
6. **`superpowers:requesting-code-review`** — between tasks and again before merge.
7. **`superpowers:finishing-a-development-branch`** — verifies the suite, presents the integration
   options, pushes and opens the pull request. The ticket keeps `status/in-progress` — the open
   pull request is the review state — so there is no label to move. Then stop.

### When a ticket changes the UI

**A ticket that changes the interface in a way the current design does not already define starts
with an interactive design session, not with a plan.** Settle it with the owner first, write the
outcome into the ticket's design document, and plan from there.

**The test is narrow and it is about drawings, not about judgement.** Ask of every screen change:
does the visual design language, the ticket's own design document, or the prototype at
`docs/superpowers/prototypes/` already show this? If yes, build what is drawn. If no — a new
control, a control moved, a new report, a new state a mark has to express, a row gaining a fourth
thing where three were drawn sharing one height — the design does not cover it and a session is due.
**Reasoning your way to what the designer would probably have wanted is exactly what this rule
exists to stop.** It happened on #10: the fetch control was written into a design document as
joining Week's three-control row, and the prototype's own caption calls those three out as sharing
one height.

**"Interactive" means the local browser companion**, per the standing decision recorded in the
handoff: `superpowers:brainstorming`'s `scripts/start-server.sh --project-dir <repo> --open`, with
screens written into the session's `content/` directory. Options go up side by side and the owner
picks. **Never a cloud artifact, and never a canvas** — that was settled on 2026-09-03.

Two things this does not mean. It is not a session per ticket: a ticket that only rewires what is
already drawn goes straight to planning as before. And it is not licence to redesign — the session
covers the thing the ticket puts on screen, and anything else it turns up becomes an intake ticket
like any other finding.

### And what is already drawn is verified against the drawing

The session above is for UI the design does not cover. **Where the design does cover it, the work is
checked against it before anyone reports done** — by the implementer, and again by the reviewer, who
verifies rather than accepts the claim.

**Every dispatch that puts something on screen names the drawing as required reading**: the
prototype at `docs/superpowers/prototypes/`, the visual language spec, and the ticket's own design
document where it has one. The implementer says in its report *what it compared and what it found*.
"Looks right" is not a comparison. A reviewer that cannot see the comparison in the report treats
that as a finding, not as a detail.

**A difference the ticket forces goes to the owner, and the design is updated.** Not absorbed
silently, not left for someone to notice later. The ticket is allowed to change the design — it is
not allowed to change it in secret, because the next ticket reads the drawing and not the diff.

**And the pull request shows it.** A ticket that changes the interface **attaches screenshots of what
it built**, so the owner sees the change rather than reading a description of it. Asked for on
2026-09-21.

```shell
.claude/tools/pr-attach.sh <pr-number> shots/*.png     # prints the markdown to paste
```

They are **attachments, not repository files.** Forgejo serves them from its own store, so a
screenshot never enters a repository whose own budget is measured in kilobytes, and it dies with the
pull request rather than outliving it. `tea` cannot do this — `tea api` sends JSON only and an
attachment needs a multipart POST — which is why the script exists.

Three things that cost time the first time, on #8:

- **Write the files somewhere the host can see.** A Playwright spec writing to `/tmp` writes to the
  *container's* `/tmp`, which vanishes with it — and the previous run's files are still sitting on
  the host, so the capture looks like it worked. `.claude/e2e` is the only host-visible mount; write
  to `/e2e/test-results/shots/` and copy them out.
- **Capture at rest.** A screenshot taken straight after a click catches the control hovered or
  focused, which on #8 meant the stop button photographed primary-pink instead of its running green.
  Park the pointer and blur before shooting, or the picture shows a state the design never described.
- **Name each file for what it shows** — the script uses the file name as alt text, and a pull
  request full of `screenshot-1.png` helps nobody.

Delete the capture spec afterwards and commit neither it nor the images.

**This does not replace the written comparison above.** A screenshot shows what was built; it does
not say what it was checked against. A reviewer still needs that sentence.

**Why this is a rule and not an instinct.** On 2026-09-08, reading Week's header for an unrelated
reason turned up two things the prototype draws that the app never built: the card around the week
grid, and a refresh control. Neither was caught by a test, a review, or a gate — #95 shipped the
second edition across Today and Week through six task reviews and a whole-branch review, and both
gaps went through all of them. That is #117, and the reason its first job is an audit is that
nobody knows how many more there are.

**One issue, one branch, one pull request.** The pull request body references the issue with
`Closes #<n>`, and the open pull request is what puts the ticket into review.

**A branch that builds on another open branch is stacked, and so is its pull request.** When a ticket
has to be cut from another ticket's unmerged branch, usually because both rewrite the same code, its
pull request takes **that branch as its base, not `main`**, so its diff shows only its own commits.
The body opens with `Stacked on #<parent PR>` and says what merging does. The owner merges the child
into the parent branch, and the parent's pull request then carries both to `main`. If the parent
merges first, retarget the child to `main`:

```shell
tea api --method PATCH "repos/{owner}/{repo}/pulls/<n>" -d '{"base":"main"}'
```

`Closes #<n>` fires only when the work reaches `main`, so a stacked ticket closes when its parent's
pull request merges, and its `status/*` label comes off then. Asked for by the owner on 2026-09-18,
after PR #162 (#19) was opened against `main` while built on #157's branch, and its diff carried
#79's commits too.

**Use the skills' own prompt templates.** `subagent-driven-development` ships
`implementer-prompt.md`, `task-reviewer-prompt.md` and `re-review-prompt.md`;
`requesting-code-review` ships `code-reviewer.md`. Read the template before dispatching. Ticket 1
was run with hand-written prompts instead — it worked, but it threw away accumulated wording for no
benefit and made every dispatch a fresh invention.

**Tick the ticket's acceptance criteria as the reviews confirm them**, and untick anything a later
pass shows has regressed. Asked for by the owner on 2026-09-09, during #117. **The tick follows a
review, never an implementer's claim** — that is the whole point of it, and it is why the criteria
become live state rather than a checklist filled in at the end. Do it per task, not in one sweep
when the branch is finished.

The body round-trips through the API; verify the round trip before trusting it:

```shell
tea api "repos/{owner}/{repo}/issues/<n>" | python3 -c "import sys,json;print(json.load(sys.stdin)['body'])" > /tmp/<n>.md
# edit /tmp/<n>.md
tea api --method PATCH "repos/{owner}/{repo}/issues/<n>" -F body=@/tmp/<n>.md
```

**A progress update leads with the ledger** — done, running, left — and goes out **when a task
actually moves**: dispatched, returned for review, in or out of a fix round, or complete. Not in
every message. An unchanged ledger repeated is noise, and it trains the reader to skip the one line
that carries the state.

**The whole-branch review is not optional.** All seven of ticket 1's task reviews passed while the
branch still contained a Critical defect — `docker compose up` served a 404 on a fresh clone —
because every task diff was individually correct and only a cross-task read could see it.

`make verify` must be green before the pull request is opened, and `make test-e2e` too when the
change touches the frontend or the rig. Paste the output. See
`superpowers:verification-before-completion` — evidence before assertions, always.

## Keeping the handoff current

The handoff is two things, and which one you write to depends on what you are recording.

| File | Holds | Shape |
|---|---|---|
| `docs/superpowers/plans/handoff.md` | Where things stand, decisions not to reopen, facts not to rediscover, what is still open, environment notes | Current state, **edited in place**. No dated entries. |
| `docs/superpowers/plans/handoff/YYYY-MM-DD.md` | The day's narrative — what was done, what it turned up, what it cost | Append-only, one file per day |

`handoff.md` is what a session on another machine resumes from, and it is the one that must always
be read. Update it when a ticket changes status, when a decision is taken that a later session
should not reopen, or when work stops mid-flight. It is a project-design document, so it needs no
ticket.

**Write the day's narrative to `handoff/<today>.md`, and promote from it the same day.** Anything a
later session must not rediscover — a decision, a fact, a change in what is open — belongs in
`handoff.md` too, not only in the day's file. A daily file is the audit trail; it is never the
thing that has to be read to know where the project stands.

Two reasons it is split this way, both worth not relitigating. Current state has to be reconcilable
at a glance: a decision taken one day and reversed the next must be *one* edited line, not two
entries in two files with nothing saying which wins. And every session used to append to the same
region of the same file — the `2026-08-31` entry records a merge conflict caused by exactly that.
Two machines working different days now never touch the same file.

**Edit it freely; push it once.** Handoff edits accumulate on a local branch and go out as a single
pull request when the owner signals they are shutting down for the day. **That pull request's title
is prefixed `[Handoff]`** — the rule and its reason live in the `eod` skill. Do not push a branch or
open a pull request for an individual handoff edit — one pull request per touch-up bloats the
history and the pull request list for no gain. Keep writing to both files as things change; just
hold the push until the end-of-day signal.

This applies to the handoff alone. Product pull requests still go out per ticket, when the ticket
is finished — never batched, never held.
