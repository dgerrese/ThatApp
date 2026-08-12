package jira

import (
	"context"
	"fmt"
	"net/http"
)

// assignedJQL is deliberately bounded — /rest/api/3/search/jql rejects unbounded
// queries — and ordered so the most recently touched work surfaces first.
const assignedJQL = `assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC`

// searchPageSize is the number of issues requested per page.
const searchPageSize = 100

// maxSearchPages bounds the paging loop. Jira signals the end by omitting
// nextPageToken, but a misbehaving or looping server must not hang the fan-out.
const maxSearchPages = 100

// Issue is the subset of a Jira issue this app renders.
type Issue struct {
	Key     string
	Summary string
	Status  string
}

type searchRequest struct {
	JQL           string   `json:"jql"`
	Fields        []string `json:"fields"`
	MaxResults    int      `json:"maxResults"`
	NextPageToken string   `json:"nextPageToken,omitempty"`
}

type searchResponse struct {
	Issues []struct {
		Key    string `json:"key"`
		Fields struct {
			Summary string `json:"summary"`
			Status  struct {
				Name string `json:"name"`
			} `json:"status"`
		} `json:"fields"`
	} `json:"issues"`
	// Absent on the last page, which is how the end of the results is signalled.
	NextPageToken string `json:"nextPageToken"`
}

// SearchAssigned returns the issues assigned to the authenticated user that are
// not in a Done status category, most recently updated first.
func (c *Client) SearchAssigned(ctx context.Context) ([]Issue, error) {
	issues := []Issue{}
	token := ""

	for range maxSearchPages {
		body := searchRequest{
			JQL: assignedJQL,
			// Naming fields is not optional: with none named the endpoint returns
			// ids only and every summary would render blank.
			Fields:        []string{"summary", "status"},
			MaxResults:    searchPageSize,
			NextPageToken: token,
		}

		var resp searchResponse
		if err := c.do(ctx, http.MethodPost, "/rest/api/3/search/jql", nil, body, &resp); err != nil {
			return nil, fmt.Errorf("searching assigned issues: %w", err)
		}

		for _, raw := range resp.Issues {
			issues = append(issues, Issue{
				Key:     raw.Key,
				Summary: raw.Fields.Summary,
				Status:  raw.Fields.Status.Name,
			})
		}

		if resp.NextPageToken == "" {
			return issues, nil
		}
		if resp.NextPageToken == token {
			return nil, fmt.Errorf("searching assigned issues: nextPageToken %q repeated; refusing to loop", token)
		}
		token = resp.NextPageToken
	}

	return nil, fmt.Errorf("searching assigned issues: stopped after %d pages", maxSearchPages)
}
