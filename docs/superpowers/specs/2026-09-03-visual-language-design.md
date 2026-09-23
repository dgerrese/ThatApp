# The visual language, second edition

**Date:** 2026-09-03, extended 2026-09-04
**Supersedes:** [`2026-08-20-visual-design-language.md`](2026-08-20-visual-design-language.md), in the
parts named below
**Superseded by:** nothing

**Added on 2026-09-04**, after the second edition was judged on the light ground for the first time:
the interaction tokens under §*Tokens*, and decision 11 on elevation. Both close gaps this document
had rather than reversing anything in it.

The first edition settled a vocabulary and it held through tickets 5 to 11. This edition changes four
things in it — the ground, the rail's reason for standing apart, the corner geometry and the type —
adds three it never had — an icon rule, a tooltip, a breakpoint scale — and leaves everything else
exactly as it was.

**It is a revision, not a rewrite.** §*What the first edition still governs* lists what carries over
untouched, and that list is longer than what changes here. Where the two documents disagree on a
token, a radius or a typeface, this one wins; on anything else, the first edition is still the
source.

**This document is derived from a design session**, run on 2026-09-03 in the browser companion under
`.superpowers/brainstorm/`. Every decision below was chosen against alternatives that were built and
compared side by side, not described. The alternatives and their costs are recorded here because the
reasons are what a later reader needs, not the winners alone.

## The brief

An **opposite identity** to a **reference brand** — an evil twin in *manners, not function*. Same
craft, opposite temperament: where the reference is polite, daylit and soft, this is nocturnal and
crisp.

The reference is a brand the owner sees every working day and is deliberately not named here; what
matters to a later reader is its *shape*, which the table below records in full.

Its values, read from its own stylesheet rather than from an impression of it:

| | |
| --- | --- |
| Brand | `#1469ae`, focus `#0127b2` |
| Dark ground | `#000828` |
| Page | `#f3f3f3`, secondary `#efeeeb` |
| Ink | `#141414`, muted `#5e5c5a` |
| Supports | `#b2c3ff`, `#dce1f5` |
| Typeface | Inter, one family, no second register |
| Radii | Five named steps: 2, 4, 8, 12, 20 |

The app already disagreed with most of that — warm against cool, a grotesque against Inter, magenta
against trust-blue — but it had arrived there without deciding to. This edition makes the opposition
deliberate, and in two places it turns out the better move is to **inherit the reference's system and
invert the app's position within it** rather than to invent something new.

## Decision 1 — dark is the default, light is a peer

Three grounds were built: dark-first with light kept, dark-only, and light-first with a darker
character. **Dark-first wins.** Both themes stay selectable, both stay tested, and neither is a
courtesy.

Dark-only was rejected for one reason that is not aesthetic: this app is used through the working
day, in an office, and a permanently dark screen is a cost paid every day for a preference held some
of the time. Light-first was rejected as too literal a reading of the brief — the same app in a
sharper suit rather than a different one.

### What "default" means, precisely

Settled 2026-09-03, because the phrase is ambiguous and the ambiguity is a behaviour change.

The theme control offers **Light, Dark and System**, and **System is the unset state**. With nothing
stored, the app follows `prefers-color-scheme`. **A machine set to light opens the app light**, and
that is correct, not a bug for a later ticket to fix.

"Dark first" is therefore two narrower claims, not one broad one:

- The root declares **`color-scheme: dark light`** rather than `light dark`. The order only decides
  what happens where the platform expresses no preference at all, and there dark wins.
- Dark is the ground the design was **authored and measured in**. Light is derived from it and held
  to the same floors, rather than the other way round.

A stored preference beats both. The boot script is unchanged: an absent `data-theme` attribute is the
System state, so a failed storage read lands on following the platform rather than on a guess.

**The consequence is decision 2**, and it is the whole reason this edition exists rather than being a
palette swap.

## Decision 2 — the rail separates by value alone

The rail has been dark in both themes since the first edition, because it is the instrument. On a
light page that was self-enforcing: it was the only dark thing. **On a dark page it is not**, and the
rule needs a mechanism.

Four were built:

