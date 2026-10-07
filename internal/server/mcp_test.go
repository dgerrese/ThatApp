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
		{
			name: "GET is not served", method: http.MethodGet,
			wantStatus: http.StatusMethodNotAllowed, wantCode: rpcInvalidRequest, wantAllow: "POST", wantNullID: true,
		},
		{
			name: "DELETE is not served", method: http.MethodDelete,
			wantStatus: http.StatusMethodNotAllowed, wantCode: rpcInvalidRequest, wantAllow: "POST", wantNullID: true,
		},
		{
			name: "a notification is accepted with no body", method: http.MethodPost,
			body: `{"jsonrpc":"2.0","method":"notifications/initialized"}`, wantStatus: http.StatusAccepted,
		},
		{
			name: "any notification is accepted", method: http.MethodPost,
			body:       `{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":3}}`,
			wantStatus: http.StatusAccepted,
		},
		{
			name: "malformed JSON is a parse error with a null id", method: http.MethodPost,
			body: `{"jsonrpc":`, wantStatus: http.StatusBadRequest, wantCode: rpcParseError, wantNullID: true,
		},
		{
			name: "a body over the cap is a parse error", method: http.MethodPost,
			body:       `{"jsonrpc":"2.0","id":1,"method":"ping","pad":"` + strings.Repeat("x", mcpMaxBody) + `"}`,
			wantStatus: http.StatusBadRequest, wantCode: rpcParseError, wantNullID: true,
		},
		{
			name: "a batch is an invalid request", method: http.MethodPost,
			body: `[` + ping + `]`, wantStatus: http.StatusBadRequest, wantCode: rpcInvalidRequest, wantNullID: true,
		},
		{
			name: "a jsonrpc other than 2.0 is an invalid request", method: http.MethodPost,
			body: `{"jsonrpc":"1.0","id":1,"method":"ping"}`, wantStatus: http.StatusBadRequest, wantCode: rpcInvalidRequest,
		},
		{
			name: "an id without a method is an invalid request", method: http.MethodPost,
			body: `{"jsonrpc":"2.0","id":1}`, wantStatus: http.StatusBadRequest, wantCode: rpcInvalidRequest,
		},
		{
			name: "a null id is an invalid request", method: http.MethodPost,
			body: `{"jsonrpc":"2.0","id":null,"method":"ping"}`, wantStatus: http.StatusBadRequest,
			wantCode: rpcInvalidRequest, wantNullID: true,
		},
		{
			name: "params that are not an object are invalid params", method: http.MethodPost,
			body: `{"jsonrpc":"2.0","id":1,"method":"ping","params":[1]}`, wantStatus: http.StatusOK,
			wantCode: rpcInvalidParams,
		},
		{name: "ping answers a result", method: http.MethodPost, body: ping, wantStatus: http.StatusOK},
		{
			name: "a handshake-era request under a known version header", method: http.MethodPost, body: ping,
			headers: map[string]string{"MCP-Protocol-Version": "2025-06-18"}, wantStatus: http.StatusOK,
		},
		{
			name: "a handshake-era request under an unknown version header", method: http.MethodPost, body: ping,
			headers:    map[string]string{"MCP-Protocol-Version": "1999-01-01"},
			wantStatus: http.StatusBadRequest, wantCode: rpcInvalidRequest,
		},
		{
			name: "an unknown method, handshake era, is 200 and method-not-found", method: http.MethodPost,
			body: `{"jsonrpc":"2.0","id":1,"method":"resources/list"}`, wantStatus: http.StatusOK,
			wantCode: rpcMethodNotFound,
		},
		{
			name: "an unknown method, 2026-07-28, is 404 and method-not-found", method: http.MethodPost,
			body: modernBody("resources/list", mcpVersion, ""), headers: modernHeaders("resources/list"),
			wantStatus: http.StatusNotFound, wantCode: rpcMethodNotFound,
		},
		{
			name: "server/discover, 2026-07-28", method: http.MethodPost,
			body: modernBody("server/discover", mcpVersion, ""), headers: modernHeaders("server/discover"),
			wantStatus: http.StatusOK,
		},
		{
			name: "2026-07-28 without the version header", method: http.MethodPost,
			body:       modernBody("server/discover", mcpVersion, ""),
			headers:    map[string]string{"Mcp-Method": "server/discover"},
			wantStatus: http.StatusBadRequest, wantCode: mcpHeaderMismatch,
		},
		{
			name: "2026-07-28 with a version header that disagrees", method: http.MethodPost,
			body:       modernBody("server/discover", mcpVersion, ""),
			headers:    map[string]string{"MCP-Protocol-Version": "2025-11-25", "Mcp-Method": "server/discover"},
			wantStatus: http.StatusBadRequest, wantCode: mcpHeaderMismatch,
		},
		{
			name: "2026-07-28 without Mcp-Method", method: http.MethodPost,
			body:       modernBody("server/discover", mcpVersion, ""),
			headers:    map[string]string{"MCP-Protocol-Version": mcpVersion},
			wantStatus: http.StatusBadRequest, wantCode: mcpHeaderMismatch,
		},
		{
			name: "2026-07-28 with an Mcp-Method that disagrees", method: http.MethodPost,
			body: modernBody("server/discover", mcpVersion, ""), headers: modernHeaders("tools/list"),
			wantStatus: http.StatusBadRequest, wantCode: mcpHeaderMismatch,
		},
		{
			name: "a _meta version this server does not speak", method: http.MethodPost,
			body:       modernBody("server/discover", "2099-01-01", ""),
			headers:    map[string]string{"MCP-Protocol-Version": "2099-01-01", "Mcp-Method": "server/discover"},
			wantStatus: http.StatusBadRequest, wantCode: mcpUnsupportedVersion,
		},
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
