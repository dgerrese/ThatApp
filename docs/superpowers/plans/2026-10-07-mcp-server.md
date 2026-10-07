# An MCP server at /mcp — Implementation Plan

**Date:** 2026-10-07
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An MCP client (Claude Code first) connects to `http://localhost:<port>/mcp` and gets ten tools that read issues, entries, the week and the timer, and log time and run the timer — each one a thin in-process call to the existing `/api/*` handler — while an open tab catches up on whatever changed when it is switched back to (#253).

**Architecture:** One new route, `/mcp`, on the server's existing mux. `internal/server/mcp.go` is the transport: a hand-written, stateless JSON-RPC endpoint (Origin refusal, POST only, notifications `202`, protocol revision handling, error codes). `internal/server/mcp_tools.go` is the tool table: each tool turns its arguments into the `/api` request the browser would send, runs it through `s.mux` with an `httptest.ResponseRecorder`, and hands back the body — `isError: true` with the API's `message` on a 4xx/5xx. Nothing about entries, days or push state is reimplemented. In the browser, a new `web/src/tab-return.ts` calls back once per return to the tab, and `rail.ts` uses it to re-read the timer and announce `that-entries-changed`, which Today, Week and the rail already answer by re-reading.

**Tech Stack:** Go standard library (`encoding/json`, `net/http`, `net/http/httptest`, `net/url`, `encoding/base64`, `slices`, `maps`); TypeScript (vanilla); Playwright (Firefox and Chromium).

**Spec:** Codeberg issue #253 (refined with the owner 2026-10-06; its Decisions, Approach and Acceptance criteria are binding; no comments on the issue). Design of record: `docs/superpowers/specs/2026-08-04-thatapp-design.md` (API surface, §"API surface"). MCP specification revision **2026-07-28** (https://modelcontextprotocol.io/specification/2026-07-28 — `basic/versioning`, `basic/transports/streamable-http`, `server/discover`, `server/tools`, `changelog`) and, for the `initialize` handshake, revision **2025-11-25**.

## Protocol revision — what was chosen and why

The revision current at build time is **2026-07-28**. It is *stateless by design*: it removed `initialize`, `notifications/initialized` and `ping`; every request carries its version in `params._meta["io.modelcontextprotocol/protocolVersion"]`; HTTP requests mirror it and the method in `MCP-Protocol-Version` / `Mcp-Method` (and `Mcp-Name` for `tools/call`) headers, a mismatch being `400` + `-32020`; an unsupported version is `400` + `-32022` naming the supported ones; an unknown method is `404` + `-32601`; servers **MUST** implement `server/discover`; every result carries `resultType`, and `tools/list` also `ttlMs` and `cacheScope`.

The ticket's first criterion asks for **both** "answers `initialize`" **and** "negotiating the protocol revision current when built". Under 2026-07-28 these cannot both hold unless the server is what the specification calls **dual-era**: it serves 2026-07-28 requests statelessly and still answers an `initialize` from a client of the handshake era (2025-11-25, 2025-06-18, 2025-03-26), which "has no fall-forward mechanism". Claude Code is itself dual-era (its changelog: stdio connections negotiate 2026-07-28 by default since 2.1.287/2.1.292, with a legacy fallback), so either path may be the one it takes over HTTP. Both eras are already stateless here — the ticket's own design — so dual-era costs one `server/discover` case, a header check and a version list, not a second implementation. **This plan builds dual-era.** Results are shaped once and served to both eras: the fields 2026-07-28 adds (`resultType`, `_meta`, `ttlMs`, `cacheScope`) are ignored by an older client.

## Global Constraints

- All tooling through `make` or `docker compose`; never Go, Node or npm on the host. Nothing in this plan needs the dev stack; if you open it anyway, read `THAT_PORT` from `.env` first.
- **Go:** standard library only; the approved extras (`modernc.org/sqlite`, `golang.org/x/sync`) are not needed. **No new dependency, no new `THAT_*` variable** (the ticket's decision). `config.Config` gains a `Version` field that `main` sets from its build-time `version` — not read from the environment.
- **No reimplementation.** A tool never validates, defaults, resolves a day or computes push state itself; the `/api` handler it reaches does. The one deliberate exception is ruling 2 below (`delete_entry` refuses an entry that reached Jira), and it decides nothing the handler decides.
- **No test contacts a real Jira instance.** Tool tests run on servers with no instance, an instance whose URL nothing calls (`serverInZone`), or the existing `newEntriesEnv` fake Jira.
- Tests: table-driven with `t.Run`, `httptest`, existing helpers reused — `newServerWithStore` (`server_internal_test.go`), `serverInZone`, `callEntries`, `decodeEntry`, `allEntries`, `seedEntryForPatch`, `newEntriesEnv`/`entriesEnv` (`entries_test.go`), `fetchEnv`, `markEntryPushed`, `makeEntryDirty` (`fetch_test.go`), `seedInstance` (`issues_test.go`).
- Frontend: vanilla TS, `strict` + `noUncheckedIndexedAccess`; no `any`, no `!`. Keep files small.
- Comments: few; a non-obvious why only. Names say what they return.
- **TDD, per task.** RED must fail on an **assertion**, for the reason the test names — never a compile error (each task's Step 1 adds the bare declarations its tests need first) and never a timeout on a typo'd locator. The task report quotes the RED line. A test marked *guard* passes before its task's change and is proven entirely by mutation. **Every assertion a task adds is proven by mutation**: break the code by hand, run that one test, show it red, restore, show it green; the report lists each mutation with its red line.
- Commands:

  ```shell
  # One Go test (or a regex of them)
  docker compose run --build --rm --no-deps app go test ./internal/server/ -run 'TestMCPTransport' -count=1 -v
  # The Go suite
  make test-go
  # gofmt / gofumpt / goimports, then lint
  docker compose run --rm --no-deps lint golangci-lint fmt
  make lint
  # Prettier, web/src only (never on .claude/e2e — it has no config)
  docker compose run --rm --no-deps web npx prettier --write src/tab-return.ts src/rail.ts
  # Type check
  make tsc
  # One e2e spec — the rig's own disposable app-e2e; always clean up around it
  docker compose --profile e2e rm --stop --force app-e2e
  docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tab-return.spec.ts --reporter=line'
  docker compose --profile e2e rm --stop --force app-e2e
  ```

  Add `-g "<title fragment>"` to the Playwright command to run one test (every mutation run).
- Commits: if `git commit` fails on signing (a locked 1Password vault), retry the same commit with `git -c commit.gpgsign=false commit …` and carry on; note the last signed commit in the report. **Never push.** Never merge into `main`.
- Branch: `issue-253-mcp-server`, cut from `main` (not from the `issue-259-*` branch checked out at planning time).

## Rulings made before execution (the controller's, reversible — the owner may overturn either of the first two)

1. **Dual-era protocol** — see *Protocol revision* above. `initialize` negotiates among `2025-11-25`, `2025-06-18`, `2025-03-26` (echoing a supported request, otherwise answering `2025-11-25`); a request with `_meta` protocol version is served as 2026-07-28; `server/discover` lists `["2026-07-28","2025-11-25","2025-06-18","2025-03-26"]`. `ping` is answered in both eras (harmless where 2026-07-28 dropped it).
2. **`delete_entry` refuses an entry that has reached Jira** (a worklog id: pushed *or* dirty). The ticket's decision is that "an assistant can never write to a real Jira instance", but `DELETE /api/entries/{id}` deletes the Jira worklog of such an entry first (`handleDeleteEntry`). The decision is the stronger statement, so the tool refuses with a fixed message and the owner deletes those in the app. It reads the row with `s.db.Entry` before forwarding; a push landing between that read and the DELETE could still reach Jira (marked `ponytail:` in the code; a local-only flag on the handler is the upgrade if that window ever matters).
3. **`Accept` is not enforced.** The specification puts that MUST on the client; the server always answers `application/json`, which every client must accept. `curl` without the header still works.
4. **Any message without an `id` is a notification** and gets `202` with no body, whatever its method. A body that is an array (a batch) is `-32600`: batching left MCP in 2025-06-18.
5. **Status codes:** `-32700`/`-32600` → `400`; `-32601` → `404` for a 2026-07-28 request, `200` for a handshake-era one (a `404` there reads as an expired session); `-32602` → `200`; `-32020`/`-32022` → `400`; Origin → `403`; non-POST → `405` with `Allow: POST`. A tool's own failure is `200` with `isError: true`.
6. **Bodies over 1 MiB** are refused as unreadable (`400`, `-32700`) via `http.MaxBytesReader`; the largest real tool call is a few hundred bytes.
7. **A 204 from the API** (delete) comes back as the text `No Content` (`http.StatusText`), since an empty text gives a model nothing to read.
8. **Frontend:** a return is visible-after-hidden or focus-after-blur, and a tab that never left gets nothing — see Task 4 for why the guard is a flag and not a debounce.

## Review Focus

1. **Arguments of the wrong JSON type** (`{"from": 5}`, `{"id": "5"}`, an array) must come back as `isError: true` the model can correct, never a protocol error or a 500 — Task 2's `TestMCPToolArgumentsOfTheWrongTypeAreToolErrors` and the `[1]` case of `TestMCPToolFailuresComeBackAsToolErrors`.
2. **Arguments omitted or `null`** must reach the handler's own defaults (today, this week in `THAT_TIMEZONE`), not a decode error — Task 2's read-tools test runs `list_entries` with no `arguments` and with `null`, on a clock where UTC and Auckland disagree on the day and the week.
3. **A 5xx from the handler** (the store failing) is a tool error carrying the API's message — Task 2's `TestMCPServerFailureIsAToolError`.
4. **Deleting an entry Jira holds a worklog for** is refused and Jira sees no request, for a pushed and for a dirty entry — Task 2's `TestMCPDeleteEntryNeverReachesJira`, against `newEntriesEnv`'s counting fake.
5. **A tab's return delivers two events** (blur + hidden, then visible + focus); it must cost exactly one timer read, and the next return one more — Task 4's "one return costs one timer read" test. Focus moving between elements inside the page must cost nothing — Task 4's "stays visible" test tabs through controls.

---

### Task 1: The /mcp transport

**Files:**
- Modify: `internal/config/config.go` (the `Config` struct)
- Modify: `cmd/server/main.go` (one line after `config.Load`)
- Modify: `internal/server/server.go` (one route in `New`)
- Create: `internal/server/mcp.go`
- Test: `internal/server/mcp_test.go` (new)

**Interfaces:**
- Consumes: `writeJSON` (`json.go`), `newServerWithStore` (`server_internal_test.go`).
- Produces (Task 2 relies on these exact names):
  - `const mcpVersion = "2026-07-28"`; `var mcpLegacyVersions []string`; `var mcpSupportedVersions []string`
  - error-code constants `rpcParseError`, `rpcInvalidRequest`, `rpcMethodNotFound`, `rpcInvalidParams`, `mcpHeaderMismatch`, `mcpUnsupportedVersion`
  - `type rpcError struct{ Code int; Message string; Data any }` (JSON `code`, `message`, `data`)
  - `type mcpParams struct{ Meta map[string]json.RawMessage; ProtocolVersion, Name string; Arguments json.RawMessage }`
  - `func (s *Server) mcpResult(method string, params mcpParams) (any, *rpcError)` — Task 2 changes its signature to take `r *http.Request` first.
  - `func (s *Server) mcpResultOf(fields map[string]any) map[string]any`
  - `const mcpCacheTTLMs = 60 * 60 * 1000`
  - test helpers in `mcp_test.go`: `mcpTestVersion`, `mcpTestServer(t)`, `postMCP(t, srv, method, body, headers)`, `rpcReply`, `decodeRPC(t, rec)`, `modernBody(method, version, extra)`, `modernHeaders(method)`

- [ ] **Step 1: Bare declarations, so the tests compile.**

In `internal/config/config.go`, add to `Config` (after `Location`):

```go
	// Version is the release this binary was built as. main sets it from its
	// build-time version; it is not read from the environment.
	Version string
```

In `cmd/server/main.go`, directly after the `config.Load` error check:

```go
	cfg.Version = version
```

In `internal/server/server.go`, in `New`, directly before `s.mux.HandleFunc("/", s.handleAsset)`:

```go
	// Every method, not "POST /mcp": the catch-all "/" below would otherwise
	// take a GET and serve the app shell where the transport asks for a 405.
	s.mux.HandleFunc("/mcp", s.handleMCP)
```

Create `internal/server/mcp.go` with only:

```go
package server

import "net/http"

const mcpVersion = "2026-07-28"

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

func (s *Server) handleMCP(_ http.ResponseWriter, _ *http.Request) {}
```

- [ ] **Step 2: Write the failing tests.** Create `internal/server/mcp_test.go`:

```go
package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
	"testing"
)

const mcpTestVersion = "2026.41.1"

// mcpTestServer is newServerWithStore with a release version set, so a test
// can tell the server's own version from an empty one.
func mcpTestServer(t *testing.T) *Server {
	t.Helper()

	srv, _, _ := newServerWithStore(t)
	srv.cfg.Version = mcpTestVersion

	return srv
}

// postMCP sends body to /mcp with the Content-Type and Accept every MCP client
// sends, plus headers.
func postMCP(
	t *testing.T, srv *Server, method, body string, headers map[string]string,
) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(method, "/mcp", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	for name, value := range headers {
		req.Header.Set(name, value)
	}
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	return rec
}

type rpcReply struct {
	ID     json.RawMessage `json:"id"`
	Result json.RawMessage `json:"result"`
	Error  *rpcError       `json:"error"`
}

func decodeRPC(t *testing.T, rec *httptest.ResponseRecorder) rpcReply {
	t.Helper()

	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json; body %s", ct, rec.Body.String())
	}
	var reply rpcReply
	if err := json.Unmarshal(rec.Body.Bytes(), &reply); err != nil {
		t.Fatalf("decoding %s: %v", rec.Body.String(), err)
	}

	return reply
}

// modernBody is a 2026-07-28 request: its version rides in params._meta, and
// extra is spliced into params after it (",\"name\":…").
func modernBody(method, version, extra string) string {
	return `{"jsonrpc":"2.0","id":1,"method":"` + method + `","params":{"_meta":{` +
		`"io.modelcontextprotocol/protocolVersion":"` + version + `"}` + extra + `}}`
}

// modernHeaders mirrors a modern body's version and method, as the transport
// requires of every POST.
func modernHeaders(method string) map[string]string {
	return map[string]string{"MCP-Protocol-Version": mcpVersion, "Mcp-Method": method}
}

func TestMCPTransport(t *testing.T) {
	ping := `{"jsonrpc":"2.0","id":1,"method":"ping"}`

	for _, tc := range []struct {
		name       string
		method     string
		headers    map[string]string
		body       string
		wantStatus int
		wantCode   int // 0: a result and no error
		wantAllow  string
		wantNullID bool
	}{
		{name: "GET is not served", method: http.MethodGet,
			wantStatus: http.StatusMethodNotAllowed, wantCode: rpcInvalidRequest, wantAllow: "POST", wantNullID: true},
		{name: "DELETE is not served", method: http.MethodDelete,
			wantStatus: http.StatusMethodNotAllowed, wantCode: rpcInvalidRequest, wantAllow: "POST", wantNullID: true},
		{name: "a notification is accepted with no body", method: http.MethodPost,
			body: `{"jsonrpc":"2.0","method":"notifications/initialized"}`, wantStatus: http.StatusAccepted},
		{name: "any notification is accepted", method: http.MethodPost,
			body: `{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":3}}`,
			wantStatus: http.StatusAccepted},
		{name: "malformed JSON is a parse error with a null id", method: http.MethodPost,
			body: `{"jsonrpc":`, wantStatus: http.StatusBadRequest, wantCode: rpcParseError, wantNullID: true},
		{name: "a batch is an invalid request", method: http.MethodPost,
			body: `[` + ping + `]`, wantStatus: http.StatusBadRequest, wantCode: rpcInvalidRequest, wantNullID: true},
		{name: "a jsonrpc other than 2.0 is an invalid request", method: http.MethodPost,
			body: `{"jsonrpc":"1.0","id":1,"method":"ping"}`, wantStatus: http.StatusBadRequest, wantCode: rpcInvalidRequest},
		{name: "an id without a method is an invalid request", method: http.MethodPost,
			body: `{"jsonrpc":"2.0","id":1}`, wantStatus: http.StatusBadRequest, wantCode: rpcInvalidRequest},
		{name: "a null id is an invalid request", method: http.MethodPost,
			body: `{"jsonrpc":"2.0","id":null,"method":"ping"}`, wantStatus: http.StatusBadRequest,
			wantCode: rpcInvalidRequest, wantNullID: true},
		{name: "params that are not an object are invalid params", method: http.MethodPost,
			body: `{"jsonrpc":"2.0","id":1,"method":"ping","params":[1]}`, wantStatus: http.StatusOK,
			wantCode: rpcInvalidParams},
		{name: "ping answers a result", method: http.MethodPost, body: ping, wantStatus: http.StatusOK},
		{name: "a handshake-era request under a known version header", method: http.MethodPost, body: ping,
			headers: map[string]string{"MCP-Protocol-Version": "2025-06-18"}, wantStatus: http.StatusOK},
		{name: "a handshake-era request under an unknown version header", method: http.MethodPost, body: ping,
			headers:    map[string]string{"MCP-Protocol-Version": "1999-01-01"},
			wantStatus: http.StatusBadRequest, wantCode: rpcInvalidRequest},
		{name: "an unknown method, handshake era, is 200 and method-not-found", method: http.MethodPost,
			body: `{"jsonrpc":"2.0","id":1,"method":"resources/list"}`, wantStatus: http.StatusOK,
			wantCode: rpcMethodNotFound},
		{name: "an unknown method, 2026-07-28, is 404 and method-not-found", method: http.MethodPost,
			body: modernBody("resources/list", mcpVersion, ""), headers: modernHeaders("resources/list"),
			wantStatus: http.StatusNotFound, wantCode: rpcMethodNotFound},
		{name: "server/discover, 2026-07-28", method: http.MethodPost,
			body: modernBody("server/discover", mcpVersion, ""), headers: modernHeaders("server/discover"),
			wantStatus: http.StatusOK},
		{name: "2026-07-28 without the version header", method: http.MethodPost,
			body:    modernBody("server/discover", mcpVersion, ""),
			headers: map[string]string{"Mcp-Method": "server/discover"},
			wantStatus: http.StatusBadRequest, wantCode: mcpHeaderMismatch},
		{name: "2026-07-28 with a version header that disagrees", method: http.MethodPost,
			body:    modernBody("server/discover", mcpVersion, ""),
			headers: map[string]string{"MCP-Protocol-Version": "2025-11-25", "Mcp-Method": "server/discover"},
			wantStatus: http.StatusBadRequest, wantCode: mcpHeaderMismatch},
		{name: "2026-07-28 without Mcp-Method", method: http.MethodPost,
			body:    modernBody("server/discover", mcpVersion, ""),
			headers: map[string]string{"MCP-Protocol-Version": mcpVersion},
			wantStatus: http.StatusBadRequest, wantCode: mcpHeaderMismatch},
		{name: "2026-07-28 with an Mcp-Method that disagrees", method: http.MethodPost,
			body: modernBody("server/discover", mcpVersion, ""), headers: modernHeaders("tools/list"),
			wantStatus: http.StatusBadRequest, wantCode: mcpHeaderMismatch},
		{name: "a _meta version this server does not speak", method: http.MethodPost,
			body:    modernBody("server/discover", "2099-01-01", ""),
			headers: map[string]string{"MCP-Protocol-Version": "2099-01-01", "Mcp-Method": "server/discover"},
			wantStatus: http.StatusBadRequest, wantCode: mcpUnsupportedVersion},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := postMCP(t, mcpTestServer(t), tc.method, tc.body, tc.headers)

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d; body %s", rec.Code, tc.wantStatus, rec.Body.String())
			}
			if tc.wantStatus == http.StatusAccepted {
				if rec.Body.Len() != 0 {
					t.Errorf("a notification was answered with %q; want no body", rec.Body.String())
				}
				return
			}
			if tc.wantAllow != "" && rec.Header().Get("Allow") != tc.wantAllow {
				t.Errorf("Allow = %q, want %q", rec.Header().Get("Allow"), tc.wantAllow)
			}

			reply := decodeRPC(t, rec)
			switch {
			case tc.wantCode == 0 && reply.Error != nil:
				t.Errorf("error = %+v, want a result", *reply.Error)
			case tc.wantCode == 0 && len(reply.Result) == 0:
				t.Errorf("no result in %s", rec.Body.String())
			case tc.wantCode != 0 && (reply.Error == nil || reply.Error.Code != tc.wantCode):
				t.Errorf("error = %+v, want code %d", reply.Error, tc.wantCode)
			}
			if tc.wantNullID && string(reply.ID) != "null" {
				t.Errorf("id = %s, want null", reply.ID)
			}
		})
	}
}

