# Today and Week, second edition — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-09-04
**Supersedes:** nothing
**Superseded by:** nothing

**Goal:** Rebuild Today and Week out of the second edition's vocabulary — real tables, a pin column,
every Week cell a control, and a restructured entries dialog — without changing what any of it does.

**Architecture:** The vocabulary already shipped with #94, so this plan spends it rather than
defining anything. Both listing views become real `<table>`s, which is what gives a column a header,
lands width on the summary, and gives the pin control a column instead of a corner. `that-ticket-row`
survives as a component and becomes a table row; the tooltip #94 deferred is built here, because this
is where the first controls that need one appear.

**Tech Stack:** Tailwind CSS v4 (`@theme` in `web/src/styles.css`), vanilla TypeScript, native
WebComponents in light DOM, `node --test` for unit tests, Playwright for end-to-end.

**Spec:** [`../specs/2026-09-03-today-and-week-design.md`](../specs/2026-09-03-today-and-week-design.md)

**The design source is the committed prototype**,
[`../prototypes/2026-09-03-app-prototype.html`](../prototypes/2026-09-03-app-prototype.html). Open it
in a browser before starting anything. **Where the spec and the prototype disagree, the prototype
wins** — that is the spec's own rule about itself. Tasks below cite it by line so the markup and the
class names come from it rather than from an implementer's memory of it.

## Global Constraints

Every task's requirements implicitly include these. They come from `CLAUDE.md`, the visual language
and the design.

- **Everything runs in Docker.** No Go, Node or npm on this host. Drive every command through `make`
  or `docker compose`.
- **No JavaScript frameworks.** Vanilla only; TypeScript for typing.
- **Reusable UI is a `that-*` WebComponent in light DOM, never shadow DOM.** Shadow roots stop
  Tailwind utilities reaching component internals.
- **`tsconfig.json` is `strict` with `noUncheckedIndexedAccess`** and is not to be weakened. No `any`,
  no `as any`, no non-null assertion to get past a type error.
- **No component carries a radius literal**, and no component steps off the five-step scale by name.
  `web/src/vocabulary.test.ts` enforces both.
- **No typed character stands in for a drawn mark.** Punctuation is not an icon — the em dash in an
  empty Week cell and the middot in the dialog header stay characters, and the spec says so
  explicitly.
- **`--color-ink-faint` is not a text colour.** Words use `ink` or `ink-muted`.
- **A tooltip is never the accessible name.** Every icon-only control carries its own `aria-label`
  regardless — asserted in `.claude/e2e/tests/tooltip.spec.ts`, not by `vocabulary.test.ts`, which
  guards radius, the retired ramp step, hover grounds and typed characters standing in for marks.
- **The initial HTTP response stays under 14kB.**
- **Comments are few and earn their place.** Never narrate the next line.
- **Firefox and Chromium only.** Safari and WebKit are an explicit non-goal.

## Settled before the plan was written

**A custom element works as a table row in both target browsers.** `that-ticket-row` keeps its
component shape rather than being retired into a function returning a `<tr>`, which would have cost
the repo its one rule about reusable UI. Verified rather than assumed, on 2026-09-04, by building a
table whose body row is a custom element with `display: table-row` holding `<td>` children:

| Browser | Header and body cell left edges |
| --- | --- |
| Chromium | align, both columns |
| Firefox | align, both columns |

That is the acceptance criterion the spec asks for an end-to-end assertion on, so Task 2 writes it
against the real views as well.

## What this plan deliberately does not do

- **Sorting behaviour.** #83 owns it. The header cells and their sort controls are built here, because
  the table is what #83 builds on and the spec describes their resting appearance and hover. Nothing
  sorts when clicked, and no task adds a click handler to a header.
- **The search's behaviour.** #84 owns it, and also removes the Pinned card's own pin form. This plan
  leaves the existing pin form exactly where it is.
- **Settings.** #89 redesigns it, including whether it stays a view. It keeps its current appearance.
- **The phone.** #53. This must not regress it, and no task changes a breakpoint below `xl`.
- **The scrim behind an open dialog.** Raised as #97 and unsettled. Leave it as it is.

## File structure

