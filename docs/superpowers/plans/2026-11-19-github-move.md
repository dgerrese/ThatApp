# GitHub move (product side) Implementation Plan

**Date:** 2026-11-19
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The repository builds, tests and releases on GitHub: one CI workflow behind a `Quality gate` check, CI-published images on `ghcr.io/dgerrese/thatapp`, the Go module renamed, the move notice removed, and a README that names the new image.

**Architecture:** CI runs the existing `make` targets, which run every tool in Docker through Compose, so CI and local cannot drift. A `changes` job decides which checks run; prep jobs build the Compose images once into the GitHub Actions cache; the checks run in parallel; `Quality gate` sums them. A second workflow publishes releases with the unchanged `scripts/release-image.sh`.

**Tech Stack:** GitHub Actions, Docker Compose, Buildx with the `gha` cache, crane (inside `release-image.sh`), POSIX sh.

**Spec:** issue #350's body on Codeberg (`https://codeberg.org/DionGerrese/ThatApp/issues/350`), the same text as GitHub issue #46. Sections *CI*, *Releases and images*, *Order* step 8.

## Global Constraints

- Repository `github.com/dgerrese/ThatApp`; image `ghcr.io/dgerrese/thatapp`; Go module `github.com/dgerrese/ThatApp`.
- CI runs `make` targets (Docker through Compose), never the tools bare. The `.forgejo/` directory is deleted.
- One workflow, `CI`, always triggered on `pull_request` and on `push` to `main`, jobs in this order: `Changed files` → `App image` and `Web deps` → `lint-go`, `test-go`, `lint-web`, `tsc`, `test-web`, `e2e` in parallel → `Quality gate`. Job **names** are exactly these strings.
- `Changed files` outputs `code` (any changed file outside `docs/**`, `**/*.md`, `.claude/skills/**`) and `e2e` (any changed file under `web/**`, `.claude/e2e/**` except `*.md`, `docker-compose.yml`, `Dockerfile`, `Makefile`, `.env.example`, `.github/workflows/ci.yml`). On `push` to `main` both are true.
- A check runs only when its flag is set: the five verify checks on `code`, `e2e` on `e2e`. `e2e` needs both prep jobs.
- `Quality gate` has `if: always()`, needs every other job, fails if any needed job's result is `failure` or `cancelled`, and passes `skipped`.
- Waiting time as short as possible. No hard limit. The pull request reports each job's measured time.
- Releases, all from CI with the built-in `GITHUB_TOKEN` (`packages: write`, `contents: write`), never a personal token:
  - a push to `main` whose diff from the previous `main` has a `code` change → pre-release: image tags `:VERSION`, `:latest`; a GitHub pre-release with tag `vVERSION`;
  - a milestone closed → stable, built again from `main`: `:VERSION`, `:latest`, `:stable`; a GitHub release (not pre-release) whose notes list the milestone's closed issues (`- <title> (#<n>)`);
  - `VERSION` is `YYYY.WW.N`: ISO year and zero-padded ISO week of the run's date, `N` one more than the highest `N` among tags `vYYYY.WW.*`, starting at 1.
- Tag names reach scripts through the environment, never interpolated into a `run:` line.
- The move block (`[data-moved]`) leaves `web/index.html`, with its tests. #349 says the first GitHub release removes it.
- README: every image reference becomes `ghcr.io/dgerrese/thatapp`; a section headed exactly `Moving from Codeberg` (anchor `#moving-from-codeberg`) says to change the image line from `codeberg.org/diongerrese/thatapp:stable` to `ghcr.io/dgerrese/thatapp:stable` and pull; the data volume and secret key stay as they are.
- Light DOM, no framework, initial response under 14kB — unchanged by this work.

## Review Focus

1. A docs-only pull request: `Changed files` sets both flags false, every check is skipped, `Quality gate` passes. Tested by the controller with a real docs-only commit on the branch before the final push (Task 3).
2. A failing check: `Quality gate` fails. Tested by a temporary failing commit on the branch, then reverted (Task 3).
3. Two merges in one ISO week: the second gets `N = 2`; a week with no tags gets `N = 1`; week 1 to 9 is zero-padded. Tested in Task 4's version test.
4. A docs-only merge to `main` publishes nothing. Tested in Task 4 through the same `code` rule, as a unit of the version/should-release script.
5. A pre-release never moves `:stable`. Already asserted by `release-image.sh`; Task 4 keeps that path.

---

### Task 1: Rename the Go module

**Files:** `go.mod`; every `.go` file importing `codeberg.org/DionGerrese/ThatApp/...`.

- [ ] **Step 1:** `docker compose run --rm --no-deps app go mod edit -module github.com/dgerrese/ThatApp`, then replace the import prefix in every `.go` file.
- [ ] **Step 2:** `git grep -n 'codeberg.org/DionGerrese/ThatApp' -- '*.go' go.mod` prints nothing.
- [ ] **Step 3:** `make verify` green (no RED: a rename has no behaviour to fail; the gate is the test).
- [ ] **Step 4:** Commit `refactor(#46): the Go module is github.com/dgerrese/ThatApp`.

### Task 2: Remove the move notice

