# Jira Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver `internal/crypto` (AES-GCM sealing of Jira API tokens) and `internal/jira` (a per-instance Jira Cloud v3 client covering assigned-issue search and the three worklog operations), with every test running against an `httptest.Server`.

**Architecture:** `crypto.Sealer` wraps an AEAD and turns a token string into the opaque `[]byte` that `store.Instance.TokenEnc` already expects — the store deliberately left encryption to this ticket. `jira.Client` is constructed per instance from base URL, email and decrypted token; one unexported `do` method centralises auth, timeout and status-to-error mapping so every operation maps failures the same way. Files split by responsibility: transport, errors, search, worklogs, ADF.

**Tech Stack:** Go standard library only. No new dependencies — `net/http`, `crypto/aes`, `crypto/cipher`, `encoding/json`, `net/http/httptest`.

## Global Constraints

- Everything runs in Docker. Never run `go` bare on the host; use `make test-go` or `docker compose run --rm --no-deps app go ...`.
- Standard library first. This ticket adds **no** dependency; the approved non-stdlib set stays `modernc.org/sqlite` and `golang.org/x/sync`.
- Wrap errors with `%w` and context about what was attempted.
- Table-driven tests with `t.Run` subtests, using `httptest` rather than real network.
- **No test may contact a real Jira instance.**
- Comments earn their place: a non-obvious "why", a workaround for external behaviour, a subtle invariant. Never narrate the next line.
- A function's name must let a reader predict what it returns.
- Keep files small.

## Verified environment facts

Confirmed against live Atlassian documentation on 2026-08-10, because the design of record explicitly refused to be trusted on the first two:

1. `GET /rest/api/3/search` is **removed**. `/rest/api/3/search/jql` replaces it, paginates by `nextPageToken`, returns **no** `total`, and requires a bounded query. Omitting `fields` returns ids only.
2. Worklog `comment` on v3 is **Atlassian Document Format**, not a plain string.
3. Not anticipated by the spec: `started` must carry a numeric offset with **no colon** (`+0000`). Go's `time.RFC3339` emits `+00:00`, which Jira rejects. The layout is `2006-01-02T15:04:05.000-0700`.

Settled during refinement of #3: worklog writes send `adjustEstimate=auto` and `notifyUsers=false`.

## File structure

```
internal/crypto/
  crypto.go        Sealer: Seal and Open over AES-GCM
  crypto_test.go
internal/jira/
  errors.go        the three sentinel errors callers switch on
  client.go        Client, New, and the shared do() transport
  client_test.go
  search.go        SearchAssigned and its paging
  search_test.go
  adf.go           plain string -> minimal ADF document
  worklog.go       CreateWorklog, UpdateWorklog, DeleteWorklog
  worklog_test.go
```

---

### Task 1: Token sealing

`store.Instance.TokenEnc` is documented as opaque ciphertext whose encryption is this ticket's job. This task supplies it.

**Files:**
- Create: `internal/crypto/crypto.go`
- Test: `internal/crypto/crypto_test.go`

**Interfaces:**
- Consumes: `config.Config.Secret` (`[]byte`, exactly 32 bytes, already validated at boot).
- Produces: `crypto.NewSealer(key []byte) (*Sealer, error)`, `(*Sealer).Seal(plaintext string) ([]byte, error)`, `(*Sealer).Open(sealed []byte) (string, error)`.

- [ ] **Step 1: Write the failing test**

Create `internal/crypto/crypto_test.go`:

