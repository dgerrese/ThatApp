# Stale banner re-check (#71) Implementation Plan

**Date:** 2026-09-18
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While Today's stale banner is showing, coming back to the app — the tab becoming visible or the window regaining focus — re-runs the refresh, so a server that came back while the network never dropped clears the banner.

**Architecture:** One handler in `web/src/views/today.ts`, registered on `document`'s `visibilitychange` and `window`'s `focus` next to the existing `online` listener and torn down the same way. It does nothing unless the banner is showing and the page is visible, and nothing while a refresh is already in flight — the Refresh control's `disabled` attribute, which `refreshEverything` already holds for exactly that span, is the in-flight signal, so focus and visibility arriving together cost one refresh.

**Tech Stack:** TypeScript (vanilla), Playwright.

**Spec:** Codeberg issue #71 — `tea api "repos/{owner}/{repo}/issues/71"`.

## Global Constraints

- No Go, Node or npm on the host; everything runs through `make` or `docker compose`.
- The owner's dev stack (`app`, `web`) is running and is theirs: never `make down`, never stop/restart/recreate `app` or `web`.
- `strict` + `noUncheckedIndexedAccess`; no `any`, `as any`, or `!`.
- No polling, no timers, no health probe.
- Only a stale banner triggers a refresh: an ordinary tab switch must not fan out to Jira.
- No test contacts a real Jira instance.
- Comments are few and explain a non-obvious why.
- Commit unsigned with `git -c commit.gpgsign=false commit …` if signing fails; **never push**.

---

### Task 1: Re-check on return, only while stale

**Files:**
- Modify: `web/src/views/today.ts` (beside the `online` listener, ~line 334)
- Test: `.claude/e2e/tests/pwa.spec.ts` (three tests after `the assigned-issues warning names a time … clears on 'online' without a reload`)
- Test: `.claude/e2e/tests/today.spec.ts` (one test)

**Interfaces:** none shared with other tasks.

**Engine limits.** Making Today stale needs the worker's own `/api/issues` fetch to fail, which only
Chromium allows in this rig — the three banner tests skip Firefox exactly as the existing `online`
test does, with the same reason string. The no-banner test needs no worker and runs on both engines.

- [ ] **Step 1: Write the failing tests**

In `.claude/e2e/tests/pwa.spec.ts`, read the existing test `the assigned-issues warning names a time
while the server is unreachable, and clears on 'online' without a reload` and extract its setup — the
`serverIs` switch on `context.route("**/api/issues")`, the goto/activate/control/reload dance, and the
reload with `serverIs = "gone"` that raises the banner — into a local helper
`openTodayStale(page, context): Promise<{ setServer(state: "healthy" | "gone"): void; issueReads(): number; warning: Locator }>`
that also counts requests reaching the `/api/issues` route. Make the existing `online` test use it,
with no change to its assertions. Then add:

```ts
for (const [trigger, dispatch] of [
  ["the tab becoming visible", () => document.dispatchEvent(new Event("visibilitychange"))],
  ["the window regaining focus", () => window.dispatchEvent(new Event("focus"))],
] as const) {
  test(`the stale warning clears on ${trigger} once the server answers again`, async ({ page, context, browserName }) => {
    test.skip(browserName !== "chromium", "a Firefox worker's own fetch cannot be made to fail in this rig — see above");
    const stale = await openTodayStale(page, context);
    await expect(stale.warning).toBeVisible();

    stale.setServer("healthy");
    await page.evaluate(dispatch);

    await expect(stale.warning).toBeHidden();
    await expect(page.getByText("Ship it")).toBeVisible();
  });
}

test("the stale warning stays when coming back finds the server still gone, and one return costs one read", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "a Firefox worker's own fetch cannot be made to fail in this rig — see above");
  const stale = await openTodayStale(page, context);
  await expect(stale.warning).toBeVisible();
  const before = stale.issueReads();

  // Both events in one task, as a real return to the window delivers them.
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });

  await expect.poll(() => stale.issueReads()).toBe(before + 1);
  await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
  expect(stale.issueReads()).toBe(before + 1);
  await expect(stale.warning).toBeVisible();
});
```

