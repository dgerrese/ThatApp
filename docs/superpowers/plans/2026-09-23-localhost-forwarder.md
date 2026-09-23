# Localhost forwarder for the e2e rig (#66) Implementation Plan

**Date:** 2026-09-23
**Supersedes:** `docs/superpowers/plans/2026-09-18-localhost-forwarder.md` on the unmerged branch
`issue-66-localhost-forwarder` — same design, rebuilt on current `main` (Playwright 1.63.0, #35's
`that-e2e` alias).
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Both browsers in the e2e rig load the app from a genuine `http://localhost`, so Firefox
gets a real secure context and its two `window.caches` tests run.

**Architecture:** When the rig's upstream (`THAT_BASE_URL`) is not already local, Playwright's own
`webServer` option starts a ~20-line TCP forwarder (`node:net`, no dependency) inside the Playwright
container: `127.0.0.1:8080` → the upstream host and port. Both projects use `http://localhost:8080`
as their base URL, and the per-engine workarounds — Chromium's `--host-resolver-rules`, Firefox's
`dom.securecontext.allowlist` — are deleted. In CI `THAT_BASE_URL` is already
`http://localhost:8080`, so no forwarder starts and nothing in the workflow changes.

**Tech Stack:** Node `node:net`, Playwright 1.63.0 `webServer`.

