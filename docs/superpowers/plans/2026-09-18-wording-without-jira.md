# Wording without Jira (#116) Implementation Plan

**Date:** 2026-09-18
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No user-facing action, state or report string names Jira, except links out to Jira and Settings; the rail's action reads "Push worklogs".

**Architecture:** A string-for-string rewrite driven by the table in issue #116, applied in `web/src` and in every test that asserts on those strings, plus the prototype's matching copy. No behaviour changes.

**Tech Stack:** TypeScript, Playwright, the prototype HTML.

**Spec:** Codeberg issue #116 — `tea api "repos/{owner}/{repo}/issues/116"`. **Its "The strings" table is the requirement**; read it first and follow it exactly.

## Global Constraints

- No Go, Node or npm on the host; everything runs through `make` or `docker compose`.
- Keep Jira in: `Open <KEY> in Jira` links (`that-ticket-row.ts`, `that-issue-search.ts`, `week.ts`), Settings (`Jira instances`), and Today's `No Jira instances yet…` empty state. Nothing else user-facing keeps it.
- "push failed" replaces only what said "did not reach Jira" as a *state*; the push report's sentence form is in the table.
- Where a replacement does not read as a sentence in context, use the smallest wording that does, list each such case in the report, and flag any that changes meaning.
- Server-side messages and `sw.ts` logs are out of scope.
- The owner's dev stack (`app`, `web`) is theirs: never `make down`, never stop/restart/recreate it.
- Commit unsigned with `git -c commit.gpgsign=false commit …` if signing fails; **never push**.

---

### Task 1: Drop "Jira" from actions, states and reports

**Files (as found on 2026-09-18; re-grep):**
- Modify: `web/src/rail.ts`, `web/src/push-report.ts`, `web/src/views/week.ts`, `web/src/components/that-entry-dialog.ts`
- Modify tests: `.claude/e2e/tests/push.spec.ts`, `week.spec.ts`, `entries.spec.ts`, `smoke.spec.ts`, and any unit test that asserts on these strings
- Modify: `docs/superpowers/prototypes/2026-09-03-app-prototype.html` (its copy of the same strings, e.g. Week cell tooltips "pushed to Jira" / "not pushed to Jira", the rail's "Push to Jira")

**Interfaces:** none.

- [ ] **Step 1: Point the tests at the new wording first (RED)**

`git grep -n 'Jira' -- .claude/e2e/tests web/src/*.test.ts` and, for every assertion on a string the
table changes, change it to the new string. Leave assertions on the kept strings (links, Settings, the
empty state) alone.

**Watch the regexes.** `/pushed to Jira/` becomes a pattern for "pushed", and a bare `/pushed/` also
matches "not pushed". Anchor or make exact every changed pattern so "pushed" cannot match "not
pushed" — e.g. `/(^|· )pushed( ·|$)/` or `toHaveText` with the full string — and say in the report
how each was made exact.

Run the affected specs (mirror `make test-e2e`'s recipe for a focused run). Expected: FAIL wherever the
product still says the old string. Paste a summary (counts and a few representative failures).

- [ ] **Step 2: Change the product strings**

Apply the #116 table in `web/src`. Then run:

```shell
git grep -n -E '["`'"'"'][^"`'"'"']*Jira' -- web/src ':!*.test.ts' ':!web/src/sw.ts'
```

Every remaining hit must be a link (`Open … in Jira`), Settings, or the `No Jira instances yet`
empty state. Paste the output into the report.

- [ ] **Step 3: The prototype**

In `docs/superpowers/prototypes/2026-09-03-app-prototype.html`, change the same strings (the rail's
action label, the confirm text if present, the Week cell tooltips, any push-report copy). Report what
you compared: list each prototype string changed, and confirm by grep that no `to Jira` / `reach Jira`
remains outside link titles.

- [ ] **Step 4: GREEN and gates**

Re-run the affected specs: PASS. Then `make verify` and `make test-e2e`. `pwa.spec.ts` has #134's
intermittent chromium segfault — re-run once and report both runs. If `pwa.spec.ts`'s offline-shell
tests fail with `toBeGreaterThan`, `dist/sw.js` is out of step with `app.js` (#67): run
`make build-web` once and say so.

- [ ] **Step 5: Commit**

```bash
git add web/src .claude/e2e/tests docs/superpowers/prototypes/2026-09-03-app-prototype.html
git commit -m "fix(#116): actions, states and reports stop naming Jira; the rail says Push worklogs"
```
