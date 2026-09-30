# One scrim token (#97) Implementation Plan

**Date:** 2026-09-28
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every native dialog dims the page behind it with one scrim token: 25% black on light, 60% black on dark.

**Architecture:** A `--color-scrim` token in `@theme` in `web/src/styles.css`, written with `light-dark()` like the palette around it. One `dialog::backdrop` rule applies it, so `that-confirm`, the entries dialog and the stop dialog take it with no per-component style. #89's Settings dialog fills the viewport and paints its own scrim as its background (`bg-[oklch(0_0_0/0.5)]`, backdrop transparent) — it switches that to the token (`bg-scrim`). The prototype's `.scroller` and the visual language's *Still open — the scrim* note are updated to the decision.

**Tech Stack:** CSS (Tailwind v4 `@theme`), TypeScript, Playwright e2e.

**Spec:** Codeberg issue #97. This branch is stacked on #89 (`issue-89-settings-dialog`), which is stacked on #229.

## Global Constraints

- All commands through `make` or `docker compose`; no Go, Node or npm on the host.
- Tailwind v4: theme values live in `@theme` in `web/src/styles.css`; no `tailwind.config.js`.
- The values are the owner's: `oklch(0 0 0 / 0.25)` on light, `oklch(0 0 0 / 0.6)` on dark. **A change after seeing them in the real app goes to the owner, not into the build.**
- No per-component backdrop style on `that-confirm`, the entries dialog or the stop dialog.
- Out of scope: closing a dialog by clicking the backdrop; the dialog's own shadow and edge.
- Firefox and Chromium; the initial response stays under 14336 bytes (`web/dist/index.html`).

## Review Focus

1. **The risk the ticket names, measured first:** a custom property and `light-dark()` resolve inside `::backdrop` only where the backdrop inherits from its dialog. If the computed backdrop colour is wrong in either browser or theme, stop: the ticket goes to `status/blocked` and nothing is built.
2. **Theme switching while a dialog is open:** the scrim follows `data-theme` (the theme is set on the root; `light-dark()` follows `color-scheme`). Assert both themes.
3. **Settings' scrim is the same token**, read from the Settings dialog element's own computed background, and its `::backdrop` stays transparent (so the page is not dimmed twice).
4. **The stop dialog** (`that-stop-dialog`) is a native dialog too; it takes the scrim through the same rule.
5. **The prototype edit** keeps it a fragment: no doctype is added.

---

### Task 1: The scrim token and its rule

**Files:**
- Modify: `web/src/styles.css` (`@theme`: `--color-scrim`; a `dialog::backdrop` rule)
- Modify: `web/src/settings-dialog.ts` (the dialog's class: `bg-[oklch(0_0_0/0.5)]` → `bg-scrim`)
- Modify: `docs/superpowers/prototypes/2026-09-03-app-prototype.html` (`.scroller`, line ~245: the two values under its light/dark switch)
- Modify: `docs/superpowers/specs/2026-09-03-visual-language-design.md` (~line 524: *Still open — the scrim* replaced by the decision and its reason)
- Test: a new `.claude/e2e/tests/scrim.spec.ts`

- [ ] **Step 1: Measure the risk.** In a throwaway spec, add the token and the rule to a page (or temporarily to `styles.css`), open `that-confirm` (see how `pins.spec.ts` or `settings.spec.ts` opens a confirm) in light and in dark, and read `getComputedStyle(dialog, "::backdrop").backgroundColor` in Firefox and Chromium. Expected: `oklch(0 0 0 / 0.25)` on light, `oklch(0 0 0 / 0.6)` on dark (or their `rgba`/`color()` equivalents — record exactly what each browser returns). **If any of the four is wrong, stop and report BLOCKED with the numbers.**

- [ ] **Step 2: Write the failing tests** in `scrim.spec.ts`, both themes (set the theme the way `theme.spec.ts` does), both browsers:
  1. an open `that-confirm`'s `::backdrop` computes the token's value;
  2. the entries dialog's `::backdrop` the same;
  3. the stop dialog's `::backdrop` the same;
  4. the Settings dialog element's own background computes the token's value, and its `::backdrop` is transparent.
  Normalise the colour string once (a small helper that compares alpha and that r=g=b=0), rather than matching a browser's exact serialisation.

- [ ] **Step 3: Run them; they fail** (today: the UA default backdrop, and Settings at 0.5 in both themes).

- [ ] **Step 4: Build.** In `@theme`: `--color-scrim: light-dark(oklch(0 0 0 / 0.25), oklch(0 0 0 / 0.6));`. Below the theme (with the other global rules): `dialog::backdrop { background: var(--color-scrim); }`. In `settings-dialog.ts`, `bg-[oklch(0_0_0/0.5)]` → `bg-scrim`.

- [ ] **Step 5: Run them; they pass.** Then check that no component sets its own backdrop: `grep -rn "backdrop" web/src` shows only the Settings dialog's `backdrop:bg-transparent` and the one rule.

- [ ] **Step 6: The prototype and the language.** In the prototype's `.scroller`, draw 25% black under the light switch and 60% under the dark one, the way the prototype already varies other values by theme (read how `#lm-toggle` switches the palette). Replace the visual language's *Still open — the scrim* paragraph with the decision: one token, 25% on light and 60% on dark, so both themes dim by the same felt amount; settled by the owner on 2026-09-23 over the prototype's 50% in both themes and the browser's 10%.

- [ ] **Step 7: Compare and capture.** Frame the prototype (the `ticket-workflow` skill's "When a ticket changes the UI"; throwaway file under `.claude/e2e/`), open its Settings sheet in light and dark, and read `.scroller`'s computed background; compare with the app's. Capture a dark and a light screenshot of an open `that-confirm` over Today and of the open Settings dialog, at rest, into `/tmp/claude-1001/-home-dion-Projects-personal-ThatApp/1f6b0dcc-e86a-4130-a796-3fc38c863453/scratchpad/shots97/` (`confirm-scrim-{dark,light}.png`, `settings-scrim-{dark,light}.png`). Delete throwaway files.

- [ ] **Step 8: Gates.** `make verify`; `make test-e2e` with 0 failed; `wc -c < web/dist/index.html` under 14336.

- [ ] **Step 9: Commit** `One scrim token dims every dialog: 25% black on light, 60% on dark (#97)`. If signing fails, commit unsigned with `git -c commit.gpgsign=false commit …` and say so. Never push.