// The ticket's whole defence: a browser always sends Origin and an MCP client
// never does, so any Origin at all — even this app's own — is refused, before
// the method is even looked at.
func TestMCPRefusesARequestCarryingAnyOrigin(t *testing.T) {
	for _, origin := range []string{
		"http://localhost:8080", "http://127.0.0.1:8080", "https://attacker.example", "null", "",
	} {
		for _, method := range []string{http.MethodPost, http.MethodGet} {
			t.Run(method+" from "+strconv.Quote(origin), func(t *testing.T) {
				rec := postMCP(t, mcpTestServer(t), method, `{"jsonrpc":"2.0","id":1,"method":"ping"}`,
					map[string]string{"Origin": origin})

				if rec.Code != http.StatusForbidden {
					t.Errorf("status = %d, want %d; body %s", rec.Code, http.StatusForbidden, rec.Body.String())
				}
			})
		}
	}
}

func TestMCPInitializeNegotiatesAHandshakeRevision(t *testing.T) {
	for _, tc := range []struct{ requested, want string }{
		{"2025-11-25", "2025-11-25"},
		{"2025-06-18", "2025-06-18"},
		{"2025-03-26", "2025-03-26"},
		{"2024-11-05", "2025-11-25"},
		// 2026-07-28 has no initialize, so asking for it here is asking for
		// the newest revision that does.
		{"2026-07-28", "2025-11-25"},
		{"", "2025-11-25"},
	} {
		t.Run("asked for "+strconv.Quote(tc.requested), func(t *testing.T) {
			rec := postMCP(t, mcpTestServer(t), http.MethodPost,
				`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"`+tc.requested+
					`","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}`, nil)

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body %s", rec.Code, rec.Body.String())
			}
			reply := decodeRPC(t, rec)
			if reply.Error != nil {
				t.Fatalf("error = %+v, want a result", *reply.Error)
			}
			var result struct {
				ProtocolVersion string                     `json:"protocolVersion"`
				Capabilities    map[string]json.RawMessage `json:"capabilities"`
				ServerInfo      struct {
					Name    string `json:"name"`
					Version string `json:"version"`
				} `json:"serverInfo"`
			}
			if err := json.Unmarshal(reply.Result, &result); err != nil {
				t.Fatalf("decoding %s: %v", reply.Result, err)
			}
			if result.ProtocolVersion != tc.want {
				t.Errorf("protocolVersion = %q, want %q", result.ProtocolVersion, tc.want)
			}
			if _, ok := result.Capabilities["tools"]; !ok {
				t.Errorf("capabilities = %v, want tools among them", result.Capabilities)
			}
			if result.ServerInfo.Name != "thatapp" || result.ServerInfo.Version != mcpTestVersion {
				t.Errorf("serverInfo = %+v, want thatapp %s", result.ServerInfo, mcpTestVersion)
			}
		})
	}
}

// Written out rather than built from mcpVersion, so moving to a newer revision
// is a decision this test makes someone take, not a constant that drifts.
func TestMCPDiscoverNamesTheCurrentRevisionFirst(t *testing.T) {
	rec := postMCP(t, mcpTestServer(t), http.MethodPost,
		modernBody("server/discover", "2026-07-28", ""), modernHeaders("server/discover"))

	reply := decodeRPC(t, rec)
	if reply.Error != nil {
		t.Fatalf("error = %+v, want a result", *reply.Error)
	}
	var result struct {
		ResultType        string                     `json:"resultType"`
		SupportedVersions []string                   `json:"supportedVersions"`
		Capabilities      map[string]json.RawMessage `json:"capabilities"`
		Meta              map[string]struct {
			Name    string `json:"name"`
			Version string `json:"version"`
		} `json:"_meta"`
		TTLMs      int64  `json:"ttlMs"`
		CacheScope string `json:"cacheScope"`
	}
	if err := json.Unmarshal(reply.Result, &result); err != nil {
		t.Fatalf("decoding %s: %v", reply.Result, err)
	}

	want := []string{"2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"}
	if !slices.Equal(result.SupportedVersions, want) {
		t.Errorf("supportedVersions = %v, want %v", result.SupportedVersions, want)
	}
	if result.ResultType != "complete" {
		t.Errorf("resultType = %q, want complete", result.ResultType)
	}
	if _, ok := result.Capabilities["tools"]; !ok {
		t.Errorf("capabilities = %v, want tools among them", result.Capabilities)
	}
	info := result.Meta["io.modelcontextprotocol/serverInfo"]
	if info.Name != "thatapp" || info.Version != mcpTestVersion {
		t.Errorf("_meta serverInfo = %+v, want thatapp %s", info, mcpTestVersion)
	}
	if result.TTLMs <= 0 || result.CacheScope != "private" {
		t.Errorf("ttlMs = %d, cacheScope = %q; want a positive ttl, private", result.TTLMs, result.CacheScope)
	}
}

