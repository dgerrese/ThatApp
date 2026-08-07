# Playwright end-to-end rig

Browser-level tests against the real, built app: server serving built assets,
the frontend bundle parsing in an actual browser, and requests to `/api/*`
completing. Nothing a Go handler test or a frontend unit test can reach.

## Running the suite

The app stack must already be up — the suite is a client of it, not a
replacement for `make up`:

```shell
docker compose up -d app
make test-e2e
docker compose down
```

`make test-e2e` runs `npm ci` before `npx playwright test`. The `playwright`
service bind-mounts `.claude/e2e` with a named volume over `node_modules`,
and that volume starts empty on a fresh clone — without the `npm ci` the
first run on any new machine fails with `playwright: not found`.

## Why this service is profile-gated

`playwright` sits behind the `e2e` Compose profile, so `docker compose up`
never starts it. The rig has a real dependency the rest of the dev stack does
not: browser binaries baked into its own image, and a hard requirement that
`app` already be healthy before a single test can run. Gating it keeps the
day-to-day dev stack (`app`, `web`, `lint`) fast to bring up and free of a
service most of those commands have no use for.

## Why `make verify` excludes it

`make verify` is the merge gate and the fast local TDD loop, and it must
pass with **nothing running** — no `docker compose up` first. Running the
Playwright suite requires the app stack to be up and healthy, which is the
opposite contract. Wiring `test-e2e` into `test` or `verify` would make the
merge gate depend on Docker being up, breaking that loop. `make test-e2e` is
a separate, deliberate step.

## Browser coverage

Firefox and Chromium only. Firefox is the primary target and is listed
first in `playwright.config.ts`; Chromium runs alongside it. Safari/WebKit
is an explicit non-goal — the rig's Dockerfile installs only Firefox and
Chromium, and no WebKit project will be added to this config.
