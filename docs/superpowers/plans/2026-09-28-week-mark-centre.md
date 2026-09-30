# Week cell mark centred (#215) Implementation Plan

**Date:** 2026-09-28
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Week cell's push mark sits 7px from its figure and is centred on it, as the prototype's `.cell` draws; the footer's day-total mark keeps its own rule.

**Architecture:** All in `web/src/week-grid.ts`. The cell trigger changes from `items-baseline` to `items-center gap-[7px]`, the cell's mark drops the footer's margin and vertical-align for `shrink-0`, and the footer's constant is renamed so its name says whose rule it is.

**Tech Stack:** TypeScript (strict), Tailwind v4 utilities, Playwright e2e.

**Spec:** Codeberg issue #215 (its body is the refined spec). The drawing: `docs/superpowers/prototypes/2026-09-03-app-prototype.html`, the `.cell` rule (`display: inline-flex; align-items: center; gap: 7px`, mark with no margin, `flex: none`) and the `.dmark` rule (`display: inline-block; vertical-align: 1px; margin-right: 6px`).

## Global Constraints

- All commands through `make` or `docker compose`; no Go, Node or npm on the host.
- TypeScript strict; no `any`, `as any` or non-null assertion in `web/src`. Few comments, only the why.
- Out of scope: the footer's `.dmark` spacing; mark sizes and shapes (`push-marks.ts`).
- New tests go **beside the W6 row-height test** in `.claude/e2e/tests/week.spec.ts` (around line 1304), not at the end of the file: open branch #229 appends there.
- Firefox and Chromium both run every test.

## Review Focus

1. **The gap is the mark's right edge to the figure's left edge**, measured with `getBoundingClientRect`, not the flex `gap` value read back from CSS — a margin left on the mark would pass a CSS read and fail the drawing.
2. **All three marked states**: unpushed, dirty and failed each get the measurement; a failed mark comes from a push failure, not from `pushState`.
3. **The row height and trigger padding stay** (46px row, 9px/13px padding): `items-center` must not grow the trigger. The existing W6 test pins it.
4. **Empty and pushed cells do not move**: an em-dash cell and an unmarked cell render where they did before — compare their bounding box before and after the change in one test.
5. **The footer mark is untouched**: 6px `margin-right`, `vertical-align: 1px`.

---

### Task 1: Centre the cell's mark

**Files:**
- Modify: `web/src/week-grid.ts` (`MARKER_BASE` at line 200; `ticketCell()` trigger class at ~289 and mark at ~330; `dayTotal()` mark at ~373)
- Test: `.claude/e2e/tests/week.spec.ts` (beside the W6 test, ~line 1304)

**Interfaces:**
- Consumes: `markerFor(pushState, failed)` → `{ className, words } | null`, unchanged.
- Produces: nothing new for other code.

- [ ] **Step 1: Write the failing e2e tests**

Read the W6 test and the tests around it in `week.spec.ts` for how the week is stubbed with cells in each push state (look for "failed marker and an unpushed one differ in shape" for the failed and unpushed fixtures, and for a dirty cell). Add, beside W6:

1. `"a cell's push mark sits 7px from its figure, centred on it — unpushed, dirty and failed"` — for a cell in each of the three states: take the mark (`span[aria-hidden="true"]` inside the cell's trigger button) and the figure (`span.font-mono` inside the same trigger); with `getBoundingClientRect` on both, assert `fig.left - mark.right` is within 0.5 of 7, and `|(mark.top + mark.height / 2) - (fig.top + fig.height / 2)|` ≤ 0.5.
2. `"an empty cell and a pushed cell keep their place"` — record the bounding box of an em-dash cell's trigger and a pushed (unmarked) cell's figure in the stubbed week, and assert them against fixed expected values measured on `main` before the change (take them in Step 2's run and write them into the test, both browsers; if the browsers differ, key by `browserName`).
3. `"the footer's day-total mark keeps its own rule"` — for a footer day total with a mark: computed `margin-right` is `6px` and `vertical-align` is `1px`.

- [ ] **Step 2: Run them to verify the first fails**

```shell
docker compose --profile e2e rm --stop --force app-e2e
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/week.spec.ts -g "push mark sits 7px|keep their place|keeps its own rule|46px"'
docker compose --profile e2e rm --stop --force app-e2e
```

Expected: test 1 FAILS (gap 6, centres apart). Tests 2 and 3 and W6 pass — they guard what must not move. Record the output.

- [ ] **Step 3: Change `week-grid.ts`**

- Rename `MARKER_BASE` to `FOOT_MARKER` (value unchanged: `"mr-1.5 inline-block align-[1px]"`) and use it only in `dayTotal()`.
- In `ticketCell()`, the trigger class `items-baseline` becomes `items-center gap-[7px]`.
- The cell's mark: `mark.className = \`shrink-0 ${marker.className}\``.

- [ ] **Step 4: Run the tests to verify they pass**

The same command as Step 2. Expected: all pass in both browsers.

- [ ] **Step 5: Compare against the drawing, and capture screenshots**

Frame the prototype as the `ticket-workflow` skill describes (substitute it for `<!-- CONTENT -->` in the brainstorming skill's `scripts/frame-template.html`; never add a doctype to it) and measure the same two numbers on a marked `.cell` there. Write in the report: the prototype's gap and centre offset, the app's, and whether they match.

Capture one dark and one light screenshot of Week's grid with an unpushed, a dirty and a failed cell visible, at rest (pointer parked, nothing focused), from a throwaway spec writing to `/e2e/test-results/shots/`; copy them to `/tmp/claude-1001/-home-dion-Projects-personal-ThatApp/1f6b0dcc-e86a-4130-a796-3fc38c863453/scratchpad/shots215/` straight after the run, and delete the spec. Names: `week-cell-marks-centred-dark.png`, `week-cell-marks-centred-light.png`.

- [ ] **Step 6: Run the gates**

```shell
make verify
make test-e2e
```

- [ ] **Step 7: Commit**

```shell
git add web/src/week-grid.ts .claude/e2e/tests/week.spec.ts
git commit -m "A Week cell's push mark sits 7px from its figure, centred on it (#215)"
```

If signing fails, commit with `git -c commit.gpgsign=false commit …` and say so. Never push.