**Spec:** Codeberg issue #66 — `tea api "repos/{owner}/{repo}/issues/66"`, including the
2026-09-23 comment (re-measure Chromium's crash rate against `main`).

## Global Constraints

- No Go, Node or npm on the host; everything runs through `make` or `docker compose`.
- No new dependency. No TLS.
- **Fallback:** if `window.caches` still throws on Firefox through the forwarder, **stop and
  report**. TLS is the owner's call and is not attempted.
- Every remaining Firefox skip in `pwa.spec.ts` keeps naming the Playwright limit it rests on. Only
  the two `window.caches throws SecurityError` skips are removed — removed, not loosened.
- CI's e2e workflow passes unchanged; `.forgejo/workflows/e2e.yml`'s `paths:` must still name every
  file the rig depends on (`forward.mjs` sits under `.claude/e2e/**`, already covered).
- The owner's dev stack (`app`, `web`) is theirs: never `make down`, never stop or recreate it.
- Comments are few and explain a non-obvious why.
- Commit unsigned with `git -c commit.gpgsign=false commit …` if signing fails; **never push**.

## Focused run command

`make test-e2e` runs the whole suite. For a focused run, mirror its recipe:

```bash
docker compose --profile e2e rm --stop --force app-e2e
docker compose --profile e2e run --build --rm playwright sh -c \
  'npm ci --no-audit --no-fund && npx playwright test tests/pwa.spec.ts --project=firefox -g "activation evicts|never cached"'
docker compose --profile e2e rm --stop --force app-e2e
```

---

### Task 1: Give both engines a real localhost

**Files:**
- Create: `.claude/e2e/forward.mjs`
- Modify: `.claude/e2e/playwright.config.ts`
- Modify: `.claude/e2e/tests/pwa.spec.ts` (two skips and the comment they cite)
- Modify: `.claude/e2e/README.md`

**Interfaces:** Produces `forward.mjs`, configured through `THAT_UPSTREAM` (required, a URL) and
`THAT_FORWARD_PORT` (default `8080`). These are the rig's own process env, not app configuration —
they never reach `.env.example`.

- [ ] **Step 1: Unskip the two cache tests (RED)**

In `pwa.spec.ts`, in `activation evicts stale caches and leaves exactly the two current-build
ones…` and `a cache-first miss answered by the SPA fallback is served but never cached`: delete the
`test.skip(browserName !== "chromium", "window.caches throws SecurityError …")` call and drop
`browserName` from the parameter list (neither test uses it otherwise). Delete the comment block
above the eviction test that begins `// window.caches is unavailable to this test in Firefox`.

Run the focused command above. Expected: both FAIL on Firefox with `SecurityError` / "The operation
is insecure." from `window.caches`. Paste the output.

- [ ] **Step 2: Write the forwarder**

`.claude/e2e/forward.mjs`:

```js
// Gives the browsers a genuine http://localhost (#66). A service worker and
// window.caches need a secure context, and plain HTTP only has one on
// localhost — per-engine flags that fake it for another hostname either miss
// CacheStorage (Firefox) or only reach the browser, not Node (Chromium).
import net from "node:net";

if (!process.env.THAT_UPSTREAM) {
  throw new Error("THAT_UPSTREAM is required — set by playwright.config.ts's webServer.env");
}
const upstream = new URL(process.env.THAT_UPSTREAM);
const listenPort = Number(process.env.THAT_FORWARD_PORT ?? "8080");

net
  .createServer((client) => {
    const server = net.connect(Number(upstream.port || 80), upstream.hostname);
    client.pipe(server).pipe(client);
    client.on("error", () => server.destroy());
    server.on("error", () => client.destroy());
  })
  .listen(listenPort, "127.0.0.1");
```

If an engine resolves `localhost` to `::1` and is refused, listen on both families and say which was
needed.

- [ ] **Step 3: Rewire the config**

In `playwright.config.ts`:

- Rename `baseURL` to `upstream` in the existing `THAT_BASE_URL ?? "http://that-e2e:8080"` line;
  keep the `that-e2e` comment above it.
- Replace the per-engine comment block and the `hostname`/`port`/`localhostURL` lines with:

```ts
// The service worker (#12) and window.caches only work in a secure context,
// and plain http:// on a Compose alias is not one — browsers special-case only
// localhost. forward.mjs (#66) gives both engines a genuine http://localhost
// by forwarding TCP to the upstream; it does not start when the upstream is
// already local (CI sets THAT_BASE_URL=http://localhost:8080).
const upstreamIsLocal = ["localhost", "127.0.0.1"].includes(new URL(upstream).hostname);
const baseURL = upstreamIsLocal ? upstream : "http://localhost:8080";
```

- After `workers`, add:

```ts
  webServer: upstreamIsLocal
    ? undefined
    : {
        command: "node forward.mjs",
        port: 8080,
        reuseExistingServer: false,
        env: { THAT_UPSTREAM: upstream, THAT_FORWARD_PORT: "8080" },
      },
```

- Projects become `{ name: "firefox", use: { ...devices["Desktop Firefox"] } }` and
  `{ name: "chromium", use: { ...devices["Desktop Chrome"] } }` — no `launchOptions`, no per-project
  `baseURL`.

- [ ] **Step 4: Run the two tests again (GREEN)**

Focused command, both projects (drop `--project`). Expected: PASS on Firefox and Chromium. If
Firefox still throws on `window.caches`: **stop** (Fallback). Paste the output.

- [ ] **Step 5: README**

Add a section `## Why the browsers load localhost` to `.claude/e2e/README.md`, after the
`that-e2e` section: what `forward.mjs` does and why (secure context; Firefox's allowlist pref left
`window.caches` throwing `SecurityError`, Chromium's `--host-resolver-rules` only remapped the name
inside the browser, so Node-side requests could not follow it), and that it does not start when
`THAT_BASE_URL` already names localhost, which is how CI runs.

- [ ] **Step 6: Commit**

```bash
git add .claude/e2e/forward.mjs .claude/e2e/playwright.config.ts .claude/e2e/tests/pwa.spec.ts .claude/e2e/README.md
git commit -m "test(#66): the e2e rig gives both browsers a real localhost, so Firefox cache tests run"
```

### Task 2: Stale workaround comments outside the config

**Files:**
- Modify: `.claude/e2e/tests/tooltip.spec.ts` (doc comment, ~lines 55-61)
- Modify: `.claude/e2e/tests/router.spec.ts` (~lines 50-56)
- Modify: `.claude/e2e/tests/smoke.spec.ts` (~lines 33-40)
- Modify: `.forgejo/workflows/e2e.yml` (header comment, ~lines 10-15; `paths:` untouched)

**Interfaces:** Consumes Task 1's config (`upstreamIsLocal`, `forward.mjs`).

No behaviour changes, so no RED: each of these comments explains a Node-side `fetch`/`request`
against `THAT_BASE_URL` by citing `--host-resolver-rules` or `localhostURL`, which no longer exist.
The direct `THAT_BASE_URL` calls keep working and stay as they are.

- [ ] **Step 1: Rewrite each comment to what is still true**

- `tooltip.spec.ts`: the paragraph beginning `The refetch goes through THAT_BASE_URL directly rather
  than route.fetch():` becomes that single sentence, ending with a full stop.
- `router.spec.ts`: the comment above `const base` becomes
  `// Plain fetch() against THAT_BASE_URL, as tooltip.spec.ts does.` Also fix that line's stale
  default: `"http://that-app:8080"` → `"http://that-e2e:8080"` (#35 renamed the alias; every other
  spec already uses `that-e2e`).
- `smoke.spec.ts`: drop the paragraph beginning `The literal path is resolved against THAT_BASE_URL
  directly`, keeping the #35 paragraph above it.
- `e2e.yml`: replace the paragraph beginning `Running on localhost is not merely equivalent` with:

```yaml
# Running on localhost is not merely equivalent, it is simpler. Locally,
# forward.mjs (#66) gives the browsers a genuine localhost by forwarding to
# the Compose alias, because plain http:// there is not a secure context and
# the service worker will not register against it. Here THAT_BASE_URL already
# names localhost, so playwright.config.ts leaves the forwarder unstarted and
# the browsers reach the real server directly.
```

- [ ] **Step 2: Check nothing stale remains**

```bash
grep -rn -e host-resolver -e securecontext -e localhostURL .claude/e2e/tests .claude/e2e/playwright.config.ts .claude/e2e/README.md .forgejo
```

Expected: only the README's explanation of what was replaced.

- [ ] **Step 3: `make verify`** — green (eslint covers the specs). Paste the tail.

- [ ] **Step 4: Commit**

```bash
git add .claude/e2e/tests/tooltip.spec.ts .claude/e2e/tests/router.spec.ts .claude/e2e/tests/smoke.spec.ts .forgejo/workflows/e2e.yml
git commit -m "docs(#66): drop comments citing the removed per-engine localhost workarounds"
```

### Task 3: Gates and the Chromium crash re-measure (controller)

Not a code task; the controller runs it after both reviews.

- [ ] `make verify` green.
- [ ] `make test-e2e` four times on this branch; count Chromium runs lost to `Target page, context
  or browser has been closed` / a segfault, and capture any fault address against #134's
  `SEGV_MAPERR 0x1b0`. For comparison, the ticket's 2026-09-18 measure was 3 of 4 on the forwarder
  with Playwright 1.62, and #134 recorded 0 in 30 on 1.63.0 without it. If crashes return at a rate
  above `main`'s, run `main` the same number of times; a raised rate puts the ticket back to the
  owner (the controller reports it, it does not relabel).
- [ ] CI path, by reading: with `THAT_BASE_URL=http://localhost:8080`, `upstreamIsLocal` is true,
  `webServer` is `undefined` and `baseURL` is that URL.
