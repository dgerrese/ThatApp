# A CSS-only edit rebuilds the worker (#164) Implementation Plan

**Date:** 2026-09-23
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** In watch mode, every rewrite of `dist/app.css` by Tailwind's watcher rebuilds
`dist/sw.js`, so the worker's build id and precache follow a CSS-only edit.

**Architecture:** One more directory watch in `web/build.mjs`, the same shape as the two already
there (`index.html`, `src/sw.ts`): watch `dist/`, filter to `app.css`, debounce 50 ms, call
`buildWorker(assetPaths)`, log a failure with `console.error` and keep watching. Tailwind's own
watcher stays untouched — the issue rejects replacing it.

**Tech Stack:** Node (`node:fs` `watch`), esbuild, Tailwind CLI — all run inside the `web`
container, never on the host.

**Spec:** Codeberg issue #164 (problem, approach, acceptance criteria).

## Global Constraints

- Docker only: never run node/npm bare on the host; use `make` or `docker compose`.
- Watch-mode only. The non-watch build, CI and the release image are out of scope.
- Directory watch, not a file watch (an editor's write-and-rename save orphans a file watch).
- 50 ms debounce, `console.error` on failure, watcher keeps running.
- No automatic test: the issue asks for a manual run showing the build id before and after a
  `styles.css`-only edit under `make up`.

## Review Focus

- `buildWorker` writing `dist/sw.js` (and `sw.js.map`) inside the watched `dist/` must not
  retrigger itself — the filter must admit `app.css` only.
- A `buildWorker` rejection on this path (e.g. a missing chunk mid-rebuild) must be caught, logged
  and must not kill the process.
- Tailwind may write `app.css` in more than one event (truncate + write); the debounce must
  collapse them into one rebuild.
- `dist/` must exist before `watchPath("dist", …)` is called — `mkdirSync("dist")` already runs
  before the watch branch.

---

### Task 1: Watch `dist/app.css` and rebuild the worker

**Files:**
- Modify: `web/build.mjs` (watch branch, after the `src/sw.ts` watch block)

**Interfaces:**
- Consumes: `buildWorker(assetPaths)` and `watchPath` already in `web/build.mjs`.
- Produces: nothing new.

- [ ] **Step 1: Record the RED manual run (before the change)**

With the dev stack's `web` service running the current `build.mjs` (restart it with
`docker compose restart web` so it runs from the checkout), read the build id:

```shell
grep -oE 'that-shell-[0-9a-f]{16}' web/dist/sw.js | head -1
```

Make a `styles.css`-only edit that changes the CSS output — append to `web/src/styles.css`:

```css
/* #164 probe */
.probe-164 { color: red; }
```

Wait ~3 s, confirm `web/dist/app.css` changed (`grep -c probe-164 web/dist/app.css` → 1, or the
file's mtime moved), and read the build id again. Expected: **unchanged** — the bug.
Revert the probe edit (`git checkout web/src/styles.css`).

- [ ] **Step 2: Add the watch**

After the `watchPath("src", …)` block in `web/build.mjs`, add:

```js
  // Tailwind's watcher writes app.css on its own, outside esbuild, so none of the
  // hooks above sees a CSS-only edit and the worker kept a stale build id and a
  // stale precached app.css (#164). Watching the output rather than Tailwind
  // catches every rewrite whatever caused it.
  let pendingCss;
  watchPath("dist", (_event, filename) => {
    if (filename !== "app.css") return;
    clearTimeout(pendingCss);
    pendingCss = setTimeout(() => {
      buildWorker(assetPaths).catch((err) => {
        console.error(`rebuilding the worker after app.css changed failed: ${err.message}`);
      });
    }, 50);
  });
```

- [ ] **Step 3: Record the GREEN manual run (after the change)**

`docker compose restart web`, wait for "watching for changes" in `docker compose logs web`, then
repeat Step 1 exactly. Expected: the build id **changes** after the probe edit, and changes again
(back to the original value) after reverting it.

- [ ] **Step 4: Check the failure path does not stop the watcher**

Reasoned from the code, not a new test: the rebuild's only failure mode is a rejected
`buildWorker` promise, caught by `.catch` → `console.error`. The watcher callback itself does not
throw. Confirm by reading the diff; say so in the report.

- [ ] **Step 5: Gates**

```shell
make lint
make verify
```

Both green.

- [ ] **Step 6: Commit**

```shell
git add web/build.mjs
git commit -m "fix(web): rebuild the worker when Tailwind rewrites app.css (#164)"
```