| Treatment | Why it lost |
| --- | --- |
| **Value alone** — the rail goes further down than the page and stays neutral | **Chosen.** |
| Hue — near-black with a plum cast the ground never uses | Adds a second identity hue to the system, sitting close enough to magenta 330 that the wordmark has less room against it |
| A hot edge — a 2px magenta rule down the boundary | Spends the primary on furniture. Magenta is identity; the same argument keeps it off a row key |
| Inversion — the rail becomes a pale slab on a dark page | The sharpest reading of the twin, and the most expensive: it rewrites the rule instead of tuning it, glares at night, and makes the light theme answer the question backwards |

**Value alone is the fragile choice and was taken with that stated.** It rests on one variable, so any
later ticket that darkens `--color-surface` erodes it. The gap is `0.105` against `0.178` — a 1.62:1
luminance relationship, decorative by tier and therefore protected by nothing. **A change to either
value is a change to this decision** and must be treated as one.

### The rail no longer inverts, in a stronger sense than before

The rail now carries **one set of tones in both themes**. It is the only region of the app that does
not change when the theme does. In the first edition "the rail does not invert" meant its two theme
values were near-identical; here they are the same value, because the ground moved underneath it and
near-identical would no longer read as deliberate.

## Decision 3 — the reference's radius ruler, stood on at the bottom

The reference declares five radius steps and then lives in the top two: cards at 20, buttons at 12,
inputs at 8, and the bottom two steps never used at all. Half its scale is decoration.

The app, by contrast, had **no scale**: 16px came out of a Tailwind class, 11 and 9 were picked by
hand, and nothing said which was meant to match which.

So the ruler is inherited whole and the app stands at the other end of it.

| Step | Value | This app | The reference |
| --- | --- | --- | --- |
| `--radius-xs` | 2px | Nav rows | — |
| `--radius-sm` | 4px | Buttons, inputs | — |
| `--radius-md` | 8px | Cards, dialog | Inputs |
| `--radius-lg` | 12px | — | Buttons |
| `--radius-xl` | 20px | — | Cards, media |

The names are the reference's own and are deliberately generic — they name a size, not a role, so a later
ticket can re-map which component uses which step without renaming anything.

**No component may carry a radius literal.** Every one refers to a step by name. The two exceptions
are marks rather than containers and stay fully round: `.that-dot` and the split bar's segments keep
`999px`, and the phone's 44px touch targets are unaffected — radius is a manner, hit area is not.

## Decision 4 — two faces: Chivo and Chivo Mono

The app is mostly numbers: a 46px total, a per-instance split, a running clock, a duration on every
row, a key on every row. The first edition set all of that in the same face as the prose.

**Words are Chivo. Figures are Chivo Mono.** A genuine pair, cut from the same grotesque, so it reads
as a change of register rather than a clash.

Both are variable across the weights used, so this is **one file per family** — the same font budget
as the single face it replaces, not double.

### Figures means exactly this list

The day total · the per-instance split figures · the running timer · a row's duration · a ticket key.
Nothing else. A figure inside a sentence stays in Chivo.

Tabular numerals stay on everywhere a figure can change in place, which is what stops the running
clock jittering. That rule is unchanged from the first edition.

### Inter was considered and rejected

Inter reads better at 13px than anything else tried, and it has **no monospaced companion** — no Inter
Mono, no mono axis; it ships as one variable family with weight and an optical-size axis. Its designer
points at IBM Plex Mono and Roboto Mono instead.

It was rejected on the brief rather than on quality: **the reference brand is set in Inter.** Adopting
it would put the twin in the parent's own face and discard the one typographic thing the app already
did differently.

IBM Plex Sans, Red Hat Text and Recursive were the other finalists. Plex lost on ubiquity, Red Hat on
being well-mannered — a description of the reference, not of its twin — and Recursive on risk: its
`MONO` and `CASL` axes are a genuinely elegant fit, and a stray axis value would silently restyle the
app.

## Decision 5 — the small end of the ramp moves up a pixel

Chivo is the loudest of the candidates at display size and the weakest at small size. This app spends
most of its pixels at small size, so the ramp absorbs it: **the three smallest steps each gain a
pixel.** Nothing at 15px or above moves, including the 46px total.

**This merges two steps.** `--text-base` rising from 13 to 14 lands on `--text-md`, which is already
14, so `--text-md` is **retired** and its callers move to `--text-base`. The ramp gets shorter, which
is the correct outcome — two names for one value would be worse than either.

