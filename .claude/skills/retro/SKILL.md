---
name: retro
description: Use when the owner asks for a retrospective, a look back at finished tickets, a review of how the project is run, or what past work says should change about the workflow — and when a failure feels like one that has happened before.
---

# Retro

A retro turns things that already went wrong into changes to the rules. It reads finished work,
keeps only the failures that recurred or cost something, and puts each proposed rule change to the
owner one at a time.

**The handoff already records lessons as they happen. A retro exists for what a single session
cannot see: the same failure appearing in a second ticket, months apart, written down twice by two
sessions that never met.**

Two boundaries, both absolute:

- **A retro changes how the project is *run*, never what the product *does*.** Its edits reach
  `CLAUDE.md`, `.claude/**` and process documents. Anything it wants changed in Go, TypeScript,
  Docker, CI or the design of record is an intake ticket instead — the retro raises it and moves on.
- **The owner approves each proposal on its own.** Same rule as intake, for the same reason: what
  the project's rules are is theirs to decide.

## The five phases

### 1. Read what is already settled

Before looking for failures, read what the project has already decided, or the retro will spend the
owner's attention relitigating it:

1. `CLAUDE.md` and every `.claude/skills/*/SKILL.md` — the standing rules.
2. Every previous retro in `docs/superpowers/retros/`, both lists. **A declined proposal is not
   raised again.** If new evidence genuinely changes one, say that it was declined, cite the new
   evidence, and ask before counting it as a proposal.
3. The handoff's *Decisions taken … not to be reopened* entries.

A deliberate rule is not a finding. Owner-only intake approval, one-PR-per-ticket, no local merges
to `main`, Firefox and Chromium only — these are constraints, and a proposal that argues against one
is out of scope no matter how much evidence sits behind it.

### 2. Gather

Window: since the last retro's date, or all of it on the first run.

| Source | Command | Holds |
|---|---|---|
| The handoff | `docs/superpowers/plans/handoff.md`, then `handoff/YYYY-MM-DD.md` for a day | The curated state, and the lessons already named |
| Merged PRs | `tea pr list --state closed --limit 50 --output json` | What the branch actually cost — fix waves, late reworks |
| One PR's body | `tea pr <n>` | Why it was opened, and what it admitted it left undone |
| Review comments | `tea pr review-comments <n>` | Findings that never reached the handoff |
| Closed issues | `tea issues <n>` | Scope changes, and why a ticket ended the way it did |
| The live board | `tea issues list --labels status/<name>` | Current truth about counts and statuses |

Three things about `tea` that will otherwise cost a run. **There is no `--state merged`** — closed
is the widest state it takes, and merged pull requests are separated by the `state` field in the
JSON. **Its JSON flattens `labels` to a comma-joined string**, not a list, so code that treats it as
one breaks. And when either is awkward, **the plain HTTPS API is richer and needs no extra
credential**:

```shell
curl -sS "https://codeberg.org/api/v1/repos/DionGerrese/ThatApp/issues?state=open&type=issues&limit=100"
```

**The handoff's prose goes stale between entries**, and a retro is usually the thing that finds out.
Any count, status or "still open" claim gets re-checked against the forge before it enters a
finding — a retro whose first number is wrong spends the rest of its credibility defending itself.
**Check it against the forge, not against local git:** if `git fetch` cannot authenticate, the
remote-tracking refs stay frozen at the last successful fetch and local git will answer confidently
with yesterday's world. `tea` and the API carry a token rather than the SSH key, so they keep
working when git does not.

### 3. Qualify

A candidate becomes a finding when it clears one of two bars:

- **It recurred** — the same failure in two or more separate tickets, each one citable.
- **It cost something** — one occurrence that reached review or `main`, lost a day, or let a gate
  pass while the thing it guards was broken.

Everything else is noise the handoff already handled by writing it down once.

Each finding is these four slots, filled:

- **What happened** — one sentence, no narrative.
- **Where** — ticket and PR numbers, one per occurrence.
- **Which gate missed it** — the review, test or check that should have caught it, and why it did
  not. This is the slot that makes a finding actionable; a failure no gate owns is a failure no rule
  change can reach.
- **Verified** — what you re-checked against a live source, and what it said.

### 4. Propose

The proposal list contains only candidates with all four parts below filled in, ordered strongest
first. A candidate missing a part stays a finding and is reported as one.

- **Change** — the document, the section, and the exact new or replacing wording. Not a direction to
  travel in; the words that would land in the file.
- **Delta** — exactly one of: *tightens* an existing rule · *replaces* one · *deletes* one · *adds* a
  new one. A proposal whose delta is *adds* names the existing rule that could not be tightened to
  cover the case, and why not.
- **Would have caught** — which incident from the findings, and the mechanism by which the changed
  rule catches it. "Would have encouraged more care" is not a mechanism.
- **Cost** — what the rule asks of every future ticket, including the ones where nothing was going
  wrong. Rules are paid for by the work that never needed them.

### 5. Adjudicate, one at a time

Present one proposal. Wait. Then the next.

- **Approved** → make that edit now, in this session, on the retro branch, before presenting the
  next one.
- **Declined** → record the owner's reason in their terms, and move on without re-arguing it.

**No rule document is edited before that proposal's own approval.** Not as a draft, not "so you can
see it", not batched at the end with the approved ones. The edit is what approval buys.

### 6. Record

`docs/superpowers/retros/YYYY-MM-DD-retro.md`, opening with the repo's **Date** / **Supersedes** /
**Superseded by** header, then three sections:

- **Findings** — everything that cleared the bar, including candidates that never became proposals.
- **Approved** — each proposal and where its edit landed.
- **Declined** — each proposal and the owner's reason. This section is the one a future retro
  depends on, so it is written to be read cold by a session that was not there.

Then one bullet in the handoff: a retro ran, and which rules changed. Approved rule changes are
exactly the kind of decision a later session must not reopen.

A retro needs no ticket. Branch `retro-YYYY-MM-DD`, one pull request carrying the retro document and
the approved edits together, opened at the end. The owner merges it, as they merge everything.

## Common mistakes

These are what a retro run without this skill actually produced, on this repo's real history.

| Mistake | How it showed up | Instead |
|---|---|---|
| Quoting the handoff's numbers | "twelve open intake tickets", listing twelve; the board had thirteen | Fill the **Verified** slot from `tea` |
| A suggestion where a proposal belongs | "add a lightweight triage checkpoint", "make it a checklist item" | Name the document, the section and the wording |
| Product work dressed as process | A `make` target, a grep check, a prioritisation policy | Raise it as `status:intake` and move on |
| Every proposal adds a rule | Seven findings, seven new gates, nothing tightened or deleted | Fill the **Delta** slot; *adds* argues for itself |
| Relitigating a deliberate rule | Faulting the intake queue for sitting, when owner-only approval is the design | Phase 1, before looking for failures |
| Evidence inflated by a word | "two real production-data losses" over a record holding one | The **Verified** slot, and the record's own hedge |

## What a retro does not do

- It does not score the project, count velocity, or praise. A finding is a failure with a citation.
- It does not fix what it finds. An approved proposal changes a rule; the work that rule implies is
  a ticket like any other.
- It does not run itself. The owner asks for a retro, or it does not happen.
