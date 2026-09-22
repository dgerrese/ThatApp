---
name: eod
description: Use when the owner signals the end of the working day — "eod", "that's me for today", "shutting down", "wrapping up" — or whenever a session must leave this machine in a state another session can resume from without asking anyone anything.
---

# End of day

The end of the day is a **signal that propagates**, not a checklist you run alone. Subagents are
told to wrap up and report; their reports become part of the handoff. Then nothing is left running,
nothing exists only on this machine, and `handoff.md` is true.

**The one-sentence test:** if this machine died overnight, could a session on another one pick the
work up from the forge and the handoff alone? Everything below serves that.

## The order is fixed

Each phase depends on the one before it. Running them out of order produces a handoff that
describes a state that no longer exists.

| # | Phase | Why it must come here |
|---|---|---|
| 1 | Signal the subagents | Their reports are an input to the handoff, and the tree keeps changing until they stop. |
| 2 | Survey | Only meaningful once the agents have settled. |
| 3 | Handoff | Needs the reports from 1 and the facts from 2. |
| 4 | Push | The handoff commit from 3 is one of the things being pushed. |
| 5 | Teardown | Last, so nothing recreates what you tore down. |
| 6 | Report | What is left for the owner, after everything that could be done was. |

---

## Phase 1 — Signal the subagents

`ListAgents`. Signal every **in-process subagent this session spawned**. Nothing else.

Send each one this, with `SendMessage`:

> End of day. Stop at the next safe point — finish the step you are on, start no new one. Do not
> stop mid-edit: either complete the commit you were heading for, or leave the files uncommitted and
> say so plainly below.
>
> If you spawned subagents of your own, send them this same signal and fold their reports into
> yours.
>
> Reply with exactly this and nothing else:
> - **Task:** the ticket and task you were on
> - **State:** the state you actually reached — RED written / GREEN passing / committed / reviewed
> - **Files:** what you touched, and whether it is committed
> - **Do not rediscover:** anything you learned that a later session would otherwise work out again
> - **Next:** what the next session should pick up first

**Propagation has to travel in the message.** `ListAgents` sees only this session's own children — a
subagent that spawned its own is invisible from here. The instruction to pass the signal down is the
only thing that reaches the whole tree.

Wait for replies, but not forever: **give them about two minutes.** An agent that does not answer is
recorded in the handoff as *signalled, did not report* — that is information, not a failure to hide.

**Never signal a peer session.** `ListAgents` also lists other Claude sessions, often on entirely
different projects. Reaching into those is not propagation, it is interference. List them in the
report; leave them alone.

**Never stop a `Workflow` run.** Stopping one discards a lot of parallel work. Report it and let the
owner decide.

---

## Phase 2 — Survey

Read-only. Gather everything before changing anything, so the report survives an early stop.

```shell
git status --porcelain              # uncommitted work
git worktree list                   # a second entry is an anomaly: this repo branches in place
docker compose ps                   # what is running
tea pulls list --state open         # what waits on the owner
```

**Label integrity** — an open issue must carry exactly one `status/*`, a closed one none:

```shell
for st in open closed; do
  tea issues list --state $st --output json | python3 -c "
import json,sys
d=json.load(sys.stdin); want_one = '$st' == 'open'
bad=[(i['index'], [l for l in i.get('labels','').split() if l.startswith('status/')] or ['(none)'])
     for i in d
     if (len([l for l in i.get('labels','').split() if l.startswith('status/')]) != (1 if want_one else 0))]
print('$st:', len(d), 'issues, anomalies:', bad or 'none')"
done
```

`tea`'s JSON is not the shape you would guess, and guessing wrong fails silently: **`labels` is a
single space-separated string, not an array of objects, and the issue number is `index`, not
`number`.** Both established on 2026-09-01.

Branch state, which the rest of the skill depends on:

```shell
for b in $(git for-each-ref --format='%(refname:short)' refs/heads/); do
  unmerged=$(git rev-list --count codeberg/main..$b)
  if git ls-remote --exit-code --heads codeberg "$b" >/dev/null 2>&1; then
    [ "$(git ls-remote --heads codeberg "$b" | cut -f1)" = "$(git rev-parse "$b")" ] \
      && state=in-sync || state=DIVERGED
  else
    state=absent
  fi
  echo "$b unmerged=$unmerged remote=$state"
done
```

**Label integrity:** an open issue carrying no `status/*` label, or a closed one still carrying one.
Both are report lines, never fixes — see *What this never does*.

