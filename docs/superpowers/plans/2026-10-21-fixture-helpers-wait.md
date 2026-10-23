# tooltip.spec's mountFixed and mountCutText wait for the upgrade — Implementation Plan

**Date:** 2026-10-21
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `mountFixed` and `mountCutText` in `.claude/e2e/tests/tooltip.spec.ts` return only once their `that-tooltip` has upgraded, so a hover straight after them always opens it (#316).

**Architecture:** Each helper ends with the wait `mountTrigger` already has (`tooltip.spec.ts`, end of `mountTrigger`): `that-tooltip[data-fixture][for="<id>"][popover]` attached. `connectedCallback()` in `web/src/components/that-tooltip.ts` sets `popover` in the same synchronous step that adds the trigger's `pointerenter` listener, so the attribute proves the listener. Each helper gets one late-chunk test in the shape of #309's "a hover straight after mountTrigger opens the tooltip, even when its chunk arrives late".

**Tech Stack:** Playwright (Firefox and Chromium), TypeScript.

**Spec:** Codeberg #316. Its body is the design of record (refined 2026-10-21); its comments add the 2026-10-14 narrowing (no scroll race here) and the approval.

## Global Constraints

- All tooling goes through `make` or `docker compose`. Never run Node or npm on the host.
- Only `.claude/e2e/tests/tooltip.spec.ts` changes. No product code changes.
- **No other existing test in `tooltip.spec.ts` changes.** `mountTrigger` and `mountTriggerAfterButton` stay as they are.
- **No shared wait helper.** The `expect` is repeated in each helper, as the ticket's out-of-scope says.
- TypeScript `strict` + `noUncheckedIndexedAccess`: no `any`, no `as any`, no `!`.
- Comments few: a non-obvious why only. Prettier is not run on `.claude/e2e`.
- **TDD.** RED fails on an assertion, for the reason the test names; the report quotes it. **Every assertion the task adds is proven by mutation**, with its red line in the report.
- Commands:

  ```shell
  # One e2e spec — the rig's own disposable app-e2e; always clean up around it
  docker compose --profile e2e rm --stop --force app-e2e
  docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tooltip.spec.ts --reporter=line'
  docker compose --profile e2e rm --stop --force app-e2e
  ```

  Add `-g "<title fragment>"` to run one test. `make tsc` and `make lint` at the end.
- Commits: if `git commit` fails on signing, retry with `git -c commit.gpgsign=false commit …` and note it. **Never push.** Never merge into `main`.
- Branch: `issue-316-fixture-helpers-wait`, already checked out. Do not switch, stash or reset.

## Review Focus

1. **RED can be browser-specific.** Chromium sends no second `pointerenter` to a resting pointer; Firefox may. RED must show in at least Chromium; report both browsers' results.
2. **The delayed chunk must still be pending when the helper runs.** `beforeEach` already loaded Today once; the late-chunk test calls `routeTooltipChunk` and then `openToday` again, exactly as #309's test does, so the fresh load fetches the chunk through the delay.
3. **"a when-cut tooltip stays closed when the text is not cut"** becomes a real check once `mountCutText` waits. It must stay green; if it goes red, that is a product finding, not a test to adjust — stop and report.
4. **The seven arrow cases and the long-word test** use `mountFixed` with different ids (`arrow-trigger`, `long-word-trigger`); the wait must use the `id` parameter, not a fixed string.

---

### Task 1: both helpers wait, each proven by a late-chunk test

**Files:**
- Modify: `.claude/e2e/tests/tooltip.spec.ts` — `mountFixed`, `mountCutText`, and two new tests

**Interfaces:**
- Consumes: `routeTooltipChunk(page, onChunk)`, `openToday(page)`, `longText` — all already in the spec.
- Produces: nothing new; the helpers' signatures do not change.

- [ ] **Step 1: Write the `mountFixed` late-chunk test**, placed straight after `mountFixed`'s definition:

```ts
test("a hover straight after mountFixed opens the tooltip, even when its chunk arrives late", async ({ page }) => {
  await routeTooltipChunk(page, async (_route, fulfill) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await fulfill();
  });
  await openToday(page);

  await mountFixed(page, "late-trigger", "top: 300px; left: 300px;", {});
  await page.locator("#late-trigger").hover();

  await expect(page.locator("that-tooltip[data-fixture]")).toBeVisible();
});
```

- [ ] **Step 2: Run it; verify RED** (at least in Chromium) on the `toBeVisible` assertion. Quote it.

- [ ] **Step 3: End `mountFixed` with** `await expect(page.locator(\`that-tooltip[data-fixture][for="${id}"][popover]\`)).toBeAttached();`

- [ ] **Step 4: Run it; verify GREEN in both browsers.**

- [ ] **Step 5: Write the `mountCutText` late-chunk test**, placed straight after the `longText` constant: the same shape, with `await mountCutText(page, longText, 120);` and `await page.locator("#cut-text").hover();`. Title: `"a hover straight after mountCutText opens the tooltip, even when its chunk arrives late"`.

- [ ] **Step 6: Run it; verify RED** (at least in Chromium) on `toBeVisible`. Quote it.

- [ ] **Step 7: End `mountCutText` with** the same wait, for `for="cut-text"`.

- [ ] **Step 8: Run it; verify GREEN in both browsers.**

- [ ] **Step 9: Mutation.** For each helper in turn: delete its wait line, run its late-chunk test, show it red, restore. (Steps 2 and 6 already show this if they were run against the helper without the wait; quote those lines or rerun.)

- [ ] **Step 10: Run the whole `tooltip.spec.ts`; verify GREEN in both browsers.** Then `make tsc` and `make lint`.

- [ ] **Step 11: Commit**

```bash
git add .claude/e2e/tests/tooltip.spec.ts
git commit -m "test(tooltip): mountFixed and mountCutText wait for the upgrade (#316)"
```