| File | Responsibility | This plan |
| --- | --- | --- |
| `web/src/components/that-tooltip.ts` | A tooltip in the top layer, never the accessible name | Created in Task 1 |
| `web/src/icons.ts` | Every drawn mark | Extended in Task 1: pin, pin-off, sortable, ascending, descending |
| `web/src/components/that-table.ts` | The card-with-a-table shell: heading, header row, one spacing rule | Created in Task 2 |
| `web/src/components/that-ticket-row.ts` | One issue as a table row, including the pin cell | Rewritten in Task 3 |
| `web/src/views/today.ts` | Page structure, the two sections, the cards | Task 4 |
| `web/src/views/week.ts` | The grid, its cells as controls, its popovers | Task 5 |
| `web/src/components/that-entry-dialog.ts` | Header, rows, editing state, form | Task 6 |
| `.claude/e2e/tests/` | The assertions the spec asks for by name | Tasks 2, 3, 5, 6 |

---

### Task 1: The tooltip, and the five marks the views need

Both are vocabulary this plan consumes everywhere, so they land first and alone. #94 deferred the
tooltip for want of a consumer; Task 3 is that consumer.

**Files:**
- Create: `web/src/components/that-tooltip.ts`
- Modify: `web/src/icons.ts` — five new names
- Modify: `web/src/main.ts` — register the component
- Test: `web/src/icons.test.ts` (extend), `.claude/e2e/tests/tooltip.spec.ts` (create)

**Interfaces:**
- Consumes: `iconMarkup(name, size?)` and `ICON_NAMES` from `web/src/icons.ts`.
- Produces: `<that-tooltip for="<id>" anchor="center|end">text</that-tooltip>`, and the icon names
  `pin`, `pin-off`, `sortable`, `ascending`, `descending`.

**Two rules come with the tooltip**, from decision 7 of the language:

- **It is a `popover`**, promoted to the top layer, because a tooltip parented to its trigger can be
  clipped by any ancestor that gains `overflow: hidden` — and that failure is invisible until the day
  it is not.
- **It is never the accessible name.** The trigger carries `aria-label` regardless. A tooltip that
  appears on hover reaches neither a keyboard nor a screen reader on its own.
- A tooltip on a **trailing** control anchors to its right edge rather than centring, or it hangs past
  the card. That is what `anchor="end"` is for, and the pin column is trailing.

- [ ] **Step 1: Write the failing icon test**

Append to `web/src/icons.test.ts`, in the style already there:

```ts
test("the marks the listing views need are drawn", () => {
  for (const name of ["pin", "pin-off", "sortable", "ascending", "descending"] as const) {
    assert.ok(ICON_NAMES.includes(name), `${name} is in the set`);
    assert.match(iconMarkup(name), /viewBox="0 0 24 24"/);
  }
});

test("pin and pin-off differ by more than a slash's absence", () => {
  assert.notEqual(iconMarkup("pin"), iconMarkup("pin-off"));
});

test("the three sort marks are three different shapes", () => {
  const shapes = new Set(["sortable", "ascending", "descending"].map((n) => iconMarkup(n as IconName)));
  assert.equal(shapes.size, 3, "a sort state told apart by colour alone is the defect this avoids");
});
```

- [ ] **Step 2: Run it and watch it fail**

```shell
make test-web
```

Expected: FAIL — the five names are not in `ICON_NAMES`.

- [ ] **Step 3: Draw the five marks**

Add to `PATHS` in `web/src/icons.ts`, keeping the file's existing shape and the 24 grid:

```ts
  pin: '<path d="M10 3.5h4M12 3.5v5.5M7.5 9h9l1.2 5.2H6.3L7.5 9ZM12 14.2v6.3"/>',
  // The slash is the whole difference, so it is drawn corner to corner rather
  // than as a short stroke: at 18px a subtle one reads as a rendering artefact.
  "pin-off": '<path d="M10 3.5h4M12 3.5v5.5M7.5 9h9l1.2 5.2H6.3L7.5 9ZM12 14.2v6.3"/><path d="M4 4l16 16"/>',
  sortable: '<path d="M8 10.5 12 6.5l4 4M8 13.5l4 4 4-4"/>',
  ascending: '<path d="M12 19V6M7.5 10.5 12 6l4.5 4.5"/>',
  descending: '<path d="M12 5v13M7.5 13.5 12 18l4.5-4.5"/>',
```