(If the Refresh control's accessible name differs, read it from `today.ts` and use it.)

In `.claude/e2e/tests/today.spec.ts`, add a cross-engine test:

```ts
test("coming back to a Today that is not stale fetches nothing", async ({ page }) => {
  let issueReads = 0;
  await page.route("**/api/issues", (route) => {
    issueReads += 1;
    return route.fulfill({ status: 200, json: { instances: [] } });
  });
  await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));
  await page.route("**/api/entries**", (route) =>
    route.fulfill({ status: 200, json: { today: "2026-09-18", entries: [] } }),
  );

  await page.goto("/today");
  await expect(page.getByText("No Jira instances yet.")).toBeVisible();
  const before = issueReads;

  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  // A real server round trip: anything the events started would have sent its
  // request before this one comes back.
  await page.evaluate(() => fetch("/api/health").then((response) => response.text()));

  expect(issueReads).toBe(before);
});
```

(`today.spec.ts` has `stubIssues`, `stubPins` and `stubEntries`; use them where they fit, adding the
read counter, rather than repeating routes. With no instances the Refresh control stays hidden, so
the empty state is the settled signal here.)

- [ ] **Step 2: Run them to verify they fail**

Run the two specs with `-g` on the new titles (mirror `make test-e2e`'s recipe for a focused run).
Expected before the fix: the two "clears on …" tests FAIL on Chromium (warning stays visible); the
"stays … one read" test FAILS on Chromium at the `expect.poll` (no read happens); the no-banner test
PASSES on both engines (nothing listens yet) — that one is a guard against the fix over-reaching, and
its RED is shown in Step 4 by breaking the guard. Paste the output.

- [ ] **Step 3: Write the fix**

In `web/src/views/today.ts`, replace the comment above `handleOnline` and extend the block:

```ts
  // "online" fires when the *network* comes back. A server that restarts while
  // the network never dropped fires nothing, so coming back to the app — the
  // tab turning visible, the window regaining focus — re-checks too (#71).
  // Only while stale: every refresh fans out to Jira, and an ordinary tab
  // switch must not cost that. navigator.onLine is not trustworthy either (a
  // captive portal reports "online"); in every case the fetch, not the event,
  // decides whether the stale banner clears.
  const handleOnline = (): void => {
    void refreshEverything(regions);
  };
  // Refresh stays disabled for exactly as long as refreshEverything runs, so
  // focus and visibilitychange arriving together start one refresh, not two.
  const handleReturn = (): void => {
    if (regions.stale.hidden || document.visibilityState !== "visible") return;
    if (regions.refresh.hasAttribute("disabled")) return;
    void refreshEverything(regions);
  };
  window.addEventListener("online", handleOnline);
  document.addEventListener("visibilitychange", handleReturn);
  window.addEventListener("focus", handleReturn);
```

and the teardown:

```ts
  registerTeardown(() => {
    window.removeEventListener("online", handleOnline);
    document.removeEventListener("visibilitychange", handleReturn);
    window.removeEventListener("focus", handleReturn);
  });
```

Keep the existing comment explaining why the teardown is registered now rather than later.

- [ ] **Step 4: Run the tests to verify they pass, and prove the guard**

Same command as Step 2: all pass on Chromium; the no-banner test passes on both engines.

Then prove the no-banner test can fail: temporarily delete the `regions.stale.hidden` check, run the
no-banner test (expect FAIL on both engines: a read happened), restore it. Then delete the
`disabled` check, run the "one read" test (expect FAIL: two reads), restore it. Paste both failures.

- [ ] **Step 5: Gates**

`make verify` then `make test-e2e`. Expected: `verify: OK`; whole suite green. #134's intermittent
chromium segfault in `pwa.spec.ts`: re-run once and report both runs.

- [ ] **Step 6: Commit**

```bash
git add web/src/views/today.ts .claude/e2e/tests/pwa.spec.ts .claude/e2e/tests/today.spec.ts
git commit -m "fix(#71): coming back to a stale Today re-checks the server"
```
