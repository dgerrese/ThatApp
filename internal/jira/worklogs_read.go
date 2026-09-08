package jira

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// worklogPageSize is deliberately far above a week's worth of one person's time
// on one issue. The endpoint pages and this client does not — see IssueWorklogs.
const worklogPageSize = 1000

// RemoteWorklog is one worklog as Jira holds it. IssueKey is stamped by the
// caller rather than read from the response, which does not repeat it, and
// Comment is the flattened text of an ADF document.
type RemoteWorklog struct {
	ID       string
	IssueKey string
	AuthorID string
	Started  time.Time
	Seconds  int64
	Comment  string
	Updated  time.Time
}

// IssuesWithWorklogsBetween returns the keys of issues the authenticated user
// logged time against between two dates, inclusive.
//
// Worklogs hang off issues and Jira has no endpoint for "my worklogs in a
// range", so the issue set has to be found before any worklog can be read.
//
// The dates are the caller's and worklogDate resolves against the Jira server's
// timezone rather than the user's, which is why the caller asks for a day either
// side of the week it wants and filters on the real start afterwards.
//
// Known limit, accepted in the design: where one issue holds more than 100
// worklog entries, JQL's worklog functions only consider the 100 most recent, so
// such an issue can be missed here. The per-issue read below is unaffected.
func (c *Client) IssuesWithWorklogsBetween(ctx context.Context, from, to string) ([]string, error) {
	jql := fmt.Sprintf(
		`worklogAuthor = currentUser() AND worklogDate >= "%s" AND worklogDate <= "%s" `+
			`ORDER BY updated DESC`,
		escapeJQL(from), escapeJQL(to),
	)

	keys := []string{}
	token := ""

	for range maxSearchPages {
		body := searchRequest{
			JQL: jql,
			// Naming a field is not optional even though only keys are wanted:
			// with none named the endpoint returns ids, and an id is not a key.
			Fields:        []string{"summary"},
			MaxResults:    searchPageSize,
			NextPageToken: token,
		}

		var resp searchResponse
		if err := c.do(ctx, http.MethodPost, "/rest/api/3/search/jql", nil, body, &resp); err != nil {
			return nil, fmt.Errorf("searching issues with worklogs from %s to %s: %w", from, to, err)
		}

		for _, raw := range resp.Issues {
			keys = append(keys, raw.Key)
		}

		if resp.NextPageToken == "" {
			return keys, nil
		}
		if resp.NextPageToken == token {
			return nil, fmt.Errorf(
				"searching issues with worklogs: nextPageToken %q repeated; refusing to loop", token)
		}
		token = resp.NextPageToken
	}

	return nil, fmt.Errorf("searching issues with worklogs: stopped after %d pages", maxSearchPages)
}

type worklogListResponse struct {
	StartAt    int `json:"startAt"`
	MaxResults int `json:"maxResults"`
	Total      int `json:"total"`
	Worklogs   []struct {
		ID     string `json:"id"`
		Author struct {
			AccountID string `json:"accountId"`
		} `json:"author"`
		Started          string   `json:"started"`
		TimeSpentSeconds int64    `json:"timeSpentSeconds"`
		Updated          string   `json:"updated"`
		Comment          *adfNode `json:"comment"`
	} `json:"worklogs"`
}

// IssueWorklogs reads one issue's worklogs whose start falls inside a window.
//
// Every worklog on the issue comes back, not only the caller's: whose account
// this client authenticates as is not its business, and the caller filters.
//
// It reads one page and refuses a truncated one. The window is narrowed
// server-side, so a week of one person's time on one issue does not page — and
// returning the first page of a longer response would lose time silently.
func (c *Client) IssueWorklogs(
	ctx context.Context, issueKey string, after, before time.Time,
) ([]RemoteWorklog, error) {
	query := url.Values{
		"startedAfter":  {strconv.FormatInt(after.UnixMilli(), 10)},
		"startedBefore": {strconv.FormatInt(before.UnixMilli(), 10)},
		"maxResults":    {strconv.Itoa(worklogPageSize)},
	}

	var resp worklogListResponse
	path := fmt.Sprintf("/rest/api/3/issue/%s/worklog", url.PathEscape(issueKey))
	if err := c.do(ctx, http.MethodGet, path, query, nil, &resp); err != nil {
		return nil, fmt.Errorf("reading worklogs on %s: %w", issueKey, err)
	}

	if resp.Total > len(resp.Worklogs) {
		return nil, fmt.Errorf(
			"reading worklogs on %s: %d of %d returned; refusing to report a partial week",
			issueKey, len(resp.Worklogs), resp.Total)
	}

	logs := make([]RemoteWorklog, 0, len(resp.Worklogs))
	for _, raw := range resp.Worklogs {
		started, err := time.Parse(startedLayout, raw.Started)
		if err != nil {
			return nil, fmt.Errorf("parsing start %q of worklog %s on %s: %w",
				raw.Started, raw.ID, issueKey, err)
		}
		updated, err := time.Parse(startedLayout, raw.Updated)
		if err != nil {
			return nil, fmt.Errorf("parsing update time %q of worklog %s on %s: %w",
				raw.Updated, raw.ID, issueKey, err)
		}

		comment := ""
		if raw.Comment != nil {
			comment = adfText(*raw.Comment)
		}

		logs = append(logs, RemoteWorklog{
			ID:       raw.ID,
			IssueKey: issueKey,
			AuthorID: raw.Author.AccountID,
			Started:  started,
			Seconds:  raw.TimeSpentSeconds,
			Comment:  comment,
			Updated:  updated,
		})
	}

	return logs, nil
}