func TestMCPUnsupportedVersionNamesWhatIsSupported(t *testing.T) {
	rec := postMCP(t, mcpTestServer(t), http.MethodPost, modernBody("tools/list", "2099-01-01", ""),
		map[string]string{"MCP-Protocol-Version": "2099-01-01", "Mcp-Method": "tools/list"})

	var reply struct {
		Error struct {
			Code int `json:"code"`
			Data struct {
				Supported []string `json:"supported"`
				Requested string   `json:"requested"`
			} `json:"data"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &reply); err != nil {
		t.Fatalf("decoding %s: %v", rec.Body.String(), err)
	}
	if rec.Code != http.StatusBadRequest || reply.Error.Code != mcpUnsupportedVersion {
		t.Fatalf("status %d, code %d; want 400 and %d", rec.Code, reply.Error.Code, mcpUnsupportedVersion)
	}
	if !slices.Contains(reply.Error.Data.Supported, "2026-07-28") || reply.Error.Data.Requested != "2099-01-01" {
		t.Errorf("data = %+v, want 2026-07-28 among supported and 2099-01-01 requested", reply.Error.Data)
	}
}
```

The table references `rpcParseError` … `mcpUnsupportedVersion`, which Step 1 did not declare; add them to the bare `mcp.go` now (values only, no logic), so the RED is on assertions:

```go
const (
	rpcParseError         = -32700
	rpcInvalidRequest     = -32600
	rpcMethodNotFound     = -32601
	rpcInvalidParams      = -32602
	mcpHeaderMismatch     = -32020
	mcpUnsupportedVersion = -32022
)
```

- [ ] **Step 3: Run; every test fails on an assertion.**

Run: `docker compose run --build --rm --no-deps app go test ./internal/server/ -run 'TestMCP' -count=1 -v`
Expected: FAIL throughout — e.g. `GET is not served: status = 200, want 405`, `TestMCPRefusesARequestCarryingAnyOrigin/...: status = 200, want 403`, `Content-Type = "", want application/json`. Quote one line per test function.

- [ ] **Step 4: Implement.** Replace `internal/server/mcp.go` with:

```go
package server

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"maps"
	"net/http"
	"slices"
	"strings"
)

// mcpVersion is the MCP revision /mcp speaks natively: stateless, its version
// carried on every request. mcpLegacyVersions are the initialize-handshake
// revisions it still answers, newest first — a client from before 2026-07-28
// cannot fall forward, so turning it away would be the end of it.
const mcpVersion = "2026-07-28"

var (
	mcpLegacyVersions    = []string{"2025-11-25", "2025-06-18", "2025-03-26"}
	mcpSupportedVersions = append([]string{mcpVersion}, mcpLegacyVersions...)
	mcpCapabilities      = map[string]any{"tools": map[string]any{}}
)

const (
	rpcParseError         = -32700
	rpcInvalidRequest     = -32600
	rpcMethodNotFound     = -32601
	rpcInvalidParams      = -32602
	mcpHeaderMismatch     = -32020
	mcpUnsupportedVersion = -32022
)

const (
	metaProtocolVersion = "io.modelcontextprotocol/protocolVersion"
	metaServerInfo      = "io.modelcontextprotocol/serverInfo"
	// mcpCacheTTLMs is how long a client may keep the tool list and discovery
	// result: they change only with a release.
	mcpCacheTTLMs = 60 * 60 * 1000
	mcpMaxBody    = 1 << 20
)

type rpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

// mcpParams is every params field any method here reads.
type mcpParams struct {
	Meta            map[string]json.RawMessage `json:"_meta"`
	ProtocolVersion string                     `json:"protocolVersion"`
	Name            string                     `json:"name"`
	Arguments       json.RawMessage            `json:"arguments"`
}

// handleMCP is the Streamable HTTP endpoint: one JSON-RPC message per POST,
// answered with one JSON object. No session and no event stream, in either era.
func (s *Server) handleMCP(w http.ResponseWriter, r *http.Request) {
	// A browser always sends Origin and an MCP client never does, so refusing
	// any Origin at all is the DNS-rebinding defence the transport asks for.
	if _, fromBrowser := r.Header["Origin"]; fromBrowser {
		writeRPCError(w, http.StatusForbidden, nil, rpcInvalidRequest, "requests from a web page are refused")
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeRPCError(w, http.StatusMethodNotAllowed, nil, rpcInvalidRequest, "only POST is served")
		return
	}

	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, mcpMaxBody))
	if err != nil {
		writeRPCError(w, http.StatusBadRequest, nil, rpcParseError, "the body could not be read")
		return
	}
	if trimmed := bytes.TrimSpace(raw); len(trimmed) > 0 && trimmed[0] == '[' {
		writeRPCError(w, http.StatusBadRequest, nil, rpcInvalidRequest, "batches are not supported")
		return
	}
	var req rpcRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		writeRPCError(w, http.StatusBadRequest, nil, rpcParseError, "the body is not valid JSON")
		return
	}
	if req.JSONRPC != "2.0" || req.Method == "" || string(req.ID) == "null" {
		writeRPCError(w, http.StatusBadRequest, req.ID, rpcInvalidRequest, "not a JSON-RPC 2.0 request")
		return
	}
	if req.ID == nil {
		w.WriteHeader(http.StatusAccepted)
		return
	}

	var params mcpParams
	if len(req.Params) > 0 {
		if err := json.Unmarshal(req.Params, &params); err != nil {
			writeRPCError(w, http.StatusOK, req.ID, rpcInvalidParams, "params is not an object of the expected shape")
			return
		}
	}

	rawVersion, modern := params.Meta[metaProtocolVersion]
	if modern {
		var version string
		_ = json.Unmarshal(rawVersion, &version)
		if version != mcpVersion {
			writeRPC(w, http.StatusBadRequest, rpcResponse{ID: req.ID, Error: &rpcError{
				Code: mcpUnsupportedVersion, Message: "Unsupported protocol version",
				Data: map[string]any{"supported": mcpSupportedVersions, "requested": version},
			}})
			return
		}
		if mismatch := mcpHeaderMismatchIn(r, req.Method, version, params.Name); mismatch != "" {
			writeRPCError(w, http.StatusBadRequest, req.ID, mcpHeaderMismatch, mismatch)
			return
		}
	} else if header := r.Header.Get("MCP-Protocol-Version"); header != "" &&
		!slices.Contains(mcpLegacyVersions, header) {
		writeRPCError(w, http.StatusBadRequest, req.ID, rpcInvalidRequest,
			"unsupported MCP-Protocol-Version "+header)
		return
	}

	result, failure := s.mcpResult(req.Method, params)
	if failure != nil {
		status := http.StatusOK
		if modern && failure.Code == rpcMethodNotFound {
			status = http.StatusNotFound
		}
		writeRPC(w, status, rpcResponse{ID: req.ID, Error: failure})
		return
	}
	writeRPC(w, http.StatusOK, rpcResponse{ID: req.ID, Result: result})
}

// mcpResult answers one request's method, or names the JSON-RPC error it is.
func (s *Server) mcpResult(method string, params mcpParams) (any, *rpcError) {
	switch method {
	case "initialize":
		version := mcpLegacyVersions[0]
		if slices.Contains(mcpLegacyVersions, params.ProtocolVersion) {
			version = params.ProtocolVersion
		}
		return s.mcpResultOf(map[string]any{
			"protocolVersion": version,
			"capabilities":    mcpCapabilities,
			"serverInfo":      s.mcpServerInfo(),
		}), nil
	case "ping":
		return s.mcpResultOf(nil), nil
	case "server/discover":
		return s.mcpResultOf(map[string]any{
			"supportedVersions": mcpSupportedVersions,
			"capabilities":      mcpCapabilities,
			"ttlMs":             mcpCacheTTLMs,
			"cacheScope":        "private",
		}), nil
	default:
		return nil, &rpcError{Code: rpcMethodNotFound, Message: "no such method: " + method}
	}
}

// mcpResultOf completes a result with what 2026-07-28 asks of every one: its
// type, and the server's identity in _meta. A handshake-era client ignores both.
func (s *Server) mcpResultOf(fields map[string]any) map[string]any {
	result := map[string]any{
		"resultType": "complete",
		"_meta":      map[string]any{metaServerInfo: s.mcpServerInfo()},
	}
	maps.Copy(result, fields)

	return result
}

func (s *Server) mcpServerInfo() map[string]string {
	return map[string]string{"name": "thatapp", "version": s.cfg.Version}
}

// mcpHeaderMismatchIn names the first mirrored header that disagrees with the
// body of a 2026-07-28 request, or returns "" when they all agree.
func mcpHeaderMismatchIn(r *http.Request, method, version, name string) string {
	if r.Header.Get("MCP-Protocol-Version") != version {
		return "Header mismatch: MCP-Protocol-Version does not match the body's protocol version"
	}
	if r.Header.Get("Mcp-Method") != method {
		return "Header mismatch: Mcp-Method does not match the body's method"
	}
	if method == "tools/call" {
		if header, ok := decodedMCPHeader(r.Header.Get("Mcp-Name")); !ok || header != name {
			return "Header mismatch: Mcp-Name does not match the body's tool name"
		}
	}

	return ""
}

// decodedMCPHeader undoes the transport's =?base64?…?= sentinel, which a
// client must use for a value that is not plain ASCII; false means a sentinel
// that does not decode.
func decodedMCPHeader(raw string) (string, bool) {
	inner, encoded := strings.CutPrefix(raw, "=?base64?")
	if !encoded {
		return raw, true
	}
	inner, closed := strings.CutSuffix(inner, "?=")
	if !closed {
		return "", false
	}
	decoded, err := base64.StdEncoding.DecodeString(inner)

	return string(decoded), err == nil
}

func writeRPC(w http.ResponseWriter, status int, resp rpcResponse) {
	resp.JSONRPC = "2.0"
	if resp.ID == nil {
		resp.ID = json.RawMessage("null")
	}
	writeJSON(w, status, resp)
}

func writeRPCError(w http.ResponseWriter, status int, id json.RawMessage, code int, message string) {
	writeRPC(w, status, rpcResponse{ID: id, Error: &rpcError{Code: code, Message: message}})
}
```

Note for the implementer: `json.Unmarshal` hands a JSON `null` to `json.RawMessage.UnmarshalJSON`, so `"id": null` arrives as the bytes `null` and an absent id as `nil` — the "null id" case in the table is what proves it.

- [ ] **Step 5: Run; all pass.** Same command as Step 3. Expected: PASS. Then `make test-go` (nothing else broke), then `docker compose run --rm --no-deps lint golangci-lint fmt` and `make lint`.

- [ ] **Step 6: Mutations** (one test each; red, restore, green; report the red line):
  1. Delete the Origin block → `TestMCPRefusesARequestCarryingAnyOrigin` red (200/405).
  2. Change the Origin test to `r.Header.Get("Origin") != ""` → the `""` origin subtests red.
  3. Move the Origin block below the method check → the `GET from …` subtests red (405).
  4. Delete the `Allow` header line → both `… is not served` cases red on Allow.
  5. Remove `req.ID == nil` branch → both notification cases red (status 200/body present).
  6. Remove the `[` batch check → "a batch" red (parse error -32700, not -32600).
  7. Remove `|| string(req.ID) == "null"` → "a null id" red.
  8. Remove `req.JSONRPC != "2.0" ||` → "a jsonrpc other than 2.0" red.
  9. Return `http.StatusOK` for every failure (drop the `modern &&` 404) → "an unknown method, 2026-07-28" red.
  10. Return 404 regardless of era → "an unknown method, handshake era" red.
  11. Drop the `version != mcpVersion` block → "a _meta version this server does not speak" and `TestMCPUnsupportedVersionNamesWhatIsSupported` red.
  12. Each of the two `return` lines in `mcpHeaderMismatchIn` replaced by `return ""` → the two matching header cases red.
  13. Drop the legacy `MCP-Protocol-Version` check → "under an unknown version header" red.
  14. In `initialize`, always answer `mcpLegacyVersions[0]` → `asked for "2025-06-18"` and `"2025-03-26"` red; answer `params.ProtocolVersion` unchecked → `"2024-11-05"`, `"2026-07-28"`, `""` red.
  15. `"name": "ThatApp"` / `"version": "dev"` in `mcpServerInfo` → initialize and discover tests red.
  16. Reorder `mcpSupportedVersions` to put `mcpVersion` last → `TestMCPDiscoverNamesTheCurrentRevisionFirst` red.
  17. Drop `"cacheScope"` from discover → discover test red.
  18. Drop `"resultType"` from `mcpResultOf` → discover test red.
  19. Change the params decode failure to `http.StatusBadRequest` → "params that are not an object" red.

- [ ] **Step 7: Commit.**

```bash
git add internal/config/config.go cmd/server/main.go internal/server/server.go internal/server/mcp.go internal/server/mcp_test.go
git commit -m "#253: /mcp answers JSON-RPC over Streamable HTTP, dual-era

Stateless POST endpoint: Origin refused with 403, POST only, notifications
202, initialize for the handshake revisions and server/discover for
2026-07-28 with its mirrored-header checks.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QVfih7S1jT93T1csp7GBNf"
```

---

### Task 2: The ten tools, each a call to its /api handler

**Files:**
- Create: `internal/server/mcp_tools.go`
- Modify: `internal/server/mcp.go` (`mcpResult` gains `r *http.Request` and two cases; its one call site)
- Test: `internal/server/mcp_tools_test.go` (new)

**Interfaces:**
- Consumes (Task 1): `mcpParams`, `rpcError`, `rpcInvalidParams`, `mcpHeaderMismatch`, `mcpVersion`, `mcpCacheTTLMs`, `s.mcpResultOf`, and test helpers `postMCP`, `decodeRPC`, `modernBody`, `modernHeaders`, `mcpTestServer`. From the codebase: `s.mux`, `errorBody`, `entryDTO`, `startTimerResponse`, `timerStateResponse`, `s.db.Entry`, `store.Entry.WorklogID`; test helpers `serverInZone`, `fetchEnv`, `newServerWithStore`, `newEntriesEnv`, `callEntries`, `allEntries`, `makeEntryDirty`.
- Produces (Task 3 relies on these):
  - `type mcpTool struct{ Name, Description string; InputSchema json.RawMessage; request func(json.RawMessage) (apiRequest, error) }`
  - `type apiRequest struct{ method, target string; body json.RawMessage }`
  - `var mcpTools []mcpTool`; `func mcpToolNamed(name string) (mcpTool, bool)`
  - `const mcpJiraDeleteRefusal string`
  - test helpers `callTool(t, srv, name, args string) toolReply`, `toolReply{Content, IsError}` with `.text()`

- [ ] **Step 1: Bare declarations.** Create `internal/server/mcp_tools.go` with only:

```go
package server

import "encoding/json"

const mcpJiraDeleteRefusal = ""

type apiRequest struct {
	method string
	target string
	body   json.RawMessage
}

type mcpTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"inputSchema"`
	request     func(args json.RawMessage) (apiRequest, error)
}

var mcpTools []mcpTool

func mcpToolNamed(string) (mcpTool, bool) { return mcpTool{}, false }
```

- [ ] **Step 2: Write the failing tests.** Create `internal/server/mcp_tools_test.go`:

```go
package server

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"
)

type toolReply struct {
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
	IsError bool `json:"isError"`
}

func (r toolReply) text() string { return r.Content[0].Text }

// callTool sends tools/call the way an initialize-era client does — no _meta,
// no mirrored headers. args "" leaves arguments out altogether.
func callTool(t *testing.T, srv *Server, name, args string) toolReply {
	t.Helper()

	params := `"name":"` + name + `"`
	if args != "" {
		params += `,"arguments":` + args
	}
	rec := postMCP(t, srv, http.MethodPost,
		`{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{`+params+`}}`, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("tools/call %s: status = %d, want 200; body %s", name, rec.Code, rec.Body.String())
	}
	reply := decodeRPC(t, rec)
	if reply.Error != nil {
		t.Fatalf("tools/call %s answered a protocol error: %+v", name, *reply.Error)
	}
	var result toolReply
	if err := json.Unmarshal(reply.Result, &result); err != nil {
		t.Fatalf("decoding %s: %v", reply.Result, err)
	}
	if len(result.Content) != 1 || result.Content[0].Type != "text" {
		t.Fatalf("tools/call %s: content = %+v, want one text item", name, result.Content)
	}

	return result
}

func TestMCPToolsListIsExactlyTheTen(t *testing.T) {
	rec := postMCP(t, mcpTestServer(t), http.MethodPost, `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`, nil)

	reply := decodeRPC(t, rec)
	if reply.Error != nil {
		t.Fatalf("error = %+v, want a result", *reply.Error)
	}
	var result struct {
		Tools []struct {
			Name        string `json:"name"`
			Description string `json:"description"`
			InputSchema struct {
				Type       string                     `json:"type"`
				Properties map[string]json.RawMessage `json:"properties"`
				Required   []string                   `json:"required"`
			} `json:"inputSchema"`
		} `json:"tools"`
		TTLMs      int64  `json:"ttlMs"`
		CacheScope string `json:"cacheScope"`
	}
	if err := json.Unmarshal(reply.Result, &result); err != nil {
		t.Fatalf("decoding %s: %v", reply.Result, err)
	}

	want := []string{
		"list_issues", "search_issues", "list_entries", "get_week", "get_timer",
		"create_entry", "update_entry", "delete_entry", "start_timer", "stop_timer",
	}
	var names []string
	for _, tool := range result.Tools {
		names = append(names, tool.Name)
		if strings.TrimSpace(tool.Description) == "" {
			t.Errorf("%s has no description", tool.Name)
		}
		if tool.InputSchema.Type != "object" {
			t.Errorf("%s inputSchema type = %q, want object", tool.Name, tool.InputSchema.Type)
		}
		for _, required := range tool.InputSchema.Required {
			if _, ok := tool.InputSchema.Properties[required]; !ok {
				t.Errorf("%s requires %q, which its schema does not describe", tool.Name, required)
			}
		}
	}
	if !slices.Equal(names, want) {
		t.Errorf("tools = %v, want exactly %v", names, want)
	}
	if result.TTLMs <= 0 || result.CacheScope != "private" {
		t.Errorf("ttlMs = %d, cacheScope = %q; 2026-07-28 requires both", result.TTLMs, result.CacheScope)
	}
}

// The ticket's table, row for row. Covering every tool here is what keeps a
// later tool from reaching push, the week fetch, instances or pins unseen.
func TestMCPToolsReachTheirRoutes(t *testing.T) {
	const get, post, patch, del = http.MethodGet, http.MethodPost, http.MethodPatch, http.MethodDelete
	covered := map[string]bool{}

	for _, tc := range []struct {
		tool, args, wantMethod, wantTarget string
		forwardsArgs                       bool
	}{
		{"list_issues", `{}`, get, "/api/issues", false},
		{"search_issues", `{"q":"RIDGE 12"}`, get, "/api/issues/search?q=RIDGE+12", false},
		{"list_entries", `{}`, get, "/api/entries", false},
		{"list_entries", `{"from":"2026-08-01","to":"2026-08-31"}`, get, "/api/entries?from=2026-08-01&to=2026-08-31", false},
		{"get_week", `{}`, get, "/api/week", false},
		{"get_week", `{"start":"2026-08-24"}`, get, "/api/week?start=2026-08-24", false},
		{"get_timer", `{}`, get, "/api/timer", false},
		{"create_entry", `{"instanceId":1,"issueKey":"RIDGE-1","day":"2026-08-20","seconds":900,"comment":"x"}`, post, "/api/entries", true},
		{"update_entry", `{"id":42,"comment":"Reworded"}`, patch, "/api/entries/42", true},
		{"delete_entry", `{"id":42}`, del, "/api/entries/42", false},
		{"start_timer", `{"instanceId":1,"issueKey":"RIDGE-1","round":"down","comment":"x"}`, post, "/api/timer/start", true},
		{"stop_timer", `{"round":"up","comment":"x"}`, post, "/api/timer/stop", true},
	} {
		t.Run(tc.tool+" "+tc.args, func(t *testing.T) {
			covered[tc.tool] = true
			tool, found := mcpToolNamed(tc.tool)
			if !found {
				t.Fatalf("no tool named %s", tc.tool)
			}
			call, err := tool.request(json.RawMessage(tc.args))
			if err != nil {
				t.Fatalf("request(%s): %v", tc.args, err)
			}
			if call.method != tc.wantMethod || call.target != tc.wantTarget {
				t.Errorf("%s %s, want %s %s", call.method, call.target, tc.wantMethod, tc.wantTarget)
			}
			wantBody := ""
			if tc.forwardsArgs {
				wantBody = tc.args
			}
			if string(call.body) != wantBody {
				t.Errorf("body = %s, want %q", call.body, wantBody)
			}
		})
	}

	for _, tool := range mcpTools {
		if !covered[tool.Name] {
			t.Errorf("%s has no route case above", tool.Name)
		}
	}
}

// Monday 01:00 in Auckland is still Sunday in UTC, so a default resolved
// anywhere but the handler names the wrong today and the wrong week. fetchEnv
// seeds no instance, so the two issue tools fan out to nobody.
func TestMCPReadToolsAnswerWithTheHandlersBody(t *testing.T) {
	srv, _, _ := fetchEnv(t, "Pacific/Auckland", time.Date(2026, 8, 23, 13, 0, 0, 0, time.UTC))

	for _, tc := range []struct {
		name, tool, args, target, wantFragment string
	}{
		{"assigned issues", "list_issues", `{}`, "/api/issues", ""},
		{"a search", "search_issues", `{"q":"RIDGE"}`, "/api/issues/search?q=RIDGE", ""},
		{"today's entries with no arguments at all", "list_entries", "", "/api/entries", `"today":"2026-08-24"`},
		{"today's entries with null arguments", "list_entries", "null", "/api/entries", `"today":"2026-08-24"`},
		{"a range", "list_entries", `{"from":"2026-08-01","to":"2026-08-31"}`, "/api/entries?from=2026-08-01&to=2026-08-31", ""},
		{"this week", "get_week", `{}`, "/api/week", `"start":"2026-08-24"`},
		{"a named week", "get_week", `{"start":"2026-08-17"}`, "/api/week?start=2026-08-17", `"start":"2026-08-17"`},
		{"the timer", "get_timer", `{}`, "/api/timer", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			api := callEntries(t, srv, http.MethodGet, tc.target, "")
			if api.Code != http.StatusOK {
				t.Fatalf("GET %s: status = %d; body %s", tc.target, api.Code, api.Body.String())
			}

			got := callTool(t, srv, tc.tool, tc.args)

			if got.IsError {
				t.Fatalf("isError with %q", got.text())
			}
			if got.text() != strings.TrimSpace(api.Body.String()) {
				t.Errorf("text = %s\nwant the handler's body %s", got.text(), api.Body.String())
			}
			if !strings.Contains(got.text(), tc.wantFragment) {
				t.Errorf("text = %s, want it to contain %s", got.text(), tc.wantFragment)
			}
		})
	}
}

