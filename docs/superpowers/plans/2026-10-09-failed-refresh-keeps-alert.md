# A failed issues read keeps its alert — Implementation Plan

**Date:** 2026-10-09
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On Today, once an issues read has failed, no later redraw from the last good response replaces its error alert with the old cards, until an issues read succeeds again (#305).

**Architecture:** `Regions` gains `issuesFailed`. `refreshResults` sets it in its catch and clears it on success, before its own `renderResponse`. `renderResponse` is the one function its three callers (`refreshResults`, `refreshPins`, `undoOptimisticMark`) route through, so the guard sits at its top: while the flag is set it redraws only the off-list section and returns, leaving `results` (the alert) alone. `lastIssues` and `stackOf` are not touched.

**Tech Stack:** TypeScript (vanilla, light-DOM `that-*` components); Playwright (Firefox and Chromium).

**Spec:** Codeberg #305. Its body, refined on 2026-10-09, is binding. No design document describes the redraw after a failed read (checked: nothing under `docs/superpowers/specs/` mentions it), so no document changes and nothing on screen changes beyond the existing alert staying. No screenshots.

## Global Constraints

- All tooling goes through `make` or `docker compose`. Never run Node or npm on the host. Nothing here needs the dev stack. If you open it anyway, read `THAT_PORT` from `.env`; do not assume a port.
- Vanilla TS with `strict` + `noUncheckedIndexedAccess`. No `any`, no `as any`, no `!`. Light DOM only. No new dependency and no new `THAT_*` variable.
- Firefox and Chromium only. Never add WebKit.
- Keep comments few: a non-obvious why only.
- **The failure stays reported by the inline alert.** No toast for it, no stale banner instead of it (ticket, *Out of scope*).
- **TDD.** RED must fail on an **assertion**, for the reason the test names. Never a compile error, never a timeout on a typo'd locator or on a line marked `// wait`. The task report quotes the RED lines.
- **Guard tests.** A test marked *guard* passes before the change and is proven entirely by mutation.
- **Every assertion the task adds is proven by mutation.** Break the guarded code by hand, run that one test, show the named line red, restore, show it green. The report lists each mutation with its red line. Assertions after a sync point use `expect.soft`, so each line is reachable under its own mutation. Lines marked `// wait` only synchronise. They are not guards.
- Commands:

  ```shell
  # Prettier on web/src only (never on .claude/e2e — it has no config)
  docker compose run --rm --no-deps web npx prettier --write src/views/today.ts
  # Type check, lint
  make tsc
  make lint
  # One e2e spec — the rig's own disposable app-e2e; always clean up around it
  docker compose --profile e2e rm --stop --force app-e2e
  docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test failed-refresh.spec.ts --reporter=line'
  docker compose --profile e2e rm --stop --force app-e2e
  ```

  Swap the spec name for `instance-stacks.spec.ts`, `today.spec.ts` or `pins.spec.ts` as a step says. Add `-g "<title fragment>"` to run one test (every mutation run).
- Commits: if `git commit` fails on signing (a locked 1Password vault), retry the same commit with `git -c commit.gpgsign=false commit …` and carry on. Note the last signed commit in the report. **Never push.** Never merge into `main`.
- Branch: `issue-305-failed-refresh-keeps-alert`, already checked out. Do not switch, stash or reset.
- This plan does not touch `docs/superpowers/plans/handoff.md`.

## Rulings made before execution

The ticket decides the behaviour; these are the places it is silent. They are the controller's rulings, and the owner can reverse any of them.

1. **The tests order the two answers on purpose.** Every pin and unpin test first lets Refresh's pins answer land (it adds a pin, so it shows in Pinned) and only then releases the failing issues answer. Without that order, the pins answer landing second would wipe the alert before the test pins anything — and on the unfixed code the RED would be a timeout on a `// wait` line, not an assertion. That same helper is the reverse-order test.
2. **One failing-write test, the pin from an off-list row.** A failed pin and a failed unpin both go through `undoOptimisticMark`, so they share the guarded line. The off-list row is the one whose undone mark proves the off-list section was redrawn, which a failed unpin in Pinned cannot (`renderPinnedList` restores that row on its own).
3. **The network returning gets the same test as Refresh.** Both run `refreshEverything`. The tab regaining focus is not tested separately: it runs only while the stale banner shows, and it is the same `refreshEverything` call.
4. **The re-stacking check lives in `instance-stacks.spec.ts`,** which already has the stack helpers: a Refresh that succeeds after a failed one places the cards afresh. It is a guard test.
5. **The guarded branch calls `renderOffListSection` directly** rather than skipping only the card drawing further down. `renderResponse`'s other work (layout grid, Refresh's visibility, the cards, key column, stacks, totals) all belongs to the cards that must not come back. `renderOffListSection` paints its own totals.

