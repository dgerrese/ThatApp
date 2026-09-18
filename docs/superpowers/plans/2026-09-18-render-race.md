# Render race (#42) Implementation Plan

**Date:** 2026-09-18
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A navigation that has been overtaken by a later one neither clears the root, renders, nor resets scroll.

**Architecture:** `renderCurrent` in `web/src/router.ts` already bumps `navigationId` per call. Add a
check against it after `await load()` and after `await view.render(...)`. The regression test holds
Today's view chunk in Playwright until Week has rendered, then releases it.

**Tech Stack:** TypeScript (vanilla), esbuild with code splitting, Playwright on Firefox and Chromium.

**Spec:** Codeberg issue #42 — its body is the refined spec (problem, approach, acceptance criteria,
out of scope). Read it: `tea api "repos/{owner}/{repo}/issues/42"`.

## Global Constraints

- Local development runs in Docker. No Go, Node or npm on the host; use `make` or `docker compose`.
- Vanilla TypeScript, `strict` + `noUncheckedIndexedAccess`; no `any`, `as any` or `!` assertions.
- Reuse the existing `navigationId`. No second counter.
- No test contacts a real Jira instance: every `/api/*` a view calls is stubbed with `page.route`.
- Comments are few and explain a non-obvious why.
- Commit unsigned with `git -c commit.gpgsign=false commit …` if signing fails; **never push**.

---

### Task 1: Drop a navigation that has been overtaken

**Files:**
- Create: `.claude/e2e/tests/router.spec.ts`
- Modify: `web/src/router.ts` (the `View` interface doc and the tail of `renderCurrent`)

**Interfaces:**
- Consumes: the existing `navigationId` / `thisNavigation` in `renderCurrent`.
- Produces: nothing new for other code.

**Why the test finds the chunk the way it does.** esbuild names every chunk `chunk-[hash].js`, so
Today's view cannot be held by file name. The router's route table is shipped inside one of those
chunks and survives minification as `"/today":()=>import("./chunk-XXXX.js")`. The test intercepts
every chunk, reads each body as it passes, and learns Today's file name from that table before any
navigation happens. Holding Today's *entry* chunk is safe: esbuild never makes one entry chunk
import another, so Week's module graph cannot wait on it.

**Why the test knows the stale navigation has had its chance.** After releasing the chunk the test
runs `import()` on the same URL in the page. That promise settles after the router's own `await
load()` continuation, which was registered first — so by then the unfixed router has already
cleared the root and started Today's render, which attaches Today's container synchronously.

- [ ] **Step 1: Write the failing test**

Create `.claude/e2e/tests/router.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";

const DAYS = [
  "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10",
  "2026-09-11", "2026-09-12", "2026-09-13",
];

/** Every endpoint Settings, Today and Week read, answered empty. */
async function stubApi(page: Page): Promise<void> {
  await page.route("**/api/instances", (route) => route.fulfill({ status: 200, json: [] }));
  await page.route("**/api/issues", (route) =>
    route.fulfill({ status: 200, json: { instances: [] } }),
  );
  await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));
  await page.route("**/api/entries**", (route) =>
    route.fulfill({ status: 200, json: { today: DAYS[0], entries: [] } }),
  );
  await page.route("**/api/week**", (route) =>
    route.fulfill({
      status: 200,
      json: {
        start: DAYS[0],
        end: DAYS[6],
        prevStart: "2026-08-31",
        nextStart: "2026-09-14",
        weekNumber: 37,
        days: DAYS.map((day) => ({ day, seconds: 0, pushState: null })),
        rows: [],
        seconds: 0,
      },
    }),
  );
}

const ROUTE_TABLE_TODAY = /["']\/today["']\s*:\s*\(\)\s*=>\s*import\(\s*["']\.\/(chunk-[\w-]+\.js)["']\s*\)/;

test("a view whose import resolves after a later navigation never replaces it", async ({ page }) => {
  await stubApi(page);

  let todayChunk: string | undefined;
  let releaseToday: () => void = () => {};
  const todayReleased = new Promise<void>((resolve) => {
    releaseToday = resolve;
  });
  let todayRequested: () => void = () => {};
  const todayWasRequested = new Promise<void>((resolve) => {
    todayRequested = resolve;
  });

  await page.route("**/chunk-*.js", async (route) => {
    const file = new URL(route.request().url()).pathname.slice(1);
    if (file === todayChunk) {
      todayRequested();
      await todayReleased;
    }

    const response = await route.fetch();
    const body = await response.text();
    todayChunk ??= ROUTE_TABLE_TODAY.exec(body)?.[1];
    await route.fulfill({ response, body });
  });

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Add an instance" })).toBeVisible();
  expect(todayChunk, "the router's route table was not found in any chunk").toBeDefined();

  await page.getByRole("link", { name: "Today", exact: true }).click();
  await todayWasRequested;

  await page.getByRole("link", { name: "Week", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Week 37 · 7–13 Sep" })).toBeVisible();

  releaseToday();
  await page.evaluate((file) => import(`/${file}`).then(() => undefined), todayChunk);

  await expect(page).toHaveURL(/\/week$/);
  await expect(page.getByRole("heading", { name: "Week 37 · 7–13 Sep" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pinned" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Week", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
});
```

If the rail's links are not named exactly "Today" and "Week", or the Week heading reads differently
against this stub, read `web/index.html` / `web/src/rail.ts` and `week.spec.ts` and use the real
names — do not loosen the assertions to `hasText`.

- [ ] **Step 2: Run it to verify it fails**

Run: `docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test router.spec.ts'`
(or `make test-e2e` if the stack has to come up — see `CLAUDE.md`)

Expected: FAIL on both `firefox` and `chromium`, at the Week-heading or `Pinned` assertion after the
release — Today has replaced Week while the URL still reads `/week`. Paste this output in the task
report. **If it passes without the fix, stop and report**: the test does not reproduce the race.

- [ ] **Step 3: Write the fix**

In `web/src/router.ts`, replace the tail of `renderCurrent`:

```ts
  const view = await load();
  root.replaceChildren();
  await view.render(root, registerTeardown);
  resetContentScroll();
}
```

with:

```ts
  const view = await load();
  if (thisNavigation !== navigationId) return;
  root.replaceChildren();
  await view.render(root, registerTeardown);
  if (thisNavigation !== navigationId) return;
  resetContentScroll();
}
```

And write the invariant down on the `View` interface, replacing `interface View {` with:

```ts
/**
 * A view must attach its container to `root` synchronously, before its first
 * `await`. The router only guards the gap before `render` is called; once it
 * is, anything a view writes after an await lands in its own container, which
 * is already detached if a newer view has replaced it.
 */
interface View {
```

- [ ] **Step 4: Run the test to verify it passes**

Same command as Step 2. Expected: PASS on `firefox` and `chromium`.

- [ ] **Step 5: Run the gates**

Run: `make verify` then `make test-e2e`. Expected: `verify: OK`, and the whole e2e suite green on
both engines. `pwa.spec.ts` has a known intermittent chromium segfault (#134); if it appears,
re-run once and report both runs rather than hiding the first.

- [ ] **Step 6: Commit**

```bash
git add .claude/e2e/tests/router.spec.ts web/src/router.ts
git commit -m "fix(#42): a navigation overtaken by a later one no longer renders or resets scroll"
```

## Not covered by a test, deliberately

The scroll check after `view.render` has no end-to-end test: the stale render finishes inside a
detached container, and there is no deterministic signal a test could wait on for "it has finished
and did nothing". It is the same one-line guard as the first, and review covers it.
