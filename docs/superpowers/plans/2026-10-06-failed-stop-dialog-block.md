# A failed stop keeps the dialog open, with a block — Implementation Plan

**Date:** 2026-10-06
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the stop or switch POST fails after the stop dialog is confirmed, the dialog stays open with the typed description, the timer still runs, and one error dialog block names the failure (#208).

**Architecture:** `confirmStop` takes a `commit(choice)` callback and runs it *before* closing: a rounding click or Enter clears the dialog's blocks, awaits `commit`, closes on success and adds one error block on failure. The stop dialog gains a `that-dialog-blocks` host exactly as `that-entry-dialog.ts` has one. `timer-state.ts` moves its POST + `setRunning` into that `commit` for both stop and switch. A busy state disables the buttons and swallows Esc while the POST is out.

**Tech Stack:** TypeScript (vanilla, light-DOM WebComponents), Tailwind CSS v4, Playwright (Firefox and Chromium).

**Spec:** Codeberg issue #208 (refined and approved; its Approach and Acceptance criteria are binding) and `docs/superpowers/specs/2026-09-25-toasts-design.md`, decisions 7 and 8 (the dialog block) and its *Where each alert goes* row `that-stop-dialog.ts` → dialog block (#208). The pattern to copy is `web/src/components/that-entry-dialog.ts`: its `blocks` field, `setBusy`, `showFailure`.

## Global Constraints

- All tooling through `make` or `docker compose`; never Go, Node or npm on the host. Read `THAT_PORT` from `.env` before pointing anything at the dev stack; never assume it. (The e2e rig below brings up its own `app-e2e` and needs no port.)
- No JavaScript frameworks; no new dependencies. Light DOM, never shadow DOM. Tailwind v4 utilities only.
- Firefox and Chromium only.
- Reuse, do not re-implement: `that-dialog-blocks` (`attach(dialog)`, `add(tone, message)`, `clear()`), `ApiError` from `web/src/api.ts`, and the `disabled` attribute `that-button` already observes.
- **Wording:** the block's text is `ApiError.message`, falling back to exactly `Could not stop the timer — try again.` (em dash). The block's tone is `error`.
- **TDD, per task.** RED must fail on an assertion, for the reason the test names — not a compile error, not a timeout waiting for an element that a typo hides. The task report quotes the RED failure line. Then **every assertion the task adds or changes is proven by mutation**: break the guarded code by hand, run that one test, show it red, restore, show it green. The report lists each mutation and its red line.
- Do not run Prettier on `.claude/e2e/` (no config there). For `web/src`: `docker compose run --rm --no-deps web npx prettier --write <files>`.
- Running one e2e spec (the rig's own disposable app; always clean up around it):

  ```shell
  docker compose --profile e2e rm --stop --force app-e2e
  docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test timer.spec.ts timer-guard.spec.ts --reporter=line'
  docker compose --profile e2e rm --stop --force app-e2e
  ```

  Add `-g "<test title fragment>"` to run one test (used for every mutation run).
- Commits: if `git commit` fails on signing, retry with `git -c commit.gpgsign=false commit …`. Never push.

## Rulings made before execution (the controller's, reversible)

1. **Keep running is disabled while busy, too.** The ticket names the rounding buttons and Esc; Keep running is the same cancel as Esc, and leaving it live would let the dialog close under an in-flight POST and lose its failure. The description field stays enabled (so the text stays readable and selectable), and Enter in it is a no-op while busy. Parked as a question for the owner.
2. **`confirmStop` resolves `void`, when the dialog closes.** Its callers no longer need the choice — `commit` carries it — and `oneAtATime` stays held until the close, which is what #209 relies on.

## Review Focus

1. A second confirm while the first POST is out (double click, or Enter in the field) must not send a second POST — Task 2's test pins Enter; disabled buttons cover clicks.
2. A switch that fails runs `readTimer()` inside `commit` (the existing #209 re-read); the dialog must stay open on the first timer and the re-read must not throw past the block — Task 1's switch test.
3. The block must not outlive the dialog on any exit after a failure: Keep running, Esc, and a later successful retry — Task 1's tests assert `that-dialog-blocks` count 0 after each.
4. The rail's stop button routes through the same `stopTimer`, so the rail must get the fix with no change of its own — Task 1's stop test opens the dialog from the rail once (the retry test), the rest from a row.
5. The ticking run line must keep repainting while a block shows and while busy (`paint()` touches only `label`/`variant`, never `disabled`) — Task 2's test asserts the buttons stay disabled across a repaint tick.

---

### Task 1: The stop dialog commits before it closes, and a failure is a block

**Files:**
- Modify: `web/src/components/that-stop-dialog.ts` (the whole component and `confirmStop`, :1-157)
- Modify: `web/src/timer-state.ts` (`askHowToStop`, `startTimerNow`, `stopTimerNow`, :97-135; the module comment's last paragraph, :15-16)
- Test: `.claude/e2e/tests/timer.spec.ts` (append a section), `.claude/e2e/tests/timer-guard.spec.ts` (rewrite "after a failed stop, the next stop opens the dialog again", :280-301)

**Interfaces:**
- Produces:
  - `export function confirmStop(issueKey: string, nextIssueKey: string | undefined, elapsed: () => number, commit: (choice: StopChoice) => Promise<void>): Promise<void>` — resolves when the dialog closes, for any reason.
  - `ThatStopDialog.commit: (choice: StopChoice) => Promise<void>` (public field, set before connection).
  - In `timer-state.ts`: `async function askHowToStop(nextIssueKey: string | undefined, commit: (choice: StopChoice) => Promise<void>): Promise<void>`.
  - Task 2 consumes `ThatStopDialog.confirm(round: Rounding): Promise<void>` (private) and adds busy to it.

- [ ] **Step 1: Write the failing tests.** Append to `.claude/e2e/tests/timer.spec.ts`:

```ts
/**
 * #208: a stop or switch that fails after the dialog is confirmed leaves the
 * dialog open, the description typed and the timer running, with one error
 * block above the dialog (the toasts design, decisions 7 and 8).
 */
const stopBlocks = (page: Page) => page.locator("that-stop-dialog that-dialog-blocks that-toast");

/** Registered after stubTimer, so it answers first for `times` requests and
 *  then falls through to the stub. */
async function failTimerPost(page: Page, path: "stop" | "start", times = 1): Promise<void> {
  await page.route(
    `**/api/timer/${path}`,
    (route) => route.fulfill({ status: 500, json: { code: "internal_error", message: "Jira said no." } }),
    { times },
  );
}

test("a failed stop keeps the dialog open with its description, the timer running and one error block above it", async ({
  page,
}) => {
  const recorder = await stubTimer(page, { runningFor: 60 });
  await failTimerPost(page, "stop");
  await page.goto("/today");

  const row = ticketRow(page, "WORK-1");
  const dialog = page.getByRole("dialog");
  await row.getByRole("button", { name: "stop timer" }).click();
  await dialog.getByRole("textbox", { name: "Description" }).fill("Traced the export");
  const before = await dialog.boundingBox();
  await dialog.getByRole("button", { name: "Log 0:15" }).click();

  await expect(stopBlocks(page)).toHaveCount(1);
  await expect(stopBlocks(page)).toContainText("Jira said no.");
  await expect(stopBlocks(page).getByRole("img", { name: "Failed" })).toBeVisible();
  await expect(stopBlocks(page).getByRole("button", { name: "Dismiss" })).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("WORK-1 ran")).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Description" })).toHaveValue("Traced the export");
  await expect(row.getByRole("button", { name: "stop timer" })).toBeVisible();
  await expect(railTimer(page)).toContainText("WORK-1");
  expect(recorder.logged).toEqual([]);

  // The entry dialog's block geometry: 8px above, the dialog's width and left edge, the dialog unchanged.
  const block = await stopBlocks(page).boundingBox();
  const after = await dialog.boundingBox();
  if (!before || !block || !after) throw new Error("no box");
  expect(Math.abs(block.y + block.height + 8 - after.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(block.width - after.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(block.x - after.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
});

test("a retry clears the block when it starts, and a successful one writes the description and closes", async ({
  page,
}) => {
  const recorder = await stubTimer(page, { runningFor: 60 });
  await failTimerPost(page, "stop");
  await page.goto("/today");

  // From the rail: it routes through the same stopTimer as a row.
  const dialog = page.getByRole("dialog");
  await railTimer(page).getByRole("button", { name: "stop timer" }).click();
  await dialog.getByRole("textbox", { name: "Description" }).fill("Traced the export");
  await dialog.getByRole("button", { name: "Log 0:15" }).click();
  await expect(stopBlocks(page)).toHaveCount(1);

  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/api/timer/stop",
    async (route) => {
      await held;
      await route.fallback();
    },
    { times: 1 },
  );
  await dialog.getByRole("button", { name: "Log 0:15" }).click();
  await expect(stopBlocks(page)).toHaveCount(0);
  release();

  await expect(dialog).toHaveCount(0);
  await expect(page.locator("that-dialog-blocks")).toHaveCount(0);
  await expect(railTimer(page)).toContainText("No timer running");
  await expect.poll(() => recorder.logged).toEqual([
    expect.objectContaining({ issueKey: "WORK-1", seconds: 900, comment: "Traced the export" }),
  ]);
});

test("a retry that fails again shows exactly one fresh block, from a click or from Enter", async ({ page }) => {
  await stubTimer(page, { runningFor: 60 });
  await failTimerPost(page, "stop", 3);
  await page.goto("/today");

  const dialog = page.getByRole("dialog");
  await ticketRow(page, "WORK-1").getByRole("button", { name: "stop timer" }).click();
  await dialog.getByRole("button", { name: "Log 0:15" }).click();
  await expect(stopBlocks(page)).toHaveCount(1);
  await stopBlocks(page).getByRole("button", { name: "Dismiss" }).click();
  await expect(stopBlocks(page)).toHaveCount(0);

  await dialog.getByRole("button", { name: "Log 0:15" }).click();
  await expect(stopBlocks(page)).toHaveCount(1);
  await dialog.getByRole("textbox", { name: "Description" }).press("Enter");
  await expect(stopBlocks(page)).toHaveCount(1);
  await expect(stopBlocks(page)).toContainText("Jira said no.");
  await expect(dialog).toBeVisible();
});

test("a failed switch keeps the dialog open with a block, and the first timer still running", async ({ page }) => {
  const recorder = await stubTimer(page);
  await page.goto("/today");

  const first = ticketRow(page, "WORK-1");
  const second = ticketRow(page, "WORK-2");
  await first.getByRole("button", { name: "start timer" }).click();
  await expect(first.getByRole("button", { name: "stop timer" })).toBeVisible();

  await failTimerPost(page, "start");
  await second.getByRole("button", { name: "start timer" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Description" }).fill("Half the export");
  await dialog.getByRole("button", { name: "Log 0:15" }).click();

  await expect(stopBlocks(page)).toHaveCount(1);
  await expect(stopBlocks(page)).toContainText("Jira said no.");
  await expect(dialog.getByRole("heading")).toHaveText("Stop WORK-1 and start WORK-2?");
  await expect(dialog.getByRole("textbox", { name: "Description" })).toHaveValue("Half the export");
  await expect(first.getByRole("button", { name: "stop timer" })).toBeVisible();
  await expect(second.getByRole("button", { name: "start timer" })).toBeVisible();
  await expect(railTimer(page)).toContainText("WORK-1");

  await dialog.getByRole("button", { name: "Log 0:15" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(railTimer(page)).toContainText("WORK-2");
  await expect.poll(() => recorder.logged).toEqual([
    expect.objectContaining({ issueKey: "WORK-1", comment: "Half the export" }),
  ]);
});

test("after a failure, Keep running and Esc still cancel, and the block leaves with the dialog", async ({ page }) => {
  await stubTimer(page, { runningFor: 60 });
  await failTimerPost(page, "stop", 2);
  await page.goto("/today");

  const row = ticketRow(page, "WORK-1");
  const dialog = page.getByRole("dialog");

  await row.getByRole("button", { name: "stop timer" }).click();
  await dialog.getByRole("button", { name: "Log 0:15" }).click();
  await expect(stopBlocks(page)).toHaveCount(1);
  await dialog.getByRole("button", { name: "Keep running" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("that-dialog-blocks")).toHaveCount(0);
  await expect(page.locator("that-toast")).toHaveCount(0);

  await row.getByRole("button", { name: "stop timer" }).click();
  await dialog.getByRole("button", { name: "Log 0:15" }).click();
  await expect(stopBlocks(page)).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("that-dialog-blocks")).toHaveCount(0);
  await expect(page.locator("that-toast")).toHaveCount(0);
  await expect(row.getByRole("button", { name: "stop timer" })).toBeVisible();
});
```

And in `.claude/e2e/tests/timer-guard.spec.ts`, rewrite the last test — its premise (the dialog closes on a failure) is what this ticket removes; what it guards (#209's `oneAtATime` is released after a failure) still holds once the dialog is left:

```ts
test("after a failed stop and Keep running, the next stop opens the dialog again", async ({ page }) => {
  await stubTimer(page, { runningFor: 60 });
  // Registered after the stub's own /api/timer/stop route, so it runs first
  // for the one request `times: 1` allows, then falls through to the stub's
  // handler for every stop after.
  await page.route(
    "**/api/timer/stop",
    (route) => route.fulfill({ status: 500, json: { code: "internal_error", message: "boom" } }),
    { times: 1 },
  );
  await page.goto("/today");

  const row = ticketRow(page, "WORK-1");
  const dialog = page.getByRole("dialog");
  await row.getByRole("button", { name: "stop timer" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Log 0:15" }).click();
  await expect(page.locator("that-stop-dialog that-dialog-blocks that-toast")).toHaveCount(1);
  await dialog.getByRole("button", { name: "Keep running" }).click();
  await expect(dialog).toHaveCount(0);

  await row.getByRole("button", { name: "stop timer" }).click();
  await expect(page.locator("#that-stop-dialog-heading")).toBeVisible();
});
```

- [ ] **Step 2: Run to verify they fail**, with the Global Constraints command for `timer.spec.ts timer-guard.spec.ts`.
Expected: each new test fails on its first block assertion — `expect(locator).toHaveCount(1)` for `that-stop-dialog that-dialog-blocks that-toast`, received 0 (today the dialog closes on the click and no block host exists). The rewritten guard test fails the same way. Quote one RED line per test in the report. If any fails for another reason (a locator that never resolves, a type error), fix the test before going on.

- [ ] **Step 3: Restructure `web/src/components/that-stop-dialog.ts`.**

Imports — add the block host and `ApiError`:

```ts
import "./that-button";
import "./that-dialog-blocks";

import { ApiError } from "../api";
import { fieldFigure, roundedSeconds } from "../duration";
import type { Rounding, StopChoice } from "../types";
import type { ThatDialogBlocks } from "./that-dialog-blocks";
import { … unchanged … } from "./that-confirm";
```

Fields — add next to `elapsed`:

```ts
  commit: (choice: StopChoice) => Promise<void> = () => Promise.resolve();

  private readonly blocks = document.createElement("that-dialog-blocks") as ThatDialogBlocks;
```

In `connectedCallback`, every confirm goes through `confirm()` instead of `dialog.close(round)`:

```ts
    field.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      void this.confirm("up");
    });
    …
    keep.addEventListener("click", () => dialog.close());
    down.addEventListener("click", () => void this.confirm("down"));
    up.addEventListener("click", () => void this.confirm("up"));
```

Append the host inside the dialog (a modal dialog makes everything outside it inert, and Dismiss must be clickable), and attach it once the dialog is shown:

```ts
    dialog.append(heading, line, label, actions, this.blocks);
    …
    dialog.showModal();
    this.blocks.attach(dialog);
```

The new method:

```ts
  /** Commits the choice first and closes only once it landed; a failure stays
   *  in the dialog as a block, so the typed description survives a retry. */
  private async confirm(round: Rounding): Promise<void> {
    this.blocks.clear();
    try {
      await this.commit({ round, comment: this.comment });
      this.dialog?.close();
    } catch (error) {
      this.blocks.add(
        "error",
        error instanceof ApiError ? error.message : "Could not stop the timer — try again.",
      );
    }
  }
```

`confirmStop` — takes `commit`, resolves `void` on close:

```ts
/** Opens the stop dialog; a confirmed rounding runs `commit` while the dialog
 *  stays open. Resolves once the dialog closes — committed, kept running, or Esc. */
export function confirmStop(
  issueKey: string,
  nextIssueKey: string | undefined,
  elapsed: () => number,
  commit: (choice: StopChoice) => Promise<void>,
): Promise<void> {
  const element = document.createElement("that-stop-dialog") as ThatStopDialog;
  element.issueKey = issueKey;
  element.nextIssueKey = nextIssueKey;
  element.elapsed = elapsed;
  element.commit = commit;
  document.body.append(element);

  const dialog = element.querySelector("dialog");
  if (!dialog) {
    element.remove();

    return Promise.resolve();
  }

  // <dialog>'s close event does not bubble, so this listens on the dialog itself.
  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => {
        element.remove();
        resolve();
      },
      { once: true },
    );
  });
}
```

Delete `isRounding` (now unused). The `comment` getter stays: `confirm()` reads it.

- [ ] **Step 4: Move the POSTs into `commit` in `web/src/timer-state.ts`.**

```ts
/** Asks how to stop the running timer; a confirmed rounding runs `commit`
 *  while the dialog is open. Imported lazily: the dialog is only ever needed
 *  after a click. */
async function askHowToStop(
  nextIssueKey: string | undefined,
  commit: (choice: StopChoice) => Promise<void>,
): Promise<void> {
  const issueKey = running?.issueKey;
  if (issueKey === undefined) return;
  const { confirmStop } = await import("./components/that-stop-dialog");

  await confirmStop(issueKey, nextIssueKey, elapsedSeconds, commit);
}

/** Starting over a running timer stops it first, so it asks how, the same as
 *  a stop does; kept running, nothing starts. */
async function startTimerNow(instanceId: number, issueKey: string): Promise<void> {
  const start = async (choice?: StopChoice): Promise<void> => {
    let response;
    try {
      response = await postStartTimer(instanceId, issueKey, choice);
    } catch (error) {
      // A timer started in another tab is unknown here, so this start went out
      // without a rounding and was refused; re-read it so the next click asks.
      await readTimer().catch(() => undefined);
      throw error;
    }
    setRunning(response.running);
    if (response.stopped) announceEntriesChanged();
  };

  if (running) {
    await askHowToStop(issueKey, start);

    return;
  }
  await start();
}

async function stopTimerNow(): Promise<void> {
  await askHowToStop(undefined, async (choice) => {
    const response = await postStopTimer(choice);
    setRunning(null);
    if (response.stopped) announceEntriesChanged();
  });
}
```

Update the module comment's last paragraph (:15-16) to: "A stop, or a start over a running timer, asks the stop dialog how to round first, and the dialog sends the POST while it is still open, so a failure stays in it (#208)."

- [ ] **Step 5: Run to verify they pass**, with the Step 2 command. Every test in both files green, the existing ones included ("Keep running, or Esc, leaves the timer running", "switching names both tickets…", "a start refused over a timer this tab never saw…").

- [ ] **Step 6: Mutation-prove each assertion added or changed.** One at a time: break, run that one test with `-g`, record the red line, restore, rerun green.
  1. In `confirm()`, close the dialog in a `finally` instead of only after `commit` resolved → "a failed stop keeps the dialog open…" red on the block count / dialog visible.
  2. Drop `this.blocks.add(…)` → same test red on `toHaveCount(1)`.
  3. Replace `error.message` with the fallback string unconditionally → red on `toContainText("Jira said no.")`.
  4. Append `this.blocks` outside the dialog (`this.append(this.blocks)` after `this.append(dialog)`) → red on the Dismiss click in "a retry that fails again…" (inert) or on the block locator.
  5. Remove `this.blocks.attach(dialog)` → red on the geometry assertions.
  6. Remove `this.blocks.clear()` at the top of `confirm()` → "a retry clears the block when it starts…" red on `toHaveCount(0)` while held; "a retry that fails again…" red on `toHaveCount(1)` (two blocks).
  7. In `stopTimerNow`'s commit, call `setRunning(null)` before the POST → "a failed stop…" red on the row still reading "stop timer" / rail containing WORK-1.
  8. In `startTimerNow`, `askHowToStop(issueKey, () => Promise.resolve())` then `await start(choice)` after it — i.e. the old post-after-close shape → "a failed switch…" red on the block count.
  9. Make `keep` call `void this.confirm("up")` → "after a failure, Keep running and Esc still cancel…" red on the dialog count.
  10. In `confirmStop`'s close handler, drop `element.remove()` → red on `that-dialog-blocks` count 0.
  11. The rewritten guard test: revert `confirm()` to closing on failure (mutation 1) → red on the block count.

- [ ] **Step 7: Gates and commit**

```shell
docker compose run --rm --no-deps web npx prettier --write src/components/that-stop-dialog.ts src/timer-state.ts
make verify
git add web/src/components/that-stop-dialog.ts web/src/timer-state.ts .claude/e2e/tests/timer.spec.ts .claude/e2e/tests/timer-guard.spec.ts
git commit -m "#208: a failed stop or switch stays in the dialog, as a block"
```

---

### Task 2: While the POST is out, the dialog is busy

**Files:**
- Modify: `web/src/components/that-stop-dialog.ts` (`confirm()`, a new `setBusy`, a `cancel` listener in `connectedCallback`, fields for `keep` and `busy`)
- Test: `.claude/e2e/tests/timer.spec.ts` (append to Task 1's section)

**Interfaces:**
- Consumes: `ThatStopDialog.confirm(round)` and the `stopBlocks` / `failTimerPost` helpers from Task 1.
- Produces: nothing new outside the component.

- [ ] **Step 1: Write the failing test.** Append to `.claude/e2e/tests/timer.spec.ts`:

```ts
test("while a stop is in flight the buttons are disabled, Esc and Enter do nothing, and a failure enables them again", async ({
  page,
}) => {
  await stubTimer(page, { runningFor: 60 });
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let sent = 0;
  await page.route("**/api/timer/stop", async (route) => {
    sent++;
    await held;
    await route.fulfill({ status: 500, json: { code: "internal_error", message: "Jira said no." } });
  });
  await page.goto("/today");

  const dialog = page.getByRole("dialog");
  const names = ["Keep running", "Discard run", "Log 0:15"];
  await ticketRow(page, "WORK-1").getByRole("button", { name: "stop timer" }).click();
  await dialog.getByRole("button", { name: "Log 0:15" }).click();
  await expect.poll(() => sent).toBe(1);

  for (const name of names) await expect(dialog.getByRole("button", { name })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Description" }).press("Enter");
  // A repaint tick passes: paint() must not re-enable anything.
  await page.waitForTimeout(1100);
  await expect(dialog).toBeVisible();
  for (const name of names) await expect(dialog.getByRole("button", { name })).toBeDisabled();
  expect(sent).toBe(1);

  release();
  await expect(stopBlocks(page)).toHaveCount(1);
  for (const name of names) await expect(dialog.getByRole("button", { name })).toBeEnabled();
  await expect(dialog).toBeVisible();
});
```

(The one `waitForTimeout` is deliberate: the assertion is that something does *not* happen across a 1-second repaint, which no web-first assertion can wait for.)

- [ ] **Step 2: Run to verify it fails**, with `-g "while a stop is in flight"`.
Expected: red on the first `toBeDisabled()` for "Keep running" (received enabled). Quote it.

- [ ] **Step 3: Implement busy**, mirroring `setBusy` in `that-entry-dialog.ts`.

Fields:

```ts
  private keep: HTMLElement | undefined;
  private busy = false;
```

Store `this.keep = keep;` beside `this.down = down;`. In `connectedCallback`, after the dialog is built:

```ts
    // Esc is a cancel; one arriving while a POST is out would close the dialog under it.
    dialog.addEventListener("cancel", (event) => {
      if (this.busy) event.preventDefault();
    });
```

`confirm()` becomes:

```ts
  private async confirm(round: Rounding): Promise<void> {
    if (this.busy) return;
    this.blocks.clear();
    this.setBusy(true);
    try {
      await this.commit({ round, comment: this.comment });
      this.dialog?.close();
    } catch (error) {
      this.blocks.add(
        "error",
        error instanceof ApiError ? error.message : "Could not stop the timer — try again.",
      );
    } finally {
      this.setBusy(false);
    }
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    for (const button of [this.keep, this.down, this.up]) {
      if (busy) button?.setAttribute("disabled", "");
      else button?.removeAttribute("disabled");
    }
  }
```

- [ ] **Step 4: Run to verify it passes**, then the whole of `timer.spec.ts timer-guard.spec.ts` (the Task 1 tests and the existing Esc test must stay green).

- [ ] **Step 5: Mutation-prove.** One at a time, run the test with `-g "while a stop is in flight"`, record red, restore:
  1. `setBusy` skips `this.keep` → red on "Keep running" `toBeDisabled`.
  2. `setBusy` never sets `disabled` on `this.up` → red on "Log 0:15" `toBeDisabled`.
  3. Remove `event.preventDefault()` from the `cancel` listener → red on `expect(dialog).toBeVisible()`.
  4. Remove `if (this.busy) return;` from `confirm()` → red on `expect(sent).toBe(1)` (Enter sends a second).
  5. Remove the `finally { this.setBusy(false); }` → red on the final `toBeEnabled()`.

- [ ] **Step 6: Gates and commit**

```shell
docker compose run --rm --no-deps web npx prettier --write src/components/that-stop-dialog.ts
make verify
git add web/src/components/that-stop-dialog.ts .claude/e2e/tests/timer.spec.ts
git commit -m "#208: the stop dialog is busy while its POST is out"
```

---

### Task 3: Compare against the entry dialog's block, capture the screenshot pair, final gates

**Files:**
- Create, then delete (never committed): `.claude/e2e/tests/zz-capture-208.spec.ts`
- Output (never committed; `test-results/` is gitignored): `.claude/e2e/test-results/shots/` (`/e2e/test-results/shots/` inside the container)

- [ ] **Step 1: Write the throwaway capture spec** `.claude/e2e/tests/zz-capture-208.spec.ts`. It stubs only what the two dialogs need, puts each dialog into its failed state, parks the pointer and blurs focus, and captures the failed-stop block beside the entry dialog's failed-save block in both themes. It also prints each block's measurements against its dialog, which is the comparison:

```ts
import { test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 800 } });

async function stub(page: Page): Promise<void> {
  await page.route("**/api/issues", (r) =>
    r.fulfill({
      status: 200,
      json: {
        instances: [
          {
            id: 1,
            name: "Work",
            issues: [{ key: "WORK-1", summary: "Fix the export", status: "In Progress", url: "" }],
            error: null,
          },
        ],
      },
    }),
  );
  await page.route("**/api/pins**", (r) => r.fulfill({ status: 200, json: [] }));
  await page.route("**/api/entries**", (r) =>
    r.request().method() === "GET"
      ? r.fulfill({ status: 200, json: { today: "2026-10-06", entries: [] } })
      : r.fulfill({ status: 500, json: { code: "internal", message: "Jira said no." } }),
  );
  await page.route("**/api/timer", (r) =>
    r.fulfill({
      status: 200,
      json: {
        running: { instanceId: 1, issueKey: "WORK-1", startedAt: new Date(Date.now() - 7 * 60_000).toISOString() },
        stopped: null,
      },
    }),
  );
  await page.route("**/api/timer/stop", (r) =>
    r.fulfill({ status: 500, json: { code: "internal_error", message: "Jira said no." } }),
  );
}

async function settle(page: Page): Promise<void> {
  await page.mouse.move(1, 1);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

async function measure(page: Page, host: string, label: string): Promise<void> {
  const out = await page.evaluate((selector) => {
    const block = document.querySelector(`${selector} that-dialog-blocks that-toast`);
    const dialog = document.querySelector(`${selector} dialog`)?.getBoundingClientRect();
    if (!block || !dialog) return null;
    const box = block.getBoundingClientRect();
    return {
      gap: Math.round(dialog.top - box.bottom),
      dx: Math.round(box.left - dialog.left),
      dw: Math.round(box.width - dialog.width),
      mark: block.querySelector("[role='img']")?.getAttribute("aria-label"),
      close: block.querySelector("button")?.getAttribute("aria-label"),
    };
  }, host);
  console.log(label, JSON.stringify(out));
}

for (const scheme of ["dark", "light"] as const) {
  test(`failed blocks, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await stub(page);
    await page.goto("/today");

    await page.locator("#rail-timer").getByRole("button", { name: "stop timer" }).click();
    const stop = page.locator("that-stop-dialog dialog");
    await stop.getByRole("textbox", { name: "Description" }).fill("Traced the export");
    await stop.getByRole("button", { name: "Log 0:15" }).click();
    await page.locator("that-stop-dialog that-dialog-blocks that-toast").waitFor();
    await settle(page);
    await measure(page, "that-stop-dialog", `stop ${scheme}`);
    await page.screenshot({ path: `/e2e/test-results/shots/stop-block-${scheme}.png` });
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /Log time against WORK-1/ }).click();
    const entry = page.locator("that-entry-dialog dialog");
    await entry.getByLabel("Duration").fill("130");
    await entry.getByRole("button", { name: "Add entry" }).click();
    await page.locator("that-entry-dialog that-dialog-blocks that-toast").waitFor();
    await settle(page);
    await measure(page, "that-entry-dialog", `entry ${scheme}`);
    await page.screenshot({ path: `/e2e/test-results/shots/entry-block-${scheme}.png` });
  });
}
```

- [ ] **Step 2: Run it** (Firefox, the primary target):

```shell
docker compose --profile e2e rm --stop --force app-e2e
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test zz-capture-208.spec.ts --project=firefox --reporter=line'
docker compose --profile e2e rm --stop --force app-e2e
```

The four images land in `.claude/e2e/test-results/shots/` on the host. Copy `stop-block-dark.png` and `stop-block-light.png` (and the two entry ones, for the comparison) into the session's scratchpad straight away — the next e2e run wipes `test-results/`.

- [ ] **Step 3: Compare against the drawing.** The reference is the entry dialog's failed-save block (`docs/superpowers/specs/2026-09-25-toasts-design.md`, decisions 7–9, and what `entries.spec.ts` pins). The report states, for each of the four properties, what each block measured and whether they match:
  - **Position:** `gap` is 8 for both.
  - **Width:** `dx` and `dw` are 0 (±1) for both — each block is its own dialog's width (440px for the stop dialog, 580px for the entry dialog; the width differs because the dialogs do, which is the design).
  - **Tone mark:** `mark` is `Failed` for both, and in the images the mark is the error tone, the words in ordinary ink.
  - **Close button:** `close` is `Dismiss` for both, the `close` icon at the row's right end in muted ink.

  Look at the four images side by side as well, in both themes: surface, radius, shadow and padding must read the same. Any difference is reported to the owner for the design to be updated, not absorbed.

- [ ] **Step 4: Delete the capture spec**, and confirm nothing of it is staged:

```shell
rm .claude/e2e/tests/zz-capture-208.spec.ts
git status --short    # must list nothing from this task
```

- [ ] **Step 5: Final gates.** Paste both outputs' tails into the report.

```shell
make verify
make test-e2e
```

Both green. No commit in this task. The screenshot pair (`stop-block-dark.png`, `stop-block-light.png`) is attached to the pull request with `.claude/tools/pr-attach.sh` when it is opened, not committed.
