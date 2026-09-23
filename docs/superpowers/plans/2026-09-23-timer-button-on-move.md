# A row that a sort moves keeps its start/stop button (#192) Implementation Plan

**Date:** 2026-09-23
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `that-timer` whose row a sort moves still draws its start/stop button, and with
`moveBefore` keeps the very same button (and so its focus).

**Architecture:** Two changes to `web/src/components/that-timer.ts`, as settled in the issue.
`render()` builds a fresh, empty button, so it clears the `renderedMine` memo before `paint()` —
the root-cause fix, covering every reconnect including `that-table`'s `insertBefore` fallback. A
no-op `connectedMoveCallback()` then lets `moveBefore` move the element without a reconnect at all,
the same opt-in `that-ticket-row` already has.

**Tech Stack:** TypeScript (strict), Playwright e2e in `.claude/e2e/tests/timer.spec.ts`.

**Spec:** Codeberg issue #192 (the design of record,
`docs/superpowers/specs/2026-08-04-thatapp-design.md`, does not reach this level).

## Deviation found in execution

The issue says the `insertBefore` fallback reaches the same early return. It does not. Under that
fallback `that-ticket-row` reconnects too, and its `connectedCallback` rebuilds the row. The row
therefore gets a new `that-timer` with an empty memo. Task 1's "without moveBefore" test passed
before the fix, so it was replaced with a test that removes and reinserts a live `that-timer`
directly (commit e9191cc). That is the only reconnect that reaches the stale memo. The memo reset
is still the root-cause fix for any reconnect of the same element. Task 1's test code below is the
original text.

## Global Constraints

- Docker only: run everything through `make` or `docker compose`; never `go`, `node` or `npm` bare.
- TypeScript `strict` + `noUncheckedIndexedAccess`; no `any`, `as any` or non-null assertions in `web/src`.
- Light DOM `that-*` components; no frameworks.
- Browsers: Firefox and Chromium. No WebKit.
- The unit suite has no DOM (happy-dom is not on `main`), so every test here is e2e.
- Few comments: only a non-obvious "why".

## Running a single e2e file

```shell
docker compose --profile e2e rm --stop --force app-e2e
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/timer.spec.ts'
docker compose --profile e2e rm --stop --force app-e2e
```

This mirrors `make test-e2e` (Makefile line 61) with a file filter; the rig starts its own
disposable `app-e2e`, so no `make up` is needed.

## The fixture, and which row moves

`timer.spec.ts`'s `beforeEach` stubs one instance with `WORK-1` then `WORK-2`. Clicking the Key
header once sorts ascending (no move); a second click sorts descending, and `reorder()` moves
`WORK-2` in front of `WORK-1`. `WORK-2` is the moved row. The instance card's table is
`that-table[sort-id="instance-1"]`. The play icon is an `svg path`, the stop icon an `svg rect`.

---

### Task 1: `render()` forgets what it drew

**Files:**
- Modify: `web/src/components/that-timer.ts` (`render()`)
- Test: `.claude/e2e/tests/timer.spec.ts` (append)

- [ ] **Step 1: Write the failing tests** — append to `timer.spec.ts`:

```ts
const instanceTable = (page: Page) => page.locator('that-table[sort-id="instance-1"]');

async function rowKeys(page: Page): Promise<string[]> {
  return instanceTable(page)
    .locator("tbody > that-ticket-row")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("key") ?? ""));
}

/** Two clicks on Key: ascending leaves WORK-1, WORK-2 alone; descending moves WORK-2 up. */
async function sortKeyDescending(page: Page): Promise<void> {
  const keyButton = instanceTable(page).locator("th.c-key button");
  await keyButton.click();
  await keyButton.click();
  await expect.poll(() => rowKeys(page)).toEqual(["WORK-2", "WORK-1"]);
}

async function expectTimerDrawn(page: Page, issueKey: string, running: boolean): Promise<void> {
  const button = ticketRow(page, issueKey).locator("that-timer button");
  await expect(button).toHaveAttribute("aria-label", running ? "stop timer" : "start timer");
  await expect(button.locator(running ? "svg rect" : "svg path")).toHaveCount(1);
}

/**
 * #192: a sort that moves a row must not leave its that-timer's button empty.
 * WORK-2 is the moved row and runs the timer, so its button must read stop.
 */
test("a row a sort moves keeps its start/stop button drawn", async ({ page }) => {
  await page.goto("/today");
  await ticketRow(page, "WORK-2").getByRole("button", { name: "start timer" }).click();
  await expectTimerDrawn(page, "WORK-2", true);

  await sortKeyDescending(page);

  await expectTimerDrawn(page, "WORK-2", true);
  await expectTimerDrawn(page, "WORK-1", false);
});

/**
 * #192's insertBefore path: without moveBefore (Firefox ESR before 144) a move
 * disconnects and reconnects every moved element, so that-timer rebuilds its
 * button. Deletes moveBefore the same way table.spec.ts's fallback test does.
 */
test("without moveBefore, a reconnected timer draws its button again", async ({ page }) => {
  await page.addInitScript(() => {
    for (const proto of [Element.prototype, Node.prototype]) {
      if (Object.prototype.hasOwnProperty.call(proto, "moveBefore")) {
        delete (proto as unknown as Record<string, unknown>)["moveBefore"];
      }
    }
  });
  await page.goto("/today");
  await ticketRow(page, "WORK-2").getByRole("button", { name: "start timer" }).click();
  await expectTimerDrawn(page, "WORK-2", true);

  await sortKeyDescending(page);

  await expectTimerDrawn(page, "WORK-2", true);
  await expectTimerDrawn(page, "WORK-1", false);
});
```

- [ ] **Step 2: Run to verify both fail** on Firefox and Chromium: the moved row's button has no
  `aria-label` (the `toHaveAttribute` times out). Paste the failure in the task report.

- [ ] **Step 3: Implement** — in `render()`, immediately before `this.paint();`:

```ts
    this.renderedMine = undefined;
```

  No comment needed beyond what the field's own comment already says ("undefined forces the first
  paint()"); if one is added, one line: a new button has nothing drawn on it.

- [ ] **Step 4: Run to verify both pass**, whole `timer.spec.ts` green on both projects.

- [ ] **Step 5: Commit** — `fix(timer): a rebuilt start/stop button is painted again (#192)`.

### Task 2: `moveBefore` keeps the same button

**Files:**
- Modify: `web/src/components/that-timer.ts` (new method after `disconnectedCallback`)
- Test: `.claude/e2e/tests/timer.spec.ts` (append)

**Interfaces:** Consumes `instanceTable`, `rowKeys`, `expectTimerDrawn` from Task 1.

- [ ] **Step 1: Write the failing test**:

```ts
/**
 * #192 with moveBefore: the moved row's own button survives the move, so its
 * focus does too. The header is clicked with dispatchEvent, as in
 * table.spec.ts's focus test — a real click would move focus to the header.
 */
test("a focused start/stop button keeps focus when a sort moves its row", async ({ page }) => {
  await page.goto("/today");
  const button = ticketRow(page, "WORK-2").getByRole("button", { name: "start timer" });
  await button.focus();
  await expect(button).toBeFocused();

  const keyButton = instanceTable(page).locator("th.c-key button");
  await keyButton.dispatchEvent("click");
  await keyButton.dispatchEvent("click");
  await expect.poll(() => rowKeys(page)).toEqual(["WORK-2", "WORK-1"]);

  await expect(button).toBeFocused();
  await expectTimerDrawn(page, "WORK-2", false);
});
```

- [ ] **Step 2: Run to verify it fails** — focus lands on `<body>` because the reconnect replaced
  the button. Paste the failure.

- [ ] **Step 3: Implement** — after `disconnectedCallback()`:

```ts
  // that-table moves rows with moveBefore; without this no-op the move
  // reconnects this element and render() replaces a button that may hold focus.
  connectedMoveCallback(): void {}
```

- [ ] **Step 4: Run to verify it passes**; whole `timer.spec.ts` green on both projects.

- [ ] **Step 5: Commit** — `fix(timer): a sort moves the start/stop button without rebuilding it (#192)`.

### Finally

`make verify` and `make test-e2e` green; paste the tails.
