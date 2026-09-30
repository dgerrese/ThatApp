# Settings error-slot gap Implementation Plan

**Date:** 2026-09-30
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A message in the Settings dialog's error slot keeps a 10px gap above the instance list, and the empty slot adds nothing (#205).

**Architecture:** One class on `regions.errorSlot` in `web/src/settings-dialog.ts`: `mb-2.5 empty:mb-0`, the section heading's own 10px bottom margin, collapsed while the slot is empty — the pattern the file already uses for a row's status (`mt-2 empty:mt-0`). A `data-error-slot` attribute lets the tests find the slot.

**Tech Stack:** TypeScript, Tailwind CSS v4, Playwright (Firefox and Chromium).

**Spec:** Codeberg issue #205 (its body is the spec). The gap was settled by the owner on 2026-09-30: 10px, the section heading's bottom margin (`mb-2.5` in `SECTION_HEADING_CLASS`).

## Global Constraints

- All tooling runs through `make` or `docker compose`; never Go, Node or npm on the host.
- No JavaScript frameworks; Tailwind v4 utilities only; light DOM.
- Firefox and Chromium only.
- Commits: if `git commit` fails on signing, retry with `git -c commit.gpgsign=false commit …`. Never push.

## Review Focus

1. The slot is filled from two places (a failed list read in `refresh()`, and the save error for a form that has since closed); both go through the same element, so one class must cover both.
2. An empty slot must add 0px — `empty:` only matches an element with no children *and no text nodes*, and `replaceChildren()` with no arguments leaves none.
3. A later successful refresh clears the slot (`regions.errorSlot.replaceChildren()` at `settings-dialog.ts:172`), and the gap must go with it.
4. The gap is measured to the element that follows the slot (`regions.listSlot`), which may be empty after a failed read; its top is still laid out.

---

### Task 1: The error slot's gap

**Files:**
- Modify: `web/src/settings-dialog.ts:58-73` (where `regions` is built and appended)
- Test: `.claude/e2e/tests/settings.spec.ts` (new tests after the test named "a save failing with its form still shown reports in the form")

**Interfaces:**
- Consumes: the spec's existing helpers `stubInstancesApi`, `openSettings`, `addInstance`, `holdNextRequest` and the constant `saveFailure`, all in `settings.spec.ts`.
- Produces: the attribute `data-error-slot` on the slot element.

- [ ] **Step 1: Write the failing tests**

Add after the test "a save failing with its form still shown reports in the form":

```ts
// #205: the error slot keeps the section heading's 10px above the instance
// list while it holds a message, and adds nothing while it is empty. The gap
// is the slot's own bottom edge to the top of the element after it.
async function errorSlotGap(page: Page): Promise<{ gap: number; height: number }> {
  return page.locator("[data-error-slot]").evaluate((slot) => {
    const next = slot.nextElementSibling;
    if (!next) throw new Error("nothing follows the error slot");
    const own = slot.getBoundingClientRect();
    return { gap: next.getBoundingClientRect().top - own.bottom, height: own.height };
  });
}

async function failFirstListRead(page: Page): Promise<void> {
  let failed = false;
  await page.route("**/api/instances", async (route) => {
    if (route.request().method() !== "GET" || failed) {
      await route.fallback();
      return;
    }
    failed = true;
    await route.fulfill({
      status: 500,
      json: { code: "store_failed", message: "could not read the stored instances" },
    });
  });
}

test("a failed list read leaves 10px between its message and the instance list", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await failFirstListRead(page);
  await openSettings(page);
  await expect(page.locator("[data-error-slot]")).toContainText("could not read the stored instances");

  expect((await errorSlotGap(page)).gap).toBeCloseTo(10, 0);
});

test("a save error reported after its form closed leaves the same 10px", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await openSettings(page);
  await addInstance(page);
  await expect(page.getByText("Work", { exact: true })).toBeVisible();

  const held = await holdNextRequest(page, "**/api/instances/*", "PATCH");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Work Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await held.arrived;
  await page.getByRole("button", { name: "Cancel" }).click();
  held.release(saveFailure);
  await expect(page.getByText("Could not save Work: could not save the instance")).toBeVisible();

  expect((await errorSlotGap(page)).gap).toBeCloseTo(10, 0);
});

test("an empty error slot adds nothing above the instance list", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await openSettings(page);
  await expect(page.getByText("No instances yet. Add one below.")).toBeVisible();

  expect(await errorSlotGap(page)).toEqual({ gap: 0, height: 0 });
});

test("a successful refresh clears the message and takes the gap out with it", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await failFirstListRead(page);
  await openSettings(page);
  await expect(page.locator("[data-error-slot]")).toContainText("could not read the stored instances");

  await addInstance(page);
  await expect(page.getByText("Work", { exact: true })).toBeVisible();
  await expect(page.locator("[data-error-slot]")).toBeEmpty();

  expect(await errorSlotGap(page)).toEqual({ gap: 0, height: 0 });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```shell
docker compose --profile e2e rm --stop --force app-e2e
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test settings.spec.ts -g "error slot|10px|takes the gap" --reporter=line'
docker compose --profile e2e rm --stop --force app-e2e
```
Expected: all four fail in both browsers, because `[data-error-slot]` does not exist yet (locator timeout). Record the output in the task report.

- [ ] **Step 3: Implement**

In `web/src/settings-dialog.ts`, after `regions.formSection.hidden = true;`, add:

```ts
  regions.errorSlot.dataset["errorSlot"] = "";
  regions.errorSlot.className = "mb-2.5 empty:mb-0";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run the same command as Step 2. Expected: all eight runs (four tests × two browsers) pass. If the first two now fail with a gap other than 10, the class is not applied — do not change the expected value.

- [ ] **Step 5: Run the gates**

```shell
make verify
make test-e2e
```
Expected: `verify: OK`, and the e2e summary shows no failures.

- [ ] **Step 6: Commit**

```shell
git add web/src/settings-dialog.ts .claude/e2e/tests/settings.spec.ts
git commit -m "#205: the Settings error slot keeps 10px above the instance list"
```
