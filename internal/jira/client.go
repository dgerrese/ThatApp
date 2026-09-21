// Package jira is a Jira Cloud REST v3 client, one instance per configured site.
package jira

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// requestTimeout bounds a single Jira call. The assigned-issues fan-out waits on
// every instance, so one unresponsive site must not hold the whole request open.
const requestTimeout = 30 * time.Second

// now is overridden by tests to pin the clock Retry-After dates are measured against.
var now = time.Now

// Client talks to one Jira Cloud site.
type Client struct {
	baseURL string
	email   string
	token   string
	http    *http.Client
}

// New builds a client for one site. The token is the decrypted API token, not
// the ciphertext held in the store.
func New(baseURL, email, token string) (*Client, error) {
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return nil, fmt.Errorf("parsing base URL %q: %w", baseURL, err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("base URL %q needs an http or https scheme", baseURL)
	}
	if parsed.Host == "" {
		return nil, fmt.Errorf("base URL %q has no host", baseURL)
	}
	if email == "" {
		return nil, fmt.Errorf("email is required for basic auth")
	}
	if token == "" {
		return nil, fmt.Errorf("api token is required for basic auth")
	}

	return &Client{
		baseURL: strings.TrimSuffix(baseURL, "/"),
		email:   email,
		token:   token,
		http:    &http.Client{Timeout: requestTimeout},
	}, nil
}

// do performs one authenticated call. A nil body sends none; a nil out discards
// the response. Every operation goes through here so that auth, timeout and
// status mapping have exactly one implementation.
func (c *Client) do(
	ctx context.Context, method, path string, query url.Values, body, out any,
) error {
	endpoint := c.baseURL + path
	if len(query) > 0 {
		endpoint += "?" + query.Encode()
	}

	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("encoding request body for %s %s: %w", method, path, err)
		}
		reader = bytes.NewReader(encoded)
	}

	req, err := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if err != nil {
		return fmt.Errorf("building request for %s %s: %w", method, path, err)
	}
	req.SetBasicAuth(c.email, c.token)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.http.Do(req)
	if err != nil {
		// A transport failure is indistinguishable to the caller from a 5xx: the
		// site did not answer. Both become ErrUnreachable so the HTTP layer has
		// one case to handle.
		return fmt.Errorf("%s %s: %w: %w", method, path, ErrUnreachable, err)
	}
	defer func() { _ = resp.Body.Close() }()

	if err := statusError(method, path, resp); err != nil {
		return err
	}

	if out == nil {
		return nil
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("decoding response from %s %s: %w", method, path, err)
	}

	return nil
}

// statusError maps a response status onto the package's sentinel errors,
// returning nil for 2xx.
func statusError(method, path string, resp *http.Response) error {
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}

	// Jira's error bodies are small; including one turns "400 Bad Request" into
	// something a user can act on.
	detail, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))

	switch {
	case resp.StatusCode == http.StatusUnauthorized:
		return fmt.Errorf("%s %s -> %d: %w: %s", method, path, resp.StatusCode, ErrUnauthorized, detail)
	case resp.StatusCode == http.StatusForbidden:
		return fmt.Errorf("%s %s -> %d: %w: %s", method, path, resp.StatusCode, ErrForbidden, detail)
	case resp.StatusCode == http.StatusTooManyRequests:
		limited := &RateLimitError{Wait: retryAfter(resp.Header.Get("Retry-After"), now())}
		return fmt.Errorf("%s %s -> %d: %w: %s", method, path, resp.StatusCode, limited, detail)
	case resp.StatusCode == http.StatusNotFound:
		return fmt.Errorf("%s %s -> %d: %w: %s", method, path, resp.StatusCode, ErrNotFound, detail)
	case resp.StatusCode >= 500:
		return fmt.Errorf("%s %s -> %d: %w: %s", method, path, resp.StatusCode, ErrUnreachable, detail)
	default:
		return fmt.Errorf("%s %s -> %d: unexpected status: %s", method, path, resp.StatusCode, detail)
	}
}

// retryAfter reads a Retry-After value, which RFC 9110 allows as whole seconds
// or an HTTP date. Anything unusable, and any date already past, is zero. A
// seconds value is capped at a day, so a huge one cannot overflow the
// time.Duration multiplication below.
func retryAfter(value string, at time.Time) time.Duration {
	if seconds, err := strconv.Atoi(value); err == nil && seconds > 0 {
		const maxSeconds = 24 * 60 * 60
		if seconds > maxSeconds {
			seconds = maxSeconds
		}
		return time.Duration(seconds) * time.Second
	}
	if when, err := http.ParseTime(value); err == nil && when.After(at) {
		return when.Sub(at)
	}
	return 0
}
