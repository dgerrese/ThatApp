# Scaffolding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the containerised Go + vanilla-TS skeleton with a working verification gate, so that every later ticket has a green `make verify` to build against.

**Architecture:** A single Go binary serves both the JSON API and the static PWA. The frontend is built by a Node toolchain into `web/dist`, which the binary embeds at compile time in production and reads from disk in development, selected by a build tag. Nothing is installed on the host — every command runs through Docker Compose.

**Tech Stack:** Go 1.26, `net/http` stdlib only; TypeScript + esbuild; Tailwind CSS v4 via `@tailwindcss/cli`; golangci-lint 2.12; ESLint 9 flat config; Prettier; Docker Compose; GitHub Actions.

This plan implements **ticket 1** of the sequence in
`docs/superpowers/specs/2026-08-04-work-dashboard-design.md`. Tickets 2–13 get their own tickets
written by the project-manager agent as they are picked up.

> **Historical note, 2026-08-07.** Ticket 1 shipped from this plan and it is kept as the record of
> that. The sentence above is no longer true: the project-manager agent was removed along with the
> rest of the agent team, and tickets 2–13 get their plans from `superpowers:writing-plans`
> instead. See `CLAUDE.md` for the current workflow. Nothing else in this document was changed.

## Global Constraints

Every task's requirements implicitly include all of these. They come from the spec and are not
open to reinterpretation.

- **Everything runs in Docker.** Never run bare `go`, `npm`, `node`, or `npx` on the host.
- **No JavaScript frameworks.** Vanilla JS only; TypeScript permitted for typing.
- **Tailwind CSS v4** for all styling. v4 is CSS-first: there is no `tailwind.config.js`.
- **Initial HTTP response under 14kB.** The app shell inlines critical CSS; everything else loads
  as separate cached modules.
- **Reusable UI is native WebComponents**, using light DOM — never shadow DOM, which would stop
  Tailwind utilities reaching component internals.
- **Go version 1.26.** **Node version 26.** **golangci-lint version 2.12.2** (v2 config schema —
  the v1 schema will not parse).
- `make verify` is the single merge gate. It must pass before any task is considered done.

---

### Task 1: Docker, Compose and the Go module skeleton

Nothing can be tested until there is a container to test in. This task creates the toolchain and
ends with `make test-go` running successfully against an empty package.

**Files:**
- Create: `go.mod`, `Dockerfile`, `docker-compose.yml`, `Makefile`, `.env.example`
- Create: `cmd/server/main.go`, `web/dist/.gitkeep`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `make` targets `up`, `down`, `test-go`, `build-web`, `lint-go`, `lint-web`, `tsc`,
  `verify`; Compose services `app`, `web`, `lint`

- [ ] **Step 1: Create the Go module and a placeholder entrypoint**

`cmd/server/main.go`:

```go
package main

import (
	"log"

	_ "time/tzdata" // embed the zoneinfo database; the scratch image has none
)

func main() {
	log.Println("work-dashboard: starting")
}
```

The blank `time/tzdata` import is load-bearing, not decoration. The production image is `scratch`
and contains no zoneinfo files, so `time.LoadLocation` on `WD_TIMEZONE` would fail at runtime
without it.

- [ ] **Step 2: Write the Dockerfile**

`Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1

FROM node:26-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . .
COPY --from=web /src/web/dist ./web/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/work-dashboard ./cmd/server

FROM golang:1.26-alpine AS dev
WORKDIR /src
ENV CGO_ENABLED=0

FROM scratch AS prod
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=build /out/work-dashboard /work-dashboard
EXPOSE 8080
ENTRYPOINT ["/work-dashboard"]
```

Copying `ca-certificates.crt` is also load-bearing: `scratch` has no trust store, so every HTTPS
call to Jira would fail with a certificate verification error without it.

- [ ] **Step 3: Write the Compose file**

`docker-compose.yml`:

```yaml
services:
  app:
    build:
      context: .
      target: dev
    ports:
      - "${WD_PORT:-8080}:8080"
    volumes:
      - .:/src
      - go-mod-cache:/go/pkg/mod
      - go-build-cache:/root/.cache/go-build
      - wd-data:/data
    environment:
      WD_ADDR: ":8080"
      WD_DB_PATH: /data/work-dashboard.db
      WD_SECRET_KEY: "${WD_SECRET_KEY:-}"
      WD_TIMEZONE: "${WD_TIMEZONE:-Europe/Amsterdam}"
    command: go run -tags dev ./cmd/server

  web:
    image: node:26-alpine
    working_dir: /src/web
    volumes:
      - .:/src
      - web-node-modules:/src/web/node_modules
    command: npm run watch

  lint:
    image: golangci/golangci-lint:v2.12.2
    working_dir: /src
    entrypoint: []
    volumes:
      - .:/src
      - go-mod-cache:/go/pkg/mod
      - golangci-cache:/root/.cache

volumes:
  go-mod-cache:
  go-build-cache:
  golangci-cache:
  web-node-modules:
  wd-data:
```

- [ ] **Step 4: Write the Makefile**

`Makefile` (tabs, not spaces, for the recipe lines):

```makefile
.DEFAULT_GOAL := help
COMPOSE := docker compose
APP     := $(COMPOSE) run --rm --no-deps app
WEB     := $(COMPOSE) run --rm --no-deps web
LINT    := $(COMPOSE) run --rm --no-deps lint

.PHONY: help up down build-web test-go test fmt lint-go lint-web lint tsc verify

help: ## Show this help
	@grep -E '^[a-z-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  %-12s %s\n", $$1, $$2}'

up: ## Start the dev stack
	$(COMPOSE) up

down: ## Stop the dev stack and drop its volumes
	$(COMPOSE) down -v

build-web: ## Build the frontend into web/dist
	$(WEB) npm run build

test-go: ## Run the Go test suite
	$(APP) go test ./...

test: test-go ## Run all tests

fmt: ## Format Go and frontend sources
	$(LINT) golangci-lint fmt
	$(WEB) npm run fmt

lint-go: ## Lint the Go sources
	$(LINT) golangci-lint run

lint-web: ## Lint the frontend sources
	$(WEB) npm run lint

lint: lint-go lint-web ## Lint everything

tsc: ## Type-check the frontend
	$(WEB) npx tsc --noEmit

verify: lint tsc test ## The full merge gate
	@echo "verify: OK"
```

- [ ] **Step 5: Create the environment example and update .gitignore**

`.env.example`:

```
# 32 raw bytes, base64-encoded. Generate with:
#   docker compose run --rm --no-deps app sh -c 'head -c 32 /dev/urandom | base64'
WD_SECRET_KEY=

# IANA timezone name. Decides where the day boundary falls for time entries.
WD_TIMEZONE=Europe/Amsterdam

# Host port the dashboard is published on.
WD_PORT=8080
```

Replace the build-output block in `.gitignore` so that `web/dist` stays present but empty. The
directory must exist for `go:embed` to compile:

```
# Build output
web/dist/*
!web/dist/.gitkeep
web/node_modules/
bin/
```

Then create the empty file `web/dist/.gitkeep`.

- [ ] **Step 6: Initialise the module and verify the toolchain runs**

```bash
docker compose run --rm --no-deps app go mod init github.com/dgerrese/work-dashboard
make test-go
```

Expected: `go mod init` writes `go.mod`; `make test-go` prints `no test files` for the `cmd/server`
package and exits 0. A non-zero exit here means the container plumbing is wrong — fix it before
continuing, because every later task depends on this loop working.

- [ ] **Step 7: Commit**

```bash
git add go.mod Dockerfile docker-compose.yml Makefile .env.example .gitignore \
        cmd/server/main.go web/dist/.gitkeep
git commit -m "build: containerised Go toolchain and make targets"
```

---

### Task 2: Configuration loading

**Files:**
- Create: `internal/config/config.go`, `internal/config/config_test.go`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:
  - `type Config struct { Addr string; DBPath string; Secret []byte; Location *time.Location }`
  - `func Load(getenv func(string) string) (*Config, error)`

`Load` takes a `getenv` function rather than reading `os.Getenv` directly so tests can supply
environment values without mutating global process state — parallel tests that set real env vars
interfere with each other.

- [ ] **Step 1: Write the failing tests**

`internal/config/config_test.go`:

```go
package config_test

import (
	"testing"

	"github.com/dgerrese/work-dashboard/internal/config"
)

func envFrom(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func validEnv() map[string]string {
	return map[string]string{
		// 32 zero bytes, base64-encoded
		"WD_SECRET_KEY": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
		"WD_TIMEZONE":   "Europe/Amsterdam",
	}
}

func TestLoadAppliesDefaults(t *testing.T) {
	cfg, err := config.Load(envFrom(validEnv()))
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}
	if cfg.Addr != ":8080" {
		t.Errorf("Addr = %q, want %q", cfg.Addr, ":8080")
	}
	if cfg.DBPath != "/data/work-dashboard.db" {
		t.Errorf("DBPath = %q, want %q", cfg.DBPath, "/data/work-dashboard.db")
	}
	if cfg.Location.String() != "Europe/Amsterdam" {
		t.Errorf("Location = %q, want %q", cfg.Location, "Europe/Amsterdam")
	}
	if len(cfg.Secret) != 32 {
		t.Errorf("len(Secret) = %d, want 32", len(cfg.Secret))
	}
}

func TestLoadRejectsBadInput(t *testing.T) {
	cases := map[string]func(map[string]string){
		"missing secret":     func(m map[string]string) { delete(m, "WD_SECRET_KEY") },
		"secret not base64":  func(m map[string]string) { m["WD_SECRET_KEY"] = "not!base64" },
		"secret wrong size":  func(m map[string]string) { m["WD_SECRET_KEY"] = "AAAA" },
		"missing timezone":   func(m map[string]string) { delete(m, "WD_TIMEZONE") },
		"unparseable tzname": func(m map[string]string) { m["WD_TIMEZONE"] = "Mars/Olympus" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			env := validEnv()
			mutate(env)
			if _, err := config.Load(envFrom(env)); err == nil {
				t.Fatal("Load() succeeded, want error")
			}
		})
	}
}

func TestLoadHonoursOverrides(t *testing.T) {
	env := validEnv()
	env["WD_ADDR"] = ":9999"
	env["WD_DB_PATH"] = "/tmp/other.db"

	cfg, err := config.Load(envFrom(env))
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}
	if cfg.Addr != ":9999" {
		t.Errorf("Addr = %q, want %q", cfg.Addr, ":9999")
	}
	if cfg.DBPath != "/tmp/other.db" {
		t.Errorf("DBPath = %q, want %q", cfg.DBPath, "/tmp/other.db")
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker compose run --rm --no-deps app go test ./internal/config/ -v`

Expected: FAIL — the package `internal/config` does not exist, so compilation fails with
`no required module provides package .../internal/config`.

- [ ] **Step 3: Write the minimal implementation**

`internal/config/config.go`:

```go
// Package config loads and validates the server's runtime configuration.
package config

import (
	"encoding/base64"
	"fmt"
	"time"
)

// secretKeyLen is the AES-256 key size the token encryption requires.
const secretKeyLen = 32

// Config holds validated runtime settings. A Config only ever exists in a valid
// state; Load is the sole constructor and it rejects anything incomplete.
type Config struct {
	Addr     string
	DBPath   string
	Secret   []byte
	Location *time.Location
}

// Load reads configuration through getenv and validates it. Callers pass
// os.Getenv in production; tests pass a map lookup.
func Load(getenv func(string) string) (*Config, error) {
	secret, err := decodeSecret(getenv("WD_SECRET_KEY"))
	if err != nil {
		return nil, err
	}

	tzName := getenv("WD_TIMEZONE")
	if tzName == "" {
		return nil, fmt.Errorf("WD_TIMEZONE is required (an IANA name such as Europe/Amsterdam)")
	}
	loc, err := time.LoadLocation(tzName)
	if err != nil {
		return nil, fmt.Errorf("WD_TIMEZONE %q is not a known timezone: %w", tzName, err)
	}

	return &Config{
		Addr:     orDefault(getenv("WD_ADDR"), ":8080"),
		DBPath:   orDefault(getenv("WD_DB_PATH"), "/data/work-dashboard.db"),
		Secret:   secret,
		Location: loc,
	}, nil
}

func decodeSecret(raw string) ([]byte, error) {
	if raw == "" {
		return nil, fmt.Errorf("WD_SECRET_KEY is required (%d base64-encoded bytes)", secretKeyLen)
	}
	secret, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return nil, fmt.Errorf("WD_SECRET_KEY is not valid base64: %w", err)
	}
	if len(secret) != secretKeyLen {
		return nil, fmt.Errorf("WD_SECRET_KEY decodes to %d bytes, want %d", len(secret), secretKeyLen)
	}
	return secret, nil
}

func orDefault(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `docker compose run --rm --no-deps app go test ./internal/config/ -v`

Expected: PASS — all three test functions, including every subtest of `TestLoadRejectsBadInput`.

- [ ] **Step 5: Commit**

```bash
git add internal/config/
git commit -m "feat: load and validate runtime configuration"
```

---

### Task 3: HTTP server with health endpoint and static assets

**Files:**
- Create: `internal/server/server.go`, `internal/server/server_test.go`
- Modify: `cmd/server/main.go`

**Interfaces:**
- Consumes: `config.Config` from Task 2
- Produces:
  - `func New(cfg *config.Config, assets fs.FS) *Server`
  - `Server` implements `http.Handler`
  - Routes: `GET /api/health` → `{"status":"ok"}`; everything else served from `assets` with
    fallback to `index.html`

The server takes its assets as an `fs.FS` rather than reaching for a directory or an embedded
variable itself. That is what lets Task 4 swap embedded assets for on-disk ones without the server
knowing, and it is what lets these tests run against an in-memory filesystem with no build step.

- [ ] **Step 1: Write the failing tests**

`internal/server/server_test.go`:

```go
package server_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
	"time"

	"github.com/dgerrese/work-dashboard/internal/config"
	"github.com/dgerrese/work-dashboard/internal/server"
)

