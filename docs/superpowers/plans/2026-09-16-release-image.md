# One Docker image per version — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-09-16
**Supersedes:** nothing
**Superseded by:** nothing

**Goal:** Pushing a `vYYYY.WW.N` tag publishes a `linux/amd64` + `linux/arm64` image of the app to
`codeberg.org/diongerrese/thatapp`, and a colleague can run it from one page of instructions.

**Architecture:** The image is a static binary and the CA bundle on an empty base, so it is not
*built* at all in the Dockerfile sense — it is *assembled*. One POSIX shell script cross-compiles the
binary per architecture, tars each into a layer, and pushes the layers, per-arch manifests and one
index with `crane` (go-containerregistry), which needs no Docker daemon. Codeberg's hosted runners
have none, which is what rules out `docker build`. The script starts a throwaway in-process registry
when its target is `localhost:*`, so a pull request and `make image` exercise the exact path a tag
does, minus the Codeberg push.

**Tech Stack:** POSIX `sh`, `crane` v0.22.1 run through `go run …@v0.22.1` (a tool, not a module
dependency — `go.mod` does not change), Forgejo Actions, Make + Compose locally.

**Spec:** issue [#122](https://codeberg.org/DionGerrese/ThatApp/issues/122) — its body holds the
settled decisions, the constraints and the acceptance criteria. Read it first.

## Global Constraints

- No Go, Node or npm on the host. Locally everything runs through `make` or `docker compose`; CI
  runs the same tools natively.
- Registry path: `codeberg.org/diongerrese/thatapp` (lower case — Codeberg lowercases the owner).
- Version: `YYYY.WW.N` in the image tag and binary; the git tag carries a leading `v`. Regex:
  `^[0-9]{4}\.(0[1-9]|[1-4][0-9]|5[0-3])\.[1-9][0-9]*$`.
- Image tags per release: `<version>`, `latest`, and `<version>-amd64` / `<version>-arm64`.
- `THAT_SECRET_KEY` never appears in the image, a build argument or a log.
- Instructions publish the port as `127.0.0.1:8080:8080`, never bare `8080:8080`.
- Every Codeberg job finishes inside ten minutes.
- Comments: few, and only for a non-obvious why.
- `make up`, the `dev` and `webdev` Dockerfile stages, and `make verify` are unchanged in behaviour.

## Files

| File | Change | Responsibility |
|---|---|---|
| `cmd/server/main.go` | modify | carries `version`, logs it first |
| `scripts/release-image.sh` | create | validate, cross-compile, assemble, push, check |
| `Makefile` | modify | `image` target: the dry run |
| `Dockerfile` | modify | drop the unbuilt `web`, `build` and `prod` stages |
| `.forgejo/workflows/release.yml` | create | tag → publish; PR → dry run |
| `README.md` | create | the colleague-facing page |

---

### Task 1: The binary reports its version

**Files:**
- Modify: `cmd/server/main.go`

**Interfaces:**
- Produces: package-level `var version = "dev"` in `package main`, overridden with
  `-ldflags "-X main.version=<v>"`. The first line the binary logs, before configuration is read, is
  `thatapp <version>`. Task 2's script greps for exactly that.

Logged before `config.Load` on purpose: a binary run with an empty environment still prints its
version before it exits on missing configuration, which is how the script checks it with nothing
else set up.

- [ ] **Step 1: Show it fails.** Build with the flag and run with an empty environment:

```shell
docker compose run --rm --no-deps app sh -c 'go build -ldflags "-X main.version=2026.38.1" -o /tmp/t ./cmd/server && env -i /tmp/t 2>&1 | head -1'
```

Expected: `… configuration: THAT_TIMEZONE is required …` — no version line. Paste it in the report.

- [ ] **Step 2: Implement.** In `cmd/server/main.go`, above `func main()`:

```go
// Set at release build time; see scripts/release-image.sh.
var version = "dev"
```

and as the first statement of `main`:

```go
	log.Printf("thatapp %s", version)
```

- [ ] **Step 3: Show it passes.** Rerun Step 1's command. Expected first line ends
`thatapp 2026.38.1`. Then without the flag:

```shell
docker compose run --rm --no-deps app sh -c 'go build -o /tmp/t ./cmd/server && env -i /tmp/t 2>&1 | head -1'
```

Expected: ends `thatapp dev`.

- [ ] **Step 4:** `make verify` → `verify: OK`.

- [ ] **Step 5: Commit** — `feat(#122): the binary logs its version at boot`.

---

### Task 2: The release script, its dry run, and the Dockerfile's dead stages

**Files:**
- Create: `scripts/release-image.sh` (mode 0755)
- Modify: `Makefile`
- Modify: `Dockerfile`

**Interfaces:**
- Consumes: Task 1's `main.version` and its `thatapp <version>` log line.
- Produces: `sh scripts/release-image.sh VERSION REPO`, run from the repository root with
  `web/dist` already built. `VERSION` is `YYYY.WW.N` without the `v`. When `REPO` starts with
  `localhost:` the script needs no credentials, and starts a registry there unless one already answers; otherwise it needs
  `REGISTRY_USER` and `REGISTRY_TOKEN` in the environment and logs in with them. Exit status 2 means
  the arguments were rejected before anything was built or pushed. Task 3 calls it both ways.

- [ ] **Step 1: Show it fails.** `make image` → `make: *** No rule to make target 'image'`.

- [ ] **Step 2: Write the script** at `scripts/release-image.sh`:

```sh
#!/bin/sh
# Assembles the release image for linux/amd64 and linux/arm64 and pushes it as
# one index to REPO:VERSION and REPO:latest.
#
# There is no `docker build`: Codeberg's runners have no Docker daemon, and an
# image that is one static binary on an empty base needs no build stage, only a
# layer. crane assembles and pushes it without a daemon.
#
# usage: release-image.sh VERSION REPO    (web/dist must already be built)
#
# A localhost REPO gets a throwaway registry started here unless one is already
# listening, which is how pull requests and `make image` run this exact path
# without touching Codeberg.
set -eu

usage="usage: release-image.sh YYYY.WW.N REPO"
version=${1:?$usage}
repo=${2:?$usage}

# The case rejects anything but digits and dots first, so a multi-line value
# cannot slip one good line past grep.
case $version in
*[!0-9.]*) valid= ;;
*) valid=$(printf '%s\n' "$version" | grep -Ex '[0-9]{4}\.(0[1-9]|[1-4][0-9]|5[0-3])\.[1-9][0-9]*' || true) ;;
esac
if [ -z "$valid" ]; then
	echo "release-image: '$version' is not YYYY.WW.N" >&2
	exit 2
fi

crane() { go run github.com/google/go-containerregistry/cmd/crane@v0.22.1 "$@"; }
fail() { echo "release-image: $*" >&2; exit 1; }

case $repo in
localhost:*)
	if ! crane catalog "${repo%%/*}" >/dev/null 2>&1; then
		crane registry serve --address "${repo%%/*}" &
		trap 'kill $! 2>/dev/null' EXIT
		tries=0
		until crane catalog "${repo%%/*}" >/dev/null 2>&1; do
			tries=$((tries + 1))
			[ "$tries" -lt 60 ] || fail "local registry did not start"
			sleep 1
		done
	fi
	;;
*)
	[ -n "${REGISTRY_USER:-}" ] && [ -n "${REGISTRY_TOKEN:-}" ] || {
		echo "release-image: REGISTRY_USER and REGISTRY_TOKEN are required for $repo" >&2
		exit 2
	}
	printf '%s' "$REGISTRY_TOKEN" | crane auth login "${repo%%/*}" -u "$REGISTRY_USER" --password-stdin
	;;
esac

work=$(mktemp -d)
expected='etc
etc/ssl
etc/ssl/certs
etc/ssl/certs/ca-certificates.crt
thatapp'

for arch in amd64 arm64; do
	root=$work/$arch
	mkdir -p "$root/etc/ssl/certs"
	CGO_ENABLED=0 GOOS=linux GOARCH=$arch go build -trimpath \
		-ldflags="-s -w -X main.version=$version" -o "$root/thatapp" ./cmd/server
	cp /etc/ssl/certs/ca-certificates.crt "$root/etc/ssl/certs/"

	go version -m "$root/thatapp" | grep -q "GOARCH=$arch" || fail "$arch binary has the wrong GOARCH"
	if [ "$arch" = "$(go env GOHOSTARCH)" ]; then
		env -i "$root/thatapp" 2>&1 | grep -q "thatapp $version\$" || fail "binary does not report $version"
	fi

	tar -C "$root" -cf "$work/$arch.tar" thatapp etc
	[ "$(tar -tf "$work/$arch.tar" | sed 's:/$::' | LC_ALL=C sort)" = "$expected" ] || fail "$arch layer holds more than the binary and CA bundle"

	crane append --oci-empty-base -f "$work/$arch.tar" -t "$repo:$version-$arch"
	crane mutate "$repo:$version-$arch" -t "$repo:$version-$arch" \
		--set-platform "linux/$arch" --entrypoint /thatapp --exposed-ports 8080
	crane config "$repo:$version-$arch" | grep -q "\"architecture\":\"$arch\"" || fail "$arch config has the wrong architecture"
done

crane index append -m "$repo:$version-amd64" -m "$repo:$version-arm64" -t "$repo:$version"
crane tag "$repo:$version" latest

for arch in amd64 arm64; do
	crane manifest "$repo:latest" | grep -q "\"architecture\":\"$arch\"" || fail "index is missing $arch"
done
echo "release-image: pushed $repo:$version and $repo:latest"
```

Notes for the implementer, checked on 2026-09-16 with v0.22.1:
- `crane append` with no `-b` appends to an empty base. `crane mutate -t` with the same tag
  overwrites it in place.
- The spike that proved this passed `--insecure` for `localhost:5000`. go-containerregistry already
  uses plain HTTP for `localhost`, so the script omits it. **Confirm that in Step 4.** If a push fails
  with a TLS error, add `--insecure` to the calls *only* inside the `localhost:*` branch's reach —
  set `insecure=--insecure` there and pass `$insecure` unquoted on each call — and never for Codeberg.
- `crane auth login --password-stdin` — confirm the flag with `crane auth login --help` before relying
  on it. If it is missing, stop and report; do not put the token on the command line.

- [ ] **Step 3: Add the Make target.** In `Makefile`, add `image` to `.PHONY`, and after `build-web`:

```make
# The release path as CI runs it on a version tag, pushing to a throwaway registry
# inside the container instead of Codeberg.
image: build-web ## Dry-run the release image build and push
	$(APP) sh scripts/release-image.sh 0000.01.1 localhost:5000/thatapp
```

- [ ] **Step 4: Show it passes.** `make image`. Expected last line:
`release-image: pushed localhost:5000/thatapp:0000.01.1 and localhost:5000/thatapp:latest`, and
exit 0. Paste the tail.

- [ ] **Step 5: Show the guards fail closed.** Each must exit 2 before any `go build` output:

```shell
for v in 2026.54.1 2026.38.0 2026.9.1 v2026.38.1 26.38.1 "$(printf '2026.38.1\nx')"; do
  docker compose run --rm --no-deps app sh scripts/release-image.sh "$v" localhost:5000/thatapp; echo "exit $?"
done
docker compose run --rm --no-deps app sh scripts/release-image.sh 2026.38.1 codeberg.org/diongerrese/thatapp; echo "exit $?"
```

Expected: seven `exit 2`, the last with the `REGISTRY_USER and REGISTRY_TOKEN` message. Paste them.

- [ ] **Step 6: Show a broken check bites.** Temporarily change `expected` to drop the
`thatapp` line, run `make image`, expect `layer holds more than the binary and CA bundle` and a
non-zero exit; restore it. Paste the failure.

- [ ] **Step 7: Delete the Dockerfile's unbuilt stages.** Nothing targets `web`, `build` or `prod`
(Compose builds `dev` and `webdev`; the e2e rig has its own Dockerfile). The script is now the only
definition of the release image, and a second one would drift. Remove the `FROM node:26-alpine AS
web`, `FROM golang:1.26-alpine AS build` and `FROM scratch AS prod` stages in full, and in the
`webdev` stage's comment drop the sentence `Distinct from the \`web\` stage above, which builds dist
for the prod image.`

- [ ] **Step 8:** `make up` starts and `curl -s localhost:8080/api/health` returns `{"status":"ok"}`;
`make down`. Then `make verify` → `verify: OK`. Paste both.

- [ ] **Step 9: Commit** — `feat(#122): assemble and push the release image without a daemon`.

---

### Task 3: The release workflow

**Files:**
- Create: `.forgejo/workflows/release.yml`

**Interfaces:**
- Consumes: Task 2's script and its `REGISTRY_USER` / `REGISTRY_TOKEN` contract.
- Produces: a repository secret named `RELEASE_TOKEN` is required for tag runs. It is the owner's to
  create (a Codeberg access token with the `write:package` scope and nothing else); this task does
  not create it.

- [ ] **Step 1: Write the workflow:**

```yaml
name: Release

# A version tag publishes the image to Codeberg's registry. A pull request that
# touches the release path runs the same script against a throwaway registry, so
# the first real tag is not the first time the path has run.
#
# The tag reaches the script through the environment, never interpolated into
# the command: a tag name is attacker-shaped input, and the script validates it
# before building anything.

on:
  push:
    tags: ["v*"]
  pull_request:
    paths:
      - "scripts/release-image.sh"
      - ".forgejo/workflows/release.yml"
      - "cmd/server/**"
      - "go.mod"

jobs:
  image:
    runs-on: codeberg-medium
    steps:
      - uses: https://data.forgejo.org/actions/checkout@v5

      - uses: https://data.forgejo.org/actions/setup-go@v5
        with:
          go-version-file: go.mod

      - uses: https://data.forgejo.org/actions/setup-node@v4
        with:
          node-version: 26

      - name: Build frontend
        working-directory: web
        run: npm ci --no-audit --no-fund && npm run build

      - name: Dry run
        if: github.event_name == 'pull_request'
        run: sh scripts/release-image.sh 0000.01.1 localhost:5000/thatapp

      - name: Publish
        if: github.event_name == 'push'
        env:
          TAG: ${{ github.ref_name }}
          REGISTRY_USER: ${{ github.repository_owner }}
          REGISTRY_TOKEN: ${{ secrets.RELEASE_TOKEN }}
        run: sh scripts/release-image.sh "${TAG#v}" codeberg.org/diongerrese/thatapp
```

- [ ] **Step 2: Evidence comes from CI.** There is no local Forgejo runner. The pull request for
this ticket touches `scripts/release-image.sh`, so the `Release / image` job runs its dry run there.
The controller pushes the branch and reports that run's result and duration; it must pass and
finish under ten minutes. Do not push from the task.

- [ ] **Step 3: Commit** — `ci(#122): publish the image on a version tag`.

---

### Task 4: The colleague's page, checked against the real image

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: the image produced by Task 2.

- [ ] **Step 1: Write `README.md`:**

````markdown
# ThatApp

A personal dashboard for the Jira issues assigned to you across several Jira Cloud sites, with local
time tracking that is pushed to Jira as worklogs. One user per install.

## Running it

You need Docker. Nothing else.

### 1. Make a secret key — once, and keep it

ThatApp encrypts your Jira API tokens with a key only you hold. **Generate your own; never reuse
someone else's.** Anyone with your key and your data volume can read your tokens.

```shell
docker run --rm alpine sh -c 'head -c 32 /dev/urandom | base64'
```

Put it in a file called `thatapp.env`, next to your timezone:

```shell
THAT_SECRET_KEY=<the key you just generated>
THAT_TIMEZONE=Europe/Amsterdam
```

`THAT_TIMEZONE` is an [IANA name](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones). It
decides where your day ends, for the end-of-day push and the weekly rollup.

**If you lose the key**, the app cannot read the tokens it stored. Your time entries survive, but you
will have to enter each Jira API token again. Keep the file somewhere safe and out of version
control.

### 2. Start it

```shell
docker run -d --name thatapp --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -v thatapp-data:/data \
  --env-file thatapp.env \
  codeberg.org/diongerrese/thatapp:latest
```

Open <http://localhost:8080>.

**Keep the `127.0.0.1:` in front of the port.** ThatApp has no login: anyone who can reach the port
can use your Jira tokens. `127.0.0.1:8080:8080` makes it reachable from your own machine only.
Plain `-p 8080:8080` publishes it to every network you are on.

### 3. Upgrade

Releases are named `YYYY.WW.N` — year, ISO week, and the release number within that week. To move to
the newest:

```shell
docker pull codeberg.org/diongerrese/thatapp:latest
docker rm -f thatapp
```

then run the command from step 2 again. Your data is in the `thatapp-data` volume and is upgraded
in place when the app starts. To stay on one release, use its tag instead of `latest`, for example
`codeberg.org/diongerrese/thatapp:2026.38.1`.

### Backing up

Everything is in the `thatapp-data` volume. Stop the app first, so the database is not mid-write:

```shell
docker stop thatapp
docker run --rm -v thatapp-data:/data -v "$PWD":/backup alpine tar czf /backup/thatapp-data.tgz -C /data .
docker start thatapp
```

Back up `thatapp.env` too — the data is no use without its key.
````

- [ ] **Step 2: Run the README against the real image.** Assemble the image and pull the amd64
variant to a tarball in one container, then follow the README on the host:

```shell
make build-web
docker compose run --rm --no-deps app sh -c '
  crane() { go run github.com/google/go-containerregistry/cmd/crane@v0.22.1 "$@"; }
  crane registry serve --address localhost:5000 &
  until crane catalog localhost:5000 >/dev/null 2>&1; do sleep 1; done
  sh scripts/release-image.sh 0000.01.1 localhost:5000/thatapp &&
  crane pull --platform linux/amd64 localhost:5000/thatapp:0000.01.1 /src/.image-amd64.tar'
docker load -i .image-amd64.tar && rm .image-amd64.tar
```

The registry is started outside the script, so the script leaves it running and the pull finds the
image. If `/src` is not the repository root inside the `app` service, write the tarball wherever
the repository is mounted and say so.

Then, with `localhost:5000/thatapp:0000.01.1` in place of the README's image name and a scratch
`thatapp.env` made with the README's own key command:
1. Step 2's `docker run`, on host port 18122 instead of 8080 so it cannot collide with `make up`.
2. `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18122/` → `200`;
   `curl -s http://127.0.0.1:18122/api/health` → `{"status":"ok"}`.
3. `docker logs thatapp` first line ends `thatapp 0000.01.1`.
4. `docker inspect thatapp --format '{{json .NetworkSettings.Ports}}'` shows `HostIp` `127.0.0.1`.
5. `docker image inspect localhost:5000/thatapp:0000.01.1 --format '{{json .Config}}'` — no `Env`
   holding any `THAT_*` value.
6. `docker restart thatapp`; health is still `ok`; `docker run --rm -v thatapp-data:/d alpine ls /d`
   lists `thatapp.db`.
7. The backup commands, verbatim; `thatapp-data.tgz` exists and `tar tzf` lists `./thatapp.db`.
8. Clean up: `docker rm -f thatapp`, `docker volume rm thatapp-data`,
   `docker rmi localhost:5000/thatapp:0000.01.1`, delete the scratch env file and the tarball.

Paste each result. **arm64 cannot be run on this machine** — it has no binfmt emulation, and
installing it changes the host kernel's configuration, which is the owner's call. The script's
GOARCH and config checks are the arm64 evidence; say so in the report rather than claiming a run.

- [ ] **Step 3: Commit** — `docs(#122): how a colleague runs a release`.

---

## After the tasks

- Whole-branch review, then `make verify` (and `make test-e2e`, since `Dockerfile` and `Makefile`
  are on its path list), then push and open the pull request with `Closes #122`.
- The pull request body lists the **owner's actions after merge**, in order: create a Codeberg token
  with `write:package` only and store it as the repository secret `RELEASE_TOKEN`; push the first
  tag (`git tag -s v2026.WW.1 && git push codeberg v2026.WW.1`); link the published package to the
  repository in Codeberg's package settings; run an anonymous `docker pull` from a logged-out
  machine and record the result on #122. That last check ticks #122's anonymous-pull criterion.
