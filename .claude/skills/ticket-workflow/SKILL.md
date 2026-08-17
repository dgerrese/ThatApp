---
name: ticket-workflow
description: Use when starting any work in this repo, creating or refining a GitHub issue, moving a ticket between statuses, opening a pull request, or the moment a blocker appears. Holds the ticket lifecycle, the label mechanics and the superpowers loop that runs underneath it.
---

# Ticket workflow

Work in this repository is tracked as GitHub issues in `dgerrese/work-dashboard`, and every change
to the product arrives through a pull request tied to one. This skill holds the mechanics. The
rules come from the project owner and are not open to reinterpretation.

## Does this need a ticket?

**Yes** — for everything that changes the product: Go and TypeScript source, the SQLite schema, the
`/api/*` surface, `WD_*` configuration, Docker and Compose, CI workflows, dependencies, and the
design of record under `docs/superpowers/specs/`.

**No** — only for *project design*: `CLAUDE.md`, `.claude/**` (skills, the e2e rig's own process
docs), and repository-process documents such as the handoff. These may go in their own pull request
with no issue behind them, on a branch named for the topic rather than an issue number.

The distinction is how the project is *run* versus how the product *works*. A spec describing push
semantics needs a ticket; a change to this skill does not. When a change touches both, split it.

## The seven statuses

Status lives in a label. **Exactly one `status:*` label per issue, always.** The label is the
source of truth — not a board, not a comment, not a checklist. It applies to closed issues too:
`status:done` and `status:declined` are how a closed issue says which kind of closed it is.

| Status | Label | Who moves it | Meaning |
|---|---|---|---|
| Intake | `status:intake` | You create it here | A raw problem or idea, a few sentences. Nothing else happens yet. |
| Refinement | `status:refinement` | **Owner only** | The intake was approved. Research and refine until nothing is fuzzy. |
| Ready | `status:ready` | You, when refinement is genuinely finished | Acceptance criteria are complete and unambiguous. Work may start. |
| Review | `status:review` | You, when the pull request is open | Implementation is done, pull request raised, awaiting the owner's review. |
| Done | `status:done` | You, **only after the owner says it merged** | Finished. |
| Blocked | `status:blocked` | You, immediately, from any status | A blocker exists. Work stops. |
| Declined | `status:declined` | **Owner only** | The intake was rejected. Kept so the idea is not redrafted later. |

Opening the pull request is what moves a ticket to `status:review`, and it is the last move you
make on it unaided.

### Transitions you may never make yourself

- **Intake → Refinement.** The owner approves an intake ticket. Create it, then stop and ask.
- **Intake → Declined.** The owner declines ideas that are not wanted. Never pre-empt it.
- **Review → Done.** Only when the owner states the pull request is approved and merged. A green
  `make verify`, a passing CI run, an approving review, a closed pull request and a branch that
  looks merged are none of them that signal. The owner saying so is the signal.

**Merging into `main` locally is forbidden outright** — a hard constraint in `CLAUDE.md`, not a
preference. A branch reaches `main` through a pull request the owner merges and no other way, no
matter how green or how small it is. `superpowers:finishing-a-development-branch` offers "merge back
to main locally" as its first option; in this repo that option does not exist. Present only the
other two — push and open a pull request, or leave the branch as it is — and say why the third is
missing rather than silently dropping it.

### Blocked is a hard stop

The moment a blocker appears — a decision only the owner can make, an external dependency that
fails, a requirement that turns out to be contradictory, a gate that cannot legitimately pass —
move the ticket to `status:blocked`, comment on the issue with what blocked it and what you tried,
and stop.

**Do not design around a blocker.** Specifically, do not:

- lower a threshold, disable a lint rule or add a suppression to get green;
- skip, weaken or delete a test that is telling the truth;
- widen or narrow the ticket's scope to dodge the obstacle;
- start a different ticket to keep busy.

The owner decides how to proceed. A blocked ticket that sat still is a better outcome than an
unblocked one that got there by moving the goalposts.

