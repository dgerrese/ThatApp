# Escape closes the instance form first (#250) Implementation Plan

**Date:** 2026-09-29
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Settings, the first Escape closes an open add/edit instance form and keeps Settings open; a second Escape closes Settings.

**Architecture:** One `cancel` listener on the Settings `<dialog>` in `showSettings()` (`web/src/settings-dialog.ts`): when the form section is showing, it calls `preventDefault()` and the existing `hideForm(regions)`. `hideForm` already hands focus back to the form's opener (falling back to "Add an instance") only when focus was in the form or on `<body>`. The one change to `hideForm`: an opener that is disabled — the row's Edit while its save is in flight — cannot take focus, so it falls back to "Add an instance" too. `that-confirm` needs nothing: `cancel` fires on the topmost modal and does not bubble.

**Tech Stack:** TypeScript (strict), Playwright e2e.

**Spec:** Codeberg issue #250 — the body (Problem, Approach, Acceptance criteria) and the owner's approving comment of 2026-09-29.

## Global Constraints

- All commands through `make` or `docker compose`; no Go, Node or npm on the host.
- TypeScript strict; no `any`, `as any` or non-null assertion. Few comments, only the why.
- **No `keydown` interception.** The mechanism is the dialog's `cancel` event, per the issue's Approach.
- Keyboard tests press real keys (`page.keyboard.press`); never `.focus()` the element under test (#217). Focus is moved by clicking or by Tab/Shift+Tab, and asserted before the key under test is pressed.
- This changes keyboard behaviour and nothing drawn on screen: no design comparison and no screenshots are needed.
- Out of scope: keeping a draft after the form closes; an "unsaved changes" prompt; any Escape behaviour outside Settings.
- Firefox and Chromium both run every test. WebKit is a non-goal.

## Review Focus

1. **Focus somewhere else in Settings** (a row's button, not the form): the form closes and focus stays exactly where it was — Task 1's "focus elsewhere" test.
2. **A Remove confirm over an open form** takes the Escape itself; the form underneath keeps its typed value — Task 1's confirm test.
3. **Escape while an edit save is in flight:** the row's Edit is disabled, so focus falls to "Add an instance" rather than being stranded on `<body>`; the save still re-enables Edit when it answers — Task 2.
4. **Chromium's close-watcher rule:** the second Escape follows a prevented `cancel` with no user activation in between, so Chromium closes the dialog without a cancelable `cancel`. The two-press tests run in both browsers and prove Settings closes either way — Task 1 and Task 2.
5. **No form open:** the listener stays out of the way and Escape still closes Settings with focus back on the cog — the existing "Escape closes Settings" test, re-run in Task 1 Step 4.

---

### Task 1: The `cancel` listener closes the form first

**Files:**
- Modify: `web/src/settings-dialog.ts` — `showSettings()`, after the `close` listener (~line 92)
- Test: `.claude/e2e/tests/settings.spec.ts` — a new `test.describe("Escape with the instance form open", ...)` placed directly after the `test.describe("the dialog", ...)` block (which ends ~line 1035)

**Interfaces:**
- Consumes (existing, same files): `hideForm(regions: Regions): void`, `regions.formSection: HTMLElement`; in the spec, `openSettings(page): Promise<Locator>`, `stubListed(page, instances)`, `listed(id, name)`, `confirmDialog(page)`.
- Produces: nothing new for Task 2 beyond the listener's behaviour.

- [ ] **Step 1: Write the failing tests**

Add after the closing `});` of `test.describe("the dialog", ...)`:

```ts
// #250: Escape first closes the add/edit form, keeping what the rest of
// Settings shows; only a second Escape closes Settings.
test.describe("Escape with the instance form open", () => {
  test("the first closes the Add form and keeps Settings; the second closes Settings", async ({
    page,
  }) => {
    await stubListed(page, [listed(1, "Ridgeline")]);
    const settings = await openSettings(page);
    await settings.getByRole("button", { name: "Add an instance" }).click();
    await settings.getByLabel("Name", { exact: true }).fill("Half-typed");

    await page.keyboard.press("Escape");

    await expect(settings.getByLabel("Name", { exact: true })).toHaveCount(0);
    await expect(settings).toBeVisible();
    await expect(settings.getByRole("button", { name: "Add an instance" })).toBeFocused();

    await page.keyboard.press("Escape");

    await expect(settings).toHaveCount(0);
    await expect(page.locator("#settings-cog")).toBeFocused();
  });

  test("closing an Edit form hands focus back to that row's Edit", async ({ page }) => {
    await stubListed(page, [listed(1, "Ridgeline"), listed(2, "Harbour")]);
    const settings = await openSettings(page);
    await settings.getByRole("button", { name: "Edit Harbour", exact: true }).click();
    await expect(settings.getByLabel("Name", { exact: true })).toBeFocused();

    await page.keyboard.press("Escape");

    await expect(settings.getByLabel("Name", { exact: true })).toHaveCount(0);
    await expect(settings).toBeVisible();
    await expect(settings.getByRole("button", { name: "Edit Harbour", exact: true })).toBeFocused();
  });

  test("with focus elsewhere in Settings, the form closes and focus stays put", async ({ page }) => {
    await stubListed(page, [listed(1, "Ridgeline")]);
    const settings = await openSettings(page);
    await settings.getByRole("button", { name: "Add an instance" }).click();
    await expect(settings.getByLabel("Name", { exact: true })).toBeFocused();

    // Back past Add an instance onto the row's last control.
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    const remove = settings.getByRole("button", { name: "Remove Ridgeline", exact: true });
    await expect(remove).toBeFocused();

    await page.keyboard.press("Escape");

    await expect(settings.getByLabel("Name", { exact: true })).toHaveCount(0);
    await expect(settings).toBeVisible();
    await expect(remove).toBeFocused();
  });

  test("a Remove confirm over the form takes the Escape itself", async ({ page }) => {
    await stubListed(page, [listed(1, "Ridgeline")]);
    const settings = await openSettings(page);
    await settings.getByRole("button", { name: "Add an instance" }).click();
    await settings.getByLabel("Name", { exact: true }).fill("Half-typed");
    await settings.getByRole("button", { name: "Remove Ridgeline", exact: true }).click();
    await expect(confirmDialog(page)).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(confirmDialog(page)).toBeHidden();
    await expect(settings).toBeVisible();
    await expect(settings.getByLabel("Name", { exact: true })).toHaveValue("Half-typed");
  });
});
```

If the "focus elsewhere" test's `toBeFocused()` on Remove fails *before* the Escape because the tab order differs from row controls → Add an instance → form, fix the number of Shift+Tab presses to land on Remove Ridgeline and keep the pre-Escape assertion; do not replace the key presses with `.focus()`.

- [ ] **Step 2: Run them to verify they fail**

```bash
docker compose --profile e2e rm --stop --force app-e2e
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/settings.spec.ts -g "Escape with the instance form open"'
docker compose --profile e2e rm --stop --force app-e2e
```

Expected, in both browsers: the first three FAIL (the first Escape closes Settings, so `toBeVisible()` or the focus assertion fails); "a Remove confirm over the form takes the Escape itself" PASSES already — it is a guard that the listener must not break.

- [ ] **Step 3: Add the listener**

In `showSettings()`, directly after the `dialog.addEventListener("close", ...)` block:

```ts
  // Chromium's close watcher: once a cancel is prevented, the next close request
  // with no user activation in between closes the dialog without a cancelable
  // cancel. By then the form is already closed, and reopening it takes a click
  // or a key that counts as activation, so a second Escape still means Settings.
  dialog.addEventListener("cancel", (event) => {
    if (regions.formSection.hidden) return;
    event.preventDefault();
    hideForm(regions);
  });
```

- [ ] **Step 4: Run the new tests and the existing Escape tests**

```bash
docker compose --profile e2e rm --stop --force app-e2e
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/settings.spec.ts -g "Escape"'
docker compose --profile e2e rm --stop --force app-e2e
```

Expected: all PASS in Firefox and Chromium — the four new tests, "Escape closes Settings", "pressing Escape cancels the removal", and "a removal answered after Settings closed…". "closing and reopening Settings while a save is held…" now FAILS (its single Escape only closes the form); Task 2 owns it. Record that failure in the task report; it is expected here.

- [ ] **Step 5: Lint and types**

```bash
make lint
make tsc
```

Expected: both clean. If prettier reflows anything, run `make fmt` and take its formatting.

- [ ] **Step 6: Commit**

```bash
git add web/src/settings-dialog.ts .claude/e2e/tests/settings.spec.ts
git commit -m "[#250] Escape closes the open instance form before it closes Settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LSFNGKuFZChTpQMJ5cQuAH"
```

If signing fails (locked vault), retry with `git -c commit.gpgsign=false commit …` and carry on. Never push.

---

### Task 2: Escape during an in-flight save

**Files:**
- Modify: `web/src/settings-dialog.ts` — `hideForm()` (~lines 231-242)
- Test: `.claude/e2e/tests/settings.spec.ts` — "closing and reopening Settings while a save is held still re-enables that row's Edit" (~line 800)

**Interfaces:**
- Consumes: Task 1's `cancel` listener; `holdNextRequest(page, url, method): Promise<HeldRequest>`, `stubInstancesApi`, `addInstance` from the spec.
- Produces: `hideForm` falls back to `regions.addButton` when `regions.formOpener` is disconnected **or disabled**.

- [ ] **Step 1: Update the test to two presses**

In "closing and reopening Settings while a save is held still re-enables that row's Edit", replace

```ts
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
```

with

```ts
  // The first Escape closes the form while the save carries on (#250). The
  // row's Edit is disabled until the save answers, so focus falls back to Add.
  await page.keyboard.press("Escape");
  await expect(settings.getByLabel("Name", { exact: true })).toHaveCount(0);
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("button", { name: "Add an instance" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
```

Everything after it — reopening, `toBeDisabled()`, `held.release()`, `toBeEnabled()` — stays as it is.

- [ ] **Step 2: Run it to verify it fails**

```bash
docker compose --profile e2e rm --stop --force app-e2e
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/settings.spec.ts -g "closing and reopening Settings while a save is held"'
docker compose --profile e2e rm --stop --force app-e2e
```

Expected: FAIL in both browsers on `toBeFocused()` for "Add an instance" — `hideForm` tried to focus the disabled Edit, which does nothing, leaving focus on `<body>`.

- [ ] **Step 3: Fall back past a disabled opener**

In `hideForm`, replace

```ts
  if (hadFocus) {
    (regions.formOpener.isConnected ? regions.formOpener : regions.addButton).focus();
  }
```

with

```ts
  if (hadFocus) {
    const opener = regions.formOpener;
    // A row's Edit is disabled while its save is in flight, and takes no focus.
    (opener.isConnected && !opener.matches(":disabled") ? opener : regions.addButton).focus();
  }
```

- [ ] **Step 4: Run the Settings spec**

```bash
docker compose --profile e2e rm --stop --force app-e2e
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/settings.spec.ts'
docker compose --profile e2e rm --stop --force app-e2e
```

Expected: the whole file PASSES in Firefox and Chromium — including "when the held save succeeds, Edit is enabled again, focused…" (its Edit is enabled by the time `hideForm` runs, so it still takes focus) and "when the held save fails…".

- [ ] **Step 5: Full gates**

```bash
make verify
make test-e2e
```

Expected: both green. Paste the tail of each output into the task report.

- [ ] **Step 6: Commit**

```bash
git add web/src/settings-dialog.ts .claude/e2e/tests/settings.spec.ts
git commit -m "[#250] Escape during a held save closes the form first; focus skips the disabled Edit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LSFNGKuFZChTpQMJ5cQuAH"
```

If signing fails (locked vault), retry with `git -c commit.gpgsign=false commit …` and carry on. Never push.

---

## Acceptance criteria → where each is proven

| #250 criterion | Test |
|---|---|
| Add form: first Escape closes it, Settings stays, "Add an instance" focused | Task 1 "the first closes the Add form…" |
| Edit form: focus lands on that row's Edit | Task 1 "closing an Edit form…" |
| Focus elsewhere: form closes, focus stays | Task 1 "with focus elsewhere…" |
| Second Escape closes Settings, focus to the cog | Task 1 "the first closes the Add form…" (second half) |
| No form open: Escape closes Settings | existing "Escape closes Settings" |
| Remove confirm over the form closes only the confirm | Task 1 "a Remove confirm over the form…" |
| Held-save test updated to two presses, Edit re-enabled | Task 2 |
| Firefox and Chromium | every run above covers both projects |
| `make verify`, `make test-e2e` green | Task 2 Step 5 |
