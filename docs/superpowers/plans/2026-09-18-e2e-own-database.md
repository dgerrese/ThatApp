# E2E own database (#35) Implementation Plan

**Date:** 2026-09-18
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `make test-e2e` runs against a dedicated e2e app service whose database is created empty for the run and thrown away after it.

**Architecture:** A second Compose service, `app-e2e`, in the `e2e` profile: same `dev` build target and Go caches as `app`, database under the container's `/tmp`, a throwaway secret key, no host port, network alias `that-e2e`. `playwright` depends on it instead of `app`. `make test-e2e` removes it before and after each run so every run starts empty.

**Tech Stack:** Docker Compose, Make, Playwright.

**Spec:** Codeberg issue #35 — `tea api "repos/{owner}/{repo}/issues/35"`.

## Global Constraints

- There is no Go, Node or npm on the host; everything runs through `make` or `docker compose`.
- No test contacts a real Jira instance.
- The alias must not be a gTLD — `app` is on the browsers' HSTS preload list (see `.claude/e2e/README.md`). Use `that-e2e`.
- CI (`.forgejo/workflows/e2e.yml`) does not use Compose and must keep working unchanged.
- Comments are few and explain a non-obvious why.
- Commit unsigned with `git -c commit.gpgsign=false commit …` if signing fails; **never push**.

---

### Task 1: A dedicated, disposable e2e app service

**Files:**
- Modify: `docker-compose.yml` (new `app-e2e` service; `playwright`'s `depends_on` and `THAT_BASE_URL`)
- Modify: `Makefile` (`test-e2e` target)
- Modify: `.claude/e2e/playwright.config.ts` (default `baseURL` and its comment)
- Modify: `.claude/e2e/tests/tooltip.spec.ts` (its `THAT_BASE_URL` fallback)
- Modify: `.claude/e2e/README.md` (which server the rig runs against, and why)
- Modify: `.forgejo/workflows/e2e.yml` (only the comment on line 5 naming `that-app`)
- Test: `.claude/e2e/tests/smoke.spec.ts` (new test)

**Interfaces:** none shared with other tasks.

- [ ] **Step 1: Write the failing test**

Append to `.claude/e2e/tests/smoke.spec.ts`:

```ts
// Structural guard for #35: the rig's server starts every run with an empty
// database. Unstubbed on purpose — against the dev database, which holds the
// owner's real instances, this fails.
test("the e2e server starts with no instances", async ({ request }) => {
  const response = await request.get("/api/instances");

  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual([]);
});
```

- [ ] **Step 2: Run it to verify it fails**

With the owner's dev stack holding real instances, the current rig targets that database:

Run: `make up` (if not already running), then `make test-e2e` — or the focused form
`docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test smoke.spec.ts'`

Expected: FAIL on both engines if the dev database holds any instance — the response lists them.
Paste only the assertion's shape (how many instances, and their *names*) — never a site URL, email or
anything else from the response. If the dev database holds no instances, the test cannot go RED
against it: say so in the report, do **not** create an instance through the dev app to force it, and
let Step 6's GREEN run plus the structural change carry the proof.

- [ ] **Step 3: Add the `app-e2e` service**

In `docker-compose.yml`, add after the `app` service:

```yaml
  # The server the Playwright rig runs against (#35). Not `app`: that one is the
  # dev stack, whose database holds real Jira instances and whose container
  # `compose run` would reuse whenever `make up` is running. This one keeps its
  # database inside the container, under a throwaway key, and `make test-e2e`
  # removes it before and after every run — so each run starts empty.
  app-e2e:
    profiles: [e2e]
    build:
      context: .
      target: dev
    user: "${THAT_UID:?unset - run through make, or add THAT_UID/THAT_GID to .env (see .env.example)}:${THAT_GID:?unset - see .env.example}"
    volumes:
      - .:/src
      - go-mod-cache:/cache/go-mod
      - go-build-cache:/cache/go-build
    environment:
      THAT_ADDR: ":8080"
      THAT_DB_PATH: /tmp/e2e.db
      # 32 zero bytes. Seals nothing worth protecting: the database it guards
      # dies with the container.
      THAT_SECRET_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
      THAT_TIMEZONE: "Europe/Amsterdam"
    command: go run -tags dev ./cmd/server
    depends_on:
      web:
        condition: service_healthy
    # Same gTLD reasoning as `app`'s that-app alias.
    networks:
      default:
        aliases:
          - that-e2e
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8080/api/health"]
      interval: 3s
      timeout: 3s
      retries: 20
      start_period: 60s
```

In the `playwright` service: set `THAT_BASE_URL: "http://that-e2e:8080"`, and change `depends_on` from
`app` to `app-e2e` (same `condition: service_healthy`).

Check before moving on: `docker compose config --quiet` exits 0 (run it through the host's docker
CLI, which is available — only Go/Node/npm are not).

- [ ] **Step 4: Make every run start empty**

In the `Makefile`, replace the `test-e2e` recipe line with:

```make
test-e2e: ## Run the Playwright suite (starts its own disposable app, see #35)
	$(COMPOSE) --profile e2e rm --stop --force app-e2e
	$(COMPOSE) --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test'; \
		status=$$?; $(COMPOSE) --profile e2e rm --stop --force app-e2e; exit $$status
```

The removal before the run is what guarantees an empty database even after an interrupted run; the
one after keeps a finished run from leaving a server behind. The exit status is the suite's.

- [ ] **Step 5: Point the rig's defaults at the new alias**

- `.claude/e2e/playwright.config.ts`: default `baseURL` becomes `"http://that-e2e:8080"`; update the
  comment above it, which today explains `that-app` — keep the gTLD reasoning, name `app-e2e` as the
  service and `that-e2e` as its alias.
- `.claude/e2e/tests/tooltip.spec.ts`: the `THAT_BASE_URL` fallback becomes `"http://that-e2e:8080"`.
- `grep -rn "that-app" .claude/e2e` must then show nothing in `.claude/e2e/tests` or the config.
  (`router.spec.ts` carries the same fallback on #42's unmerged branch; it is not on this branch.
  Whichever of the two merges second updates it — note that in the report.)
- `.forgejo/workflows/e2e.yml` line 5: the comment says the local rig reaches `http://that-app:8080`;
  make it `http://that-e2e:8080`. Change nothing else in that file.
- `.claude/e2e/README.md`: the section *Why the base URL says `that-app`, not `app`* becomes about
  `that-e2e`, and gains a short paragraph: the rig runs against `app-e2e`, a disposable server with
  its own empty database, never the dev stack's `app` — and why (real instances, real key, and the
  "no test contacts real Jira" rule becoming structural rather than disciplinary).

- [ ] **Step 6: Verify**

1. With `make up` running: `make test-e2e`. Expected: whole suite green on both engines, including the
   new test.
2. Afterwards: `docker compose ps` still shows `app` running and healthy, with the same container ID
   and uptime as before the run (paste both `docker compose ps` outputs), and `app-e2e` is gone.
3. **Never run `make down` or stop `app`/`web`** — the owner's dev stack is running and is theirs.
   The nothing-running case is covered structurally (`playwright` depends only on `app-e2e`, which
   depends only on `web`); state that in the report rather than testing it by stopping their stack.
4. `make verify`. Expected: `verify: OK`.

Paste the tails into the report.

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml Makefile .claude/e2e .forgejo/workflows/e2e.yml
git commit -m "test(#35): the e2e rig runs against its own disposable database"
```
