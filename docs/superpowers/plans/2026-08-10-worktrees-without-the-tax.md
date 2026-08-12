# Worktrees without the tax

## Context

`CLAUDE.md` currently carries a standing decision to branch in place and never use a worktree. The
stated reason is Docker: Compose derives its project name from the directory, so a worktree lands in
a new directory, gets its own set of named volumes, and rebuilds everything from cold.

That reason is real. The volumes behind the current checkout hold:

| volume | size | what refills it |
|---|---|---|
| `go-mod-cache` | 581 MB | `go mod download` — `modernc.org/sqlite` is the bulk |
| `golangci-cache` | 258 MB | first `make lint-go` |
| `go-build-cache` | 171 MB | first `go build` / `go test` |
| `web-node-modules` | 84 MB | `npm ci` |
| `web-npm-cache` | 23 MB | ″ |

~1.1 GB re-fetched and recompiled per worktree. The `dev` target in `Dockerfile` is bare
`golang:1.26-alpine` with no `go mod download`, so deps live only in the runtime volume — a
layer-cached image saves nothing. On top of that, `.env` is gitignored so a worktree does not get
one, and `internal/config` refuses to boot without `WD_SECRET_KEY`; and `WD_PORT` defaults to 8080
for every project, so two stacks collide on the host port.

The intended outcome is that a worktree costs one `npm ci` and one cold Go build — a minute or two,
not a gigabyte — and that creating one is a single command. With that true, the decision flips:
**one worktree per ticket becomes the default**, which is what the project owner chose.

## The mechanism (verified)

Setting `name:` on a Compose volume produces a fixed, unprefixed volume name; a sibling without it
stays project-scoped. Verified against Compose v5.1.3 in this repo:

```
$ docker compose -p pretend-worktree -f - config
volumes:
  go-mod-cache:
    name: wd-shared-go-mod-cache      # fixed — shared across every worktree
  wd-data:
    name: pretend-worktree_wd-data    # project-scoped — one per worktree
```

Crucially this needs **no `external: true`**. Compose still creates a missing volume, so a fresh
clone and the ephemeral CI runner (`.github/workflows/ci.yml` runs `cp .env.example .env && make
verify`) keep working untouched. `external: true` would break both, and ticket 1's lesson — a fresh
clone serving a 404 — is exactly the class of regression to avoid here.

## Changes

### 1. `docker-compose.yml` — split cache volumes from state volumes

Give the four pure caches fixed names; leave the two stateful volumes project-scoped.

```yaml
volumes:
  go-mod-cache:
    name: wd-cache-go-mod
  go-build-cache:
    name: wd-cache-go-build
  golangci-cache:
    name: wd-cache-golangci
  web-npm-cache:
    name: wd-cache-npm
  web-node-modules:   # per-worktree: package-lock.json differs per branch and `npm ci`
                      # wipes and rewrites the tree — sharing lets branches clobber each other
  wd-data:            # per-worktree: this is the isolation win. A schema experiment on a
                      # feature branch cannot touch the dev database.
```

The four shared ones are all content-addressed and built for concurrent access — Go's module cache
takes download locks, Go's build cache and golangci-lint's cache (which sits on the same machinery)
are action-keyed, and npm's `cacache` is concurrency-safe. No service definition changes.

### 2. `Makefile` — stop `down` destroying the shared caches

`down` currently runs `docker compose down -v`, which after change 1 would delete
`wd-cache-*` for **every** worktree. This is the one genuine regression the change introduces, and
it must be fixed in the same commit.

```make
PROJECT := $(notdir $(CURDIR))

down: ## Stop the dev stack, keeping caches and the local database
	$(COMPOSE) down

clean: ## Stop the stack and drop this worktree's database and node_modules
	$(COMPOSE) down
	-docker volume rm $(PROJECT)_wd-data $(PROJECT)_web-node-modules
```

`PROJECT` mirrors how Compose derives its own project name, which holds as long as directory names
stay lowercase and simple — the `worktree` target below guarantees that, and the main checkout is
`work-dashboard`. Add `clean` to `.PHONY` and update the `help` text for `down`.

### 3. `Makefile` — a `worktree` target

Handles the two things a bare `git worktree add` leaves broken: the missing `.env` and the port
collision. The port is derived from the issue number rather than probed, so it is deterministic and
reproducible with no bash-isms.

```make
BASE ?= main

worktree: ## Create a worktree for an issue: make worktree ISSUE=4 NAME=weekly-rollup
	@test -n "$(ISSUE)" && test -n "$(NAME)" \
		|| { echo "usage: make worktree ISSUE=4 NAME=weekly-rollup"; exit 1; }
	@test -f .env || { echo "no .env here — copy .env.example and fill it in first"; exit 1; }
	git worktree add -b issue-$(ISSUE)-$(NAME) ../wd-issue-$(ISSUE) $(BASE)
	@dir=../wd-issue-$(ISSUE); port=$$(expr 8080 + $(ISSUE)); \
		if grep -q '^WD_PORT=' .env; then \
			sed "s/^WD_PORT=.*/WD_PORT=$$port/" .env > $$dir/.env; \
		else \
			cp .env $$dir/.env; printf 'WD_PORT=%s\n' "$$port" >> $$dir/.env; \
		fi; \
		echo "worktree $$dir on issue-$(ISSUE)-$(NAME), port $$port"; \
		echo "next: cd $$dir && make up"
```

