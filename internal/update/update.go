// Package update asks GitHub for the newest stable release and remembers the outcome.
package update

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// LatestReleaseURL is GitHub's endpoint for the newest stable release.
const LatestReleaseURL = "https://api.github.com/repos/dgerrese/ThatApp/releases/latest"

// Version is year, week and build number, compared as integers.
type Version [3]int

// ParseVersion reads "2026.47.1" or "v2026.47.1".
func ParseVersion(s string) (Version, error) {
	parts := strings.Split(strings.TrimPrefix(s, "v"), ".")
	if len(parts) != 3 {
		return Version{}, fmt.Errorf("version %q: want year.week.n", s)
	}
	var v Version
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return Version{}, fmt.Errorf("version %q: %q is not a number", s, p)
		}
		v[i] = n
	}
	return v, nil
}

// Less reports whether v is older than w.
func (v Version) Less(w Version) bool {
	for i := range v {
		if v[i] != w[i] {
			return v[i] < w[i]
		}
	}
	return false
}

// Release is a GitHub release as the API reports it to the browser.
type Release struct {
	Version string `json:"version"`
	URL     string `json:"url"`
}

// Status is the outcome of the last check. Latest is set only when GitHub's newest stable release is newer than the running version.
type Status struct {
	Latest *Release
	Err    string
}

// Checker holds the outcome of the latest check in memory.
type Checker struct {
	current Version
	url     string
	client  *http.Client

	mu     sync.Mutex
	status Status
}

// NewChecker builds a Checker. An unparseable current (a dev build) counts as 0.0.0, so any release reads as newer.
func NewChecker(current, url string, client *http.Client) *Checker {
	v, _ := ParseVersion(current)
	return &Checker{current: v, url: url, client: client}
}

// Check asks GitHub once and replaces the stored Status.
func (c *Checker) Check(ctx context.Context) {
	s := c.fetch(ctx)
	c.mu.Lock()
	c.status = s
	c.mu.Unlock()
}

// Status returns the stored outcome; safe for concurrent use.
func (c *Checker) Status() Status {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.status
}

// Run checks now, then every interval, until ctx ends.
func (c *Checker) Run(ctx context.Context, every time.Duration) {
	c.Check(ctx)
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			c.Check(ctx)
		}
	}
}

func (c *Checker) fetch(ctx context.Context) Status {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.url, nil)
	if err != nil {
		return Status{Err: "GitHub did not answer."}
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "ThatApp")
	resp, err := c.client.Do(req)
	if err != nil {
		return Status{Err: "GitHub did not answer."}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Status{Err: fmt.Sprintf("GitHub answered %d.", resp.StatusCode)}
	}
	var body struct {
		Tag string `json:"tag_name"`
		URL string `json:"html_url"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return Status{Err: "GitHub's answer could not be read."}
	}
	latest, err := ParseVersion(body.Tag)
	if err != nil {
		return Status{Err: fmt.Sprintf("GitHub's newest release %q is not a version.", body.Tag)}
	}
	if !c.current.Less(latest) {
		return Status{}
	}
	return Status{Latest: &Release{Version: strings.TrimPrefix(body.Tag, "v"), URL: body.URL}}
}
