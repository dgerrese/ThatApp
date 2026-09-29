# Every cut text is its own Tab stop (#236) Implementation Plan

**Date:** 2026-09-29
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The four cut texts that still follow the old tooltip rule — a pinned row's failure note, the rail's instance-name slices, the entry dialog's instance name and each entry's comment — each become a Tab stop of their own that opens its own tooltip on its own focus, and no control's focus opens a neighbour's tooltip any more.

**Architecture:** Each site copies the summaries' existing shape (`summarySpan()`/`summaryTooltip()` in `web/src/components/that-ticket-row.ts`): `tabIndex = 0` on the text and `cutTextTooltip(id, text)` with no focus target. `when-cut` already keeps the tooltip shut when the text fits, so every text is **always** a Tab stop — cut or not, including "No comment" — and nothing observes resizes. Once the entry dialog's comment stops passing the Edit button's id, `focus-for` has no user left, so the attribute is removed from `that-tooltip` and its parameter from `cutTextTooltip`. The dialog's instance name now precedes Close in tree order, so Close takes `autofocus` to stay the element `showModal()` focuses.

**Tech Stack:** TypeScript (vanilla WebComponents, light DOM), Playwright e2e in Firefox and Chromium.

**Spec:** Codeberg issue #236 — its body's *Approach* settles the question its one comment left open: every one of the four texts is **always** a Tab stop. The rule it extends: `docs/superpowers/specs/2026-09-03-visual-language-design.md`, *Decision 7 — a tooltip lives in the top layer* (the cut-text paragraph, line ~457–467), which this plan rewrites. The drawing: `docs/superpowers/prototypes/2026-09-03-app-prototype.html` — the entry dialog (`.ehead` line ~486, `.elist` rows built at line ~650–660, `.ecomment` line ~290, `.estate` and its `.tip` line ~293–294, `.tip` lines ~167–172). The prototype draws no cut-text tooltip anywhere (a Today `.clip` summary carries none either), so it is compared against, not edited.

## Global Constraints