## Review Focus

1. **The network coming back while the issues read still fails, with the pins answer landing after it.** The alert must stay. "the network returning … keeps its alert…" in Task 1 (the same test as Refresh, run for both triggers).
2. **An unpin while the alert stands, for a ticket that has time logged today.** It must come back in "Logged today, not on your list", and an assigned ticket's time must not: off-list is judged against the last good response, not against no response. Task 1's unpin test, its last two lines.
3. **The first Refresh that succeeds after a failure.** Cards must come back, and placed afresh, not where they stood before the failure. Task 1's instance-stacks guard test.
4. **A pin that fails while the alert stands.** The toast must still show and the row's mark must be undone, with the alert still in place. Task 1's failing-pin test.

---

### Task 1: The alert stands until an issues read succeeds

**Files:**
- Create: `.claude/e2e/tests/failed-refresh.spec.ts`
- Modify: `.claude/e2e/tests/instance-stacks.spec.ts` (one test appended at the end)
- Modify: `web/src/views/today.ts` (`Regions`, the `regions` literal in the mount, `refreshResults`, `renderResponse`)

**Interfaces:**
- Consumes: `refreshEverything(regions, { restack: true })` and `regions.stackOf` from #144, unchanged.
- Produces: `Regions.issuesFailed: boolean`. No other task uses it.

- [ ] **Step 1: Write the failing tests.** Create `.claude/e2e/tests/failed-refresh.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";

/**
 * #305: once an issues read fails, its error alert is the only report of the failure. No redraw
 * from the last good response may put the old cards back over it — not the pins answer landing
 * after it, not a pin or unpin, succeeding or failing — until an issues read succeeds.
 */

interface StubPin {
  id: number;
  instanceId: number;
  instanceName: string;
  instancePosition: number;
  key: string;
  summary: string;
  status: string;
  url: string;
  error: null;
}

const failure = { code: "store_failed", message: "could not read the stored instances" };
const pinFailure = { code: "jira_error", message: "Jira did not take the pin." };

function pinFor(id: number, key: string): StubPin {
  return {
    id,
    instanceId: 1,
    instanceName: "Work",
    instancePosition: 0,
    key,
    summary: `Summary of ${key}`,
    status: "To Do",
    url: `https://jira.example/browse/${key}`,
    error: null,
  };
}

const sharedPin = pinFor(40, "SHARED-40");
const otherPin = pinFor(41, "OTHER-1");

function entry(id: number, issueKey: string): Record<string, unknown> {
  return {
    id,
    instanceId: 1,
    instanceName: "Work",
    instancePosition: 0,
    issueKey,
    day: "2026-08-31",
    startedAt: "2026-08-31T09:00:00+02:00",
    seconds: 1800,
    comment: "",
    pushState: "unpushed",
  };
}

function hold(): { held: Promise<void>; release: () => void } {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { held, release };
}

const alert = (page: Page) => page.locator("#view that-alert", { hasText: failure.message });
const workCard = (page: Page) => page.getByRole("region", { name: "Work", exact: true });
const pinned = (page: Page) => page.getByRole("region", { name: "Pinned" });
const offList = (page: Page) => page.locator('section[aria-labelledby="today-offlist"]');

// Time logged today against WORK-1, which is assigned, and SHARED-40, which is not — so
// SHARED-40 sits in the off-list section while unpinned, and WORK-1 only ever would if the
// off-list section were judged against no issues response at all.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/entries**", (route) =>
    route.fulfill({
      status: 200,
      json: { today: "2026-08-31", entries: [entry(1, "WORK-1"), entry(2, "SHARED-40")] },
    }),
  );
  await page.route("**/api/issues/search**", (route) =>
    route.fulfill({
      status: 200,
      json: {
        results: [
          {
            instanceId: 1,
            instanceName: "Work",
            instancePosition: 0,
            key: "SHARED-40",
            summary: "Vendor security review",
            status: "To Do",
            url: "https://jira.example/browse/SHARED-40",
          },
        ],
        errors: [],
      },
    }),
  );
});

