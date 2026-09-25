# Keyboard reach and cut text (#143) Implementation Plan

**Date:** 2026-09-25
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut text shows its full wording in the app's own tooltip, on hover and on keyboard focus of
its row's focusable element; the search panel stacks key over summary and moves by arrow keys; and a
keyboard-only walk of every view is recorded.

**Architecture:** `that-tooltip` gains three opt-in attributes — `wrap`, `when-cut` and `focus-for` —
so every consumer of cut text reuses the one component instead of a second tooltip. The search
panel's arrow movement is a pure function (`web/src/search-keys.ts`) unit-tested with `node --test`,
wired into `that-issue-search`'s own keydown handling.

**Tech Stack:** vanilla TypeScript WebComponents (light DOM), Tailwind v4, Playwright e2e (Firefox
and Chromium), `node --test` for pure functions.

**Spec:** the refined body of Codeberg issue #143 ("Settled at refinement", points 1–4, and its
acceptance criteria). Read it: `tea api "repos/{owner}/{repo}/issues/143" | jq -r .body`. Also
`docs/superpowers/specs/2026-09-03-visual-language-design.md` (Decision 7, the tooltip) and
`docs/superpowers/prototypes/2026-09-03-app-prototype.html` (`.rrow`, `.rk`, `.rs`, `.tip`).

## Global Constraints

- All commands run through `make` or `docker compose` — no Go, Node or npm on the host.
- Vanilla TS only, light DOM, `that-*` components. No `any`, no `as any`, no non-null assertion.
- A tooltip is **never the accessible name**: nothing here sets ARIA on a trigger.
- The cut-text tooltip is `that-tooltip`, same look as every icon tooltip, wrapping at about 340px.
- It shows **only when the text is cut** (`scrollWidth > clientWidth`).
- **No new Tab stop.** Focus reveal rides on the row's existing focusable element (the key link).
- The search input keeps `aria-expanded` and `aria-controls` and gains **no** combobox role.
- Search results stay buttons and links; **not** a listbox.
- Every behaviour has an e2e test that runs in both Firefox and Chromium (the rig already runs both).
- Comments: few, only the non-obvious why. Prettier formatting is checked by `make lint`.
- Commits may be made unsigned (`git -c commit.gpgsign=false commit …`) if signing fails. **Never push.**

## Review Focus

1. **A repaint while a cut-text tooltip is open** (pin or unpin from the search panel): the tooltip
   must not stay stranded in the top layer after its row is rebuilt. `disconnectedCallback` must hide
   it. Test in Task 1.
2. **A resize that uncuts text while hovered** is not required; but a text that is **not** cut must
   never show a tooltip on key-link focus either — not only on hover. Test in Task 2.
3. **A row whose hit has no URL** has no key link: arrow movement must start at its first control,
   not skip the row. Unit test in Task 4.
4. **Rows with different control counts** (Today: key, Log, pin; a no-URL row: Log, pin): Up/Down keep
   the position where the next row has it, and clamp to its last control otherwise. Unit test in Task 4.
5. **A tooltip near the window's left edge** (the rail) must not open off-screen. Clamp in Task 1.

---

### Task 1: `that-tooltip` learns `wrap`, `when-cut` and `focus-for`

**Files:**
- Modify: `web/src/components/that-tooltip.ts`
- Test: `.claude/e2e/tests/tooltip.spec.ts` (append; reuse its `beforeEach` and style of mounting)

**Interfaces:**
- Produces, for Tasks 2, 3 and 5: a `<that-tooltip for="<text id>" wrap when-cut focus-for="<focusable id>">`
  whose text is the full string. `for` names the **text element** (hover target and position anchor).
  `focus-for` names an optional **second element** whose `focus`/`blur` show and hide it.
  Both ids must be in the document before the tooltip connects (same contract as `for` today).

- [ ] **Step 1: Write the failing e2e tests** (append to `tooltip.spec.ts`)