| Token | Was | Now |
| --- | --- | --- |
| `--text-xs` | 11px | **12px** |
| `--text-sm` | 12px | **13px** |
| `--text-base` | 13px | **14px** |
| `--text-md` | 14px | **retired** — callers move to `--text-base` |
| `--text-lg` | 15px | 15px |
| `--text-xl` | 17px | 17px |
| `--text-2xl` | 30px | 30px |
| `--text-hero` | 46px | 46px |

Thirteen `text-md` usages and seven `text-base` usages are affected; the second group is the shift
this decision is actually for.

## Tokens

`light-dark(light, dark)` as `@theme` declares them. **Note the order: the first value is still the
light one**, because `light-dark()` is defined that way. Dark being the default is a `color-scheme`
decision, not a token-order one.

### Ground and ink

| Token | Light | Dark |
| --- | --- | --- |
| `--color-surface` | `oklch(0.972 0.008 60)` | `oklch(0.178 0.012 40)` |
| `--color-raised` | `oklch(0.995 0.004 70)` | `oklch(0.228 0.014 40)` |
| `--color-ink` | `oklch(0.195 0.009 55)` | `oklch(0.962 0.005 70)` |
| `--color-ink-muted` | `oklch(0.465 0.010 55)` | `oklch(0.725 0.012 55)` |
| `--color-ink-faint` | `oklch(0.620 0.008 60)` | `oklch(0.560 0.012 50)` |
| `--color-edge` | `oklch(0.905 0.007 65)` | `oklch(0.300 0.012 40)` |

### The rail — one value, both themes

| Token | Both |
| --- | --- |
| `--color-rail` | `oklch(0.105 0.006 60)` |
| `--color-rail-ink` | `oklch(0.962 0.005 70)` |
| `--color-rail-muted` | `oklch(0.660 0.010 60)` |
| `--color-rail-active` | `oklch(0.205 0.008 60)` |
| `--color-primary-rail` | `oklch(0.720 0.19 330)` |
| `--color-primary-rail-ink` | `oklch(0.160 0.02 330)` |
| `--color-running-rail` | `oklch(0.750 0.15 150)` |
| `--color-pending-rail` | `oklch(0.800 0.13 85)` |
| `--color-failed-rail` | `oklch(0.720 0.17 25)` |

These are written as plain values rather than `light-dark()` pairs, so the fact that they do not
change is visible in the stylesheet rather than something a reader has to notice by comparing two
numbers.

### Roles

| Token | Light | Dark |
| --- | --- | --- |
| `--color-primary` | `oklch(0.500 0.21 330)` | `oklch(0.720 0.19 330)` |
| `--color-primary-ink` | `oklch(0.990 0.004 70)` | `oklch(0.160 0.02 330)` |
| `--color-running` | `oklch(0.480 0.15 150)` | `oklch(0.750 0.15 150)` |
| `--color-pending` | `oklch(0.500 0.13 75)` | `oklch(0.800 0.13 85)` |
| `--color-failed` | `oklch(0.490 0.19 25)` | `oklch(0.720 0.17 25)` |
| `--color-dirty` | tracks `--color-primary` | tracks `--color-primary` |

**The `-rail` variants survive, and stop being pairs.** With one rail ground in both themes each
becomes a single value — the dark-theme tone, which is what the rail's ground calls for whichever
theme is active.

They were nearly retired here on the reasoning that one ground needs only one set. That was right
about the count and wrong about which set: dropping them would have made the light theme's
`--color-primary` the wordmark's colour, and **`oklch(0.5 0.21 330)` on the rail measures 3.03:1**
against a 4.5:1 text floor. The wordmark is text. The variant is what keeps that pair legal, and it
is recorded here so the same simplification is not attempted again.

### Interaction

| Token | Both themes |
| --- | --- |
| `--color-hover` | `color-mix(in oklab, var(--color-ink) 11%, transparent)` |
| `--color-hover-rail` | `color-mix(in oklab, var(--color-rail-ink) 13%, transparent)` |

**One formula in both themes, and that was tested rather than assumed.** The page wash derives from
ink, so it follows the theme without needing a pair; the rail's derives from rail ink, which does not
change at all.

