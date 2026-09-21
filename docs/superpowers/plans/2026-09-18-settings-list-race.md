# Settings list race (#56) Implementation Plan

**Date:** 2026-09-18
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settings applies only the answer to its most recent instance-list read, so a late, older answer can no longer erase an instance that was just saved.

**Architecture:** `refresh()` in `web/src/views/settings.ts` numbers each read on the view's own `regions` object and discards any answer — success or failure — that is not the latest. The same shape as #42's `navigationId`, kept per render rather than in module state, because `regions` is what every closure of one render already shares.

**Tech Stack:** TypeScript (vanilla), Playwright on Firefox and Chromium.

**Spec:** Codeberg issue #56 — `tea api "repos/{owner}/{repo}/issues/56"`.

## Global Constraints

- No Go, Node or npm on the host; everything runs through `make` or `docker compose`.
- `strict` + `noUncheckedIndexedAccess`; no `any`, `as any`, or `!`.
- The fix is in the view. `editing can be cancelled` is not changed, and no wait is added to any existing test.
- No test contacts a real Jira instance.
- Comments are few and explain a non-obvious why.
- Commit unsigned with `git -c commit.gpgsign=false commit …` if signing fails; **never push**.

---

### Task 1: Only the latest list read reaches the page

**Files:**
- Modify: `web/src/views/settings.ts` (`Regions`, `render`'s `regions` literal, `refresh`)
- Test: `.claude/e2e/tests/settings.spec.ts` (two new tests, after `editing can be cancelled`)

**Interfaces:** none shared with other tasks.

**How the test orders the reads.** `stubInstancesApi` answers a list read with whatever it holds *at
answer time*, which would hide the race. The new tests register a second `page.route` for
`**/api/instances` after it (Playwright tries the most recently registered handler first). That
handler takes only the **first** GET, holds it, and later answers with what the list was *when that
read was sent* — empty, or a 500 — then falls every other request back to the stub.

**How the test knows the late answer has been handled.** After the held read is fulfilled, the test
makes the page perform one real round trip to `/api/health` (unrouted, so it goes to the server). The
held answer's body is already in the browser, so the page finishes parsing and applying it before a
fresh request can cross the network and back. Only then does the test assert.

- [ ] **Step 1: Write the failing tests**

Add to `.claude/e2e/tests/settings.spec.ts`, after `editing can be cancelled`:

```ts
// #56: the initial list read is answered after a save has already redrawn the
// list. Whatever that stale read carries — the empty list it saw, or a
// failure — must not replace what the save's own read put on screen.
for (const stale of [
  { name: "an empty list", answer: { status: 200, json: [] } },
  {
    name: "a failure",
    answer: { status: 500, json: { code: "store_failed", message: "could not read the stored instances" } },
  },
] as const) {
  test(`a list read answered late with ${stale.name} leaves a just-saved instance listed`, async ({ page }) => {
    await stubInstancesApi(page, { testStatus: 200 });

    let releaseFirstRead: () => void = () => {};
    const firstReadReleased = new Promise<void>((resolve) => {
      releaseFirstRead = resolve;
    });
    let firstReadAnswered: () => void = () => {};
    const firstReadWasAnswered = new Promise<void>((resolve) => {
      firstReadAnswered = resolve;
    });
    let heldOne = false;

    await page.route("**/api/instances", async (route) => {
      if (route.request().method() !== "GET" || heldOne) {
        await route.fallback();
        return;
      }
      heldOne = true;
      await firstReadReleased;
      await route.fulfill(stale.answer);
      firstReadAnswered();
    });

    await page.goto("/settings");
    await addInstance(page);
    await expect(page.getByText("Work", { exact: true })).toBeVisible();

    releaseFirstRead();
    await firstReadWasAnswered;
    await page.evaluate(() => fetch("/api/health").then((response) => response.text()));

    await expect(page.getByText("Work", { exact: true })).toBeVisible();
    await expect(page.getByText("could not read the stored instances")).toHaveCount(0);
  });
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test settings.spec.ts -g "answered late"'`
(the stack must be up — see how `make test-e2e` brings it up and mirror it)

Expected: all four (two cases × two engines) FAIL — the empty case at the `Work` visibility
assertion (the row was erased), the failure case at the error-text assertion (the stale error
replaced the list's clean state). Paste into the report. **If either passes before the fix, stop and
report** — the test does not reproduce the race.

- [ ] **Step 3: Write the fix**

In `web/src/views/settings.ts`:

`Regions` gains a field:

```ts
interface Regions {
  errorSlot: HTMLElement;
  listCard: HTMLElement;
  formCard: HTMLElement;
  // Numbers every list read this render starts, so refresh() can tell the
  // answer it is holding from one a later read has already superseded (#56).
  latestListRead: number;
}
```

`render`'s `regions` literal gains `latestListRead: 0,`.

`refresh` becomes:

```ts
async function refresh(regions: Regions): Promise<void> {
  const thisRead = ++regions.latestListRead;
  let instances: Instance[];
  try {
    instances = await listInstances();
  } catch (error) {
    if (thisRead !== regions.latestListRead) return;
    regions.errorSlot.replaceChildren(alertFor("error", messageOf(error)));

    return;
  }

  if (thisRead !== regions.latestListRead) return;
  regions.errorSlot.replaceChildren();
  reconcileList(regions, instances);
}
```

Keep the existing comment above `refresh` (about `regions` being captured per render) as it is.

- [ ] **Step 4: Run the tests to verify they pass**

Same command as Step 2. Expected: all four PASS.

- [ ] **Step 5: Run the gates**

`make verify` then `make test-e2e`. Expected: `verify: OK`; whole suite green on both engines.
`pwa.spec.ts` has a known intermittent chromium segfault (#134); if it appears, re-run once and
report both runs.

- [ ] **Step 6: Commit**

```bash
git add web/src/views/settings.ts .claude/e2e/tests/settings.spec.ts
git commit -m "fix(#56): a late instance-list read no longer erases an instance just saved"
```
