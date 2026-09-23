# Playwright end-to-end rig

Browser-level tests against the real, built app: server serving built assets,
the frontend bundle parsing in an actual browser, and requests to `/api/*`
completing. Nothing a Go handler test or a frontend unit test can reach.

## Running the suite

```shell
make test-e2e   # starts its own disposable app-e2e, waits for it, runs the suite
```

The `playwright` service declares `depends_on: app-e2e: condition: service_healthy`,
and `compose run` honours that, so `make test-e2e` brings `app-e2e` up and
waits for `/api/health`. `app-e2e` itself depends on `web`, so a run started
with nothing up also starts `web` as a side effect. The recipe removes any
leftover `app-e2e` container before the run — so an interrupted previous run
cannot leave a stale database behind — and again afterwards: a finished run
leaves no `app-e2e` behind, though `web` stays up if this run was the one that
started it.
`make down` also runs with the `e2e` profile (`--profile e2e down -v`), so it
too would remove a leftover `app-e2e` — but `make test-e2e`'s own teardown
already makes that moot, and `make down` also stops and removes `app` and
`web`, the owner's dev stack, so nothing about clearing `app-e2e` alone
justifies reaching for it.

Driving `docker compose` directly rather than through `make` needs
`THAT_UID`/`THAT_GID` set (the Makefile exports both from `id -u`/`id -g`;
see `.env.example`) — `app-e2e`'s `user:` directive reads them the same way
`app`'s does.

`make test-e2e` runs `npm ci` before `npx playwright test`. The `playwright`
service bind-mounts `.claude/e2e` with a named volume over `node_modules`,
and that volume starts empty on a fresh clone — without the `npm ci` the
first run on any new machine fails with `playwright: not found`. It also passes
`--build`: the browsers are baked into the image, so a cached image plus a
freshly installed `@playwright/test` would disagree about which browsers exist.

## Why this service is profile-gated

`playwright` and `app-e2e` both sit behind the `e2e` Compose profile, so
`docker compose up` never starts either. The rig has a real dependency the
rest of the dev stack does not: browser binaries baked into its own image, and
a hard requirement that `app-e2e` already be healthy before a single test can
run. Gating it keeps the day-to-day dev stack (`app`, `web`, `lint`) fast to
bring up and free of services most of those commands have no use for.

## Why `make verify` excludes it

`make verify` is the merge gate and the fast local TDD loop. Every one of its
steps is a `run --rm --no-deps`, so it needs no stack and starts nothing.
The Playwright suite is the opposite contract: it cannot run until `app-e2e`
is up and healthy, which means building the frontend and waiting on a healthcheck.
Wiring `test-e2e` into `test` or `verify` would put that cost and that
dependency inside the fast loop. `make test-e2e` is a separate, deliberate step.

## Why the base URL says `that-e2e`, not `app-e2e`

`THAT_BASE_URL` points at `http://that-e2e:8080`, a network alias for the
`app-e2e` service, rather than at the service name directly — kept for
symmetry with `app`'s own `that-app` alias, so every host name this rig
touches is `that-*`. Unlike `app`, `app-e2e` does not itself collide with
anything: the gTLD problem is specific to the bare label `app`, which is a
real gTLD on Chromium and Firefox's HSTS preload list, so `http://app` gets
silently rewritten to `https://` before the request leaves the browser and
every test dies on SSL against a plain-HTTP dev server — `app-e2e` was never
at risk of that. See the comment on the `app` service in `docker-compose.yml`
for the full explanation of that original problem.

The rig runs against `app-e2e`, not `app`. `app-e2e` (#35) is a disposable
server with its own empty, in-container database, built fresh and torn down
by `make test-e2e` before and after every run — never the dev stack's `app`,
whose database holds the owner's real Jira instances and whose encryption key
is real. Running against `app-e2e` instead turns "no test contacts a real
Jira instance" from a rule the tests have to honour into one the rig makes
structurally true: there is nothing real in that database to reach.

## Why the browsers load localhost

The service worker and `window.caches` only work in a secure context, and plain
`http://` on a Compose alias is not one. `forward.mjs` gives both engines a genuine
`http://localhost` by forwarding a TCP listener on `127.0.0.1:8080` to the real
upstream; `playwright.config.ts` starts it as a `webServer` and points `baseURL`
at it. This replaced two per-engine workarounds that each covered only part of
the problem: Firefox's `dom.securecontext.allowlist` pref trusted the upstream
origin but left `window.caches` throwing `SecurityError` there regardless, and
Chromium's `--host-resolver-rules` only remapped the hostname inside the
browser, so requests made from Node (rather than inside the browser) still
could not follow it.

The forwarder does not start when `THAT_BASE_URL` already names a localhost
upstream, which is how CI runs it (`http://localhost:8080`, no Compose
network) — there the address is already real and nothing needs forwarding.

## Browser coverage

Firefox and Chromium only. Firefox is the primary target and is listed
first in `playwright.config.ts`; Chromium runs alongside it. Safari/WebKit
is an explicit non-goal — the rig's Dockerfile installs only Firefox and
Chromium, and no WebKit project will be added to this config.
