# Dev stack and CI: refinement drafts (2026-10-26)

Read-only research. Nothing run except `tea api` reads and local file reads. No ticket has comments except #43 (read, quoted below).

## #201 Watch mode: an index.html-only edit never rebuilds the worker

**Still valid?** Yes. `web/build.mjs:140-152` (the `index.html` watch) calls `copyShell()` and never `buildWorker`. `buildWorker` hashes `dist/index.html` via `assetPaths` (`build.mjs:128`, built at `:130`-ish from `copyShell()`), so the build id stays stale. Confirmed there are still three copies of the "50 ms then buildWorker" block: the `sw.ts` watch (`:158-170`), the `app.css` watch (`:177-185`), and the plugin `onEnd` (`:131-135`, no debounce).

**Problem.** In watch mode, editing only `web/index.html` copies it to `dist/` but leaves `dist/sw.js` with the old build id, so the worker keeps precaching the old shell. Dev-only. The same file also has three copies of the rebuild trigger, and overlapping `buildWorker` runs can finish out of order.

**Approach (recommended).** One function `queueWorkerRebuild()` in `build.mjs`: debounce 50 ms, and serialise runs (if one is running, mark "again" and rerun once after). All four triggers (esbuild `onEnd`, `sw.ts`, `app.css`, `index.html`) call it; `index.html` calls it after `copyShell()`. About 15 lines, deletes about 25. Alternative: add only the one missing call, keeping the three copies. Smaller, but leaves the race and the copies the ticket also names.

**Acceptance criteria**
- [ ] In watch mode, editing only `web/index.html` changes `__WD_BUILD_ID__` in `dist/sw.js` and keeps `/index.html` in the precache list.
- [ ] `web/build.mjs` has one worker-rebuild path; the three duplicated debounce blocks are gone.
- [ ] Two overlapping triggers never run `buildWorker` concurrently, and the last trigger's rebuild is the last to write `sw.js`.
- [ ] A rebuild error is logged and does not stop the watcher (as today).
- [ ] The queue is a small pure helper (own file under `web/tools/`, like `reachable-files.mjs`) with a `node --test` unit test: collapses a burst to one run, never overlaps, runs once more when triggered mid-run, survives a rejecting task. Mutation: removing the "again" flag or the overlap guard fails a test.
- [ ] `make verify` green. Manual check recorded in the PR: touch `web/index.html` in a running `make up`, see the id change.