func TestMCPWriteToolsReachTheirHandlers(t *testing.T) {
	srv, db, inst := serverInZone(t, "Pacific/Auckland", time.Date(2026, 8, 21, 13, 0, 0, 0, time.UTC))
	instanceID := strconv.FormatInt(inst.ID, 10)

	created := callTool(t, srv, "create_entry",
		`{"instanceId":`+instanceID+`,"issueKey":"RIDGE-7","seconds":1800,"comment":"Refinement"}`)
	var entry entryDTO
	if err := json.Unmarshal([]byte(created.text()), &entry); err != nil || created.IsError {
		t.Fatalf("create_entry: isError %v, text %s, decode error %v", created.IsError, created.text(), err)
	}
	if entry.IssueKey != "RIDGE-7" || entry.Seconds != 1800 || entry.PushState != "unpushed" {
		t.Errorf("created %+v, want RIDGE-7, 1800s, unpushed", entry)
	}
	entryID := strconv.FormatInt(entry.ID, 10)

	updated := callTool(t, srv, "update_entry", `{"id":`+entryID+`,"seconds":2700}`)
	var edited entryDTO
	if err := json.Unmarshal([]byte(updated.text()), &edited); err != nil || updated.IsError {
		t.Fatalf("update_entry: isError %v, text %s", updated.IsError, updated.text())
	}
	if edited.Seconds != 2700 || edited.Comment != "Refinement" {
		t.Errorf("updated %+v, want 2700s and the comment kept", edited)
	}

	started := callTool(t, srv, "start_timer", `{"instanceId":`+instanceID+`,"issueKey":"RIDGE-8"}`)
	var start startTimerResponse
	if err := json.Unmarshal([]byte(started.text()), &start); err != nil || started.IsError ||
		start.Running == nil || start.Running.IssueKey != "RIDGE-8" {
		t.Fatalf("start_timer: isError %v, text %s", started.IsError, started.text())
	}

	stopped := callTool(t, srv, "stop_timer", `{"round":"up","comment":"Pairing"}`)
	if stopped.IsError {
		t.Fatalf("stop_timer: %s", stopped.text())
	}
	var after timerStateResponse
	if err := json.Unmarshal([]byte(callTool(t, srv, "get_timer", `{}`).text()), &after); err != nil || after.Running != nil {
		t.Errorf("after stop_timer the timer reads %+v, want nothing running", after.Running)
	}

	deleted := callTool(t, srv, "delete_entry", `{"id":`+entryID+`}`)
	if deleted.IsError || deleted.text() != "No Content" {
		t.Errorf("delete_entry: isError %v, text %q; want No Content", deleted.IsError, deleted.text())
	}
	for _, stored := range allEntries(t, db) {
		if stored.ID == entry.ID {
			t.Errorf("entry %d is still stored after delete_entry", entry.ID)
		}
	}
}