The mix was built on the dark ground and judged there. On 2026-09-04 it was put on paper-white beside
the dark reference at three strengths — 11%, 8% and 6% — and **11% won unchanged**. The arithmetic had
already said it should: the same mix lifts the dark card by `0.081` in OKLab lightness and darkens the
light card by `0.088`, which is as close to even as one formula gets. The reason to look anyway is that
dark-on-light reads heavier than light-on-dark at the same distance, and that is a question for the eye
rather than for the numbers.

A per-theme pair was available and refused. One formula cannot drift apart; two values can, and nothing
in the build would notice if they did.

**A hover box stays inside the padding of the region that holds it.** Where a control sits at the edge
of a padded region — the rail's cog against its 14px gutter, the Add button against the Settings
dialog's — the box that lights up on hover may not cross that padding edge. Aligning such a control is
done by matching the region's own padding, never by pulling the control out with a negative margin: the
glyph moves and the wash follows it into the gutter. The rail's cog was corrected this way on
2026-09-04.

**Inside a card the opposite rule already applies, and it wins there.** The Today and Week design
states it positively: *a control's ink meets the card edge, not its hit area*, which is exactly what
the negative margin on a row's trailing icon button buys. So the two rules are not in conflict, they
are scoped — **a control aligns its ink to a card's text column, and its wash to a region's gutter.**
The rail's cog had no card to align to, only a gutter to escape, which is why it was the one that
moved. The owner confirmed the table's overhang on 2026-09-04 rather than have it changed to match.

**The same wash is the selected row in the entries dialog**, where it marks a standing state rather than
a passing one. That is deliberate, and it is not colour alone — the selected row also carries a primary
rule inset on its leading edge. Decision 9 governs the case where a washed control sits inside a washed
row.

### Type

| Token | Value |
| --- | --- |
| `--font-sans` | `"Chivo", ui-sans-serif, system-ui, sans-serif` |
| `--font-mono` | `"Chivo Mono", ui-monospace, monospace` |

Both self-hosted from `/fonts/`, one variable `.woff2` per family, latin subset, preloaded. No font
CDN — the app is offline-capable and that is not negotiable.

## Measured contrast

Computed from the OKLCh values above, converted to linear sRGB and clamped to gamut. Text pairs must
clear 4.5:1; marks that carry meaning must clear 3:1; hairlines and the rail's active fill are
decorative and have no floor. **Every pair clears.**

| Pair | Ratio | Floor | Clears |
| --- | --- | --- | --- |
| Dark · ink on surface | 16.92:1 | 4.5 | yes |
| Dark · ink on raised | 15.24:1 | 4.5 | yes |
| Dark · ink-muted on surface | 7.74:1 | 4.5 | yes |
| Dark · ink-muted on raised | 6.97:1 | 4.5 | yes |
| Dark · ink-faint on raised (mark) | 3.65:1 | 3.0 | yes |
| Dark · running on raised | 8.12:1 | 4.5 | yes |
| Dark · pending on raised | 9.05:1 | 4.5 | yes |
| Dark · failed on raised | 6.38:1 | 4.5 | yes |
| Dark · edge on raised (decorative) | 1.24:1 | — | n/a |
| Rail · rail-ink on rail | 18.38:1 | 4.5 | yes |
| Rail · rail-muted on rail | 6.58:1 | 4.5 | yes |
| Rail · primary on rail | 7.57:1 | 4.5 | yes |
| Rail · primary-ink on primary | 7.18:1 | 4.5 | yes |
| Rail · rail-ink on rail-active | 16.05:1 | 4.5 | yes |
| Rail · running on rail | 9.78:1 | 4.5 | yes |
| Rail · pending on rail | 10.91:1 | 4.5 | yes |
| Rail · failed on rail | 7.68:1 | 4.5 | yes |
| Rail · rail-active on rail (decorative) | 1.14:1 | — | n/a |
| Rail · light `--color-primary` on rail — *why the `-rail` variant exists* | 3.03:1 | 4.5 | **no** |
| Light · ink on surface | 16.86:1 | 4.5 | yes |
| Light · ink on raised | 18.04:1 | 4.5 | yes |
| Light · ink-muted on surface | 6.44:1 | 4.5 | yes |
| Light · ink-muted on raised | 6.89:1 | 4.5 | yes |
| Light · ink-faint on raised (mark) | 3.59:1 | 3.0 | yes |
| Light · running on raised | 5.91:1 | 4.5 | yes |
| Light · pending on raised | 6.02:1 | 4.5 | yes |
| Light · failed on raised | 6.82:1 | 4.5 | yes |
| Light · primary on surface | 6.24:1 | 4.5 | yes |
| Light · primary-ink on primary | 6.58:1 | 4.5 | yes |
| Light · edge on raised (decorative) | 1.31:1 | — | n/a |
| Dot · on rail, worst hue (295) | 7.37:1 | 3.0 | yes |
| Dot · dark, on raised, worst hue (295) | 6.62:1 | 3.0 | yes |
| Dot · light, on raised, worst hue (205) | 3.54:1 | 3.0 | yes |

