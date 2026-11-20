# #20 — one queue rebuilds the worker in watch mode

**Date:** 2026-11-20
**Supersedes:** nothing
**Superseded by:** nothing

Ticket: https://github.com/dgerrese/ThatApp/issues/20. The approach was settled with the owner on
2026-11-04 and is in the ticket body; this plan only lays it out as one task.

## Task 1 — the queue helper, and every watch trigger routed through it

**Files**

- Create `web/tools/serial-debounce.mjs` and its types `web/tools/serial-debounce.d.mts` (same
  pattern as `reachable-files.mjs` / `reachable-files.d.mts`).
- Create `web/src/serial-debounce.test.ts` (same pattern as `web/src/reachable-files.test.ts`; run
  by `make test-web` through `node --test 'src/**/*.test.ts'`).
- Modify `web/build.mjs`.

**The helper.** `serialDebounce(run, { delayMs = 50, onError })` returns a `trigger()` function.

- `trigger()` (re)starts a `delayMs` timer. A burst of triggers inside the window gives one run.
- When the timer fires and no run is under way, it calls `run()`.
- When the timer fires while a run is under way, it sets an "again" flag. When the current run
  settles, if "again" is set, it clears the flag and runs once more. Any number of triggers during
  one run give exactly one extra run.
- A rejected (or throwing) `run()` goes to `onError(err)` and does not stop the queue: the next
  trigger runs again, and a pending "again" still runs.
- Never two `run()` calls at the same time. The last trigger's run is the last to finish.

**Tests (TDD, `node:test` with real short timers or `mock.timers`, whichever reads simpler):**

1. A burst of triggers inside the window collapses to one run.
2. Runs never overlap (track a concurrent counter; max must be 1).
3. Triggers during a run cause exactly one more run, after the first finishes.
4. A rejected run is passed to `onError`, and a later trigger still runs.

Mutation: remove the "again" flag → test 3 fails; remove the overlap guard → test 2 fails. Show both
red runs in the report.

**build.mjs.** Make one `const rebuildWorker = serialDebounce(() => buildWorker(assetPaths), {
onError: (err) => console.error(...) })` inside the watch branch. The esbuild `onEnd` plugin, the
`sw.ts` watch, the `app.css` watch and the `index.html` watch all call `rebuildWorker()`. The
`index.html` watch keeps its own 50 ms debounce for `copyShell()` and calls `rebuildWorker()` after
a successful copy. The three duplicated `setTimeout` blocks for the worker go. Keep the existing
comments that explain *why* each watch exists; drop only what no longer applies. Non-watch builds do
not change.

**Verification**

- `make test-web`, `make verify` green.
- Manual check under the dev stack: `make up`, read `__WD_BUILD_ID__` from `web/dist/sw.js`, touch
  `web/index.html` (append and then remove a blank line, or a harmless whitespace change, then
  restore it), and see the id change and `/index.html` stay in the precache list. Paste before/after.
  Then `make down`.
- `make test-e2e` green.