func TestMCPToolFailuresComeBackAsToolErrors(t *testing.T) {
	srv, _, inst := serverInZone(t, "Pacific/Auckland", time.Date(2026, 8, 23, 13, 0, 0, 0, time.UTC))
	instanceID := strconv.FormatInt(inst.ID, 10)

	for _, tc := range []struct{ name, tool, args, want string }{
		{"an unknown instance", "create_entry", `{"instanceId":999,"issueKey":"RIDGE-1","seconds":900}`, "no such instance"},
		{"a duration over a day", "create_entry",
			`{"instanceId":` + instanceID + `,"issueKey":"RIDGE-1","seconds":86401}`, "seconds must be between 1 and 86400"},
		{"an impossible day", "create_entry",
			`{"instanceId":` + instanceID + `,"issueKey":"RIDGE-1","day":"2026-02-30","seconds":900}`,
			"day must be a date of the form YYYY-MM-DD"},
		{"arguments that are not an object", "create_entry", `[1]`, "the request body is not valid JSON"},
		{"a missing entry", "update_entry", `{"id":999,"seconds":900}`, "no such entry"},
		{"no id at all", "delete_entry", `{}`, "no such entry"},
		{"a stop without a rounding", "stop_timer", `{}`, `round must be "up" or "down"`},
		{"a week that does not start on a Monday", "get_week", `{"start":"2026-08-25"}`,
			"start must be a Monday, of the form YYYY-MM-DD"},
		{"a range the wrong way round", "list_entries", `{"from":"2026-08-31","to":"2026-08-01"}`,
			"from must not be after to"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := callTool(t, srv, tc.tool, tc.args)

			if !got.IsError {
				t.Errorf("isError = false, want true; text %s", got.text())
			}
			if got.text() != tc.want {
				t.Errorf("text = %q, want the API's message %q", got.text(), tc.want)
			}
		})
	}
}

func TestMCPToolArgumentsOfTheWrongTypeAreToolErrors(t *testing.T) {
	srv := mcpTestServer(t)

	for _, tc := range []struct{ tool, args string }{
		{"list_entries", `{"from":5}`},
		{"search_issues", `{"q":["RIDGE"]}`},
		{"delete_entry", `{"id":"5"}`},
		{"update_entry", `[5]`},
	} {
		t.Run(tc.tool+" "+tc.args, func(t *testing.T) {
			got := callTool(t, srv, tc.tool, tc.args)

			if !got.IsError || !strings.HasPrefix(got.text(), "the arguments do not fit "+tc.tool) {
				t.Errorf("isError %v, text %q; want a tool error naming %s's arguments", got.IsError, got.text(), tc.tool)
			}
		})
	}
}

func TestMCPServerFailureIsAToolError(t *testing.T) {
	srv, db, _ := newServerWithStore(t)
	_ = db.Close()

	got := callTool(t, srv, "get_timer", `{}`)

	if !got.IsError || got.text() != "could not read the timer" {
		t.Errorf("isError %v, text %q; want the 500's message as a tool error", got.IsError, got.text())
	}
}

func TestMCPUnknownToolIsAProtocolError(t *testing.T) {
	for _, name := range []string{
		"push", "push_day", "fetch_week", "list_instances", "create_instance", "list_pins", "create_pin", "",
	} {
		t.Run(strconv.Quote(name), func(t *testing.T) {
			rec := postMCP(t, mcpTestServer(t), http.MethodPost,
				`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"`+name+`","arguments":{}}}`, nil)

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body %s", rec.Code, rec.Body.String())
			}
			reply := decodeRPC(t, rec)
			if reply.Error == nil || reply.Error.Code != rpcInvalidParams {
				t.Errorf("error = %+v, want code %d", reply.Error, rpcInvalidParams)
			}
		})
	}
}

// Ruling 2: deleting an entry Jira holds a worklog for would delete that
// worklog, and no tool writes to Jira. newEntriesEnv's fake counts deletes.
func TestMCPDeleteEntryNeverReachesJira(t *testing.T) {
	for _, tc := range []struct {
		name               string
		pushed, editedSince bool
	}{
		{"an entry never pushed is deleted", false, false},
		{"an entry pushed to Jira is refused", true, false},
		{"an entry edited since its push is refused", true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			env := newEntriesEnv(t)
			entry := env.createEntry(t, "RIDGE-1", 900, "")
			if tc.pushed {
				env.markPushed(t, entry.ID, "wl-1")
			}
			if tc.editedSince {
				makeEntryDirty(t, env.store, entry.ID, 1200, "Reworded")
			}

			got := callTool(t, env.s, "delete_entry", `{"id":`+strconv.FormatInt(entry.ID, 10)+`}`)

			if got.IsError != tc.pushed {
				t.Errorf("isError = %v, want %v; text %q", got.IsError, tc.pushed, got.text())
			}
			if tc.pushed && got.text() != mcpJiraDeleteRefusal {
				t.Errorf("text = %q, want %q", got.text(), mcpJiraDeleteRefusal)
			}
			if env.jira.deleteCalls != 0 {
				t.Errorf("Jira saw %d worklog deletes, want none", env.jira.deleteCalls)
			}
			_, err := env.store.Entry(context.Background(), entry.ID)
			if stillStored := err == nil; stillStored != tc.pushed {
				t.Errorf("entry still stored = %v, want %v", stillStored, tc.pushed)
			}
		})
	}
}

func TestMCPOriginReachesNoHandler(t *testing.T) {
	srv, db, inst := serverInZone(t, "Pacific/Auckland", time.Date(2026, 8, 21, 13, 0, 0, 0, time.UTC))

	rec := postMCP(t, srv, http.MethodPost,
		`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_entry","arguments":`+
			`{"instanceId":`+strconv.FormatInt(inst.ID, 10)+`,"issueKey":"RIDGE-1","seconds":900}}}`,
		map[string]string{"Origin": "http://localhost:8080"})

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
	if stored := allEntries(t, db); len(stored) != 0 {
		t.Errorf("stored %d entries, want none: the request reached a handler", len(stored))
	}
}

func TestMCPModernToolsCallChecksMcpName(t *testing.T) {
	srv, _, _ := fetchEnv(t, "Pacific/Auckland", time.Date(2026, 8, 23, 13, 0, 0, 0, time.UTC))
	body := modernBody("tools/call", mcpVersion, `,"name":"get_timer","arguments":{}`)

	for _, tc := range []struct {
		name, mcpName string
		wantStatus    int
		wantCode      int
	}{
		{"named plainly", "get_timer", http.StatusOK, 0},
		{"named through the base64 sentinel",
			"=?base64?" + base64.StdEncoding.EncodeToString([]byte("get_timer")) + "?=", http.StatusOK, 0},
		{"naming a different tool", "list_issues", http.StatusBadRequest, mcpHeaderMismatch},
		{"not named", "", http.StatusBadRequest, mcpHeaderMismatch},
		{"a sentinel that does not decode", "=?base64?!!!?=", http.StatusBadRequest, mcpHeaderMismatch},
	} {
		t.Run(tc.name, func(t *testing.T) {
			headers := modernHeaders("tools/call")
			if tc.mcpName != "" {
				headers["Mcp-Name"] = tc.mcpName
			}

			rec := postMCP(t, srv, http.MethodPost, body, headers)

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d; body %s", rec.Code, tc.wantStatus, rec.Body.String())
			}
			reply := decodeRPC(t, rec)
			if tc.wantCode == 0 && reply.Error != nil {
				t.Errorf("error = %+v, want a result", *reply.Error)
			}
			if tc.wantCode != 0 && (reply.Error == nil || reply.Error.Code != tc.wantCode) {
				t.Errorf("error = %+v, want code %d", reply.Error, tc.wantCode)
			}
		})
	}
}
```

- [ ] **Step 3: Run; every test fails on an assertion.**

Run: `docker compose run --build --rm --no-deps app go test ./internal/server/ -run 'TestMCP' -count=1 -v`
Expected: Task 1's tests still PASS. The new ones FAIL — `tools = [], want exactly [list_issues …]`, `no tool named list_issues`, `tools/call get_timer answered a protocol error: {Code:-32601 …}`, `error = &{Code:-32601 …}, want code -32602`, and in `TestMCPModernToolsCallChecksMcpName/named plainly` `status = 404`. Quote one line per test function. Two pass already and are *guards* here, proven in Step 6: `TestMCPOriginReachesNoHandler` (Task 1's Origin check) and the three `400` cases of `TestMCPModernToolsCallChecksMcpName` (Task 1's header check).

- [ ] **Step 4: Implement.** Replace `internal/server/mcp_tools.go` with:

```go
package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
)

// mcpJiraDeleteRefusal is delete_entry's answer for an entry Jira holds a
// worklog for: the API would delete that worklog too, and no tool writes to Jira.
const mcpJiraDeleteRefusal = "This entry has reached Jira, and deleting it would delete its Jira " +
	"worklog too. Only ThatApp itself may do that: delete it there."

// apiRequest is the /api request a tool call stands for — what the browser
// would send for the same thing.
type apiRequest struct {
	method string
	target string
	body   json.RawMessage
}

// mcpTool is one tool: what tools/list shows, and how its arguments become an
// apiRequest. It checks nothing but JSON types; the handler the request reaches
// validates, defaults and resolves days exactly as it does for the browser.
type mcpTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"inputSchema"`
	request     func(args json.RawMessage) (apiRequest, error)
}

const (
	noArguments = `{"type":"object","additionalProperties":false}`
	dayProperty = `{"type":"string","format":"date","description":"YYYY-MM-DD, in the server's timezone (THAT_TIMEZONE)."}`
	roundProperty = `{"type":"string","enum":["up","down"],"description":"Which way to round the run to the 15-minute grid."}`
)

// mcpTools is tools/list's answer, in a fixed order so a client can cache it.
var mcpTools = []mcpTool{
	{
		Name: "list_issues",
		Description: "The Jira issues assigned to the user on every configured Jira instance, grouped by " +
			"instance. An instance Jira could not answer for carries an error instead of issues. The " +
			"instance id here is what create_entry and start_timer take as instanceId.",
		InputSchema: json.RawMessage(noArguments),
		request:     fixedRequest(http.MethodGet, "/api/issues"),
	},
	{
		Name: "search_issues",
		Description: "Search every configured Jira instance for issues by key or by words in the summary, " +
			"assigned to the user or not. A query shorter than two characters returns no results.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{"q":{"type":"string",` +
			`"description":"An issue key such as RIDGE-12, or words from a summary."}},` +
			`"required":["q"],"additionalProperties":false}`),
		request: queryRequest("/api/issues/search", "q"),
	},
	{
		Name: "list_entries",
		Description: "Logged time entries in an inclusive date range, oldest first. Each has its push " +
			"state: unpushed (not in Jira yet), pushed, or dirty (edited since its push). Dates are " +
			"YYYY-MM-DD in the server's timezone (THAT_TIMEZONE), and both default to today there; the " +
			"response's today field names that date.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{"from":` + dayProperty +
			`,"to":` + dayProperty + `},"additionalProperties":false}`),
		request: queryRequest("/api/entries", "from", "to"),
	},
	{
		Name: "get_week",
		Description: "A Monday-to-Sunday rollup of logged time: per issue per day, with day totals and " +
			"each cell's push state. start must be a Monday, YYYY-MM-DD; it defaults to this week's " +
			"Monday in the server's timezone (THAT_TIMEZONE).",
		InputSchema: json.RawMessage(`{"type":"object","properties":{"start":` + dayProperty +
			`},"additionalProperties":false}`),
		request: queryRequest("/api/week", "start"),
	},
	{
		Name: "get_timer",
		Description: "The running timer, if any: its issue and when it started. A timer still running " +
			"after midnight in the server's timezone is closed into an entry by this read, and that " +
			"entry is returned as stopped.",
		InputSchema: json.RawMessage(noArguments),
		request:     fixedRequest(http.MethodGet, "/api/timer"),
	},
	{
		Name: "create_entry",
		Description: "Log time against an issue. It is stored in ThatApp and reaches Jira only when the " +
			"user pushes from the app. day defaults to today in the server's timezone (THAT_TIMEZONE); " +
			"the entry starts at the server's clock, or at midnight of a given day in that timezone. " +
			"seconds is 1 to 86400. instanceId comes from list_issues, search_issues or list_entries.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{` +
			`"instanceId":{"type":"integer","minimum":1},"issueKey":{"type":"string"},"day":` + dayProperty +
			`,"seconds":{"type":"integer","minimum":1,"maximum":86400},"comment":{"type":"string"}},` +
			`"required":["instanceId","issueKey","seconds"],"additionalProperties":false}`),
		request: bodyRequest(http.MethodPost, "/api/entries"),
	},
	{
		Name: "update_entry",
		Description: "Change an entry's duration, its comment, or both; send at least one. Its day and " +
			"start cannot change. An entry already pushed becomes dirty, and the user's next push " +
			"corrects it in Jira.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{"id":{"type":"integer","minimum":1},` +
			`"seconds":{"type":"integer","minimum":1,"maximum":86400},"comment":{"type":"string"}},` +
			`"required":["id"],"additionalProperties":false}`),
		request: entryRequest(http.MethodPatch, true),
	},
	{
		Name: "delete_entry",
		Description: "Delete an entry that has not reached Jira. An entry that has (pushed or dirty) is " +
			"refused: deleting it would delete its Jira worklog, which only ThatApp itself may do.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{"id":{"type":"integer","minimum":1}},` +
			`"required":["id"],"additionalProperties":false}`),
		request: entryRequest(http.MethodDelete, false),
	},
	{
		Name: "start_timer",
		Description: "Start the timer on an issue, from the server's clock; its day is the server's " +
			"timezone's. One timer runs at a time: if another is running it is stopped first, which " +
			"requires round and takes comment for the entry it becomes. A run that rounds to zero is " +
			"discarded.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{` +
			`"instanceId":{"type":"integer","minimum":1},"issueKey":{"type":"string"},"round":` + roundProperty +
			`,"comment":{"type":"string","description":"The stopped timer's entry comment."}},` +
			`"required":["instanceId","issueKey"],"additionalProperties":false}`),
		request: bodyRequest(http.MethodPost, "/api/timer/start"),
	},
	{
		Name: "stop_timer",
		Description: "Stop the running timer, rounding its run up or down to the 15-minute grid, and log " +
			"it as an entry with the comment. A run that rounds to zero is discarded. With nothing " +
			"running it does nothing.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{"round":` + roundProperty +
			`,"comment":{"type":"string"}},"required":["round"],"additionalProperties":false}`),
		request: bodyRequest(http.MethodPost, "/api/timer/stop"),
	},
}