func newTestServer() *server.Server {
	cfg := &config.Config{
		Addr:     ":8080",
		DBPath:   ":memory:",
		Secret:   make([]byte, 32),
		Location: time.UTC,
	}
	assets := fstest.MapFS{
		"index.html":   {Data: []byte("<!doctype html><title>shell</title>")},
		"app.js":       {Data: []byte("console.log('app')")},
	}
	return server.New(cfg, assets)
}

func get(t *testing.T, path string) *http.Response {
	t.Helper()
	rec := httptest.NewRecorder()
	newTestServer().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec.Result()
}

func TestHealthReportsOK(t *testing.T) {
	res := get(t, "/api/health")
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want %d", res.StatusCode, http.StatusOK)
	}
	if ct := res.Header.Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want %q", ct, "application/json")
	}
	body, _ := io.ReadAll(res.Body)
	if got, want := string(body), `{"status":"ok"}`; got != want {
		t.Errorf("body = %q, want %q", got, want)
	}
}

func TestUnknownAPIPathReturnsJSON404(t *testing.T) {
	res := get(t, "/api/nope")
	defer res.Body.Close()

	if res.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want %d", res.StatusCode, http.StatusNotFound)
	}
	if ct := res.Header.Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want %q", ct, "application/json")
	}
}

func TestRootServesAppShell(t *testing.T) {
	res := get(t, "/")
	defer res.Body.Close()

	body, _ := io.ReadAll(res.Body)
	if got := string(body); got != "<!doctype html><title>shell</title>" {
		t.Errorf("body = %q, want the app shell", got)
	}
}

func TestAssetIsServedFromFS(t *testing.T) {
	res := get(t, "/app.js")
	defer res.Body.Close()

	body, _ := io.ReadAll(res.Body)
	if got := string(body); got != "console.log('app')" {
		t.Errorf("body = %q, want the app.js contents", got)
	}
}

func TestUnknownPageFallsBackToAppShell(t *testing.T) {
	// Client-side routing: /week is a view, not a file. It must still boot the shell.
	res := get(t, "/week")
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want %d", res.StatusCode, http.StatusOK)
	}
	body, _ := io.ReadAll(res.Body)
	if got := string(body); got != "<!doctype html><title>shell</title>" {
		t.Errorf("body = %q, want the app shell", got)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker compose run --rm --no-deps app go test ./internal/server/ -v`

Expected: FAIL — compilation error, `internal/server` does not exist.

- [ ] **Step 3: Write the minimal implementation**

`internal/server/server.go`:

```go
// Package server wires the HTTP routes for the dashboard.
package server

import (
	"errors"
	"io/fs"
	"net/http"
	"path"
	"strings"

	"github.com/dgerrese/work-dashboard/internal/config"
)

// Server routes API requests and serves the PWA's static assets.
type Server struct {
	cfg    *config.Config
	assets fs.FS
	mux    *http.ServeMux
}

// New builds a Server that serves its static files from assets. Production
// passes an embedded filesystem; development passes one backed by web/dist.
func New(cfg *config.Config, assets fs.FS) *Server {
	s := &Server{cfg: cfg, assets: assets, mux: http.NewServeMux()}

	s.mux.HandleFunc("GET /api/health", s.handleHealth)
	s.mux.HandleFunc("/api/", handleAPINotFound)
	s.mux.HandleFunc("/", s.handleAsset)

	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, `{"status":"ok"}`)
}

