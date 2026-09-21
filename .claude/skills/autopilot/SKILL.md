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
2. Resolve the milestone. **Never hardcode a name** — `v1` will not exist forever:

   ```shell
   # the active milestone: the oldest still open
   tea api "repos/{owner}/{repo}/milestones?state=open" \
     | python3 -c "import sys,json;print(sorted(json.load(sys.stdin),key=lambda m:m['id'])[0]['title'])"
   ```

   The owner may name one instead ("work the board on v2"); that wins.
3. List that milestone's `status/todo` tickets and order them: `priority/high`, then unlabelled,
   then `priority/low`, and **inside a band a `bug` comes before a non-bug**.
4. Post the queue as the opening ledger, in the order it will be worked.

**No open milestone, or no `status/todo` in it:** say so and stop. Do not refine one to refill the
queue, and do not roll into the next milestone — a run is one milestone.

## The loop

Take the top ticket, run `ticket-workflow` from Ready to Review, open the pull request, write the
day's handoff file, take the next.

**One ticket is in flight at a time.** Branch-in-place is the standing decision here, so a second
ticket would need a worktree, which the owner dropped on 2026-09-16. While an implementer or
reviewer subagent runs, the controller works only on *that* ticket or on the run's own bookkeeping —
reading the next ticket's body, the ledger, the handoff. It does not start a second ticket to fill
the wait.

The run ends when the milestone has no `status/todo` left, or when the owner ends it.

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
`tea comment` on the ticket it came from. The day file is what the owner reads back; the comment is
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

- **Shipped:** each ticket with its pull request number.
- **Blocked:** each ticket with the one-line reason.
- **Parked:** every question, with which ticket it belongs to.
- **Left:** what remains in the milestone and why the run could not take it.

Then stop. Do not run `eod` off the back of it — the owner signals that separately.

## Red flags

| Thought | Reality |
|---|---|
| "The queue is empty, v2 has plenty" | A run is one milestone. Report and stop. |
| "This ticket needs one small design decision — I can infer it" | A drawing you cannot point at is a blocker. Block it. |
| "This `needs-refinement` ticket is nearly refined already" | Refinement is attended work. Leave it. |
| "The branch is green and the owner would obviously merge it" | The merge is the owner's, always. |
| "Two tickets at once would finish the board today" | One in flight. Branch-in-place makes a second one a worktree. |
| "I'll ask and wait for the answer" | Nothing waits on an absent owner. Park it and carry on, or block. |
| "Second blocker in a row — something's wrong, I should stop" | Blockers park tickets. Only an empty queue or the owner ends a run. |
| "I'll note the parked question in the report at the end" | The day file and the ticket comment, when it is parked. A session can die. |
