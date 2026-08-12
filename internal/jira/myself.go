package jira

import (
	"context"
	"fmt"
	"net/http"
)

// User is the account Jira resolves the configured credentials to.
type User struct {
	AccountID   string `json:"accountId"`
	DisplayName string `json:"displayName"`
	Active      bool   `json:"active"`
}

// Myself returns the account the credentials authenticate as.
//
// This is the only call that proves credentials work. A search answers an
// unauthenticated caller with 200 and an empty issue list rather than a 401, so
// a connection test built on one passes against credentials Jira has rejected.
func (c *Client) Myself(ctx context.Context) (*User, error) {
	var user User
	if err := c.do(ctx, http.MethodGet, "/rest/api/3/myself", nil, nil, &user); err != nil {
		return nil, fmt.Errorf("reading the authenticated account: %w", err)
	}
	// Identity is the whole point of the call: a 200 carrying no account is no
	// more proof than the empty search this call exists to replace.
	if user.AccountID == "" {
		return nil, fmt.Errorf("reading the authenticated account: response carried no accountId")
	}

	return &user, nil
}