func handleAPINotFound(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusNotFound, `{"code":"not_found","message":"no such endpoint"}`)
}

// handleAsset serves a file from the asset filesystem, falling back to the app
// shell so that client-side routes such as /week survive a page refresh.
func (s *Server) handleAsset(w http.ResponseWriter, r *http.Request) {
	name := path.Clean(strings.TrimPrefix(r.URL.Path, "/"))
	if name == "" || name == "." {
		name = "index.html"
	}

	if _, err := fs.Stat(s.assets, name); err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			http.Error(w, "asset lookup failed", http.StatusInternalServerError)
			return
		}
		name = "index.html"
	}

	http.ServeFileFS(w, r, s.assets, name)
}

func writeJSON(w http.ResponseWriter, status int, body string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(body))
}
```

The health and 404 bodies are string literals rather than marshalled structs because they are
fixed; introducing a response type for two constant payloads would be structure no requirement
asks for.

`handleAsset` cleans the request path before touching the filesystem. Traversal is not reachable:
`fs.Stat` rejects any path containing `..` with `fs.ErrInvalid` rather than `fs.ErrNotExist`, so
such a request takes the 500 branch instead of the shell-fallback branch.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `docker compose run --rm --no-deps app go test ./internal/server/ -v`

Expected: PASS — all five test functions.

- [ ] **Step 5: Commit**

Leave `cmd/server/main.go` alone in this task. Wiring it to `server.New` requires `web.Assets()`,
which Task 4 creates, and editing it here would leave the branch unable to compile.

```bash
git add internal/server/
git commit -m "feat: serve the api health endpoint and static assets"
```

---

### Task 4: Build-tagged asset filesystem

**Files:**
- Create: `web/embed.go`, `web/assets_dev.go`
- Modify: `cmd/server/main.go`

**Interfaces:**
- Consumes: `config.Load` from Task 2, `server.New` from Task 3
- Produces: `func web.Assets() fs.FS` — one implementation per build tag; a working entrypoint

- [ ] **Step 1: Write the production implementation**

`web/embed.go`:

```go
//go:build !dev

// Package web exposes the built frontend as a filesystem.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var distFS embed.FS

// Assets returns the frontend built into the binary at compile time.
func Assets() fs.FS {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		// Unreachable: "dist" is embedded above, so the subtree always exists.
		panic(err)
	}
	return sub
}
```

- [ ] **Step 2: Write the development implementation**

`web/assets_dev.go`:

```go
//go:build dev

package web

import (
	"io/fs"
	"os"
)

// Assets returns the frontend read from disk, so that a rebuild is visible on
// refresh without recompiling the binary. The path is relative to the repo
// root, which is the working directory the dev container runs from.
func Assets() fs.FS {
	return os.DirFS("web/dist")
}
```

- [ ] **Step 3: Wire the entrypoint**

`cmd/server/main.go` — replace the placeholder from Task 1 entirely:

```go
package main

import (
	"log"
	"net/http"
	"os"

	_ "time/tzdata" // embed the zoneinfo database; the scratch image has none

	"github.com/dgerrese/work-dashboard/internal/config"
	"github.com/dgerrese/work-dashboard/internal/server"
	"github.com/dgerrese/work-dashboard/web"
)