### The stop condition

**A dirty working tree stops the run**, after securing it and before the handoff. Switching branches
over someone's uncommitted work, or inventing a commit message for it, is a judgement about their
work that a shutdown routine has no business making.

Secure it first, so the rule that nothing lives only on this machine still holds:

```shell
tmp=$(mktemp -u /tmp/eod-index.XXXXXX)
GIT_INDEX_FILE="$tmp" git read-tree HEAD
GIT_INDEX_FILE="$tmp" git add -A                       # everything, untracked included
tree=$(GIT_INDEX_FILE="$tmp" git write-tree)
snap=$(git commit-tree "$tree" -p HEAD -m "eod snapshot $(date +%F)")
rm -f "$tmp"

[ -n "$snap" ] || { echo "no snapshot built — do not push"; exit 1; }
git push codeberg "$snap:refs/eod/$(date +%F)/$(git branch --show-current)"
```

**Do not use `git stash create` here.** It looks like the obvious tool and it silently drops every
untracked file — a brand-new module, a new test file, an entire new directory. Measured on
2026-09-01: with one tracked edit and one untracked file present, `git stash create` produced a
commit containing **zero** of the untracked work. Worse, when the *only* changes are untracked it
returns an empty string, and `"$snap:refs/..."` then collapses to `":refs/..."` — which is git's
refspec for **deleting** the remote ref. Hence the emptiness guard above; keep it.

The temp index is what makes this safe: `GIT_INDEX_FILE` points `git add -A` at a throwaway index,
so the real index and the working tree are never touched. Verified on 2026-09-01 — the snapshot
captured the tracked edit, the untracked file and an untracked directory, and `git status` was
byte-identical before and after.

`refs/eod/*` is a plain ref, not a branch: nothing enters branch history, nothing appears in the
branch list, and the working tree is exactly as the owner left it. Codeberg accepts the namespace —
verified on 2026-09-01 by pushing and deleting a probe ref.

Then **halt.** Report the snapshot ref, name every uncommitted file, and say the handoff was not
written. The owner resolves it and re-runs. A half-applied subagent task is the usual cause — say so,
so the diagnosis is not rediscovered.

---

## Phase 3 — The handoff

Two files, and the split between them is not negotiable — see `CLAUDE.md`.

**`docs/superpowers/plans/handoff/<today>.md`** — the day's narrative, append-only, plus every
subagent report from Phase 1 verbatim.

**`docs/superpowers/plans/handoff.md`** — current state, edited in place, no dated entries. Promote
anything a later session must not rediscover, on the day it happens.

`<today>` is the **host's local date**, `date +%F`. Deliberately not the container's clock, which is
UTC and would file a late-evening session under tomorrow.

### Verify handoff.md before committing it

The resume document being wrong is the most expensive failure available, and it has happened: on
2026-09-01 the file still claimed *"PR #78 is open and waiting on the owner"* and *"`handoff-2026-09-01`
carries three unpushed commits"* — both false, because the forge move had not carried the pull
requests across.

So every sentence in `handoff.md` naming **an open pull request, a branch, or a commit count** gets
checked against Phase 2's output before the commit. Correct what has rotted. This is the one place
the skill edits prose it did not write.

Then commit on `handoff-<today>`, cut from `codeberg/main`, reusing it if it already exists.

---

## Phase 4 — Push everything

After this phase, **no work exists only on this machine.** "Unpushed branches" is therefore not a
finding — if one appears in the report, this phase failed and that is an error to raise, not an item
for the owner's list.

**Push a branch when it has at least one commit not in `codeberg/main` and its remote is `absent` or
`DIVERGED`.** A branch whose commits are all contained in `main` holds nothing at risk; pushing it
manufactures a remote branch for zero commits. Skipping it is the rule working, not a gap.

Open the pull request for **the handoff branch only**. Pushing is not opening a pull request:
a product branch goes to review when its ticket is done, which is a decision belonging to
`ticket-workflow`, not to the end of a day.

**Title it `[Handoff] <summary>`.** The prefix is what keeps the open pull request list readable:
a handoff carries no product change and asks for none of the review a ticket does, so the owner can
see in one pass which pull requests are waiting on a judgement and which are the day's record. The
prefix is on the title only — the body is unchanged, and the branch stays `handoff-<today>`.

### Four rules, each of which this project has already paid for