Add the five names to `ICON_NAMES` in the same order.

- [ ] **Step 4: Write the tooltip's failing test**

The unit suite has no DOM, so the tooltip is proved in a browser. Create
`.claude/e2e/tests/tooltip.spec.ts`. Read an existing spec first for the fixture helpers and follow
them. It asserts:

1. Hovering a trigger shows the tooltip, and it leaves on `pointerleave`.
2. Focusing the trigger by keyboard shows it too.
3. **The trigger's accessible name is unchanged by the tooltip's presence** — assert the trigger's
   `aria-label`, and assert the tooltip element is not referenced by `aria-labelledby` or
   `aria-describedby`.
4. **It is not clipped by an ancestor with `overflow: hidden`.** Put the trigger inside a scrolling
   region and assert the tooltip's bounding box is not contained by that region's.
5. `anchor="end"` puts the tooltip's right edge within a pixel of the trigger's right edge.

- [ ] **Step 5: Write the component**

Light DOM, `that-*`, registered like the others. Read `that-confirm.ts` first: it is the other
component that puts something in the top layer, and following it keeps the two consistent.

The essentials and nothing more:

- `connectedCallback` resolves `for` to an element by id, attaches `pointerenter`/`pointerleave` and
  `focus`/`blur`, and calls `showPopover()` / `hidePopover()`.
- The element carries `popover="manual"`. Position is computed in script against the trigger's
  bounding box, because the top layer takes the element out of the trigger's coordinate space.
- `anchor="end"` aligns right edges; anything else centres.
- **It sets no ARIA on the trigger, ever.**
- Styling comes from the rail tones, so the chip reads the same in either theme: `--color-rail`
  ground, `--color-rail-ink` text, `--radius-xs`.
- A `for` that resolves to nothing leaves the tooltip hidden rather than throwing.

- [ ] **Step 6: Register it**

Add the import to `web/src/main.ts` beside the other component registrations, in the order the file
already uses.

- [ ] **Step 7: Run everything**

```shell
make test-web && make lint && make tsc
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/tooltip.spec.ts'
```

- [ ] **Step 8: Commit**

```shell
git add web/src .claude/e2e
git commit -m "feat(#95): a tooltip in the top layer, and the marks the tables need"
```

---

### Task 2: The table shell, and the spacing rule that makes cards agree

**Files:**
- Create: `web/src/components/that-table.ts`
- Modify: `web/src/styles.css` — the one spacing rule and the cell alignment rule
- Modify: `web/src/main.ts`
- Test: `.claude/e2e/tests/table.spec.ts` (create)

**Interfaces:**
- Consumes: the radius, ink and edge tokens from #94.
- Produces: `<that-table heading="...">`, which renders a card holding a `<table>` with the header row
  the design specifies, and exposes `body: HTMLTableSectionElement` for callers to append rows to.

**The prototype is the markup source**: line 319 for the Pinned table and line 335 for an instance
card's. Read both before writing anything. The header cells are `c-key`, `c-sum`, `c-status`,
`c-today` and `c-act`, and each of the first four holds a sort control.

**One rule governs every gap**, and this is the whole reason the tables agree with each other:

```css
/* No cell carries horizontal padding of its own, so a header cell and the cell
   beneath it cannot disagree about where its column starts. Every instance card
   carries the header row for the same reason: one headed and one not, and no
   two cards line up. */
.that-tbl th + th,
.that-tbl td + td {
  padding-left: 20px;
}
```

**Text cells align to the baseline; the action cell aligns to middle.** That is what keeps the 13px
mono key on the same line as the 15px summary while a 34px control still centres. With 5px block
padding on the action cell the row height does not change at all.

**The sort control's hover is colour only.** A padded hover box shifts its label off the column,
which is the whole thing the spacing rule exists to prevent. It renders `sortable` at 13px and does
nothing when clicked — #83 wires it.

- [ ] **Step 1: Write the failing test**

Create `.claude/e2e/tests/table.spec.ts`. This is the assertion the spec asks for by name — *worth an
end-to-end assertion rather than an eye*:

1. On Today with two instances, **every** instance card has a header row.
2. For each card, the left edge of each header cell equals the left edge of the cell beneath it, to
   the pixel.
3. The two cards' corresponding columns start at the same x as each other.
4. A row holding a 34px control is no taller than a row holding only text.

Read an existing spec for the stubbing helpers and use them; do not invent a second fixture style.

- [ ] **Step 2: Run it and watch it fail**

```shell
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/table.spec.ts'
```

Expected: FAIL — Today renders `<ul>` lists today, so there is no header row to find.

- [ ] **Step 3: Write the component**

`that-table` renders the card and the table, and nothing about issues — it is the shell both views
share. It holds the heading, the `<thead>` row with its five cells, an empty `<tbody>`, and the
elevation the card already had. Callers append rows to `body`.

Read `that-card.ts` first: this replaces its role in the listing views, and the two must not disagree
about what a card looks like. `that-card` stays for the other places that use it.

- [ ] **Step 4: Add the two CSS rules**

In `web/src/styles.css`, below the existing component rules, the spacing rule above and:

```css
/* The key, the summary and the status sit on one baseline whatever their size.
   The action cell is the exception: a control centres in the row instead, and
   its 5px block padding is chosen so the row height does not move. */
.that-tbl th,
.that-tbl td {
  padding: 11px 0;
  text-align: left;
  vertical-align: baseline;
}
.that-tbl td.c-act {
  padding-block: 5px;
  vertical-align: middle;
}
```

- [ ] **Step 5: Run everything**

```shell
make test-web && make lint && make tsc
```

The end-to-end test still fails at this point — nothing renders a `that-table` yet. Say so in the
report rather than making it pass by wiring a view here; Task 4 is where Today starts using it.

- [ ] **Step 6: Commit**

```shell
git add web/src .claude/e2e
git commit -m "feat(#95): the table shell, and one rule for every gap in it"
```

---

### Task 3: A ticket row becomes a table row, and gains a pin

**Files:**
- Modify: `web/src/components/that-ticket-row.ts`
- Modify: `web/src/styles.css` — the row's `display: table-row`
- Test: `.claude/e2e/tests/pins.spec.ts` (extend)

**Interfaces:**
- Consumes: `that-table`'s body from Task 2, the tooltip and the pin marks from Task 1.
- Produces: `<that-ticket-row>` rendering five `<td>`s in the header's order, and emitting the pin and
  unpin events Today already listens for.

**The component survives as a component**, and becomes a row: `display: table-row` on the host, five
`<td>` children. That combination was verified in both target browsers before this plan was written —
see *Settled before the plan was written*.

**The pin control** is trailing, in `c-act`. Pin when unpinned, crossed pin when pinned. Its tooltip
reads exactly `pin ticket` and `unpin ticket`, and it carries an `aria-label` independent of the
tooltip. The tooltip anchors `end`, because a trailing control's centred tooltip hangs past the card.

**The key is the link, not the summary**, and it brightens to full ink on hover rather than
underlining. That is unchanged from the first edition and was re-confirmed on 2026-09-03 after the
prototype briefly had it the other way round. Do not "fix" it.

**The duration control keeps its behaviour** and its `Log` hint's reveal, which decision 10 keeps for
narrow panels. **It reserves its width in a table** — that is the reversal decision 10 records, and
the table is where it applies. Read the decision before changing the hint's classes.

- [ ] **Step 1: Write the failing test**

Extend `.claude/e2e/tests/pins.spec.ts`:

1. Every row in an instance card carries a pin control, and its `aria-label` names the ticket.
2. Hovering it shows a tooltip reading exactly `pin ticket`; on a pinned row, `unpin ticket`.
3. Clicking it pins the ticket and the row's control becomes the crossed pin — the behaviour Today
   already has, now driven from the row rather than from a form.
4. The tooltip on the trailing control does not extend past the card's right edge.

- [ ] **Step 2: Run it and watch it fail**

- [ ] **Step 3: Rewrite the row**

Five cells, in the header's order: key, summary, status, today, action. The prototype's line 335 is
the markup source. Keep every behaviour the component already has — the duration trigger, the key
column measurement, the events — and change only its shape.

