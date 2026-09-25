# Edit waits for its own save (#200) Implementation Plan

**Date:** 2026-09-25
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While a save of instance X is in flight, row X's Edit button is disabled, so a second save
can never overwrite the first or wipe what the user typed.

**Architecture:** a module-level `Set<number>` of instance ids with a save in flight, read by
`patchRow` and updated by `save()`. #161's rebuild branch in `save()` becomes unreachable and is
deleted.

**Tech Stack:** vanilla TypeScript, Playwright e2e.

**Spec:** the refined body of Codeberg issue #200 (`tea api "repos/{owner}/{repo}/issues/200" | jq -r .body`).

## Global Constraints

- All commands through `make` or `docker compose`; no Node on the host.
- TypeScript strict; no `any`, no `as any`, no non-null assertion. Few comments, only the why.
- Nothing new is drawn: a disabled button is an existing mark (Test and Remove already use it).
- Out of scope: Remove during a save; controls on other rows; saves of different instances.

## Review Focus

1. **The re-enable must survive the refresh.** `save()` calls `await refresh(regions)` before its
   `finally`. `refresh` → `patchRow` reads the set while the id is still in it, so a `finally` that
   only deletes the id leaves Edit disabled for good. The `finally` must also update that row's Edit
   button directly. The success test catches it.
2. **A create has no id before it answers.** Only an edit (`editing` set) adds to the set.
3. **The failure path re-enables Edit too**, whether the form is still shown or not.

---

### Task 1: Edit is disabled while its own instance saves

**Files:**
- Modify: `web/src/views/settings.ts` (`instanceRow`, `patchRow`, `save()` in the form builder)
- Test: `.claude/e2e/tests/settings.spec.ts`

- [ ] **Step 1: Replace the #161 test and write the failing tests.** Delete "an Edit form opened on
  the instance being saved shows the saved values" (it asserts the behaviour this ticket removes).
  Add, in its place, using the file's own `stubInstancesApi`, `addInstance`, `holdNextRequest` and
  `saveFailure`:

```ts
test("while a save is held, that row's Edit is disabled and other rows' are not", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");
  await addInstance(page); // "Work"
  await addInstance(page, "Personal"); // see note below
  const held = await holdNextRequest(page, "**/api/instances/*", "PATCH");
  const work = page.locator('li[data-instance-id]', { hasText: "Work" });
  const personal = page.locator('li[data-instance-id]', { hasText: "Personal" });
  await work.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name").fill("Work Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await held.arrived;

  await expect(work.getByRole("button", { name: "Edit" })).toBeDisabled();
  await expect(personal.getByRole("button", { name: "Edit" })).toBeEnabled();
  held.release();
});

test("when the held save succeeds, Edit is enabled again and opens on the saved values", async ({ page }) => {
  // same setup with one instance; hold, save "Work Renamed", assert disabled, release;
  // then: the row's Edit is enabled; clicking it shows heading "Edit Work Renamed" and
  // Name has value "Work Renamed".
});

test("when the held save fails, Edit is enabled again and the failure reports where #161 put it", async ({ page }) => {
  // hold, save, release(saveFailure) with the form still shown:
  //   the row's Edit is enabled, and the form shows "could not save the instance".
  // A second case: hold, save, open Add instead (the form is replaced), release(saveFailure):
  //   the row's Edit is enabled, and the page error slot reads "Could not save Work: could not save the instance".
});
```

Write the second and third tests out in full, copying the shapes of the two existing tests just above
the deleted one ("a save failing with its form still shown reports in the form" and the one before it,
which covers the error slot). If `addInstance` takes no name, add the second instance the way it adds
the first, with the name "Personal"; read the helper first.

- [ ] **Step 2:** Run `settings.spec.ts`; the disabled-Edit test must FAIL on this base (it is main).
  Paste the output.
- [ ] **Step 3: Implement.**

```ts
// A second Edit on an instance whose save has not answered would open on
// pre-save values and overwrite that save (#200).
const savingIds = new Set<number>();
```

- `instanceRow`: mark the Edit button `edit.dataset["rowEdit"] = ""`.
- `patchRow`: at the end,
  `row.querySelector("[data-row-edit]")?.toggleAttribute("disabled", savingIds.has(instance.id));`
- `save()`: when `editing` is set, `savingIds.add(editing.id)` and disable that row's Edit before the
  request; in a `finally`, `savingIds.delete(editing.id)` and re-enable that row's Edit directly (find
  the row by `li[data-instance-id="<id>"]` in `regions.listCard`, as `clearRowStatus` does). Delete
  the `else if (regions.formCard.querySelector(`[data-editing-id="${saved.id}"]`))` branch; if
  `saved` becomes unused, drop the binding.
- [ ] **Step 4:** Run `settings.spec.ts` and `keyboard-audit.spec.ts` if it exists; all pass. Run
  `make verify`, then the full `make test-e2e`. Paste both summaries.
- [ ] **Step 5:** Commit: `Edit stays disabled while its own instance saves (#200)`.
