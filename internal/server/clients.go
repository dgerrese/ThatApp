package server

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"codeberg.org/DionGerrese/ThatApp/internal/atlassian"
	"codeberg.org/DionGerrese/ThatApp/internal/crypto"
	"codeberg.org/DionGerrese/ThatApp/internal/jira"
	"codeberg.org/DionGerrese/ThatApp/internal/store"
)

// tenantInfoTimeout bounds the tenant-info lookup made against a host the user
// just typed in. jira.Client sets its own 30s requestTimeout independently;
// this client never talks to jira.Client's target, only to the Atlassian
// gateway's tenant-info endpoint.
const tenantInfoTimeout = 10 * time.Second

// instanceClients builds a Jira client for a stored instance: unseal the token,
// resolve the API base if the row has none, hand both to jira.New.
//
// Tickets 5 through 10 all need this sequence, which is why it is a type rather
// than a helper inside one handler.
type instanceClients struct {
	db     *store.Store
	sealer *crypto.Sealer
	// http serves tenant-info lookups only, bounded by tenantInfoTimeout. Jira
	// calls go through jira.Client, which owns its own separate timeout.
	http *http.Client
	// apiBaseFor turns a cloud id into a base URL. It is a field rather than a
	// direct call so a test can point it at an httptest.Server; production always
	// gets atlassian.APIBaseURL from the constructor.
	apiBaseFor func(cloudID string) string
}

func newInstanceClients(db *store.Store, sealer *crypto.Sealer) *instanceClients {
	return &instanceClients{
		db:         db,
		sealer:     sealer,
		http:       &http.Client{Timeout: tenantInfoTimeout},
		apiBaseFor: atlassian.APIBaseURL,
	}
}

// forInstance returns a client for a stored site, resolving and persisting the
// API base when the row lacks one.
//
// A row lacking one is a migrated row: creating an instance resolves its cloud
// id up front, because the save-time identity check cannot run without it.
func (c *instanceClients) forInstance(
	ctx context.Context, inst *store.Instance,
) (*jira.Client, error) {
	token, err := c.sealer.Open(inst.TokenEnc)
	if err != nil {
		return nil, fmt.Errorf("opening the token for instance %d: %w", inst.ID, err)
	}

	apiBase := inst.APIBaseURL
	if apiBase == "" {
		apiBase, err = c.apiBaseForSite(ctx, inst.SiteURL)
		if err != nil {
			return nil, err
		}
		if err := c.db.SetInstanceAPIBase(ctx, inst.ID, apiBase); err != nil {
			return nil, fmt.Errorf("persisting the API base for instance %d: %w", inst.ID, err)
		}
		inst.APIBaseURL = apiBase
	}

	client, err := jira.New(apiBase, inst.Email, token)
	if err != nil {
		return nil, fmt.Errorf("building a client for instance %d: %w", inst.ID, err)
	}

	return client, nil
}

// apiBaseForSite resolves a site URL to its gateway base. The create path uses
// it before any row exists.
func (c *instanceClients) apiBaseForSite(ctx context.Context, siteURL string) (string, error) {
	if siteURL == "" {
		return "", fmt.Errorf("cannot resolve an API base: %w", store.ErrInstanceNeedsURL)
	}

	cloudID, err := atlassian.ResolveCloudID(ctx, c.http, siteURL)
	if err != nil {
		return "", err
	}

	return c.apiBaseFor(cloudID), nil
}