func mcpToolNamed(name string) (mcpTool, bool) {
	for _, tool := range mcpTools {
		if tool.Name == name {
			return tool, true
		}
	}

	return mcpTool{}, false
}

func fixedRequest(method, path string) func(json.RawMessage) (apiRequest, error) {
	return func(json.RawMessage) (apiRequest, error) {
		return apiRequest{method: method, target: path}, nil
	}
}

// queryRequest sends the named string arguments as query parameters and
// leaves out any that are absent, so the handler's own default applies.
func queryRequest(path string, names ...string) func(json.RawMessage) (apiRequest, error) {
	return func(args json.RawMessage) (apiRequest, error) {
		var given map[string]string
		if err := json.Unmarshal(args, &given); err != nil {
			return apiRequest{}, err
		}
		query := url.Values{}
		for _, name := range names {
			if value := given[name]; value != "" {
				query.Set(name, value)
			}
		}
		target := path
		if len(query) > 0 {
			target += "?" + query.Encode()
		}

		return apiRequest{method: http.MethodGet, target: target}, nil
	}
}

// bodyRequest forwards the arguments unchanged as the body: they are the API's
// own request type, so its handler is what validates them.
func bodyRequest(method, path string) func(json.RawMessage) (apiRequest, error) {
	return func(args json.RawMessage) (apiRequest, error) {
		return apiRequest{method: method, target: path, body: args}, nil
	}
}

// entryRequest addresses /api/entries/{id}. With body, the arguments go along
// too; the handler's decoder ignores the id among them.
func entryRequest(method string, body bool) func(json.RawMessage) (apiRequest, error) {
	return func(args json.RawMessage) (apiRequest, error) {
		var named struct {
			ID int64 `json:"id"`
		}
		if err := json.Unmarshal(args, &named); err != nil {
			return apiRequest{}, err
		}
		call := apiRequest{method: method, target: "/api/entries/" + strconv.FormatInt(named.ID, 10)}
		if body {
			call.body = args
		}

		return call, nil
	}
}

// mcpCallTool runs one tools/call. Only an unknown tool is a protocol error;
// everything a model could correct — its arguments, a refusal, a failing
// handler — is a tool result with isError set.
func (s *Server) mcpCallTool(r *http.Request, params mcpParams) (any, *rpcError) {
	tool, found := mcpToolNamed(params.Name)
	if !found {
		return nil, &rpcError{Code: rpcInvalidParams, Message: "no such tool: " + params.Name}
	}

	args := params.Arguments
	if len(args) == 0 {
		args = json.RawMessage("{}")
	}
	call, err := tool.request(args)
	if err != nil {
		return s.mcpToolResult("the arguments do not fit "+tool.Name+"'s input schema: "+err.Error(), true), nil
	}
	if tool.Name == "delete_entry" && s.entryReachedJira(r.Context(), args) {
		return s.mcpToolResult(mcpJiraDeleteRefusal, true), nil
	}

	status, body := s.callAPI(r.Context(), call)
	if status >= http.StatusBadRequest {
		return s.mcpToolResult(apiMessageIn(status, body), true), nil
	}
	text := strings.TrimSpace(string(body))
	if text == "" {
		text = http.StatusText(status)
	}

	return s.mcpToolResult(text, false), nil
}

// entryReachedJira reports whether the entry delete_entry's arguments name has
// a worklog. An id that does not resolve is left for the handler to answer.
//
// ponytail: read before the DELETE, outside pushMu (the handler takes that lock
// itself), so a push landing in between can still reach Jira; a local-only flag
// on DELETE /api/entries/{id} closes it if that window ever matters.
func (s *Server) entryReachedJira(ctx context.Context, args json.RawMessage) bool {
	var named struct {
		ID int64 `json:"id"`
	}
	if json.Unmarshal(args, &named) != nil {
		return false
	}
	entry, err := s.db.Entry(ctx, named.ID)

	return err == nil && entry.WorklogID != ""
}