`web/src/key-column.ts` measures each list and widens `--that-key-col`. **A table sizes its own
columns**, so read that file and decide whether it still earns its place. If the table makes it
redundant, say so in the report and leave it for the reviewer to confirm rather than deleting it
unilaterally.

- [ ] **Step 4: Run everything, then commit**

```shell
make test-web && make lint && make tsc
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/pins.spec.ts'
git commit -m "feat(#95): a ticket row is a table row, and carries its own pin"
```

---

### Task 4: Today

**Files:**
- Modify: `web/src/views/today.ts`
- Modify: `web/index.html` — the content column's cap
- Test: `.claude/e2e/tests/today.spec.ts` (extend), `.claude/e2e/tests/table.spec.ts` (now passes)

**Interfaces:**
- Consumes: `that-table` from Task 2 and the row from Task 3.
- Produces: no new interface.

`today.ts` is 669 lines and holds the pin form, the totals, the stale banner, the push report and the
five screen states. **Change its structure, not its behaviour.** Every one of those still has to work,
and the spec's acceptance criteria say so.

- **Pinned becomes a page heading**, level with *Assigned issues*. They are two sections of one list.
- **Refresh becomes an icon button beside the title**, not a text button at the far right.
- **The content column caps at `120rem` and centres.** `main` in `web/index.html` currently carries
  `max-w-3xl`, which is 48rem and is the collision the language's decision 8 warns about. It must be
  an explicit value.
- **Instance cards are one across, and two from `xl`. Never three.**
- **The Pinned table carries the instance dot inside its key cell**, 8px from the key, matching Week.
  It is cross-instance, so it is deliberately not aligned to the per-instance ones.

- [ ] **Step 1: Extend the failing test**

In `today.spec.ts`, assert the cap and the card grid: at a viewport below `xl` the cards are one
across; above it, two; and the content column never exceeds `120rem` and is centred. Then run
`table.spec.ts` from Task 2 — it should now pass, and that is this task's real gate.

- [ ] **Step 2: Run both and watch them fail**

- [ ] **Step 3: Restructure the view**

The prototype's lines 318 to 340 are the markup source for both sections.

- [ ] **Step 4: Run everything, then commit**

```shell
make verify
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/today.spec.ts tests/table.spec.ts'
git commit -m "feat(#95): Today, rebuilt as two sections of one list"
```

---

### Task 5: Week

**Files:**
- Modify: `web/src/views/week.ts`
- Test: `.claude/e2e/tests/week.spec.ts` (extend)

**Interfaces:**
- Consumes: the tooltip from Task 1.
- Produces: no new interface.

Structurally Week needs least — it is already a table with the right column semantics, and its
markers are already CSS shapes rather than characters. What changes:

- **Every cell is a control, empty ones included.** A cell opens the entries dialog for that ticket
  and that day: with a figure it edits, empty it adds. **Totals stay inert** — a total is a sum, and
  there is nothing to edit about it.
- **A cell's hover hugs its figure**, with the same padding as every other control. It does not span
  the column.
- **Each cell carries a popover** naming its value, its push state, and whether clicking adds or
  edits. **The legend under the grid goes**, replaced by those.
- **The three week controls share one 36px height** so they sit on a line.
- **The failed marker goes from 6×5 to 9×8.** It was too small to read as a shape.
- **Unchanged on purpose:** the marker shapes, worst-wins on a cell and on a day, totals never taking
  a marker, row order by instance position then key, and **the em dash in an empty cell** — which is
  punctuation, not an icon.

The prototype's line 360 is the grid's markup source.

- [ ] **Step 1: Extend the failing test**

In `week.spec.ts`:

1. An empty cell is a control and opens the dialog in add mode; a cell with a figure opens it in edit
   mode.
2. A total is not a control and does not open anything.
3. A cell's popover names its value and its push state, and says whether clicking adds or edits.
4. The legend is gone.
5. The three week controls share one height.
6. **The existing assertion that a failed marker and an unpushed one differ in shape, not only in
   hue, still passes** — the marker grew and must not have become the same shape as another.

- [ ] **Step 2: Run it and watch it fail**

- [ ] **Step 3: Make the changes**