```ts
async function mountCutText(
  page: import("@playwright/test").Page,
  text: string,
  width: number,
): Promise<void> {
  await page.evaluate(
    ({ text, width }) => {
      const link = document.createElement("a");
      link.id = "cut-link";
      link.href = "#";
      link.textContent = "KEY-1";

      const span = document.createElement("span");
      span.id = "cut-text";
      span.className = "block truncate";
      span.style.width = `${width}px`;
      span.textContent = text;

      const tooltip = document.createElement("that-tooltip");
      tooltip.dataset["fixture"] = "";
      tooltip.setAttribute("for", "cut-text");
      tooltip.setAttribute("focus-for", "cut-link");
      tooltip.setAttribute("wrap", "");
      tooltip.setAttribute("when-cut", "");
      tooltip.textContent = text;

      document.body.prepend(link, span, tooltip);
    },
    { text, width },
  );
}

const longText =
  "A summary long enough that no reasonable column shows all of it, so the ellipsis engages";

test("a when-cut tooltip opens on hover of cut text and wraps", async ({ page }) => {
  await mountCutText(page, longText, 120);
  const tip = page.locator("that-tooltip[data-fixture]");
  await page.locator("#cut-text").hover();
  await expect(tip).toBeVisible();
  const box = await tip.boundingBox();
  expect(box?.width ?? 0).toBeLessThanOrEqual(341);
  expect(box?.height ?? 0).toBeGreaterThan(30); // more than one line: it wraps
});

test("a when-cut tooltip opens on focus of its focus-for element, and closes on blur", async ({
  page,
}) => {
  await mountCutText(page, longText, 120);
  const tip = page.locator("that-tooltip[data-fixture]");
  await page.locator("#cut-link").focus();
  await expect(tip).toBeVisible();
  await page.locator("#cut-link").blur();
  await expect(tip).toBeHidden();
});

test("a when-cut tooltip stays closed when the text is not cut, on hover and on focus", async ({
  page,
}) => {
  await mountCutText(page, "Short", 400);
  const tip = page.locator("that-tooltip[data-fixture]");
  await page.locator("#cut-text").hover();
  await expect(tip).toBeHidden();
  await page.locator("#cut-link").focus();
  await expect(tip).toBeHidden();
});

test("a tooltip removed while open leaves nothing in the top layer", async ({ page }) => {
  await mountCutText(page, longText, 120);
  await page.locator("#cut-link").focus();
  await expect(page.locator("that-tooltip[data-fixture]")).toBeVisible();
  const open = await page.evaluate(() => {
    document.querySelector("that-tooltip[data-fixture]")?.remove();
    return document.querySelectorAll(":popover-open").length;
  });
  expect(open).toBe(0);
});

test("a tooltip near the left edge stays inside the window", async ({ page }) => {
  await page.evaluate(() => {
    const span = document.createElement("span");
    span.id = "edge-text";
    span.className = "block truncate";
    span.style.cssText = "position:fixed;left:0;top:200px;width:40px";
    span.textContent = "An instance name far too long for the rail";
    const tooltip = document.createElement("that-tooltip");
    tooltip.dataset["fixture"] = "";
    tooltip.setAttribute("for", "edge-text");
    tooltip.setAttribute("wrap", "");
    tooltip.setAttribute("when-cut", "");
    tooltip.textContent = span.textContent;
    document.body.append(span, tooltip);
  });
  await page.locator("#edge-text").hover();
  const box = await page.locator("that-tooltip[data-fixture]").boundingBox();
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
});
```

Note: `mountCutText` prepends to `body` so the elements are on screen above the Today view's
content. If a test finds the text off-screen, position the fixtures `fixed` as the last test does.

- [ ] **Step 2: Run to verify they fail**

Run: `docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/tooltip.spec.ts'`
Expected: the new tests FAIL (focus-for does nothing; when-cut is ignored; the tooltip is `whitespace-nowrap`; the edge case opens at a negative x). Paste the failing output in the report.

- [ ] **Step 3: Implement**

In `that-tooltip.ts`:

```ts
  private focusTrigger: HTMLElement | null = null;

  connectedCallback(): void {
    this.setAttribute("popover", "manual");
    this.className =
      "bg-rail text-rail-ink shadow-popover rounded-xs px-2 py-1 text-sm " +
      (this.hasAttribute("wrap") ? "max-w-[340px] whitespace-normal" : "whitespace-nowrap");

    const id = this.getAttribute("for");
    const trigger = id ? document.getElementById(id) : null;
    if (!trigger) return;
    this.trigger = trigger;

    trigger.addEventListener("pointerenter", this.onShow);
    trigger.addEventListener("pointerleave", this.onHide);
    trigger.addEventListener("focus", this.onShow);
    trigger.addEventListener("blur", this.onHide);

    // Cut text is not focusable itself; its row's key link is, and it is
    // already the row's first Tab stop, so no new Tab stop is added (#143).
    const focusId = this.getAttribute("focus-for");
    const focusTrigger = focusId ? document.getElementById(focusId) : null;
    if (focusTrigger) {
      this.focusTrigger = focusTrigger;
      focusTrigger.addEventListener("focus", this.onShow);
      focusTrigger.addEventListener("blur", this.onHide);
    }
    // … existing MutationObserver block unchanged …
  }
```