- All commands through `make` or `docker compose`; no Go, Node or npm on the host.
- Vanilla TS, no frameworks; `strict` with `noUncheckedIndexedAccess`; no `any`, no `as any`, no non-null assertion (`!`).
- **Keyboard-focus tests never use `.focus()` on the element under test** (#217): focus the element *before* it, move the pointer to `(0, 0)`, press a real `Tab`, assert `toBeFocused()`, then assert the tooltip. The one element with nothing before it — the dialog's instance name, the dialog's first Tab stop — is reached the same way with a real `Shift+Tab` from Close. `.focus()` on the *source* of an arrow-key move is fine; the target is what is under test.
- Every one of the four texts is a Tab stop **whether or not it is cut**; `when-cut` alone decides whether its tooltip opens. Out of scope: a text that is a Tab stop only while cut; the tooltip's own look and placement (#246).
- A tooltip is never the accessible name; nothing here adds ARIA.
- Extra Tab stops are acceptable (owner, 2026-09-25); the arrow keys are the answer to the Tab walk.
- No new strings, no new styles. A new Tab stop wears whatever focus indication its context already gives (the browser's ring; the rail's `:focus-visible` wash in `web/src/styles.css`).
- Firefox and Chromium both run every e2e test. No WebKit.
- Screenshots, the framed prototype and the capture spec are never committed.

## Review Focus

1. **The entry dialog still opens with Close focused.** The instance name sits before Close in tree order; once it is a Tab stop, `showModal()`'s dialog focusing steps would land on it and, when cut, open its tooltip the moment the dialog opens. Pinned by Task 3's "opening the dialog by keyboard focuses Close" test, which must pass before the change (it is a guard, not a new behaviour) and fail if `autofocus` is removed.
2. **Up/Down on Today with a failure note present** (`web/src/table-keys.ts` counts every `[tabindex="0"]` in a cell): Down/Up between summaries still lands on the summary (index 0), never the note, and Down from the note clamps to the next row's summary. Pinned by Task 1's table-keys test.
3. **A text that is not cut — including "No comment" and a short rail name — is reached by Tab and opens nothing.** Pinned by Tasks 1–3's "not cut" tests, each asserting zero visible tooltips.
4. **One focus, one tooltip.** Focusing Edit opens only "edit entry"; focusing a Today key opens only "open in Jira"; focusing the settings cog before a rail name, then tabbing on, leaves only the name's. Pinned by Task 3's Edit test and the existing key tests in `cut-text.spec.ts`, which keep running.
5. **Existing Tab walks still reach their targets.** `smoke.spec.ts`'s `tabUntilFocused` walks the rail with at most 8 presses; its callers use an empty Today (no split names), so they should be unaffected. If any existing test that presses Tab fails after a task, fix the walk (not the product), and say so in the task report.

---

### Task 1: A pinned row's failure note is its own Tab stop

**Files:**
- Modify: `web/src/components/that-ticket-row.ts` — `failureNote()` (~line 485), `failureTooltip()`'s doc comment (~line 495–501)
- Test: `.claude/e2e/tests/cut-text.spec.ts` — a `tabTo` helper after the `stubPinWithError` helper (~line 72), two new tests after "a cut failure note on a pinned row shows its full text on hover" (~line 165), the stale comment above the next test (~line 167–171)
- Test: `.claude/e2e/tests/table-keys.spec.ts` — one new test after "Down from a key onto a row with no URL focuses that row's summary" (~line 161)

**Interfaces:**
- Consumes: `cutTextTooltip(forId, text)` from `web/src/cut-text-tooltip.ts` (its third parameter is removed in Task 4; this task does not pass it).
- Produces: in `cut-text.spec.ts`, `async function tabTo(page: Page, before: Locator, target: Locator): Promise<void>` — Tasks 2 and 3 use it. The failure note keeps `id="that-fail-<n>"` and gains `tabindex="0"`.

- [ ] **Step 1: Add the helper.** In `.claude/e2e/tests/cut-text.spec.ts`, change the first import to `import { expect, test, type Locator, type Page } from "@playwright/test";` and add after `stubPinWithError`:

```ts
/** #217: the element under test is reached by a real Tab from the one before
 *  it, with the pointer parked so no hover opens anything on its own. */
async function tabTo(page: Page, before: Locator, target: Locator): Promise<void> {
  await before.focus();
  await page.mouse.move(0, 0);
  await page.keyboard.press("Tab");
  await expect(target).toBeFocused();
}
```

- [ ] **Step 2: Write the failing tests.** After "a cut failure note on a pinned row shows its full text on hover", add:

```ts
// #236: the note is its own Tab stop, reached from the summary above it.
test("a cut failure note is its own Tab stop and opens only its own tooltip", async ({ page }) => {
  await stubIssues(page, [group(1, "Work", [])]);
  await stubPinWithError(page, "Weekly standup", longFailure);
  await page.goto("/today");

  const row = page.locator('that-ticket-row[key="WORK-1"]');
  const summary = row.locator('[id^="that-sum-"]');
  const note = row.locator('[id^="that-fail-"]');
  await tabTo(page, summary, note);

  const visible = page.locator("that-tooltip:visible");
  await expect(visible).toHaveCount(1);
  await expect(visible).toHaveText(longFailure);

  await page.keyboard.press("Shift+Tab");
  await expect(summary).toBeFocused();
  await expect(page.locator("that-tooltip", { hasText: longFailure })).toBeHidden();
});

test("a failure note that is not cut is still a Tab stop and opens nothing", async ({ page }) => {
  await stubIssues(page, [group(1, "Work", [])]);
  await stubPinWithError(page, "Weekly standup", "Offline");
  await page.goto("/today");

  const row = page.locator('that-ticket-row[key="WORK-1"]');
  await tabTo(page, row.locator('[id^="that-sum-"]'), row.locator('[id^="that-fail-"]'));
  await expect(page.locator("that-tooltip:visible")).toHaveCount(0);
});
```

  Replace the comment above "focusing a pinned row's key link shows only the key's own tooltip…" (~line 167–171) with:

```ts
// The key link's focus opens only the key's own "open in Jira": the summary
// and the failure note are Tab stops of their own (#143 task 9, #236), each
// opening its tooltip on its own focus. Both are cut here, so the only thing
// that could open them on the key's focus is wiring that must not exist.
```

- [ ] **Step 3: Write the failing arrow-key test.** In `.claude/e2e/tests/table-keys.spec.ts`, after "Down from a key onto a row with no URL focuses that row's summary", add:

```ts
// #236: a failure note is a second focusable in the summary cell. Moving
// between rows must still land on the summary, and leaving the note must
// clamp to the next row's summary.
test("Up and Down land on a failure-noted row's summary, and Down from its note reaches the next summary", async ({
  page,
}) => {
  await stubIssues(page, [group(1, "Ridgeline", ridgeIssues)]);
  await page.route("**/api/pins**", (route) =>
    route.fulfill({
      status: 200,
      json: [
        {
          id: 1,
          instanceId: 1,
          instanceName: "Ridgeline",
          instancePosition: 0,
          key: "RIDGE-9",
          summary: "Weekly standup",
          status: "To Do",
          url: "https://ridgeline.atlassian.net/browse/RIDGE-9",
          error: { code: "instance_unreachable", message: "Could not reach Ridgeline" },
        },
      ],
    }),
  );
  await page.goto("/today");
  await expect(row(page, "RIDGE-1")).toBeVisible();

  await summaryOf(page, "RIDGE-9").focus();
  await page.keyboard.press("ArrowDown");
  await expect(summaryOf(page, "RIDGE-1")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(summaryOf(page, "RIDGE-9")).toBeFocused();

  await row(page, "RIDGE-9").locator('[id^="that-fail-"]').focus();
  await page.keyboard.press("ArrowDown");
  await expect(summaryOf(page, "RIDGE-1")).toBeFocused();
});
```

  (Pinned renders above Assigned in `web/src/views/today.ts`, so RIDGE-9's row precedes RIDGE-1's.)

- [ ] **Step 4: Run them and see them fail.**

  Run: `docker compose --profile e2e rm --stop --force app-e2e; docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/cut-text.spec.ts tests/table-keys.spec.ts -g "failure note|failure-noted"'; docker compose --profile e2e rm --stop --force app-e2e`
  Expected: the three new tests FAIL in both projects — the two Tab tests on `toBeFocused()` (the note is not focusable, so Tab skips it), the arrow test on its last `toBeFocused()` (`.focus()` on a non-focusable span does nothing). The existing hover and key-link tests PASS.

- [ ] **Step 5: Implement.** In `web/src/components/that-ticket-row.ts`, `failureNote()`: add `note.tabIndex = 0;` after `note.id = this.failureId;`. Replace `failureTooltip()`'s doc comment with:

```ts
  /**
   * Opens on the note's own hover and its own focus (#236): the note is a Tab
   * stop whether or not it is cut, so the Tab order never changes with the
   * window's width, and `when-cut` keeps this shut when there is nothing to
   * give back.
   */
```

- [ ] **Step 6: Run them and see them pass.** Same command as Step 4. Expected: every matched test PASSES in firefox and chromium.

- [ ] **Step 7: Gates.** `make verify` green; `make test-e2e` with 0 failed. Paste both summaries into the task report.

- [ ] **Step 8: Commit.**

```bash
git add web/src/components/that-ticket-row.ts .claude/e2e/tests/cut-text.spec.ts .claude/e2e/tests/table-keys.spec.ts
git commit -m "A pinned row's failure note is its own Tab stop (#236)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LSFNGKuFZChTpQMJ5cQuAH"
```

  If signing fails, retry the same commit with `git -c commit.gpgsign=false commit …` and say so. Never push.

---

### Task 2: The rail's instance names are Tab stops

**Files:**
- Modify: `web/src/rail.ts` — `figures()` (~line 630–641, the `name` span)
- Test: `.claude/e2e/tests/cut-text.spec.ts` — two new tests after "a cut rail instance name shows its full text on hover" (~line 216)

**Interfaces:**
- Consumes: Task 1's `tabTo(page, before, target)`; `stubIssues`, `group`, `stubEntries`, `railEntry`, `longInstanceName` already in the file.
- Produces: each split row's name span `id="that-rail-name-<n>"` gains `tabindex="0"`.

- [ ] **Step 1: Write the failing tests.** After "a cut rail instance name shows its full text on hover":

```ts
// #236: the settings cog is the rail's last Tab stop before the split — the
// period label and the total between them are not focusable.
test("a cut rail instance name is its own Tab stop and opens only its own tooltip", async ({
  page,
}) => {
  await stubIssues(page, [group(1, "Work", [])]);
  await stubEntries(page, [railEntry(longInstanceName)]);
  await page.goto("/today");

  const name = page.locator('#rail-split [id^="that-rail-name-"]').first();
  await tabTo(page, page.locator("#settings-cog"), name);

  const visible = page.locator("that-tooltip:visible");
  await expect(visible).toHaveCount(1);
  await expect(visible).toHaveText(longInstanceName);
});

test("a rail instance name that is not cut is still a Tab stop and opens nothing", async ({
  page,
}) => {
  await stubIssues(page, [group(1, "Work", [])]);
  await stubEntries(page, [railEntry("Work")]);
  await page.goto("/today");

  const name = page.locator('#rail-split [id^="that-rail-name-"]').first();
  await tabTo(page, page.locator("#settings-cog"), name);
  await expect(page.locator("that-tooltip:visible")).toHaveCount(0);
});
```

- [ ] **Step 2: Run them and see them fail.**

  Run: `docker compose --profile e2e rm --stop --force app-e2e; docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/cut-text.spec.ts -g "rail instance name"'; docker compose --profile e2e rm --stop --force app-e2e`
  Expected: both new tests FAIL on `toBeFocused()` in both projects; the hover test PASSES.

- [ ] **Step 3: Implement.** In `web/src/rail.ts`, `figures()`: add `name.tabIndex = 0;` after `name.id = nameId;`, preceded by this comment (it replaces nothing; the rail's `:focus-visible` wash in `styles.css` already covers it):

```ts
    // Its own Tab stop, cut or not (#236), so a keyboard reaches a cut name
    // the way a pointer does; `when-cut` keeps the tooltip shut otherwise.
```

- [ ] **Step 4: Run them and see them pass.** Same command as Step 2. Expected: all matched tests PASS in firefox and chromium.

- [ ] **Step 5: Gates.** `make verify` green; `make test-e2e` with 0 failed. Paste both summaries.

- [ ] **Step 6: Commit.**

```bash
git add web/src/rail.ts .claude/e2e/tests/cut-text.spec.ts
git commit -m "The rail's instance names are Tab stops of their own (#236)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LSFNGKuFZChTpQMJ5cQuAH"
```

  If signing fails, retry unsigned with `git -c commit.gpgsign=false commit …` and say so. Never push.

---

### Task 3: The entry dialog's instance name and comments are Tab stops; Edit opens only "edit entry"

**Files:**
- Modify: `web/src/components/that-entry-dialog.ts` — `header()` (~line 181–184, the `instance` span), `instanceTooltip()`'s doc comment (~line 269–276), `closeButton()` (~line 278–290), `entryRow()` (~line 506–541), `commentTooltip()` and its doc comment (~line 544–557)
- Test: `.claude/e2e/tests/cut-text.spec.ts` — replace the last test, "a cut entry comment in the dialog shows its full text when the edit button is focused, and a short one shows none" (~line 297–312), with the tests below

**Interfaces:**
- Consumes: Task 1's `tabTo`; `openDialog`, `dialogEntry`, `longComment`, `longInstanceName`, `stubEntries` already in the file.
- Produces: `commentTooltip(forId: string, comment: string): HTMLElement` (the `editId` parameter is gone). The comment span `id="that-entry-comment-<seq>-<entryId>"` and the instance span `id="that-entry-dialog-instance-<seq>"` gain `tabindex="0"`; Close gains `autofocus`. After this task nothing in `web/src` passes a focus target to `cutTextTooltip` — Task 4 relies on that.

- [ ] **Step 1: Write the tests.** Delete the last test in `cut-text.spec.ts` and add in its place:

```ts
function dialogRows(page: Page): Locator {
  return page.locator("that-entry-dialog li");
}

function commentOf(row: Locator): Locator {
  return row.locator('[id^="that-entry-comment-"]');
}

// A guard, not a new behaviour: Close is what showModal() focuses today. The
// instance name sits before it in tree order, so once the name is a Tab stop
// only Close's autofocus keeps it that way (#236).
test("opening the entry dialog by keyboard focuses Close", async ({ page }) => {
  await stubIssues(page, [group(1, longInstanceName, [issue("WORK-1", "Ship it")])]);
  await stubEntries(page, [dialogEntry(1, longComment)]);
  await page.goto("/today");
  await page.getByRole("button", { name: /Log time against WORK-1/ }).focus();
  await page.mouse.move(0, 0);
  await page.keyboard.press("Enter");

  await expect(page.locator("that-entry-dialog").getByRole("button", { name: "Close" })).toBeFocused();
  await expect(page.locator("that-tooltip:visible")).toHaveCount(0);
});

test("focusing an entry's Edit opens only its own tooltip, never the comment's", async ({ page }) => {
  await stubIssues(page, [group(1, "Work", [issue("WORK-1", "Ship it")])]);
  await stubEntries(page, [dialogEntry(1, longComment)]);
  await page.goto("/today");
  await openDialog(page);

  const row = dialogRows(page).nth(0);
  // The push mark is the Tab stop just before Edit.
  await tabTo(page, row.locator('[id^="that-entry-mark-"]'), row.getByRole("button", { name: /Edit the/ }));

  const visible = page.locator("that-tooltip:visible");
  await expect(visible).toHaveCount(1);
  await expect(visible).toHaveText("edit entry");
});

test("a cut entry comment is its own Tab stop and opens its full text on focus and on hover", async ({
  page,
}) => {
  await stubIssues(page, [group(1, "Work", [issue("WORK-1", "Ship it")])]);
  await stubEntries(page, [dialogEntry(1, longComment)]);
  await page.goto("/today");
  await openDialog(page);

  const dialog = page.locator("that-entry-dialog");
  // Nothing focusable sits between Close and the first row's comment.
  await tabTo(page, dialog.getByRole("button", { name: "Close" }), commentOf(dialogRows(page).nth(0)));
  const visible = page.locator("that-tooltip:visible");
  await expect(visible).toHaveCount(1);
  await expect(visible).toHaveText(longComment);

  await page.keyboard.press("Shift+Tab");
  await expect(page.locator("that-tooltip:visible")).toHaveCount(0);
  await commentOf(dialogRows(page).nth(0)).hover();
  await expect(page.locator("that-tooltip", { hasText: longComment })).toBeVisible();
});

test("a short comment and \"No comment\" are Tab stops that open nothing", async ({ page }) => {
  await stubIssues(page, [group(1, "Work", [issue("WORK-1", "Ship it")])]);
  await stubEntries(page, [dialogEntry(1, "Quick fix"), dialogEntry(2, "")]);
  await page.goto("/today");
  await openDialog(page);

  const dialog = page.locator("that-entry-dialog");
  const rows = dialogRows(page);
  await tabTo(page, dialog.getByRole("button", { name: "Close" }), commentOf(rows.nth(0)));
  await expect(page.locator("that-tooltip:visible")).toHaveCount(0);

  // The row above's Delete is the Tab stop just before the next comment.
  await tabTo(page, rows.nth(0).getByRole("button", { name: /Delete the/ }), commentOf(rows.nth(1)));
  await expect(commentOf(rows.nth(1))).toHaveText("No comment");
  await expect(page.locator("that-tooltip:visible")).toHaveCount(0);
});

// The instance name is the dialog's first Tab stop, so the one real key that
// reaches it is Shift+Tab from Close (#217's rule, run backwards).
test("a cut dialog instance name is its own Tab stop and opens only its own tooltip", async ({
  page,
}) => {
  await stubIssues(page, [group(1, longInstanceName, [issue("WORK-1", "Ship it")])]);
  await stubEntries(page, []);
  await page.goto("/today");
  await openDialog(page);

  const dialog = page.locator("that-entry-dialog");
  await dialog.getByRole("button", { name: "Close" }).focus();
  await page.mouse.move(0, 0);
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.locator('[id^="that-entry-dialog-instance-"]')).toBeFocused();

  const visible = page.locator("that-tooltip:visible");
  await expect(visible).toHaveCount(1);
  await expect(visible).toHaveText(longInstanceName);
});
```

- [ ] **Step 2: Run them; all but the guard fail.**

  Run: `docker compose --profile e2e rm --stop --force app-e2e; docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/cut-text.spec.ts -g "dialog|entry|comment"'; docker compose --profile e2e rm --stop --force app-e2e`
  Expected in both projects: "opening the entry dialog by keyboard focuses Close" PASSES (it records today's behaviour); "focusing an entry's Edit…" FAILS with two visible tooltips (the comment's rides on Edit's focus through `focus-for`); the comment and instance-name Tab tests FAIL on `toBeFocused()`. **If the Close guard fails here, stop and report it as a blocker** — the dialog's initial focus is not what this plan assumes, and choosing a new one is the owner's call.

- [ ] **Step 3: Implement.** In `web/src/components/that-entry-dialog.ts`:

  1. `header()`: add `instance.tabIndex = 0;` after `instance.id = this.instanceId;`.
  2. `instanceTooltip()`: replace its doc comment with:

```ts
  /**
   * Opens on the name's own hover and its own focus (#236): the name is a Tab
   * stop whether or not it is cut, and `when-cut` keeps this shut when it fits.
   */
```

  3. `closeButton()`: add after `close.setAttribute("aria-label", "Close");`:

```ts
    // The instance name before it in the header is a Tab stop now (#236);
    // without this, showModal() would focus the name instead of Close, and
    // open its tooltip the moment the dialog appears.
    close.autofocus = true;
```

  4. `entryRow()`: add `comment.tabIndex = 0;` after `comment.id = commentId;`, and change the tooltip call in `row.append(…)` to `this.commentTooltip(commentId, entry.comment),`. `editId` stays: `rowAction` still names the Edit button with it.
  5. Replace `commentTooltip()` and its doc comment with:

```ts
  /**
   * Opens on the comment's own hover and its own focus (#236), never on a
   * neighbour's: the comment is a Tab stop whether or not it is cut —
   * "No comment" included — so the Tab order never changes with the window's
   * width, and `when-cut` keeps this shut when there is nothing to give back.
   */
  private commentTooltip(forId: string, comment: string): HTMLElement {
    return cutTextTooltip(forId, comment === "" ? "No comment" : comment);
  }
```

- [ ] **Step 4: Prove the guard bites.** Temporarily delete the `close.autofocus = true;` line and rerun Step 2's command: "opening the entry dialog by keyboard focuses Close" must FAIL in both projects. Restore the line.

- [ ] **Step 5: Run them and see them pass.** Step 2's command. Expected: every matched test PASSES in firefox and chromium.

- [ ] **Step 6: Gates.** `make verify` green; `make test-e2e` with 0 failed — `entries.spec.ts` and `keyboard-audit.spec.ts` exercise this dialog's focus most, and must stay green untouched. Paste both summaries.

- [ ] **Step 7: Commit.**

```bash
git add web/src/components/that-entry-dialog.ts .claude/e2e/tests/cut-text.spec.ts
git commit -m "The entry dialog's instance name and comments are Tab stops; Edit opens only its own tooltip (#236)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LSFNGKuFZChTpQMJ5cQuAH"
```

  If signing fails, retry unsigned with `git -c commit.gpgsign=false commit …` and say so. Never push.

---

### Task 4: Retire `focus-for`, and the visual language says every cut text is its own Tab stop

**Files:**
- Modify: `web/src/cut-text-tooltip.ts` — the whole function (drop `focusForId`)
- Modify: `web/src/components/that-issue-search.ts` — `summaryTooltip()` (~line 746–759)
- Modify: `web/src/components/that-tooltip.ts` — the `focusTrigger` field (~line 17), the `focus-for` block in `connectedCallback()` (~line 47–58), its cleanup in `disconnectedCallback()` (~line 81–83)
- Modify: comments naming `focus-for` in `web/src/rail.ts` (~line 701–704), `web/src/components/that-ticket-row.ts` (~line 516–522), `.claude/e2e/tests/cut-text.spec.ts`, `.claude/e2e/tests/search.spec.ts` (~line 315–317, ~1271–1278)
- Modify: `docs/superpowers/specs/2026-09-03-visual-language-design.md` — the cut-text paragraph of Decision 7 (~line 457–467)
- Test: `.claude/e2e/tests/tooltip.spec.ts` — `mountCutText()` and the three tests using it that focus `#cut-link` (~line 555–628)

**Interfaces:**
- Consumes: Task 3's guarantee that no caller passes a focus target.
- Produces: `cutTextTooltip(forId: string, text: string, below?: boolean): HTMLElement`. `that-tooltip` reads `for`, `wrap`, `when-cut`, `below`, `anchor` — no `focus-for`.

- [ ] **Step 1: Rewrite the fixture tests first.** In `.claude/e2e/tests/tooltip.spec.ts`, `mountCutText()`: delete `tooltip.setAttribute("focus-for", "cut-link");` and add `span.tabIndex = 0;` after `span.id = "cut-text";`. The link stays, as the Tab stop before the span. Replace the three tests that focus `#cut-link`:

```ts
/** #217: reach the cut text by a real Tab from the link prepended before it. */
async function tabToCutText(page: import("@playwright/test").Page): Promise<void> {
  await page.locator("#cut-link").focus();
  await page.mouse.move(0, 0);
  await page.keyboard.press("Tab");
  await expect(page.locator("#cut-text")).toBeFocused();
}

test("a when-cut tooltip opens on its own text's focus, and closes on blur", async ({ page }) => {
  await mountCutText(page, longText, 120);
  const tip = page.locator("that-tooltip[data-fixture]");
  await tabToCutText(page);
  await expect(tip).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator("#cut-link")).toBeFocused();
  await expect(tip).toBeHidden();
});

test("a when-cut tooltip stays closed when the text is not cut, on hover and on focus", async ({
  page,
}) => {
  await mountCutText(page, "Short", 400);
  const tip = page.locator("that-tooltip[data-fixture]");
  await page.locator("#cut-text").hover();
  await expect(tip).toBeHidden();
  await tabToCutText(page);
  await expect(tip).toBeHidden();
});

test("a tooltip removed while open leaves nothing in the top layer", async ({ page }) => {
  await mountCutText(page, longText, 120);
  await tabToCutText(page);
  await expect(page.locator("that-tooltip[data-fixture]")).toBeVisible();
  const open = await page.evaluate(() => {
    document.querySelector("that-tooltip[data-fixture]")?.remove();
    return document.querySelectorAll(":popover-open").length;
  });
  expect(open).toBe(0);
});
```

- [ ] **Step 2: Run them — they pass on the old code too.** They exercise the `for` trigger's own focus, which already worked; this step proves the rewrite before the deletion.

  Run: `docker compose --profile e2e rm --stop --force app-e2e; docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/tooltip.spec.ts'; docker compose --profile e2e rm --stop --force app-e2e`
  Expected: all PASS in firefox and chromium.

- [ ] **Step 3: Delete `focus-for`.**

  `web/src/cut-text-tooltip.ts` becomes:

```ts
/**
 * The `that-tooltip` construction every cut-text site shares: `wrap` and
 * `when-cut` are always set together (see that-tooltip.ts's own contract).
 * The text it names is always its own Tab stop (#236), so the tooltip opens on
 * that text's hover and focus and never on a neighbour's. `below` is opt-in,
 * for the one row shape (the search panel's key-over-summary stack, #143
 * task 7) where the tooltip's own default of opening above would cover
 * something focus just moved to.
 */
export function cutTextTooltip(forId: string, text: string, below?: boolean): HTMLElement {
  const tooltip = document.createElement("that-tooltip");
  tooltip.setAttribute("for", forId);
  tooltip.setAttribute("wrap", "");
  tooltip.setAttribute("when-cut", "");
  if (below) tooltip.setAttribute("below", "");
  tooltip.textContent = text;

  return tooltip;
}
```

  `web/src/components/that-issue-search.ts`: the call becomes `cutTextTooltip(summary.id, hit.summary, true)`, and its doc comment drops the "no `focus-for`" clause: "…gives back the summary's hover and, since task 9, its own focus too, so a key focus opens only the key's own "open in Jira" tooltip, never this one…".

  `web/src/components/that-tooltip.ts`: delete the `focusTrigger` field, the whole comment-and-block beginning `// A second focus target` in `connectedCallback()`, and the three `focusTrigger` lines in `disconnectedCallback()`.

  Then reword every remaining comment that names `focus-for` so it states the current contract (the text is its own Tab stop) without the attribute's name:

  Run: `grep -rn "focus-for\|focusFor" web/src .claude/e2e/tests`
  Expected once done: no output.

- [ ] **Step 4: Update the visual language.** In `docs/superpowers/specs/2026-09-03-visual-language-design.md`, replace the paragraph beginning **"A text cut by an ellipsis gives its full wording back in the same tooltip"** (through "…it is never the accessible name.") with:

```markdown
**A text cut by an ellipsis gives its full wording back in the same tooltip** (#143), in a wrapping
variant about 340px wide, shown only when the text is actually cut — never for a text that already
fits. **Every cut text is its own Tab stop** (#236, owner, 2026-09-29): a ticket summary (Today's
rows and the search panel's), a pinned row's failure note, the rail's running key and its
instance-name slices, and the entry dialog's instance name and each entry's comment. Each is a Tab
stop whether or not it is cut — "No comment" included — so the Tab order never changes with the
window's width, and each opens its tooltip on its own hover and its own focus, never on a
neighbour's. A neighbouring control's focus opens only that control's own tooltip: a key's "open in
Jira", the rail's "stop timer", an entry's "edit entry". This replaced the earlier rule, where a cut
text borrowed a neighbouring control's focus — a shape that broke the moment a row carried more than
one cut text, since one focus then had to open two tooltips at once. Like every other tooltip here,
it is never the accessible name.
```

- [ ] **Step 5: Gates.** `make verify` green (tsc catches any caller still passing four arguments); `make test-e2e` with 0 failed. Paste both summaries.

- [ ] **Step 6: Commit.**

```bash
git add web/src/cut-text-tooltip.ts web/src/components/that-issue-search.ts web/src/components/that-tooltip.ts web/src/rail.ts web/src/components/that-ticket-row.ts .claude/e2e/tests/tooltip.spec.ts .claude/e2e/tests/cut-text.spec.ts .claude/e2e/tests/search.spec.ts docs/superpowers/specs/2026-09-03-visual-language-design.md
git commit -m "Retire focus-for: every cut text is its own Tab stop (#236)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LSFNGKuFZChTpQMJ5cQuAH"
```

  If signing fails, retry unsigned with `git -c commit.gpgsign=false commit …` and say so. Never push.

---

### Task 5: Compare against the drawing, and the screenshots for the pull request

**Files:**
- Throwaway (never committed, deleted at the end): `.claude/e2e/proto-236.html`, `.claude/e2e/tests/shots-236.spec.ts`

**Interfaces:**
- Consumes: Task 3's dialog (comment `[id^="that-entry-comment-"]`, Close autofocused), Task 4's final tree.
- Produces: `entry-comment-tooltip-keyboard-dark.png` and `entry-comment-tooltip-keyboard-light.png` in `/tmp/claude-1001/-home-dion-Projects-personal-ThatApp/2a2a1c14-8caa-4b70-bf09-c08591ea4c79/scratchpad/shots-236/`, for `.claude/tools/pr-attach.sh` when the PR is opened. Nothing in the repository.

- [ ] **Step 1: Frame the prototype** (ticket-workflow skill: a prototype is captured inside the companion's frame, never bare; do not add a doctype to it):

```bash
cd /home/dion/Projects/personal/ThatApp
awk -v f=docs/superpowers/prototypes/2026-09-03-app-prototype.html \
  '/<!-- CONTENT -->/{while((getline l < f)>0) print l; next} {print}' \
  ~/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/brainstorming/scripts/frame-template.html \
  > .claude/e2e/proto-236.html
```

- [ ] **Step 2: Write the throwaway capture spec** `.claude/e2e/tests/shots-236.spec.ts`. It (a) opens the framed prototype's entry dialog in each theme and records the first row's geometry and the drawing's only dialog tooltip (`.estate .tip`); (b) opens the app's dialog, reaches the first row's cut comment by a real `Tab` from Close, records the same facts, and screenshots it in dark and light:

```ts
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const SHOTS = "/e2e/test-results/shots";

const longComment =
  "Rewrote the ingestion pipeline's retry logic so a transient Jira timeout no longer drops " +
  "the whole day's sync silently, and added a metrics counter so an operator can watch it";

function entry(id: number, comment: string, pushState: string, startedAt: string) {
  return {
    id,
    instanceId: 1,
    instanceName: "Ridgeline",
    instancePosition: 0,
    issueKey: "RIDGE-5301",
    day: "2026-09-29",
    startedAt,
    seconds: 3600,
    comment,
    pushState,
  };
}

async function facts(page: Page, rowSel: string, textSel: string, tipSel: string) {
  return page.evaluate(
    ([r, t, p]) => {
      const row = document.querySelector(r)?.getBoundingClientRect();
      const text = document.querySelector(t)?.getBoundingClientRect();
      const tipEl = document.querySelector(p);
      if (!row || !text || !tipEl) return null;
      const tip = tipEl.getBoundingClientRect();
      const style = getComputedStyle(tipEl);
      return {
        rowHeight: Math.round(row.height),
        textLeftInRow: Math.round(text.left - row.left),
        gapAbove: Math.round(text.top - tip.bottom),
        tipWidth: Math.round(tip.width),
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        background: style.backgroundColor,
        color: style.color,
      };
    },
    [rowSel, textSel, tipSel] as const,
  );
}

test("prototype: the entry dialog's row and tooltip", async ({ page }) => {
  await page.goto("file:///e2e/proto-236.html");
  for (const theme of ["dark", "light"]) {
    if (theme === "light") {
      // The toggle sits outside the app; the open overlay would take a real click.
      await page.locator("#lm-toggle").evaluate((el) => (el as HTMLElement).click());
    }
    await page.locator(".durbtn:visible").first().click();
    await page.locator(".elist .estate").first().hover();
    console.log(
      `prototype ${theme}`,
      JSON.stringify(await facts(page, ".elist li", ".elist .ecomment", ".elist .estate .tip")),
    );
    await page.mouse.move(0, 0);
    await page.locator("#e-close").click();
  }
});

for (const theme of ["dark", "light"] as const) {
  test(`app: the entry comment's tooltip opened by keyboard, ${theme}`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
    await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));
    await page.route("**/api/issues", (route) =>
      route.fulfill({
        status: 200,
        json: {
          instances: [
            {
              id: 1,
              name: "Ridgeline",
              error: null,
              issues: [
                {
                  key: "RIDGE-5301",
                  summary: "Timesheet export drops the last day of the month",
                  status: "In Progress",
                  url: "https://ridgeline.atlassian.net/browse/RIDGE-5301",
                },
              ],
            },
          ],
        },
      }),
    );
    await page.route("**/api/entries**", (route) =>
      route.fulfill({
        status: 200,
        json: {
          today: "2026-09-29",
          entries: [
            entry(1, longComment, "unpushed", "2026-09-29T09:15:00+02:00"),
            entry(2, "Quick fix", "pushed", "2026-09-29T11:00:00+02:00"),
            entry(3, "", "unpushed", "2026-09-29T14:30:00+02:00"),
          ],
        },
      }),
    );
    await page.goto("/today");
    await page.getByRole("button", { name: /Log time against RIDGE-5301/ }).click();

    const dialog = page.locator("that-entry-dialog dialog");
    const comment = dialog.locator('[id^="that-entry-comment-"]').first();
    await dialog.getByRole("button", { name: "Close" }).focus();
    await page.mouse.move(0, 0);
    await page.keyboard.press("Tab");
    await expect(comment).toBeFocused();
    const id = (await comment.getAttribute("id")) ?? "";
    const tip = page.locator(`that-tooltip[for="${id}"]`);
    await expect(tip).toBeVisible();

    console.log(
      `app ${theme}`,
      JSON.stringify(await facts(page, "that-entry-dialog li", `#${id}`, `that-tooltip[for="${id}"]`)),
    );

    const box = await dialog.boundingBox();
    const tipBox = await tip.boundingBox();
    if (!box || !tipBox) throw new Error("dialog or tooltip not on screen");
    const top = Math.min(box.y, tipBox.y) - 8;
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({
      path: `${SHOTS}/entry-comment-tooltip-keyboard-${theme}.png`,
      clip: { x: box.x - 8, y: top, width: box.width + 16, height: box.y + box.height + 8 - top },
    });
  });
}
```

  Pointer parked at `(0, 0)` and focus deliberately left on the comment: the picture is of the keyboard-opened state, which is the point.

- [ ] **Step 3: Run it in Firefox and copy the shots out** before anything else runs Playwright (a run clears `test-results/`):

```bash
cd /home/dion/Projects/personal/ThatApp
docker compose --profile e2e rm --stop --force app-e2e
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/shots-236.spec.ts --project=firefox'
docker compose --profile e2e rm --stop --force app-e2e
mkdir -p /tmp/claude-1001/-home-dion-Projects-personal-ThatApp/2a2a1c14-8caa-4b70-bf09-c08591ea4c79/scratchpad/shots-236
cp .claude/e2e/test-results/shots/*.png /tmp/claude-1001/-home-dion-Projects-personal-ThatApp/2a2a1c14-8caa-4b70-bf09-c08591ea4c79/scratchpad/shots-236/
```

  Expected: 3 passed, two PNGs copied, four `prototype …`/`app …` fact lines in the output.

- [ ] **Step 4: Compare against the drawing and report what was compared.** From the fact lines and by opening both PNGs (Read tool), write a table into the task report — property / prototype / app / match — for each theme:
  - **The row is unchanged by the new Tab stop:** `rowHeight` and `textLeftInRow` (the comment starts after the 68px duration and the 12px gap in both) agree within ±1px.
  - **The tooltip:** opens **above** the comment (`gapAbove` positive in the app, 7 in the drawing's `.tip`), background and text colour (the drawing's `.tip` pair against the app's rail pair), font size and weight — record both.
  - **The wrap:** `tipWidth` ≤ 340 in the app (the visual language's wrapping variant; the drawing draws no cut-text tooltip, so this is checked against the spec, not the prototype).
  - **The focused comment is visibly focused** in both PNGs (the browser's own ring; no style removes it). If no ring is visible in either theme, report it to the owner as a finding — do not invent a ring style.
  - Only the comment's tooltip is open in each PNG.

  **Any mismatch this ticket did not cause is reported, not fixed** — the tooltip's look and placement are #246's. A mismatch this ticket causes (the row's geometry moved, a second tooltip open, the tooltip below the comment) is fixed in the owning task's code and this task re-run.

- [ ] **Step 5: Delete the throwaways.** `rm .claude/e2e/proto-236.html .claude/e2e/tests/shots-236.spec.ts`; `git status --short` prints nothing.

- [ ] **Step 6: Gates on the final tree.** `make verify` green and `make test-e2e` 0 failed. Paste both summaries. Nothing to commit; report the two PNG paths so the pull request can attach them with `.claude/tools/pr-attach.sh <pr-number> /tmp/claude-1001/-home-dion-Projects-personal-ThatApp/2a2a1c14-8caa-4b70-bf09-c08591ea4c79/scratchpad/shots-236/*.png`.
