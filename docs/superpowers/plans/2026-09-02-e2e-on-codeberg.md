# E2E on Codeberg's Runners Implementation Plan

**Date:** 2026-09-02
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `.forgejo/workflows/e2e.yml` complete green on Codeberg, and make its trace upload
work when it does not.

**Architecture:** Two independent one-line-ish changes to two files, and no product code at all.
Playwright sizes its worker pool as `Math.ceil(os.cpus().length / 2)`. Inside a Forgejo runner
`os.cpus()` reports the *host's* logical cores, not the cgroup's share, so on `codeberg-medium`
(4 CPU / 8G) the suite launched sixteen browsers onto four CPUs. Firefox is far heavier per
instance than Chromium, which is why all five failures and five of the six flakes were Firefox
while Chromium sailed through. The fix is to stop asking Playwright to guess. Separately, the
trace-upload step uses an action that refuses to run against a Forgejo instance at all.

**Tech Stack:** Playwright 1.x, Forgejo Actions, `codeberg-medium` runners.

## Global Constraints

- **Nothing is weakened to reach green.** `retries` stays at 1. No test is skipped, deleted,
  given a longer timeout, or marked flaky. If capping concurrency is not enough, that is a
  finding to report, not a threshold to move.
- **Local behaviour must not change.** `make test-e2e` runs with `CI` unset (docker-compose.yml
  forwards `CI: "${CI:-}"` from the host, which is empty), so every change here is inside a
  `process.env.CI` branch. The host has 20 cores, so an uncapped local run reports 10 workers.
- **CI and the Makefile are kept in step by hand.** Neither change here has a Makefile counterpart
  — the worker cap is inside the shared config and keys off `CI`; the action swap is CI-only — but
  say so rather than assuming it.
- **No JavaScript beyond the config file.** No new dependency, no script, no helper module.
- The 10-minute job cap on `codeberg-medium` is real. The failing run spent about 1m40s in setup
  and 3m18s in tests, so a slower-but-correct suite has roughly eight minutes of room.

---

## Task 1: Cap Playwright's worker pool under CI

**Files:** `.claude/e2e/playwright.config.ts`

### Step 1: Observe the wrong number (RED)

- [ ] Run `CI=true make test-e2e` and read the first line of Playwright's output. It reports
      `Running 222 tests using 10 workers` on this 20-core host — the count is derived from the
      machine, not from the config. Paste that line into the task report.

### Step 2: Pin the count

- [ ] In `.claude/e2e/playwright.config.ts`, add a `workers` entry to the `defineConfig` object,
      beside the existing `retries` and `reporter` entries that already branch on `CI`:

```ts
  // Playwright sizes its pool as half of `os.cpus()`, and inside a Forgejo
  // runner that call reports the *host's* logical cores rather than the
  // cgroup's share — on codeberg-medium (4 CPU / 8G) it asked for sixteen
  // browsers. Chromium survived it; sixteen Firefox profiles on four CPUs did
  // not, and the suite failed on timeouts and lost browser contexts. Pin the
  // pool to the runner's real size. Unset locally, where the default is right.
  workers: process.env.CI ? 4 : undefined,
```

- [ ] Keep the entry adjacent to the other `CI` branches so the three read as one group.

### Step 3: Observe the right number (GREEN)

- [ ] Run `CI=true make test-e2e` again. The first line must read
      `Running 222 tests using 4 workers`, and the suite must finish green. Paste both the worker
      line and the final summary into the task report.
- [ ] Run `make test-e2e` with `CI` unset. The worker line must go back to 10, proving the cap is
      CI-only. Paste that line.

### Step 4: Commit

- [ ] `git add .claude/e2e/playwright.config.ts && git commit`, message subject
      `fix(#87): pin Playwright's worker pool to the runner's real CPU count`.

---

## Task 2: Use Forgejo's fork of upload-artifact

**Files:** `.forgejo/workflows/e2e.yml`

### Step 1: Understand what fails

- [ ] The `Upload traces on failure` step uses
      `https://data.forgejo.org/actions/upload-artifact@v4`, which aborts with
      `::error::@actions/artifact v2.0.0+, upload-artifact@v4+ and download-artifact@v4+ are not
      currently supported on GHES.` The action detects a non-github.com API and refuses. Because
      the step is `if: failure()`, it only runs when there is something worth keeping, which is
      why this went unnoticed until 2026-09-02.

### Step 2: Swap the action and say why

- [ ] Change the `uses:` to `https://data.forgejo.org/forgejo/upload-artifact@v4`. The tag exists;
      `git ls-remote --tags https://data.forgejo.org/forgejo/upload-artifact` lists `v4` alongside
      `v4.3.1` and `v5`. Re-run that command and paste its output rather than trusting this line.
- [ ] Add a comment above the step recording that the `actions/` build refuses to run against a
      Forgejo instance, so the fork is not a preference but the only version that runs here.
- [ ] Change nothing else about the step: same `name`, same `if: failure()`, same `path`.

### Step 3: Verify what can be verified locally

- [ ] The step cannot be exercised locally — it needs a failing CI run. Confirm the file still
      parses as YAML and that the only diff is the `uses:` line plus the new comment:
      `git diff .forgejo/workflows/e2e.yml`. Paste the diff.
- [ ] Confirm no Makefile target references `upload-artifact`, so there is no mirror to keep in
      step: `grep -rn upload-artifact Makefile docker-compose.yml` must find nothing.

### Step 4: Commit

- [ ] `git add .forgejo/workflows/e2e.yml && git commit`, message subject
      `fix(#87): upload traces through Forgejo's fork of upload-artifact`.

---

## Verification

The gate for this ticket is a CI run, not a local command, because the defect only exists on the
runner. After both tasks and the whole-branch review:

- [ ] `make verify` is green. It touches none of this, and that is the point — say so.
- [ ] `make test-e2e` is green locally with `CI` unset.
- [ ] Push and open the pull request, then read the E2E run on it. Green with zero failed and zero
      flaky is the acceptance criterion. Anything less is a finding for the owner, not a reason to
      loosen the suite.

## Self-Review

| Acceptance criterion | Task |
|---|---|
| E2E completes green on Codeberg, nothing failed or flaky | Verification |
| `make test-e2e` stays green locally, worker count unchanged | Task 1 Step 3 |
| `workers` capped only under `CI`, with a comment naming the runner's four CPUs | Task 1 Step 2 |
| Trace upload succeeds on a failing run, or is removed with the reason recorded | Task 2 |
| The job stays inside the 10-minute cap | Verification |
| Nothing skipped, weakened, deleted or retried harder; `retries` stays 1 | Global Constraints |
