package jira_test

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestIssuesWithWorklogsBetween(t *testing.T) {
	var seenJQL string

	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			JQL           string `json:"jql"`
			NextPageToken string `json:"nextPageToken"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decoding the search body: %v", err)
		}
		seenJQL = body.JQL

		if body.NextPageToken == "" {
			_, _ = w.Write([]byte(`{"issues":[{"key":"RID-1"}],"nextPageToken":"p2"}`))
			return
		}
		_, _ = w.Write([]byte(`{"issues":[{"key":"NW-9"}]}`))
	})

	keys, err := client.IssuesWithWorklogsBetween(t.Context(), "2026-08-30", "2026-09-07")
	if err != nil {
		t.Fatalf("searching: %v", err)
	}

	if len(keys) != 2 || keys[0] != "RID-1" || keys[1] != "NW-9" {
		t.Fatalf("keys = %v, want [RID-1 NW-9]: both pages must be read", keys)
	}
	for _, want := range []string{
		"worklogAuthor = currentUser()",
		`worklogDate >= "2026-08-30"`,
		`worklogDate <= "2026-09-07"`,
	} {
		if !strings.Contains(seenJQL, want) {
			t.Fatalf("jql = %q, want it to contain %q", seenJQL, want)
		}
	}
}

func TestIssueWorklogs(t *testing.T) {
	var query url.Values

	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		query = r.URL.Query()
		_, _ = w.Write([]byte(`{
			"startAt": 0, "maxResults": 1000, "total": 2,
			"worklogs": [
				{
					"id": "10001",
					"author": {"accountId": "acc-1"},
					"started": "2026-09-01T09:00:00.000+0200",
					"timeSpentSeconds": 3600,
					"updated": "2026-09-01T09:05:00.000+0200",
					"comment": {"type":"doc","version":1,"content":[
						{"type":"paragraph","content":[
							{"type":"text","text":"wrote "},
							{"type":"text","text":"the thing"}
						]}
					]}
				},
				{
					"id": "10002",
					"author": {"accountId": "acc-2"},
					"started": "2026-09-01T13:00:00.000+0200",
					"timeSpentSeconds": 1800,
					"updated": "2026-09-01T13:01:00.000+0200"
				}
			]
		}`))
	})

	after := time.Date(2026, 8, 30, 0, 0, 0, 0, time.UTC)
	before := time.Date(2026, 9, 8, 0, 0, 0, 0, time.UTC)

	logs, err := client.IssueWorklogs(t.Context(), "RID-1", after, before)
	if err != nil {
		t.Fatalf("reading worklogs: %v", err)
	}

	if len(logs) != 2 {
		t.Fatalf("got %d worklogs, want 2: filtering by author is the caller's job", len(logs))
	}
	if logs[0].IssueKey != "RID-1" {
		t.Fatalf("issue key = %q, want RID-1 stamped from the argument", logs[0].IssueKey)
	}
	if logs[0].AuthorID != "acc-1" {
		t.Fatalf("author = %q, want acc-1", logs[0].AuthorID)
	}
	if logs[0].Comment != "wrote the thing" {
		t.Fatalf("comment = %q, want the document flattened to text", logs[0].Comment)
	}
	if logs[1].Comment != "" {
		t.Fatalf("comment = %q, want empty for a worklog carrying none", logs[1].Comment)
	}
	if got := logs[0].Started.UTC().Format(time.RFC3339); got != "2026-09-01T07:00:00Z" {
		t.Fatalf("started = %s, want the offset honoured", got)
	}

	if got := query.Get("startedAfter"); got != strconv.FormatInt(after.UnixMilli(), 10) {
		t.Fatalf("startedAfter = %q, want %d in epoch milliseconds", got, after.UnixMilli())
	}
	if got := query.Get("startedBefore"); got != strconv.FormatInt(before.UnixMilli(), 10) {
		t.Fatalf("startedBefore = %q, want %d in epoch milliseconds", got, before.UnixMilli())
	}
}

func TestIssueWorklogsRefusesATruncatedPage(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"startAt":0,"maxResults":1,"total":9,"worklogs":[
			{"id":"1","author":{"accountId":"a"},"started":"2026-09-01T09:00:00.000+0000",
			 "timeSpentSeconds":60,"updated":"2026-09-01T09:00:00.000+0000"}
		]}`))
	})

	_, err := client.IssueWorklogs(t.Context(), "RID-1", time.Now().Add(-time.Hour), time.Now())
	if err == nil {
		t.Fatal("a truncated page was accepted; want an error rather than silently lost time")
	}
}
