# Focused text fields take the accent (#108) Implementation Plan

**Date:** 2026-09-28
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every focused text field lights its border with `--color-primary`, as the prototype draws, in both themes.

**Architecture:** Two class changes. `that-duration.ts`'s group: `focus-within:border-ink` → `focus-within:border-primary`. `that-confirm.ts`'s `COMMENT_FIELD_CLASS` (shared by the entries dialog's and the stop dialog's comment field): `focus:border-ink` → `focus:border-primary`. The search field and #89's Settings form fields already take `border-primary`. An e2e test pins each field's focused border against the search field's.

**Tech Stack:** TypeScript, Tailwind v4 utilities, Playwright e2e.

**Spec:** Codeberg issue #108. Stacked on #89 (`issue-89-settings-dialog`, PR #251), whose Settings dialog replaces the `views/settings.ts` the ticket names.

## Global Constraints

- All commands through `make` or `docker compose`; no Go, Node or npm on the host.
- No `any`, `as any` or non-null assertion in `web/src`. Few comments.
- Out of scope: focus outlines on buttons and links.
- Firefox and Chromium; light and dark.

## Review Focus

1. **The comparison is against the search field's focused border**, read as a computed colour in the same theme, so a later drift of either fails — not against a hard-coded colour string.
2. **Focus is reached for real**, or at least the assertion does not depend on hover: move the pointer away before reading. (`:focus` and `:focus-within` are not modality-gated, so `.focus()` is acceptable here — say so in a comment only if the test would otherwise read as a keyboard claim.)
3. **Every text field in `web/src`**: the final grep (`focus:border-ink`, `focus-within:border-ink`) finds none.
4. **The duration group's border is on the group, not the input** (`focus-within`), matching the drawing's `.durgroup:focus-within`.
5. **Settings' four form fields** (#89's dialog) are covered by the same test, both themes.

---

### Task 1: The accent on focus

**Files:**
- Modify: `web/src/components/that-duration.ts` (~line 63)
- Modify: `web/src/components/that-confirm.ts` (`COMMENT_FIELD_CLASS`, ~line 7)
- Test: a new `.claude/e2e/tests/focus-accent.spec.ts`

- [ ] **Step 1: Write the failing test.** For each of: the duration group (a Today row's duration control — see how `today.spec.ts` or `entries.spec.ts` reaches it), the entries dialog's comment field, the stop dialog's comment field (see `timer.spec.ts` for opening the stop dialog), and the four Settings form fields (open Settings with the cog, open "Add an instance"; see `settings.spec.ts`) — in light and in dark (set the theme as `theme.spec.ts` does): move the pointer to (0,0), focus the field, and assert its border colour (for the duration group, the group element's) equals the search field's focused border colour in the same theme (focus the search field, read `getComputedStyle(el).borderTopColor`). Read the search field's value once per theme.

- [ ] **Step 2: Run it; the duration group and the two comment fields fail** (ink), Settings and search pass.

```shell
docker compose --profile e2e rm --stop --force app-e2e
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/focus-accent.spec.ts'
docker compose --profile e2e rm --stop --force app-e2e
```

- [ ] **Step 3: Change the two classes** (`border-ink` → `border-primary` in each focus utility).

- [ ] **Step 4: Run it again; all pass**, both browsers.

- [ ] **Step 5: Grep** `grep -rn "focus:border-ink\|focus-within:border-ink" web/src` → nothing.

- [ ] **Step 6: Compare against the drawing.** Frame the prototype (the `ticket-workflow` skill's "When a ticket changes the UI"; throwaway file under `.claude/e2e/`), focus `.durgroup` and `.ecomment-in`, and read their border colours in light and dark; compare with the app's. Write the numbers in the report.

- [ ] **Step 7: Screenshots**, each a dark and light pair, at rest except for the focus under test (pointer parked): the focused duration group, the focused entries-dialog comment field, a focused Settings field. Save to `/tmp/claude-1001/-home-dion-Projects-personal-ThatApp/1f6b0dcc-e86a-4130-a796-3fc38c863453/scratchpad/shots108/` (`duration-focus-{dark,light}.png`, `entry-comment-focus-{dark,light}.png`, `settings-field-focus-{dark,light}.png`), copied out right after the run. Delete throwaway specs.

- [ ] **Step 8: Gates.** `make verify`; `make test-e2e`, 0 failed.

- [ ] **Step 9: Commit** `Every focused text field lights its border with the accent (#108)`. If signing fails, commit unsigned with `git -c commit.gpgsign=false commit …` and say so. Never push.
