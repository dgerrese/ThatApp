# mountTrigger waits for the tooltip to upgrade — Implementation Plan

**Date:** 2026-10-14
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `tooltip.spec.ts`'s `mountTrigger` returns only after the tooltip it mounted has upgraded, so no hover can land before the tooltip listens (#309).

**Architecture:** Test-only. `mountTrigger` ends with a `toBeAttached` wait on its own tooltip with `[popover]` (the attribute the upgrade sets). The by-hand waits that become redundant go. A new test delays the tooltip's split chunk through `page.route` and proves the helper waits. The chunk-finding route block that the "never upgrades" test already has becomes a small helper both tests use.

**Tech Stack:** Playwright (Firefox and Chromium), TypeScript.

**Spec:** Codeberg #309. Its body is the design of record; the approach is the owner's decision of 2026-10-12. Its comments add nothing beyond the approval.

## Global Constraints

- All tooling goes through `make` or `docker compose`. Never run Node or npm on the host.
- **No product change.** `web/src/components/that-tooltip.ts` and every other file under `web/` stay untouched. Only `.claude/e2e/tests/tooltip.spec.ts` changes.
- Strict TS in the spec: no `any`, no `as any`. Comments few: a non-obvious why only.
- Firefox and Chromium only. Never add WebKit.
- **TDD.** RED must fail on an **assertion**, for the reason the test names. The report quotes the RED line.
- **Every assertion the task adds or changes is proven by mutation**, with its red line in the report.
- **Out of scope:** any change to `that-tooltip.ts` (intake #313 holds the product half); #307; closing #212.
- Commands:

  ```shell
  # One e2e spec — the rig's own disposable app-e2e; always clean up around it
  docker compose --profile e2e rm --stop --force app-e2e
  docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tooltip.spec.ts --reporter=line'
  docker compose --profile e2e rm --stop --force app-e2e
  make lint
  ```

  Add `-g "<title fragment>"` to run one test, `--project=chromium` to run one browser, `--repeat-each=10` for a stability run. Never run prettier on `.claude/e2e` — it has no config.
- Commits: if `git commit` fails on signing, retry with `git -c commit.gpgsign=false commit …` and note it. **Never push.** Never merge into `main`.
- Branch: `issue-309-mounttrigger-waits`, already checked out. Do not switch, stash or reset.

## Rulings made before execution

The owner can reverse either.

1. **The wait names the mounted tooltip by `for`, not only by `data-fixture`.** The ticket writes `that-tooltip[data-fixture][popover]`. "One Escape closes every open tooltip" mounts two fixtures, and a strict `toBeAttached` on two matches throws. The helper waits for `that-tooltip[data-fixture][for="<id>"][popover]`. Same intent, one element.
2. **The wait at the "one Escape" test (`that-tooltip[for='second'][popover]`) also goes.** The ticket names two redundant waits; this third one is redundant for the same reason and falls under the criterion's wording, "the by-hand waits it makes redundant".

## Review Focus

1. **Two mounts in one test.** The helper must not throw a strict-mode error. The "one Escape closes every open tooltip" test covers it.
2. **The "never upgrades" test, whose route block moves into the helper,** must still prove the chunk was blocked (`upgraded` is `false`). It stays green, and Step 5's mutation 3 proves the helper still blocks.
3. **The delayed chunk in Firefox.** The ticket's probe found the delay did not take effect in Firefox. The new test must still pass there; its mutation is required to go red in Chromium only.

---

### Task 1: mountTrigger waits for the upgrade, proven by a delayed chunk

**Files:**
- Modify: `.claude/e2e/tests/tooltip.spec.ts` (`mountTrigger`, the "never upgrades" test's route block, `mountTriggerAfterButton`, the Escape-by-hover test, the "one Escape" test; one new test)

**Interfaces:**
- Produces, inside the spec only:
  - `mountTrigger(page, options?)` — unchanged signature; now resolves after the upgrade.
  - `routeTooltipChunk(page, onChunk: (route: Route, fulfill: () => Promise<void>) => Promise<void>): Promise<void>` — routes every `**/*.js` through a real fetch; the script whose body contains `customElements.define("that-tooltip"` goes to `onChunk`, every other script is fulfilled as fetched.

- [ ] **Step 1: Extract `routeTooltipChunk` (refactor, no behaviour change)**

Change the import to `import { expect, test, type Page, type Route } from "@playwright/test";`. Add above the "never upgrades" test, after its doc comment's paragraph about finding the chunk by content (move the last two sentences of that comment, "The chunk's filename carries a build hash…", onto the helper):

```ts
// The chunk's filename carries a build hash this spec cannot predict, so this
// finds it by what it contains — fetching every script for real and
// inspecting the body — rather than by name.
async function routeTooltipChunk(
  page: Page,
  onChunk: (route: Route, fulfill: () => Promise<void>) => Promise<void>,
): Promise<void> {
  const base = process.env["THAT_BASE_URL"] ?? "http://that-e2e:8080";
  await page.route("**/*.js", async (route) => {
    const requested = new URL(route.request().url());
    const response = await fetch(`${base}${requested.pathname}${requested.search}`);
    const body = await response.text();
    const fulfill = () =>
      route.fulfill({
        status: response.status,
        body,
        contentType: response.headers.get("content-type") ?? "text/javascript",
      });
    if (body.includes('customElements.define("that-tooltip"')) await onChunk(route, fulfill);
    else await fulfill();
  });
}
```

In the "never upgrades" test, delete `const base = …` and replace the whole `page.route("**/*.js", …)` block with:

```ts
  await routeTooltipChunk(page, (route) => route.abort("failed"));
```

Run that one test (`-g "never upgrades"`), both browsers. Expected: PASS.

- [ ] **Step 2: Write the failing test**

Add after "hovering a trigger shows the tooltip, and pointerleave hides it again":

```ts
// #309: the tooltip listens for pointerenter only once its split chunk has
// upgraded it, and Chromium sends no second pointerenter to a resting pointer.
// A hover that lands before the upgrade never opens it, so mountTrigger has to
// wait for the upgrade. The delay stands in for a chunk that arrives late
// under load.
test("a hover straight after mountTrigger opens the tooltip, even when its chunk arrives late", async ({
  page,
}) => {
  await routeTooltipChunk(page, async (_route, fulfill) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await fulfill();
  });
  await page.reload();

  await mountTrigger(page);
  await page.locator("#trigger").hover();

  await expect(page.locator("that-tooltip[data-fixture]")).toBeVisible();
});
```

- [ ] **Step 3: Run it to verify it fails**

Run `-g "chunk arrives late" --project=chromium`.
Expected: FAIL on `toBeVisible()` with `Received: hidden`. (Firefox may pass here; the probe found the delay does not take effect there.)

- [ ] **Step 4: Make `mountTrigger` wait, and drop the redundant waits**

At the end of `mountTrigger`, after the `page.evaluate(…)`:

```ts
  await expect(
    page.locator(`that-tooltip[data-fixture][for="${options.id}"][popover]`),
  ).toBeAttached();
```

Delete these three lines:
- in `mountTriggerAfterButton`: `await expect(page.locator("that-tooltip[data-fixture][popover]")).toBeAttached();`
- in "Escape closes a tooltip opened by hover…": the same line
- in "one Escape closes every open tooltip": `await expect(page.locator("that-tooltip[for='second'][popover]")).toBeAttached();`

- [ ] **Step 5: Verify and mutate**

1. Run the new test with `--repeat-each=10`, both browsers. Expected: 20 of 20 pass.
2. Run the whole `tooltip.spec.ts`, both browsers. Expected: all pass.
3. Mutations, each restored after:
   1. Delete the wait added in Step 4. Run the new test, `--project=chromium`. Expected: red on `toBeVisible()`, `Received: hidden`.
   2. Change the wait's selector to drop `[for="${options.id}"]`. Run "one Escape closes every open tooltip". Expected: red with a strict-mode violation (this proves ruling 1).
   3. In the "never upgrades" test, change the callback to `(_route, fulfill) => fulfill()`. Run it. Expected: red on `expect(upgraded).toBe(false)`.

- [ ] **Step 6: Gate**

Run `make lint`. Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add .claude/e2e/tests/tooltip.spec.ts
git commit -m "test(tooltip): mountTrigger waits for the upgrade (#309)"
```

---

## Amendment, 2026-10-14 — a second cause, found at the gates

The full `make test-e2e` on Task 1's head (`5e463f1`) failed once: `[chromium] tooltip.spec.ts` "Escape closes a tooltip opened by hover…", `toBeVisible()`, `Received: hidden`. The tooltip carried `popover="manual"` (upgraded) and `data-side="above"` (so `reveal()` ran): it opened, then closed.

A probe (not committed) confirmed the cause. The fixture trigger is appended to `body` after Today's own content, at y=720, the window's bottom edge. `hover()` scrolls it to y=699. When Today's issues answer lands *after* the hover, the empty state renders, the trigger moves back to y=720, the pointer is no longer on it, and `pointerleave` closes the tooltip. With `/api/issues` delayed 1500 ms: 6 of 6 failed, both browsers. Answered at once: 6 of 6 passed.

**Ruling 3 (the owner may reverse it):** this is fixed on this branch, in the test, because it is the ticket's own symptom ("the hover tooltip sometimes never opens") and the ticket's last criterion asks for a green `make test-e2e`. The product does not change: a tooltip that closes when its trigger moves away from the pointer is correct.

### Task 2: Tests mount only after Today's first render

**Files:**
- Modify: `.claude/e2e/tests/tooltip.spec.ts` (the `beforeEach`; one new helper; one new test)

**Interfaces:**
- Consumes: `mountTrigger(page)`, `routeTooltipChunk` (Task 1).
- Produces, inside the spec only: `openToday(page: Page): Promise<void>` — navigates to `/today` and resolves once Today's empty state has rendered.

- [ ] **Step 1: Probe which of Today's reads move the trigger**

Write a throwaway spec, `.claude/e2e/tests/zz-probe.spec.ts` (never committed). For each of `**/api/issues`, `**/api/entries**`, `**/api/pins**` and `**/api/timer`, one test delays only that route by 1500 ms (fulfilling `issues` with `{ instances: [] }`, `entries` with `{ today: "2026-09-09", entries: [] }`, and letting `pins` and `timer` continue to the real server with `route.continue()`), goes to `/today`, waits for the empty-state paragraph only when issues is *not* the delayed one, mounts the fixture as `mountTrigger` does, records `#trigger`'s `boundingBox()`, waits 2000 ms, records it again. Run it with `--repeat-each=2`, both browsers. Record in the report which reads move the trigger. Delete the probe.

**If any read other than `/api/issues` moves the trigger, stop and report NEEDS_CONTEXT with the numbers.** Do not choose a different wait yourself.

- [ ] **Step 2: Write the failing test**

Add after the test Task 1 added:

```ts
// #309, second cause: the fixture trigger sits after Today's own content, so
// Today's first render, landing after a hover, moves it out from under the
// pointer and pointerleave closes the tooltip. openToday waits that render out.
test("a hover after openToday stays open, even when Today's issues answer arrives late", async ({
  page,
}) => {
  await page.route("**/api/issues", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fulfill({ status: 200, json: { instances: [] } });
  });
  await openToday(page);

  await mountTrigger(page);
  const trigger = page.locator("#trigger");
  await trigger.hover();
  const hovered = await trigger.boundingBox();
  // wait: Today's late render has landed by now, whichever way the test ran.
  await expect(page.getByText("No Jira instances yet.")).toBeVisible();

  expect(await trigger.boundingBox()).toEqual(hovered);
  await expect(page.locator("that-tooltip[data-fixture]")).toBeVisible();
});
```

The box comparison is the guard: `toBeVisible()` alone passes at once, before a late render can close the tooltip (found by the first Task 2 dispatch).

And the helper, above `mountTrigger`, as a bare navigation for now:

```ts
async function openToday(page: Page): Promise<void> {
  await page.goto("/today");
}
```

Replace `await page.goto("/today");` in the `beforeEach` with `await openToday(page);`.

- [ ] **Step 3: Run it to verify it fails**

Run `-g "issues answer arrives late"`, both browsers. Expected: FAIL in both on the `boundingBox()` `toEqual`, with `y` 699 expected and 720 received.

- [ ] **Step 4: Make `openToday` wait**

```ts
async function openToday(page: Page): Promise<void> {
  await page.goto("/today");
  await expect(page.getByText("No Jira instances yet.")).toBeVisible();
}
```

Update the spec's opening comment (the one above `beforeEach`) with one sentence: tests mount only after Today's empty state has rendered, because a later render moves a mounted trigger.

- [ ] **Step 5: Verify and mutate**

1. Run the new test with `--repeat-each=10`, both browsers. Expected: 20 of 20 pass.
2. Run the whole `tooltip.spec.ts`, both browsers. Expected: all pass.
3. Run the whole `tooltip.spec.ts` with `--repeat-each=3`, both browsers. Expected: all pass. Quote the summary line.
4. Mutation: delete the wait line from `openToday`. Run the new test. Expected: red on the `boundingBox()` `toEqual` in both browsers. Restore.

- [ ] **Step 6: Gate**

Run `make lint`. Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add .claude/e2e/tests/tooltip.spec.ts
git commit -m "test(tooltip): mount only after Today's first render (#309)"
```