// callAPI runs one request through the server's own routes, in process, so a
// tool gets the validation, day resolution and push state the browser gets.
func (s *Server) callAPI(ctx context.Context, call apiRequest) (int, []byte) {
	req := httptest.NewRequestWithContext(ctx, call.method, call.target, bytes.NewReader(call.body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.mux.ServeHTTP(rec, req)

	return rec.Code, rec.Body.Bytes()
}

// apiMessageIn is the person-facing message of an API failure body, falling
// back to the body itself, then to the status text.
func apiMessageIn(status int, body []byte) string {
	var failure errorBody
	if json.Unmarshal(body, &failure) == nil && failure.Message != "" {
		return failure.Message
	}
	if text := strings.TrimSpace(string(body)); text != "" {
		return text
	}

	return http.StatusText(status)
}

func (s *Server) mcpToolResult(text string, isError bool) map[string]any {
	return s.mcpResultOf(map[string]any{
		"content": []map[string]string{{"type": "text", "text": text}},
		"isError": isError,
	})
}
```

In `internal/server/mcp.go`, change `mcpResult` to take the request and add the two cases (the rest of the switch unchanged):

```go
// mcpResult answers one request's method, or names the JSON-RPC error it is.
func (s *Server) mcpResult(r *http.Request, method string, params mcpParams) (any, *rpcError) {
	switch method {
	// … initialize, ping, server/discover exactly as before …
	case "tools/list":
		return s.mcpResultOf(map[string]any{
			"tools":      mcpTools,
			"ttlMs":      mcpCacheTTLMs,
			"cacheScope": "private",
		}), nil
	case "tools/call":
		return s.mcpCallTool(r, params)
	default:
		return nil, &rpcError{Code: rpcMethodNotFound, Message: "no such method: " + method}
	}
}
```

and its call site in `handleMCP` to `s.mcpResult(r, req.Method, params)`.

- [ ] **Step 5: Run; all pass.** Same command as Step 3, then `make test-go`, `docker compose run --rm --no-deps lint golangci-lint fmt`, `make lint`.

- [ ] **Step 6: Mutations** (one test each):
  1. Drop `stop_timer` from `mcpTools` → `TestMCPToolsListIsExactlyTheTen` red; add an eleventh `{Name: "push_day", …}` → same test red.
  2. Swap two entries in `mcpTools` → list test red (order).
  3. Empty one `Description` → list test red. Put `"required":["instanceId","issueKey","seconds","note"]` in create_entry → list test red.
  4. Remove `"ttlMs"` from tools/list → list test red.
  5. Point `get_week` at `"/api/week/fetch"` → `TestMCPToolsReachTheirRoutes/get_week {}` red; give `update_entry` `http.MethodPut` → its case red.
  6. In `queryRequest`, set empty values too (drop `if value != ""`) → `list_entries {}` route case red (`/api/entries?from=&to=`).
  7. In `entryRequest`, always attach the body → `delete_entry` route case red.
  8. In `queryRequest`, compute a `from`/`to` default of `time.Now().UTC().Format(dayLayout)` when absent → `TestMCPReadToolsAnswerWithTheHandlersBody/today's entries with no arguments at all` red on the `"today":"2026-08-24"` fragment and the body.
  9. Remove the `len(args) == 0` default → "today's entries with no arguments at all" red (an empty body does not decode, so it becomes an argument error). (`null` needs no default: it decodes into a nil map or a zero struct, and a body of `null` reaches the handler's own validation — the `null` case is a guard for that.)
  10. In `mcpCallTool`, return the API body instead of `apiMessageIn` on failure → every `TestMCPToolFailuresComeBackAsToolErrors` case red; return `isError: false` on failure → same red.
  11. Return a protocol error (`&rpcError{Code: rpcInvalidParams…}`) for argument decode failures → `TestMCPToolArgumentsOfTheWrongTypeAreToolErrors` red (`callTool` fatals on the protocol error).
  12. Treat only `status >= 500` as an error → the 4xx failure cases red; only `< 500` → `TestMCPServerFailureIsAToolError` red.
  13. Delete the `delete_entry` guard → `TestMCPDeleteEntryNeverReachesJira` pushed/dirty cases red (`deleteCalls` 1, isError false). Narrow the guard to `pushStateOf(*entry) == "pushed"` → the dirty case red.
  14. Make an unknown tool a tool result (`isError`) instead of `-32602` → `TestMCPUnknownToolIsAProtocolError` red.
  15. Move the Origin block in `handleMCP` below the body decode and dispatch → `TestMCPOriginReachesNoHandler` red (1 entry stored).
  16. Drop the `decodedMCPHeader` call (compare the raw header) → "named through the base64 sentinel" red; return `true` for an undecodable sentinel → "a sentinel that does not decode" red.
  17. Replace `http.StatusText(status)` for an empty body with `""` → `TestMCPWriteToolsReachTheirHandlers` red on `No Content`.

- [ ] **Step 7: Commit.**

```bash
git add internal/server/mcp.go internal/server/mcp_tools.go internal/server/mcp_tools_test.go
git commit -m "#253: ten MCP tools, each a call to its /api handler

tools/list and tools/call. A tool turns its arguments into the request the
browser would send and runs it through the server's own mux; a 4xx or 5xx
comes back as isError with the API's message. delete_entry refuses an entry
that reached Jira, since deleting it would delete its worklog.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QVfih7S1jT93T1csp7GBNf"
```

---

### Task 3: The day boundary and push state, through MCP

Both tests are *guards*: Task 2 already routes the tools through the handlers, so they pass on arrival. They exist so a plausible refactor — a tool that fills in its own default day, or one that writes through the store — fails loudly. They are proven entirely by mutation.

**Files:**
- Test: `internal/server/mcp_tools_test.go` (append)

**Interfaces:**
- Consumes: `callTool`, `toolReply` (Task 2); `serverInZone`, `seedEntryForPatch`, `markEntryPushed`, `callEntries`, `decodeEntry`, `allEntries`, `pushStateOf`, `entryDTO` (existing).
- Produces: nothing.

- [ ] **Step 1: Append the two tests** to `internal/server/mcp_tools_test.go`:

```go
// Every instant sits within an hour of midnight UTC or of midnight in the
// configured zone, and each case's UTC date differs from its local one, so a
// tool that defaulted the day itself — or resolved a named day at UTC midnight
// — lands on the wrong date.
func TestMCPCreateEntryLandsOnTheConfiguredZonesDay(t *testing.T) {
	for _, tc := range []struct {
		name          string
		zone          string
		instant       time.Time
		day           string
		wantDay       string
		wantStartedAt string
	}{
		{
			name:    "half past midnight UTC is still the afternoon before in Los Angeles",
			zone:    "America/Los_Angeles",
			instant: time.Date(2026, 8, 22, 0, 30, 0, 0, time.UTC),
			wantDay: "2026-08-21", wantStartedAt: "2026-08-21T17:30:00-07:00",
		},
		{
			name:    "half an hour before midnight UTC is already tomorrow in Amsterdam",
			zone:    "Europe/Amsterdam",
			instant: time.Date(2026, 8, 21, 23, 30, 0, 0, time.UTC),
			wantDay: "2026-08-22", wantStartedAt: "2026-08-22T01:30:00+02:00",
		},
		{
			name:    "half past midnight in Auckland is still yesterday in UTC",
			zone:    "Pacific/Auckland",
			instant: time.Date(2026, 8, 21, 12, 30, 0, 0, time.UTC),
			wantDay: "2026-08-22", wantStartedAt: "2026-08-22T00:30:00+12:00",
		},
		{
			name:    "a named day starts at that day's midnight in the zone, not UTC's",
			zone:    "Pacific/Auckland",
			instant: time.Date(2026, 8, 21, 12, 30, 0, 0, time.UTC),
			day:     "2026-08-20",
			wantDay: "2026-08-20", wantStartedAt: "2026-08-20T00:00:00+12:00",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv, db, inst := serverInZone(t, tc.zone, tc.instant)
			day := ""
			if tc.day != "" {
				day = `,"day":"` + tc.day + `"`
			}

			got := callTool(t, srv, "create_entry", `{"instanceId":`+strconv.FormatInt(inst.ID, 10)+
				`,"issueKey":"RIDGE-4929","seconds":1800,"comment":"Refinement"`+day+`}`)

			if got.IsError {
				t.Fatalf("create_entry: %s", got.text())
			}
			var dto entryDTO
			if err := json.Unmarshal([]byte(got.text()), &dto); err != nil {
				t.Fatalf("decoding %s: %v", got.text(), err)
			}
			if dto.Day != tc.wantDay {
				t.Errorf("day = %q, want %q; UTC would have said %q",
					dto.Day, tc.wantDay, tc.instant.UTC().Format(dayLayout))
			}
			if dto.StartedAt != tc.wantStartedAt {
				t.Errorf("startedAt = %q, want %q", dto.StartedAt, tc.wantStartedAt)
			}
			stored := allEntries(t, db)
			if len(stored) != 1 || stored[0].Day != tc.wantDay {
				t.Errorf("stored %+v, want one entry on %s", stored, tc.wantDay)
			}
		})
	}
}

// The same edit made twice — once through MCP, once through the API — on two
// entries pushed alike. Push state is derived, never set, so both must read
// dirty, and neither the worklog id nor pushed_at may move; a body that claims
// push state is just another body the handler ignores.
func TestMCPEditAfterAPushReadsDirtyExactlyAsTheAPIDoes(t *testing.T) {
	for _, tc := range []struct{ name, edit string }{
		{"a new duration", `"seconds":2700`},
		{"a new comment", `"comment":"Reworded"`},
		{"a body that also claims push state",
			`"seconds":2700,"pushState":"pushed","worklogId":"","pushedAt":"2099-01-01T00:00:00Z"`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			srv, db, inst := serverInZone(t, "Europe/Amsterdam", time.Date(2026, 8, 21, 9, 0, 0, 0, time.UTC))
			viaMCP := markEntryPushed(t, db, seedEntryForPatch(t, db, inst).ID, "wl-mcp")
			viaAPI := markEntryPushed(t, db, seedEntryForPatch(t, db, inst).ID, "wl-api")
			// Past the second updated_at and pushed_at are truncated to; see makeEntryDirty.
			time.Sleep(1100 * time.Millisecond)

			got := callTool(t, srv, "update_entry", `{"id":`+strconv.FormatInt(viaMCP.ID, 10)+`,`+tc.edit+`}`)
			api := callEntries(t, srv, http.MethodPatch,
				"/api/entries/"+strconv.FormatInt(viaAPI.ID, 10), `{`+tc.edit+`}`)

			if got.IsError {
				t.Fatalf("update_entry: %s", got.text())
			}
			var throughMCP entryDTO
			if err := json.Unmarshal([]byte(got.text()), &throughMCP); err != nil {
				t.Fatalf("decoding %s: %v", got.text(), err)
			}
			throughAPI := decodeEntry(t, api)
			if throughMCP.PushState != "dirty" || throughMCP.PushState != throughAPI.PushState {
				t.Errorf("pushState through MCP %q, through the API %q; want both dirty",
					throughMCP.PushState, throughAPI.PushState)
			}

			stored, err := db.Entry(context.Background(), viaMCP.ID)
			if err != nil {
				t.Fatalf("reading entry %d: %v", viaMCP.ID, err)
			}
			if stored.WorklogID != "wl-mcp" {
				t.Errorf("worklog id = %q, want wl-mcp kept", stored.WorklogID)
			}
			if stored.PushedAt == nil || !stored.PushedAt.Equal(*viaMCP.PushedAt) {
				t.Errorf("pushedAt = %v, want %v kept", stored.PushedAt, viaMCP.PushedAt)
			}
			if pushStateOf(*stored) != "dirty" {
				t.Errorf("stored row reads %q, want dirty", pushStateOf(*stored))
			}
		})
	}
}
```

- [ ] **Step 2: Run; both pass (guards).**

Run: `docker compose run --build --rm --no-deps app go test ./internal/server/ -run 'TestMCPCreateEntryLandsOnTheConfiguredZonesDay|TestMCPEditAfterAPushReadsDirtyExactlyAsTheAPIDoes' -count=1 -v`
Expected: PASS. Say so in the report — these are guards.

- [ ] **Step 3: Mutations — every assertion red at least once:**
  1. *The plausible refactor:* in `mcpTools`, give `create_entry` a request func that fills in `"day": time.Now().UTC().Format(dayLayout)` when the arguments carry none (decode to `map[string]any`, set, re-marshal) → the three default-day cases red on `day`, `startedAt` and `stored`.
  2. In `startedAtForDay` (`entries.go`), resolve a named day with `time.UTC` instead of `s.cfg.Location` → "a named day…" red on `startedAt`.
  3. In `handleCreateEntry`, stamp `Day: startedAt.UTC().Format(dayLayout)` → default cases red on `day` and `stored`.
  4. *The plausible refactor:* make `update_entry`'s request func call `s.db.RecordWorklogMarkingPushedIfUnchanged` after the PATCH (as a tool that "keeps push state in sync" would) — easiest by a temporary branch in `mcpCallTool` → every case red on `pushState` (MCP pushed, API dirty).
  5. In `store.UpdateEntry`, stop moving `updated_at` → all three cases red on `pushState` (both read pushed).
  6. In `pushStateOf`, return `"pushed"` whenever `WorklogID != ""` → all three red.
  7. Remove the `time.Sleep` → note whether the cases flake to `pushed` (they should, within the same second); restore.

- [ ] **Step 4: Commit.**

```bash
git add internal/server/mcp_tools_test.go
git commit -m "#253: prove MCP entries keep the zone's day and derived push state

Guard tests: create_entry near midnight UTC lands on the THAT_TIMEZONE day,
and update_entry after a push reads dirty exactly as the API's PATCH does.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QVfih7S1jT93T1csp7GBNf"
```

---

### Task 4: An open tab catches up when it comes back

**Files:**
- Create: `web/src/tab-return.ts`
- Modify: `web/src/rail.ts` (one import; one call after `void refreshTimer();`, near line 391)
- Test: `.claude/e2e/tests/tab-return.spec.ts` (new)

**Interfaces:**
- Consumes: `announceEntriesChanged()` from `web/src/entries-changed.ts` (already imported by `rail.ts`); `rail.ts`'s own `refreshTimer` (the retrying wrapper around `readTimer`). Today (`refreshTotals`), Week (`show({ preserveFailures: true })`) and the rail (`refresh()`) already re-read on a payload-less `that-entries-changed`; the rail and every row repaint on `that-timer-changed`, which `readTimer` fires.
- Produces: `onTabReturn(handle: () => void): void` in `web/src/tab-return.ts`.

**Why a flag and not a debounce or a visibility check.** A real return delivers two events — `visibilitychange` (visible) and window `focus` — as separate tasks; a tab that never left can still receive either (a `visibilitychange` that does not change anything, a `focus` after a native dialog). A flag set on leaving (`visibilitychange` to hidden, or window `blur`) and cleared by the first event back costs exactly one catch-up per return and nothing otherwise, with no timer. The listeners are on `window`/`document` without `capture`: `focus`/`blur` do not bubble, so focus moving between controls inside the page never reaches them.

**Why the e2e stubs the API rather than calling the real one.** The rig's `app-e2e` has one database and *one timer* shared by every worker and both browser projects, which run fully parallel; a real `POST /api/timer/start` (or `/mcp` `start_timer`) from one test would be the running timer in every other. So each test owns a stateful stub of `/api/timer`, `/api/entries` and `/api/week`, and "the API called from outside the page" is the test changing that stub's state from Node — the page has no part in it — exactly what an MCP write does to the server. The Go tests (Tasks 2–3) already prove the real `/mcp` reaches the real handlers.

- [ ] **Step 1: Write the failing tests.** Create `.claude/e2e/tests/tab-return.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";

/**
 * #253: an MCP client writes through the server while the tab is elsewhere,
 * and the tab catches up when it comes back. The stub below is that server: a
 * test changes its state from Node — outside the page, as an MCP write is —
 * and only the tab's return may bring it on screen.
 *
 * A stub and not the real /api or /mcp: app-e2e has one database and one timer
 * for every worker and both browsers, so a real start here would be the
 * running timer in every other test.
 */

const TODAY = "2026-09-09";
const WEEK = ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"];

interface StubEntry {
  id: number;
  instanceId: number;
  instanceName: string;
  instancePosition: number;
  issueKey: string;
  day: string;
  startedAt: string;
  seconds: number;
  comment: string;
  pushState: "unpushed";
}

interface StubRunning {
  instanceId: number;
  instanceName: string;
  instancePosition: number;
  issueKey: string;
  startedAt: string;
}

interface StubServer {
  running: StubRunning | null;
  entries: StubEntry[];
  reads: { timer: number; entries: number; week: number };
}

function entry(id: number, issueKey: string, seconds: number): StubEntry {
  return {
    id,
    instanceId: 1,
    instanceName: "Work",
    instancePosition: 0,
    issueKey,
    day: TODAY,
    startedAt: `${TODAY}T09:00:00+02:00`,
    seconds,
    comment: "",
    pushState: "unpushed",
  };
}

/** The week rollup the real handler would build from `entries`. */
function weekOf(entries: StubEntry[]) {
  const keys = [...new Set(entries.map((each) => each.issueKey))];
  const rows = keys.map((issueKey) => {
    const cells = WEEK.map((day) => {
      const seconds = entries
        .filter((each) => each.issueKey === issueKey && each.day === day)
        .reduce((sum, each) => sum + each.seconds, 0);
      return { seconds, pushState: seconds > 0 ? ("unpushed" as const) : null };
    });
    return {
      instanceId: 1,
      instanceName: "Work",
      instancePosition: 0,
      issueKey,
      url: "",
      cells,
      seconds: cells.reduce((sum, cell) => sum + cell.seconds, 0),
    };
  });
  const days = WEEK.map((day, index) => {
    const seconds = rows.reduce((sum, row) => sum + (row.cells[index]?.seconds ?? 0), 0);
    return { day, seconds, pushState: seconds > 0 ? ("unpushed" as const) : null };
  });

  return {
    start: WEEK[0],
    end: WEEK[6],
    prevStart: "2026-08-31",
    nextStart: "2026-09-14",
    weekNumber: 37,
    days,
    rows,
    seconds: days.reduce((sum, day) => sum + day.seconds, 0),
  };
}

async function stubServer(page: Page, entries: StubEntry[] = []): Promise<StubServer> {
  const server: StubServer = { running: null, entries, reads: { timer: 0, entries: 0, week: 0 } };

  await page.route("**/api/issues", (route) =>
    route.fulfill({
      status: 200,
      json: {
        instances: [
          {
            id: 1,
            name: "Work",
            error: null,
            issues: [
              { key: "WORK-1", summary: "Fix the export", status: "In Progress", url: "" },
              { key: "WORK-2", summary: "Tidy the backlog", status: "To Do", url: "" },
            ],
          },
        ],
      },
    }),
  );
  await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));
  await page.route("**/api/timer", (route) => {
    server.reads.timer += 1;
    return route.fulfill({ status: 200, json: { running: server.running, stopped: null } });
  });
  await page.route("**/api/entries**", (route) => {
    server.reads.entries += 1;
    return route.fulfill({ status: 200, json: { today: TODAY, entries: server.entries } });
  });
  await page.route("**/api/week**", (route) => {
    server.reads.week += 1;
    return route.fulfill({ status: 200, json: weekOf(server.entries) });
  });

  return server;
}

/** What start_timer and create_entry leave on the server — written from Node, not the page. */
function writeFromOutside(server: StubServer, issueKey: string): void {
  server.running = {
    instanceId: 1,
    instanceName: "Work",
    instancePosition: 0,
    issueKey: "WORK-1",
    startedAt: new Date().toISOString(),
  };
  server.entries = [...server.entries, entry(server.entries.length + 1, issueKey, 1800)];
}

async function setVisibility(page: Page, state: "hidden" | "visible"): Promise<void> {
  await page.evaluate((next) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => next });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

async function dispatchOnWindow(page: Page, type: "blur" | "focus"): Promise<void> {
  await page.evaluate((name) => window.dispatchEvent(new Event(name)), type);
}

const AWAY = {
  "the tab is hidden": {
    leave: (page: Page) => setVisibility(page, "hidden"),
    comeBack: (page: Page) => setVisibility(page, "visible"),
  },
  "the window loses focus": {
    leave: (page: Page) => dispatchOnWindow(page, "blur"),
    comeBack: (page: Page) => dispatchOnWindow(page, "focus"),
  },
} as const;

/** A real round trip: anything an event started has sent its request before this resolves. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => fetch("/api/health").then((response) => response.text()));
}

const railTimer = (page: Page) => page.locator("#rail-timer");
const todayRow = (page: Page, key: string) => page.locator(`that-ticket-row[key="${key}"]`);
const weekRow = (page: Page, key: string) => page.locator("tbody tr", { hasText: key });

for (const [how, away] of Object.entries(AWAY)) {
  test(`Today shows a timer and an entry made outside the tab once it comes back after ${how}`, async ({
    page,
  }) => {
    const server = await stubServer(page);
    await page.goto("/today");
    await expect(todayRow(page, "WORK-2")).toHaveAttribute("seconds", "0");
    await expect(railTimer(page)).toContainText("No timer running");

    await away.leave(page);
    writeFromOutside(server, "WORK-2");
    await settle(page);
    // Still away: nothing may have moved yet, or the return is not what moved it.
    await expect(railTimer(page)).toContainText("No timer running");
    await expect(todayRow(page, "WORK-2")).toHaveAttribute("seconds", "0");

    await away.comeBack(page);

    await expect(railTimer(page)).toContainText("WORK-1");
    await expect(todayRow(page, "WORK-2")).toHaveAttribute("seconds", "1800");
  });

  test(`Week shows an entry made outside the tab once it comes back after ${how}`, async ({ page }) => {
    const server = await stubServer(page, [entry(1, "WORK-1", 3600)]);
    await page.goto("/week");
    await expect(weekRow(page, "WORK-1")).toBeVisible();

    await away.leave(page);
    writeFromOutside(server, "WORK-2");
    await settle(page);
    await expect(weekRow(page, "WORK-2")).toHaveCount(0);

    await away.comeBack(page);

    await expect(weekRow(page, "WORK-2")).toBeVisible();
    await expect(railTimer(page)).toContainText("WORK-1");
  });
}

for (const path of ["/today", "/week"]) {
  test(`a tab on ${path} that stays visible and focused makes no extra reads`, async ({ page }) => {
    const server = await stubServer(page, [entry(1, "WORK-1", 3600)]);
    await page.goto(path);
    await expect(
      path === "/today" ? todayRow(page, "WORK-1") : weekRow(page, "WORK-1"),
    ).toBeVisible();
    await settle(page);
    const before = { ...server.reads };

    // Events a tab that never left still receives: a visibilitychange that
    // changes nothing, a focus with no blur before it, and focus moving
    // between controls inside the page.
    await setVisibility(page, "visible");
    await dispatchOnWindow(page, "focus");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await settle(page);

    expect(server.reads).toEqual(before);
  });
}

test("one return costs one timer read, however many of its events arrive, and the next costs one more", async ({
  page,
}) => {
  const server = await stubServer(page);
  await page.goto("/today");
  await expect(todayRow(page, "WORK-2")).toHaveAttribute("seconds", "0");
  await settle(page);
  const before = server.reads.timer;

  // A real switch away and back delivers all four, as separate tasks.
  await dispatchOnWindow(page, "blur");
  await setVisibility(page, "hidden");
  await setVisibility(page, "visible");
  await dispatchOnWindow(page, "focus");

  await expect.poll(() => server.reads.timer).toBe(before + 1);
  await settle(page);
  expect(server.reads.timer).toBe(before + 1);

  await dispatchOnWindow(page, "blur");
  await dispatchOnWindow(page, "focus");

  await expect.poll(() => server.reads.timer).toBe(before + 2);
  await settle(page);
  expect(server.reads.timer).toBe(before + 2);
});
```

Also create `web/src/tab-return.ts` with only a bare export, so `rail.ts` can import it in Step 3 and nothing else changes yet:

```ts
export function onTabReturn(_handle: () => void): void {}
```

(If `make lint` rejects the unused parameter, name it `handle` and add `void handle;` — it is replaced in Step 3.)

- [ ] **Step 2: Run the spec; it fails on assertions.**

Run the spec with the Global Constraints command.
Expected: the four "shows … once it comes back" tests FAIL on `expect(railTimer(page)).toContainText("WORK-1")` (received "No timer running"); "one return costs one timer read…" FAILS on `expect.poll(...).toBe(before + 1)` (received `before`). The two "stays visible and focused" tests PASS — they are *guards*, proven in Step 5. Quote one red line per failing test, both browsers.

- [ ] **Step 3: Implement.** Replace `web/src/tab-return.ts` with:

```ts
/**
 * Runs `handle` once each time the user comes back to the tab: visible again
 * after it was hidden, or focused again after the window lost focus (#253).
 * Something outside the tab — an MCP client, mostly — may have started a
 * timer or logged time meanwhile, and the server has no way to say so.
 *
 * `away` is the guard. A real return delivers visibilitychange and focus
 * together, and a tab that never left can still receive either; without it
 * the first would cost two reads and the second a read for nothing. Neither
 * listener captures, so focus moving between controls inside the page — which
 * does not bubble to window — never counts as a return.
 */
export function onTabReturn(handle: () => void): void {
  let away = false;
  const back = (): void => {
    if (!away) return;
    away = false;
    handle();
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") away = true;
    else back();
  });
  window.addEventListener("blur", () => {
    away = true;
  });
  window.addEventListener("focus", back);
}
```

In `web/src/rail.ts`, add to the imports:

```ts
import { onTabReturn } from "./tab-return";
```

and directly after the existing `void refreshTimer();` (the line that follows `paintTimer();`):

```ts
  // #253: whatever an MCP client did while the tab was away. Announcing with
  // no payload is what has the rail, Today and Week each re-read for themselves.
  onTabReturn(() => {
    void refreshTimer();
    announceEntriesChanged();
  });
```

Then `docker compose run --rm --no-deps web npx prettier --write src/tab-return.ts src/rail.ts`, `make tsc`, `make lint`.

- [ ] **Step 4: Run the spec; all pass on both browsers.** Then run the suites that already dispatch these events, to show nothing else moved: `npx playwright test tab-return.spec.ts today.spec.ts pwa.spec.ts timer.spec.ts --reporter=line` (same wrapper).

- [ ] **Step 5: Mutations** (one test each, `-g`):
  1. Delete the `onTabReturn(...)` call in `rail.ts` → all four "shows … once it comes back" red on the rail.
  2. Drop `announceEntriesChanged();` from the callback → the Today tests red on `seconds` "1800", the Week tests red on `WORK-2` visible.
  3. Drop `void refreshTimer();` → the rail assertions red; "one return costs one timer read…" red.
  4. Remove `if (!away) return;` → "stays visible and focused" (both paths) red on `reads`, and "one return costs one timer read…" red (`before + 2` at the first poll's settle).
  5. Remove `away = false;` → "one return costs one timer read…" red (two reads for one return).
  6. Remove the `blur` listener → the "window loses focus" tests red and the second return in "one return…" red.
  7. Change the `visibilitychange` handler to ignore `"hidden"` → the "tab is hidden" tests red.
  8. Register the focus listener with `{ capture: true }` and blur likewise → "stays visible and focused" red (tabbing through controls fires them).

- [ ] **Step 6: Commit.**

```bash
git add web/src/tab-return.ts web/src/rail.ts .claude/e2e/tests/tab-return.spec.ts
git commit -m "#253: an open tab re-reads the timer and entries when it comes back

A return to the tab — visible after hidden, or focus after blur — re-reads
the timer and announces that entries changed, so a timer started or time
logged through MCP shows up on Today, Week and the rail without a reload.
One catch-up per return; a tab that never left reads nothing.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QVfih7S1jT93T1csp7GBNf"
```

---

### Task 5: README, the design's API surface, and the full gate

**Files:**
- Modify: `README.md` (new section after "Backing up")
- Modify: `docs/superpowers/specs/2026-08-04-thatapp-design.md` (one line in "API surface", after `GET /api/week…`)

**Interfaces:** none.

- [ ] **Step 1: README.** Append to `README.md`:

````markdown
### Connecting an assistant

ThatApp serves the [Model Context Protocol](https://modelcontextprotocol.io) at `/mcp`, on the same
port as the app. An assistant connected to it can read your assigned issues, your logged time and
the timer, log and edit time, and start and stop the timer. It cannot push: worklogs reach Jira only
from the app's own Push button, and it will not delete an entry that is already in Jira.

To connect Claude Code, using the port you published in step 2:

```shell
claude mcp add --transport http thatapp http://localhost:8080/mcp
```

**The same warning as the port applies.** `/mcp` has no login either: anything that can reach the
port can read and change your logged time through it. It refuses any request a web page sends, but
that is all it does — keep the `127.0.0.1:` in front of the port.

A tab you left open catches up when you switch back to it, so time logged through the assistant
shows without a reload.
````

- [ ] **Step 2: Design of record.** In `docs/superpowers/specs/2026-08-04-thatapp-design.md`, in the "API surface" block, after the `GET     /api/week?start=YYYY-MM-DD       weekly rollup` line, add (aligned like its neighbours):

```
POST    /mcp                             MCP (JSON-RPC); tools over the routes above, no push (#253)
```

- [ ] **Step 3: The full gate.** Run and paste the tail of each:

```shell
make verify
make test-e2e
```

Expected: both green. If `make test-e2e` shows a failure outside `tab-return.spec.ts`, rerun that spec alone once; a second failure is a finding, not a flake — report it.

- [ ] **Step 4: Commit.**

```bash
git add README.md docs/superpowers/specs/2026-08-04-thatapp-design.md
git commit -m "#253: README says how to connect Claude Code to /mcp

With the same no-login warning the port carries, and /mcp in the design's
API surface.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QVfih7S1jT93T1csp7GBNf"
```

---

## Acceptance criteria → tests

| Criterion (#253) | Task | Test(s) |
|---|---|---|
| `POST /mcp` answers `initialize` with name, version and the `tools` capability, negotiating the revision current when built | 1 | `TestMCPInitializeNegotiatesAHandshakeRevision`; `TestMCPDiscoverNamesTheCurrentRevisionFirst` (2026-07-28 first); `TestMCPUnsupportedVersionNamesWhatIsSupported` |
| `tools/list` returns exactly the ten tools, each with a description and a JSON Schema | 2 | `TestMCPToolsListIsExactlyTheTen` |
| Each `tools/call` reaches its `/api/*` handler and returns its JSON body; 4xx/5xx → `isError: true` with the API's message, never a protocol error | 2 | `TestMCPToolsReachTheirRoutes`, `TestMCPReadToolsAnswerWithTheHandlersBody`, `TestMCPWriteToolsReachTheirHandlers`, `TestMCPToolFailuresComeBackAsToolErrors`, `TestMCPToolArgumentsOfTheWrongTypeAreToolErrors`, `TestMCPServerFailureIsAToolError` |
| No tool pushes, fetches the week from Jira, or touches instances or pins; any other name is a JSON-RPC error | 2 | `TestMCPToolsReachTheirRoutes` (every tool's route, exhaustively), `TestMCPToolsListIsExactlyTheTen`, `TestMCPUnknownToolIsAProtocolError`, `TestMCPDeleteEntryNeverReachesJira` |
| `create_entry` near midnight UTC lands on the `THAT_TIMEZONE` day — table-driven, refactor-proof | 3 | `TestMCPCreateEntryLandsOnTheConfiguredZonesDay` (also `TestMCPReadToolsAnswerWithTheHandlersBody`'s defaults) |
| No tool can set push state: `update_entry` after a push reads dirty, exactly as the API | 3 | `TestMCPEditAfterAPushReadsDirtyExactlyAsTheAPIDoes` |
| Any `Origin` → `403`, reaching no handler | 1, 2 | `TestMCPRefusesARequestCarryingAnyOrigin`, `TestMCPOriginReachesNoHandler` |
| `GET /mcp` → `405`; notification → `202` no body; malformed JSON and unknown method → the specification's codes | 1 | `TestMCPTransport` (GET/DELETE, notifications, `-32700`, `-32600`, `-32601` in both eras, `-32602`, `-32020`, `-32022`) |
| Tests run against the handlers with `httptest`; no test contacts real Jira | 1–3 | all of the above: `httptest` recorders; servers with no instance, an uncalled instance URL, or `newEntriesEnv`'s fake |
| Each new or changed assertion proven by mutation | 1–4 | each task's Mutations step |
| With Today open, a timer started and an entry created outside the tab appear in the rail and Today on return, without reload; same for Week | 4 | `tab-return.spec.ts`: "Today shows a timer and an entry made outside the tab…" ×2, "Week shows an entry made outside the tab…" ×2 |
| A tab that stays visible and focused makes no extra reads | 4 | "a tab on /today … makes no extra reads", "a tab on /week …", "one return costs one timer read…" |
| README says how to connect Claude Code, with the port's no-login warning | 5 | README review (Step 1) |
| `make verify` is green | 5 | Step 3 output |
