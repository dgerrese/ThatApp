# The visual design language

**Date:** 2026-08-20
**Supersedes:** nothing
**Superseded by:** nothing

The vocabulary every view is built out of. It exists because tickets 6–12 each add a surface —
pins, timers, per-entry push state, a partial-failure report, a week grid — and each of those needs
to be assembled from parts that already agree, rather than inventing its own.

**This document is derived, not authored.** The design was worked out on a canvas and approved board
by board on 2026-08-20; the sources are in the repo at
`docs/superpowers/canvas/2026-08-20-visual-directions/`, with `annotations.md` carrying the reasoning
for each board. `Hybrid.dc.html` is the chosen direction. Every value below is transcribed from a
board or derived by a rule stated here. Where this document and the canvas disagree, that is a bug in
this document.

## The three contrast tiers

Every colour pairing falls into one of three tiers, and the tier decides the floor. This matters
because the tiers are easy to conflate, and conflating them is how a token gets used somewhere it
does not hold up.

| Tier | What it covers | Floor |
| --- | --- | --- |
| **Text** | Anything read as words | **4.5:1** |
| **Meaningful non-text** | Marks that carry information: instance dots, state ticks, the split bar, icons | **3:1** |
| **Decorative** | Hairline rules, dividers, hover washes, the rail's active-row fill | none |

Decorative separators are exempt deliberately. `--color-edge` on `--color-raised` measures 1.27:1,
and a hairline that met 3:1 would be a black line through the middle of the layout. WCAG 1.4.11
covers non-text content required to understand the interface; a divider between two rows is not
that. Every measured ratio is in the table at the end.

## `--color-ink-faint` is not a text colour

It measures **3.60:1** on `raised` in light and **3.61:1** in dark. That clears the meaningful
non-text floor and fails the text floor, and the approved boards use it in exactly one place: the
14px close icon on the manual-entry dialog.

**So it is an icon and decorative-mark tone, never words.** Text is `--color-ink` or
`--color-ink-muted`, and there is no third option. This is stated here because `ink-faint` is exactly
the token a tired implementer reaches for when something should recede — and nothing in the name
warns them, the contrast failure is invisible on a good monitor, and no test catches it.

Something that should recede *and* be read uses `--color-ink-muted` at 6.47:1.

## Tokens

Both values given as `light-dark(light, dark)`, in `oklch`, exactly as `@theme` declares them.

### Ground and ink

| Token | Light | Dark |
| --- | --- | --- |
| `--color-surface` | `oklch(0.975 0.006 70)` | `oklch(0.165 0.008 60)` |
| `--color-raised` | `oklch(0.996 0.003 70)` | `oklch(0.215 0.010 60)` |
| `--color-ink` | `oklch(0.20 0.008 70)` | `oklch(0.955 0.004 70)` |
| `--color-ink-muted` | `oklch(0.48 0.008 70)` | `oklch(0.70 0.010 65)` |
| `--color-ink-faint` | `oklch(0.62 0.007 70)` | `oklch(0.55 0.010 65)` |
| `--color-edge` | `oklch(0.915 0.006 70)` | `oklch(0.285 0.010 60)` |

### The rail

The rail is dark in **both** themes — it is the instrument, and it does not invert. Its tones are
therefore near-identical across the two.

| Token | Light | Dark |
| --- | --- | --- |
| `--color-rail` | `oklch(0.215 0.018 55)` | `oklch(0.125 0.008 55)` |
| `--color-rail-ink` | `oklch(0.965 0.004 70)` | `oklch(0.955 0.004 70)` |
| `--color-rail-muted` | `oklch(0.68 0.012 60)` | `oklch(0.64 0.012 60)` |
| `--color-rail-active` | `oklch(0.30 0.022 55)` | `oklch(0.225 0.015 55)` |

### Roles

The primary and the three state tones are **separate**, decided after one accent doing both jobs was
rejected. That rejection is the whole reason this section exists: when brand and failure shared a
hue, failure had to borrow a triangle to be distinguishable at all. Dirty shares Primary's hue
because it marks a primary action's stale consequence, not an independent state; the hollow ring
is what keeps it from reading as Primary.

| Role | Hue | Token | Light | Dark |
| --- | --- | --- | --- | --- |
| Primary | 330 | `--color-primary` | `oklch(0.52 0.19 330)` | `oklch(0.70 0.17 330)` |
| | | `--color-primary-ink` | `oklch(0.99 0.004 70)` | `oklch(0.16 0.02 330)` |
| Running | 150 | `--color-running` | `oklch(0.50 0.15 150)` | `oklch(0.74 0.14 150)` |
| Not pushed | 85 | `--color-pending` | `oklch(0.52 0.13 75)` | `oklch(0.80 0.12 85)` |
| Failed | 25 | `--color-failed` | `oklch(0.51 0.19 25)` | `oklch(0.72 0.17 25)` |
| Dirty | 330 | `--color-dirty` | `oklch(0.52 0.19 330)` | `oklch(0.70 0.17 330)` |

