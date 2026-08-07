# Playwright Rig Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the end-to-end test rig so #4 — the first ticket touching `web/` — has somewhere to put UI tests.

**Architecture:** A profile-gated `playwright` Compose service built from a custom image carrying only Firefox and Chromium. It reaches the app over the Compose network at `http://app:8080`, gated on a new healthcheck so it never races startup. `make test-e2e` runs it; `make verify` deliberately does not.

**Tech Stack:** Playwright 1.62.1 on `node:26-bookworm-slim`, Docker Compose profiles, GitHub Actions path filters.

Implements **GitHub issue #16**. Its body carries the five settled decisions and the 13 acceptance criteria; this plan does not restate them.

## Global Constraints

- **Everything runs in Docker.** There is no Go, Node, npm or npx on the host — never run them bare, even though the host happens to have them installed.
- **Browser support is Firefox and Chromium. Firefox is primary; Chromium covers occasional switching. Safari and WebKit are an explicit non-goal** — do not install WebKit, do not add it to the matrix, and do not raise it as missing coverage.
- `make verify` must continue to pass **with no application stack running**. It is the fast local loop and must not acquire a dependency on Docker being up.
- `docker compose up` must not start the `playwright` service.
- Do not change application code. The only non-e2e change permitted is the `app` healthcheck.
- One issue, one branch, one pull request.

## Verified environment facts

Confirmed empirically in this project's containers before this plan was written. Do not re-derive them or "correct" them from memory.

- `@playwright/test` latest is **1.62.1**.
- `node:26-bookworm-slim` + `npx playwright install --with-deps firefox chromium` **builds cleanly** and yields exactly `chromium-1234`, `chromium_headless_shell-1234`, `ffmpeg-1011`, `firefox-1538` — **no webkit**. Final image **1830 MB**.
- Playwright does **not** officially support Alpine. The base must be Debian; `node:26-alpine` will not work.
- The official `mcr.microsoft.com/playwright:v1.62.1-noble` image exists but **ships all three browsers including WebKit**, which is why this plan builds its own.
- The `app` Compose service uses the Dockerfile's `dev` target (`golang:1.26-alpine`), which **has `/bin/sh` and `/usr/bin/wget`** — so a healthcheck can shell out to `wget`.
- Compose services today are exactly `app`, `web`, `lint`. There is no `profiles:` key anywhere yet.

## File structure

```
.claude/e2e/
  Dockerfile             firefox + chromium only, no webkit
  package.json           @playwright/test only
  package-lock.json      committed, so npm ci is reproducible
  playwright.config.ts   firefox first, then chromium; baseURL from env
  README.md              how to run it, and why it is not in make verify
  tests/
    smoke.spec.ts        the app shell boots and reaches the API
docker-compose.yml       + app healthcheck, + profile-gated playwright service
Makefile                 + test-e2e
.github/workflows/ci.yml + filtered e2e job
CLAUDE.md                corrected: verify is not the whole gate
docs/superpowers/specs/2026-08-04-work-dashboard-design.md   corrected make-target table
```

---

### Task 1: The rig container and its route to the app

**Files:**
- Create: `.claude/e2e/Dockerfile`, `.claude/e2e/package.json`
- Modify: `docker-compose.yml`

**Interfaces:**
- Consumes: the existing `app` service
- Produces: a `playwright` Compose service on the `e2e` profile; an `app` healthcheck

- [ ] **Step 1: Write the rig's image**

`.claude/e2e/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1

# Debian, not Alpine: Playwright does not officially support Alpine and its
# browser binaries will not run there.
FROM node:26-bookworm-slim

WORKDIR /e2e

COPY package.json package-lock.json* ./

# Only the two browsers this project supports. WebKit is an explicit non-goal,
# which is also why this does not use the official Playwright image — that one
# ships all three.
RUN npm ci --no-audit --no-fund 2>/dev/null || npm install --no-audit --no-fund \
 && npx playwright install --with-deps firefox chromium
```

`.claude/e2e/package.json`:

```json
{
  "name": "work-dashboard-e2e",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "1.62.1"
  }
}
```

- [ ] **Step 2: Add the app healthcheck and the playwright service**

In `docker-compose.yml`, add to the **`app`** service (alongside its existing keys):

```yaml
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8080/api/health"]
      interval: 3s
      timeout: 3s
      retries: 20
      # go run compiles before it listens; a cold start is slow.
      start_period: 60s
```

Then add a new service:

