# #267 — Escape closes a shown tooltip

**Date:** 2026-10-07
**Supersedes:** nothing
**Superseded by:** nothing
**Spec:** Codeberg #267 body (owner decisions of 2026-10-06 are binding)

WCAG 2.2 1.4.13 asks that content shown on hover or focus can be dismissed without moving the pointer
or focus. `that-tooltip` has no key handling. The owner chose **Escape only**: Escape closes a shown
tooltip, tooltips stay *not* hoverable (`pointer-events: none` stays, #107's guarantee stands), and
where Escape already means something — a `showModal()` dialog, the issue search field — the first
Escape with a tooltip open closes **only the tooltip**.

## Global Constraints

- All tooling runs through `make` or `docker compose`; never run Go, Node or npm on the host.
- No new dependencies. Vanilla TS, light DOM. Firefox and Chromium only.
- TypeScript is `strict` with `noUncheckedIndexedAccess`: no `any`, `as any` or non-null assertion.
- Only `web/src/components/that-tooltip.ts` changes in product code. No change to what a tooltip says
  or where it opens, and none to `pointer-events-none` in its class list.
- #107's tests and every existing tooltip test pass unchanged.
- **TDD.** RED fails on an assertion for the reason the test names — not a timeout on a typo, not a
  compile error. A test that passes before the change is a *guard*, proven by mutation instead.
  **Every assertion a task adds or changes is proven by mutation**: break the guarded code by hand, run
  that one test, show it red, restore, show it green. The report lists each mutation and its red line.
- Prettier: `docker compose run --rm --no-deps web npx prettier --write <web/src files>`. Do not run
  Prettier on `.claude/e2e/`.
- One spec: `docker compose --profile e2e rm --stop --force app-e2e`, then
  `docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test <spec> --reporter=line -g "<title>"'`,
  then remove `app-e2e` again.
- Commits: if `git commit` fails on signing, retry with `git -c commit.gpgsign=false commit …`.
  Never push.

## Task 1: Escape closes a shown tooltip, and only the tooltip

**Files:** `web/src/components/that-tooltip.ts`; `.claude/e2e/tests/tooltip.spec.ts`; the specs that
already cover the entry dialog and the issue search field (find them; add the two layering tests
there, beside their existing Escape tests).

### The change

One window keydown listener per connected tooltip, in the **capture** phase, so it runs before the
search field's own `keydown` and before a dialog's Escape handling. It acts only while this tooltip is
open:

```ts
  // #267, WCAG 1.4.13 "dismissible": Escape closes a shown tooltip without
  // moving the pointer or focus. Captured on window and stopped there, so where
  // Escape already means something — a showModal() dialog, the search field —
  // the first press closes only the tooltip. preventDefault is what holds a
  // modal dialog open (see that-stop-dialog's holdEscapeWhileBusy).
  private readonly onEscape = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !this.matches(":popover-open")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.hidePopover();
  };
```

Add it in `connectedCallback` after the trigger is found
(`window.addEventListener("keydown", this.onEscape, true)`), and remove it in `disconnectedCallback`
with the same capture flag. Nothing else in the component changes. Re-opening needs no code: the
tooltip already reveals on the next `pointerenter` or keyboard `focus` of its trigger.

### Tests

In `tooltip.spec.ts`, using its existing fixture page and helpers:

1. **Hover, then Escape:** tooltip open from hover; Escape; tooltip hidden while the pointer is still
   over the trigger (assert the pointer did not move — no `mouse.move` between).
2. **Keyboard focus, then Escape:** tooltip open from Tab focus; Escape; tooltip hidden and the
   trigger is still `document.activeElement`.
3. **Re-opens:** after Escape from hover, move the pointer off and back on → open again. After Escape
   from focus, Tab away and Shift+Tab back → open again.
4. **Guard — no tooltip open:** Escape with nothing open does not have its default prevented (a
   window bubble-phase listener added by the test records `event.defaultPrevented === false`).
5. **Guard — still click-through:** the tooltip's computed `pointer-events` is `none` after the change
   (#107's own test may already pin this; if so, cite it and do not duplicate).

Beside the existing Escape tests:

6. **Entry dialog:** open the entry dialog, show one of its tooltips (hover a control inside it that
   carries a `that-tooltip`); Escape → tooltip hidden, dialog still open; Escape again → dialog closed.
7. **Issue search field:** open the field with results showing, show a tooltip inside the panel (hover
   a result row's key link) while focus stays in the field; Escape → tooltip hidden, field still open
   (`aria-expanded="true"`); Escape again → field closed.

RED: tests 1, 2, 6 and 7 fail before the change on their "hidden" / "still open" assertion. Tests 3,
4 and 5 are guards.

Mutations (each red on its assertion, then restored):
- `onEscape` never registered → 1, 2, 6, 7 red.
- `stopImmediatePropagation` removed → 7 red (the field closes on the first press).
- `preventDefault` removed → 6 red (the dialog closes on the first press), in at least one browser;
  report what each browser does.
- the `:popover-open` check removed → 4 red.
- `hidePopover` replaced by nothing → 1 red.

Then the whole of `tooltip.spec.ts` and the two specs you touched, green on both browsers. One commit:
`#267: Escape closes a shown tooltip, and only the tooltip`.

## Task 2: Final gates

`make verify` and `make test-e2e`, both green, tails pasted. No commit.

## Out of scope

Making tooltips hoverable (declined 2026-10-06). Any change to tooltip text or placement. #212.
