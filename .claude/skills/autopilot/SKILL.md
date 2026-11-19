---
name: autopilot
description: Use when the owner hands the board over and leaves — "work the board", "pick up tickets on your own", "carry on without me", "keep going while I'm out", or naming a milestone to run through. Also use once a run is under way and a question, a blocker or a finished ticket has to be handled with nobody there to ask.
---

# Autopilot

An **autonomous run**: the session picks tickets off the board itself, ships each one to an open
pull request, and keeps going until the milestone has nothing left it may take.

**This skill changes nothing about how a ticket is built.** `ticket-workflow` governs that, and it
governs it unaltered — branch in place, plan, subagent implementer under TDD, task review,
whole-branch review, the gates re-run on the head, then the pull request. **REQUIRED BACKGROUND:
`ticket-workflow`.** Autopilot answers only the three things that skill leaves to a human in the
room: *which ticket*, *what to do when the owner is absent*, and *when to stop*.

**The owner starts a run. You never do.** Offering one is fine; assuming one is not. Outside a run
that the owner opened, every rule here is inert and `CLAUDE.md` reads as written.

## Preflight

1. Read `docs/superpowers/plans/handoff.md`.
2. Resolve the milestone. **The owner names it** when they start the run ("work the board on
   Releases"). Milestones are feature sets, none of them the active one, so a run with no name asks
   which one and does not start until it has the answer. Set by the owner on 2026-10-26, when `v1`
   and `v2` were retired for feature milestones.
3. List that milestone's `status/in-progress` **and** `status/todo` tickets. **In-progress comes
   first: finish what is started before starting anything new.** Order each group the same way:
   `priority/high`, then unlabelled, then `priority/low`, and **inside a band a `bug` comes before a
   non-bug**. Set by the owner on 2026-09-21, mid-run, when the run walked past [CB#83](../../../docs/archive/codeberg/83.md) and CB#8 — the
   board's two highest-priority tickets, both in progress with branches pushed. The rule sat in that
   day's narrative and never reached this skill, so the 2026-09-30 run walked past CB#123 the same way.
4. Post the queue as the opening ledger, in the order it will be worked.

**An in-progress ticket is resumed, not restarted.** Its branch and anything already on it — a
design, a plan, commits — are where the run picks up, at the stage the ticket reached. Read its
comments and the handoff for what the last session left open.

**No open milestone, or nothing in-progress or to-do in it:** say so and stop. Do not refine one to refill the
queue, and do not roll into the next milestone — a run is one milestone.

## The loop

Take the top ticket, run `ticket-workflow` from Ready to Review, open the pull request, write the
day's handoff file, take the next.

**One ticket is in flight at a time.** Branch-in-place is the standing decision here, so a second
ticket would need a worktree, which the owner dropped on 2026-09-16. While an implementer or
reviewer subagent runs, the controller works only on *that* ticket or on the run's own bookkeeping —
reading the next ticket's body, the ledger, the handoff. It does not start a second ticket to fill
the wait.

**A ticket whose work needs another ticket's unmerged branch is stacked, not parked.** Cut its
branch from that branch and base its pull request there — `ticket-workflow` has the mechanics. The
run neither skips such a ticket nor waits for the parent to merge, because waiting means waiting for
the owner, which is the one thing a run cannot do. A run leaves stacks behind by construction: it
ships faster than the owner merges, so by the fifth ticket the branch that a sixth needs is very
often still open.

The run ends when the milestone has no `status/in-progress` or `status/todo` left that the run can
take, or when the owner ends it.

## When the owner is not there

Four rules, and they apply only inside a run.

**A blocker stops the ticket, not the run.** Move it to `status/blocked`, comment with what blocked
it and what was tried, and take the next ticket. **This overrides `CLAUDE.md`'s "do not pick up
another ticket to stay busy"**, which was written for an attended session where stopping puts the
problem in front of the owner within minutes. In a run there is nobody to stop *for*: the blocked
ticket is already parked and reported, and halting eleven tickets behind it buys nothing. Everything
else about blocking is unchanged — do not lower a threshold, skip a test, or reshape the scope to
get past it.

**A question whose answer would change what gets built is a blocker.** Block the ticket and move on.
A UI ticket with nothing drawn lands here by definition: a design session is the owner's, and
reasoning out what the designer would probably have wanted is the thing `ticket-workflow` forbids.

**A question whose answer would not change what gets built does not stop anything.** Take the most
conservative reading, record it in the pull request body and the day file as a decision the owner
may reverse, and ship. Wording, whether a finding becomes its own ticket, which of two equivalent
names — these are review-time conversations, not blockers.

**Every parked question goes to two places:** `docs/superpowers/plans/handoff/<today>.md`, and a
`gh issue comment` on the ticket it came from. The day file is what the owner reads back; the comment is
what survives on the forge when the session is gone. Post it in chat as well when it arises — the
owner may be reading.

## Never, inside a run

- merge, or close an issue;
- approve or decline an intake;
- set or change a `priority/*` label;
- refine a `status/needs-refinement` ticket — refinement is attended work;
- hold a design session;
- push anything but the ticket branches. The handoff waits for `eod`, as always.

## The closing report

- **Shipped:** each ticket with its pull request number, and for a stacked one, the pull request it
  is based on — the owner is about to merge these in some order, and only the run knows which order
  is forced.
- **Blocked:** each ticket with the one-line reason.
- **Parked:** every question, with which ticket it belongs to.
- **Left:** what remains in the milestone and why the run could not take it.

Then stop. Do not run `eod` off the back of it — the owner signals that separately.

## Red flags

| Thought | Reality |
|---|---|
| "It's in progress, so someone else has it" | In-progress goes first. Resume it from its branch. |
| "The queue is empty, another milestone has plenty" | A run is one milestone. Report and stop. |
| "This ticket needs one small design decision — I can infer it" | A drawing you cannot point at is a blocker. Block it. |
| "This `needs-refinement` ticket is nearly refined already" | Refinement is attended work. Leave it. |
| "The branch is green and the owner would obviously merge it" | The merge is the owner's, always. |
| "Two tickets at once would finish the board today" | One in flight. Branch-in-place makes a second one a worktree. |
| "I'll ask and wait for the answer" | Nothing waits on an absent owner. Park it and carry on, or block. |
| "Second blocker in a row — something's wrong, I should stop" | Blockers park tickets. Only an empty queue or the owner ends a run. |
| "I'll note the parked question in the report at the end" | The day file and the ticket comment, when it is parked. A session can die. |
