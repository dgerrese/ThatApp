# #17 — air reloads the Go server in the dev stack

**Date:** 2026-11-20
**Supersedes:** nothing
**Superseded by:** nothing

Ticket: https://github.com/dgerrese/ThatApp/issues/17. The approach (air, pinned, dev stage only,
committed `.air.toml`) was settled with the owner on 2026-11-04 and is in the ticket body.

## Task 1 — air in the `app` container

**Dockerfile, `dev` stage only.** `go install github.com/air-verse/air@<pinned exact version>`. Pick
the newest release that builds with this image's Go, and pin it exactly (no `@latest`). Put the
binary on `PATH` somewhere no runtime volume shadows (e.g. `GOBIN=/usr/local/bin` for that one
command); `/cache/*` paths are volume mounts at runtime. The install must not leave root-owned files
in the world-writable caches that the host-UID containers need. air must not appear in `go.mod`,
`go.sum` or the release image.

**`.air.toml`, committed at the repo root.**

- Build: `go build -tags dev -o <bin path> ./cmd/server`; run that binary.
- The bin path is git-ignored and writable by the host user on the bind-mounted tree (the existing
  `bin/` ignore entry or `tmp/` with a new ignore entry, whichever is smaller).
- Watch `.go` files plus `go.mod` and `go.sum`. Exclude `_test.go`, `web/`, `data/`, `.claude/`,
  `docs/`, `node_modules`, and the bin directory.
- Keep only the keys that differ from air's defaults, plus the ones the criteria name. Do not paste
  air's whole sample config.

**`docker-compose.yml`.** The `app` service's `command:` runs air with that config. `app-e2e` stays on
`go run`, with a comment saying why: the e2e stack is torn down every run. Adjust the `app`
healthcheck's `start_period` only if a cold `make up` measures slower than it allows.

**Verification (paste every command and the relevant log lines in the report):**

1. `docker compose down` then a cold `make up` reaches healthy.
2. Edit a non-test `.go` file (a harmless change, then revert): the log shows a rebuild and restart
   within a few seconds, and `curl http://127.0.0.1:8091/api/health` answers after it.
3. Touch `go.mod` (no content change, or a no-op edit reverted): rebuild seen.
4. Introduce a compile error in a `.go` file: the error is printed. Observe whether the old server
   keeps serving (curl the health endpoint during the error) and record what you saw. Fix it: the next
   save recovers.
5. Edit a `_test.go` file, a Markdown file, and a file under `web/src`: no server restart in the app
   log.
6. Files written by air are owned by the host user and are git-ignored (`git status` clean).
7. `docker run --rm` the release image is out of scope to build here, but confirm by reading
   `scripts/release-image.sh` that it does not use the `dev` stage.
8. `make down`, then `make verify` and `make test-e2e` green.

Revert every test edit; the tree must be clean except for the intended changes.
