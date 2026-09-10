package jira

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strings"
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

// escapeJQL makes a user's text safe inside a JQL string literal. Backslashes
// go first: escaping them after the quotes would escape the backslashes this
// function just added.
func escapeJQL(query string) string {
	escaped := strings.ReplaceAll(query, `\`, `\\`)

	return strings.ReplaceAll(escaped, `"`, `\"`)
}

// stripTrailingWildcard drops any `*` a user already typed at the end of their
// query. SearchText appends its own trailing `*` to build a prefix match, and
// the right-hand side of JQL's `~` is Lucene syntax: a query of "secur*" left
// alone would double-wildcard into "secur**", which Jira answers with a 400.
func stripTrailingWildcard(query string) string {
	return strings.TrimRight(query, "*")
}

// issueKeyPattern is a Jira issue key, which `key = ` demands exactly: a
// project code, a hyphen, and a number. Anything else in that clause is a 400
// from Jira rather than an empty result, so a query that is not a key does not
// get the clause at all.
var issueKeyPattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]*-[0-9]+$`)

// SearchText finds issues whose key exactly matches query or whose summary
// starts a word with it, most recently updated first, regardless of status —
// unlike SearchAssigned, this is used to find one specific issue, including
// finished work.
//
// Three properties of Jira's ~ operator shape the summary term and cannot be
// worked around here: it matches word prefixes rather than substrings, a
// leading wildcard is rejected by the endpoint outright, and the * belongs
// inside the quotes. So "secur" finds "security" and "curity" finds nothing.
//
// Unlike SearchAssigned this does not page: it backs a type-ahead, where a
// second page is latency spent on results nobody scrolls to.
func (c *Client) SearchText(ctx context.Context, query string, limit int) ([]Issue, error) {
	summaryTerm := fmt.Sprintf(`summary ~ "%s*"`, escapeJQL(stripTrailingWildcard(query)))

	jql := summaryTerm + " ORDER BY updated DESC"
	if issueKeyPattern.MatchString(query) {
		jql = fmt.Sprintf(`(key = "%s" OR %s) ORDER BY updated DESC`, escapeJQL(query), summaryTerm)
	}

	body := searchRequest{
		JQL:        jql,
		Fields:     []string{"summary", "status"},
		MaxResults: limit,
	}

	var resp searchResponse
	if err := c.do(ctx, http.MethodPost, "/rest/api/3/search/jql", nil, body, &resp); err != nil {
		return nil, fmt.Errorf("searching for %q: %w", query, err)
	}

	issues := []Issue{}
	for _, raw := range resp.Issues {
		issues = append(issues, Issue{
			Key:     raw.Key,
			Summary: raw.Fields.Summary,
			Status:  raw.Fields.Status.Name,
		})
	}

	return issues, nil
}
