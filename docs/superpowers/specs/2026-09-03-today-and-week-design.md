# Today and Week, second edition

**Date:** 2026-09-03
**Supersedes:** nothing — it applies
[`2026-09-03-visual-language-design.md`](2026-09-03-visual-language-design.md) to two views
**Superseded by:** nothing

The language settles the vocabulary. This settles what Today and Week are built out of it.

**The design source is a working prototype**, committed beside this document at
[`../prototypes/2026-09-03-app-prototype.html`](../prototypes/2026-09-03-app-prototype.html). Open it
in a browser: the nav switches views, the cog opens Settings, controls hover, the pin toggles, the
search opens on focus, and every duration opens the entries dialog. It went through thirteen passes
with the owner on 2026-09-03. **Where this document and the prototype disagree, that is a bug in this
document** — the same relationship the first edition had with its canvas.

Settings is **not** in this ticket. It is being redesigned under #89.

## Layout

1. **Every view centres and names its own cap.** Listings cap at `120rem`; a form-shaped view names a
   reading measure instead. It must be written as an explicit value — `max-w-3xl` already means
   48rem, per the language's decision 8.
2. **Instance cards are one across, and two from `xl`. Never three.** Two instances is the real case;
   a third column would only fill if a third Jira were added, and it would pay for it out of the
   summary.
3. On a 2560px screen this gives the rail, 1920px of content and equal margin either side. At the cap
   each of two columns measures 918px.

## The table

Both views are real tables. That is what gives a column a header to click, what makes width land on
the summary rather than on emptiness, and what gives the pin control a column instead of a corner.

**One rule governs every gap:**

```css
th + th, td + td { padding-left: 20px; }
```

No cell carries horizontal padding of its own, so a header cell and the cell beneath it cannot
disagree. **Every instance card carries the header row** — with one card headed and another not, no
two cards agree.

**Text cells align to the baseline; the action cell aligns to middle.** That is what keeps the 13px
mono key on the same line as the 15px summary while a 34px control still centres in the row. With
5px block padding on that cell the row height does not change at all.

**A control's ink meets the card edge, not its hit area.** The duration and pin controls hang outside
their cell by exactly their own padding. Every control grew its padding and gave the space straight
back as negative margin: the hit area is larger and nothing moved.

**The sort control's hover is colour only.** A padded hover box shifts its label off the column,
which is the whole thing the spacing rule exists to prevent.

## Today

- **Pinned is a page heading**, level with *Assigned issues*. They are two sections of one list.
- **Refresh is an icon button beside the title**, not a text button at the far right.
- **The key is the link**, not the summary, and it brightens to full ink on hover rather than
  underlining. This is unchanged from the first edition and was re-confirmed on 2026-09-03 after the
  prototype briefly had it the other way round.
- **Every row carries a pin control** in a trailing column: pin when unpinned, crossed pin when
  pinned. Tooltips read exactly `pin ticket` and `unpin ticket`, and the control keeps an
  `aria-label` independent of the tooltip.
- **The Pinned table carries the instance dot inside its key cell**, 8px from the key, matching Week.
  It is a cross-instance table, so it is deliberately not aligned to the per-instance ones.
- Pinned sorts on the same columns as the assigned cards.
- **The search is a lookup, not a filter** — see #84. The list underneath is untouched while results
  are open.

## Week

Structurally Week needed least: it was already a table with the right column semantics, and its cell
markers were already CSS shapes rather than characters.

- **Every cell is a control, empty ones included.** A cell opens the entries dialog for that ticket
  and that day: with a figure it edits, empty it adds. **Totals stay inert** — a total is a sum, and
  there is nothing to edit about it.
- **A cell's hover hugs its figure**, with the same padding as every other control. It does not span
  the column.
- **Each cell carries a popover** naming its value, its push state and whether clicking adds or
  edits. **The legend under the grid is gone**, replaced by those.
- **The three week controls share one 36px height** so they sit on a line.
- The failed marker went from 6×5 to 9×8; it was too small to read as a shape.
- **Unchanged on purpose:** the marker shapes, worst-wins on a cell and on a day, totals never taking
  a marker, row order by instance position then key, and the **em dash** in an empty cell.
- Week also carries the search, worded for its own job: logging against a result puts that ticket
  into the week.
- **Week rows stay keys only.** A summary column was offered and declined on 2026-09-03.

## The entries dialog

Opened from any duration control in either view. This is the existing `that-entry-dialog`, restyled
and restructured — its *interaction* was settled by the manual-entry ticket and is not reopened.

**Header.** The instance dot, the instance name and the ticket key on one line separated by a middot,
with the ticket's total and the close control pinned right by their own auto margin. The summary is a
**subtitle** beneath: 14px, muted, wrapping the full width. The status and the day are gone from the
header.

**Rows.** Duration, comment or a muted *No comment*, a **push-state icon carrying a popover**, then
edit and delete as icon buttons. The start time is gone. Delete goes red on hover.

**Editing.** The row being edited takes an **active state** — a wash with a magenta bar down its left
edge — and the submit becomes *Save* with an icon Cancel beside it. This replaces both the mode line
and the dimming of every other row.

**The form.** The duration control is the real one: a bordered group of minus, a 64px centred tabular
field, and plus, hairline seams between the three, radius on the outside corners only, and the group
taking the focus ring rather than the input. Then the comment field, which takes all the slack, and
the submit holding the right edge. There is no explanatory line — a new entry gets an unpushed marker,
which says the same thing where it matters.

## Acceptance criteria

- No view caps below `120rem`, and content is centred at any width.
- Instance cards are one across below `xl` and two above it, never three.
- In every card, a header cell and the cells beneath it share one left edge, and every instance card
  has a header row. **Worth an end-to-end assertion rather than an eye.**
- Controls are vertically centred in their rows and the row height is unchanged from a text-only row.
- Tooltips are not clipped by any ancestor, including inside a scrolling region.
- No typed character is used as an icon anywhere in the app; warning and failed no longer share a
  shape.
- Every one of the five screen states and the stale banner still render.
- `make verify` and `make test-e2e` are green.

## Three traps this design walked into, recorded so the build does not

Each cost a round trip during the prototype, and each looked like a layout mistake:

1. **A component name collided with the host page's.** Cards inherited a border, a pointer cursor and
   a hover lift from a stylesheet that was never ours. Namespace, or check what else owns the name.
2. **`all: unset` in a button reset outranked every component rule after it.** Icon buttons lost their
   size and alignment, Push lost its colour. A reset belongs in `:where()`, at zero specificity, so a
   component rule can never lose to it.
3. **Two copies of a stylesheet disagreed.** A stale block kept applying every property the newer one
   did not restate, so `align-items` and `display` survived from a version nobody was reading. The
   symptom was elements refusing to right-align; the cause was a file arguing with itself.

Related: `[hidden]` is a user-agent rule, so any author `display:` beats it. A component that sets
`display` needs `[hidden]` restated, or things marked hidden will show.

## Out of scope

- **Settings** — #89 redesigns it, including whether it stays a view.
- **Sorting behaviour** — #83, built on this table.
- **The search's behaviour** — #84, which also removes the Pinned card's own pin form.
- **The phone** — #53. This must not regress it.
