package jira

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
)

type issueResponse struct {
	Key    string `json:"key"`
	Fields struct {
		Summary string `json:"summary"`
		Status  struct {
			Name string `json:"name"`
		} `json:"status"`
	} `json:"fields"`
}

// Issue returns one issue by key. A key that does not exist on this site is
// ErrNotFound, which the caller reads as an ordinary answer rather than a fault.
func (c *Client) Issue(ctx context.Context, key string) (*Issue, error) {
	query := url.Values{"fields": {"summary,status"}}

	var resp issueResponse
	path := "/rest/api/3/issue/" + url.PathEscape(key)
	if err := c.do(ctx, http.MethodGet, path, query, nil, &resp); err != nil {
		return nil, fmt.Errorf("reading issue %q: %w", key, err)
	}

	return &Issue{
		Key:     resp.Key,
		Summary: resp.Fields.Summary,
		Status:  resp.Fields.Status.Name,
	}, nil
}