**`--color-ink-faint` is still not a text colour.** At 3.65:1 dark and 3.59:1 light it clears the mark
floor and fails the text floor, exactly as in the first edition, and for the same reason it is the
token a tired implementer reaches for. Words use `ink` or `ink-muted`; there is no third option.

The one **failing** row is deliberate: it is not a pair the app renders, it is the pair the app would
render if `--color-primary-rail` were dropped, kept in the table as the evidence for keeping it.

**The dot rows are the ones to re-measure first** if the ramp or the grounds ever move. The light
theme's worst hue clears by 0.54, which is the smallest margin in the table.

## Decision 6 — an icon is drawn, never typed

**No glyph may stand in for an icon.** Not a dingbat, not a geometric shape from the text stream, not
an emoji. Every mark that carries meaning is inline SVG on a 24px grid, `1.9` stroke, round caps and
joins, `currentColor`, rendered at 16px in the rail's nav and 18px in a row control.

The reason is not taste. A typed character is rendered by whichever font resolves it, and that is not
the font the design chose: coverage varies, metrics vary, and a face that lacks the codepoint falls
back to something else entirely or draws nothing. An icon that changes shape with the font is not a
component.

**This reaches shipped code in four files.** Every one was found by reading the source, not guessed:

| File | Glyph | Standing in for |
| --- | --- | --- |
| `that-alert.ts` | `●` | the success mark |
| `that-alert.ts` | `▲` | **both** warning and failed |
| `that-entry-dialog.ts` | `×` | close |
| `that-entry-dialog.ts` | `×` | stop editing |
| `that-duration.ts` | `−` | fifteen minutes less |
| `that-duration.ts` | `+` | fifteen minutes more |
| `views/week.ts` | `←` `→` | previous and next week |

The alert row matters twice over: warning and failed **share one glyph and are told apart by colour
alone**, which this language forbids in its own words. Drawing them is the moment to give them
different shapes, and that is a decision for the ticket that does the work.

**Punctuation is not an icon.** An em dash meaning "no value" in a table cell, and a middot
separating two facts on one line, are typography and stay as characters. The rule is about a
character standing in for a *drawn mark*, not a licence to redraw punctuation.

The set the app needs: pin, pin-off, search, sortable, ascending, descending, pushed, warning,
failed, success, and the three nav marks, transcribed from the prototype's `#p-clock`, `#p-cal`
and `#p-gear` into `index.html`. `index.html` is where they are drawn from, not what settles what
they should be — #117 found one of the three drifted from its source and corrected it.

## Decision 9 — one surface reacts at a time

Where a row and the controls inside it both respond to hover, hovering a control paints the control's
wash *on top of* the row's. The same mix lands twice and reads as roughly double, which is a
different colour from either state and belongs to neither.

So a container's hover **stands down** while one of its own controls is hovered:

```css
.row:hover { background: var(--hover); }
.row:hover:has(.control:hover) { background: transparent; }
```

`:has()` is supported in both target browsers, and where it is not the two washes simply stack —
the old behaviour, not a broken one. A control that changes only its colour, such as a linked key,
is deliberately **not** in that list: it never competes with the row, so the row should stay lit
while the pointer is travelling toward it.

## Decision 10 — a revealed control either reserves its space or does not, and context decides

The duration control carries a `Log` hint that appears on hover. There are only two honest bargains,
and the right one depends on what sits next to it:

- **Reserve.** The hint always occupies its width and fades in. Nothing moves. Correct in a table,
  where the neighbour is a status column that would otherwise jump on every hover.
- **Reveal.** The hint has no width until wanted, and expands. Correct in a narrow panel such as the
  search results, where reserved width is taken straight out of the summary being read.

