# Timer action guard (#209) Implementation Plan

**Date:** 2026-09-28
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One timer action at a time: a click on stop or start while another start or stop is still in flight does nothing.

**Architecture:** A module-level `inFlight` flag in `web/src/timer-state.ts` wraps the whole of `startTimer` and `stopTimer` — dialog, POST and state update — and is reset in a `finally`. Module-level, so the rail's stop, a row's stop and another row's start all share it.

**Tech Stack:** TypeScript (strict), Playwright e2e.

**Spec:** Codeberg issue #209 (its body is the refined spec).

## Global Constraints

- All commands through `make` or `docker compose`; no Go, Node or npm on the host.
- TypeScript strict with `noUncheckedIndexedAccess`; no `any`, `as any` or non-null assertion in `web/src`.
- Few comments, only the non-obvious why.
- The heading id `that-stop-dialog-heading` stays as it is.
- Out of scope: disabling or restyling buttons while an action is in flight.
- New e2e tests go in a **new** file, `.claude/e2e/tests/timer-guard.spec.ts`: open branches #229 and #237 both append to `timer.spec.ts`, and a third append would conflict.
- Firefox and Chromium both run every test.

## Review Focus

1. **A failed action must release the guard.** A refused start (`postStartTimer` throws) or a failed stop POST must leave the next click working. The existing stale-tab test in `timer.spec.ts` ("a start refused over a timer this tab never saw…") covers the start path; Task 1 adds a failed-stop test.
2. **Keep running releases the guard.** The dialog answering null returns early; the `finally` must still run. Task 1's "after Keep running the next stop opens the dialog" test pins it.
3. **The chunk hold must hold the right chunk.** A route that holds every chunk would stall the view itself. Hold only the chunk whose body contains `that-stop-dialog`, and only its first request.
4. **Two clicks must reach the page as two clicks.** Use two `click()` calls, not `dblclick()`, so each goes through the button's own handler exactly as the ticket describes; assert on the DOM after releasing the chunk, not before.
5. **A guarded call returns quietly.** The row's and rail's click handlers `await` the call; a guarded call must resolve (not reject), so no unhandled rejection or error report appears.

---

### Task 1: The guard and its tests

**Files:**
- Modify: `web/src/timer-state.ts:92-120` (`startTimer`, `stopTimer`)
- Create: `.claude/e2e/tests/timer-guard.spec.ts`

**Interfaces:**
- Consumes: the existing exports of `timer-state.ts`; nothing changes in their signatures.
- Produces: nothing new for other code. `startTimer` and `stopTimer` keep `Promise<void>`; a call made while another is in flight resolves at once without side effects.

- [ ] **Step 1: Write the failing e2e tests**

Create `.claude/e2e/tests/timer-guard.spec.ts`. Read `.claude/e2e/tests/timer.spec.ts` first: copy what these tests need from its `stubTimer`, `stubToday`, `ticketRow` and `railTimer` helpers (they are not exported; copy only the parts used, keep the same route shapes). `stubTimer` must record every POST to start and stop so the tests can count them, and must be able to hold a start POST.

The chunk hold, adapted from `.claude/e2e/tests/router.spec.ts:40-66`. Register it **after** `page.goto`, so the view's own chunks load normally; the service worker is already blocked by `playwright.config.ts` (`serviceWorkers: "block"`), so the route sees the request:

```ts
/** Holds the stop dialog's chunk on its first request until the returned
 *  release is called. Other chunks pass straight through. */
async function holdStopDialogChunk(page: Page): Promise<{ requested: Promise<void>; release: () => void }> {
  const base = process.env["THAT_BASE_URL"] ?? "http://that-e2e:8080";
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markRequested: () => void = () => {};
  const requested = new Promise<void>((resolve) => {
    markRequested = resolve;
  });
  let held = false;
  await page.route("**/chunk-*.js", async (route) => {
    const url = new URL(route.request().url());
    const response = await fetch(`${base}${url.pathname}${url.search}`);
    const body = await response.text();
    if (!held && body.includes("that-stop-dialog")) {
      held = true;
      markRequested();
      await released;
    }
    await route.fulfill({
      status: response.status,
      body,
      contentType: response.headers.get("content-type") ?? "text/javascript",
    });
  });
  return { requested, release };
}
```