/** The first /api/issues call answers the Work card; every later one fails once `held` settles. */
async function stubIssues(page: Page, held: Promise<void> = Promise.resolve()): Promise<void> {
  let calls = 0;
  await page.route("**/api/issues", async (route) => {
    calls += 1;
    if (calls === 1) {
      await route.fulfill({
        status: 200,
        json: {
          instances: [
            {
              id: 1,
              name: "Work",
              issues: [
                {
                  key: "WORK-1",
                  summary: "Fix the export",
                  status: "To Do",
                  url: "https://jira.example/browse/WORK-1",
                },
              ],
              error: null,
            },
          ],
        },
      });
      return;
    }
    await held;
    await route.fulfill({ status: 500, json: failure });
  });
}

/** A pin store answering GET, POST and DELETE the way the server does. Returns its live array. */
async function stubPinStore(page: Page, initial: StubPin[]): Promise<StubPin[]> {
  const pins = [...initial];
  await page.route("**/api/pins**", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const body = request.postDataJSON() as { issueKey: string };
      const created = pinFor(600 + pins.length, body.issueKey);
      pins.push(created);
      await route.fulfill({ status: 201, json: created });
      return;
    }
    if (request.method() === "DELETE") {
      const id = Number(new URL(request.url()).pathname.split("/").pop());
      const index = pins.findIndex((pin) => pin.id === id);
      if (index >= 0) pins.splice(index, 1);
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({ status: 200, json: pins });
  });

  return pins;
}

async function openToday(page: Page, pinnedReady: string): Promise<void> {
  await page.goto("/today");
  await expect(workCard(page)).toBeVisible(); // wait
  await expect(pinned(page).getByText(pinnedReady, { exact: true })).toBeVisible(); // wait
}

/**
 * Refresh, with its pins answer landing (it adds OTHER-1) before the issues read fails — the
 * order that never wiped the alert. The pin tests start here, so nothing has wiped it before they
 * act.
 */
async function refreshFailingAfterPins(page: Page, store: StubPin[], releaseIssues: () => void): Promise<void> {
  store.push(otherPin);
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(pinned(page).getByText("OTHER-1", { exact: true })).toBeVisible(); // wait
  releaseIssues();
  await expect(alert(page)).toBeVisible(); // wait
}

const triggers: [string, (page: Page) => Promise<void>][] = [
  ["Refresh", (page) => page.getByRole("button", { name: "Refresh" }).click()],
  [
    "the network returning",
    (page) => page.evaluate(() => window.dispatchEvent(new Event("online"))),
  ],
];

for (const [name, trigger] of triggers) {
  test(`${name} whose issues read fails keeps its alert when the pins answer lands after it`, async ({
    page,
  }) => {
    await stubIssues(page);
    const store = await stubPinStore(page, []);
    const pinsRefresh = hold();
    await page.route("**/api/pins**", async (route) => {
      if (new URL(route.request().url()).searchParams.get("refresh") === "1") await pinsRefresh.held;
      await route.fallback();
    });
    await openToday(page, "Nothing pinned.");
    await expect(offList(page).getByText("SHARED-40", { exact: true })).toBeVisible(); // wait

    // The refreshed pins hold SHARED-40, so their arrival shows in Pinned and empties off-list.
    store.push(sharedPin);
    await trigger(page);
    await expect(alert(page)).toBeVisible(); // wait
    pinsRefresh.release();
    await expect(pinned(page).getByText("SHARED-40", { exact: true })).toBeVisible(); // wait

    await expect.soft(alert(page)).toBeVisible();
    await expect.soft(workCard(page)).toHaveCount(0);
    await expect.soft(offList(page)).toHaveCount(0);
  });
}

test("the pins answering first, then the issues read failing, ends on the alert", async ({ page }) => {
  const issues = hold();
  await stubIssues(page, issues.held);
  const store = await stubPinStore(page, []);
  await openToday(page, "Nothing pinned.");

  await refreshFailingAfterPins(page, store, issues.release);

  await expect.soft(alert(page)).toBeVisible();
  await expect.soft(workCard(page)).toHaveCount(0);
});

test("a pin that succeeds while the alert stands keeps it", async ({ page }) => {
  const issues = hold();
  await stubIssues(page, issues.held);
  const store = await stubPinStore(page, []);
  await openToday(page, "Nothing pinned.");
  await refreshFailingAfterPins(page, store, issues.release);

  await offList(page).getByRole("button", { name: "Pin SHARED-40", exact: true }).click();
  await expect(pinned(page).getByText("SHARED-40", { exact: true })).toBeVisible(); // wait

  await expect.soft(alert(page)).toBeVisible();
  await expect.soft(workCard(page)).toHaveCount(0);
  await expect.soft(offList(page)).toHaveCount(0);
});

