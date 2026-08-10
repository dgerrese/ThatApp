package jira

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

// startedLayout is Jira's required timestamp format. The offset carries no
// colon, which is the one thing time.RFC3339 gets wrong here: it produces
// +02:00 and Jira rejects it.
const startedLayout = "2006-01-02T15:04:05.000-0700"

// Worklog is one block of logged time, mapping one-to-one onto a Jira worklog.
type Worklog struct {
	IssueKey string
	Started  time.Time
	Seconds  int64
	Comment  string
}

func (w Worklog) validate() error {
	if w.IssueKey == "" {
		return fmt.Errorf("worklog needs an issue key")
	}
	if w.Seconds <= 0 {
		return fmt.Errorf("worklog for %s has %d seconds, want a positive duration", w.IssueKey, w.Seconds)
	}
	if w.Started.IsZero() {
		return fmt.Errorf("worklog for %s has no start time, which Jira requires", w.IssueKey)
	}

	return nil
}

type worklogRequest struct {
	// timeSpent is deliberately absent: Jira rejects a body carrying both it and
	// timeSpentSeconds.
	TimeSpentSeconds int64    `json:"timeSpentSeconds"`
	Started          string   `json:"started"`
	Comment          *adfNode `json:"comment,omitempty"`
}

func (w Worklog) request() worklogRequest {
	req := worklogRequest{
		TimeSpentSeconds: w.Seconds,
		Started:          w.Started.Format(startedLayout),
	}
	if w.Comment != "" {
		doc := adfParagraph(w.Comment)
		req.Comment = &doc
	}

	return req
}

// worklogWriteQuery is sent on create and update. adjustEstimate=auto makes the
// remaining estimate fall by the time logged, matching what the Jira UI does.
// notifyUsers=false keeps an end-of-day push of a dozen entries from emailing
// every watcher a dozen times.
func worklogWriteQuery() url.Values {
	return url.Values{
		"adjustEstimate": {"auto"},
		"notifyUsers":    {"false"},
	}
}

// CreateWorklog logs time against an issue and returns the new worklog's ID,
// which the caller stores so the entry can later be updated or deleted.
func (c *Client) CreateWorklog(ctx context.Context, w Worklog) (string, error) {
	if err := w.validate(); err != nil {
		return "", err
	}

	var resp struct {
		ID string `json:"id"`
	}
	path := fmt.Sprintf("/rest/api/3/issue/%s/worklog", url.PathEscape(w.IssueKey))
	if err := c.do(ctx, http.MethodPost, path, worklogWriteQuery(), w.request(), &resp); err != nil {
		return "", fmt.Errorf("creating worklog on %s: %w", w.IssueKey, err)
	}
	if resp.ID == "" {
		return "", fmt.Errorf("creating worklog on %s: Jira returned no worklog id", w.IssueKey)
	}

	return resp.ID, nil
}

// UpdateWorklog overwrites an already-pushed worklog in place.
func (c *Client) UpdateWorklog(ctx context.Context, id string, w Worklog) error {
	if err := w.validate(); err != nil {
		return err
	}
	if id == "" {
		return fmt.Errorf("updating worklog on %s: no worklog id", w.IssueKey)
	}

	path := fmt.Sprintf("/rest/api/3/issue/%s/worklog/%s", url.PathEscape(w.IssueKey), url.PathEscape(id))
	if err := c.do(ctx, http.MethodPut, path, worklogWriteQuery(), w.request(), nil); err != nil {
		return fmt.Errorf("updating worklog %s on %s: %w", id, w.IssueKey, err)
	}

	return nil
}

// DeleteWorklog removes a worklog from Jira. The caller removes its local row
// only once this returns nil.
func (c *Client) DeleteWorklog(ctx context.Context, issueKey, id string) error {
	if issueKey == "" || id == "" {
		return fmt.Errorf("deleting worklog: issue key and worklog id are both required")
	}

	path := fmt.Sprintf("/rest/api/3/issue/%s/worklog/%s", url.PathEscape(issueKey), url.PathEscape(id))
	if err := c.do(ctx, http.MethodDelete, path, nil, nil, nil); err != nil {
		return fmt.Errorf("deleting worklog %s on %s: %w", id, issueKey, err)
	}

	return nil
}