**Primary** carries the wordmark, Push, links and focus rings — identity, never state.
**Running** is the live timer and its stop control, and nothing else. **Not pushed** marks an entry
still local. **Failed** marks one Jira rejected, and an unreachable instance. **Dirty** marks an
entry pushed to Jira and then edited locally, where Jira's copy is stale. It renders as a hollow
ring, never filled, so shape carries the distinction alongside hue and it cannot be mistaken for
a primary action.

Amber and red are deliberately different things: amber says *warning* — an entry not yet sent is
one instance, data the shell is showing from cache while offline is another — red says *sent and
refused*. **Neither ever rests on colour alone** — the triangle and the words stay, so the
distinction survives a monochrome screen and a red-green deficiency both. Dirty's distinction
from not-pushed—ring against fill—relies on shape alone and requires neither colour nor words.

### The `-rail` variants

Each role has a lighter variant used **only** on the dark rail ground, plus the mobile header which
is the same tone. Using one anywhere else is a bug.

| Token | Both themes |
| --- | --- |
| `--color-primary-rail` | `oklch(0.66 0.19 330)` light, `oklch(0.70 0.17 330)` dark |
| `--color-running-rail` | `oklch(0.74 0.15 150)` |
| `--color-pending-rail` | `oklch(0.80 0.13 85)` |
| `--color-failed-rail` | `oklch(0.72 0.17 25)` |

## Instance identity

Per-instance hues are **identity, never state**. An instance's hue says which Jira this row came
from; it never says whether anything is wrong.

Lightness and chroma are fixed and only the hue moves, which is what keeps every instance equally
loud — no instance looks more important than another because of where it sits in the ramp.

- On a card: `oklch(0.60 0.13 H)` light, `oklch(0.72 0.12 H)` dark
- On the rail: `oklch(0.70 0.13 H)` in both

**The ramp** is `265, 175, 295, 205, 115, 235`, assigned by the instance's `created_at` order and
cycling when there are more instances than hues. 265 and 175 come first because they are the two the
canvas drew.

Every hue sits at least 25° from the reserved four — primary 330, running 150, not-pushed 85, failed
25 — and from its neighbours in the ramp, so no instance can be mistaken for a state and no two
instances for each other.

A dot is meaningful non-text, so the 3:1 floor applies; the worst case in the ramp is 3.55:1.

**A dot alone identifies an instance only where the reader already knows it** — a pinned row, a
week-grid cell. Where the reader is scanning things they have not seen, such as cross-instance search
results, the instance name appears beside the dot. In every case the name is available to assistive
technology, so identity never rests on hue alone.

### A trap this system sets

Writing the hue into an inherited custom property **fails silently**:

```css
/* WRONG — computes to guaranteed-invalid, every dot renders transparent */
:root { --color-instance: light-dark(oklch(0.60 0.13 var(--h)), oklch(0.72 0.12 var(--h))); }
```

`var(--h)` resolves where the property is *declared*, not where it is used. At `:root` there is no
`--h`, so the token becomes guaranteed-invalid before it reaches any element, and nothing appears in
the console. The hue must go in a declaration on the element itself:

```css
/* RIGHT */
.that-dot { background: light-dark(oklch(0.60 0.13 var(--h)), oklch(0.72 0.12 var(--h))); }
```

This is why the instance dot is a rule in `styles.css` rather than a Tailwind colour utility.

## Type

**Space Grotesk**, self-hosted. It is a variable face and one file covers the range: Google serves
the same `.woff2` for 400, 500 and 700, so a single `@font-face` with `font-weight: 400 700` is the
whole declaration. The latin subset is 22kB.

It is self-hosted rather than linked because #12 makes this an offline PWA, the app is self-hosted in
Docker, and no request may leave the origin.

| Step | Size | Used for |
| --- | --- | --- |
| `--text-xs` | 11px | Uppercase section labels, chips |
| `--text-sm` | 12px | Row status, secondary figures |
| `--text-base` | 13px | Rail lines, controls, hints |
| `--text-md` | 14px | Body, issue summaries |
| `--text-lg` | 15px | Emphasised body |
| `--text-xl` | 17px | Card headings |
| `--text-2xl` | 30px | View titles |
| `--text-hero` | 46px | The day's total in the rail |