test("an unpin that succeeds while the alert stands keeps it", async ({ page }) => {
  const issues = hold();
  await stubIssues(page, issues.held);
  const store = await stubPinStore(page, [sharedPin]);
  await openToday(page, "SHARED-40");
  await refreshFailingAfterPins(page, store, issues.release);

  await pinned(page).getByRole("button", { name: "Unpin SHARED-40", exact: true }).click();
  await expect(pinned(page).getByText("SHARED-40", { exact: true })).toHaveCount(0); // wait

  await expect.soft(alert(page)).toBeVisible();
  await expect.soft(workCard(page)).toHaveCount(0);
  await expect.soft(offList(page).getByText("SHARED-40", { exact: true })).toBeVisible();
  await expect.soft(offList(page).getByText("WORK-1", { exact: true })).toHaveCount(0);
});

test("a pin that fails while the alert stands keeps it, undoes the mark and still toasts", async ({
  page,
}) => {
  const issues = hold();
  await stubIssues(page, issues.held);
  const store = await stubPinStore(page, []);
  await page.route("**/api/pins**", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 502, json: pinFailure });
      return;
    }
    await route.fallback();
  });
  await openToday(page, "Nothing pinned.");
  await refreshFailingAfterPins(page, store, issues.release);

  await offList(page).getByRole("button", { name: "Pin SHARED-40", exact: true }).click();
  // The toast is raised after the redraw, so it is also the point the redraw is done.
  await expect(page.locator("that-toasts that-toast[tone='error']")).toContainText(pinFailure.message);

  await expect.soft(alert(page)).toBeVisible();
  await expect.soft(workCard(page)).toHaveCount(0);
  await expect
    .soft(offList(page).getByRole("button", { name: "Pin SHARED-40", exact: true }))
    .toBeVisible();
});
```

Append to `.claude/e2e/tests/instance-stacks.spec.ts` (its `instances`, `openToday`, `rowsOf`, `stackOf` and `WIDE` already exist there):

```ts
test("a Refresh that succeeds after a failed one draws the cards and places them afresh", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/issues", async (route) => {
    calls += 1;
    if (calls === 2) {
      await route.fulfill({ status: 500, json: { code: "store_failed", message: "could not read the stored instances" } });
      return;
    }
    await route.fulfill({ status: 200, json: { instances: calls === 1 ? instances(2, 1, 1) : instances(1, 1, 1) } });
  });
  await openToday(page, WIDE, "Alpha", "Bravo", "Charlie");
  const refresh = page.getByRole("button", { name: "Refresh" });

  await refresh.click();
  // Enabled again once both reads settle. Not the alert: before #305 the pins answer could land
  // second and wipe it, which would make this guard flaky on the unfixed code.
  await expect(refresh).toBeEnabled(); // wait
  await refresh.click();

  await expect.soft(rowsOf(page, "Alpha")).toHaveCount(1);
  // Charlie sat right beside Alpha's two rows; placed afresh from one row each, a tie sends it left.
  expect.soft(await stackOf(page, "Charlie")).toBe("left");
});
```

- [ ] **Step 2: Run them; see RED.** Run `failed-refresh.spec.ts`.
Expected, in both browsers:
  - Both "… whose issues read fails keeps its alert…" tests: red on `alert … toBeVisible` and `workCard … toHaveCount(0)` (the old Work card is back, the alert gone). Their `offList` line passes.
  - "a pin that succeeds…", "an unpin that succeeds…", "a pin that fails…": red on the same two lines. Their off-list lines and the toast pass.
  - "the pins answering first…" passes. It is a *guard*.

  No `// wait` line may be the failure. Then run `instance-stacks.spec.ts -g "after a failed one"`: it passes, and it is a *guard*.

- [ ] **Step 3: Implement.** In `web/src/views/today.ts`:

In `interface Regions`, after `issuesCachedAt: Date | null;`, add:

```ts
  /** Whether the last issues read failed. Its alert in `results` is the only report of the
   *  failure, so no redraw may replace it until a read succeeds (#305). */
  issuesFailed: boolean;
```

In the `regions = { … }` literal of the mount, after `issuesCachedAt: null,`, add:

```ts
    issuesFailed: false,
```

In `refreshResults`' `try`, directly before `renderResponse(regions, response);`, add:

```ts
    regions.issuesFailed = false;
```

In its `catch`, after `regions.issuesCachedAt = null;`, add:

```ts
    regions.issuesFailed = true;
```

At the top of `renderResponse`, before `if (response.instances.length === 0) {`, add:

```ts
  if (regions.issuesFailed) {
    renderOffListSection(regions);

    return;
  }
```