func main() {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		log.Fatalf("configuration: %v", err)
	}

	srv := server.New(cfg, web.Assets())

	log.Printf("work-dashboard listening on %s (%s)", cfg.Addr, cfg.Location)
	if err := http.ListenAndServe(cfg.Addr, srv); err != nil {
		log.Fatalf("server: %v", err)
	}
}
```

- [ ] **Step 4: Verify both build tags compile**

```bash
docker compose run --rm --no-deps app go build ./...
docker compose run --rm --no-deps app go build -tags dev ./...
```

Expected: both exit 0 with no output. The untagged build is the one that would fail if
`web/dist/.gitkeep` were missing, because `go:embed` errors on an empty match.

- [ ] **Step 5: Run the full Go suite**

Run: `make test-go`

Expected: PASS for `internal/config` and `internal/server`; `no test files` for the others.

- [ ] **Step 6: Commit**

```bash
git add web/embed.go web/assets_dev.go cmd/server/main.go
git commit -m "feat: select embedded or on-disk assets by build tag"
```

---

### Task 5: Frontend build pipeline and app shell

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/index.html`,
  `web/src/main.ts`, `web/src/styles.css`, `web/build.mjs`

**Interfaces:**
- Consumes: nothing from Go
- Produces: `web/dist/index.html`, `web/dist/app.js`, `web/dist/app.css`;
  npm scripts `build`, `watch`, `lint`, `fmt`

- [ ] **Step 1: Create the package manifest**

`web/package.json`:

```json
{
  "name": "work-dashboard-web",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node build.mjs",
    "watch": "node build.mjs --watch",
    "lint": "eslint src",
    "fmt": "prettier --write \"**/*.{ts,css,html,json}\""
  },
  "devDependencies": {
    "@tailwindcss/cli": "^4.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "esbuild": "^0.25.0",
    "eslint": "^9.0.0",
    "prettier": "^3.0.0",
    "prettier-plugin-tailwindcss": "^0.6.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

- [ ] **Step 2: Create the TypeScript configuration**

`web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "build.mjs"]
}
```

- [ ] **Step 3: Write the build script**

`web/build.mjs`:

```js
import { execFileSync } from "node:child_process";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const buildCss = () =>
  execFileSync(
    "npx",
    [
      "@tailwindcss/cli",
      "-i", "src/styles.css",
      "-o", "dist/app.css",
      "--minify",
    ],
    { stdio: "inherit" },
  );

const jsOptions = {
  entryPoints: ["src/main.ts"],
  outfile: "dist/app.js",
  bundle: true,
  format: "esm",
  splitting: false,
  minify: true,
  sourcemap: watch,
  target: ["es2022"],
};

execFileSync("cp", ["index.html", "dist/index.html"], { stdio: "inherit" });
buildCss();

if (watch) {
  const ctx = await esbuild.context(jsOptions);
  await ctx.watch();
  console.log("watching for changes");
} else {
  await esbuild.build(jsOptions);
}
```

Tailwind v4 has no `tailwind.config.js`; the CLI discovers sources from the `@source` directive in
the CSS entry point, which the next step sets up.

- [ ] **Step 4: Write the stylesheet entry point**

`web/src/styles.css`:

```css
@import "tailwindcss";
@source "../index.html";
@source "./**/*.ts";

@theme {
  --font-sans: ui-sans-serif, system-ui, sans-serif;
}
```

- [ ] **Step 5: Write the app shell and entry module**

`web/index.html`. Keep this lean — it is the response the 14kB budget applies to:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Work Dashboard</title>
    <link rel="stylesheet" href="/app.css" />
    <script type="module" src="/app.js"></script>
  </head>
  <body class="bg-neutral-50 text-neutral-900">
    <main id="app" class="mx-auto max-w-3xl p-6">
      <h1 class="text-2xl font-semibold">Work Dashboard</h1>
      <p id="status" class="mt-2 text-neutral-600">Checking the server…</p>
    </main>
  </body>
</html>
```

`web/src/main.ts`:

```ts
async function showServerStatus(): Promise<void> {
  const el = document.querySelector<HTMLElement>("#status");
  if (!el) return;

  try {
    const res = await fetch("/api/health");
    const body = (await res.json()) as { status?: string };
    el.textContent = body.status === "ok" ? "Server is up." : "Server reported a problem.";
  } catch {
    el.textContent = "Could not reach the server.";
  }
}

void showServerStatus();
```

- [ ] **Step 6: Install dependencies and build**

```bash
docker compose run --rm --no-deps web npm install
make build-web
```

Expected: `npm install` writes `package-lock.json`; `make build-web` produces
`web/dist/index.html`, `web/dist/app.css` and `web/dist/app.js`. Confirm with:

```bash
ls -la web/dist/
```

- [ ] **Step 7: Verify the stack serves the shell end to end**

