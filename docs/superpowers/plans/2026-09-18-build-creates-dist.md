# Build creates dist (#40) Implementation Plan

**Date:** 2026-09-18
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `web/build.mjs` builds from a missing `dist/` instead of depending on the tracked `.gitkeep`.

**Architecture:** One `mkdirSync("dist", { recursive: true })` before the first write into `dist/`.

**Tech Stack:** Node (ESM).

**Spec:** Codeberg issue #40 — `tea api "repos/{owner}/{repo}/issues/40"`.

## Global Constraints

- No Go, Node or npm on the host; `make` / `docker compose`.
- **Experiments run in a copy of `web/` under a throwaway container's `/tmp` — never `rm -rf` the bind-mounted `web/dist`.** The owner's running `web` watcher serves it.
- `web/dist/.gitkeep` stays tracked (the Go embed needs the directory for a build with no frontend).
- The owner's dev stack (`app`, `web`) is theirs: never `make down`, never stop/restart/recreate it.
- Commit unsigned with `git -c commit.gpgsign=false commit …` if signing fails; **never push**.

---

### Task 1: Create dist before writing into it

**Files:**
- Modify: `web/build.mjs`

- [ ] **Step 1: Show the failure (RED), in a copy**

```shell
docker compose run --rm --no-deps web sh -c '
  mkdir /tmp/w && cd /src/web &&
  cp -r src tools fonts icons index.html manifest.json build.mjs package.json /tmp/w/ &&
  ln -s /src/web/node_modules /tmp/w/node_modules && cd /tmp/w &&
  node build.mjs; echo "exit=$?"'
```

(`/tmp/w` has no `dist/` at all.) Expected: fails with `ENOENT` on `dist/index.html`, non-zero exit.
Paste.

- [ ] **Step 2: Fix**

In `web/build.mjs`, add `mkdirSync("dist", { recursive: true });` immediately before the
`const assetPaths = [...copyShell(), …]` line (`mkdirSync` is already imported). No comment needed
beyond one short line if you want one: `// dist/ may not exist yet — see #40.`

- [ ] **Step 3: GREEN, in a copy**

Re-run Step 1's command with this branch's `build.mjs` (it copies from `/src/web`, which is the
branch). Expected: `exit=0`, and `ls /tmp/w/dist` shows `index.html`, `app.js`, `sw.js`. Then the watch
mode from a missing `dist/`: same copy recipe, `timeout 30 node build.mjs --watch`, and show it
reaches "watching for changes" without an error. Paste both.

- [ ] **Step 4: Gates**

`make verify` and `make build-web`. Expected: green.

- [ ] **Step 5: Commit**

```bash
git add web/build.mjs
git commit -m "fix(#40): the build creates dist/ instead of relying on a tracked .gitkeep"
```