**This reverses a decision recorded in the first edition.** That document says the owner chose the
shifting arrangement on 2026-08-21 over three that hold the row still, and that reserving the width
"means going back to the owner first". That happened on 2026-09-03: the tables now reserve. The
reveal behaviour survives as the modifier used where width is scarce.

## Decision 7 — a tooltip lives in the top layer

Row controls that carry no label — the pin and unpin buttons — need a tooltip, and a tooltip parented
to its trigger can always be clipped by some ancestor: a scrolling region, a dialog, a card that
later gains `overflow: hidden`. That failure is invisible until the day it is not.

**So a tooltip is a `popover`**, promoted to the top layer where no ancestor can clip it, positioned
against its trigger in script. Both target browsers support the attribute.

Two rules come with it. A tooltip is **never the accessible name** — the button carries `aria-label`
regardless, because a tooltip that only appears on hover reaches neither a keyboard nor a screen
reader on its own. And a tooltip on a **trailing** control anchors to its right edge rather than
centring on it, or it hangs past the card.

**It opens above its trigger, the drawing's `.tip`, and falls back below — the drawing's own
`.tip.below` — when there is not enough room above.** #content starts flush against the window's
top edge, so a trigger near the top of the content column has nowhere to open upward into.

## Decision 8 — the breakpoint scale, and one collision it walks into

Tailwind v4's defaults are used unmodified — `sm` 40rem, `md` 48rem, `lg` 64rem, `xl` 80rem, `2xl`
96rem — with **one addition**:

```css
@theme { --breakpoint-3xl: 120rem; }
```

It exists because the owner's screen is 2560px wide and every default stops far short of it. It is
the **cap** on the content column, not a third column of cards.

**The collision:** `max-w-3xl` already means 48rem. Tailwind's container scale and its breakpoint
scale are separate namespaces that happen to share names, and adding `--breakpoint-3xl` does not
change `max-w-3xl`. Writing `max-w-3xl` for the cap would silently produce a 768px page. The cap must
be an explicit `max-w-[120rem]` or a container token whose name is not a breakpoint name. This is
recorded because it reads correctly and behaves wrongly, which is the worst combination.

## Decision 11 — depth is dark's cue, an edge is light's

Neither edition of this language said anything about shadows, and the app has them. Every one in the
prototype was chosen by hand at the moment it was needed, on a dark ground, in black at `0.4` to `0.75`
alpha. Carried onto white unchanged they smear, which is what the owner saw on 2026-09-04.

Three treatments were built on the light ground and compared:

| Treatment | Why it lost |
| --- | --- |
| **A hairline plus a whisper** — the edge defines the surface, a trace of shadow ranks it | **Chosen.** |
| The same shadows with their ink turned down to a twentieth | Depth alone at that strength is too faint to define a card and too vague to rank one surface above another |
| A hairline and no shadow at all | The crispest, and the closest to the brief — but the search panel floats over content it has to read as *above*, and an edge alone does not say that |

**Light needs one or the other.** A card on the light ground is `0.995` against a `0.972` page, a
distance of 0.023, so with no edge and no shadow it simply disappears. Dark has no such problem: `0.228`
against `0.178` is twice the separation, and its shadows carry the rest.

So the rule is per theme, and it is the first thing in this language that is:

| Surface | Light | Dark |
| --- | --- | --- |
| Card | `inset 0 0 0 1px var(--color-edge)`, `0 1px 2px rgba(0,0,0,.04)` | unchanged |
| Popover, including the search panel | `inset 0 0 0 1px var(--color-edge)`, `0 6px 16px -8px rgba(0,0,0,.12)` | unchanged |
| Dialog | its existing `1px` edge border, `0 12px 36px -12px rgba(0,0,0,.16)` | unchanged |
| The selected pill in a segmented control | `inset 0 0 0 1px var(--color-edge)`, `0 1px 2px rgba(0,0,0,.05)` | unchanged |

The hairline is an inset ring rather than a border, so adding it moves nothing. The dialog is the one
exception: it already carries a real border, which is the same hairline by another mechanism.

**Shadows are decorative and have no contrast floor**, which is exactly why this had to be settled by
eye. The drop shadow around the prototype's own window frame is scaffolding for the mock and is not a
surface in the app.

**Still open — the scrim.** The half-opaque black behind an open dialog is unchanged in both themes.
Darkening a white page by that much is a decision about modality rather than about depth, and it was not
settled on 2026-09-04.