- **Never push `main`.** Local `main` is routinely stale — it sat on the pre-rename `d07f4ec` for
  weeks. Only the owner moves it. A naive "push everything" reaches for it first.
- **Retry once, then report.** A push can fail transiently: `Connection closed by ... port 22`,
  succeeding on an identical retry seconds later. Seen on 2026-09-01. One retry before declaring
  failure.
- **Never force.** A rejected non-fast-forward is reported. `--force-with-lease` is a decision the
  owner makes about a rebased branch, not a cleanup step.
- **Never change transport.** SSH authentication has failed twice on this machine (2026-08-17,
  2026-08-24). If it is down, say so loudly and stop claiming anything is safe. Do not fall back to
  HTTPS.

**A failed push is a handoff entry, not a terminal line.** Work stranded on this machine is exactly
what tomorrow's session must be told, and the terminal will be closed.

---

## Phase 5 — Teardown

**Order matters, and getting it wrong is silent.**

1. **Stop background Bash tasks first.** A backgrounded `make test-e2e` will cheerfully bring the
   whole e2e profile back up seconds after you tear it down, and the day ends with containers
   running and no explanation.
2. `docker compose --profile e2e down`
3. Confirm nothing still holds the stack's port. Read it rather than typing a number, because the
   released image may be running beside the dev stack on the default:

   ```shell
   ss -ltn | grep ":$(grep -E '^THAT_PORT=' .env | cut -d= -f2)"
   ```

**Never `make down` here.** That target is `docker compose --profile e2e down -v`, and the `-v`
drops the build and dependency caches by design — `npm ci`, `go mod download` and a Playwright
browser fetch before anything runs tomorrow. Correct after a Dockerfile change; wrong as a nightly
default. The bind-mounted database under `./data` survives either way (#73).

---

## Phase 6 — Report

What is left for the owner, with the command for each:

- Branches pushed but carrying **no pull request**
- Branches **fully merged** into `codeberg/main` and droppable — `git branch -d <name>`
- **Open pull requests** waiting on them
- **Label anomalies** — open issues with no `status/*`, closed ones still carrying one
- **Peer sessions** seen, and left alone
- **Stale SDD scratch** under `.superpowers/sdd/`, older than the most recent merge, with sizes and
  the `rm -rf` command. Gitignored, so no gate will ever mention it. Recent runs are not listed.

---

## What this never does

Every one of these is either a hard constraint in `CLAUDE.md` or a decision reserved to the owner.

| Never | Because |
|---|---|
| `git merge` onto `main`, or push `main` | Absolute in `CLAUDE.md`. Only the owner moves `main`. |
| Delete a branch | Droppable is reported. Deleting is the owner's word. |
| Force-push anything | A rejected push is information, not an obstacle. |
| Switch the remote to HTTPS | Auth failure is reported, never routed around. |
| Open a PR for a product branch | That is a ticket reaching review — `ticket-workflow` owns it. |
| Close, approve or relabel a ticket | The owner's alone. |
| `make down` | `-v` drops the caches. Use `docker compose --profile e2e down`. |
| Commit anything outside `docs/superpowers/plans/handoff*` | The handoff is the only thing this skill authors. |
| Stop a peer session or a `Workflow` run | Not this session's work to end. |
| Delete `.superpowers/` scratch | An SDD ledger was once the only record of #4's review findings. |

## Red flags — stop

| Thought | Reality |
|---|---|
| "That branch is only a plan commit, not worth pushing" | Unpushed is unpushed. It is one commit and one command. |
| "The subagent is nearly done, I'll just stop it" | `TaskStop` has no rollback. Files written stay, files pending do not. Signal it and wait. |
| "The tree is only a little dirty, I'll commit it" | Inventing a message for someone's half-finished work is a judgement. Snapshot and halt. |
| "`make down` is the existing target, so use it" | `-v` is the whole difference, and it costs tomorrow's first ten minutes. |
| "`main` is behind, I'll fast-forward it while I'm here" | Forbidden outright. Report it. |
| "The push failed, HTTPS would work" | Never. Two prior incidents; the answer both times was to report it. |
| "handoff.md was right this morning" | It said PR #78 was open for a week after that stopped being true. Check it. |
| "`git stash create` is the tool for snapshotting a dirty tree" | It drops untracked files, and returns empty when they are all it has. Use the temp index. |
| "No agents are running, so Phase 1 is a no-op" | Run `ListAgents` anyway. Peer sessions and workflow runs belong in the report. |
