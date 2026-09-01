# Plan — a visual design language for the app (#44)

**Date:** 2026-08-20
**Supersedes:** nothing
**Superseded by:** nothing

Turns the design approved board by board on 2026-08-20 into a specification, a token layer, a
self-hosted typeface, the rail shell, and a retrofit of the five existing components. The design
sources are in the repo at `docs/superpowers/canvas/2026-08-20-visual-directions/`;
`Hybrid.dc.html` is the chosen direction and holds the token set this plan transcribes.

Nothing here redesigns anything. Where a value is in question, the canvas answers it.

## What the acceptance criteria already settle

Read #44's body for the full list. The decisions this plan works under, none of them reopened here:
the rail ships in its resting state and #7–#9 make it live; per-instance hues stay and gain a rule
that survives a third instance; Space Grotesk is self-hosted; `light-dark()` stays as the mechanism;
and the Today card layout is not touched, because #6 opens `today.ts` next.

## Two facts found while planning

**`var()` inside an inherited custom property fails silently.** A token like
`--color-instance: light-dark(oklch(0.60 0.13 var(--h)), …)` declared in `@theme` resolves its
`var(--h)` where the property is *declared* — at `:root`, where `--h` does not exist — and computes
to guaranteed-invalid before it ever reaches the element. Every dot renders transparent, with
nothing in the console. Proven while building the pin restyle. The hue must therefore go in a
`background` declaration on the element itself, which means **the instance dot is a CSS rule in
`styles.css`, not a Tailwind colour utility.**

**Space Grotesk is one variable file.** Google serves the same `.woff2` for 400, 500 and 700 — a
variable face spanning the range, 22kB for the latin subset. One `@font-face` with
`font-weight: 400 700` covers every weight the design uses.

## Tasks

Each task ends green before the next begins. `make verify` after every task that touches Go or
TypeScript; `make test-e2e` after every task that touches the frontend, which is all of them from
task 3 on.

---

### Task 1 — the design document

**Create** `docs/superpowers/specs/2026-08-20-visual-design-language.md` with the Date / Supersedes /
Superseded by header.

It records, each section naming the artboard it derives from: the complete token set with both
theme values; the type scale; the format rule; the four colour roles and why they are separate from
the primary; the instance-hue rule; the rail's anatomy and which ticket fills each region; the five
screen states; the phone layout; and the manual-entry dialog's rules. It carries a contrast table
giving the measured ratio for every text and non-text pairing in both themes.

**Verify:** every value in the document appears in `Hybrid.dc.html` or is derived by a rule the
document states. No stray value.

---

### Task 2 — the typeface, self-hosted

**Create** `web/fonts/space-grotesk-latin.woff2` — the latin subset, variable, 400–700.
**Modify** `web/build.mjs` to copy `fonts/` into `dist/fonts/`. It currently copies only
`index.html`, so this is a new step, and `//go:embed all:dist` then carries the files into the
binary with no change to `embed.go`.
**Modify** `web/src/styles.css` with the `@font-face` and `--font-sans`.

**Verify:** `make build-web` puts the file in `dist/fonts/`; loading the app makes no request to any
third-party host.

---

### Task 3 — the token layer

**Modify** `web/src/styles.css`: replace the stock `@theme` block with the transcribed tokens as
`light-dark()` pairs in `oklch`, plus the type scale, plus the instance-dot rule and the hue ramp.

The ramp is six hues at fixed lightness and chroma — 265, 175, 295, 205, 115, 235 — each at least 25°
from the reserved four (primary 330, running 150, not-pushed 85, failed 25) and from its neighbours.
Assigned by instance `created_at` order and cycling beyond six.

**Verify:** `make verify`. The app still renders; colours change wholesale, which is the point.

---

### Task 4 — the format rule

**Create** `web/src/format.ts` — `timerFigure(seconds)` returning `HH:MM`, `totalFigure(seconds)`
returning `Nh Nm`.
**Create** `web/src/format.test.ts` — a **rudimentary** test under `node:test`, running on Node 26's
native type stripping with no new dependency.

**This test is deliberately minimal and is not aligned with the rest of the suite.** #51 owns the
frontend test runner properly — where the gate lives, the conventions, and improving this test into
them. It is not wired into `make verify` here, because choosing that gate is #51's decision, not a
side effect of this ticket. `make test-web` runs it.

**Verify:** `docker compose run --rm --no-deps web node --test src/format.test.ts` passes, and a
deliberately broken formatter fails it.

---

### Task 5 — the components

**Modify** all five of `web/src/components/that-{alert,button,card,confirm,ticket-row}.ts` to the
language. `that-confirm` keeps its explicit margin and its absent backdrop dismissal — both have
reasons recorded in its own comments and neither is a styling decision.

**Verify:** `make verify`, then `make test-e2e`. The settings and today specs assert behaviour rather
than appearance and should stay green; `theme.spec.ts` will not, and task 7 owns that.

---

### Task 6 — the shell

**Modify** `web/index.html`: the rail carries the day's total, the instance split, the running timer,
the unpushed count and Push, with nav below. Each region renders its resting state and names in a
comment the ticket that makes it live. **Modify** `web/src/router.ts`, whose placeholder view carries
the last two stock colour utilities in `web/src`.

**Verify:** `index.html` stays under 14kB. Routing between Today and Settings still works from the
rail.

---

### Task 7 — the gates

**Modify** `.claude/e2e/tests/theme.spec.ts`: its assertions name the stock zinc values as literal
`rgb(...)` strings and every one of them changes. Coverage of all three theme states — light, dark
and the unstamped auto — must not shrink.

**Note:** `getComputedStyle` serialises an `oklch()` colour as `oklch(...)`, not `rgb(...)`, so these
assertions change shape and not merely value. Confirm the serialisation empirically in both browsers
rather than assuming it.

**Add** coverage of the rail's resting state.

**Verify:** `make verify` and `make test-e2e` both green on Firefox and Chromium, output pasted into
the pull request.

---

## What this ticket does not do

Live rail data (#7–#9). The Today card layout (#6). Manual entry (#7) — the dialog's visual rules
are specified, not built. The week grid (#11) and the phone layout (#13) are specified, not built.
Wiring the frontend test gate (#51).
