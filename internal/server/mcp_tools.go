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
	noArguments   = `{"type":"object","additionalProperties":false}`
	dayProperty   = `{"type":"string","format":"date","description":"YYYY-MM-DD, in the server's timezone (THAT_TIMEZONE)."}`
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
			"state: unpushed (not in Jira yet), pushed, dirty (edited since its push), or deleted " +
			"(its Jira worklog is deleted at the user's next push; it counts in no total and can be " +
			"restored in the app until then). Dates are YYYY-MM-DD in the server's timezone " +
			"(THAT_TIMEZONE), and both default to today there; the response's today field names that date.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{"from":` + dayProperty +
			`,"to":` + dayProperty + `},"additionalProperties":false}`),
		request: queryRequest("/api/entries", "from", "to"),
	},
	{
		Name: "get_week",
		Description: "A Monday-to-Sunday rollup of logged time: per issue per day, with day totals and " +
			"each cell's push state. Entries waiting to be deleted count in no total. start must be a " +
			"Monday, YYYY-MM-DD; it defaults to this week's Monday in the server's timezone (THAT_TIMEZONE).",
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
		Description: "Delete an entry. One not yet in Jira is removed at once. One that has reached Jira " +
			"(pushed or dirty) is marked deleted: its Jira worklog is deleted at the user's next push, " +
			"and the user can restore it in the app until then. Nothing is written to Jira by this tool.",
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