```go
package crypto_test

import (
	"bytes"
	"testing"

	"github.com/dgerrese/work-dashboard/internal/crypto"
)

// key32 is a fixed 32-byte key. Tests must not depend on randomness they do not control.
func key32() []byte {
	return bytes.Repeat([]byte{0x2a}, 32)
}

func TestSealOpenRoundTrip(t *testing.T) {
	sealer, err := crypto.NewSealer(key32())
	if err != nil {
		t.Fatalf("NewSealer: %v", err)
	}

	tests := []struct {
		name  string
		token string
	}{
		{"typical token", "ATATT3xFfGF0abcdef1234567890"},
		{"empty", ""},
		{"unicode", "tøkèn-ünicode-✓"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sealed, err := sealer.Seal(tt.token)
			if err != nil {
				t.Fatalf("Seal: %v", err)
			}
			if bytes.Contains(sealed, []byte(tt.token)) && tt.token != "" {
				t.Error("sealed output contains the plaintext")
			}

			got, err := sealer.Open(sealed)
			if err != nil {
				t.Fatalf("Open: %v", err)
			}
			if got != tt.token {
				t.Errorf("Open = %q, want %q", got, tt.token)
			}
		})
	}
}

func TestSealUsesAFreshNonce(t *testing.T) {
	sealer, err := crypto.NewSealer(key32())
	if err != nil {
		t.Fatalf("NewSealer: %v", err)
	}

	first, err := sealer.Seal("same-token")
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	second, err := sealer.Seal("same-token")
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}

	if bytes.Equal(first, second) {
		t.Error("sealing the same token twice produced identical output; the nonce is not fresh")
	}
}

func TestOpenRejectsTamperedCiphertext(t *testing.T) {
	sealer, err := crypto.NewSealer(key32())
	if err != nil {
		t.Fatalf("NewSealer: %v", err)
	}

	sealed, err := sealer.Seal("a-real-token")
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}

	tests := []struct {
		name    string
		corrupt func([]byte) []byte
	}{
		{"flipped byte in ciphertext", func(b []byte) []byte {
			out := bytes.Clone(b)
			out[len(out)-1] ^= 0xff
			return out
		}},
		{"flipped byte in nonce", func(b []byte) []byte {
			out := bytes.Clone(b)
			out[0] ^= 0xff
			return out
		}},
		{"truncated below nonce size", func(b []byte) []byte {
			return b[:4]
		}},
		{"empty", func([]byte) []byte { return nil }},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := sealer.Open(tt.corrupt(sealed)); err == nil {
				t.Error("Open accepted corrupt input; want an error")
			}
		})
	}
}

func TestNewSealerRejectsWrongKeySize(t *testing.T) {
	for _, size := range []int{0, 16, 31, 33} {
		if _, err := crypto.NewSealer(bytes.Repeat([]byte{1}, size)); err == nil {
			t.Errorf("NewSealer accepted a %d-byte key; want an error", size)
		}
	}
}

func TestOpenRejectsAnotherKeysCiphertext(t *testing.T) {
	mine, err := crypto.NewSealer(key32())
	if err != nil {
		t.Fatalf("NewSealer: %v", err)
	}
	theirs, err := crypto.NewSealer(bytes.Repeat([]byte{0x99}, 32))
	if err != nil {
		t.Fatalf("NewSealer: %v", err)
	}

	sealed, err := theirs.Seal("not-yours")
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}

	if _, err := mine.Open(sealed); err == nil {
		t.Error("Open accepted ciphertext sealed with a different key")
	}
}
```

- [ ] **Step 2: Run the test and watch it fail**

```shell
docker compose run --rm --no-deps app go test ./internal/crypto/ -v
```

Expected: a build failure — the package does not exist. Paste that output into the task report.

- [ ] **Step 3: Write the implementation**

Create `internal/crypto/crypto.go`:

```go
// Package crypto seals Jira API tokens so that possession of the SQLite file
// alone does not yield working credentials.
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"fmt"
)

// KeySize is the AES-256 key length callers must supply. config validates
// WD_SECRET_KEY to this length at boot.
const KeySize = 32

// Sealer encrypts and decrypts tokens with AES-GCM under one key.
type Sealer struct {
	aead cipher.AEAD
}

// NewSealer builds a Sealer from a 32-byte key.
func NewSealer(key []byte) (*Sealer, error) {
	if len(key) != KeySize {
		return nil, fmt.Errorf("sealer key is %d bytes, want %d", len(key), KeySize)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("creating AES cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("creating GCM: %w", err)
	}

	return &Sealer{aead: aead}, nil
}

// Seal encrypts a token, returning the nonce followed by the ciphertext. GCM
// nonces must never repeat under one key, so each call draws a fresh one and
// carries it alongside the output rather than deriving it from anything.
func (s *Sealer) Seal(plaintext string) ([]byte, error) {
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, fmt.Errorf("drawing nonce: %w", err)
	}

	return s.aead.Seal(nonce, nonce, []byte(plaintext), nil), nil
}

// Open decrypts what Seal produced. GCM authenticates as it decrypts, so a
// tampered nonce, ciphertext or tag fails here rather than returning garbage.
func (s *Sealer) Open(sealed []byte) (string, error) {
	nonceSize := s.aead.NonceSize()
	if len(sealed) < nonceSize {
		return "", fmt.Errorf("sealed value is %d bytes, shorter than the %d-byte nonce", len(sealed), nonceSize)
	}

	nonce, ciphertext := sealed[:nonceSize], sealed[nonceSize:]
	plaintext, err := s.aead.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("opening sealed token: %w", err)
	}

	return string(plaintext), nil
}
```