In `disconnectedCallback`, before the existing early return on `!trigger`, hide an open popover and
detach the focus trigger:

```ts
    if (this.matches(":popover-open")) this.hidePopover();
    this.focusTrigger?.removeEventListener("focus", this.onShow);
    this.focusTrigger?.removeEventListener("blur", this.onHide);
    this.focusTrigger = null;
```

(`hidePopover` on a disconnected element may throw in some engine; if a browser throws, move the
hide into the `remove()` path by listening for it is not possible — instead wrap it in `try/catch`
and verify the top-layer test still passes. Report which you needed.)

In `reveal()`, first line after the `trigger` guard:

```ts
    // #143: a cut-text tooltip exists only to give back what the ellipsis took.
    if (this.hasAttribute("when-cut") && trigger.scrollWidth <= trigger.clientWidth) return;
```

And clamp `left` inside the window before assigning it:

```ts
    const edge = 8;
    const clamped = Math.min(Math.max(left, edge), window.innerWidth - this.offsetWidth - edge);
    this.style.left = `${clamped}px`;
```

- [ ] **Step 4: Run to verify they pass**, plus the whole of `tooltip.spec.ts` (the existing
  icon-tooltip tests must not move — the clamp only changes a tooltip that would open off-screen).

- [ ] **Step 5:** `make verify`. Commit: `that-tooltip can wrap, open only when its text is cut, and follow a second focus target (#143)`.

---

### Task 2: Today's ticket row gives its cut summary back

**Files:**
- Modify: `web/src/components/that-ticket-row.ts` (`render`, `keyLabel`, `summarySpan`)
- Test: create `.claude/e2e/tests/cut-text.spec.ts`

**Interfaces:**
- Consumes: Task 1's `that-tooltip` attributes.
- Produces: nothing new for later tasks.

The summary span gets an id (`that-sum-<n>`, a module-level sequence like `pinTriggerSequence`), the
key **link** gets an id (`that-key-<n>`), and a `that-tooltip` with `for` = summary id, `focus-for`
= key-link id (omit `focus-for` when the key is a plain span: no URL, nothing focusable), `wrap`,
`when-cut`, and the full summary as text, is appended to the summary cell after the summary span.

The failure note under a summary (`failureNote`) also truncates. It gets a hover-only `when-cut wrap`
tooltip (no `focus-for`): showing two tooltips on one key-link focus would stack them over each
other. **Record this in the report as a decision the owner may reverse.** The note is `role="status"`,
so it is already announced.

- [ ] **Step 1: Write the failing e2e tests** in `cut-text.spec.ts`. Copy `stubIssues`, `group` and
  the `beforeEach` stubbing `/api/pins` and `/api/entries` from `today.spec.ts`. Set a narrow
  viewport so the summary cuts: `test.use({ viewport: { width: 900, height: 700 } })`.

```ts
const longSummary =
  "Reconcile the quarterly capacity forecast against every team's actual booked hours, " +
  "including the contractors who log time in a different instance entirely";

test("a cut summary in a Today row shows its full text on hover", async ({ page }) => {
  await stubIssues(page, [group(1, "Work", [issue("WORK-1", longSummary)])]);
  await page.goto("/today");
  await page.getByText(longSummary, { exact: true }).first().hover();
  const tip = page.locator("that-tooltip", { hasText: longSummary });
  await expect(tip).toBeVisible();
});

test("a cut summary in a Today row shows its full text when the key link is focused", async ({
  page,
}) => {
  await stubIssues(page, [group(1, "Work", [issue("WORK-1", longSummary)])]);
  await page.goto("/today");
  await page.getByRole("link", { name: "WORK-1" }).focus();
  await expect(page.locator("that-tooltip", { hasText: longSummary })).toBeVisible();
});

test("a Today summary that is not cut shows no tooltip on hover or focus", async ({ page }) => {
  await stubIssues(page, [group(1, "Work", [issue("WORK-2", "Short one")])]);
  await page.goto("/today");
  await page.getByText("Short one", { exact: true }).hover();
  await expect(page.locator("that-tooltip", { hasText: "Short one" })).toBeHidden();
  await page.getByRole("link", { name: "WORK-2" }).focus();
  await expect(page.locator("that-tooltip", { hasText: "Short one" })).toBeHidden();
});
```