**Files:** `web/index.html` (the `<div data-moved>` block), `.claude/e2e/tests/rail-version.spec.ts` (the move `describe` and `MOVED_LINK`), `web/src/rail-version.test.ts` (the repaint-keeps-the-block test), `.claude/e2e/tests/instance-dot.spec.ts` (the extra Tab stop #349 added).

- [ ] **Step 1:** Change the instance-dot Tab count back and add one e2e assertion: `[data-moved]` has count 0 on `/today`. RED on that assertion.
- [ ] **Step 2:** Delete the block and the move-only tests. Keep `#rail-version`'s `relative` class (it fixes the sr-only escape for #348's link).
- [ ] **Step 3:** GREEN; mutation: put the block back, see the new assertion fail, restore.
- [ ] **Step 4:** Screenshot pair (dark, light) of the rail foot with a failed check line and the version, compared with rail three of the mockup `.superpowers/brainstorm/219294-1795019192/content/foot-states-v2.html`. Report what was compared.
- [ ] **Step 5:** `make verify` and `make test-e2e` green. Commit `feat(#46): the rail foot drops the move notice`.

### Task 3: CI workflow

**Files:** Create `.github/workflows/ci.yml`. Delete `.forgejo/`. Modify `Makefile` (an `E2E_ARGS ?=` passed to `npx playwright test`, so CI can split by browser), `.claude/e2e/playwright.config.ts` (the worker-count comment names `codeberg-medium`; restate it for GitHub's `ubuntu-latest`, keep the number unless measurement says otherwise).

**Interfaces:** Produces the job names in Global Constraints; `Quality gate` is the required check the owner sets.

- [ ] **Step 1:** Write `ci.yml` to the Global Constraints. Prep jobs build the Compose images (`app`, `web`, and the `playwright` profile for `e2e`) with Buildx, into the `gha` cache; check jobs restore from it. `e2e` is a matrix over `firefox` and `chromium` through `E2E_ARGS=--project=<browser>`, `fail-fast: false`, uploads `.claude/e2e/test-results/` on failure. `concurrency` cancels superseded runs of the same ref.
- [ ] **Step 2:** `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.7` clean.
- [ ] **Step 3 (controller):** push the branch to `github` and open the pull request as a draft. Read every job's result and duration with `gh run view`. Then the two Review Focus probes: a docs-only commit (all checks skipped, gate passes) and a failing commit (gate fails), each reverted.
- [ ] **Step 4:** Fix rounds until the run is green and the probes behave. Commit `ci(#46): one CI workflow behind a Quality gate, running the make targets`.

### Task 4: Release workflow

**Files:** Create `.github/workflows/release.yml`, `scripts/next-version.sh`, `scripts/next-version_test.sh`. Modify `scripts/release-image.sh` (comments only: it no longer runs on Codeberg; behaviour unchanged), `Makefile` (`test-scripts` runs `next-version_test.sh` in the `app` container; `test` depends on it), and `ci.yml` (a `release-dry-run` job on the `code` flag running `make image`, needed by `Quality gate`).

**Interfaces:** `scripts/next-version.sh DATE` reads tag names on stdin, prints `YYYY.WW.N`. `DATE` is `YYYY-MM-DD`.

- [ ] **Step 1:** `next-version_test.sh` cases: no tags → `2026.47.1` for `2026-11-19`; tags `v2026.47.1 v2026.47.2 v2026.46.9` → `2026.47.3`; `2027-01-04` → `2027.01.1`; `2026-12-31` → `2026.53.1`; non-matching tags ignored. RED.
- [ ] **Step 2:** Implement with `date -d "$DATE" +%G.%V`. GREEN, then mutation on the `+1` and on `%G`.
- [ ] **Step 3:** `release.yml`: `on: push: branches [main]` and `on: milestone: types [closed]`. The push path skips when `git diff --name-only ${{ github.event.before }} ${{ github.sha }}` has no `code` file (same rule as `Changed files`). Both paths: `make build-web`, then `docker compose run --build --rm --no-deps -e REGISTRY_USER -e REGISTRY_TOKEN app sh scripts/release-image.sh "$VERSION" ghcr.io/dgerrese/thatapp [stable]`, then `gh release create "v$VERSION" --target "$SHA"` with `--prerelease` and the merged pull request's title as notes on the push path, or the milestone's closed issues as notes on the milestone path. `permissions: contents: write, packages: write`. `concurrency: release` (never two at once, so `N` cannot collide).
- [ ] **Step 4:** actionlint clean; `make verify` green; the CI run's `release-dry-run` green (controller).
- [ ] **Step 5:** Commit `ci(#46): CI publishes a pre-release per merge and a stable release per closed milestone`.

### Task 5: README

**Files:** `README.md`, `Makefile` (the `image` comment says "instead of Codeberg").

- [ ] **Step 1:** Replace every image reference with `ghcr.io/dgerrese/thatapp`. Add `## Moving from Codeberg` per Global Constraints, placed before `### 3. Upgrade`'s parent section ends so the anchor is `#moving-from-codeberg`. Say how releases now appear (a pre-release per merge, a stable per closed milestone) where the README described the old ones.
- [ ] **Step 2:** `git grep -n -i codeberg -- README.md Makefile` shows only the Moving section's old image name.
- [ ] **Step 3:** Commit `docs(#46): the README names ghcr.io and explains the move`.

### After the tasks (controller)

- Whole-branch review with ponytail-review; one fix wave.
- Mark the pull request ready. Body: `Closes #46`, the job-time table from the last green run, both screenshots, local gate output.
- The owner sets `Quality gate` as the required check and makes the `ghcr.io` package public after the first release.
