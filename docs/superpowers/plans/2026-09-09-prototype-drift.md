# Prototype drift, corrected — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-09-09
**Supersedes:** nothing
**Superseded by:** nothing

**Goal:** Bring the shipped UI back to the drawing it was built from, and leave behind one gate that
catches the same class of drift the day it happens.

**Architecture:** Forty-seven acceptance criteria, all of them differences between
`docs/superpowers/prototypes/2026-09-03-app-prototype.html` and what the app renders. Nothing here
adds a feature; every value is transcribed from the drawing or from the visual language, never
chosen. The work is grouped by region so a reviewer sees one surface at a time, and the two
structural changes — the rail becoming fixed beside a scrolling viewport, and Week's grid moving
into a card — are tasks of their own because they move layout rather than paint it.

**Tech Stack:** Vanilla TypeScript (strict, `noUncheckedIndexedAccess`), Tailwind CSS v4 with tokens
in `@theme`, native WebComponents in light DOM, `node --test` for unit tests, Playwright for
end-to-end.

**Spec:** Codeberg issue **#117**, which carries the acceptance criteria in full. The drawings it
argues from:

- `docs/superpowers/prototypes/2026-09-03-app-prototype.html` — the prototype of record
- `docs/superpowers/specs/2026-09-03-visual-language-design.md` — the visual language, second
  edition, including **Decision 12**, settled on 2026-09-09 while this plan was being written
- `docs/superpowers/specs/2026-09-03-today-and-week-design.md` — Today and Week
- `docs/superpowers/specs/2026-09-07-edit-after-push-and-week-fetch-design.md` — #10's fetch control

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Local development runs in Docker.** No Go, Node or npm on the host. Everything goes through
  `make` or `docker compose`.
- **No JavaScript frameworks.** Vanilla JS, TypeScript for typing. No `any`, no `as any`, no
  non-null assertion to get past a type error.
- **Tailwind CSS v4, CSS-first.** There is no `tailwind.config.js`. Theme values live in `@theme` in
  `web/src/styles.css`.
- **Reusable UI is a `that-*` WebComponent in light DOM.** Never shadow DOM. A one-off control in
  one view stays a plain element — that is why `weekButton` and `fetchButton` are not components.
- **The initial HTTP response stays under 14kB.** `web/index.html` carries the shell and inlined
  critical CSS only.
- **Firefox and Chromium only.** Safari and WebKit are an explicit non-goal; do not add them to the
  matrix or report them as missing coverage.
- **Every value is transcribed, never invented.** If a number is not in the prototype, the visual
  language or a design document, it is not settled and the task stops rather than guessing.
- **Comments are few.** A comment earns its place for a non-obvious why, an external workaround or a
  subtle invariant. Never narrate the next line.
- **A function's name must let a reader predict what it returns.**
- **No test contacts a real Jira instance.**

## How verification works here, and why it is mostly end-to-end

Most of these criteria are computed styles and geometry, and the frontend unit suite has no DOM —
`node --test` runs the `.ts` directly with no jsdom. So:

- **A value that lives in `styles.css` or `@theme`** is asserted in `web/src/tokens.test.ts`, which
  reads the stylesheet as text. That is the cheapest gate and the first choice where it fits.
- **Anything rendered** is asserted in Playwright under `.claude/e2e/tests/`, reading
  `getComputedStyle` or a bounding box. The existing suites show the idiom; `table.spec.ts` stubs
  `/api/issues`, `/api/pins` and `/api/entries` in a `beforeEach` and measures what lands.
- **Pure logic** — the tally arithmetic in Task 7, the lint's matching rule in Task 1 — is a unit
  test.

**Every task that puts something on screen names the drawing as required reading, and the
implementer's report says what it compared and what it found.** "Looks right" is not a comparison.
A reviewer who cannot see the comparison in the report treats that as a finding.

## Keeping the ticket's checkboxes current

**After each task's review confirms a criterion, tick it in issue #117's body; if a later pass shows
one regressed, untick it.** The tick follows the review, never the implementer's own claim. The
mechanism:

```bash
tea api "repos/{owner}/{repo}/issues/117" | python3 -c "import json,sys; print(json.load(sys.stdin)['body'])" > /tmp/117.md
# edit the confirmed "- [ ]" lines to "- [x]"
tea api --method PATCH "repos/{owner}/{repo}/issues/117" -F body=@/tmp/117.md
```

## File structure

| File | What changes |
| --- | --- |
| `web/tools/unused-tokens.mjs` | **New.** The token-consumer lint, run from `npm run lint`. |
| `web/tools/token-allowlist.json` | **New.** Declared-but-unconsumed tokens, one reason each. |
| `web/package.json` | `lint` runs the token check as well as eslint. |
| `web/index.html` | Rail geometry, both dividers, Push's live classes, the shell's scroll structure. |
| `web/src/styles.css` | The rail's hover and focus rules, the grid's card, nav row treatment. |
| `web/src/rail.ts` | `RailPeriod.pushLabel`, the pending colour, the split's typography and spacing. |
| `web/src/views/today.ts` | Headings, tallies, message states, the refresh control's label. |
| `web/src/views/week.ts` | The grid's card and scroll container, header shape, columns, the refresh control. |
| `web/src/components/that-tooltip.ts` | Opens above its trigger. |
| `web/src/components/that-table.ts` | Header cell type treatment, the sort chevron at rest. |
| `web/src/components/that-ticket-row.ts` | The pin control's hit area and negative margin. |
| `web/src/components/that-duration.ts` | Control height, stepper glyph size. |
| `web/src/components/that-button.ts` | Control height, the primary's hover. |
| `web/src/components/that-entry-dialog.ts` | The dialog's edge, row tooltips, the duration face, the empty line. |
| `web/src/components/that-confirm.ts` | The same edge as the entry dialog. |
| `web/src/icons.ts` | `pin` and `pin-off`, transcribed from the drawing. |
| `docs/superpowers/prototypes/2026-09-03-app-prototype.html` | The six corrections in Task 12. |
| `docs/superpowers/specs/2026-08-20-visual-design-language.md` | The divider line R8 overrides. |
| `.claude/e2e/tests/*.spec.ts` | The assertions for everything above. |