**Out of scope.** Pruning stale chunks (#198). Reworking the watcher to use esbuild/Tailwind plugins. Any change to non-watch builds.

**Questions for the owner.** none.

**Design session needed?** No (build tooling, no UI).

**Type label.** `bug` is right (the worker misbehaves relative to its own intent, dev-only).

**Size.** S. One file plus one small helper and test.

**Dependencies.** None. Touches the same file as #198; do #201 first or expect a trivial merge conflict.

---

## #137 The dev stack reloads the frontend on change but never the Go server

**Still valid?** Yes, with a stale name. The ticket says `compose.yaml`; the file is `docker-compose.yml`. `app` still runs `go run -tags dev ./cmd/server` (`docker-compose.yml:51`) over a bind mount (`:34`) and `app-e2e` does the same (`:82`). No reloader exists (Dockerfile `dev` stage has no watcher; alpine has no `inotifywait`). Web service watches (`:112`).

**Problem.** The Go server compiles once at container start and never sees later edits. A stale server answers some new routes and silently drops new request fields (Go ignores unknown JSON fields), which looks like the feature being broken and cost a session on 2026-09-10.

**Approach (recommended).** A reloader inside the `app` container that needs no new dependency: a short POSIX shell script (`scripts/dev-server.sh`, mounted via the existing `.:/src` bind) that loops: `go build -tags dev -o /tmp/server ./cmd/server`, starts it, polls every 1 s with `find . -name '*.go' -o -name go.mod -newer <marker>` (also `go.sum`), kills and rebuilds on change, and keeps the old process running if the build fails (printing the compiler error). `command:` in `app` points at it. Alternative: `go run github.com/air-verse/air` pinned in a `tools` module or `go run ...@version`. Better file-watching, but a new third-party tool outside the approved non-stdlib set (CLAUDE.md "Conventions"); dev-only, so owner could allow it. Docs-only "just restart" is rejected by the ticket itself.

**Acceptance criteria**
- [ ] Editing any `.go` file (or `go.mod`/`go.sum`) under `make up` rebuilds and restarts the server within a few seconds; the log says it did.
- [ ] A compile error is printed and the previous server keeps serving; the next good save recovers.
- [ ] Editing a non-Go file (a test file, markdown) does not restart it. `_test.go` edits are ignored.
- [ ] `docker compose up` on a cold clone still reaches healthy (healthcheck `start_period` is unchanged or adjusted if the first build is slower).
- [ ] The e2e stack (`app-e2e`) either uses the same script or is explicitly left on `go run` with a comment saying why (it is torn down every run).
- [ ] The restart works on the bind-mounted tree as the host user (`user:` mapping), checked by running it.
- [ ] A shell-level test of the script's decision logic is not required; the check is `make test-e2e` plus the manual edit-and-observe run, results pasted in the PR.
- [ ] CLAUDE.md/README mention of the dev stack, if any, says it reloads.

**Out of scope.** Hot reload of the browser page (the web side already rebuilds). Reloading on `.env` change. Running the Go suite on change.

**Questions for the owner** (1)
1. Shell polling loop (no dependency, 1 s latency) or `air`? Recommend the shell loop; the dependency rule says a dependency needs a reason the stdlib cannot meet.

**Design session needed?** No.

**Type label.** None (dev-tooling). Not a product defect.

**Size.** M. Small script, but needs care around process kill, signals, and the compose healthcheck.

**Dependencies.** None. Touches `docker-compose.yml` like #279; no conflict beyond adjacent lines. The e2e workflow's path gate includes `docker-compose.yml`, so a PR touching it triggers e2e (moot while Actions are off).

---

## #198 Nothing cleans web/dist, so local builds embed hundreds of stale chunks

**Still valid?** Yes. Right now `web/dist` has 261 entries, 252 of them `chunk-*`. `web/build.mjs` only `mkdirSync("dist")` (`:122`) and never removes anything; `jsOptions` uses `chunkNames: "chunk-[hash]"` (`:61`). `web/embed.go` embeds `all:dist`. `.gitignore` ignores everything in `web/dist` except `.gitkeep`. The service worker precache is computed from the import graph (`reachableFiles`), so it is unaffected, as the ticket says. `scripts/release-image.sh` does not touch `dist`.

**Problem.** Dev watch builds add new content-hashed chunks and never remove the old ones. Any binary built from this tree (`make image`, local `go build`) embeds all of them, so the release dry-run differs from the real release. CI is clean because it checks out fresh.

**Approach (recommended).** Clean in `web/build.mjs` at the start of a non-watch build (and at the start of watch, before the first blocking pass): remove everything in `dist/` except `.gitkeep`, then rebuild. One `for (const f of readdirSync("dist")) if (f !== ".gitkeep") rmSync(...)`. So `make build-web` (which `make image` depends on) is always clean, with no Makefile or `make image` change. Watch mode does not prune between rebuilds (that is what risks breaking a tab holding an old chunk); it is cleaned at each `make up`/restart of the web service. Alternative: also make `make image` refuse a dirty `dist`; not needed because `image` depends on `build-web`, which now cleans.

**Acceptance criteria**
- [ ] After `make build-web`, `web/dist` contains only files the current build wrote (plus `.gitkeep`): no chunk that `dist/app.js`'s import graph does not reach.
- [ ] `.gitkeep` survives, and a missing `dist/` still works (#40).
- [ ] `make image` after a long dev session builds from a clean `dist` (verified by file count before and after, pasted in the PR).
- [ ] Watch mode start also begins from a clean `dist` and still reaches healthy (the `/tmp/web-built` marker flow in `docker-compose.yml:112` still works).
- [ ] A running `app` server serving `dist` from disk (`web/assets_dev.go`) is not left broken: the clean-then-build window is documented or the ordering keeps `dist/index.html` present until replaced (state which).
- [ ] Unit test: a pure `cleanDist(dir)` helper (in `web/tools/`) tested with a temp directory: removes files and subdirectories, keeps `.gitkeep`, tolerates a missing dir. Mutation: dropping the `.gitkeep` exception fails.
- [ ] `make verify` green.

**Out of scope.** Pruning stale chunks during a running watch. Changing esbuild's hashing or `chunkNames`. Changes to the release script or CI.

**Questions for the owner** (1)
1. Should watch mode also prune old chunks after each rebuild (risk: a browser tab with the old shell then 404s on a lazy `import()` until reload)? Recommend no: clean on start only; stale chunks in a dev session are harmless and the 252 came from many sessions.

**Design session needed?** No.

**Type label.** None, or `bug`. The ticket reads as a defect (dry-run is not the release it rehearses) but it is build hygiene; recommend leaving it unlabelled. Currently unlabelled.

**Size.** S.

**Dependencies.** Same file as #201; order #201 then #198, or one after the other without overlap.

---

## #279 The dev stack publishes its port on every network

**Still valid?** Yes. `docker-compose.yml:10` is `"${THAT_PORT:-8080}:8080"`, which binds all interfaces. README `:37` binds the release to `127.0.0.1:8080:8080` and `:60` explains why (no login). `.env` here has `THAT_PORT=8081`; the `:-8080` default would collide with the owner's release container on 127.0.0.1:8080 (a different bind address on the same port: Docker allows 127.0.0.1:8080 and 0.0.0.0:8080 only if they do not overlap, so today the dev default would fail; after the change it would still be the same port on the same address, failing loudly instead).

**Problem.** The dev stack, with real Jira instances in `./data`, is reachable from every network the host is on. ThatApp has no authentication.

**Approach (recommended).** Change the mapping to `"127.0.0.1:${THAT_PORT:-8080}:8080"`. One line. The Playwright rig does not use the published port (it uses the Compose network, `docker-compose.yml:179`, and `forward.mjs`), and `app-e2e` publishes nothing, so nothing else changes. Add a comment citing the README reason. Alternative: introduce a `THAT_BIND` variable. Rejected by the CLAUDE.md rule: a new `THAT_*` variable is justified only when it must differ per environment; ticket 13 (LAN/phone) is deferred and can add it then.

**Acceptance criteria**
- [ ] `docker compose config` shows the `app` port published with host IP `127.0.0.1`.
- [ ] With `make up` running, `ss -ltn` shows the dev port on `127.0.0.1` only (command and output in the PR).
- [ ] `curl http://127.0.0.1:$THAT_PORT/api/health` works; the app is not reachable on the host's LAN address.
- [ ] A comment on the line says why (no login; same reason as the README).
- [ ] `.env.example`'s `THAT_PORT` comment says the port is bound to loopback.
- [ ] `make test-e2e` green (rig unaffected).
- [ ] The `eod` skill's `ss -ltn` check (`.claude/skills/eod/SKILL.md:249`) still matches (it greps the port, not the address; confirm).

**Out of scope.** Phone/LAN access and TLS (ticket 13). Binding the e2e app. Changing the in-container `THAT_ADDR`.

**Questions for the owner.** none. (One thing to know: a dev stack reached from the phone or another machine stops working. The design defers phone access to ticket 13 and nothing in the repo uses it today.)

**Design session needed?** No.

**Type label.** None. A security hardening of the dev setup; not a product defect. Unlabelled is right.

**Size.** S.

**Dependencies.** None. Touches `docker-compose.yml` like #137.

---

## #43 Run the Go suite under -race

**Still valid?** Yes. `make test-go` is `$(APP) go test ./...` (`Makefile:42`). Comment 2026-09-02 (owner-approved) says: measure cost first; the Codeberg ten-minute cap matters; `make test-go` and `verify.yml` must both change. Today's facts have moved on: hosted CI is stopped (#284, `has_actions: false`), so verify runs locally via `make verify`; the cap is moot until #220 exists. The concurrent surface is bigger: `internal/server/fanout.go`, `issues.go`, `server.go` (and push/MCP). 35 test files; one `t.Parallel` in the whole tree (`mcp_tools_test.go`).

**Key new finding.** `-race` needs cgo and a C toolchain. The `dev` image is `golang:1.26-alpine` with `ENV CGO_ENABLED=0` (`Dockerfile:5`) and no gcc, and `verify.yml:64-69` sets `CGO_ENABLED=0` on purpose ("no C toolchain" is the point of that comment). So this is not just a flag: the race target needs `apk add gcc musl-dev` in an image stage (or a separate stage) and `CGO_ENABLED=1` for that one command only. I did not measure suite time (rule: no running tests). Whether the race detector works on musl for this arch (x86_64 here) is a thing to verify first; Go supports it on linux/amd64 with a C compiler.

**Problem.** The fan-out and push code share clients, the sealer and the DB across goroutines, and the only check is a reviewer's reading. The suite runs without the race detector, and the image cannot run it.

**Approach (recommended).** Measure first (first AC), then add a separate `make test-race` target (`go test -race ./...` with `CGO_ENABLED=1`) on a dev-image variant that has gcc and musl-dev, so the normal `test-go` stays fast and cgo-free. Include it in `make verify` only if the measured extra time is small; otherwise keep it as its own target the process names ("run before opening a PR touching concurrency", and in CI as its own job once #220 lifts the cap). Alternative: make `test-go` itself `-race` and put gcc in the image for everything. Simpler, one code path, but every test run pays the 5-10x slowdown and the build needs cgo for all tests, which weakens the "bare runner, no C toolchain" property the verify workflow protects.

**Acceptance criteria**
- [ ] Measured and pasted in the PR: wall time of `go test ./...` vs `go test -race ./...` on this machine (same cache state).
- [ ] `make test-race` runs `go test -race ./...` in Docker and passes on current main, or the races it finds are filed as bug tickets (not fixed here) with the target left red-free by a documented skip list... only if the owner says so (see question).
- [ ] The dev image gains a C compiler without breaking `go run -tags dev` for `app`/`app-e2e` (they stay `CGO_ENABLED=0`, or the `go test -race` command sets cgo itself).
- [ ] A deliberate data-race test (a throwaway test with an unsynchronised counter, run under `-race`) fails the target, proving the gate catches races; the throwaway test is removed before commit (mutation check, shown in the PR).
- [ ] `verify.yml` is changed in step: either a new job running `go test -race ./...` (installing gcc if the runner lacks it) or an explicit comment that race runs only locally; `make verify` and the workflow agree (CLAUDE.md warns they drift).
- [ ] If included in `verify`, total `make verify` time increase is stated and the owner accepted it.
- [ ] CLAUDE.md Commands list and `make help` show the new target.

**Out of scope.** Fixing any race the run reveals (separate bug tickets). Adding `t.Parallel` across the suite. Frontend race concerns.

**Questions for the owner** (2)
1. Does the race gate belong in `make verify` or only in its own target? Recommend its own target `make test-race`, added to `verify` only if the measurement shows under about 60 s extra; decide after the measurement the first AC produces.
2. If `-race` finds a real race, should the ticket block on fixing it? Recommend no: file a `bug`, keep the target in the Makefile, and gate in verify only after the bug is fixed.

**Design session needed?** No.

**Type label.** None (test infrastructure, as the label rules say).

**Size.** M. The flag is one line; the cgo toolchain in the image, the measurement, and keeping CI and Make equivalent are the work.

**Dependencies.** Soft: a CI job only becomes meaningful once #220 (runner) exists. The local half does not wait.

---

## #220 CI runs on a self-hosted runner instead of Codeberg's shared pool

**Still valid?** Partly. The goal stands, but the premise moved. Since 2026-10-07, Codeberg **disabled hosted Actions for this repository** (#284, closed): the stated reason is the volume of pipelines and a new Terms of Use clause about projects that mostly consist of generative-AI code. The repo has `has_actions: false`. All three workflows still say `runs-on: codeberg-medium` (`verify.yml:38,72`, `e2e.yml:78`, `release.yml:26`). The body's "stalled shared pool" problem is no longer the problem; "no CI at all" is. Whether a self-hosted runner can run here at all depends on Actions being re-enabled for the repo, which Codeberg turned off, and I could not verify from the repo whether a repo-level toggle is still available to the owner or whether Codeberg's policy also forbids self-hosted runners for it. (I believe a Forgejo repo's Actions switch must be on for any runner, hosted or self-hosted, to take its jobs; and Codeberg's doc on self-hosted runners is separate, but I did not fetch it.) The ToS clause also puts the project on Codeberg at risk, which is bigger than CI.

**Problem.** There is no automated gate: both `make verify` and `make test-e2e` run by hand before every PR (handoff, 2026-10-07). The release script is also run by hand. The workflows' hosted-runner assumptions (ten-minute cap, no Docker, Codeberg registry token in a secret) are the other part of the old problem.

**Approach (recommended).** Do not start before the owner settles the Codeberg question below. If a runner is still possible: Forgejo runner on an always-on host, Docker backend (job containers), registered at repo scope with a token that is not committed; start by changing only `runs-on:` to a label like `thatapp` and keeping the workflows as they are (small, proven change). Do not move CI to `make` targets in the same ticket: file that as a follow-up (it would remove the verify/Compose drift and the e2e split, but is its own design). Release job: leave it unautomated while releases are local (the owner's current recipe), and decide when the runner is live. Setup documented in `docs/` as a runbook (host, how to register, how to rotate, what job containers can reach), with `<TOKEN>` placeholders only. Alternative: abandon Codeberg Actions, mirror to a forge that allows this and build there. The body already rejected mirroring; the Terms change makes it worth a second look.

**Acceptance criteria** (only if the owner chooses to proceed)
- [ ] Decision recorded on the ticket: Codeberg allows Actions with a self-hosted runner for this repo, who enables it, and under what terms.
- [ ] A runner is registered with the repository on a named always-on host; the runbook in `docs/` lets a second person rebuild it; no secret in the repository (`git grep` for the token shape finds nothing).
- [ ] The runner uses Docker-backed job containers and job containers cannot reach the host Docker socket or the dev machine's LAN beyond what jobs need (checked and described).
- [ ] Fork pull requests do not run on the runner without approval (setting named, tested with a throwaway fork or documented from the Forgejo docs with the version), because the repo is public.
- [ ] `verify.yml` and `e2e.yml` `runs-on:` point at the new label; one real PR shows both green on it. e2e `workers: 4` (`playwright.config.ts:39`) is checked against the host's CPU count.
- [ ] How an outage is noticed is documented (a PR whose jobs stay `waiting` is the signal; any monitoring is out of scope unless the owner wants it).
- [ ] The ten-minute-cap comments in `verify.yml`/`e2e.yml` are updated or removed if the cap no longer applies; the splits are left unless the owner decides otherwise.
- [ ] `CLAUDE.md`, `ticket-workflow` and the handoff drop the "CI stopped; run both gates locally" rule only after the first green run, in a `[Process]` PR.

**Out of scope.** Moving CI to `make` targets/Docker (follow-up). Automating releases on the runner (decide separately). Monitoring/alerting. The `docker-compose.yml` change in #279.

**Questions for the owner** (3)
1. Is a self-hosted runner for this repo still possible and wanted, given Codeberg disabled Actions here and its Terms mention largely AI-written projects? This decides whether the ticket continues, moves to another forge, or closes in favour of `make verify` locally. Recommend: ask Codeberg (the notice invites compliance discussion) before any host work; until answered, park this ticket.
2. Which host, and how big? Recommend any always-on Linux box with Docker and at least 4 vCPU / 8 GB (matching what e2e was sized for); I do not know what you own, so I cannot name it.
3. Should the release job move to the runner now? Recommend no: keep local releases until the runner has run green for a while, then migrate with the registry token as a repository secret.

**Design session needed?** No.

**Type label.** None (infrastructure).

**Size.** L. Mostly decisions and a host, not code; the code is a label change plus a runbook. If the answer to question 1 is "no", it becomes a close.

**Dependencies.** Decision on Codeberg's policy (external). Unblocks CI for #43's race job. Supersedes the local-gates workaround from #284.
