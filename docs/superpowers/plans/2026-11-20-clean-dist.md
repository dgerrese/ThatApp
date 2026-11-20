# #19 — every build starts from a clean `web/dist`

**Date:** 2026-11-20
**Supersedes:** nothing
**Superseded by:** nothing

Ticket: https://github.com/dgerrese/ThatApp/issues/19. The approach (clean on start only, a helper
under `web/tools/`) was settled with the owner on 2026-11-04 and is in the ticket body. This branch
is stacked on `issue-20-worker-rebuild-queue` (PR #69), because both change `web/build.mjs`.

## Task 1 — the clean helper, called once at the start of every build

**Files**

- Create `web/tools/clean-dir.mjs` and `web/tools/clean-dir.d.mts` (pattern:
  `reachable-files.mjs` / `.d.mts`, and #20's `serial-debounce.mjs`).
- Create `web/src/clean-dir.test.ts` (run by `make test-web`).
- Modify `web/build.mjs`.

**The helper.** One function that empties a directory except the names it is told to keep (here
`.gitkeep`), removing files and subdirectories, and does nothing when the directory does not exist.
`node:fs` only (`readdirSync`, `rmSync` with `recursive`/`force`).

**Tests (TDD), against a temporary directory from `fs.mkdtempSync(os.tmpdir() …)`:**

1. Files and nested subdirectories are removed.
2. `.gitkeep` survives.
3. A missing directory does not throw.

Mutation: drop the `.gitkeep` exception → test 2 fails; drop the missing-directory tolerance → test 3
fails. Show both red runs.

**build.mjs.** Before the existing `mkdirSync("dist", { recursive: true })`, clean `dist` keeping
`.gitkeep`. This runs once per process, at the start of both a non-watch build and watch mode, before
the first pass. Watch mode never cleans between rebuilds. Keep the CB#40 comment true.

**The serving window (a criterion asks the PR to state it).** The `web` service runs
`npm run build && touch /tmp/web-built && npm run watch`, and `app` serves `web/dist` from disk
(`web/assets_dev.go`). So the `watch` start cleans `dist` that the build just wrote, after the
healthcheck marker exists. Observe and record what `app` serves during that window under `make up`
(e.g. curl `/` and `/app.js` in a loop while the stack starts), and say in the report why that is
acceptable, or report it as a concern if it is not.

**Verification**

- `make test-web` red then green; mutations.
- Before/after file counts: fill `web/dist` with stale files (e.g. create 50 dummy `chunk-*.js`), run
  `make build-web`, show the count before and after, and that only files the build wrote plus
  `.gitkeep` remain. Do the same around `make image` (the release dry-run) and record both counts.
- Remove `web/dist` entirely (keep a note to restore `.gitkeep` from git afterwards) and confirm
  `make build-web` still works.
- `make up` reaches healthy; `make down`.
- `make verify`, `make test-e2e`.
