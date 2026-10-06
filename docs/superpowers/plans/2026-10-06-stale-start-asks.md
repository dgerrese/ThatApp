# A stale tab's start asks to switch, and a failed start is a toast — Implementation Plan

**Date:** 2026-10-06
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tab that never saw a timer started elsewhere opens the switch dialog on the *first* click instead of failing silently, and any other failed start reports in an error toast, the way a failed pin does (#207).

**Architecture:** `that-timer.ts`'s swallowing catch becomes `toast("error", messageOf(error))`, the exact call `undoOptimisticMark` in `views/today.ts` makes for a failed pin. In `timer-state.ts`, `startTimerNow` stops re-reading the timer on every refused start (#185); instead, only a **400** to a start sent with no rounding re-reads it and decides: this ticket is now running → done; another is running → call `startTimerNow` again, which now takes its running branch and opens the switch dialog, retrying through #208's `commit`; nothing running → rethrow (so it toasts). The retry is structurally single: the second call cannot reach the catch, because it only sends a start from inside the dialog, with a rounding.

**Tech Stack:** TypeScript (vanilla, light-DOM WebComponents), Playwright (Firefox and Chromium).

**Spec:** Codeberg issue #207 (refined and approved; its Approach and Acceptance criteria are binding) and `docs/superpowers/specs/2026-09-25-toasts-design.md`, decisions 2 (a failed timer start is a toast), 4 (an error toast stays until closed) and 10 (the wording is `messageOf`'s, unchanged). Built on #208 (this branch's base, plan `docs/superpowers/plans/2026-10-06-failed-stop-dialog-block.md`): `confirmStop(issueKey, nextIssueKey, elapsed, commit)` runs `commit(choice)` before closing, shows a failure as one dialog block, and always *resolves* on close — it never rejects.

## Global Constraints

- All tooling through `make` or `docker compose`; never Go, Node or npm on the host. Read `THAT_PORT` from `.env` before pointing anything at the dev stack; never assume it. (The e2e rig below brings up its own `app-e2e` and needs no port.)
- No JavaScript frameworks; no new dependencies. Light DOM, never shadow DOM.
- Firefox and Chromium only.
- Reuse, do not re-implement: `toast` from `web/src/toast.ts`, `messageOf` from `web/src/alert.ts`, `ApiError` from `web/src/api.ts`, `readTimer`/`isRunningTicket`/`askHowToStop` in `web/src/timer-state.ts`, and in `timer.spec.ts` the existing `stubTimer`, `ticketRow`, `railTimer`, `stopBlocks` and `failTimerPost` helpers.
- **Wording:** the toast's text is `messageOf(error)`, unchanged — no new copy anywhere. The tone is `error`.
- **No change** to `views/today.ts`, `that-stop-dialog.ts`, `toast.ts`, `alert.ts` or any server code.
- **TDD, per task.** RED must fail on an assertion, for the reason the test names — not a compile error, not a timeout waiting for an element a typo hides. The task report quotes the RED failure line. A test written as a guard that passes before the change (each is marked *guard* below) is instead proven entirely by mutation. Then **every assertion the task adds or changes is proven by mutation**: break the guarded code by hand, run that one test, show it red, restore, show it green. The report lists each mutation and its red line.
- Do not run Prettier on `.claude/e2e/` (no config there). For `web/src`: `docker compose run --rm --no-deps web npx prettier --write <files>`.
- Running the timer specs (the rig's own disposable app; always clean up around it):

  ```shell
  docker compose --profile e2e rm --stop --force app-e2e
  docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test timer.spec.ts timer-guard.spec.ts --reporter=line'
  docker compose --profile e2e rm --stop --force app-e2e
  ```

  Add `-g "<test title fragment>"` to run one test (used for every mutation run).
- Commits: if `git commit` fails on signing, retry with `git -c commit.gpgsign=false commit …`. Never push.

## Rulings made before execution (the controller's, reversible)

1. **"Refused" means HTTP 400.** The server's only refusal of a start for a missing rounding is `400 invalid_request` (`internal/server/timer.go:167`); its `code` is shared with every other malformed-body 400, so the gate is `error instanceof ApiError && error.status === 400`, not the code or the message text. Every other failure (500, network `status 0`, `instance_not_found`) rethrows without a re-read, as the ticket requires.
2. **A re-read that itself fails rethrows the original start error**, so the toast names the start's failure, not the read's — the same `readTimer().catch(() => undefined)` the #185 code uses today.
3. **A failed switch inside the dialog no longer re-reads the timer.** The ticket says the new path *replaces* #185's re-read in `start`; that re-read also ran after a failed in-dialog switch (#208's Review Focus 2 mentions it). Nothing in #208's tests depends on it, and a stale tab switching the wrong timer is #226's.
4. **The rail's stop catch keeps swallowing**, but its comment, which justifies itself by pointing at `that-timer.ts`'s catch, is reworded so it no longer cites a catch that now toasts. The rail only stops, and a failed stop already reports in the dialog (#208).
5. **The re-read-finds-nothing toast carries the 400's own message** (today the server's `a timer is running: round is required to stop it`). Decision 10 says `messageOf`'s text unchanged; this case needs the other tab to stop its timer between our 400 and our re-read, so it is left as is.

## Review Focus

1. **A 500 in a stale tab must not open the switch dialog.** Another tab's timer runs, this tab does not know, and the start fails for a reason other than the missing rounding: one toast, no dialog — Task 2's "a stale tab's start that fails for another reason" pins it.
2. **A refused start that names this very ticket must stay quiet and leave the button usable**: no dialog, no toast, the row shows stop, and the next click is a plain stop ("Stop the timer?") because `oneAtATime` has released — Task 2's same-ticket test clicks stop afterwards.
3. **No loop** when the server keeps refusing and the re-read keeps saying nothing runs: exactly one start request and one toast — Task 2's "re-read finds nothing" test counts requests at the moment the toast shows.
4. **No double report**: a switch that fails in the dialog shows a block, and closing the dialog with Keep running or Esc must not then produce a toast — Task 1's guard test, settled by reopening the dialog before counting toasts (a late toast would otherwise land after a premature count).
5. **The successful stale switch sends exactly two starts** (the refused one, then the one with the rounding) and ends with the clicked ticket running — Task 2's first test.

---

### Task 1: Any failed start is an error toast

**Files:**
- Modify: `web/src/components/that-timer.ts` (imports :1-2; `toggle`'s catch :115-123)
- Modify: `web/src/rail.ts` (the comment in `handleStopTimer`'s catch, :346-350 — wording only)
- Test: `.claude/e2e/tests/timer.spec.ts` (append a `#207` section at the end of the file)

**Interfaces:**
- Consumes: `toast(tone: Tone, message: string): void` from `web/src/toast.ts`; `messageOf(error: unknown): string` from `web/src/alert.ts`.
- Produces: nothing new. Task 2 relies on `that-timer` turning any rejection of `startTimer` into one error toast.

- [ ] **Step 1: Write the failing test and the guard.** Append to `.claude/e2e/tests/timer.spec.ts` (after the #208 section, so `failTimerPost` and `stopBlocks` are already declared):

```ts
/**
 * #207: a start that fails reports in an error toast, the way a failed pin
 * does (the toasts design, decisions 2, 4 and 10) — except a switch whose
 * start fails inside the dialog, which #208's block already reports.
 */
const errorToasts = (page: Page) => page.locator("that-toasts that-toast[tone='error']");

test("a start the server refuses with nothing running shows one error toast and leaves the button on start", async ({
  page,
}) => {
  await stubTimer(page);
  await failTimerPost(page, "start");
  await page.goto("/today");

  const start = ticketRow(page, "WORK-2").getByRole("button", { name: "start timer" });
  await start.click();

  await expect(errorToasts(page)).toHaveCount(1);
  await expect(errorToasts(page)).toContainText("Jira said no.");
  await expect(page.locator("that-toast")).toHaveCount(1);
  await expect(start).toBeVisible();
  await expect(railTimer(page)).toContainText("No timer running");
});

test("a switch that fails in the dialog shows the block and no toast, after Keep running or Esc too", async ({
  page,
}) => {
  await stubTimer(page);
  await page.goto("/today");

  const first = ticketRow(page, "WORK-1");
  const second = ticketRow(page, "WORK-2");
  await first.getByRole("button", { name: "start timer" }).click();
  await expect(first.getByRole("button", { name: "stop timer" })).toBeVisible();

  await failTimerPost(page, "start", 2);
  const dialog = page.getByRole("dialog");
  const heading = dialog.getByRole("heading");

  await second.getByRole("button", { name: "start timer" }).click();
  await dialog.getByRole("button", { name: "Log 0:15" }).click();
  await expect(stopBlocks(page)).toHaveCount(1);
  await dialog.getByRole("button", { name: "Keep running" }).click();
  await expect(dialog).toHaveCount(0);

  // Reopening proves the click's promise has settled, so a toast it would
  // raise is already in the host before the count below.
  await second.getByRole("button", { name: "start timer" }).click();
  await expect(heading).toHaveText("Stop WORK-1 and start WORK-2?");
  await expect(page.locator("that-toast")).toHaveCount(0);

  await dialog.getByRole("button", { name: "Log 0:15" }).click();
  await expect(stopBlocks(page)).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await second.getByRole("button", { name: "start timer" }).click();
  await expect(heading).toHaveText("Stop WORK-1 and start WORK-2?");
  await expect(page.locator("that-toast")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Keep running" }).click();
  await expect(first.getByRole("button", { name: "stop timer" })).toBeVisible();
});
```

- [ ] **Step 2: Run both; the first must fail, the second (a *guard*) passes.**

Run the two with `-g "start the server refuses|switch that fails in the dialog"` via the command in Global Constraints.
Expected: "a start the server refuses…" FAILS on `expect(errorToasts(page)).toHaveCount(1)` — received 0, because `that-timer.ts` swallows the rejection. Quote that line. "a switch that fails in the dialog…" PASSES (it guards against a double report; it is proven by mutation in Step 5).

- [ ] **Step 3: Implement.** In `web/src/components/that-timer.ts`, add the imports:

```ts
import { messageOf } from "../alert";
import { iconMarkup } from "../icons";
import { toast } from "../toast";
import { isRunningTicket, onTimerChanged, startTimer, stopTimer } from "../timer-state";
```

Replace the catch in `toggle()`:

```ts
    } catch (error) {
      // The button paints from isRunningTicket() alone, so a failure left
      // nothing here to revert; it only needs naming, the way a failed pin
      // is (#207). A stop or switch the dialog sent never lands here: it
      // reports in the dialog and resolves on close (#208).
      toast("error", messageOf(error));
    }
```

In `web/src/rail.ts`, `handleStopTimer`, replace the catch's comment (keep the empty arrow body):

```ts
    void stopTimer().catch(() => {
      // A failed stop already reports in the dialog (#208) and resolves; this
      // only meets a dialog chunk that would not load. The region paints from
      // currentTimer() alone, so a failed call changed nothing, and left
      // uncaught this would surface as an unhandled promise rejection.
    });
```

Then: `docker compose run --rm --no-deps web npx prettier --write web/src/components/that-timer.ts web/src/rail.ts`.

- [ ] **Step 4: Run both tests; both pass.** Then run the whole of `timer.spec.ts timer-guard.spec.ts`; all pass.

- [ ] **Step 5: Mutation-prove every assertion added.** One test run per mutation, red, restore, green:
  - `toast("error", messageOf(error))` → `toast("error", "x")`: the first test fails on `toContainText("Jira said no.")`.
  - `toast("error", …)` → `toast("warning", …)`: the first test fails on `errorToasts(page)).toHaveCount(1)`.
  - Call `toast` twice in the catch: the first test fails on `page.locator("that-toast")).toHaveCount(1)`.
  - In `timer-state.ts` `startTimerNow`, call `setRunning({ instanceId, issueKey, startedAt: new Date().toISOString() })` at the top of `start`, before the POST (an optimistic paint): the first test fails on `start` visible, and — run again with that assertion commented out — on the rail's "No timer running".
  - In `web/src/components/that-stop-dialog.ts` `confirmStop`, make the promise reject on close (`new Promise((resolve, reject) => …)`, `resolve()` → `reject(new Error("closed"))`): the guard fails on the first `page.locator("that-toast")).toHaveCount(0)`, after Keep running.
  - Reject only on a close that Esc caused (set a flag in a `cancel` listener on the dialog; reject in the close handler when it is set, resolve otherwise): the guard passes the Keep-running count and fails on the second `that-toast` count 0, after Esc.

- [ ] **Step 6: Commit.**

```bash
git add web/src/components/that-timer.ts web/src/rail.ts .claude/e2e/tests/timer.spec.ts
git commit -m "#207: a failed start is an error toast, as a failed pin is"
```

---

### Task 2: A stale tab's refused start re-reads and asks to switch

**Files:**
- Modify: `web/src/timer-state.ts` (import :19; `startTimerNow` :112-135)
- Test: `.claude/e2e/tests/timer.spec.ts` — **delete** the #185 test "a start refused over a timer this tab never saw re-reads it, so the next click asks to switch" (:448-475 with its comment), and append the tests below to the `#207` section.

**Interfaces:**
- Consumes: `confirmStop`'s contract from #208 via `askHowToStop(nextIssueKey, commit)`: resolves on close, never rejects; Task 1's toast for any rejection reaching `that-timer`.
- Produces: `startTimer(instanceId: number, issueKey: string): Promise<void>` — signature unchanged.

- [ ] **Step 1: Write the failing tests.** Delete the #185 test named above. Append to the `#207` section of `.claude/e2e/tests/timer.spec.ts`:

```ts
/** This tab's boot read says nothing runs, while the stub's timer does. */
async function staleBootRead(page: Page): Promise<void> {
  await page.route(
    "**/api/timer",
    (route) => route.fulfill({ status: 200, json: { running: null, stopped: null } }),
    { times: 1 },
  );
}

test("in a tab that never saw the running timer, the first click on start asks to switch, and confirming switches", async ({
  page,
}) => {
  const recorder = await stubTimer(page, { runningFor: 60 });
  await staleBootRead(page);
  await page.goto("/today");
  await expect(railTimer(page)).toContainText("No timer running");

  await ticketRow(page, "WORK-2").getByRole("button", { name: "start timer" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading")).toHaveText("Stop WORK-1 and start WORK-2?");
  await dialog.getByRole("button", { name: "Log 0:15" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(ticketRow(page, "WORK-2").getByRole("button", { name: "stop timer" })).toBeVisible();
  await expect(railTimer(page)).toContainText("WORK-2");
  expect(recorder.starts).toEqual([
    expect.not.objectContaining({ round: expect.anything() }),
    expect.objectContaining({ issueKey: "WORK-2", round: "up" }),
  ]);
  await expect(page.locator("that-toast")).toHaveCount(0);
});

test("in a stale tab, a start for the ticket already running elsewhere shows stop and asks nothing", async ({
  page,
}) => {
  const recorder = await stubTimer(page, { runningFor: 60 });
  await staleBootRead(page);
  await page.goto("/today");
  await expect(railTimer(page)).toContainText("No timer running");

  const row = ticketRow(page, "WORK-1");
  await row.getByRole("button", { name: "start timer" }).click();
  await expect(row.getByRole("button", { name: "stop timer" })).toBeVisible();

  // The next click is a plain stop: no switch dialog was left open, and the
  // first click's work is finished.
  await row.getByRole("button", { name: "stop timer" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading")).toHaveText("Stop the timer?");
  await dialog.getByRole("button", { name: "Keep running" }).click();

  expect(recorder.starts.length).toBe(1);
  await expect(page.locator("that-toast")).toHaveCount(0);
});

test("a refused start whose re-read finds nothing running reports once and sends no second start", async ({
  page,
}) => {
  await stubTimer(page);
  let starts = 0;
  await page.route("**/api/timer/start", (route) => {
    starts += 1;
    return route.fulfill({
      status: 400,
      json: { code: "invalid_request", message: "a timer is running: round is required to stop it" },
    });
  });
  await page.goto("/today");

  const start = ticketRow(page, "WORK-2").getByRole("button", { name: "start timer" });
  await start.click();

  await expect(page.locator("that-toasts that-toast[tone='error']")).toHaveCount(1);
  expect(starts).toBe(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(start).toBeVisible();
});

test("a stale tab's start that fails for another reason reports in a toast and does not ask", async ({ page }) => {
  await stubTimer(page, { runningFor: 60 });
  await staleBootRead(page);
  await failTimerPost(page, "start");
  await page.goto("/today");
  await expect(railTimer(page)).toContainText("No timer running");

  await ticketRow(page, "WORK-2").getByRole("button", { name: "start timer" }).click();

  await expect(page.locator("that-toasts that-toast[tone='error']")).toContainText("Jira said no.");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("in a stale tab, a switch whose retry fails shows the block, sends two starts and no third", async ({
  page,
}) => {
  const recorder = await stubTimer(page, { runningFor: 60 });
  await staleBootRead(page);
  await page.goto("/today");
  await expect(railTimer(page)).toContainText("No timer running");

  await ticketRow(page, "WORK-2").getByRole("button", { name: "start timer" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading")).toHaveText("Stop WORK-1 and start WORK-2?");

  let retries = 0;
  await page.route("**/api/timer/start", (route) => {
    retries += 1;
    return route.fulfill({ status: 500, json: { code: "internal_error", message: "Jira said no." } });
  });
  await dialog.getByRole("button", { name: "Log 0:15" }).click();
  await expect(stopBlocks(page)).toHaveCount(1);
  await dialog.getByRole("button", { name: "Keep running" }).click();
  await expect(dialog).toHaveCount(0);

  expect(recorder.starts.length + retries).toBe(2);
  await expect(page.locator("that-toast")).toHaveCount(0);
  await expect(railTimer(page)).toContainText("WORK-1");
});
```

- [ ] **Step 2: Run the five; expect each failure for its named reason.** Run with `-g "stale tab|never saw the running timer|re-read finds nothing"`.
Expected:
  - "…the first click on start asks to switch…" FAILS on `toHaveText("Stop WORK-1 and start WORK-2?")` — the first click only re-reads (#185), so no dialog opens. Quote it.
  - "…the ticket already running elsewhere…" FAILS on the final `that-toast` count 0 (received 1): #185's re-read already repaints the row to stop, but then rethrows the 400, which Task 1 toasts. Quote it.
  - "…re-read finds nothing…" PASSES today (*guard*: #185 rethrows after one re-read; Task 1 toasts). Proven by mutation in Step 5.
  - "…fails for another reason…" PASSES today (*guard*: #185 re-reads and rethrows, and the second click is never made). Proven by mutation in Step 5.
  - "…a switch whose retry fails…" FAILS on the heading `toHaveText` — no dialog on the first click.

- [ ] **Step 3: Implement.** In `web/src/timer-state.ts`, extend the import:

```ts
import { ApiError, getTimer, startTimer as postStartTimer, stopTimer as postStopTimer } from "./api";
```

Replace `startTimerNow` whole:

```ts
/** Starting over a running timer stops it first, so it asks how, the same as
 *  a stop does; kept running, nothing starts. */
async function startTimerNow(instanceId: number, issueKey: string): Promise<void> {
  const start = async (choice?: StopChoice): Promise<void> => {
    const response = await postStartTimer(instanceId, issueKey, choice);
    setRunning(response.running);
    if (response.stopped) announceEntriesChanged();
  };

  if (running) {
    await askHowToStop(issueKey, start);

    return;
  }
  try {
    await start();
  } catch (error) {
    // A 400 to a start with no rounding means a timer this tab never saw is
    // running. Re-read it and ask, so the first click is not a silent no-op
    // (#207). The second call takes the branch above, so it retries at most once.
    if (!(error instanceof ApiError && error.status === 400)) throw error;
    await readTimer().catch(() => undefined);
    if (isRunningTicket(instanceId, issueKey)) return;
    if (!running) throw error;
    await startTimerNow(instanceId, issueKey);
  }
}
```

It calls the inner `startTimerNow`, never the exported `startTimer`: the export is wrapped in `oneAtATime`, which returns at once while `inFlight` is true. Then `docker compose run --rm --no-deps web npx prettier --write web/src/timer-state.ts`.

- [ ] **Step 4: Run the five; all pass.** Then the whole of `timer.spec.ts timer-guard.spec.ts`; all pass (in particular #208's "a failed switch keeps the dialog open…" and every `timer-guard` test).

- [ ] **Step 5: Mutation-prove every assertion added.** One test run per mutation, red, restore, green:
  - Delete `await startTimerNow(instanceId, issueKey);` (fall through, resolve): "…asks to switch…" red on the heading.
  - Replace `await startTimerNow(instanceId, issueKey)` with `await askHowToStop(issueKey, () => start())` (retry without the rounding): "…asks to switch…" red on `recorder.starts` (second start lacks `round: "up"`), and the stub's 400 shows a block.
  - Delete `if (isRunningTicket(instanceId, issueKey)) return;`: "…already running elsewhere…" red (a "Stop WORK-1 and start WORK-1?" dialog is open, so the stop click or the "Stop the timer?" heading fails).
  - Replace `if (isRunningTicket(…)) return;` with `if (isRunningTicket(…)) throw error;`: "…already running elsewhere…" red on the `that-toast` count 0.
  - Replace `if (!running) throw error;` with nothing, and make the recursion unconditional by calling `await startTimerNow(instanceId, issueKey)` even when `running` is null: "…re-read finds nothing…" red on `expect(starts).toBe(1)` (or the toast count). Stop the test run if it hangs; a timeout here is the loop, and is the red.
  - Drop the status gate (`if (!(error instanceof ApiError)) throw error;`): "…fails for another reason…" red — the 500's re-read finds WORK-1 and the switch dialog opens, so no toast.
  - In the running branch, retry a failed commit once more: `askHowToStop(issueKey, async (choice) => { try { await start(choice); } catch { await start(choice); } })`: "…a switch whose retry fails…" red on `recorder.starts.length + retries` (3).
  - The same test's `that-toast` count 0 and rail "WORK-1": make `askHowToStop`'s caller in the stale path `throw error` after `await startTimerNow(…)` returns: red on the toast count. For the rail line, call `setRunning(null)` after that `await` instead: red on "WORK-1".
  - "…asks to switch…"'s `that-toast` count 0: the same `throw error` after `await startTimerNow(…)`: red on the count.

- [ ] **Step 6: Commit.**

```bash
git add web/src/timer-state.ts .claude/e2e/tests/timer.spec.ts
git commit -m "#207: a stale tab's refused start re-reads the timer and asks to switch"
```

---

### Task 3: Compare against a failed pin's toast, capture the screenshot pair, final gates

**Files:**
- Create, then delete (never committed): `.claude/e2e/tests/zz-capture-207.spec.ts`
- Output (never committed; `test-results/` is gitignored): `.claude/e2e/test-results/shots/` (`/e2e/test-results/shots/` inside the container)

- [ ] **Step 1: Write the throwaway capture spec** `.claude/e2e/tests/zz-capture-207.spec.ts`. It raises a failed pin's toast, measures and captures it, dismisses it, then raises a failed start's toast and does the same, in both themes, at rest (pointer parked, focus blurred):

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
  await page.route("**/api/pins**", (r) =>
    r.request().method() === "GET"
      ? r.fulfill({ status: 200, json: [] })
      : r.fulfill({ status: 502, json: { code: "jira_error", message: "Jira did not take the pin." } }),
  );
  await page.route("**/api/entries**", (r) =>
    r.fulfill({ status: 200, json: { today: "2026-10-06", entries: [] } }),
  );
  await page.route("**/api/timer", (r) => r.fulfill({ status: 200, json: { running: null, stopped: null } }));
  await page.route("**/api/timer/start", (r) =>
    r.fulfill({ status: 500, json: { code: "internal_error", message: "Jira said no." } }),
  );
}

async function settle(page: Page): Promise<void> {
  await page.mouse.move(1, 1);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

async function measure(page: Page, label: string): Promise<void> {
  const out = await page.evaluate(() => {
    const toast = document.querySelector("that-toasts that-toast");
    if (!toast) return null;
    const box = toast.getBoundingClientRect();
    return {
      tone: toast.getAttribute("tone"),
      right: Math.round(innerWidth - box.right),
      bottom: Math.round(innerHeight - box.bottom),
      width: Math.round(box.width),
      mark: toast.querySelector("[role='img']")?.getAttribute("aria-label"),
      close: toast.querySelector("button")?.getAttribute("aria-label"),
      text: toast.textContent?.trim(),
    };
  });
  console.log(label, JSON.stringify(out));
}

for (const scheme of ["dark", "light"] as const) {
  test(`failed toasts, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await stub(page);
    await page.goto("/today");

    await page.getByRole("button", { name: "Pin WORK-1", exact: true }).click();
    await page.locator("that-toasts that-toast").waitFor();
    await settle(page);
    await measure(page, `pin ${scheme}`);
    await page.screenshot({ path: `/e2e/test-results/shots/pin-toast-${scheme}.png` });
    await page.locator("that-toasts that-toast").getByRole("button", { name: "Dismiss" }).click();
    await page.locator("that-toasts that-toast").waitFor({ state: "detached" });

    await page.locator("that-ticket-row", { hasText: "WORK-1" }).getByRole("button", { name: "start timer" }).click();
    await page.locator("that-toasts that-toast").waitFor();
    await settle(page);
    await measure(page, `start ${scheme}`);
    await page.screenshot({ path: `/e2e/test-results/shots/start-toast-${scheme}.png` });
  });
}
```

- [ ] **Step 2: Run it** (Firefox, the primary target):

```shell
docker compose --profile e2e rm --stop --force app-e2e
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test zz-capture-207.spec.ts --project=firefox --reporter=line'
docker compose --profile e2e rm --stop --force app-e2e
```

The four images land in `.claude/e2e/test-results/shots/` on the host. Copy `start-toast-dark.png` and `start-toast-light.png` (and the two pin ones, for the comparison) into the session's scratchpad straight away — the next e2e run wipes `test-results/`.

- [ ] **Step 3: Compare against the drawing.** The reference is a failed pin's toast (`docs/superpowers/specs/2026-09-25-toasts-design.md`, decisions 2 and 4; `toast.spec.ts` pins the geometry and anatomy). The report states, for each of the four properties, what each toast measured and whether they match:
  - **Position:** `right` and `bottom` are 16 for both (bottom-right, 16px from the edges).
  - **Width:** `width` is the same for both (±1) — the host's own width, not the message's.
  - **Tone mark:** `tone` is `error` and `mark` is `Failed` for both; in the images the mark is the error tone, the words in ordinary ink.
  - **Close button:** `close` is `Dismiss` for both, the close icon at the row's right end; and neither toast has left after 4 seconds (decision 4) — the start toast was captured after the pin's dismiss, so look that the pin toast was still there when dismissed.

  Look at the four images side by side as well, in both themes: surface, radius, shadow and padding must read the same. Any difference is reported to the owner for the design to be updated, not absorbed.

- [ ] **Step 4: Delete the capture spec**, and confirm nothing of it is staged:

```shell
rm .claude/e2e/tests/zz-capture-207.spec.ts
git status --short    # must list nothing from this task
```

- [ ] **Step 5: Final gates.** Paste both outputs' tails into the report.

```shell
make verify
make test-e2e
```

Both green. No commit in this task. The screenshot pair (`start-toast-dark.png`, `start-toast-light.png`) is attached to the pull request with `.claude/tools/pr-attach.sh` when it is opened, not committed.