Nothing else changes: `lastIssues` and `stackOf` stay as they are, and `refreshPins` and `undoOptimisticMark` still call `renderResponse(regions, regions.lastIssues)`.

- [ ] **Step 4: Run them; see GREEN.** Run Prettier on `src/views/today.ts`, then `make tsc`, `make lint`, `failed-refresh.spec.ts` and `instance-stacks.spec.ts`. Then run `today.spec.ts` and `pins.spec.ts`, which cover Refresh, a failed read and pinning. All green.

- [ ] **Step 5: Mutations.** Run each one with `-g`, see the named lines red, then restore:
  1. Delete the `if (regions.issuesFailed) { … }` block in `renderResponse`. Red: `alert` and `workCard` lines of both trigger tests, "a pin that succeeds…", "an unpin that succeeds…" and "a pin that fails…".
  2. Delete `regions.issuesFailed = true;` in the catch. Red: the same lines as mutation 1.
  3. Keep the guard's `return` but delete its `renderOffListSection(regions);`. Red: the `offList … toHaveCount(0)` line of both trigger tests and of "a pin that succeeds…"; "an unpin that succeeds…" `SHARED-40 … toBeVisible`; "a pin that fails…" `Pin SHARED-40 … toBeVisible` (the row keeps its optimistic Unpin mark).
  4. In `refreshResults`' catch, add `regions.lastIssues = null;`. Red: "an unpin that succeeds…" `WORK-1 … toHaveCount(0)` (and the `offList … toHaveCount(0)` lines of the trigger tests and "a pin that succeeds…", where WORK-1 now shows as off-list).
  5. Delete `toast("error", messageOf(error));` in `undoOptimisticMark`. Red: "a pin that fails…" toast line.
  6. Delete `regions.issuesFailed = false;` in `refreshResults`. Red: instance-stacks "after a failed one" `rowsOf(… "Alpha") … toHaveCount(1)`.
  7. Move `regions.issuesFailed = false;` to after `renderResponse(regions, response);`. Red: the same `rowsOf` line.
  8. Delete `if (options?.restack) regions.stackOf = new Map();` in `refreshResults`. Red: instance-stacks "after a failed one" `stackOf(… "Charlie")` (received `"right"`).
  9. In `refreshResults`' catch, change `regions.results.replaceChildren(alertFor(…))` to `regions.results.append(alertFor(…))`. Red: "the pins answering first…" `workCard … toHaveCount(0)`.
  10. Delete that `regions.results.replaceChildren(alertFor(…))` line. Red: "the pins answering first…" — the alert wait in `refreshFailingAfterPins`, the same assertion its own `alert` line makes; report it as that test's alert proof.

- [ ] **Step 6: Commit.**

```bash
git add web/src/views/today.ts .claude/e2e/tests/failed-refresh.spec.ts .claude/e2e/tests/instance-stacks.spec.ts
git commit -m "fix(#305): a failed issues read keeps its alert until a read succeeds

A pins answer landing after the failure, or a pin or unpin, used to redraw
the old cards over the alert, leaving stale cards with nothing saying so.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DhrQjSkmUmfVxLZHhaYLwQ"
```

---

### Task 2: The gate

**Files:** none.

- [ ] **Step 1: Run the gate.**

```shell
make verify
make test-e2e
```

Expected: both green, in Firefox and Chromium. If `make test-e2e` fails outside `failed-refresh.spec.ts` and `instance-stacks.spec.ts`, rerun that spec alone once. A second failure is a finding, not a flake: report it. Paste the last lines of both outputs into the report.

---

## Acceptance criteria → tests

| Criterion (#305) | Task | Test(s) |
|---|---|---|
| Refresh with the issues read failing and the pins answering after it: the alert stays, no old card; the refresh pins call held until the alert shows | 1 | "Refresh whose issues read fails keeps its alert…" (and the same for the network returning) |
| The same when a pin or an unpin succeeds while the alert stands, and when one fails (mark undone, toast shows) | 1 | "a pin that succeeds…", "an unpin that succeeds…", "a pin that fails…" |
| The off-list section is still redrawn on those paths, judged against the last good response | 1 | the `offList` lines of all five; "an unpin that succeeds…" `WORK-1` line (mutations 3, 4) |
| A later successful read clears the flag and draws the cards, Refresh's re-stacking unchanged | 1 | instance-stacks "a Refresh that succeeds after a failed one…" (mutations 6–8) |
| The reverse order still ends on the alert | 1 | "the pins answering first…" (guard; mutations 9, 10) |
| Each new assertion is shown to fail with the guard removed | 1 | Step 2 RED and Step 5 mutations 1–10 |