- [ ] **Step 4: Run the test and watch it pass**

```shell
docker compose run --rm --no-deps app go test ./internal/crypto/ -v
```

Expected: every subtest PASS.

- [ ] **Step 5: Commit**

```shell
git add internal/crypto/
git commit -m "feat: seal jira api tokens with aes-gcm"
```

---

### Task 2: Client transport, auth and error mapping

**Files:**
- Create: `internal/jira/errors.go`, `internal/jira/client.go`
- Test: `internal/jira/client_test.go`

**Interfaces:**
- Consumes: nothing from Task 1 — the client takes an already-decrypted token.
- Produces: `jira.New(baseURL, email, token string) (*Client, error)`; sentinel errors `jira.ErrUnauthorized`, `jira.ErrNotFound`, `jira.ErrUnreachable`; and the unexported `(*Client).do(ctx context.Context, method, path string, query url.Values, body any, out any) error` that Tasks 3 and 4 build on.

- [ ] **Step 1: Write the failing test**

Create `internal/jira/client_test.go`:

```go
package jira_test

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dgerrese/work-dashboard/internal/jira"
)

// newTestClient points a client at a stub server standing in for Jira.
func newTestClient(t *testing.T, handler http.HandlerFunc) *jira.Client {
	t.Helper()

	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)

	client, err := jira.New(srv.URL, "dion@example.com", "secret-token")
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	return client
}

func TestNewRejectsBadInput(t *testing.T) {
	tests := []struct {
		name    string
		baseURL string
		email   string
		token   string
	}{
		{"empty base URL", "", "a@b.com", "t"},
		{"base URL with no scheme", "acme.atlassian.net", "a@b.com", "t"},
		{"empty email", "https://acme.atlassian.net", "", "t"},
		{"empty token", "https://acme.atlassian.net", "a@b.com", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := jira.New(tt.baseURL, tt.email, tt.token); err == nil {
				t.Error("New accepted invalid input; want an error")
			}
		})
	}
}

func TestRequestsCarryBasicAuth(t *testing.T) {
	var gotAuth string
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"issues":[]}`))
	})

	if _, err := client.SearchAssigned(context.Background()); err != nil {
		t.Fatalf("SearchAssigned: %v", err)
	}

	want := "Basic " + base64.StdEncoding.EncodeToString([]byte("dion@example.com:secret-token"))
	if gotAuth != want {
		t.Errorf("Authorization = %q, want %q", gotAuth, want)
	}
}

func TestStatusCodesMapToSentinelErrors(t *testing.T) {
	tests := []struct {
		name   string
		status int
		want   error
	}{
		{"unauthorized", http.StatusUnauthorized, jira.ErrUnauthorized},
		{"forbidden", http.StatusForbidden, jira.ErrUnauthorized},
		{"not found", http.StatusNotFound, jira.ErrNotFound},
		{"server error", http.StatusInternalServerError, jira.ErrUnreachable},
		{"bad gateway", http.StatusBadGateway, jira.ErrUnreachable},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tt.status)
			})

			_, err := client.SearchAssigned(context.Background())
			if !errors.Is(err, tt.want) {
				t.Errorf("SearchAssigned error = %v, want it to wrap %v", err, tt.want)
			}
		})
	}
}

func TestUnreachableHostIsNotAServerError(t *testing.T) {
	// A port nothing listens on: the transport fails before any status exists.
	client, err := jira.New("http://127.0.0.1:1", "a@b.com", "t")
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	if _, err := client.SearchAssigned(context.Background()); !errors.Is(err, jira.ErrUnreachable) {
		t.Errorf("error = %v, want it to wrap ErrUnreachable", err)
	}
}

func TestContextCancellationPropagates(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	})

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if _, err := client.SearchAssigned(ctx); err == nil {
		t.Error("SearchAssigned ignored a cancelled context")
	}
}
```

- [ ] **Step 2: Run the test and watch it fail**

```shell
docker compose run --rm --no-deps app go test ./internal/jira/ -v
```

Expected: build failure — the package does not exist. Paste it into the task report.

- [ ] **Step 3: Write the errors**

Create `internal/jira/errors.go`:

```go
package jira

