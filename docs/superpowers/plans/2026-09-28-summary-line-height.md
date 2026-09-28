# Summary line height (#221) Implementation Plan

**Date:** 2026-09-28
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A listing-table row is the drawing's 45.5px, not 46.33px: the summary span stops bringing `text-lg`'s own 23.33px line height.

**Architecture:** One class in `summarySpan()` (`web/src/components/that-ticket-row.ts`): `"block truncate text-lg"` → `"block truncate"`. The span then inherits the td's 15px (`.that-tbl td`, since #127) and preflight's `line-height: 1.5`, 22.5px — the drawing's structure, where `.tbl .c-sum .clip` sets no size. The same row component draws Week's listing rows, so the fix reaches both views.

**Tech Stack:** TypeScript (strict), Tailwind v4, Playwright e2e.

**Spec:** Codeberg issue #221. The drawing: `docs/superpowers/prototypes/2026-09-03-app-prototype.html` (`.tbl td`, `.tbl .c-sum .clip`).

## Global Constraints

- All commands through `make` or `docker compose`; no Go, Node or npm on the host.
- TypeScript strict; no `any`, `as any` or non-null assertion in `web/src`. Few comments, only the why.
- This branch is stacked on #229's branch (`issue-143-keyboard-and-cut-text`), because #229 edits the lines around `summarySpan()`.
- Out of scope: Week's grid (#127 fixed it), the failure note's own size, the drawing's `height: 44px` on `.tbl td`.
- New tests go beside #127's size test in `.claude/e2e/tests/table.spec.ts` (~line 653), not at the end of the file.
- Firefox and Chromium both run every test.

## Review Focus

1. **The row height is measured on the row**, with `getBoundingClientRect().height` on the `that-ticket-row` (or its `tr`, whichever carries the row box — check), not inferred from the span's line height.
2. **A row with a failure note** (the 12px `text-xs` note under the summary) keeps its note at 12px and truncated; the fix must not make the note inherit 15px.
3. **Week's listing rows** (rows added to Week by its own search, drawn by the same `that-ticket-row`) get the same height.
4. **The summary stays focusable and truncated** (#229 made it a tab stop with a cut-text tooltip): `block truncate` stays.
5. **#127's size test still passes** unchanged.

---

### Task 1: The summary inherits the cell's line

**Files:**
- Modify: `web/src/components/that-ticket-row.ts` (`summarySpan()`, the `className` line)
- Test: `.claude/e2e/tests/table.spec.ts` (beside the #127 test)

**Interfaces:** none change.

- [ ] **Step 1: Measure the drawing**

Frame the prototype as the `ticket-workflow` skill describes: substitute `docs/superpowers/prototypes/2026-09-03-app-prototype.html` for `<!-- CONTENT -->` in `~/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/brainstorming/scripts/frame-template.html` (never add a doctype to the prototype), write it to a throwaway file under `.claude/e2e/`, and in a throwaway Playwright spec measure a Today listing body row's height and its `.clip` span's computed font-size and line-height, in Firefox and Chromium. Expected: 45.5px, 15px, 22.5px. Record the numbers for the report; delete the throwaway files.

- [ ] **Step 2: Write the failing tests**

Beside the #127 test, following its fixtures (`stubIssues`, `group`, `ridgelineIssues`):

1. `"a Today body row is the drawn 45.5px, and its summary takes the cell's 15px on a 22.5px line"` — every `tbody` row of the first listing table: height within 0.1 of 45.5; the summary span (the focusable span in `td.c-sum`, check the selector against `that-ticket-row.ts`) computes `font-size: 15px` and `line-height: 22.5px`.
2. `"a row Week's search adds is the same 45.5px"` — find how Week's listing rows are made in `week.spec.ts` ("Week's own search" tests) and assert the same height on one.
3. `"a failure note under the summary stays 12px and truncated"` — find how a pinned row's failure note is produced in the existing specs (search for `failure` / `role="status"` in `pins.spec.ts`), and assert the note computes `font-size: 12px` and `text-overflow: ellipsis`.

- [ ] **Step 3: Run them; tests 1 and 2 must fail**

```shell
docker compose --profile e2e rm --stop --force app-e2e
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/table.spec.ts tests/week.spec.ts -g "45.5px|12px and truncated|drawn 15px"'
docker compose --profile e2e rm --stop --force app-e2e
```

Expected: tests 1 and 2 FAIL (46.33px, 23.33px line). Test 3 and #127's test pass.

- [ ] **Step 4: Change the class**

`summary.className = "block truncate";`

- [ ] **Step 5: Run them again** — all pass in both browsers.

- [ ] **Step 6: Screenshots**

A dark and a light screenshot of Today's listing table at rest (pointer parked, nothing focused), from a throwaway spec writing to `/e2e/test-results/shots/`, copied straight after the run to `/tmp/claude-1001/-home-dion-Projects-personal-ThatApp/1f6b0dcc-e86a-4130-a796-3fc38c863453/scratchpad/shots221/`: `today-rows-drawn-height-dark.png`, `today-rows-drawn-height-light.png`. Capture the whole table card with a small margin. Delete the spec.

- [ ] **Step 7: Gates**

```shell
make verify
make test-e2e
```

- [ ] **Step 8: Commit**

`git commit -m "Today's summary takes the cell's 15px line, so a row is the drawn 45.5px (#221)"`. If signing fails, commit unsigned with `git -c commit.gpgsign=false commit …` and say so. Never push.
