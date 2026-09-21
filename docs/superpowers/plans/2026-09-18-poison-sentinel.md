# Poison sentinel (#102) Implementation Plan

**Date:** 2026-09-18
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The service worker's poisoned-response test uses a sentinel that cannot occur in a bundle by accident.

**Architecture:** One named constant in `.claude/e2e/tests/pwa.spec.ts`, used for the stubbed body and both assertions, replacing the three-letter `lie`. A sweep of the other specs for the same shape.

**Tech Stack:** Playwright.

**Spec:** Codeberg issue #102 — `tea api "repos/{owner}/{repo}/issues/102"`.

## Global Constraints

- No Go, Node or npm on the host; everything runs through `make` or `docker compose`.
- The test's intent and the service worker are unchanged; only the sentinel moves.
- The owner's dev stack (`app`, `web`) is theirs: never `make down`, never stop/restart/recreate it.
- Comments are few and explain a non-obvious why.
- Commit unsigned with `git -c commit.gpgsign=false commit …` if signing fails; **never push**.

---

### Task 1: A sentinel no bundle contains

**Files:**
- Modify: `.claude/e2e/tests/pwa.spec.ts` (`a runtime response whose content type contradicts its path is served but never cached`)

**Interfaces:** none.

- [ ] **Step 1: Replace the sentinel**

Near the top of the test (or at module level beside the other helpers, if another test would use it),
add:

```ts
// A token no bundle contains by accident. The first version of this test used
// "lie", which "client", "believe" and "applied" all contain — #102.
const POISON = "THATAPP-POISON-SENTINEL-7f3a";
```

Use it in the stub body (`` `<!doctype html><title>${POISON}</title>` ``), in
`expect(served).toContain(POISON)`, and in the cache check
(`!(await cached.text()).includes(POISON)` — pass it into `page.evaluate` as an argument, since the
callback runs in the page).

- [ ] **Step 2: Prove the test still guards the worker**

Run the test on Chromium (it is Chromium-only by an existing, correct skip): PASS.

**Break:** in `web/src/sw.ts`, find the runtime path that `/app.js` actually takes (read the fetch
router — it may be `cacheFirst` or another strategy) and remove its content-type check
(`answersAsExpectedType(...)`) so the lying response would be cached. The running `web` watcher
rebuilds `dist/` from `web/src` on save; wait for `dist/sw.js` to change before running. Run the test:
FAIL at `cacheKeptTheGoodCopy`. Restore `sw.ts` with `git checkout -- web/src/sw.ts`, wait for the
rebuild, run again: PASS. Paste both runs and the exact edit.

If after restoring the offline-shell tests in `pwa.spec.ts` fail with `toBeGreaterThan`, the watcher
has left `dist/sw.js` out of step with `app.js` (#67): run `make build-web` once and say so.

- [ ] **Step 3: Sweep the other specs**

`grep -n 'includes("\|toContain("' .claude/e2e/tests/*.ts` and read each hit whose argument is a
short, ordinary string matched against a *stubbed body or bundle text* (not against visible UI copy,
which is exact by design). Report every hit you looked at and your verdict. Fix any that has the same
collision shape; if there are none, say so.

- [ ] **Step 4: Gates**

`make verify`, then `make test-e2e`. `pwa.spec.ts` has #134's intermittent chromium segfault: re-run
once and report both runs.

- [ ] **Step 5: Commit**

```bash
git add .claude/e2e/tests/pwa.spec.ts
git commit -m "test(#102): the poisoned-response test uses a sentinel no bundle contains"
```
