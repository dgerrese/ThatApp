# Prettier formatting is gated (#74) Implementation Plan

**Date:** 2026-09-23
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** `make fmt` leaves a clean checkout clean, and `npm run lint` fails whenever the committed
frontend drifts from prettier's output.

**Architecture:** Format the tree once, in a commit holding nothing but prettier's output. Then add
`prettier --check` to the npm `lint` script over the same glob `fmt` writes, with a
`web/.prettierignore` so the check never reads `dist/`. `make lint` and CI's verify job both run
`npm run lint`, so the gate has one definition and `.forgejo/workflows/verify.yml` needs no change.

**Tech Stack:** prettier 3.9.6 (fixed by `web/package-lock.json`), npm scripts, Make, Compose.

**Spec:** Codeberg issue #74 — its "Settled at refinement" section and acceptance criteria.

## Global Constraints

- Docker only: never run `node`, `npm` or `npx` on the host. Use `make` or
  `docker compose run --rm --no-deps web …` (export `THAT_UID=$(id -u) THAT_GID=$(id -g)` first).
- Do not change prettier's version or `web/.prettierrc.json`.
- Go formatting is out of scope.
- The reformat commit contains prettier's output and nothing else.
- Never push. If signing fails (1Password locked), commit with `git -c commit.gpgsign=false commit`.

## Measured on `main` at f159c57

`prettier --list-different "**/*.{ts,css,html,json}"` run in `web/` reports 22 committed files, not
the seven the issue names, plus `dist/app.css` and `dist/index.html`:

```
index.html
src/components/that-issue-search.ts   src/components/that-tooltip.ts
src/duration.ts        src/entries-changed.ts   src/fetch-report.test.ts   src/format.ts
src/icons.test.ts      src/icons.ts             src/rail.ts                src/reachable-files.test.ts
src/sw.ts              src/table-sort.test.ts   src/timer-state.ts         src/tokens.test.ts
src/views/settings.ts  src/views/today.ts       src/views/week.ts          src/vocabulary.test.ts
src/week-grid.test.ts  src/week-label.ts
```

`dist/` is listed because prettier reads ignore files from its working directory (`web/`), and the
`web/dist/*` rule lives in the repo-root `.gitignore`, which it never sees. `node_modules` is
ignored by prettier's own default.

---

### Task 1: Format once, then gate it

**Files:**
- Create: `web/.prettierignore`
- Modify: `web/package.json` (`scripts.lint`)
- Reformatted by `make fmt`: the 22 files above

**Interfaces:** none — no code consumes this.

- [ ] **Step 1: Write the gate**

`web/.prettierignore`:

```
# Build output. Prettier reads ignore files from web/, so the repo-root .gitignore never reaches it.
dist/
```

`web/package.json` — `lint` becomes (glob identical to `fmt`'s):

```json
"lint": "node tools/unused-tokens.mjs && eslint src && prettier --check \"**/*.{ts,css,html,json}\"",
```

- [ ] **Step 2: Run it on the unformatted tree — RED**

Run: `make lint-web`
Expected: exits non-zero; prettier prints `[warn]` for the 22 files above and
`Code style issues found in 22 files`. It must **not** list any `dist/` file. Keep the output.

- [ ] **Step 3: Set the gate aside and reformat**

```bash
git stash push --include-untracked -- web/.prettierignore web/package.json
make fmt
git status --short          # expect exactly the 22 files, nothing under dist/ (ignored), no Go files
```

- [ ] **Step 4: Verify the reformat alone, then commit it**

Run: `make verify` — expected `verify: OK` (the tree has no gate yet; this proves the reformat
changes no behaviour).

```bash
git add -u web
git commit -m "[#74] Format the frontend with prettier 3.9.6

Nothing but the output of make fmt. Re-run it to check.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RMHka2uP8XsVpm3n9DKZoH"
```

- [ ] **Step 5: Restore the gate — GREEN**

```bash
git stash pop
make lint-web               # expected: "All matched files use Prettier code style!", exit 0
make fmt && git status --short   # expected: only the two gate files, nothing else
```

- [ ] **Step 6: Show the gate failing on an uncommitted unformatted file**

```bash
printf 'export const x   =  {a:1,\n b : 2}\n' > web/src/unformatted-probe.ts
make lint-web               # expected: non-zero, "[warn] src/unformatted-probe.ts"
rm web/src/unformatted-probe.ts
```

Keep the output for the pull request.

- [ ] **Step 7: Commit the gate**

```bash
git add web/.prettierignore web/package.json
git commit -m "[#74] npm run lint checks prettier formatting

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RMHka2uP8XsVpm3n9DKZoH"
```

### After the task (controller, not the implementer)

- `make verify` and `make test-e2e` green on the branch tip.
- List the open pull request branches the reformat conflicts with:
  `git merge-tree --write-tree HEAD codeberg/<branch>` for each open PR's head; non-zero exit means
  conflict.
