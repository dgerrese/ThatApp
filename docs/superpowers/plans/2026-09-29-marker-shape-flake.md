# Marker-shape test waits for the failed marker (#234) Implementation Plan

**Date:** 2026-09-29
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `.claude/e2e/tests/week.spec.ts` "a failed marker and an unpushed one differ in shape, not only in hue" stops reading an empty computed radius off a detached span.

**Architecture:** Test-only. After `pushEverything(page)` the test waits for RIDGE-2 column 2's trigger to say `push failed` — the same wait its siblings use (~line 522, ~line 1432) — and then reads shapes with web-first `toHaveCSS` assertions, which re-resolve the locator on each retry. The one-shot `shapeOf` helper has no other caller and is deleted.

**Tech Stack:** Playwright e2e (TypeScript strict).

**Spec:** Codeberg issue #234 (its body is the refined spec; it has no comments).

## Global Constraints

- All commands through `make` or `docker compose`; no Go, Node or npm on the host.
- TypeScript strict; no `any`, `as any` or non-null assertion. Few comments, only the why.
- Out of scope: changing Week's rendering; auditing computed-style reads in other specs.
- This branch is cut from `main`. Open PR #260 (#231) also edits `week.spec.ts` in a different region; do not depend on it or touch its region.
- Firefox and Chromium both run every test. WebKit is a non-goal.

## Review Focus

1. **The wait targets the failed state, not any marker.** Before the push the cell already holds an unpushed disc, so `toBeVisible()` on the marker proves nothing; only the trigger's `aria-label` matching `/push failed/` does.
2. **Every shape read is web-first.** No `evaluate`, `getComputedStyle` or awaited value compared with a plain `expect(...)` remains in the test.
3. **The test still guards the behaviour.** Making the failed marker round (or the unpushed one square-cornered with a border) must fail it — proven in Step 4, then reverted.
4. **`shapeOf` is gone and nothing else broke.** `make lint` / `make tsc` catch an orphaned `Locator` import if the type becomes unused (it does not: `markerIn` and `tooltipIn` still return `Locator`).
5. **Stable under repetition** — 20 runs per browser of this one test, no flake.

---

### Task 1: Wait for the failed marker, assert shapes web-first

**Files:**
- Modify: `.claude/e2e/tests/week.spec.ts` — delete `shapeOf` (lines 238-244); rewrite the tail of the test at lines 566-584.

**Interfaces:**
- Consumes: `markerIn(page, issueKey, column): Locator`, `ticketRow(page, issueKey)`, `pushEverything(page)` — all existing in the same file.
- Produces: nothing.

- [ ] **Step 1: Confirm the baseline**

`grep -n "shapeOf" .claude/e2e/tests/week.spec.ts` — expected: the definition (~238) and two calls (~575, ~576), nothing else. If any other caller exists, keep the helper and only stop this test using it.

- [ ] **Step 2: Rewrite the test tail**

Replace everything from `await pushEverything(page);` to the end of the test (lines 566-584) with:

```ts
  await pushEverything(page);

  // The cell already holds an unpushed disc before the push lands, so the
  // marker being visible proves nothing; the repaint that swaps in the failed
  // triangle has to land first, or a shape read hits a detached span (#234).
  await expect(ticketRow(page, "RIDGE-2").locator("td").nth(2).locator("button")).toHaveAttribute(
    "aria-label",
    /push failed/,
  );

  // The rollup is unchanged underneath, so Monday still reads unpushed while
  // Wednesday wears the marker the push left — both on screen at once.
  const failed = markerIn(page, "RIDGE-2", 2);
  const unpushed = markerIn(page, "RIDGE-1", 0);

  // A triangle against a disc: the failed marker has a drawn edge and square
  // corners, the unpushed one is round and has neither.
  await expect(unpushed).toHaveCSS("border-bottom-width", "0px");
  await expect(failed).not.toHaveCSS("border-bottom-width", "0px");
  await expect(failed).toHaveCSS("border-top-left-radius", "0px");
  await expect(unpushed).not.toHaveCSS("border-top-left-radius", "0px");
});
```

The old `expect(failedShape).not.toEqual(unpushedShape)` is implied by the four assertions and goes. Then delete the whole `async function shapeOf(...) { ... }` block (lines 238-244) and the blank line after it.

Run prettier's check as part of lint (Step 5); if it reflows the `toHaveAttribute` call, take its formatting (`make fmt`).

- [ ] **Step 3: Run the test in both browsers**

```bash
docker compose --profile e2e rm --stop --force app-e2e
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/week.spec.ts -g "differ in shape"'
docker compose --profile e2e rm --stop --force app-e2e
```

Expected: 2 passed (firefox, chromium).

- [ ] **Step 4: Prove the test still guards the behaviour**

Temporarily make the failed marker round: in `web/src/push-marks.ts`, append ` rounded-full` to `PUSH_MARKS.failed.shape`. Re-run Step 3's commands.

Expected: FAIL in both browsers on `toHaveCSS("border-top-left-radius", "0px")` (the received value is a large px radius, not `0px`).

Revert: `git checkout web/src/push-marks.ts`, then `git status --short` must list only `.claude/e2e/tests/week.spec.ts`.

- [ ] **Step 5: Acceptance — 20 repeats per browser**

```bash
docker compose --profile e2e rm --stop --force app-e2e
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/week.spec.ts -g "differ in shape" --repeat-each=20'
docker compose --profile e2e rm --stop --force app-e2e
```

Expected: 40 passed (20 firefox, 20 chromium), 0 flaky. Paste the summary line into the task report. Any failure or flaky result is a blocker to report, not a retry.

- [ ] **Step 6: Full gates**

```bash
make verify
make test-e2e
```

Expected: both green. Paste the tail of each output into the task report.

- [ ] **Step 7: Commit**

```bash
git add .claude/e2e/tests/week.spec.ts
git commit -m "[#234] The marker-shape test waits for the failed marker and reads shapes web-first

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LSFNGKuFZChTpQMJ5cQuAH"
```

If signing fails (locked vault), retry with `git -c commit.gpgsign=false commit …` and carry on. Never push.