import "errors"

// The HTTP layer switches on these to choose a status code: an unreachable
// instance is a 502, not a 500, and rejected credentials are the user's problem
// to fix in Settings rather than a server fault.
var (
	// ErrUnauthorized means Jira rejected the credentials (401 or 403).
	ErrUnauthorized = errors.New("jira: credentials rejected")
	// ErrNotFound means the issue or worklog does not exist (404).
	ErrNotFound = errors.New("jira: not found")
	// ErrUnreachable means the instance could not be reached or failed (5xx or
	// a transport failure).
	ErrUnreachable = errors.New("jira: instance unreachable")
)
```

- [ ] **Step 4: Write the client**

Create `internal/jira/client.go`:

```go
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
	"strings"
	"time"
)

// requestTimeout bounds a single Jira call. The assigned-issues fan-out waits on
// every instance, so one unresponsive site must not hold the whole request open.
const requestTimeout = 30 * time.Second

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
		return fmt.Errorf("%s %s: %w: %v", method, path, ErrUnreachable, err)
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
	case resp.StatusCode == http.StatusUnauthorized, resp.StatusCode == http.StatusForbidden:
		return fmt.Errorf("%s %s: %w: %s", method, path, ErrUnauthorized, detail)
	case resp.StatusCode == http.StatusNotFound:
		return fmt.Errorf("%s %s: %w: %s", method, path, ErrNotFound, detail)
	case resp.StatusCode >= 500:
		return fmt.Errorf("%s %s: %w: %s", method, path, ErrUnreachable, detail)
	default:
		return fmt.Errorf("%s %s: unexpected status %d: %s", method, path, resp.StatusCode, detail)
	}
}
```

- [ ] **Step 5: Run the test and watch it fail differently**

```shell
docker compose run --rm --no-deps app go test ./internal/jira/ -v
```

Expected: it now fails on `client.SearchAssigned` being undefined. That method arrives in Task 3; this task's own assertions cannot pass until then. Do **not** stub `SearchAssigned` here — Task 3 owns it and a stub would be thrown away.

- [ ] **Step 6: Commit**

```shell
git add internal/jira/errors.go internal/jira/client.go internal/jira/client_test.go
git commit -m "feat: jira client transport with basic auth and mapped errors"
```

---

### Task 3: Assigned-issue search with token pagination

**Files:**
- Create: `internal/jira/search.go`
- Test: `internal/jira/search_test.go`

**Interfaces:**
- Consumes: `(*Client).do` and the sentinel errors from Task 2.
- Produces: `jira.Issue{Key, Summary, Status string}` and `(*Client).SearchAssigned(ctx context.Context) ([]Issue, error)`.

- [ ] **Step 1: Write the failing test**

Create `internal/jira/search_test.go`:

```go
package jira_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestSearchAssignedSendsBoundedJQLAndNamedFields(t *testing.T) {
	var got struct {
		JQL        string   `json:"jql"`
		Fields     []string `json:"fields"`
		MaxResults int      `json:"maxResults"`
	}
	var gotMethod, gotPath string

	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath = r.Method, r.URL.Path
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &got)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"issues":[]}`))
	})

	if _, err := client.SearchAssigned(context.Background()); err != nil {
		t.Fatalf("SearchAssigned: %v", err)
	}

	if gotMethod != http.MethodPost {
		t.Errorf("method = %s, want POST", gotMethod)
	}
	if gotPath != "/rest/api/3/search/jql" {
		t.Errorf("path = %s, want /rest/api/3/search/jql", gotPath)
	}
	if !strings.Contains(got.JQL, "assignee = currentUser()") {
		t.Errorf("jql = %q, missing the assignee clause", got.JQL)
	}
	if !strings.Contains(got.JQL, "statusCategory != Done") {
		t.Errorf("jql = %q, missing the statusCategory clause", got.JQL)
	}
	// Omitting fields makes Jira return ids only, which would render an empty list.
	if len(got.Fields) == 0 {
		t.Error("fields was empty; Jira returns ids only unless fields are named")
	}
	if got.MaxResults <= 0 {
		t.Errorf("maxResults = %d, want a positive page size", got.MaxResults)
	}
}

func TestSearchAssignedFollowsNextPageToken(t *testing.T) {
	var tokens []string
	pages := []string{
		`{"issues":[{"key":"ABC-1","fields":{"summary":"first","status":{"name":"In Progress"}}}],"nextPageToken":"page2"}`,
		`{"issues":[{"key":"ABC-2","fields":{"summary":"second","status":{"name":"To Do"}}}],"nextPageToken":"page3"}`,
		// Last page: nextPageToken is absent, which is how Jira signals the end.
		`{"issues":[{"key":"ABC-3","fields":{"summary":"third","status":{"name":"To Do"}}}]}`,
	}
	call := 0

	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			NextPageToken string `json:"nextPageToken"`
		}
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &body)
		tokens = append(tokens, body.NextPageToken)

		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, pages[call])
		call++
	})

	issues, err := client.SearchAssigned(context.Background())
	if err != nil {
		t.Fatalf("SearchAssigned: %v", err)
	}

	if len(issues) != 3 {
		t.Fatalf("got %d issues, want 3 across three pages", len(issues))
	}
	want := []string{"ABC-1", "ABC-2", "ABC-3"}
	for i, issue := range issues {
		if issue.Key != want[i] {
			t.Errorf("issue[%d].Key = %s, want %s", i, issue.Key, want[i])
		}
	}
	if issues[0].Summary != "first" {
		t.Errorf("summary = %q, want %q", issues[0].Summary, "first")
	}
	if issues[0].Status != "In Progress" {
		t.Errorf("status = %q, want %q", issues[0].Status, "In Progress")
	}

	// First request carries no token; each later one carries the previous response's.
	wantTokens := []string{"", "page2", "page3"}
	for i, tok := range wantTokens {
		if tokens[i] != tok {
			t.Errorf("request %d token = %q, want %q", i, tokens[i], tok)
		}
	}
}

func TestSearchAssignedStopsOnRepeatedToken(t *testing.T) {
	// A server that always returns the same token would page forever. The client
	// must not depend on the server being well behaved.
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"issues":[{"key":"ABC-1","fields":{"summary":"s","status":{"name":"To Do"}}}],"nextPageToken":"same"}`)
	})

	done := make(chan struct{})
	go func() {
		defer close(done)
		if _, err := client.SearchAssigned(context.Background()); err == nil {
			t.Error("SearchAssigned looped on a repeating token without erroring")
		}
	}()

	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("SearchAssigned did not terminate on a repeating nextPageToken")
	}
}

