# Tooltip after the entries dialog Implementation Plan

**Date:** 2026-09-30
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Closing Week's entries dialog with the mouse no longer reopens the cell's tooltip, a keyboard close still shows it, and no tooltip ever catches a click (#107).

**Architecture:** Two changes in `web/src/components/that-tooltip.ts` and none in the dialog. (1) A `focus` event reveals the tooltip only when its target matches `:focus-visible`; pointer hover is unchanged. (2) The tooltip carries `pointer-events-none`. Both apply to every tooltip.

**Tech Stack:** TypeScript, Tailwind CSS v4, Playwright (Firefox and Chromium).

**Spec:** Codeberg issue #107 (its body is the spec; the 2026-09-23 comment holds the measured `:focus-visible` table). This branch is stacked on #246's (`issue-246-tooltip-button-review`, PR #266), which already rewrote the tooltip's skin and added its `::after` arrow.

## Global Constraints

- All tooling runs through `make` or `docker compose`; never Go, Node or npm on the host.
- No JavaScript frameworks; Tailwind v4 utilities only; light DOM.
- Firefox and Chromium only.
- The dialog keeps its normal focus return. Nothing changes where the dialog returns focus.
- The mixed dialog cases (opened by click and closed with Escape; opened from the keyboard and closed by click) are unspecified. No test asserts them.
- Do not run Prettier on `.claude/e2e/`; it has no config there and reformats unrelated lines.
- Commits: if `git commit` fails on signing, retry with `git -c commit.gpgsign=false commit …`. Never push.

## Review Focus

1. A tooltip with a second focus target (`focus-for`, the entries dialog's comment tooltip) must be gated the same way as its own trigger.
2. Existing specs reveal tooltips with a programmatic `.focus()`. After a pointer interaction, a programmatic focus may not match `:focus-visible`, so such a test can start failing. Where the test's intent is keyboard focus, the fix is to reach the element with the keyboard, never to delete the assertion. Each changed test is listed in the report with the reason.
3. `pointer-events: none` on the host also covers #246's `::after` arrow.
4. The existing hover tests must still pass: a pointer reveal is unchanged.
5. Chromium focuses a clicked button, and Firefox does not. After this change, a click shows the tooltip through hover only, in both browsers.

---

### Task 1: A focus reveals the tooltip only when it is keyboard focus

**Files:**
- Modify: `web/src/components/that-tooltip.ts` (the `focus` listeners on the trigger and on the `focus-for` element, in `connectedCallback` and `disconnectedCallback`)
- Test: `.claude/e2e/tests/week.spec.ts` (two new tests; remove the blur workaround in the test "every cell is a control that opens the entries dialog for its ticket")

**Interfaces:**
- Produces: a private handler `onFocus` used by both focus listeners.

- [ ] **Step 1: Write the failing tests**

Add after the test "every cell is a control that opens the entries dialog for its ticket", using that test's own setup (`openWeek`, `rollup`, `row`, `ticketRow`, `THIS_WEEK`):

```ts
// #107: showModal() hands focus back to the cell that opened the dialog. A
// tooltip reveals on focus only when that focus is :focus-visible, which the
// browsers give a keyboard close and withhold from a mouse close.
async function openCellWeek(page: Page): Promise<Locator> {
  await openWeek(page, {
    [THIS_WEEK]: rollup(THIS_WEEK, [row("RIDGE-1", [{ at: 0, seconds: 3600, pushState: "pushed" }])]),
  });
  return ticketRow(page, "RIDGE-1").locator("td").nth(0).locator("button");
}

test("opening a cell's dialog by click and closing it by click leaves no tooltip open", async ({ page }) => {
  const cell = await openCellWeek(page);
  const id = await cell.getAttribute("id");
  const tooltip = page.locator(`that-tooltip[for="${id}"]`);
  const dialog = page.locator("dialog[open]");

  await cell.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);

  await expect(cell).toBeFocused();
  await expect(tooltip).toBeHidden();
});

test("opening a cell's dialog from the keyboard and closing it with Escape shows the cell's tooltip", async ({
  page,
}) => {
  const cell = await openCellWeek(page);
  const id = await cell.getAttribute("id");
  const tooltip = page.locator(`that-tooltip[for="${id}"]`);
  const dialog = page.locator("dialog[open]");

  await cell.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await expect(cell).toBeFocused();
  await expect(tooltip).toBeVisible();
});
```

The cell button must carry an `id` (the tooltip's `for` resolves it — `week-grid.ts` sets both). If the cell's `id` is null, stop and report NEEDS_CONTEXT.

Then, in the test "every cell is a control that opens the entries dialog for its ticket", delete the comment starting `// showModal() hands focus back to the cell that opened it` and the `page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); });` call after it. The test's next click must now succeed without it.

- [ ] **Step 2: Run the tests to verify they fail**

```shell
docker compose --profile e2e rm --stop --force app-e2e
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test week.spec.ts -g "dialog|every cell is a control" --reporter=line'
docker compose --profile e2e rm --stop --force app-e2e
```
Expected: "…closing it by click leaves no tooltip open" fails in both browsers (the tooltip is visible). The keyboard test may already pass — that is the behaviour to keep. "every cell is a control…" may fail with the workaround gone (the reopened tooltip intercepts the next click). Record the output.

- [ ] **Step 3: Implement**

In `web/src/components/that-tooltip.ts`, add beside `onShow`:

```ts
  // #107: a focus reveals the tooltip only when it is keyboard focus. The
  // browser already tells the two apart, and showModal() returns focus to the
  // opener on close — with :focus-visible after a keyboard close, without it
  // after a mouse close — so a mouse close no longer reopens the tooltip.
  private readonly onFocus = (event: FocusEvent): void => {
    if (event.target instanceof Element && event.target.matches(":focus-visible")) this.reveal();
  };
```

Replace every `addEventListener("focus", this.onShow)` and `removeEventListener("focus", this.onShow)` with `this.onFocus` — for the trigger and for `focusTrigger` alike. Leave `pointerenter`, `pointerleave` and `blur` as they are.

- [ ] **Step 4: Run the tests to verify they pass**

Run the Step 2 command. Expected: all pass in both browsers.

- [ ] **Step 5: Run the whole e2e suite and repair focus-driven tests**

```shell
make test-e2e
```
Any test that now fails because it reveals a tooltip with a programmatic `.focus()` after a pointer interaction: reach the same element with the keyboard instead (`page.keyboard.press("Tab")` from the element before it, or `locator.press(...)`), keeping every assertion. Do not delete or weaken an assertion. List each changed test and the reason in the report. A test that asserts a tooltip after a *mouse* focus is a conflict with this ticket: stop and report it as DONE_WITH_CONCERNS with the test's name.

- [ ] **Step 6: Run the gates and commit**

```shell
make verify
make test-e2e
git add web/src/components/that-tooltip.ts .claude/e2e/tests/
git commit -m "#107: a focus reveals a tooltip only when it is keyboard focus"
```

---

### Task 2: A tooltip never catches a click

**Files:**
- Modify: `web/src/components/that-tooltip.ts` (the class string in `connectedCallback`)
- Test: `.claude/e2e/tests/tooltip.spec.ts` (one new test)

**Interfaces:**
- Consumes: Task 1's `onFocus` (a Tab focus reveals the tooltip).

- [ ] **Step 1: Write the failing test**

Add after the test "focusing the trigger by keyboard shows the tooltip too":

```ts
// #107: a tooltip is never interactive, so a click where it sits reaches the
// element under it. Revealed by keyboard so that moving the pointer to click
// cannot close it first.
test("a shown tooltip lets a click through to the element under it", async ({ page }) => {
  await page.evaluate(() => {
    const trigger = document.createElement("button");
    trigger.id = "through-trigger";
    trigger.type = "button";
    trigger.setAttribute("aria-label", "Pin this issue");
    trigger.textContent = "•";
    trigger.style.cssText = "position: fixed; top: 300px; left: 300px; width: 34px; height: 34px;";

    const under = document.createElement("button");
    under.id = "under";
    under.type = "button";
    under.textContent = "under";
    under.style.cssText = "position: fixed; top: 240px; left: 220px; width: 200px; height: 60px;";
    under.addEventListener("click", () => (under.dataset["clicked"] = "yes"));

    const tooltip = document.createElement("that-tooltip");
    tooltip.dataset["fixture"] = "";
    tooltip.setAttribute("for", "through-trigger");
    tooltip.textContent = "Pin this issue";

    document.body.append(under, trigger, tooltip);
  });

  await page.locator("#through-trigger").focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  const tooltip = page.locator("that-tooltip[data-fixture]");
  await expect(tooltip).toBeVisible();

  const box = await tooltip.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

  await expect(page.locator("#under")).toHaveAttribute("data-clicked", "yes");
});
```

The `under` button is placed so the tooltip (above the trigger, 7px gap) sits over it. If the Shift+Tab/Tab pair does not land focus on `#through-trigger` (check with `await expect(page.locator("#through-trigger")).toBeFocused()`), reach it with the keyboard another way; keep the reveal a keyboard one.

- [ ] **Step 2: Run the test to verify it fails**

```shell
docker compose --profile e2e rm --stop --force app-e2e
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tooltip.spec.ts -g "click through|lets a click" --reporter=line'
docker compose --profile e2e rm --stop --force app-e2e
```
Expected: fails in both browsers — the tooltip catches the click, so `#under` has no `data-clicked`.

- [ ] **Step 3: Implement**

In the class string in `connectedCallback`, add `pointer-events-none` after `overflow-visible`.

- [ ] **Step 4: Run the test to verify it passes**

Run the Step 2 command. Expected: passes in both browsers.

- [ ] **Step 5: Run the gates and commit**

```shell
make verify
make test-e2e
git add web/src/components/that-tooltip.ts .claude/e2e/tests/tooltip.spec.ts
git commit -m "#107: a tooltip never catches a click"
```
