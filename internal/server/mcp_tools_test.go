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
		{
			"a duration over a day", "create_entry",
			`{"instanceId":` + instanceID + `,"issueKey":"RIDGE-1","seconds":86401}`, "seconds must be between 1 and 86400",
		},
		{
			"an impossible day", "create_entry",
			`{"instanceId":` + instanceID + `,"issueKey":"RIDGE-1","day":"2026-02-30","seconds":900}`,
			"day must be a date of the form YYYY-MM-DD",
		},
		{"arguments that are not an object", "create_entry", `[1]`, "the request body is not valid JSON"},
		{"a missing entry", "update_entry", `{"id":999,"seconds":900}`, "no such entry"},
		{"no id at all", "delete_entry", `{}`, "no such entry"},
		{"a stop without a rounding", "stop_timer", `{}`, `round must be "up" or "down"`},
		{
			"a week that does not start on a Monday", "get_week", `{"start":"2026-08-25"}`,
			"start must be a Monday, of the form YYYY-MM-DD",
		},
		{
			"a range the wrong way round", "list_entries", `{"from":"2026-08-31","to":"2026-08-01"}`,
			"from must not be after to",
		},
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
		name                string
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
		{
			"named through the base64 sentinel",
			"=?base64?" + base64.StdEncoding.EncodeToString([]byte("get_timer")) + "?=", http.StatusOK, 0,
		},
		{"naming a different tool", "list_issues", http.StatusBadRequest, mcpHeaderMismatch},
		{"not named", "", http.StatusBadRequest, mcpHeaderMismatch},
		{"a sentinel that does not decode", "=?base64?Z2V0X3RpbWVy!?=", http.StatusBadRequest, mcpHeaderMismatch},
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

// An entry's day and list_entries' default both come from the handler's clock
// in THAT_TIMEZONE; 13:00 UTC is already the next morning in Auckland.
func TestMCPListEntriesDefaultsToTheHandlersToday(t *testing.T) {
	srv, _, inst := serverInZone(t, "Pacific/Auckland", time.Date(2026, 8, 23, 13, 0, 0, 0, time.UTC))
	callTool(t, srv, "create_entry",
		`{"instanceId":`+strconv.FormatInt(inst.ID, 10)+`,"issueKey":"RIDGE-9","seconds":900}`)

	got := callTool(t, srv, "list_entries", `{}`)

	if got.IsError || !strings.Contains(got.text(), `"issueKey":"RIDGE-9"`) {
		t.Errorf("isError %v, text %s; want today's entry, RIDGE-9", got.IsError, got.text())
	}
}

// A closed store is the least contrived read error the helpers allow. Failing
// open would send the DELETE on, and the handler's own message would differ.
func TestMCPDeleteEntryFailsClosedWhenTheEntryCannotBeRead(t *testing.T) {
	env := newEntriesEnv(t)
	entry := env.createEntry(t, "RIDGE-1", 900, "")
	env.markPushed(t, entry.ID, "wl-1")
	_ = env.store.Close()

	got := callTool(t, env.s, "delete_entry", `{"id":`+strconv.FormatInt(entry.ID, 10)+`}`)

	if !got.IsError || got.text() != "could not read the entry, so it was not deleted" {
		t.Errorf("isError %v, text %q; want the guard's own tool error", got.IsError, got.text())
	}
	if env.jira.deleteCalls != 0 {
		t.Errorf("Jira saw %d worklog deletes, want none", env.jira.deleteCalls)
	}
}