with `issue(key, summary)` returning `{ key, summary, status: "To Do", url: \`https://work.atlassian.net/browse/${key}\` }`.
`getByText(...).first()` because the tooltip carries the same text.

- [ ] **Step 2:** Run `npx playwright test tests/cut-text.spec.ts`; expect FAIL (no such tooltip). Paste it.
- [ ] **Step 3:** Implement as described above.
- [ ] **Step 4:** Run `cut-text.spec.ts`, `today.spec.ts`, `table.spec.ts` and `pins.spec.ts`; all pass.
- [ ] **Step 5:** `make verify`. Commit: `A cut summary in a ticket row comes back in a tooltip, on hover and on key focus (#143)`.

---

### Task 3: The search panel stacks key over summary, and gives the cut summary back

**Files:**
- Modify: `web/src/components/that-issue-search.ts` (`resultRow`, `keyLabel`, `summaryLabel`)
- Modify: `docs/superpowers/prototypes/2026-09-03-app-prototype.html` (`.rrow` CSS near line 200–209,
  and the six `.rrow` rows near lines 409–436)
- Modify: `docs/superpowers/specs/2026-09-03-visual-language-design.md` (Decision 7, and the search
  panel's section)
- Test: `.claude/e2e/tests/search.spec.ts` (append)

**Interfaces:**
- Consumes: Task 1's `that-tooltip` attributes.
- Produces, for Task 4: every row still carries `data-hit-key`; every focusable element in it still
  carries `data-control-index` (`"key"` for the link, `"0"`, `"1"`… for controls), in DOM order.

The row becomes: a text column (`min-w-0 flex-1 flex flex-col`) holding the key (`self-start`) above
the summary (`truncate`, no `flex-1`), then the host's controls to the right, vertically centred as
today. The summary gets an id and a `that-tooltip` (`for` = summary, `focus-for` = key link when there
is one, `wrap`, `when-cut`), appended inside the text column.

```ts
  private resultRow(config: IssueSearchConfig, hit: IssueHit): HTMLElement {
    const row = document.createElement("div");
    row.className = "hover:bg-hover flex items-center gap-2.5 rounded-sm px-[9px] py-1.5";
    row.dataset.hitKey = hitKey(hit);

    // #143: key above summary, so the summary gets the row's full width.
    const text = document.createElement("div");
    text.className = "flex min-w-0 flex-1 flex-col";
    const key = this.keyLabel(hit);
    const summary = this.summaryLabel(hit);
    text.append(key, summary, this.summaryTooltip(hit, summary, key));
    row.append(text);
    // … controls loop unchanged …
  }
```

`keyLabel` drops `shrink-0` and gains `self-start` and an `id` (link only);
`summaryLabel` becomes `"truncate text-base"` with an `id`. Ids come from a module-level sequence,
like `iconControlSequence`.

The prototype: `.rrow .rtext { flex: 1; min-width: 0; display: flex; flex-direction: column; }`,
`.rrow .rk { align-self: flex-start; }`, and `.rs` loses `flex: 1`; each of the six rows wraps its
`.rk` and `.rs` in `<div class="rtext">`. Keep the prototype a fragment — **never add a doctype**.

The visual language spec, under Decision 7, adds one paragraph: a text cut by an ellipsis gives its
full wording back in the same tooltip, in a wrapping variant about 340px wide, only when it is cut,
on hover of the text and on focus of its row's existing focusable element; never the accessible name.
Where the spec describes the search results row, state that the key sits above the summary and the
controls sit to their right (#143, 2026-09-23 refinement).

- [ ] **Step 1: Write the failing e2e tests** (append; reuse the file's `stubSearch`, `hit`, and its
  open-the-panel pattern from the existing Today and Week tests):

```ts
test("a search result draws its key above its summary, on the row's full text width", async ({ page }) => {
  // open Today's panel with one hit, as the existing tests do
  const row = page.locator("[data-hit-key]").first();
  const key = row.getByRole("link", { name: "RIDGE-5140" });
  const summary = row.getByText("Capacity planning spreadsheet is out of date", { exact: true }).first();
  const k = await key.boundingBox();
  const s = await summary.boundingBox();
  expect((k?.y ?? 0) + (k?.height ?? 0)).toBeLessThanOrEqual((s?.y ?? 0) + 1);
  expect(Math.abs((k?.x ?? 0) - (s?.x ?? 0))).toBeLessThan(2);
});

test("a cut summary in the search panel shows its full text on key focus, on Today and on Week", async ({ page }) => {
  // for each of "/today" and "/week": stub one hit with a 150-character summary,
  // open the panel, focus the hit's key link, expect that-tooltip with the full text visible;
  // then hover the summary with focus elsewhere, expect it visible again.
});
```

Write the second test out in full, as one `for (const path of ["/today", "/week"])` loop or two
tests; copy the Week panel-opening steps from the existing Week search tests in the suite
(`grep -rn "that-issue-search" .claude/e2e/tests`).

- [ ] **Step 2:** Run; expect FAIL. Paste it.
- [ ] **Step 3:** Implement the component change, then the prototype and spec edits.
- [ ] **Step 4:** Run the whole `search.spec.ts` and `week.spec.ts`. Existing geometry tests may
  assume one-line rows; if one fails **because the row is now taller as the ticket requires**, update
  its expectation and say which and why in the report. Any other failure is a bug.
- [ ] **Step 5:** Compare against the drawing: open the updated prototype through the design
  companion's frame (see the `ticket-workflow` skill, "A prototype is captured inside the design
  companion's frame") beside the running app, and state in the report what you compared and what
  you found. `make verify`. Commit: `Search results stack key over summary, and a cut summary comes back in a tooltip (#143)`.

---

### Task 4: The search panel moves by arrow keys

**Files:**
- Create: `web/src/search-keys.ts`, `web/src/search-keys.test.ts`
- Modify: `web/src/components/that-issue-search.ts` (input keydown in `build`; a keydown listener on
  `rowsAreaEl`)
- Test: `.claude/e2e/tests/search.spec.ts` (append)

**Interfaces:**
- Produces:

```ts
/** Where focus goes for one arrow or Escape press inside the results. `rows` is each row's count of
 *  focusable elements, in order. `null` means the key is not the panel's to handle. */
export type SearchFocus = { row: number; column: number } | "input" | null;
export function nextSearchFocus(
  rows: number[],
  from: { row: number; column: number } | "input",
  key: string,
): SearchFocus;
```

Rules (issue #143, point 3):
- From `"input"`: `ArrowDown` → first row with at least one control, column 0. Nothing else is handled
  (`null`) — Escape in the input stays the input's own close, as today.
- In a row: `ArrowDown`/`ArrowUp` → the next/previous row that has at least one control, column
  `min(column, count - 1)`; `ArrowUp` from the first such row → `"input"`; `ArrowDown` from the last →
  stay (`{ row, column }`). `ArrowLeft`/`ArrowRight` → column −1/+1 clamped to the row (no wrap).
  `Escape` → `"input"`. Any other key → `null`.

- [ ] **Step 1: Write the failing unit tests** (table-driven, the style of `week-label.test.ts`):

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { nextSearchFocus } from "./search-keys.ts";

void test("arrow and Escape movement across result rows", async (t) => {
  const rows = [3, 2, 3]; // key+Log+pin, a no-URL row (Log+pin), key+Log+pin
  const cases: {
    name: string;
    from: { row: number; column: number } | "input";
    key: string;
    want: ReturnType<typeof nextSearchFocus>;
  }[] = [
    { name: "down from the input lands on the first control", from: "input", key: "ArrowDown", want: { row: 0, column: 0 } },
    { name: "up in the input is not handled", from: "input", key: "ArrowUp", want: null },
    { name: "escape in the input is not handled here", from: "input", key: "Escape", want: null },
    { name: "down keeps the column", from: { row: 0, column: 1 }, key: "ArrowDown", want: { row: 1, column: 1 } },
    { name: "down clamps to a shorter row", from: { row: 0, column: 2 }, key: "ArrowDown", want: { row: 1, column: 1 } },
    { name: "up from the first row returns to the input", from: { row: 0, column: 2 }, key: "ArrowUp", want: "input" },
    { name: "down from the last row stays", from: { row: 2, column: 1 }, key: "ArrowDown", want: { row: 2, column: 1 } },
    { name: "right moves along the row", from: { row: 0, column: 0 }, key: "ArrowRight", want: { row: 0, column: 1 } },
    { name: "right at the end stays", from: { row: 0, column: 2 }, key: "ArrowRight", want: { row: 0, column: 2 } },
    { name: "left at the start stays", from: { row: 1, column: 0 }, key: "ArrowLeft", want: { row: 1, column: 0 } },
    { name: "escape in a row returns to the input", from: { row: 1, column: 1 }, key: "Escape", want: "input" },
    { name: "tab is not handled", from: { row: 1, column: 1 }, key: "Tab", want: null },
  ];
  for (const c of cases) {
    await t.test(c.name, () => {
      assert.deepEqual(nextSearchFocus(rows, c.from, c.key), c.want);
    });
  }
});

void test("rows with no controls are skipped", () => {
  assert.deepEqual(nextSearchFocus([0, 2], "input", "ArrowDown"), { row: 1, column: 0 });
  assert.deepEqual(nextSearchFocus([2, 0, 2], { row: 0, column: 1 }, "ArrowDown"), { row: 2, column: 1 });
  assert.deepEqual(nextSearchFocus([0, 0], "input", "ArrowDown"), null);
});
```

- [ ] **Step 2:** `make test-web`; expect FAIL (module missing). Paste it.
- [ ] **Step 3:** Implement `nextSearchFocus` (about 30 lines, no DOM). Run `make test-web`; pass.
- [ ] **Step 4: Write the failing e2e tests** (append to `search.spec.ts`, three hits, Today; plus one
  Week case for Down from the input):
  1. Down in the input focuses the first row's key link.
  2. Down again focuses the second row's key link; Right then focuses that row's Log control.
  3. Up from the first row focuses the input, and the panel stays open (`aria-expanded="true"`).
  4. Escape in a row focuses the input and the panel stays open; a second Escape closes it.
  5. Tab from the input leaves the panel as today (focus goes to the first row's key link by the
     browser's own order — assert only that no arrow handler interferes: `aria-expanded` unchanged).
  6. After pressing the pin control with Enter, then Down, focus lands on the next row's pin control
     — the repaint does not break movement (the panel restores focus by `data-control-index`).
  7. On Week, Down in the input focuses the first row's first control.
- [ ] **Step 5:** Run; expect FAIL. Paste it.
- [ ] **Step 6: Wire it.** In `build`, the input's keydown: keep Escape → `close()`; on `ArrowDown`
  with the panel open, call a private `moveFocus("input", event)`. On `rowsAreaEl`, one keydown
  listener: find the focused element's row (`closest("[data-hit-key]")`) and its column (index among
  that row's `[data-control-index]` elements), call `nextSearchFocus` with the row list built from
  `rowsAreaEl.querySelectorAll("[data-hit-key]")`, and focus the answer (`"input"` → `this.input`);
  `preventDefault()` only when the answer is not `null`. Focus moves inside the component, so the
  `focusout` close does not fire. A Left/Right press inside a text field does not exist in a row
  (rows hold links and buttons only).
- [ ] **Step 7:** Run `search.spec.ts` and `week.spec.ts`; pass. `make verify`. Commit:
  `The search panel moves by arrow keys and Escape returns to the field (#143)`.

---

### Task 5: The rail and the entry dialog give their cut text back

**Files:**
- Modify: `web/src/rail.ts` (`figures` instance name; `runningTimerLine` key)
- Modify: `web/src/components/that-entry-dialog.ts` (`header` instance name; `entryRow` comment)
- Test: `.claude/e2e/tests/cut-text.spec.ts` (append)

Each cut text gets an id and a `that-tooltip wrap when-cut` with its full text, appended beside it:

| Text | `focus-for` | Why |
|---|---|---|
| Rail instance name (`figures`) | none | Nothing in that line is focusable. Hover only. |
| Rail running key (`runningTimerLine`) | the stop button | The line's only focusable element. |
| Dialog instance name (`header`) | none | The row's only focusable element is Close, which says nothing about the instance. Hover only. **Record as a decision the owner may reverse.** |
| Dialog entry comment (`entryRow`) | the row's edit button | The row's first focusable element. |

Ids must be unique per element instance: use a module-level sequence in `rail.ts`, and the dialog's
existing `this.sequence` plus the entry id for rows.

The rail repaints the timer line every second (`elapsed`) — confirm the tooltip is appended once per
running line, not per tick; if the running line is rebuilt per tick, the tooltip goes with it and
Task 1's disconnect fix hides it, which would make it flicker: then attach it to a node that
survives the tick and say so in the report.

- [ ] **Step 1: Write the failing e2e tests**: hover a long rail instance name (stub `/api/entries`
  with an entry whose `instanceName` is 80 characters — read `.claude/e2e/tests/timer.spec.ts` and
  `entries.spec.ts` for how they stub a running timer and open the dialog); focus the rail's stop
  button with a timer running on a long key (skip this one if Jira keys cannot be long enough to cut
  at the rail's width — measure first and report); hover the dialog header's long instance name;
  focus a long-comment entry's edit button in the dialog. Each expects `that-tooltip` with the full
  text visible. One not-cut case (a short comment) expects none.
- [ ] **Step 2:** Run; expect FAIL. Paste it.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `cut-text.spec.ts`, `timer.spec.ts`, `entries.spec.ts`; pass.
- [ ] **Step 5:** `make verify`. Commit: `The rail and the entry dialog give their cut text back in a tooltip (#143)`.

---

### Task 6: The keyboard audit

**Files:**
- Create: `.claude/e2e/tests/keyboard-audit.spec.ts` only if a fix below needs a test; otherwise none.
- Modify: whatever an unreachable control needs.

Walk every view — Today, Week, Settings, the entry dialog, the stop dialog, the confirm dialog, the
rail and the nav — **by keyboard alone** in the running app (both browsers; the Playwright MCP tools
or a throwaway spec that logs `document.activeElement` per Tab press). For each view record:

- what was reachable, and in how many Tab presses the last control was reached;
- anything **unreachable** — fix it in this task, with an e2e test per fix, TDD as usual;
- anything reachable but **slow** (for example tabbing a long Today table) — do **not** fix it; list
  it for the controller, who files it as an intake ticket.

- [ ] Report the audit as a Markdown table per view (reachable / fixed / slow), ready to paste into
  the pull request. Delete any throwaway spec. `make verify` if anything was fixed; commit fixes as
  `<what became reachable> (#143)`.

---

### Task 7 (controller): screenshots and the pull request

Not dispatched. After the whole-branch review: capture the stacked search panel and a summary tooltip
shown by keyboard focus, each in dark and light, attach with `.claude/tools/pr-attach.sh`, paste the
audit, file the slow-path intake tickets, and open the pull request with `Closes #143`.

---

## Additions asked for by the owner on 2026-09-25, while reviewing PR #229

### Task 8: the timer control and the key links carry the app's tooltip

**Files:**
- Modify: `web/src/components/that-timer.ts` (`connectedCallback`/`paint`)
- Modify: `web/src/components/that-ticket-row.ts` (`keyLabel`), `web/src/components/that-issue-search.ts`
  (`keyLabel`), `web/src/week-grid.ts` (the key link near line 95)
- Modify: `docs/superpowers/prototypes/2026-09-03-app-prototype.html` (key links `.c-key a`, `.grid .kk`,
  `.rrow .rk`), `docs/superpowers/specs/2026-09-03-visual-language-design.md` (Decision 7)
- Test: `.claude/e2e/tests/tooltip.spec.ts` or a view spec, and every spec that finds a key by its
  `title` (`grep -rn "getByTitle\|Open .* in Jira" .claude/e2e/tests`)

**Timer.** The prototype already draws it: every row timer control carries `<span class="tip end">start
timer</span>`, or `stop timer` while it runs. `that-timer` gains a `that-tooltip` with `for` = its
button's id (a module-level sequence, as `pinTriggerSequence` in that-ticket-row.ts), `anchor="end"`,
and text "start timer" / "stop timer", set in `paint()` next to the `aria-label`. The tooltip's own
MutationObserver already repositions it when its text changes while open. Follow the pin control's
button-plus-tooltip pattern in that-ticket-row.ts (`appendPinControl`).

**Key links.** A key that is an `<a>` loses its `title` attribute and gains a `that-tooltip` reading
**"open in Jira"** (lowercase, like every other tooltip), default (centred) anchor, `for` = the link's
id. The link's existing id stays: in the ticket row and the search panel it is also the cut-summary
tooltip's `focus-for`, so focusing a key opens both tooltips — the key's above the key, the summary's
above (Today) or below (search panel) the summary. A key with no URL (a plain `<span>`) is out of
scope: leave it exactly as it is. Week's key link gets an id from a module-level sequence.

**Prototype.** Replace the `title` on each drawn key link with a `<span class="tip">open in Jira</span>`
inside it, and add the key links to the CSS rule that reveals `.tip` on hover and focus-visible
(prototype line 167: `.iconbtn:hover .tip, …`). The prototype stays a fragment — never add a doctype.
**Spec.** Decision 7 gains one sentence: a key that links to Jira carries a tooltip reading "open in
Jira", replacing the native title (owner, 2026-09-25).

- [ ] **Step 1: failing e2e tests** (both browsers):
  1. On Today, hovering a row's timer control shows a `that-tooltip` reading exactly "start timer";
     after starting the timer (stub the timer API the way `timer.spec.ts` does), the same control's
     tooltip reads "stop timer".
  2. On Today, a row's key link has no `title` attribute; hovering it shows a tooltip reading exactly
     "open in Jira"; focusing it shows it too.
  3. The same for a search-panel result's key link, and for a Week grid key link.
- [ ] **Step 2:** run; FAIL; paste it.
- [ ] **Step 3:** implement, prototype and spec edits included.
- [ ] **Step 4:** update every test that located a key by its title (`getByTitle("Open X in Jira")`,
  e.g. `resultRow` in search.spec.ts) to locate it by role and name instead
  (`getByRole("link", { name: "X" })`), keeping what each test asserts. List every change.
- [ ] **Step 5:** `make verify` and the FULL `make test-e2e`; paste both summaries. Commit:
  `The timer control and the key links carry the app's tooltip (#143)`.

### Task 9: focusable keys and summaries, each with its own tooltip (owner, 2026-09-25)

The owner, later in the review of PR #229: "Make the ticket key focusable and split both tooltips.
Also, make ticket summaries focusable and apply the same split." This replaces the rule "no new Tab
stop" for these texts. It also folds in #235 (the rail stop button's tooltip).

**Files:**
- Modify: `web/src/rail.ts` (`runningTimerLine`), `web/src/components/that-ticket-row.ts`
  (`summarySpan`, `summaryTooltip`), `web/src/components/that-issue-search.ts` (`summaryLabel`,
  `summaryTooltip`, `captureFocus`/`restoreFocus` if needed),
  `docs/superpowers/specs/2026-09-03-visual-language-design.md` (Decision 7)
- Test: `.claude/e2e/tests/cut-text.spec.ts`, `timer.spec.ts`, `search.spec.ts`, and any spec whose Tab
  counts or arrow-key orders change

**Rail.** The running key span gets `tabindex="0"` and a visible focus ring (the same `focus-visible`
treatment the key links use). Its cut-text tooltip keeps `for` = the key and **drops `focus-for`**:
that-tooltip already opens on its `for` element's own focus. The stop button gains a `that-tooltip`
reading "stop timer", `anchor="end"`, `for` = the stop button (prototype line ~395 draws it). The stop
button's focus opens only "stop timer".

**Today's rows.** The summary span gets `tabindex="0"` and the focus ring. Its tooltip keeps `for` =
the summary (no `focus-for`), so it opens on hover and on the summary's own focus. Key focus opens only
"open in Jira" (already true).

**Search panel.** The summary gets `tabindex="0"`, the focus ring and `data-control-index="summary"`,
so it joins the arrow-key order in DOM order: key, summary, then the controls. Its tooltip drops
`focus-for` and keeps `below`. `captureFocus`/`restoreFocus` must restore focus to a focused summary
after a repaint. A no-URL hit's row starts at the summary.

**Only when cut:** the tooltip still opens only when the text is cut (`when-cut`). A focusable
summary that is not cut shows no tooltip on focus.

**Spec.** Decision 7's cut-text paragraph now says: cut text is focusable and opens its tooltip on its
own focus; a key or control focus opens only that control's tooltip (owner, 2026-09-25). Replace the
earlier sentence about Today's rows being hover-only.

- [ ] Step 1: failing e2e tests, both browsers:
  1. Rail, timer running on a long key: Tab reaches the key; its full-key tooltip is visible and
     "stop timer" is not. Tab to the stop button: "stop timer" is visible and the full-key tooltip is not.
  2. Today: Tab from the key link reaches the cut summary; its tooltip is visible and "open in Jira" is
     hidden. Key focus: "open in Jira" only.
  3. Search panel: ArrowDown to the key, ArrowRight to the summary: summary tooltip visible (below the
     summary), "open in Jira" hidden; ArrowRight again reaches the first control. A no-URL hit's first
     control is its summary. Pinning from a row whose summary had focus restores focus to that summary.
  4. A not-cut focusable summary shows no tooltip on focus.
- [ ] Step 2: run; FAIL; paste it.
- [ ] Step 3: implement; update every test whose Tab count or arrow order changed, and list them.
- [ ] Step 4: `make verify` and the FULL `make test-e2e`; paste both. Commit:
  `Keys and summaries take focus and open only their own tooltip (#143)`.