- [ ] **Step 4: Run everything, then commit**

```shell
make verify
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/week.spec.ts'
git commit -m "feat(#95): every Week cell is a control, and says what it will do"
```

---

### Task 6: The entries dialog

**Files:**
- Modify: `web/src/components/that-entry-dialog.ts`
- Test: `.claude/e2e/tests/entries.spec.ts` (extend)

**Interfaces:**
- Consumes: the tooltip from Task 1, the icon set, the elevation tokens.
- Produces: no new interface. **Its interaction was settled by the manual-entry ticket and is not
  reopened** — this is a restyle and a restructure.

- **Header.** The instance dot, the instance name and the ticket key on one line separated by a
  middot, with the ticket's total and the close control pinned right by their own auto margin. The
  summary is a subtitle beneath: 14px, muted, wrapping the full width. The status and the day go.
- **Rows.** Duration, comment or a muted *No comment*, a push-state icon carrying a popover, then edit
  and delete as icon buttons. The start time goes. Delete goes red on hover.
- **Editing.** The row being edited takes an active state — a wash with a magenta bar down its left
  edge — and the submit becomes *Save* with an icon Cancel beside it. This replaces both the mode line
  and the dimming of every other row.
- **The form.** The duration control is the real one: a bordered group of minus, a 64px centred
  tabular field, and plus, hairline seams between the three, radius on the outside corners only, and
  **the group taking the focus ring rather than the input**. Then the comment field taking all the
  slack, and the submit holding the right edge. There is no explanatory line — a new entry gets an
  unpushed marker, which says the same thing where it matters.

**The dialog must name its own ink.** It is a native `<dialog>` in the top layer, which does not
inherit from the view that opened it. That is the fourth trap in the design, and it is the one that
looked correct for thirteen passes because dark hid it. **Assert it in both themes.**

The prototype's lines 391 to 415 are the markup source.

- [ ] **Step 1: Extend the failing test**

In `entries.spec.ts`, and one of these matters more than the rest:

1. **In both themes**, the dialog's text colour resolves to the app's ink rather than being inherited
   from outside. This is the trap-4 regression test.
2. The header carries the dot, the instance, the key and the total, and no status and no day.
3. A row with no comment reads *No comment* in the muted tone, not the faint one.
4. Editing a row marks that row active and turns the submit into *Save* with a Cancel beside it, and
   no other row dims.
5. The duration group takes the focus ring, not the input inside it.

- [ ] **Step 2: Run it and watch it fail**

- [ ] **Step 3: Restructure the dialog**

- [ ] **Step 4: Run everything, then commit**

```shell
make verify
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/entries.spec.ts'
git commit -m "feat(#95): the entries dialog, restructured, naming its own ink"
```

---

## Finishing

- [ ] `make verify` — paste the output. Never claim green without it.
- [ ] `make test-e2e` — the frontend changed throughout, so this is not optional. Paste the output.
- [ ] **Check both themes by eye**, on Today, Week and the dialog. The fourth trap is the reason: a
  rule that is right in one theme is invisible until somebody switches, and no test on this branch
  would have caught the defect that taught us that.
- [ ] **The whole-branch review is not optional.** Use `superpowers:requesting-code-review` on the
  full branch diff, on the most capable model.
- [ ] Then `superpowers:finishing-a-development-branch`: push and open the pull request with
  `Closes #95`. **Do not merge into `main` locally** — that is forbidden outright.

## Risks worth stating before starting

1. **`today.ts` is 669 lines and holds five screen states, the pin form, the totals, the stale banner
   and the push report.** This plan changes its structure and none of its behaviour, and the existing
   suite is what proves that. If a task finds itself rewriting behaviour to make a layout work, that
   is the signal to stop and report rather than to keep going.
2. **The tables must agree with each other, not merely be correct individually.** Two cards whose
   columns start at different x is the defect the spacing rule exists to prevent, and it is invisible
   in a single card's diff. That is why Task 2's assertion compares cards to each other.
3. **The pin form stays.** #84 removes it. A task that tidies it away while building the pin column
   has taken another ticket's work and will fail review.
4. **The prototype outranks the spec**, and both outrank an implementer's sense of what looks right.
   Cite the line you built from.
