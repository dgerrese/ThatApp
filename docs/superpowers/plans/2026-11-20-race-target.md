# #7 — `make test-race` runs the Go suite under the race detector

**Date:** 2026-11-20
**Supersedes:** nothing
**Superseded by:** nothing

Ticket: https://github.com/dgerrese/ThatApp/issues/7. The approach was settled with the owner on
2026-11-04 and is in the ticket body. Two readings taken by the autopilot run, recorded for the owner
to reverse:

- The ticket names `.forgejo/workflows/verify.yml`. That file is gone since the move to GitHub; its
  successor is `.github/workflows/ci.yml`, and the criterion applies to that file.
- The `CLAUDE.md` Commands line goes in a separate `[Process]` branch. An autopilot run pushes only
  ticket branches, so that branch is committed locally and left unpushed for the owner.

## Task 1 — the target, measured, and proven to catch a race

**Image.** Add a stage to `Dockerfile`, after `dev`, e.g. `FROM dev AS race`, that installs `gcc`
and `musl-dev` with `apk add --no-cache` and sets `CGO_ENABLED=1`. `dev` keeps `CGO_ENABLED=0`.

**Compose.** Add a service for it (e.g. `app-race`) built with `target: race`, behind a Compose
profile so `make up` never starts it, with the same `user:` mapping and the same source and Go cache
mounts as `app`. Reuse YAML anchors only if the file already uses them; otherwise copy the few lines.
`app` and `app-e2e` do not change.

**Makefile.** `test-race: ## Run the Go test suite under the race detector`, running
`go test -race ./...` through that service with `run --build --rm --no-deps`, like `APP`. Add it to
`.PHONY`. `make test-go` does not change.

**Measure.** On this machine, with warm caches for each (run each once to warm, then time a second
run): wall time of `make test-go` and of `make test-race`. Record both numbers.

**Prove the gate.** Add a throwaway `_test.go` with an unsynchronised counter touched from two
goroutines. Show `make test-race` fail with `WARNING: DATA RACE`. Delete the file; never commit it.

**Races on `main`.** If `make test-race` reports a race in the real suite, do not fix it. Record the
full race report in the task report; the controller files each as a `bug` ticket at intake.

**Decide verify.** If the measured extra time is under about 60 s **and** no race is open, add
`test-race` to `verify`'s prerequisites and add a matching step to `ci.yml` (the `test-go` job, or
its own job if that keeps the job layout consistent; read the file's comments first). Otherwise leave
`verify` alone and put a one-line comment in `ci.yml` near `test-go` saying race runs are local
only, with the reason. Either way, the task report states which applied and why.

**Process change, local only.** On a separate branch `process-test-race-command` cut from
`github/main`, add `make test-race` to the Commands block in `CLAUDE.md` with a short comment. Commit
it there. Do not push it. Return to `issue-7-race-target` afterwards.

**Verification:** `make help` lists the target; `make verify` green; `make test-e2e` green.