```yaml
  playwright:
    profiles: [e2e]
    build:
      context: .claude/e2e
    working_dir: /e2e
    volumes:
      - ./.claude/e2e:/e2e
      - playwright-node-modules:/e2e/node_modules
    environment:
      WD_BASE_URL: "http://app:8080"
    depends_on:
      app:
        condition: service_healthy
```

And add `playwright-node-modules:` to the `volumes:` block.

**Why the named volume:** the bind mount would otherwise shadow the `node_modules` the image installed, exactly as it does for the `web` service. The browsers themselves live in `/root/.cache/ms-playwright` and are not shadowed.

- [ ] **Step 3: Verify the profile gate and the healthcheck**

```bash
docker compose config --services
docker compose --profile e2e config --services
```

Expected: the first prints `app`, `web`, `lint` — **not** `playwright`. The second includes `playwright`. If `playwright` appears without the profile flag, the gate is wrong and `docker compose up` would start it.

```bash
docker compose up -d app
docker compose ps app
```

Expected: `app` reaches `(healthy)`. Then `docker compose down`.

- [ ] **Step 4: Verify the image carries no WebKit**

```bash
docker compose --profile e2e build playwright
docker compose --profile e2e run --rm --no-deps playwright ls /root/.cache/ms-playwright/
```

Expected: `chromium-*`, `chromium_headless_shell-*`, `ffmpeg-*`, `firefox-*` and **no `webkit-*`**. This is acceptance criterion 5; paste the real listing.

- [ ] **Step 5: Commit**

```bash
git add .claude/e2e/ docker-compose.yml
git commit -m "build: profile-gated playwright container and app healthcheck"
```

---

### Task 2: The Playwright project and the smoke spec

**Files:**
- Create: `.claude/e2e/playwright.config.ts`, `.claude/e2e/tests/smoke.spec.ts`, `.claude/e2e/README.md`, `.claude/e2e/package-lock.json`
- Modify: `Makefile`

**Interfaces:**
- Consumes: the `playwright` service and `app` healthcheck from Task 1
- Produces: `make test-e2e`

- [ ] **Step 1: Write the Playwright config**

`.claude/e2e/playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

// The rig runs inside Compose and reaches the app over the service network, so
// it behaves identically here and in CI and does not depend on WD_PORT.
const baseURL = process.env.WD_BASE_URL ?? "http://app:8080";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : "line",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    // Firefox first: it is the primary target.
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
```

- [ ] **Step 2: Write the smoke spec**

`.claude/e2e/tests/smoke.spec.ts`. This asserts a chain no Go test can reach — the server serving built assets, esbuild's bundle actually parsing, and the `fetch` completing:

```ts
import { expect, test } from "@playwright/test";

test("the app shell boots and reaches the API", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Work Dashboard");
  await expect(page.getByRole("heading", { name: "Work Dashboard" })).toBeVisible();

  // The shell ships this text; the module rewrites it only after /api/health
  // resolves. Seeing it change proves the bundle parsed and the fetch worked.
  await expect(page.locator("#status")).toHaveText("Server is up.");
});

test("an unknown route still serves the app shell", async ({ page }) => {
  // Client-side routing: /week is a view, not a file. A 404 here would mean the
  // server's shell fallback regressed.
  const response = await page.goto("/week");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Work Dashboard" })).toBeVisible();
});
```

- [ ] **Step 3: Add the make target**

In `Makefile`, after `test-e2e`'s neighbours:

```makefile
test-e2e: ## Run the Playwright suite (needs the app stack)
	$(COMPOSE) --profile e2e run --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test'
```

Add `test-e2e` to the `.PHONY` list. **Do not add it to `test` or `verify`** — acceptance criterion 7 requires `make verify` to keep passing with nothing running.

The `npm ci` mirrors what `install-web` does for the `web` service, and for the same reason: the named volume starts empty on a fresh clone, so without it the first run fails with `playwright: not found`.

- [ ] **Step 4: Generate the lock file and run the suite**

```bash
docker compose --profile e2e run --rm --no-deps playwright npm install --no-audit --no-fund
docker compose up -d app
make test-e2e
docker compose down
```

Expected: 4 passing tests — two specs across two browser projects. Paste the real output including the project names, so it is visible that both Firefox and Chromium ran.

- [ ] **Step 5: Write the README**

`.claude/e2e/README.md` must cover: how to run the suite, that the app stack must be up, why the service is profile-gated, why `make verify` deliberately excludes it, and that browsers are Firefox and Chromium only with WebKit an explicit non-goal.

