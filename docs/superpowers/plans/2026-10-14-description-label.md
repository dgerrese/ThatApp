# The entry dialog's comment field gets a hidden "Description" label — Implementation Plan

**Date:** 2026-10-14
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The comment field in the entry dialog's foot form has the accessible name "Description", from a visually hidden native `<label for>` (#297).

**Architecture:** In `fieldRow()` of `web/src/components/that-entry-dialog.ts`, the input gets an `id` built from the dialog's existing `sequence` (as `headingId` and `instanceId` already are), and a `<label>` with `htmlFor` set to it, text "Description" and Tailwind's `sr-only`, goes into the row just before the input. `sr-only` is absolutely positioned, so it is not a flex item: it takes no slot and no gap, and nothing on screen moves. This is the pattern `settings-dialog.ts`'s `field()` uses, minus the visible styling.

**Tech Stack:** TypeScript (vanilla, light DOM); Tailwind v4; Playwright (Firefox and Chromium).

**Spec:** Codeberg #297. Its body is the design of record; the approach is the owner's decision of 2026-10-12. Its comments add only the approval.

## Global Constraints

- All tooling goes through `make` or `docker compose`. Never run Node or npm on the host.
- Vanilla TS with `strict` + `noUncheckedIndexedAccess`. No `any`, no `as any`, no `!`. Light DOM only. No new dependency.
- **A native `<label>`, not `aria-label`** (owner's preference for staying close to HTML). It sits **beside** the input and does not wrap it, so the foot form's flex row is untouched.
- **The label's text is exactly `Description`** — the stop dialog's word for the same field.
- **The placeholder `What did you work on?` is unchanged.** Nothing visible changes.
- **The input's `id` is unique in the document while the dialog is open.**
- Out of scope: the tests that find the field by its placeholder (they keep working, no change); the duration field's `aria-label`; any visible label.
- Firefox and Chromium only. Comments few: a non-obvious why only.
- **TDD.** RED fails on an assertion, for the reason the test names; the report quotes it. **Every assertion the task adds is proven by mutation**, with its red line in the report.
- Commands:

  ```shell
  # One e2e spec — the rig's own disposable app-e2e; always clean up around it
  docker compose --profile e2e rm --stop --force app-e2e
  docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test entries.spec.ts --reporter=line'
  docker compose --profile e2e rm --stop --force app-e2e
  # Prettier on web/src only (never on .claude/e2e)
  docker compose run --rm --no-deps web npx prettier --write src/components/that-entry-dialog.ts
  make tsc
  make lint
  ```

  Add `-g "<title fragment>"` to run one test.
- Commits: if `git commit` fails on signing, retry with `git -c commit.gpgsign=false commit …` and note it. **Never push.** Never merge into `main`.
- Branch: `issue-297-description-label`, already checked out. Do not switch, stash or reset.

## Review Focus

1. **The foot form looks exactly as before.** The existing "the foot form's three controls share the drawn 38px height" and "the duration input and comment field carry the drawn padding" tests in `entries.spec.ts` must stay green; the label must not add a flex gap.
2. **Clicking the hidden label is not a concern** — `sr-only` has a 1px box; nothing to test.
3. **Editing an entry** fills the same input; the existing "editing binds the foot form to one entry" test, which finds it by placeholder, stays green.
4. **A second dialog opened after the first closes** gets a new `sequence`, so a new id. The id test below checks one element per id while open.

---

### Task 1: A hidden native label names the comment field

**Files:**
- Modify: `web/src/components/that-entry-dialog.ts` (`fieldRow()`)
- Test: `.claude/e2e/tests/entries.spec.ts` (one new test, after "the duration input and comment field carry the drawn padding")

**Interfaces:**
- Consumes: the spec's existing helpers `openToday(page)`, `trigger(page, key)`, `dialog(page)`.
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the failing test**

```ts
// #297: a placeholder is not a label (WCAG 3.3.2). A hidden native label gives
// the field the stop dialog's word for it, and nothing on screen changes.
test("the comment field is named Description by its own label", async ({ page }) => {
  await openToday(page);

  await trigger(page, "WORK-412").click();

  const comment = dialog(page).getByRole("textbox", { name: "Description" });
  await expect(comment).toHaveAttribute("placeholder", "What did you work on?");

  const id = await comment.getAttribute("id");
  expect(id).toBeTruthy();
  await expect(dialog(page).locator(`label[for="${id ?? ""}"]`)).toHaveClass(/\bsr-only\b/);
  expect(await page.evaluate((each) => document.querySelectorAll(`[id="${each}"]`).length, id)).toBe(1);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run `-g "named Description"`, both browsers.
Expected: FAIL on `toHaveAttribute` — the `getByRole("textbox", { name: "Description" })` locator resolves to nothing, because the field's name is its placeholder.

- [ ] **Step 3: Add the label**

In `fieldRow()`, after `comment.placeholder = …`:

```ts
    comment.id = `that-entry-dialog-comment-${String(this.sequence)}`;
```

Before `row.append(…)`:

```ts
    // #297: sr-only is absolutely positioned, so it is no flex item and the
    // row's gap and the drawn 38px bar are untouched.
    const label = document.createElement("label");
    label.htmlFor = comment.id;
    label.className = "sr-only";
    label.textContent = "Description";
```

and change the append to `row.append(duration, label, comment, submit, ...this.cancelEditControl());`.

Run prettier on the file.

- [ ] **Step 4: Run the spec to verify it passes**

Run the whole `entries.spec.ts`, both browsers. Expected: all pass, including the 38px and padding tests.

- [ ] **Step 5: Mutation**

Each restored after:
1. Delete `row`'s `label` (append without it). Run the new test. Expected: red on `toHaveAttribute` (no textbox named Description).
2. Change `label.className` to `""`. Run the new test. Expected: red on `toHaveClass`. Then run "the foot form's three controls share the drawn 38px height" with the same mutation and record whether it goes red too (it is evidence that `sr-only` is what keeps the bar intact; red or green, report it).
3. Add `label.id = comment.id;`. Run the new test. Expected: red on `toBe(1)`.
4. Change `label.textContent` to `"Comment"`. Run the new test. Expected: red on `toHaveAttribute`.

- [ ] **Step 6: Gates**

Run `make tsc` and `make lint`. Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/that-entry-dialog.ts .claude/e2e/tests/entries.spec.ts
git commit -m "feat(entry-dialog): a hidden Description label names the comment field (#297)"
```
