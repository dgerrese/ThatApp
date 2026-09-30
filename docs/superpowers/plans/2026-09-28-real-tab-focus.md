# Keyboard-focus tests use a real Tab (#217) Implementation Plan

**Date:** 2026-09-28
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every e2e test whose name or comment claims keyboard focus or `:focus-visible` reaches its target with a real key press, not `.focus()`.

**Architecture:** Tests only. Focus the element just before the target (a plain element that is not itself asserted), press `Tab` (or `Shift+Tab`), assert the target `toBeFocused()`, then assert what the test is about. Where several presses are needed, `smoke.spec.ts`'s `tabUntilFocused` moves to a shared helper module under `.claude/e2e/tests/` and is imported, not copied.

**Tech Stack:** Playwright e2e (TypeScript, not type-checked by `make tsc` — only a Playwright run proves a spec compiles).

**Spec:** Codeberg issue #217. This branch is stacked on #229 (`issue-143-keyboard-and-cut-text`), which changes all five spec files involved; the criterion's grep therefore also covers `.focus()` uses #229 added.

## Global Constraints

- All commands through `make` or `docker compose`; no Go, Node or npm on the host.
- **No product code changes.** No change to `web/`, and none to `that-tooltip.ts` (the `:focus-visible` gate is #107's).
- No non-null assertions in the specs (`?.before()`, not `!`).
- Firefox and Chromium both run every test.
- Out of scope: `.focus()` uses that test focus being *kept*, scrolling, or Enter handling rather than keyboard reveal — they stay, each listed in the report with the reason.

## Review Focus

1. **A converted test must still be able to fail.** Show it: temporarily make the target unreachable by Tab (e.g. `tabindex="-1"` injected by the test, or remove the preceding element) and see the `toBeFocused()` assertion fail; for the tooltip test, see the tooltip assertion fail when the reveal is broken (e.g. the test's trigger has no tooltip).
2. **The pointer is moved off the target first** (`page.mouse.move(0, 0)` or as `pins.spec.ts` already does), so hover cannot supply what focus is claimed to supply — `search.spec.ts` hovers before focusing today, which makes its focus step prove nothing.
3. **The element before the target** is chosen so that one Tab lands on the target in both browsers; assert `toBeFocused()` on the target before reading any style.
4. **Leaving focus** uses a key press (`Shift+Tab` or `Tab`), not `.blur()`, where the test asserts something disappears on blur.
5. **The final grep** across `.claude/e2e/tests/` finds no `.focus()` in a test whose name or comment claims keyboard focus or `:focus-visible`; every remaining `.focus()` is in the report's kept list with its reason.

---

### Task 1: Real key presses for keyboard-focus claims

**Files:**
- Modify: `.claude/e2e/tests/tooltip.spec.ts` ("focusing the trigger by keyboard shows the tooltip too"), `.claude/e2e/tests/pins.spec.ts` (~line 562, the pin control's focus colour), `.claude/e2e/tests/week.spec.ts` (~line 1401, "a cell takes the hover wash on keyboard focus"), `.claude/e2e/tests/search.spec.ts` (~line 674)
- Modify: any other spec the survey in Step 1 finds making the same claim (including tests #229 added)
- Possibly create: a shared helper module for `tabUntilFocused` (and update `smoke.spec.ts` to import it)

- [ ] **Step 1: Survey.** `grep -rn "\.focus()" .claude/e2e/tests/`. For each hit, read the test's name and comments and classify it: *claims keyboard focus / :focus-visible* (convert) or *kept* (focus retention, scrolling, Enter handling, a setup step not asserted). Write the table into the report.

- [ ] **Step 2: tooltip.spec.ts.** In `mountTrigger`'s test, insert `<button id="before">before</button>` immediately before `#trigger` with `page.locator("#trigger").evaluate(t => t.before(Object.assign(document.createElement("button"), { id: "before", textContent: "before" })))` or equivalent without `!`. `.focus()` `#before` (not asserted), move the pointer away, press `Tab`, assert `#trigger` focused and the tooltip visible; press `Shift+Tab`, assert `#before` focused and the tooltip hidden.

- [ ] **Step 3: pins, week, search, and every other "convert" row.** For each: move the pointer off, focus the element just before the target, press `Tab` (or `Shift+Tab` from after it), assert the target focused, then the style. Use a shared `tabUntilFocused` if a target needs several presses.

- [ ] **Step 4: Prove each converted test can fail** (Review Focus 1), then restore. Record RED output per test.

- [ ] **Step 5: Run the changed specs in both browsers, then the gates.**

```shell
docker compose --profile e2e rm --stop --force app-e2e
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/tooltip.spec.ts tests/pins.spec.ts tests/week.spec.ts tests/search.spec.ts tests/smoke.spec.ts'
docker compose --profile e2e rm --stop --force app-e2e
make verify
make test-e2e
```

`make test-e2e` must show 0 failed.

- [ ] **Step 6: Final grep** (Review Focus 5) into the report.

- [ ] **Step 7: Commit** `Keyboard-focus tests reach their target with a real Tab (#217)`. If signing fails, commit unsigned with `git -c commit.gpgsign=false commit …` and say so. Never push.