- [ ] **Step 6: Verify make verify is untouched**

```bash
docker compose down
make verify
```

Expected: `verify: OK` **with no application stack running**. This is acceptance criterion 7 and it is the one protecting the fast local loop.

- [ ] **Step 7: Commit**

```bash
git add .claude/e2e/ Makefile
git commit -m "test: playwright smoke spec on firefox and chromium"
```

---

### Task 3: CI and the documentation corrections

**Files:**
- Modify: `.github/workflows/ci.yml`, `CLAUDE.md`, `docs/superpowers/specs/2026-08-04-work-dashboard-design.md`

**Interfaces:**
- Consumes: `make test-e2e` from Task 2
- Produces: a filtered `e2e` CI job

- [ ] **Step 1: Add the filtered e2e workflow**

**GitHub Actions cannot filter a job by changed paths** — `paths:` is a workflow-level trigger, not
a job-level one. So this goes in its own workflow file rather than as a second job in `ci.yml`. The
alternative, gating a job on a `dorny/paths-filter` step's output, keeps one file but adds an action
dependency to do what `paths:` already does natively.

Create `.github/workflows/e2e.yml`:

```yaml
name: E2E

# Only when the frontend or the rig itself changes. Deliberate trade-off,
# recorded on #16: pull requests that change Go handlers the UI depends on skip
# this entirely, and their UI needs checking by hand.
on:
  pull_request:
    paths:
      - "web/**"
      - ".claude/e2e/**"
      - ".github/workflows/e2e.yml"
  push:
    branches: [main]
    paths:
      - "web/**"
      - ".claude/e2e/**"
      - ".github/workflows/e2e.yml"

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - name: Provide a test environment
        run: |
          cp .env.example .env
          sed -i '/^WD_SECRET_KEY=/d' .env
          printf 'WD_SECRET_KEY=%s\n' "$(head -c 32 /dev/urandom | base64)" >> .env

      - name: Build the frontend and start the stack
        run: |
          make build-web
          docker compose up -d app

      - name: Run the end-to-end suite
        run: make test-e2e

      - name: Upload traces on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-traces
          path: .claude/e2e/test-results/
```

- [ ] **Step 2: Correct `CLAUDE.md`**

Two edits. In the Commands section, the line describing `make verify` as "the single source of truth for whether a change is green" is now false — `make test-e2e` covers what it does not. Reword so both are named, and state that `verify` deliberately needs no running stack.

Add `make test-e2e` to the commands list. Confirm the existing `docker compose --profile e2e run --rm playwright npx playwright test` example matches what you actually built; correct it if not.

- [ ] **Step 3: Correct the design spec**

In `docs/superpowers/specs/2026-08-04-work-dashboard-design.md`, the make-target table says `make test  go test ./... + playwright`. That is not what was built. Correct it to show `make test` as Go only and `make test-e2e` as separate, and note in the Testing section that e2e is deliberately outside the local gate.

- [ ] **Step 4: Verify the whole rig from a genuinely clean state**

This is acceptance criterion 13, and it exists because ticket 1 shipped a `docker compose up` that
served a 404 on a fresh clone while every task review passed. Assertions are not accepted here —
paste the real output.

```bash
docker compose down -v
docker volume ls | grep work-dashboard   # expect nothing
docker image rm work-dashboard-playwright 2>/dev/null || true

make build-web
docker compose up -d app
make test-e2e
docker compose down
```

Expected: the image rebuilds from scratch, `app` reaches healthy, and 4 tests pass. If anything
requires a manual step that is not in a `make` target or the README, that is a defect — fix it
rather than documenting the workaround.

- [ ] **Step 5: Verify the gate and the diff**

```bash
docker compose down
make verify
```

Expected: `verify: OK` **with no application stack running**. Then read your own diff back and
confirm no application code changed — the `app` healthcheck is the only permitted non-e2e edit.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ CLAUDE.md docs/superpowers/specs/
git commit -m "ci: run the e2e suite on frontend changes"
```

---

## Definition of done

- `make verify` exits 0 with `verify: OK`, with no application stack running.
- `make test-e2e` runs 4 tests (2 specs × Firefox and Chromium) and exits 0.
- `docker compose config --services` does **not** list `playwright`.
- `ls /root/.cache/ms-playwright/` in the rig image shows no `webkit-*`.
- The whole rig works from a clean state: `docker compose down -v`, no cached images.
- No application code changed. The `app` healthcheck is the only non-e2e modification.
