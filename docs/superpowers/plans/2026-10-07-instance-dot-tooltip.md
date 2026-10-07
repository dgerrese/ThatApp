# #259 — Instance dots carry the app's tooltip, not a native title

**Date:** 2026-10-07
**Supersedes:** nothing
**Superseded by:** nothing
**Spec:** Codeberg #259 body (owner decisions of 2026-10-06 are binding)

`paintInstanceDot` (`web/src/instance-hue.ts`) sets `element.title = name`, so every instance dot shows
the browser's own grey tooltip. The owner ruled in #143 that a native `title` no longer fits. Decided
on 2026-10-06:

1. `paintInstanceDot` stops setting `title`. It keeps `role="img"` and `aria-label`.
2. A ticket row (`that-ticket-row.ts`) and a Week grid row (`week-grid.ts`) do not print the name
   beside the dot, so their dot gets a `that-tooltip` with the instance name, shown on hover only.
3. No dot becomes a Tab stop.

The tooltip is the existing mark (#246's skin), so no design session is due.

## Global Constraints

- All tooling runs through `make` or `docker compose`; never run Go, Node or npm on the host.
- Product files: `web/src/instance-hue.ts`, `web/src/components/that-ticket-row.ts`,
  `web/src/week-grid.ts`. Nothing else in `web/src`.
- TypeScript `strict` with `noUncheckedIndexedAccess`: no `any`, `as any` or non-null assertion.
- `that-tooltip` needs its trigger's `id` (`for`). Give each of the two dots a unique id, following the
  id scheme each file already uses for its other tooltip triggers (`that-ticket-row.ts` keeps
  per-instance ids from a module sequence; `week-grid.ts` has `keyTooltip`). The tooltip is a plain
  one: no `when-cut`, no `wrap`. Default placement (above). The dot gets no `tabindex`.
- **TDD.** RED fails on an assertion for the reason the test names. A test that passes before the
  change is a *guard*, proven by mutation. **Every assertion a task adds or changes is proven by
  mutation**: break the guarded code by hand, run that one test, show it red, restore, show it green.
- Prettier: `docker compose run --rm --no-deps web npx prettier --write src/<file>` (the path is
  relative to `web/` inside the container). Do not run Prettier on `.claude/e2e/`.
- One spec: `docker compose --profile e2e rm --stop --force app-e2e`, then
  `docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test <spec> --reporter=line -g "<title>"'`,
  then remove `app-e2e` again.
- Commits: if `git commit` fails on signing, retry with `git -c commit.gpgsign=false commit …`.
  Never push.

## Task 1: No dot carries a title; the ticket-row and Week dots get a hover tooltip

**Files:** the three product files; the e2e specs that already cover a ticket row's dot, the Week
grid's dot, and the other four dot sites (find them by searching the specs for `that-dot` /
`title`). Update any existing assertion that expects a dot's `title`.

### Tests

1. **No title anywhere:** on Today (with groups, a ticket row and the search panel open), Week, the
   entry dialog and Settings, no `.that-dot` carries a `title` attribute.
2. **Still labelled:** every `.that-dot` with `role="img"` has an `aria-label` naming its instance.
   (This holds on `main`, so it is a guard.)
3. **Ticket-row hover:** hovering the dot in a ticket row shows a `that-tooltip` whose text is the
   instance name.
4. **Week hover:** hovering the dot in a Week grid row shows a `that-tooltip` whose text is the
   instance name.
5. **No tooltip at the other four:** hovering the dot in Today's group heading, the search panel's
   group heading, a Settings row and the entry dialog header opens no `that-tooltip`. (No
   `:popover-open` tooltip anywhere after the hover.)
6. **Not a Tab stop:** no `.that-dot` has a `tabindex`. Tabbing through one Today ticket row and one
   Week row visits the same controls as on `main`. Assert the exact sequence of focused elements.

RED: tests 1, 3 and 4 fail before the change. Tests 2, 5 and 6 are guards.

Mutations (each red on its assertion, then restored):
- `title` put back in `paintInstanceDot` → 1 red;
- `aria-label` removed from `paintInstanceDot` → 2 red;
- ticket-row tooltip text set to `""` (or the tooltip not appended) → 3 red;
- Week tooltip not appended → 4 red;
- a tooltip added to Today's group-heading dot → 5 red;
- `tabIndex = 0` on the ticket-row dot → 6 red.

### Screenshots for the pull request

Capture the open tooltip on a ticket-row dot and on a Week-row dot, each in **dark and light** (set
the theme the way the app's theme control does). Capture at rest: the pointer on the dot, nothing else
hovered or focused. Write the files to `/e2e/test-results/shots/` in the container (host:
`.claude/e2e/test-results/shots/`), and name each one for what it shows plus `-dark` or `-light`:
`ticket-row-dot-tooltip-dark.png` and so on. Delete the capture spec afterwards, and commit neither
it nor the images.

### Compare against the drawing

The tooltip is #246's skin, which the existing tooltip tests pin. Compare the captured tooltip against
the visual language spec's tooltip and the prototype's `.tip` (under `docs/superpowers/`): ground,
ink, radius, arrow, and the 7 px gap above the trigger. Say in the report what you compared and what
you found. Report any difference; do not absorb it.

One commit: `#259: instance dots carry the app's tooltip, not a native title`.

## Task 2: Final gates

`make verify` and `make test-e2e`, both green, tails pasted. No commit.

## Out of scope

Escape and the rest of WCAG 1.4.13 (#267). Any change to what a dot shows.