func TestSearchAssignedReturnsEmptyNotNil(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"issues":[]}`)
	})

	issues, err := client.SearchAssigned(context.Background())
	if err != nil {
		t.Fatalf("SearchAssigned: %v", err)
	}
	if issues == nil {
		t.Error("issues is nil; want an empty slice so it encodes as [] not null")
	}
	if len(issues) != 0 {
		t.Errorf("got %d issues, want 0", len(issues))
	}
}
```

- [ ] **Step 2: Run the test and watch it fail**

```shell
docker compose run --rm --no-deps app go test ./internal/jira/ -run TestSearch -v
```

Expected: `client.SearchAssigned undefined`. Paste it into the task report.

- [ ] **Step 3: Write the implementation**

Create `internal/jira/search.go`:

```go
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

	for page := 0; page < maxSearchPages; page++ {
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
```

- [ ] **Step 4: Run the whole package and watch it pass**

```shell
docker compose run --rm --no-deps app go test ./internal/jira/ -v
```

Expected: Task 2's assertions and Task 3's both PASS now that `SearchAssigned` exists.

- [ ] **Step 5: Commit**

```shell
git add internal/jira/search.go internal/jira/search_test.go
git commit -m "feat: assigned-issue search over search/jql with token paging"
```

---

### Task 4: Worklog create, update and delete

**Files:**
- Create: `internal/jira/adf.go`, `internal/jira/worklog.go`
- Test: `internal/jira/worklog_test.go`

**Interfaces:**
- Consumes: `(*Client).do` and the sentinel errors from Task 2.
- Produces: `jira.Worklog{IssueKey string, Started time.Time, Seconds int64, Comment string}`, `(*Client).CreateWorklog(ctx, w Worklog) (string, error)`, `(*Client).UpdateWorklog(ctx, id string, w Worklog) error`, `(*Client).DeleteWorklog(ctx, issueKey, id string) error`.

- [ ] **Step 1: Write the failing test**

Create `internal/jira/worklog_test.go`:

```go
package jira_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/dgerrese/work-dashboard/internal/jira"
)

func amsterdamTime(t *testing.T) time.Time {
	t.Helper()
	loc, err := time.LoadLocation("Europe/Amsterdam")
	if err != nil {
		t.Fatalf("LoadLocation: %v", err)
	}
	return time.Date(2026, 8, 10, 14, 30, 0, 0, loc)
}

func TestCreateWorklogWireFormat(t *testing.T) {
	var (
		gotMethod, gotPath, gotQuery string
		gotBody                      map[string]any
	)

	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath, gotQuery = r.Method, r.URL.Path, r.URL.RawQuery
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":"10101"}`)
	})

	id, err := client.CreateWorklog(context.Background(), jira.Worklog{
		IssueKey: "ABC-1",
		Started:  amsterdamTime(t),
		Seconds:  5400,
		Comment:  "wrote the plan",
	})
	if err != nil {
		t.Fatalf("CreateWorklog: %v", err)
	}

	if id != "10101" {
		t.Errorf("id = %q, want %q", id, "10101")
	}
	if gotMethod != http.MethodPost {
		t.Errorf("method = %s, want POST", gotMethod)
	}
	if gotPath != "/rest/api/3/issue/ABC-1/worklog" {
		t.Errorf("path = %s, want /rest/api/3/issue/ABC-1/worklog", gotPath)
	}

	// Jira rejects an offset containing a colon, which is exactly what
	// time.RFC3339 produces. Amsterdam is UTC+2 in August.
	if got := gotBody["started"]; got != "2026-08-10T14:30:00.000+0200" {
		t.Errorf("started = %v, want 2026-08-10T14:30:00.000+0200", got)
	}
	if got := gotBody["timeSpentSeconds"]; got != float64(5400) {
		t.Errorf("timeSpentSeconds = %v, want 5400", got)
	}
	if _, present := gotBody["timeSpent"]; present {
		t.Error("timeSpent was sent alongside timeSpentSeconds; Jira rejects both together")
	}

	// v3 takes the comment as an Atlassian Document Format node, not a string.
	comment, ok := gotBody["comment"].(map[string]any)
	if !ok {
		t.Fatalf("comment = %#v, want an ADF object", gotBody["comment"])
	}
	if comment["type"] != "doc" || comment["version"] != float64(1) {
		t.Errorf("comment = %#v, want type doc and version 1", comment)
	}

	if gotQuery == "" {
		t.Fatal("no query string; adjustEstimate and notifyUsers must be sent")
	}
	values, err := url.ParseQuery(gotQuery)
	if err != nil {
		t.Fatalf("ParseQuery: %v", err)
	}
	if values.Get("adjustEstimate") != "auto" {
		t.Errorf("adjustEstimate = %q, want auto", values.Get("adjustEstimate"))
	}
	if values.Get("notifyUsers") != "false" {
		t.Errorf("notifyUsers = %q, want false", values.Get("notifyUsers"))
	}
}

func TestCreateWorklogOmitsEmptyComment(t *testing.T) {
	var gotBody map[string]any
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)
		_, _ = io.WriteString(w, `{"id":"1"}`)
	})

	if _, err := client.CreateWorklog(context.Background(), jira.Worklog{
		IssueKey: "ABC-1", Started: amsterdamTime(t), Seconds: 60,
	}); err != nil {
		t.Fatalf("CreateWorklog: %v", err)
	}

	if _, present := gotBody["comment"]; present {
		t.Error("an empty comment was sent as a field; it must be omitted entirely")
	}
}

func TestCreateWorklogRejectsBadInput(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		t.Error("a request reached the server; validation should have failed first")
	})

	tests := []struct {
		name string
		w    jira.Worklog
	}{
		{"no issue key", jira.Worklog{Started: time.Now(), Seconds: 60}},
		{"zero seconds", jira.Worklog{IssueKey: "ABC-1", Started: time.Now()}},
		{"negative seconds", jira.Worklog{IssueKey: "ABC-1", Started: time.Now(), Seconds: -1}},
		{"zero started", jira.Worklog{IssueKey: "ABC-1", Seconds: 60}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := client.CreateWorklog(context.Background(), tt.w); err == nil {
				t.Error("CreateWorklog accepted invalid input; want an error")
			}
		})
	}
}

