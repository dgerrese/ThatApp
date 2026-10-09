# #281 — The entry dialog keeps keyboard focus through a save

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-10-08
**Supersedes:** nothing
**Superseded by:** nothing

**Goal:** After a save from the entry dialog's save button, keyboard focus returns to that button, on success and on failure.

**Architecture:** `save()` records `document.activeElement` before `setBusy(true)` disables the button (which drops focus to `<body>`, per the HTML focus fixup rule). When the busy state ends, the existing `refocusIfLostFromDialog()` helper — today used only by delete — gains an optional preferred target and puts focus back on it. The native `disabled` attribute stays.

**Tech Stack:** TypeScript (vanilla WebComponents, light DOM), Playwright e2e.

**Spec:** Codeberg #281 body (owner decisions of 2026-10-08 are binding).

## Global Constraints

- Keep the native `disabled` attribute on the save button and the duration field while busy. No `aria-disabled`.
- Do not change the stop dialog (`web/src/components/that-stop-dialog.ts`).
- Do not change the delete path's behaviour: with no preferred target, `refocusIfLostFromDialog()` still focuses the close control.
- Tests run in Firefox and Chromium through `make test-e2e`. Never run node or npm on the host.
- TypeScript `strict`; no `any`, no non-null assertion.
- Few comments; only a non-obvious "why".

## Review Focus

1. Enter in the comment field starts a save; the comment field is never disabled, so focus must stay there and not jump to the save button.
2. A successful save resets the foot form and re-renders the list; the save button is the same element (only its `label` attribute changes), so it is still a valid target.
3. A failed save shows an error block; focus returns to the save button *after* it is enabled again (focusing a disabled button is a no-op).
4. Edit mode: the button reads `Save`; the same rules apply.
5. The delete path still lands focus on Close when its row is removed.

---

### Task 1: Restore focus after the busy state ends

**Files:**
- Modify: `web/src/components/that-entry-dialog.ts` — `refocusIfLostFromDialog()` (around line 300-317) and `save()` (around line 618-654)
- Test: `.claude/e2e/tests/entries.spec.ts` — append three tests at the end of the file

**Interfaces:**
- Produces: `private refocusIfLostFromDialog(preferred?: Element | null): void`

- [ ] **Step 1: Write the failing tests**

Append to `.claude/e2e/tests/entries.spec.ts`. The failing-POST route is registered after `openToday`, so Playwright consults it first; it falls back for every other method.

```ts
/** #281: disabling the pressed save button drops focus to <body>; the
 *  dialog returns it once the busy state ends. */
async function failEntryPosts(page: Page): Promise<void> {
  await page.route("**/api/entries**", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();

      return;
    }
    await route.fulfill({ status: 502, json: { code: "jira", message: "Jira said no." } });
  });
}

test("after a failed save the keyboard focus returns to the save button", async ({ page }) => {
  await openToday(page);
  await failEntryPosts(page);

  await trigger(page, "WORK-412").click();
  await typeDuration(page, "130");
  const save = dialog(page).getByRole("button", { name: "Add entry" });
  await save.focus();
  await page.keyboard.press("Enter");

  await expect(dialog(page)).toContainText("Jira said no.");
  await expect(save).toBeEnabled();
  await expect(save).toBeFocused();
});

test("after a successful save the keyboard focus returns to the save button", async ({ page }) => {
  const recorder = await openToday(page);

  await trigger(page, "WORK-412").click();
  await typeDuration(page, "130");
  const save = dialog(page).getByRole("button", { name: "Add entry" });
  await save.focus();
  await page.keyboard.press("Enter");

  await expect.poll(() => recorder.posted.length).toBe(1);
  await expect(dialogTotal(page)).toHaveText("1h 30m");
  await expect(save).toBeEnabled();
  await expect(save).toBeFocused();
});

test("a save started from the comment field leaves focus in the comment field", async ({ page }) => {
  await openToday(page);
  await failEntryPosts(page);

  await trigger(page, "WORK-412").click();
  await typeDuration(page, "130");
  const comment = dialog(page).getByRole("textbox", { name: "Comment" });
  await comment.fill("csv");
  await comment.press("Enter");

  await expect(dialog(page)).toContainText("Jira said no.");
  await expect(comment).toBeFocused();
});
```

Check the comment field's accessible name in `that-entry-dialog.ts` before running; if it is not `Comment`, use the name it has. Check the error text the dialog shows for a 502 with that body (`showFailure` uses `ApiError.message`); adjust the expected text only if the client maps it differently.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/entries.spec.ts -g "focus"'`
Expected: the failed-save and successful-save tests FAIL on `toBeFocused` (focus is on `<body>`), in both browsers. The comment-field test passes already; it guards against a fix that moves focus to the button unconditionally. Quote the failing assertion in the report.

- [ ] **Step 3: Implement**

In `web/src/components/that-entry-dialog.ts`, extend the helper and its doc comment's last sentence:

```ts
  /**
   * ...existing text...
   * A no-op once focus already landed somewhere inside the dialog — startEditing
   * moves it to the comment field itself, which this must not override.
   * `preferred` wins over Close while it is still in the dialog: save()
   * passes the control it disabled, which dropped focus to <body>.
   */
  private refocusIfLostFromDialog(preferred?: Element | null): void {
    const dialog = this.dialog;
    const active = document.activeElement;
    if (!dialog || (active && dialog.contains(active))) return;

    if (preferred instanceof HTMLElement && dialog.contains(preferred)) preferred.focus();
    else this.closeControl?.focus();
  }
```

In `save()`, record focus before going busy and restore it after:

```ts
    const editing = this.editing;
    this.clearNotice();
    const focused = document.activeElement;
    this.setBusy(true);
    try {
      ...unchanged...
    } catch (error) {
      this.showFailure(error, "Could not save the entry.");
    } finally {
      this.setBusy(false);
      this.refocusIfLostFromDialog(focused);
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run the Step 2 command. Expected: all three PASS in Firefox and Chromium. Then run the whole `entries.spec.ts` file the same way without `-g` to confirm the delete-path focus tests still pass.

- [ ] **Step 5: Prove each new assertion by mutation**

One at a time, run the Step 2 command, show red, restore:
1. Remove `this.refocusIfLostFromDialog(focused);` from `finally` → both button tests fail on `toBeFocused`.
2. Change the helper so `preferred` is ignored (always `this.closeControl?.focus()`) → both button tests fail.
3. In `finally`, replace the call with `this.submit?.focus();` → the comment-field test fails.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/that-entry-dialog.ts .claude/e2e/tests/entries.spec.ts
git commit -m "fix(#281): the entry dialog returns focus to the save button after a save"
```

### Task 2: Gates

- [ ] Run `make verify`. Expected: green. Paste the tail.
- [ ] Run `make test-e2e`. Expected: green in both browsers. Paste the summary.
