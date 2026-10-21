# A focus while hidden is not a tab return — Implementation Plan

**Date:** 2026-10-14
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `onTabReturn` ignores a window `focus` while `document.visibilityState` is `"hidden"`, so a hidden tab stays away and its later return to visible still reads (#307).

**Architecture:** One guard in the `focus` listener of `web/src/tab-return.ts`. The `away` flag is left untouched when the guard skips, so the next `visibilitychange` to visible runs `back()` as before. One new e2e test in `.claude/e2e/tests/tab-return.spec.ts` reproduces the ticket's probe.

**Tech Stack:** TypeScript (vanilla); Playwright (Firefox and Chromium).

**Spec:** Codeberg #307. Its body is the design of record for this change; the approach is the owner's decision of 2026-10-12. Its comments add only further sightings of the flake.

## Global Constraints

- All tooling goes through `make` or `docker compose`. Never run Node or npm on the host. Nothing here needs the dev stack.
- Vanilla TS with `strict` + `noUncheckedIndexedAccess`. No `any`, no `as any`, no `!`. No new dependency, no new `THAT_*` variable.
- Firefox and Chromium only. Never add WebKit.
- Comments few: a non-obvious why only.
- **TDD.** RED must fail on an **assertion**, for the reason the test names — not a compile error or a typo'd locator. The report quotes the RED line.
- **Every assertion the task adds is proven by mutation.** Break the guarded code by hand, run that one test, show it red, restore, show it green. The report lists each mutation with its red line.
- **Out of scope:** #309 and #212 (the Chromium tooltip flakes); any change to how the rail or Today reads once a return is counted.
- Commands:

  ```shell
  # One e2e spec — the rig's own disposable app-e2e; always clean up around it
  docker compose --profile e2e rm --stop --force app-e2e
  docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tab-return.spec.ts --reporter=line'
  docker compose --profile e2e rm --stop --force app-e2e
  # Prettier on web/src only (never on .claude/e2e — it has no config)
  docker compose run --rm --no-deps web npx prettier --write src/tab-return.ts
  make tsc
  make lint
  ```

  Add `-g "<title fragment>"` to the Playwright command to run one test. Add `--repeat-each=10` for the stability run.
- Commits: if `git commit` fails on signing (a locked 1Password vault), retry the same commit with `git -c commit.gpgsign=false commit …` and carry on. Note the last signed commit in the report. **Never push.** Never merge into `main`.
- Branch: `issue-307-focus-while-hidden`, already checked out. Do not switch, stash or reset.

## Review Focus

1. **A real switch away and back delivers blur, hidden, visible and focus in that order.** It must still cost exactly one read. The existing "one return costs one timer read…" test covers it; it must stay green.
2. **The window loses focus while the tab stays visible, then regains it.** That return must still read. The existing "…after the window loses focus" tests cover it.
3. **A hidden tab receives several focus events before it becomes visible.** The return to visible must still read once. The new test's guard covers each focus the same way; no further test is needed.
4. **A tab that never left receives a focus with no blur.** No read. The existing "stays visible and focused makes no extra reads" tests cover it.

---

### Task 1: A focus while hidden does not count as a return

**Files:**
- Modify: `web/src/tab-return.ts` (the `focus` listener and the module comment)
- Test: `.claude/e2e/tests/tab-return.spec.ts` (new test after "a tab opened in the background catches up when it first becomes visible")

**Interfaces:**
- Consumes: the spec's existing helpers `stubServer`, `writeFromOutside`, `setVisibility`, `dispatchOnWindow`, `settle`, `railTimer`, `todayRow`.
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the failing test**

Add after the "a tab opened in the background…" test:

```ts
test("a focus while the tab is hidden is not a return, so becoming visible still catches up", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }),
  );
  const server = await stubServer(page);
  await page.goto("/today");
  await expect(todayRow(page, "WORK-2")).toHaveAttribute("seconds", "0");
  await expect(railTimer(page)).toContainText("No timer running");

  // A real window focus can reach a hidden tab: the browser window has focus
  // while the page reports itself hidden.
  await dispatchOnWindow(page, "focus");
  writeFromOutside(server, "WORK-2");
  await settle(page);
  await expect(railTimer(page)).toContainText("No timer running");

  await setVisibility(page, "visible");

  await expect(railTimer(page)).toContainText("WORK-1");
  await expect(todayRow(page, "WORK-2")).toHaveAttribute("seconds", "1800");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run the one-spec command with `-g "a focus while the tab is hidden"`.
Expected: FAIL in both browsers on `expect(railTimer(page)).toContainText("WORK-1")` with `Received string: "No timer running"`.

- [ ] **Step 3: Write the guard**

In `web/src/tab-return.ts`, replace `window.addEventListener("focus", back);` with:

```ts
  window.addEventListener("focus", () => {
    if (document.visibilityState === "visible") back();
  });
```

Add to the module comment, after the paragraph about `away`:

```
 * A focus while the document is hidden is not a return: the window can hold
 * focus while the tab reports itself hidden. Skipping it leaves `away` set, so
 * the visibilitychange to visible still reads (#307).
```

Run prettier on `src/tab-return.ts`.

- [ ] **Step 4: Run the spec to verify it passes**

Run the whole `tab-return.spec.ts` (both browsers). Expected: every test passes. Then run the new test with `--repeat-each=10`. Expected: 20 of 20 pass.

- [ ] **Step 5: Mutation**

1. Restore `window.addEventListener("focus", back);` (guard removed). Run the new test. Expected: red on `toContainText("WORK-1")` in both browsers. Restore the guard.
2. Change the guard to `if (document.visibilityState === "hidden") back();`. Run the "after the window loses focus" tests. Expected: red. Restore.

Mutations of the last assertion (`seconds` = `1800`) are covered by the existing "a tab opened in the background…" test, which uses the same read path. Do not add mutations of code outside `tab-return.ts`.

- [ ] **Step 6: Gates**

Run `make tsc` and `make lint`. Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add web/src/tab-return.ts .claude/e2e/tests/tab-return.spec.ts
git commit -m "fix(tab-return): a focus while hidden is not a return (#307)"
```
