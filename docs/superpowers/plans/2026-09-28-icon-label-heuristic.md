# The icon-label test sees visible text (#119) Implementation Plan

**Date:** 2026-09-28
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `vocabulary.test.ts` stops demanding an `aria-label` on an icon control that already has visible text, and the one redundant label that rule forced (`toolbar-button.ts`) goes.

**Architecture:** The check keeps reading source (settled at refinement). Its per-call decision moves into a small pure function in the test file — given the ±600-character window around an `iconMarkup(` call, is a label missing? — which now also accepts a visible-text assignment (`textContent =`) in the window. Fixtures inside the test prove both directions. `toolbar-button.ts` drops its `setAttribute("aria-label", …)` and the comment that justified it.

**Tech Stack:** TypeScript, Node's test runner (the unit suite `make verify` runs), Playwright e2e.

**Spec:** Codeberg issue #119. Cut from `main`; no open branch touches these files.

## Global Constraints

- All commands through `make` or `docker compose`; no Go, Node or npm on the host.
- No `any`, `as any` or non-null assertion. Few comments.
- The known ceiling is accepted (settled): a nearby `textContent =` belonging to another element can make the check pass wrongly. Name it once, in a one-line comment at the function.
- Out of scope: a DOM-based check; any `aria-label` that adds information over the visible text (e.g. `that-table.ts`'s "Sort by …").

## Review Focus

1. **An icon-only control with no label still fails** — fixture: a window with `iconMarkup(` and neither `aria-label` nor `textContent =`.
2. **An icon-plus-text control passes with no label** — fixture: a window with `iconMarkup(` and `textContent =`.
3. **A labelled icon-only control still passes** — fixture with `aria-label`.
4. **The codebase still passes** with `toolbar-button.ts`'s label removed — i.e. the real scan over `web/src` stays green, and no other file relied on the label.
5. **Refresh and Fetch worklogs keep exactly their visible text as their accessible name** — e2e, `getByRole("button", { name: "Refresh", exact: true })` / `"Fetch worklogs"`, and the element has no `aria-label` attribute.

---

### Task 1: The heuristic and the label

**Files:**
- Modify: `web/src/vocabulary.test.ts` (~lines 105–120)
- Modify: `web/src/toolbar-button.ts`
- Test: e2e — add beside an existing test that already has Today and Week open (search `today.spec.ts` for "Refresh" and `week.spec.ts` for "Fetch worklogs")

- [ ] **Step 1: Write the failing unit tests.** In `vocabulary.test.ts`, extract `function iconLabelMissing(window: string): boolean` (same predicate as today: true when the window has no `aria-label|ariaLabel|setAttribute("aria-label"`). Add fixtures as a small table test: `["icon only, no label", 'x.innerHTML = iconMarkup("fetch", 17);', true]`, `["icon with aria-label", 'b.setAttribute("aria-label", "Fetch"); m.innerHTML = iconMarkup("fetch", 17);', false]`, `["icon with visible text", 'm.innerHTML = iconMarkup("fetch", 17); t.textContent = label;', false]`. Run `make verify` (or the unit runner through Compose, e.g. `docker compose run --rm --no-deps web npx tsx --test src/vocabulary.test.ts`): the third row FAILS.

- [ ] **Step 2: Widen the predicate** to also accept `/\btextContent\s*=/` in the window, with the one-line ceiling comment. Run: all rows pass; the real scan still passes.

- [ ] **Step 3: Write the failing e2e check** (Review Focus 5): on Today, the Refresh button has no `aria-label` attribute (`expect(button).not.toHaveAttribute("aria-label")`) and `getByRole("button", { name: "Refresh", exact: true })` resolves to it; the same on Week for "Fetch worklogs". It fails now (the attribute is set).

- [ ] **Step 4: Remove the label.** Delete `button.setAttribute("aria-label", options.label);` from `toolbar-button.ts`, and reword the doc comment's paragraph that justified it (the label's words are the accessible name; no `aria-label` is needed). Run the unit tests and the e2e check: green.

- [ ] **Step 5: Gates.** `make verify`; `make test-e2e`, 0 failed. Also run `grep -rn "Refresh\"\|Fetch worklogs\"" .claude/e2e/tests` and check no existing test relied on the `aria-label` attribute itself.

- [ ] **Step 6: Commit** `The icon-label test sees visible text, and the toolbar button drops its redundant label (#119)`. If signing fails, commit unsigned with `git -c commit.gpgsign=false commit …` and say so. Never push.
