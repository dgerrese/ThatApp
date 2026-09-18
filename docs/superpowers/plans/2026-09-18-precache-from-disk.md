# Precache from disk (#67) Implementation Plan

**Date:** 2026-09-18
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The service worker's precache list always names exactly what the `dist/app.js` on disk reaches, whoever built it, and a build that finds a mismatch says so loudly.

**Architecture:** `buildWorker` stops taking a metafile. It walks the import graph of `dist/app.js` *as it is on disk* — static `from"./x.js"`, bare `import"./x.js"` and dynamic `import("./x.js")` — and precaches what it reaches plus the copied assets. `lastMetafile` goes away, because nothing needs a metafile any more. The graph walk is a pure function in `web/tools/`, unit-tested the way `unused-tokens.mjs` already is. A reference to a file that is not on disk is an error: fatal in a one-off build, logged in watch mode.

**Tech Stack:** Node (ESM), esbuild, node:test.

**Spec:** Codeberg issue #67 — `tea api "repos/{owner}/{repo}/issues/67"`.

## Global Constraints

- No Go, Node or npm on the host; everything runs through `make` or `docker compose` (`docker compose run --rm --no-deps web …` for one-off Node commands).
- No new dependency.
- The owner's dev stack (`app`, `web`) is running and is theirs: **never** run `make down` and never stop, restart or recreate `app` or `web`. The reproduction below runs in throwaway containers only.
- `make verify` and `make test-e2e` green; `pwa.spec.ts` included (#134's intermittent chromium segfault: re-run once and report both runs).
- Comments are few and explain a non-obvious why.
- Commit unsigned with `git -c commit.gpgsign=false commit …` if signing fails; **never push**.

---

### Task 1: Derive the precache list from the app on disk

**Files:**
- Create: `web/tools/reachable-files.mjs`, `web/tools/reachable-files.d.mts`
- Create: `web/src/reachable-files.test.ts`
- Modify: `web/build.mjs` (`jsOptions.metafile`, `buildWorker`, the watch plugin, the `sw.ts` watcher, the one-off build branch, and the comments that describe the metafile)

**Interfaces:**
- Produces: `reachableFiles(entry: string, read: (file: string) => string | undefined): { files: string[]; missing: Array<{ file: string; from: string }> }`. `files` is sorted and includes `entry`. `read` returns `undefined` for a file that does not exist. Paths are relative to the directory the entry lives in, and joined as `./`-relative specifiers are resolved (only `./name.js` specifiers occur in esbuild's output here; anything else is ignored).

- [ ] **Step 1: Write the failing unit tests**

`web/src/reachable-files.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { reachableFiles } from "../tools/reachable-files.mjs";

function reader(files: Record<string, string>): (file: string) => string | undefined {
  return (file) => files[file];
}

test("static, bare and dynamic imports are all followed, transitively", () => {
  const result = reachableFiles(
    "app.js",
    reader({
      "app.js": 'import{C as e}from"./chunk-A.js";import"./chunk-B.js";import("./chunk-C.js");',
      "chunk-A.js": 'var x=()=>import("./chunk-D.js");',
      "chunk-B.js": "",
      "chunk-C.js": 'export{y}from"./chunk-A.js";',
      "chunk-D.js": "",
    }),
  );

  assert.deepEqual(result.files, ["app.js", "chunk-A.js", "chunk-B.js", "chunk-C.js", "chunk-D.js"]);
  assert.deepEqual(result.missing, []);
});

test("a chunk on disk that nothing imports is not precached", () => {
  const result = reachableFiles(
    "app.js",
    reader({ "app.js": 'import"./chunk-A.js";', "chunk-A.js": "", "chunk-STALE.js": "" }),
  );

  assert.deepEqual(result.files, ["app.js", "chunk-A.js"]);
});

test("an import of a file that is not on disk is reported with who imported it", () => {
  const result = reachableFiles("app.js", reader({ "app.js": 'import("./chunk-GONE.js");' }));

  assert.deepEqual(result.missing, [{ file: "chunk-GONE.js", from: "app.js" }]);
  assert.deepEqual(result.files, ["app.js"]);
});
```

Run: `docker compose run --rm --no-deps web node --test src/reachable-files.test.ts`
Expected: FAIL — cannot find module `../tools/reachable-files.mjs`.

- [ ] **Step 2: Write the graph walk**

`web/tools/reachable-files.mjs`:

```js
// esbuild's minified ESM output names its siblings in exactly three shapes:
// `from"./x.js"`, `import"./x.js"` and `import("./x.js")`.
const SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*["']\.\/([\w.-]+\.js)["']/g;

/**
 * Every file `entry` reaches through relative imports, read through `read`
 * (undefined for a file that does not exist). Derived from what is actually on
 * disk, so it cannot disagree with the build that wrote it — the failure #67
 * was about.
 */
export function reachableFiles(entry, read) {
  const seen = new Set([entry]);
  const missing = [];
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.shift();
    const source = read(file);
    if (source === undefined) continue;

    for (const match of source.matchAll(SPECIFIER)) {
      const target = match[1];
      if (seen.has(target)) continue;
      seen.add(target);
      if (read(target) === undefined) {
        missing.push({ file: target, from: file });
        continue;
      }
      queue.push(target);
    }
  }

  const files = [...seen].filter((file) => !missing.some((gone) => gone.file === file)).sort();

  return { files, missing };
}
```

`web/tools/reachable-files.d.mts`:

```ts
export declare function reachableFiles(
  entry: string,
  read: (file: string) => string | undefined,
): { files: string[]; missing: Array<{ file: string; from: string }> };
```

Run the tests again. Expected: 3/3 PASS.

- [ ] **Step 3: Reproduce the bug before touching `build.mjs`**

**In a copy of `web/` inside a throwaway container — never in the bind-mounted `web/` itself.** The
owner's running `web` watcher serves the bind-mounted `web/dist` and watches `web/src`; building or
touching files there would reproduce #67 on the owner's own stack. Every experiment in Steps 3 and 5
starts from this copy:

```shell
docker compose run --rm --no-deps web sh -c '
  mkdir /tmp/w && cd /src/web &&
  cp -r src tools fonts icons index.html manifest.json build.mjs package.json /tmp/w/ &&
  ln -s /src/web/node_modules /tmp/w/node_modules && mkdir /tmp/w/dist && cd /tmp/w &&
  npm run build >/dev/null &&
  (node build.mjs --watch >/tmp/watch.log 2>&1 &) && sleep 20 &&
  npm run build >/dev/null &&
  touch src/sw.ts && sleep 5 &&
  node -e "<print the precache list from dist/sw.js and the chunks dist/app.js reaches, and whether they match>"'
```

Write the `node -e` check yourself (it may import `tools/reachable-files.mjs`; extract the precache
array from `dist/sw.js` by locating the define'd JSON array). Expected before the fix: **mismatch** —
the watcher's `sourcemap: true` build and the one-off build hash chunks differently, and the `sw.ts`
rebuild reuses the watcher's stale metafile. Paste the result. If it matches, report that honestly
and say which part of #67's story did not reproduce; do not stop — the fix below is still what the
acceptance criteria require.

While in there, answer the question #67 asks and record it in the report: after an external build
has overwritten `dist/app.js`, does the esbuild watch context's next rebuild rewrite `dist/app.js`
even if its own output is unchanged? (Edit a `.ts` file trivially and back, and compare mtimes.)

- [ ] **Step 4: Rewire `build.mjs`**

- Remove `metafile: true` from `jsOptions`, and its comment.
- `buildWorker(assetPaths)` — no metafile parameter. It computes
  `reachableFiles("app.js", (file) => { try { return readFileSync(\`dist/${file}\`, "utf8"); } catch { return undefined; } })`.
  If `missing` is non-empty it **throws** an `Error` naming every `file` and the `from` that imports
  it (message starts `precache: dist/app.js reaches files that are not on disk:`). Otherwise the
  outputs are `files.map((file) => \`dist/${file}\`)` plus `assetPaths`, sorted — then the existing
  hash and `esbuild.build` exactly as today.
- The watch plugin's `onEnd` calls `buildWorker(assetPaths)` and, on error, logs it with
  `console.error` and returns (the watcher must keep running). Remove `lastMetafile` and its comment.
- The `sw.ts` watcher calls `buildWorker(assetPaths)` with the same `console.error` handling; its
  `if (!lastMetafile) return;` goes.
- The one-off branch: `await esbuild.build(jsOptions); await buildWorker(assetPaths);` — an error
  propagates and fails the build (non-zero exit).
- Rewrite the comment block above `buildWorker` so it says the list is read from what `dist/app.js`
  reaches on disk, and why (#67), instead of describing `metafile.outputs`.

- [ ] **Step 5: Show the reproduction passing**

Re-run Step 3's sequence, then also touch any other `.ts` file and re-check. Expected: a match
after every step.

Then prove the loud failure, in the same kind of copy (a fresh throwaway container, with this
branch's `build.mjs`): start `node build.mjs --watch` in the
background, wait for it to settle, append `import("./chunk-GONE.js");` to `dist/app.js`, `touch
src/sw.ts`, wait, and show the watch log carrying the `precache: dist/app.js reaches files that are
not on disk:` error naming `chunk-GONE.js` and `app.js` — and the watcher still running afterwards.
Paste all output.

- [ ] **Step 6: Gates**

`make verify` then `make test-e2e`. Expected: `verify: OK`; suite green including `pwa.spec.ts`.
`make build-web` must also succeed (paste its tail).

- [ ] **Step 7: Commit**

```bash
git add web/tools/reachable-files.mjs web/tools/reachable-files.d.mts web/src/reachable-files.test.ts web/build.mjs
git commit -m "fix(#67): the worker precaches what dist/app.js reaches on disk, not a stale metafile"
```