## Decision 12 — a toolbar button carries words, an inline control carries a glyph

Settled by the owner on 2026-09-09, while #117 asked where Week's refresh control goes now that the
header also carries #10's fetch. The placement question turned out to be the smaller half: the pair
looked unfinished because one control wore a label and the other did not, and nothing in this
language said which was right.

**A toolbar button carries words.** A toolbar is the group of controls in a view's or a dialog's
header that act on what the view shows. Its buttons render an icon *and* a label — `Refresh`,
`Fetch worklogs` — because a header control acts on everything below it and its consequence is not
recoverable by looking.

**An inline control carries a glyph alone.** A control inside a row, a cell, a field or a search
result is inline: pin and unpin, edit and delete, the duration stepper's two steps. It sits beside
the thing it acts on, which is what says what it will do, and a label repeated down forty rows is
noise. Inline controls keep the tooltip and the `aria-label` they already carry.

**Two exemptions, both settled the same day.**

- **A paired directional group is one control.** Week's previous and next arrows keep their glyphs;
  the words live in the `This week` button between them. Labelling the arrows would widen the group
  by about 140px to say what their shape already says.
- **A window control is not a toolbar button.** Close and dismiss are chrome rather than actions on
  the view's data, so the entry dialog's close stays a glyph, and Settings' will too under #89.

The accessible-name rules are untouched by all of this. A glyph-only control still carries its own
`aria-label`, and **a tooltip is never the accessible name** — #110 exists because nothing checks
that.

**What this changes in the shipped app.** Week's refresh is built to this rule from the start, and
**Today's refresh gains a label**: it is a header control acting on the whole view, and it is
icon-only today. Nothing inline changes.

**The drawing is corrected rather than excepted.** The prototype draws both refreshes as icons
alone, and draws no fetch control at all, because it predates both this decision and #10. Its Today
and Week headers are brought to this rule as part of #117.

## Decision 13 — a button label never breaks

Set by the owner on 2026-09-23 in #185's design session, when the stop dialog's screen first
showed the 7-minute variant's labels wrapping. **`that-button` carries `whitespace-nowrap`,
app-wide.** A container too narrow for its button row grows, or wraps whole buttons, never a
label — the stop dialog is the first case, growing to `w-[440px]` rather than letting `max-w-sm`
wrap "Discard run".

## What the first edition still governs

Unchanged, and this document does not restate them. Read
[`2026-08-20-visual-design-language.md`](2026-08-20-visual-design-language.md) for each:

- **The three contrast tiers** and what falls in each. The floors here are those floors.
- **Instance identity** — the hue ramp `265, 175, 295, 205, 115, 235`, the rule that lightness and
  chroma are fixed and only hue moves, and the `--h` custom-property mechanism with its documented
  trap. The dot's own lightness values are unchanged: `0.6` light, `0.72` dark, `0.7` on the rail.
- **The rail's regions and their resting states**, its 216px width, and Push being disabled rather
  than hidden.
- **Nav** — three destinations, 38px rows, current shown by fill *and* weight, driven from
  `aria-current`.
- **The ticket row** — the 76px key column and why it is a floor rather than a width, the summary's
  `min-width: 0`, and the rule that a row key never wears the primary.
- **Format carries meaning**, the **five screen states**, **the phone**, and **manual entry** as a
  native `<dialog>` with its two carried-over rules.
- **State never rides on hue alone.** Every state tone is accompanied by a word or a shape.

## Out of scope

- **The phone layout** — #53 owns building it. This edition changes tokens it will consume; it does
  not change the phone design.
- **Moving Settings out of the nav** — #89.
- **Copy and tone of voice.** This changes how the app looks, not what it says.
- **The wordmark.** It keeps its current treatment, in the new primary.

## The risk worth restating

Two decisions here are load-bearing and quiet, and both will look like arbitrary numbers to whoever
reads the stylesheet next:

1. **`--color-surface` at `0.178` and `--color-rail` at `0.105`.** The whole rail-separation rule is
   the distance between them. Nothing enforces it and no test will fail if it closes.
2. **`--text-md` is gone**, not renamed. A component that reaches for it gets nothing, which in
   Tailwind v4 is a silently dropped class rather than an error.

Both are worth a comment at the declaration site rather than a note in this file alone.