## Task order, and the two places it matters

Twelve tasks. The order is mostly free, with two constraints that are not:

1. **Task 1 lands the lint and the two orphan tokens it would flag, together.** Splitting them
   leaves the gate red between two tasks.
2. **Task 4 changes `that-tooltip` app-wide**, so Week's cells and the dialog's rows inherit it.
   Tasks 9, 10 and 11 assert tooltip position; they read better after it.

---

### Task 1: The lint that catches this class of drift, and the two tokens that prove it

**Covers:** R1, R2, and the lint criterion under *The drawing, and a gate*.

**Files:**
- Create: `web/tools/unused-tokens.mjs`
- Create: `web/tools/token-allowlist.json`
- Modify: `web/package.json` (the `lint` script)
- Modify: `web/index.html` (`#rail-push`'s classes)
- Modify: `web/src/rail.ts` (`paintUnpushed`)
- Test: `web/src/tokens.test.ts`, `.claude/e2e/tests/push.spec.ts`

**Interfaces:**
- Produces: `node tools/unused-tokens.mjs` exits non-zero and names every declared `@theme` token
  with no consumer outside the allowlist. Later tasks that consume a token remove its allowlist
  entry in the same commit.

**What the matching rule is.** A token counts as consumed when any of these appears in
`web/index.html`, `web/src/**/*.css` or `web/src/**/*.ts` **excluding `*.test.ts`**:

| Token family | Consumer forms |
| --- | --- |
| `--color-X` | `var(--color-X)`, or a class `(text\|bg\|border\|fill\|stroke\|ring\|outline\|decoration\|divide\|accent\|caret\|placeholder\|from\|via\|to\|shadow)-X` |
| `--text-X` | `var(--text-X)` or the class `text-X` |
| `--radius-X` | `var(--radius-X)` or a class `rounded-X` / `rounded-<side>-X` |
| `--font-X` | `var(--font-X)` or the class `font-X` |
| `--shadow-X` | `var(--shadow-X)` or the class `shadow-X` |
| `--breakpoint-X` | `var(--breakpoint-X)` or the variant prefix `X:` |

**Two rules that decide whether this lint is worth having:**

- **A token referenced by another token inside `@theme` counts as consumed.** `--color-edge-ring`
  is used only by `--shadow-card`; without this rule the lint's first run is a false positive.
- **A `*.test.ts` file is not a consumer.** `--color-pending-rail` is named in `tokens.test.ts`
  today, which is exactly how it stayed invisible while nothing painted with it.

**Expected first run, before any fix:** `--text-2xl`, `--color-hover-rail`,
`--color-primary-rail-ink`, `--color-running-rail`, `--color-pending-rail`. This task consumes two
of them; Task 2 consumes `--color-hover-rail`. The allowlist ships with the other two:

```json
{
  "--color-running-rail": "The rail's running-timer line is #8. Remove this entry when #8 lands.",
  "--text-2xl": "The type ramp is a scale, declared whole; no component sits at this step yet."
}
```

- [ ] **Step 1: Write the failing test for the lint's own rule**

The suite's glob is `src/**/*.test.ts`, so the test sits at `web/src/unused-tokens.test.ts` and
imports the tool from `../tools/unused-tokens.mjs`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { unconsumedTokens } from "../tools/unused-tokens.mjs";

test("a token used only by another token in @theme is consumed", () => {
  const css = `@theme {\n  --color-ring: oklch(0.9 0 0);\n  --shadow-card: inset 0 0 0 1px var(--color-ring);\n}`;
  assert.deepEqual(unconsumedTokens(css, ["body { box-shadow: var(--shadow-card); }"]), []);
});

test("a token named only in a test file is not consumed", () => {
  const css = `@theme {\n  --color-pending-rail: oklch(0.8 0.13 85);\n}`;
  assert.deepEqual(unconsumedTokens(css, []), ["--color-pending-rail"]);
});

test("a Tailwind utility class counts as a consumer", () => {
  const css = `@theme {\n  --color-pending-rail: oklch(0.8 0.13 85);\n}`;
  assert.deepEqual(unconsumedTokens(css, ['<span class="text-pending-rail">']), []);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `docker compose run --rm --no-deps web node --test 'src/unused-tokens.test.ts'`
Expected: FAIL — cannot find module `../tools/unused-tokens.mjs`.

- [ ] **Step 3: Write the tool**

`web/tools/unused-tokens.mjs` exports `unconsumedTokens(css, sources)` for the test and, run as a
script, reads `src/styles.css` plus the source files, subtracts the allowlist, prints one line per
orphan and exits 1 when the list is non-empty. Keep the exported function pure — file reading
belongs in the script half, or the test needs a filesystem.

- [ ] **Step 4: Run the unit test, then the tool itself**

Run: `docker compose run --rm --no-deps web node --test 'src/unused-tokens.test.ts'` — expect PASS.
Run: `docker compose run --rm --no-deps web node tools/unused-tokens.mjs` — expect the five tokens
above, exit 1. **Paste that output into the task report:** it is the RED this whole task exists for.

- [ ] **Step 5: Give Push its live colours (R1)**

`web/index.html`, `#rail-push`. The drawing is `.push`: `height: 44px`, `border-radius: var(--r-sm)`,
`background: var(--pri)`, `color: var(--pri-ink)`, `font-size: 14px`, `font-weight: 700`, and
`filter: brightness(1.07)` on hover. `h-11` is already 44px. The live state becomes
`bg-primary-rail text-primary-rail-ink hover:brightness-[1.07]`; **the disabled state does not
change** — `disabled:bg-transparent disabled:text-rail-muted` and the `border-rail-active` border
stay exactly as they are.

- [ ] **Step 6: Give the unpushed count the pending amber (R2)**

`web/src/rail.ts`, `paintUnpushed`. It already swaps `text-failed-rail` and `text-rail-muted`; add
the third state, so an empty queue is `text-rail-muted` and a non-empty one is `text-pending-rail`.
`showPushError` keeps `text-failed-rail` and must still win — check the class list it leaves behind.

- [ ] **Step 7: Assert both in the end-to-end suite**

`.claude/e2e/tests/push.spec.ts`. With entries stubbed unpushed, the count's colour resolves to the
pending token's value and Push's background resolves to the primary rail token's; with none, the
count is rail-muted and Push is transparent. Read the expected values from `styles.css` rather than
hardcoding an `oklch()` string in the test.

- [ ] **Step 8: Wire the lint into the gate**

`web/package.json`: `"lint": "node tools/unused-tokens.mjs && eslint src"`. CI runs `npm run lint`
directly, so this reaches `.forgejo/workflows/verify.yml` with no edit there — confirm by reading
the workflow rather than assuming.

- [ ] **Step 9: Green the gate**

Run: `make lint` and `make test-e2e`. The tool now reports only the two allowlisted tokens, which it
must not fail on. Paste both outputs.

- [ ] **Step 10: Commit**

```bash
git add web/tools web/package.json web/index.html web/src/rail.ts web/src/unused-tokens.test.ts .claude/e2e/tests/push.spec.ts
git commit -m "feat(#117): a token with no consumer fails the lint, and two stop being orphans"
```

---

### Task 2: The rail's own surface — what Push says, dividers, geometry, hover, focus, and the split's ink

**Covers:** R3, R5, R6, R8, R12.

**Files:**
- Modify: `web/index.html` (rail padding, gap, both dividers)
- Modify: `web/src/styles.css` (`.that-nav` hover and focus, the rail's focus treatment)
- Modify: `web/src/rail.ts` (`figures`, `bar`, the split's spacing)
- Modify: `web/tools/token-allowlist.json` (nothing to remove — `--color-hover-rail` becomes consumed)
- Test: `.claude/e2e/tests/smoke.spec.ts`

**The drawn values, from `.rail`, `.readout`, `.sbar`, `.sline`, `.hr` and `nav.rn`:**

| What | Drawn | Shipped |
| --- | --- | --- |
| Rail padding | `22px 14px` | `px-3.5 py-6` — 24px block |
| Rail gap | `26px` | `gap-[30px]` |
| Readout gap, which is the spacing between figure rows | `8px` | `gap-3` on the split, `gap-[7px]` between rows |
| Split bar height | `6px`, `margin-top: 4px` | `h-[7px]`, no top margin |
| Divider | `height: 2px`, `background: var(--rail-active)`, `border-radius: 1px`, `margin: 4px 0` | one divider, `h-px`, no radius |
| Dividers, how many | **two** — below the split, and below Push above the nav | one |
| Instance name in the split | `--rail-muted`; only the figure is `--rail-ink` | both inherit rail ink |
| Nav row hover | `background: var(--rail-active)`, `color: var(--rail-ink)` | colour only |
| Cog and rail controls | `background: var(--hover-rail)` on hover **and** `:focus-visible` | no focus treatment |

**R6 is the one to read twice.** In `figures()` the row is `text-base` and the name inherits the
rail's ink. The drawing puts the name at `--rail-muted` and lifts only the figure to `--rail-ink`,
which is what makes a column of figures scannable.

- [ ] **Step 1: Write the failing end-to-end assertions**

`.claude/e2e/tests/smoke.spec.ts`, a new `test.describe("the rail's geometry")`. Assert the rail's
computed `padding`, its `row-gap`, that **two** elements match the divider rule inside the rail, and
that a nav row's background changes on hover. Keyboard focus: `page.keyboard.press("Tab")` until the
nav row has focus, then assert its background is the rail hover mix rather than transparent. For R3,
assert Push reads "Push to Jira" on Today and "Push this week" on Week, after a navigation rather
than on first paint.

- [ ] **Step 2: Run them and watch them fail**

Run: `make test-e2e`
Expected: FAIL — one divider found, padding 24px, focus background transparent.

- [ ] **Step 3: Correct the rail's box in `index.html`**

`py-6` becomes `py-[22px]`, `gap-[30px]` becomes `gap-[26px]`. Add the second divider as a sibling
after `#rail-push`, and give both `h-0.5 rounded-[1px] my-1` alongside `bg-rail-active`.

- [ ] **Step 4: Correct the split in `rail.ts`**

`bar()` becomes `h-1.5` with `mt-1`; the figures list gap becomes `gap-2`; `#rail-split`'s own
`gap-3` becomes `gap-2`. In the row, the name takes `text-rail-muted` and the figure takes
`text-rail-ink`.

- [ ] **Step 5: Let the period name its own Push (R3)**

`web/src/rail.ts`. `RailPeriod` carries `pushHeading` already, for the confirmation; it gains
`pushLabel` beside it. `TODAY_PERIOD` takes `"Push to Jira"`, and the period Week builds in
`week.ts` takes `"Push this week"`. `paint()` writes it to the button, so `web/index.html:99` stops
being the only place the words exist — leave the markup's text as the pre-boot resting state, which
is what it already is for every other region.

- [ ] **Step 6: Add the hover and focus rules**

`web/src/styles.css`. `.that-nav:hover` gains `background: var(--color-rail-active)`, and a
`.that-rail :focus-visible` rule paints `var(--color-hover-rail)`. Keep it a rule rather than a
utility repeated per element — the file already argues why for `.that-nav`.

- [ ] **Step 7: Run the tests**

Run: `make test-e2e`
Expected: PASS. Then `make lint` — `--color-hover-rail` has a consumer now and the lint's list is
down to the two allowlisted tokens.

- [ ] **Step 8: Commit**

```bash
git add web/index.html web/src/rail.ts web/src/views/week.ts web/src/styles.css .claude/e2e/tests/smoke.spec.ts
git commit -m "feat(#117): the rail's geometry, its two dividers, and a focus ring it never had"
```

---

### Task 3: The rail is fixed, and the content scrolls beside it

**Covers:** R4, R7.

**Files:**
- Modify: `web/index.html` (the shell grid)
- Modify: `web/src/router.ts` (scroll reset on view change)
- Test: `.claude/e2e/tests/smoke.spec.ts`

**What the drawing does.** `.app` is a fixed-height flex row; `.rail` is `flex: none`; `.viewport`
is `flex: 1` with `overflow-y: auto` and is the query container. The app puts the scroll on the
page, so a long Today takes the rail's total, its split and Push off the screen — the exact opposite
of "the instrument you glance at".

**Two things not to break.** The container query lives on `main` and the instance grid measures
against it, so `@container` must stay where it is. And the rail keeps its `md:` breakpoint
behaviour: below it, the layout is one column and the rail is not fixed.

- [ ] **Step 1: Write the failing test**

Assert that with enough rows to overflow, `window.scrollY` stays 0 while the content region's
`scrollTop` moves, and that the rail's bounding box does not move. Then navigate Today → Week →
Today and assert the content region's `scrollTop` is 0 after each change.

- [ ] **Step 2: Run it and watch it fail**

Run: `make test-e2e`
Expected: FAIL — the page scrolls and the rail leaves the viewport.

- [ ] **Step 3: Make the shell own the scroll**

`web/index.html`: the grid becomes `h-screen` rather than `min-h-screen`, the rail column gains
`overflow-y-auto` for its own overflow, and `main` gains `overflow-y-auto min-h-0`. `min-h-0` is
load-bearing: a grid item's default `min-height: auto` refuses to shrink and the scroll silently
lands on the page again.

- [ ] **Step 4: Reset the scroll on a view change**

`web/src/router.ts`, where the view element is replaced. Set the scrolling region's `scrollTop` to 0
after the new view mounts. Do it in the router rather than in each view: a view that forgets is
exactly the drift this ticket is about.

- [ ] **Step 5: Run the tests, and the whole suite**

Run: `make test-e2e`. Every existing spec that scrolls to reach a control is affected by this
change, so a green run of the **whole** suite is the deliverable, not just the new file.

- [ ] **Step 6: Commit**

```bash
git add web/index.html web/src/router.ts .claude/e2e/tests/smoke.spec.ts
git commit -m "feat(#117): the rail stays put, and the content scrolls beside it"
```

---

### Task 4: A tooltip opens above its trigger

**Covers:** T7.

**Files:**
- Modify: `web/src/components/that-tooltip.ts` (`reveal`)
- Test: `.claude/e2e/tests/tooltip.spec.ts`

**The drawing:** `.tip` sits at `bottom: calc(100% + 7px)`, above the control, centred. `.tip.below`
is the modifier for the two places that need the other side. The app places every tooltip below its
trigger at a 6px gap.

**This is app-wide.** Week's cells, the dialog's rows, Today's icon buttons and the pin control all
consume it, so this task is where the position changes and the later tasks assert it in place.

- [ ] **Step 1: Write the failing test**

In `tooltip.spec.ts`, assert the tooltip's bottom edge sits above the trigger's top edge, with the
drawn 7px between them, for a control near the middle of the viewport.

- [ ] **Step 2: Run it and watch it fail**

Run: `make test-e2e`
Expected: FAIL — the tooltip is below.

- [ ] **Step 3: Flip the placement**

In `reveal()`, `top` becomes `box.top - this.offsetHeight - gap` and `gap` becomes 7. Keep all four
longhands written, for the reason the existing comment gives.

- [ ] **Step 4: Run the tests**

Run: `make test-e2e`. Watch for specs that assumed the old side — `pins.spec.ts` and `week.spec.ts`
both read tooltip geometry.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/that-tooltip.ts .claude/e2e/tests/tooltip.spec.ts
git commit -m "feat(#117): a tooltip opens above the control it explains"
```

---

### Task 5: Today's type, and the states that lost their card

**Covers:** T1, T2, T8, T9, T10, T11, T12, T13, T14.

**Files:**
- Modify: `web/src/components/that-table.ts` (header cells, the chevron at rest)
- Modify: `web/src/styles.css` (`.that-tbl th` block padding, card padding)
- Modify: `web/src/views/today.ts` (`pageHeading`, `loadingLine`, `noInstances`, the tally's opacity, the header's `hidden`)
- Modify: `web/src/components/that-ticket-row.ts` (the key's native title, the Log hint's spacing)
- Test: `.claude/e2e/tests/today.spec.ts`, `.claude/e2e/tests/table.spec.ts`

**The drawn values:**

| Criterion | Drawn |
| --- | --- |
| T1 | `.tbl th`: `12px`, weight 700, `letter-spacing: .06em`, uppercase, `padding-block: 9px` |
| T2 | `.tbl .c-today, .tbl th.c-today { text-align: right }` |
| T8 | the sort chevron carries `opacity: .45` at rest; full strength only on the sorted column |
| T9 | `.durbtn .hint { margin-right: 10px }` and nothing else between hint and figure |
| T10 | `.grouph .n { opacity: .75 }` |
| T11 | `.tcard { padding: 14px 20px }` — the app's `px-5 py-4` is 16px block |
| T12 | every key carries `title="Open <KEY> in Jira"` |
| T13 | both `.pageh` blocks are drawn from first paint |
| T14 | a message state sits in `.tcard` like every other |

**T13 is a behaviour change, not a class change.** `render()` sets `header.hidden = true` and lifts
it on the first response. The drawing shows both headings from the first frame. Keep the *refresh
control* hidden until there is something to refresh — that reasoning still holds — and unhide the
heading itself.

- [ ] **Step 1: Write the failing assertions**

`today.spec.ts`: on first paint, before any `/api/issues` response resolves, both "Pinned" and
"Assigned issues" are visible. The loading line sits inside a `that-card`. A ticket key has the
native title. `table.spec.ts`: a header cell's computed `font-size`, `letter-spacing`,
`text-transform` and block padding; the Today column's `text-align`; the chevron's opacity.

- [ ] **Step 2: Run them and watch them fail**

Run: `make test-e2e`
Expected: FAIL on each of the nine.

- [ ] **Step 3: Correct the table shell**

`that-table.ts`: the header button becomes `text-xs font-bold tracking-[0.06em] uppercase`, and the
chevron's markup takes `opacity-45`. `styles.css`: `.that-tbl th` block padding becomes 9px while
`td` keeps 11px — they are one rule today and must be split.

- [ ] **Step 4: Correct the card and the message states**

`that-card` and `that-table`'s own class list become `px-5 py-3.5`. In `today.ts`, `loadingLine()`
and `noInstances()` are wrapped by `cardHolding()` at every call site.

- [ ] **Step 5: Correct the headings, the tally and the key**

Unhide the assigned heading at first paint, keeping the refresh control hidden. The tally gains
`opacity-75`. In `that-ticket-row.ts`, the key element takes `title="Open ${key} in Jira"` — the
prototype writes exactly that string.

- [ ] **Step 6: Run the tests**

Run: `make test-e2e` and `make verify`. Paste both.

- [ ] **Step 7: Commit**

```bash
git add web/src/components web/src/styles.css web/src/views/today.ts .claude/e2e/tests
git commit -m "feat(#117): Today's headers, its states, and the card padding they all sit in"
```

---

### Task 6: The controls in a row — hit areas, and the two pin glyphs

**Covers:** T4, T5, T6.

**Files:**
- Modify: `web/src/icons.ts` (`pin`, `pin-off`)
- Modify: `web/src/components/that-ticket-row.ts` (the pin control, the duration control)
- Test: `web/src/icons.test.ts`, `.claude/e2e/tests/pins.spec.ts`

**The drawing:**

- `.iconbtn` is `34px` square with `margin-right: -8px`, so its ink reaches the card's edge rather
  than stopping a hover box short of it. The app's control is 34px with no negative margin (T4).
- `.durbtn` is `padding: 9px 13px; margin: -9px -13px -9px 0`, so the hover box is bigger than the
  text and nothing moves when it appears (T5).
- `#p-pin` and `#p-pinoff` are the drawn paths. `icons.ts` carries an authored pair (T6).

**T6 is a transcription, not a redraw.** Copy the `d` attributes out of the prototype's `<defs>`
verbatim. If a path looks wrong on screen, that is a finding for the owner, not licence to redraw —
the fetch glyph's history in `icons.ts` says why in as many words.

- [ ] **Step 1: Write the failing unit test**

`web/src/icons.test.ts`: assert `iconMarkup("pin")` contains the prototype's exact path data. Paste
the `d` string into the test from the drawing, so the test fails today.

- [ ] **Step 2: Run it and watch it fail**

Run: `docker compose run --rm --no-deps web node --test 'src/icons.test.ts'`
Expected: FAIL — the shipped path differs.

- [ ] **Step 3: Transcribe the two paths**

From the prototype's `<defs>`: `#p-pin` and `#p-pinoff`, copied `d` for `d` into `icons.ts`'s `pin`
and `pin-off` entries. Nothing else in the file changes.

- [ ] **Step 4: Write the failing geometry assertions**

`pins.spec.ts`: the pin control's right edge sits on the card's content edge; hovering the duration
control paints a box wider than its text and moves no neighbour.

- [ ] **Step 5: Give both controls their drawn boxes**

- [ ] **Step 6: Run everything**

Run: `make verify` and `make test-e2e`.

- [ ] **Step 7: Commit**

```bash
git add web/src/icons.ts web/src/icons.test.ts web/src/components/that-ticket-row.ts .claude/e2e/tests/pins.spec.ts
git commit -m "feat(#117): the drawn pin, and two hit areas that reach their edges"
```

---

### Task 7: An instance's tally agrees with the rail

**Covers:** T3.

**Files:**
- Modify: `web/src/views/today.ts` (`paintInstanceTallies`, and what it is given)
- Test: `.claude/e2e/tests/today.spec.ts`

**The defect.** `paintInstanceTallies` sums the `seconds` attribute of the rows on screen. An
instance's pinned tickets are filtered *out* of its card, so their time is missing from the tally
while the rail's split counts it. Two figures for one instance, on one screen, disagreeing.

**The fix.** The time half of the tally comes from `regions.totals`, summed over every entry whose
`instanceId` matches — the same set the rail slices. **The issue count stays what the card shows**,
because it counts rows the reader can see. The middot line then reads "3 issues · 6h 45m" where the
figure may exceed what the visible rows add up to, and that is correct: it is the instance's day.

- [ ] **Step 1: Write the failing test**

`today.spec.ts`: stub two issues for an instance and pin one, with entries against both. Assert the
tally's figure equals the sum of both entries, and that it equals the rail's figure for that
instance.

- [ ] **Step 2: Run it and watch it fail**

Expected: FAIL — the tally shows only the unpinned issue's time.

- [ ] **Step 3: Pass the totals to the tally**

`paintInstanceTallies` currently takes no arguments and reads the DOM. Give it the `Regions` it
needs and key the sum by instance. The section already knows its instance through the heading's id
(`today-instance-<id>`); read the id rather than adding a second source of truth.

- [ ] **Step 4: Run the tests**

- [ ] **Step 5: Commit**

```bash
git add web/src/views/today.ts .claude/e2e/tests/today.spec.ts
git commit -m "fix(#117): an instance's tally counts its pinned time too"
```

---

### Task 8: Decision 12 — the toolbar's buttons carry words

**Covers:** T15, W5.

**Files:**
- Modify: `web/src/views/today.ts` (the refresh control)
- Modify: `web/src/views/week.ts` (a refresh control, beside the fetch)
- Test: `.claude/e2e/tests/today.spec.ts`, `.claude/e2e/tests/week.spec.ts`

**What was settled on 2026-09-09**, and is Decision 12 in the visual language:

- Week gains a refresh control, **labelled**, sitting **after the rule and before `Fetch
  worklogs`**. It re-reads the week from this app's own database; it calls no Jira endpoint.
- Today's refresh **gains its label**. It is a header control acting on the whole view.
- Week's arrows and the dialog's close are exempt and do not change.

**Do not reuse `appendIconButton` for either.** It builds a 34px square glyph-only control with a
tooltip, which is the inline form. A toolbar button is the shape `fetchButton()` already has in
`week.ts`: `h-9`, `px-3`, `gap-2`, `text-base font-bold text-ink-muted`, an icon span and a text
span. Today's refresh becomes that shape; Week's refresh is that shape with the `refresh` glyph.

**Week's refresh reads, and writes nothing.** It calls the same read `show()` already performs. It
is enabled from the first successful read, like the fetch beside it, and disabled while either
control is in flight — pressing refresh mid-fetch would paint a half-applied week.

- [ ] **Step 1: Write the failing tests**

`week.spec.ts`: a control named "Refresh" exists in the header, sits between the rule and "Fetch
worklogs" in document order, and re-reads `/api/week` when pressed. `today.spec.ts`: the refresh
control's accessible name is "Refresh" and its text content is "Refresh" — not an empty button with
a tooltip.

- [ ] **Step 2: Run them and watch them fail**

Expected: FAIL — Week has no refresh; Today's has no text.

- [ ] **Step 3: Extract the toolbar button shape**

Both views need it, and `week.ts` already holds it inside `fetchButton`. Lift a
`toolbarButton({ icon, label })` helper into `web/src/toolbar-button.ts` returning an
`HTMLButtonElement`, and have `fetchButton` build on it so there is one shape rather than three.
It is a plain function and not a `that-*` component: it renders a bare button with no state.

- [ ] **Step 4: Build both controls**

- [ ] **Step 5: Run the tests**

Run: `make verify` and `make test-e2e`.

- [ ] **Step 6: Commit**

```bash
git add web/src/toolbar-button.ts web/src/views/today.ts web/src/views/week.ts .claude/e2e/tests
git commit -m "feat(#117): a toolbar button carries words, and Week gains its refresh"
```

---

### Task 9: Week's grid becomes a card

**Covers:** W1, W2, W3, W6, W7, W9.

**Files:**
- Modify: `web/src/views/week.ts` (`gridTable`, `headCell`, the header box)
- Modify: `web/src/styles.css` (a `.that-grid` rule, if the column rules do not fit utilities)
- Test: `.claude/e2e/tests/week.spec.ts`

**The drawn values, from `.grid` and its neighbours:**

| Criterion | Drawn |
| --- | --- |
| W1 | the grid sits in `.tcard` — `--raised`, `--r-md`, the card shadow, `14px 20px` — and scrolls inside its own container |
| W2 | `.grid .fig` and `.grid .kk` are `'Chivo Mono'`; the table is `font-variant-numeric: tabular-nums` throughout |
| W3 | `.grid thead th`: `12px`, weight 700, `.06em`, uppercase, `padding-bottom: 9px`, hairline under |
| W6 | `tbody` rows are `46px`; `.cell` is `padding: 9px 13px; margin: -9px -13px`; `tfoot` is `padding-block: 12px` |
| W7 | the title sits in the app's page-heading shape — the `.pageh` Today uses |
| W9 | `th + th`/`td + td` carry `padding-left: 10px`; `.tk` is `width: 1%`, nowrap, `padding-right: 10px`; `.tot` carries `padding-left: 18px` |

**W1's second half matters more than its first.** The page body must never scroll sideways, so the
card gets `overflow-x-auto` and the table is allowed to be wider than it — the same bargain
`that-table` already documents for the phone.

**W7 is a downgrade in size, deliberately.** Week's title is `text-xl font-bold` today; the drawing's
`.pageh h3` is 15px at weight 500, which is `text-lg font-medium` — exactly what `pageHeading` in
`today.ts` builds. Reuse that shape rather than restating it: lift `pageHeading` into a shared module
if that is cleaner than importing across views, but do not leave two copies.

- [ ] **Step 1: Write the failing assertions**

`week.spec.ts`: the grid's ancestor has the raised background and the card shadow; a wide week
scrolls that container and leaves `document.scrollingElement.scrollLeft` at 0; a figure cell's
`font-family` resolves to the mono face; the header cell's four type properties; a row's height; the
gaps in W9.

- [ ] **Step 2: Run them and watch them fail**

- [ ] **Step 3: Wrap the grid and correct the header box**

`gridTable` returns the table; wrap its return in the same card class list `that-table` carries —
`bg-raised shadow-card block overflow-x-auto rounded-md px-5 py-3.5` — rather than reaching for
`that-card`, which would add a heading slot the grid has no use for. The header box becomes the
`pageHeading` shape from Task 5.

- [ ] **Step 4: Correct the columns, the faces and the paddings**

- [ ] **Step 5: Run the tests**

Run: `make test-e2e`.

- [ ] **Step 6: Commit**

```bash
git add web/src/views/week.ts web/src/styles.css .claude/e2e/tests/week.spec.ts
git commit -m "feat(#117): Week's grid moves into the card it was drawn in"
```

---

### Task 10: Week's cells, its keys, and its arrows

**Covers:** W4, W12, W13, W14.

**Files:**
- Modify: `web/src/views/week.ts` (`ticketCell`, `weekButton`, the key)
- Modify: `internal/server/week.go` and its rollup type, if the issue URL is not in the response
- Test: `.claude/e2e/tests/week.spec.ts`, `internal/server/week_test.go`

**W4 needs data the rollup may not carry.** The ticket key becomes a link to the issue in Jira,
ink-muted at rest and brightening on hover — the rule Today already states in `.that-key`. **Check
`GET /api/week`'s response first.** If it carries no URL per row, this task adds it: the server
already knows the instance's site URL, and building a browse URL in the browser would put Jira's URL
shape in two places.

- [ ] **Step 1: Read the rollup, then write the failing test**

If the URL is absent, start with the Go test: `internal/server/week_test.go`, asserting the rollup's
row carries the issue's browse URL built from the instance's site URL.

- [ ] **Step 2: Run it and watch it fail**

Run: `docker compose run --rm --no-deps app go test ./internal/server/ -run TestWeek -v`

- [ ] **Step 3: Carry the URL through**

- [ ] **Step 4: Write the browser assertions**

`week.spec.ts`: the key is an anchor with the browse URL; its resting colour is ink-muted and its
hover colour is ink; a cell takes the hover wash on keyboard focus as well as pointer hover (W12);
the arrows carry the drawn popover rather than a native `title` (W13); each arrow is square at the
shared 36px control height (W14).

- [ ] **Step 5: Make them pass**

W13 means dropping `button.title` in `weekButton` and giving the control a `that-tooltip`, the same
pairing `appendIconButton` uses. Leave the `aria-label` exactly where it is — the tooltip is never
the accessible name.

- [ ] **Step 6: Run everything**

Run: `make verify` and `make test-e2e`.

- [ ] **Step 7: Commit**

```bash
git add internal/server web/src/views/week.ts .claude/e2e/tests/week.spec.ts
git commit -m "feat(#117): a week's keys open in Jira, and its cells answer the keyboard"
```

---

### Task 11: The entries dialog

**Covers:** D1, D2, D3, D4, D6, D7, D8.

**Files:**
- Modify: `web/src/components/that-entry-dialog.ts`
- Modify: `web/src/components/that-confirm.ts` (D1, the same edge)
- Modify: `web/src/components/that-button.ts` (D3 height, D8 hover)
- Modify: `web/src/components/that-duration.ts` (D3 height, D4 face, D7 glyphs)
- Test: `.claude/e2e/tests/entries.spec.ts`

**The drawn values:**

| Criterion | Drawn |
| --- | --- |
| D1 | `.sheet` carries `border: 1px solid var(--edge)` beneath `--shadow-dialog` |
| D2 | the row's edit and delete controls carry `.tip` popovers, like the cancel beside them |
| D3 | `.btn` is `height: 38px`; `.durgroup input` is `padding: 9px 8px`; the comment field is `padding: 10px 12px` |
| D4 | `.durgroup input` is `'Chivo Mono'` with tabular figures |
| D6 | `.eempty` sits **beneath** the list at `padding: 10px 20px 16px`, aligned to the header's gutter |
| D7 | the stepper's glyphs are 18px at the language's 1.9 stroke |
| D8 | `.btn.primary:hover { filter: brightness(1.07) }` — the app dims with `hover:opacity-90` |

**D3 and D8 are app-wide.** `that-button` and `that-duration` have consumers outside this dialog —
Settings, the pin form, Today's controls. **Check every consumer after the height changes**, and say
in the report which ones were looked at. A control that grows 4px inside a row with a fixed height
is exactly the kind of thing this ticket exists to catch.

**D8's difference is not cosmetic.** `opacity-90` composites the button toward whatever sits behind
it, so the primary's hover changes with its background; `brightness(1.07)` lifts the colour itself.

- [ ] **Step 1: Write the failing assertions**

`entries.spec.ts`: the dialog's computed border; the two row controls' tooltips; the button's
height; the duration field's family; the empty line's position relative to the list; the stepper
glyph's size; the primary's hover filter.

- [ ] **Step 2: Run them and watch them fail**

- [ ] **Step 3: Fix the four components**

- [ ] **Step 4: Walk every consumer of the two shared components**

List them from a grep of `that-button` and `that-duration`, open each, and check the height change
lands correctly. The report names the files.

- [ ] **Step 5: Run everything**

Run: `make verify` and `make test-e2e`.

- [ ] **Step 6: Commit**

```bash
git add web/src/components .claude/e2e/tests/entries.spec.ts
git commit -m "feat(#117): the dialog's edge, its tooltips, and one control height everywhere"
```

---

### Task 12: The drawing itself

**Covers:** the two drawing criteria — the four stale places, the two headers under Decision 12, and
the first edition's divider line.

**Files:**
- Modify: `docs/superpowers/prototypes/2026-09-03-app-prototype.html`
- Modify: `docs/superpowers/specs/2026-08-20-visual-design-language.md`

**Six corrections to the prototype**, four because the app is right and two because Decision 12 is:

1. **The wordmark's treatment.** `.wm` is 16px, weight 700, `-.02em`, in the primary. The app takes
   the visual language's eyebrow instead — 12px, weight 700, `.16em`, uppercase. The drawing follows
   the app.
2. **The hero figure's tracking.** `.hero` is drawn at `-.045em`; the app renders `-0.035em` from
   the visual language. The drawing follows the app.
3. **#10's fetch control**, which the header does not draw at all. Add it to Week's `.pageh`, after
   the rule, with the cloud-and-arrow glyph from `icons.ts` and the label `Fetch worklogs`.
4. **The day-total push markers**, which two specs require and the footer omits.
5. **Today's refresh gains its label** (Decision 12).
6. **Week's refresh gains its label**, and sits after the rule and before the fetch (Decision 12).

**One correction to the first edition.** `2026-08-20-visual-design-language.md` says the nav sits
directly under Push with no divider. R8 overrides it. Correct the line in place and say what
overrode it, in the document's own voice — this file is read by later tickets as current.

- [ ] **Step 1: Make the six prototype corrections**

- [ ] **Step 2: Open the prototype in both themes and check nothing else moved**

The file is a static page; open it in Firefox and use its own light/dark toggle. A correction that
breaks the drawing is worse than the drift.

- [ ] **Step 3: Correct the first edition's divider line**

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers
git commit -m "docs(#117): the drawing catches up with the app, and with Decision 12"
```

---

## Finishing

1. **The whole-branch review is not optional.** Every task review passed on ticket 1 while a
   Critical defect sat across two of them. Use `superpowers:requesting-code-review` against the
   whole branch before the pull request.
2. **`make verify` and `make test-e2e` both green, output pasted into the pull request.** This
   change touches the frontend and the rig, so both gates apply.
3. **Tick the confirmed criteria in #117.** By this point every box the reviews confirmed should
   already be ticked; the last pass is a reconciliation, not the first write.
4. **Open the pull request with `Closes #117`.** The open pull request is the review state, so the
   ticket keeps `status/in-progress` and no label moves.
5. **Never merge to `main` locally.** Push and open the pull request, or leave the branch alone.
   Those are the two endings.

## Risks worth stating before starting

- **Task 3 changes where the scroll lives, and every existing spec that scrolls to reach a control
  is downstream of it.** A green run of the whole suite is the only evidence that counts.
- **Task 11 changes two components with consumers in views this ticket does not otherwise touch.**
  Settings is out of scope as a *design*, but it still has to render correctly after a height
  change.
- **W4 may reach into the server.** If the rollup carries no issue URL, the task grows a Go change
  and a Go test. That is expected, not scope creep — but it is the one task that can grow.
- **The lint is a net, not a proof.** It catches a token nothing consumes. It cannot catch a class
  string that was never written, which is most of the other forty-four findings.