Tracking is tight: `-0.011em` on body, `-0.03em` on the view title, `-0.035em` on the hero figure.
Uppercase labels open up instead, at `0.12em`, and the wordmark at `0.16em`.

**Figures that align in a column are tabular.** Anywhere a number sits above another number — the
rail's split, a week grid, a list of durations — carries `font-variant-numeric: tabular-nums`.

## Format carries meaning

This is a rule about semantics, not typography, and it is the one most likely to erode across
tickets 7–11.

- A **timer** — one ticket's accumulator, something you can start and stop — is `HH:MM`: `02:30`.
- A **total** — a sum you cannot start or stop — is `Nh Nm`: `5h 15m`, `0h 00m`.

**A colon somewhere you cannot press play is a bug.** The reader learns the shape, and the shape is
what tells them whether a control exists. `web/src/format.ts` is the only place either string is
produced, so the rule has one home rather than being reimplemented per view.

## The rail

216px, dark in both themes, and it is the instrument rather than a menu — the thing you glance at is
in the same place whatever view you are on. It reads top to bottom as one thought: how much, then
where.

| Region | Resting state | Made live by |
| --- | --- | --- |
| Wordmark | Static | — |
| The day's total, 46px | `0h 00m` | #7 |
| The instance split — bar, then per-instance figures | Absent; there is nothing to divide | #7 |
| Running timer | Absent | #8 |
| Unpushed count | Absent | #9 |
| Push | Present, **disabled** | #9 |
| Nav | Live | — |

The total heads the split rather than sitting apart from it: the 46px figure *is* the combined
total, and treating it as separate put the same number on screen twice, forty pixels apart. The
consequence is accepted — the breakdown reads as a footnote to the total rather than a table of
equals, which is the correct emphasis for a glance.

**Push is disabled, not hidden.** A control that vanishes teaches nothing about what it would have
done. Disabled, it is outlined rather than filled — `--color-rail-active` border on transparent,
`--color-rail-muted` label — so a dead control never wears the primary.

### Nav

Three destinations, directly under Push with no divider and no bottom-pinning: **Today**, **Week**,
**Settings**. Each is a 38px row, `9px` radius, `2px` apart, with a 16px stroked icon `11px` from
its label.

| State | Fill | Ink | Weight |
| --- | --- | --- | --- |
| Current | `--color-rail-active` | `--color-rail-ink` | 700 |
| Other | none | `--color-rail-muted` | 500 |

Where you are is shown by **fill and weight, not by colour alone**, and both are driven from
`aria-current="page"`, which the router sets after resolving a path. Week is inert until #11 builds
the view — visible and dimmed rather than linking to a dead address, on the same reasoning that keeps
Push visible and disabled.

### One rule the framework does not supply

A native `<button>` resolves to the default arrow cursor and Tailwind v4's Preflight deliberately
leaves it there. **Every button therefore sets `cursor-pointer` explicitly**, and a disabled one
says `not-allowed`. This is in `that-button`'s base, so it is one decision rather than one per
caller.

## The ticket row

Three parts on one baseline: the key, the summary, the status.

| Part | Treatment |
| --- | --- |
| Key | A **76px column**, not a word — `--text-sm`, weight 700, `+0.03em`, tabular figures, `--color-ink-muted` |
| Summary | `--text-lg`, `min-width: 0`, truncating with an ellipsis |
| Status | `--text-sm`, `--color-ink-muted`, never shrinking |

**The key's column is what aligns the card.** Fixing its width is the whole reason every summary
starts at the same x down a list; sized to its own text, each row begins its title wherever that
key happened to end and the card reads as ragged.

**76px is the floor, not the width.** The design drew it around seven-character examples, and real
data passes it immediately — a ten-character key such as `RIDGE-5325` measures 78px. So each list
measures its own keys and shares one column: a key wider than the floor moves the whole column
rather than breaking rank with its neighbours, and a list of short keys keeps the drawn 76px instead
of being padded to suit some other instance. Clipping the key is never the answer — it is the
identifier the row exists to give you.

Per list rather than per card or per app, because two instances with differently-shaped project keys
are two lists: padding the short one to suit the long one spends width the summary needs.

**A row key never wears the primary.** It is `--color-ink-muted` whether it links or not, and takes
a colour only when it carries state — the running tone on a ticket whose timer is going, the failed
tone on one Jira refused. A key permanently in magenta would compete with exactly those signals on
exactly that element, and the primary is identity rather than state. A linked key declares itself by
darkening to `--color-ink` on hover instead of by colour.

