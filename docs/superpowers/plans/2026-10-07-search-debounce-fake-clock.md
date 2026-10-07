# #272 — search.spec's debounce tests run on the fake clock

**Date:** 2026-10-07
**Supersedes:** nothing
**Superseded by:** nothing
**Spec:** Codeberg #272 body (refined 2026-10-06)

Three tests in `.claude/e2e/tests/search.spec.ts` race the real clock against
`that-issue-search`'s 350 ms debounce (`DEBOUNCE_MS`, `web/src/components/that-issue-search.ts:104`).
Under load the race flips and the test fails. They move to Playwright's fake clock, so time moves only
when the test says so. **Test-only. No product code changes.**

## Global Constraints

- All tooling runs through `make` or `docker compose`; never run Go, Node or npm on the host.
- Only `.claude/e2e/tests/search.spec.ts` changes. No product file changes, and no other spec.
- Do not run Prettier on `.claude/e2e/`; there is no config there. Match the file's existing style.
- **Freeze the clock, do not just install it.** After `page.clock.install()`, page time still flows
  with real time; only `page.clock.pauseAt(...)` stops it, after which no timer fires unless
  `runFor`/`fastForward`/`pauseAt`/`resume` is called. Each of the three tests installs the clock
  before `page.goto`, then pauses it after the page has loaded and before the first keystroke. Read
  the current fake time from the page (`page.evaluate(() => Date.now())`) and pause a little after it,
  so `pauseAt` never targets the past.
- No `waitForTimeout` and no real-time gap against the debounce may remain in the three tests.
  `pressSequentially`'s `delay` is real time on the driver side; with the clock paused it cannot reach
  the debounce, so it may stay or go, but the coalescing must be driven by `runFor`.
- TDD for a test-only change: the three tests already exist, so each changed assertion is proven by
  **mutation**: break the code it guards in `that-issue-search.ts` by hand, run that one test, show it
  red on the assertion, restore, show it green. A timeout or a compile error is not red.
- Run one spec: `docker compose --profile e2e rm --stop --force app-e2e`, then
  `docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test search.spec.ts --reporter=line -g "<title fragment>"'`,
  then remove `app-e2e` again.
- Commits: if `git commit` fails on signing, retry with `git -c commit.gpgsign=false commit …`.
  Never push.

## Task 1: The three debounce tests run on a paused fake clock

**Files:** `.claude/e2e/tests/search.spec.ts` only.

**Deviation:** The shipped tests assert an in-page count of search fetches (an `addInitScript` wrapper around `window.fetch`) instead of `stubSearch`'s `calls()`, because the driver-side count read straight after `runFor` passed vacuously (a mutation stayed green).

Add one helper beside `searchField`, and rewrite the three tests. Target shape (adapt names to the
file; the behaviour is binding):

```ts
/** Installs the fake clock before navigation and pauses it once the page has
 *  loaded, so the debounce fires only when a test advances time (#272). */
async function gotoTodayOnPausedClock(page: Page): Promise<void> {
  await page.clock.install();
  await page.goto("/today");
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 1_000);
}
```

1. **"typing fewer than two characters reaches no network"** — `fill("r")`, then
   `page.clock.runFor(600)` in place of `waitForTimeout(600)`; assert `calls()` is 0.
   Mutation: make `scheduleSearch`'s `query.length < MIN_QUERY` guard never true (e.g. `< 0`); red on
   `calls()`.
2. **"rapid keystrokes are coalesced into a single search"** — type "capacity" one key at a time,
   advancing the clock by less than 350 ms (e.g. `runFor(20)`) between keys; then `runFor(400)`; then
   expect RIDGE-5140 visible and `calls()` exactly 1.
   Mutation: remove `scheduleSearch`'s leading `window.clearTimeout(this.timer)`; red on `calls()`
   (more than 1). The ticket also allows shortening the debounce below the per-key step instead.
3. **"closing the field within the debounce window makes no request"** — `fill("capacity")`, then
   `press("Escape")` with no time advanced, then `runFor(1_000)` (well past 350 ms); assert `calls()`
   is 0.
   Mutation: remove `close()`'s `window.clearTimeout(this.timer)`; red on `calls()`.

Keep each test's existing comment, corrected where it now describes real time.

Then:
- The three tests green on both browsers.
- `search.spec.ts` passes `--repeat-each=10` on both browsers under the full parallel run
  (`npx playwright test search.spec.ts --repeat-each=10 --reporter=line`). Paste the summary line.
- One commit: `#272: search.spec's debounce tests run on a paused fake clock`.

## Task 2: Final gates

`make verify` and `make test-e2e`, both green, tails pasted. No commit.

## Out of scope

#212 (`tooltip.spec.ts`), and any other spec's use of real time — a new finding goes to intake.
