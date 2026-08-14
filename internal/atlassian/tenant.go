// Package atlassian resolves a Jira Cloud site to the API gateway that will
// accept its credentials.
//
// Basic auth with an API token is rejected by the site host and accepted by
// https://api.atlassian.com/ex/jira/{cloudId}, so a site URL alone cannot be
// called. The cloud id is readable without authentication, which is what lets
// the settings form ask for the site URL and work out the rest.
//
// The gateway's URL shape lives here and nowhere else. internal/jira is handed
// a base URL and uses it verbatim; it derives neither URL from the other.
package atlassian

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

// ErrTenantUnreadable means the site's cloud id could not be read: the host did
// not answer, answered with an error, or answered with something that was not
// tenant info. The distinction does not matter to a caller, which can only
// report that the site could not be identified.
var ErrTenantUnreadable = errors.New("atlassian: tenant info unreadable")

// tenantInfoPath is unauthenticated by design on Jira Cloud.
const tenantInfoPath = "/_edge/tenant_info"

// gatewayPrefix is the one place the gateway's URL shape is written down.
const gatewayPrefix = "https://api.atlassian.com/ex/jira/"

// NormalizeSiteURL reduces a site URL to scheme and host, rejecting anything
// that could not identify a site. Callers store the result, so accepting a URL
// with a path would mean every later concatenation produced a different one.
func NormalizeSiteURL(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", fmt.Errorf("site URL is required")
	}

	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", fmt.Errorf("parsing site URL %q: %w", trimmed, err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("site URL %q needs an http or https scheme", trimmed)
	}
	if parsed.Host == "" {
		return "", fmt.Errorf("site URL %q has no host", trimmed)
	}

	return parsed.Scheme + "://" + parsed.Host, nil
}

// APIBaseURL returns the gateway base for a cloud id.
func APIBaseURL(cloudID string) string {
	return gatewayPrefix + cloudID
}

// ResolveCloudID reads a site's cloud id from its unauthenticated tenant-info
// endpoint.
func ResolveCloudID(ctx context.Context, httpClient *http.Client, siteURL string) (string, error) {
	endpoint := strings.TrimSuffix(siteURL, "/") + tenantInfoPath

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", fmt.Errorf("building tenant info request for %s: %w", siteURL, err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("reading tenant info for %s: %w: %w", siteURL, ErrTenantUnreadable, err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf(
			"reading tenant info for %s: %w: status %d", siteURL, ErrTenantUnreadable, resp.StatusCode)
	}

	var info struct {
		CloudID string `json:"cloudId"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return "", fmt.Errorf("decoding tenant info for %s: %w: %w", siteURL, ErrTenantUnreadable, err)
	}
	// A site behind a login wall answers 200 with a page, which decodes into a
	// zero value rather than failing. An empty id is therefore a real outcome.
	if info.CloudID == "" {
		return "", fmt.Errorf(
			"reading tenant info for %s: %w: response carried no cloudId", siteURL, ErrTenantUnreadable)
	}

	return info.CloudID, nil
}
