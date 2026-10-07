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

	result, failure := s.mcpResult(r, req.Method, params)
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
func (s *Server) mcpResult(r *http.Request, method string, params mcpParams) (any, *rpcError) {
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
