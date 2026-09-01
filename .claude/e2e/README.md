# Playwright end-to-end rig

Browser-level tests against the real, built app: server serving built assets,
the frontend bundle parsing in an actual browser, and requests to `/api/*`
completing. Nothing a Go handler test or a frontend unit test can reach.

## Running the suite

```shell
make test-e2e   # starts the stack, waits for it, runs the suite
make down       # stop the stack and drop its volumes, including the rig's
```

The `playwright` service declares `depends_on: app: condition: service_healthy`,
and `compose run` honours that, so `make test-e2e` on its own brings the stack
up and waits for `/api/health`. It leaves the stack running afterwards — that is
what `make down` is for. If the stack is already up from `make up`, the suite
just attaches to it.

`.env` must exist and carry a valid `THAT_SECRET_KEY` first (`cp .env.example .env`).
The server refuses to boot without one, so the healthcheck never passes and the
suite fails with an opaque `dependency failed to start: container ... is
unhealthy` rather than anything about configuration.

`make test-e2e` runs `npm ci` before `npx playwright test`. The `playwright`
service bind-mounts `.claude/e2e` with a named volume over `node_modules`,
and that volume starts empty on a fresh clone — without the `npm ci` the
first run on any new machine fails with `playwright: not found`. It also passes
`--build`: the browsers are baked into the image, so a cached image plus a
freshly installed `@playwright/test` would disagree about which browsers exist.

## Why this service is profile-gated

`playwright` sits behind the `e2e` Compose profile, so `docker compose up`
never starts it. The rig has a real dependency the rest of the dev stack does
not: browser binaries baked into its own image, and a hard requirement that
`app` already be healthy before a single test can run. Gating it keeps the
day-to-day dev stack (`app`, `web`, `lint`) fast to bring up and free of a
service most of those commands have no use for.

## Why `make verify` excludes it

`make verify` is the merge gate and the fast local TDD loop. Every one of its
steps is a `run --rm --no-deps`, so it needs no stack and starts nothing.
The Playwright suite is the opposite contract: it cannot run until `app` is up
and healthy, which means building the frontend and waiting on a healthcheck.
Wiring `test-e2e` into `test` or `verify` would put that cost and that
dependency inside the fast loop. `make test-e2e` is a separate, deliberate step.

## Why the base URL says `that-app`, not `app`

`THAT_BASE_URL` points at `http://that-app:8080`, a network alias for the `app`
service, rather than at `app` directly. `app` collides with the `.app` gTLD on
Chromium and Firefox's HSTS preload list, so a bare `http://app` gets silently
rewritten to `https://` before the request leaves the browser and every test
dies on SSL against a plain-HTTP dev server. See the comment on the `app`
service in `docker-compose.yml` for the full explanation.

## Browser coverage

Firefox and Chromium only. Firefox is the primary target and is listed
first in `playwright.config.ts`; Chromium runs alongside it. Safari/WebKit
is an explicit non-goal — the rig's Dockerfile installs only Firefox and
Chromium, and no WebKit project will be added to this config.