func TestUpdateWorklogTargetsTheKnownID(t *testing.T) {
	var gotMethod, gotPath string
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath = r.Method, r.URL.Path
		_, _ = io.WriteString(w, `{"id":"10101"}`)
	})

	err := client.UpdateWorklog(context.Background(), "10101", jira.Worklog{
		IssueKey: "ABC-1", Started: amsterdamTime(t), Seconds: 900,
	})
	if err != nil {
		t.Fatalf("UpdateWorklog: %v", err)
	}

	if gotMethod != http.MethodPut {
		t.Errorf("method = %s, want PUT", gotMethod)
	}
	if gotPath != "/rest/api/3/issue/ABC-1/worklog/10101" {
		t.Errorf("path = %s, want /rest/api/3/issue/ABC-1/worklog/10101", gotPath)
	}
}

func TestDeleteWorklogTargetsTheKnownID(t *testing.T) {
	var gotMethod, gotPath string
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath = r.Method, r.URL.Path
		w.WriteHeader(http.StatusNoContent)
	})

	if err := client.DeleteWorklog(context.Background(), "ABC-1", "10101"); err != nil {
		t.Fatalf("DeleteWorklog: %v", err)
	}

	if gotMethod != http.MethodDelete {
		t.Errorf("method = %s, want DELETE", gotMethod)
	}
	if gotPath != "/rest/api/3/issue/ABC-1/worklog/10101" {
		t.Errorf("path = %s, want /rest/api/3/issue/ABC-1/worklog/10101", gotPath)
	}
}

func TestWorklogNotFoundMapsToSentinel(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	})

	if err := client.DeleteWorklog(context.Background(), "ABC-1", "nope"); !errors.Is(err, jira.ErrNotFound) {
		t.Errorf("error = %v, want it to wrap ErrNotFound", err)
	}
}

func TestIssueKeyIsPathEscaped(t *testing.T) {
	var gotEscaped string
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotEscaped = r.URL.EscapedPath()
		w.WriteHeader(http.StatusNoContent)
	})

	// Issue keys arrive from Jira and from pinned-issue input. A key carrying a
	// slash must not be able to redirect the request to another path.
	if err := client.DeleteWorklog(context.Background(), "AB/C-1", "1"); err != nil {
		t.Fatalf("DeleteWorklog: %v", err)
	}

	want := "/rest/api/3/issue/AB%2FC-1/worklog/1"
	if gotEscaped != want {
		t.Errorf("escaped path = %s, want %s", gotEscaped, want)
	}
}
```

- [ ] **Step 2: Run the test and watch it fail**

```shell
docker compose run --rm --no-deps app go test ./internal/jira/ -run TestCreateWorklog -v
```

Expected: `client.CreateWorklog undefined`. Paste it into the task report.

- [ ] **Step 3: Write the ADF helper**

Create `internal/jira/adf.go`:

```go
package jira

// Atlassian Document Format is a rich-text node tree. v3 takes worklog comments
// as one of these rather than the plain string v2 accepted, so a comment this
// app treats as a line of text has to be wrapped before it goes out.
type adfNode struct {
	Type    string    `json:"type"`
	Version int       `json:"version,omitempty"`
	Text    string    `json:"text,omitempty"`
	Content []adfNode `json:"content,omitempty"`
}

// adfParagraph wraps a plain string as the minimal valid ADF document: one
// paragraph holding one text node.
func adfParagraph(text string) adfNode {
	return adfNode{
		Type:    "doc",
		Version: 1,
		Content: []adfNode{{
			Type:    "paragraph",
			Content: []adfNode{{Type: "text", Text: text}},
		}},
	}
}
```

- [ ] **Step 4: Write the worklog operations**

Create `internal/jira/worklog.go`:

```go
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
```

- [ ] **Step 5: Run the whole package and watch it pass**

```shell
docker compose run --rm --no-deps app go test ./internal/jira/ -v
```

Expected: every subtest PASS.

- [ ] **Step 6: Run the full gate**

```shell
make verify
```

Expected: `verify: OK`. Paste the output into the task report.

- [ ] **Step 7: Commit**

```shell
git add internal/jira/adf.go internal/jira/worklog.go internal/jira/worklog_test.go
git commit -m "feat: worklog create, update and delete with adf comments"
```

---

## Definition of done

- [ ] Every acceptance criterion on issue #3 is satisfied
- [ ] `make verify` is green and its output is pasted in the PR
- [ ] No test contacts a real Jira instance; every one runs against `httptest`
- [ ] No new dependency in `go.mod`
- [ ] The whole-branch review has run and its findings are addressed