```bash
cp .env.example .env
docker compose run --rm --no-deps app sh -c 'head -c 32 /dev/urandom | base64'
# paste the output into WD_SECRET_KEY in .env, then:
docker compose up -d app
curl -s localhost:8080/api/health
curl -s localhost:8080/ | head -5
docker compose down
```

Expected: the health call returns `{"status":"ok"}` and the root returns the shell HTML.

- [ ] **Step 8: Commit**

```bash
git add web/package.json web/package-lock.json web/tsconfig.json web/build.mjs \
        web/index.html web/src/
git commit -m "feat: frontend build pipeline and app shell"
```

---

### Task 6: Lint configuration and the verification gate

**Files:**
- Create: `.golangci.yml`, `web/eslint.config.js`, `web/.prettierrc.json`

**Interfaces:**
- Consumes: the `make` targets from Task 1
- Produces: a green `make verify`

- [ ] **Step 1: Write the golangci-lint configuration**

`.golangci.yml`. This is the **v2 schema** — the `version` key is mandatory and a v1 config will
not parse:

```yaml
version: "2"

linters:
  default: standard
  enable:
    - bodyclose
    - errorlint
    - misspell
    - revive
  exclusions:
    presets:
      - std-error-handling
    rules:
      - path: _test\.go
        linters:
          - errcheck

formatters:
  enable:
    - gofumpt
    - goimports
```

`default: standard` turns on errcheck, govet, ineffassign, staticcheck and unused — the set the
spec asks for. The `_test.go` exclusion for errcheck exists because the tests above deliberately
discard errors from `io.ReadAll` on responses they have already asserted the status of.

- [ ] **Step 2: Validate the config parses before relying on it**

Run: `docker compose run --rm --no-deps lint golangci-lint config verify`

Expected: no output and exit 0. If it reports unknown keys, the schema has moved on from 2.12.2 —
consult `golangci-lint config --help` rather than guessing, and fix the file.

- [ ] **Step 3: Write the frontend lint configuration**

`web/eslint.config.js`:

```js
import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },
    },
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
];
```

Add `"@eslint/js": "^9.0.0"` to `devDependencies` in `web/package.json` and re-run
`docker compose run --rm --no-deps web npm install`.

`web/.prettierrc.json`:

```json
{
  "semi": true,
  "singleQuote": false,
  "printWidth": 100,
  "plugins": ["prettier-plugin-tailwindcss"]
}
```

- [ ] **Step 4: Run the full gate**

Run: `make verify`

Expected: `verify: OK` as the final line, with every preceding target exiting 0. Fix whatever it
reports — this is the gate every later ticket builds on, and a warning tolerated now becomes a
warning tolerated forever.

- [ ] **Step 5: Commit**

```bash
git add .golangci.yml web/eslint.config.js web/.prettierrc.json web/package.json web/package-lock.json
git commit -m "build: lint configuration for go and the frontend"
```

---

### Task 7: Continuous integration

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `make verify` from Task 6
- Produces: a required status check on every pull request

- [ ] **Step 1: Write the workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - name: Provide a test environment
        run: |
          cp .env.example .env
          printf 'WD_SECRET_KEY=%s\n' "$(head -c 32 /dev/urandom | base64)" >> .env

      - name: Run the merge gate
        run: make verify
```

The generated key is throwaway. Nothing in the gate touches a real Jira instance or a real
database, so CI needs no secrets at all — and keeping it that way means a fork's pull request runs
the same gate as a branch.

- [ ] **Step 2: Commit and push the branch**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run the merge gate on every pull request"
git push -u origin HEAD
```

- [ ] **Step 3: Open the pull request and confirm the gate runs green**

```bash
gh pr create --fill
gh pr checks --watch
```

Expected: the `verify` job passes. A failure here that did not reproduce locally is almost always
a path or permissions difference between the runner and the dev container — read the job log
rather than re-running it.

---

## Definition of done

- `make verify` exits 0 locally and on the pull request.
- `docker compose up` serves the app shell at `localhost:8080` and `/api/health` returns
  `{"status":"ok"}`.
- Both `go build ./...` and `go build -tags dev ./...` compile.
- The repository contains no application logic beyond the health endpoint — ticket 1 is
  scaffolding, and anything else in the diff belongs to a later ticket.