`BASE ?= main` keeps tickets branching from main while leaving an override. Run `git fetch` and
update local `main` first — the target deliberately does no network I/O of its own.

If the derived port is already taken by something unrelated, `make up` fails with a clear bind
error and the fix is to edit `WD_PORT` in that worktree's `.env`. That is acceptable and should be
documented rather than engineered around.

### 4. `CLAUDE.md` — flip the standing decision

- **Workflow step 2** — replace the branch-in-place decision with one worktree per ticket, created
  by `make worktree ISSUE=n NAME=topic`, and state the residual cost (one `npm ci`, one cold Go
  build) so the reasoning stays auditable.
- **Commands** — add `make worktree` and `make clean`; correct `make down`, whose current gloss
  ("stop it and drop its volumes") stops being true.
- Add a short note recording which volumes are shared and which are per-worktree, and that deleting
  a `wd-cache-*` volume affects every worktree at once.

### 5. One-time cache migration (optional, saves ~1.1 GB of refetching)

After the rename the populated `work-dashboard_*` volumes are orphaned and the first run refills the
new names from scratch. Docker cannot rename a volume, so copy through a throwaway container:

```shell
for v in go-mod:go-mod go-build:go-build golangci:golangci npm:web-npm; do
  new=wd-cache-${v%%:*}; old=work-dashboard_${v##*:}-cache
  docker volume create "$new"
  docker run --rm -v "$old":/from -v "$new":/to alpine sh -c 'cp -a /from/. /to/'
done
```

Skip it and the only cost is one slow first build. Unrelated housekeeping while here: stale
`work-dashboard_playwright-*` volumes and a 1.79 GB `work-dashboard-playwright` image are left over
from an abandoned rig — no `playwright` service exists in `docker-compose.yml` on this branch or on
`main`. Removing them is safe but out of scope for this PR.

## Verification

Run from the main checkout unless stated. Paste `make verify` output per `CLAUDE.md`.

1. `docker compose config --format json` — the four caches show fixed `wd-cache-*` names, `wd-data`
   and `web-node-modules` show `work-dashboard_*`.
2. `make verify` from the main checkout — green, and `docker volume ls | grep wd-cache` shows the
   four populated.
3. `make worktree ISSUE=99 NAME=smoke` — creates `../wd-issue-99` on branch `issue-99-smoke` with
   `WD_PORT=8179` in its `.env`.
4. `make verify` inside the worktree — green. Time it: expect `npm ci` plus a cold Go build only,
   with no module download. **This is the headline claim; record the timing.**
5. `make up` in both checkouts at once — the app serves on 8080 and 8179 simultaneously.
6. `make down` in the worktree, then `docker volume ls | grep wd-cache` — all four still present and
   populated, and step 2's checkout still builds warm. **This is the regression test for change 2.**
7. `make clean` in the worktree — its `wd-data` and `web-node-modules` are gone, caches untouched.
8. Fresh-clone check: `git clone . /tmp/fresh && cp .env /tmp/fresh/ && cd /tmp/fresh && docker
   compose up` — serves the app rather than a 404, proving no `external:` prerequisite crept in.
9. `git worktree remove ../wd-issue-99 && git branch -D issue-99-smoke`.
10. The PR's CI run is the real proof for the fresh-runner path.

## Risks

- **Go VCS stamping in a worktree.** A worktree's `.git` is a *file* pointing at an absolute host
  path (`/home/dion/Projects/work-dashboard/.git/worktrees/...`) that does not exist inside the
  container, and the bind mount is only the worktree directory. `-buildvcs=auto` should skip
  silently, but steps 4 and 5 are what confirm it. If it does bite, add `-buildvcs=false` to the
  `command:` in `docker-compose.yml` and to the test invocation.
- **Shared caches are now global state.** Deleting one affects every worktree. Change 2 is the
  mitigation; step 6 is the test.
- **Concurrent `make verify` in two worktrees** shares `go-build-cache`. Safe by design; worth
  running once side by side to confirm no lock errors.
- `.claude/e2e/` is untracked, so a worktree will not have the Playwright specs. Nothing in `make
  verify` depends on them today, so this is a known gap, not a blocker.

## Process

Per `CLAUDE.md`'s one-issue-one-branch-one-PR rule, and the owner's choice:

1. `gh issue create` in `dgerrese/work-dashboard` — a chore issue for sharing Docker caches across
   worktrees, labelled `status:ready`.
2. Branch from `main` as `issue-<n>-shared-caches`. This one is bootstrapped in place: the new
   `make worktree` target does not exist yet.
3. Carry this file over to that branch and commit it there.
4. Implement, `make verify`, PR. Merging stays the owner's call.