## Commands

```shell
# Create an intake ticket, then stop and wait for approval
gh issue create --label status:intake --title "..." --body "..."

# Move a ticket (always remove the old label in the same call)
gh issue edit <n> --remove-label status:refinement --add-label status:ready
gh issue edit <n> --remove-label status:ready --add-label status:review

# See the board
gh issue list --label status:ready
gh issue list --state all --json number,title,labels

# Comment when a status change needs explaining
gh issue comment <n> --body "..."
```

Never leave an issue with two `status:*` labels or none. If you find one in that state, say so
rather than guessing which is right.

## What each status actually involves

**Intake.** A short problem or idea statement. Do not research, do not design, do not estimate.
Create it and stop. Discoveries made mid-ticket — a bug noticed in passing, a gap in the spec —
belong here, not in the ticket you are working on.

**Refinement.** Research properly: read the relevant code, check the design of record, resolve open
questions with the owner. Finish by rewriting the issue body to hold the problem, the approach,
explicit acceptance criteria, and anything deliberately out of scope. Refinement is over when
nothing about the ticket is still fuzzy — not when you have run out of patience with it.

**Ready.** Work may begin. See the loop below.

**Review.** The pull request is open and linked to the issue with `Closes #<n>`. Nothing further
happens on the ticket until the owner responds.

**Done.** The owner has confirmed the merge. The issue is closed and keeps the label.

**Blocked.** Nothing happens until the owner responds.

**Declined.** The owner rejected the intake. The issue is closed and keeps the label, so the idea
is not redrafted later.

## The superpowers loop, inside "Ready"

1. **`superpowers:brainstorming`** — before any code, when an issue needs design the spec does not
   already settle. Most tickets do not: the design of record answers them and the acceptance
   criteria are the only open work.
2. **`superpowers:using-git-worktrees`** — after design approval. **Standing decision for this
   repo: branch in place, no worktree.** Compose derives its project name from the directory, so a
   worktree gets its own images and volumes and rebuilds everything from cold. Invoke the skill,
   then apply this decision unless a ticket genuinely needs the isolation. Branch name:
   `issue-<n>-<short-slug>`. *This decision is due to flip* — see the handoff's "Still open".
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
   options, pushes and opens the pull request. Move the ticket to `status:review` in the same
   breath, then stop.

**One issue, one branch, one pull request.** The pull request body references the issue with
`Closes #<n>`, and opening it is what puts the ticket into `status:review`.

**Use the skills' own prompt templates.** `subagent-driven-development` ships
`implementer-prompt.md`, `task-reviewer-prompt.md` and `re-review-prompt.md`;
`requesting-code-review` ships `code-reviewer.md`. Read the template before dispatching. Ticket 1
was run with hand-written prompts instead — it worked, but it threw away accumulated wording for no
benefit and made every dispatch a fresh invention.

**The whole-branch review is not optional.** All seven of ticket 1's task reviews passed while the
branch still contained a Critical defect — `docker compose up` served a 404 on a fresh clone —
because every task diff was individually correct and only a cross-task read could see it.

`make verify` must be green before the pull request is opened, and `make test-e2e` too when the
change touches the frontend or the rig. Paste the output. See
`superpowers:verification-before-completion` — evidence before assertions, always.

## Keeping the handoff current

`docs/superpowers/plans/2026-08-12-handoff.md` is what a session on another machine resumes from.
Update it when a ticket changes status, when a decision is taken that a later session should not
reopen, or when work stops mid-flight. It is a project-design document, so it needs no ticket.

**Edit it freely; push it once.** Handoff edits accumulate on a local branch and go out as a single
pull request when the owner signals they are shutting down for the day. Do not push a branch or
open a pull request for an individual handoff edit — one pull request per touch-up bloats the
history and the pull request list for no gain. Keep writing to the file as things change; just hold
the push until the end-of-day signal.

This applies to the handoff alone. Product pull requests still go out per ticket, when the ticket
is finished — never batched, never held.