The summary is the only part that may shrink, and it must be allowed to: a flex item's floor is its
min-content width, so without `min-width: 0` the truncation never engages and the status is pushed
out of the card entirely on a narrow viewport.

## The five screen states

Each is an artboard; the reasoning is in `annotations.md`.

- **First run** — no instances configured. The rail still reads `0h 00m`, because time is local: the
  day total comes from SQLite, not from Jira. Only the split has nothing to say.
- **Loading** — the rail is **fully live** while the issue list is still empty. Time entries, timers
  and pins are local and only the assigned-issue fan-out is remote, so the total, the split and the
  running timer paint instantly. The Pinned card paints too, because #6 caches summary and status
  precisely so pins survive a slow instance. Only the instance cards are skeletons, and they still
  carry their names, which come from the local `instances` table.
- **Nothing logged** — every timer `00:00`, both subtotals `0h 00m`, no split bar, Push disabled.
  This is the state that tests the format rule hardest: a column of `00:00` under a `0h 00m` hero.
- **All pushed** — nothing running, nothing unpushed and nothing shown from cache, so green, amber
  and red all leave the screen at once. Only the magenta remains, on the wordmark and Push. Amber's
  absence now vouches for two things, not one — every entry has gone and every list on screen is
  live, not a stale copy — because both share the one tone. **A list with no state colour in it
  means you are done.**
- **Partial push failure** — the state the design of record calls out by name. A push is not
  transactional; each entry succeeds or fails alone. A banner with the count, per-row markers, a rail
  line, and Push becomes Retry. A row is a *sum*, so it can be partly through — "1 of 2 failed" — and
  opening the row shows which entry.

## The phone

390×844, Android. The rail cannot survive at 216px, so it unfolds: the readout becomes a header block
in the same dark tone, and nav drops to a bottom tab bar where a thumb reaches it. Rows restack —
summary first, key and status beneath — so the summary gets the width. Touch targets are 44px, 46px
in the sheet.

Safari and WebKit are an explicit non-goal, not a gap.

## Manual entry

A native `<dialog>`, centred on desktop and anchored to the bottom edge on the phone: same markup,
same content, one CSS difference. It beat the popover because the popover was quietly two designs,
and because `showModal()` supplies the focus trap, the inert background, the top layer, Esc dismissal
and focus return.

Two rules carry over from `that-confirm`, which already proves the pattern:

- **Backdrop-click dismissal stays absent.** `<dialog>` has no such behaviour, Esc is the safe exit,
  and adding it means hit-testing by hand.
- **Margin must be set explicitly.** Preflight's `* { margin: 0 }` is author origin and beats the
  UA's `dialog { margin: auto }`, so a dialog lands top-left in Firefox and Chromium without it.

The interaction itself — what the dialog contains and how entries are exposed — is #7's.

## Measured contrast

Computed from the `oklch` values above, converted through OKLab to linear sRGB. **Text pairings,
floor 4.5:1:**

| Pairing | Light | Dark |
| --- | --- | --- |
| `ink` on `raised` | 17.90 | 15.38 |
| `ink` on `surface` | 16.84 | 16.91 |
| `ink-muted` on `raised` | 6.47 | 6.55 |
| `primary` on `raised` | 6.06 | 6.06 |
| `primary` on `surface` | 5.70 | 6.66 |
| `primary-ink` on `primary` | 5.95 | 6.72 |
| `primary-rail-ink` on `primary-rail` | 5.61 | 6.72 |
| `failed` on `raised` | 6.28 | 6.57 |
| `running` on `raised` | 5.47 | 8.04 |
| `pending` on `raised` | 5.55 | 9.33 |
| `rail-ink` on `rail` | 15.87 | 17.73 |
| `rail-muted` on `rail` | 6.08 | 6.00 |
| `running-rail` on `rail` | 8.08 | 9.30 |
| `pending-rail` on `rail` | 9.34 | 10.75 |
| `failed-rail` on `rail` | 6.58 | 7.57 |

**Meaningful non-text, floor 3:1:**

| Pairing | Light | Dark |
| --- | --- | --- |
| `ink-faint` on `raised` (icons only) | 3.60 | 3.61 |
| Instance dots on `raised`, worst hue | 3.55 | 6.82 |
| Instance dots on `rail`, worst hue | 6.31 | 7.26 |

**Decorative, no floor:** `edge` on `raised` (1.27 / 1.22), `rail-active` on `rail` (1.28 / 1.18).

A pairing that falls below its tier's floor is a bug, and the tier is part of the claim — reporting
a divider as failing 3:1 is as wrong as shipping body text at 3.6:1.