If the dialog chunk was already loaded before the route is registered (for example because a view imports it eagerly), `requested` never resolves: the test must fail loudly then, so await `requested` with Playwright's default timeout rather than skipping.

Tests (each starts from a timer already running on WORK-1, as `stubTimer(page, { runningFor: 60 })` does in `timer.spec.ts`):

1. `"two clicks on a row's stop while the dialog first loads open one dialog"` — goto `/today`; `holdStopDialogChunk`; click WORK-1's `stop timer` button twice; await `requested`; `release()`; then `await expect(page.locator("that-stop-dialog")).toHaveCount(1)` and `await expect(page.locator("#that-stop-dialog-heading")).toHaveCount(1)`. Also wait for the dialog heading to be visible before counting, so the count is not read before the dialog exists.
2. `"two clicks on the rail's stop while the dialog first loads open one dialog"` — the same with the rail's stop button (`railTimer(page).getByRole("button", { name: "stop timer" })`).
3. `"a row's stop clicked while the rail's dialog is loading opens nothing more"` — click the rail's stop, await `requested`, click WORK-1's row stop, `release()`, count one dialog and one heading.
4. `"while a start's POST is held, a click on another row's play sends nothing"` — no timer running (`stubTimer(page)`); hold the first start POST in the stub until released; click WORK-1's `start timer`; wait until the stub has seen the POST; click WORK-2's `start timer`; release; `await expect.poll(() => recorder.starts.length).toBe(1)` and, after the rail shows WORK-1 running, assert it is still 1.
5. `"after Keep running, the next stop opens the dialog again"` — click stop, wait for the dialog, press `Keep running` (the dialog's button; see `timer.spec.ts`'s "Keep running, or Esc" test), then click stop again and expect the dialog heading visible.
6. `"after a failed stop, the next stop opens the dialog again"` — make the stub answer the first stop POST with a 500; click stop, choose a rounding in the dialog, then click stop again and expect the dialog heading visible.

- [ ] **Step 2: Run them to verify they fail**

```shell
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/timer-guard.spec.ts'
```

(Check the Makefile's `test-e2e` target for the exact command that brings `app-e2e` up first, and use it.)

Expected: tests 1–4 FAIL (two dialogs, two headings, two start POSTs). Tests 5 and 6 may already pass: they guard the reset and must stay green after the change. Record the failing lines in the report.

- [ ] **Step 3: Write the guard**

In `web/src/timer-state.ts`, below `let tickHandle…`:

```ts
// One start or stop at a time, dialog through POST: a second click while the
// dialog chunk loads or a POST is out would open a second dialog or send a
// start this tab cannot round (#209).
let inFlight = false;

async function oneAtATime(action: () => Promise<void>): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    await action();
  } finally {
    inFlight = false;
  }
}
```

Rename the existing bodies to private `startTimerNow` / `stopTimerNow` (unchanged), and export:

```ts
export function startTimer(instanceId: number, issueKey: string): Promise<void> {
  return oneAtATime(() => startTimerNow(instanceId, issueKey));
}

export function stopTimer(): Promise<void> {
  return oneAtATime(stopTimerNow);
}
```

Keep the existing JSDoc on the start function with `startTimerNow`.

- [ ] **Step 4: Run the tests to verify they pass**

The same command as Step 2. Expected: all six PASS in both browsers. Then run the existing timer suite, which holds the stale-tab test:

```shell
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/timer.spec.ts tests/timer-guard.spec.ts'
```

- [ ] **Step 5: Run the gates**

```shell
make verify
make test-e2e
```

Expected: `verify: OK`; the e2e summary with 0 failed.

- [ ] **Step 6: Commit**

```shell
git add web/src/timer-state.ts .claude/e2e/tests/timer-guard.spec.ts
git commit -m "One timer start or stop at a time (#209)"
```

If signing fails (1Password locked), commit with `git -c commit.gpgsign=false commit …` and say so. Never push.
