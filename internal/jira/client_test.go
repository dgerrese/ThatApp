package jira_test

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"codeberg.org/DionGerrese/ThatApp/internal/jira"
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
		{"forbidden", http.StatusForbidden, jira.ErrForbidden},
		{"not found", http.StatusNotFound, jira.ErrNotFound},
		{"server error", http.StatusInternalServerError, jira.ErrUnreachable},
		{"bad gateway", http.StatusBadGateway, jira.ErrUnreachable},
		{"rate limited", http.StatusTooManyRequests, jira.ErrRateLimited},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := newTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
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

func TestRateLimitCarriesTheRetryAfterWait(t *testing.T) {
	now := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name       string
		retryAfter string
		want       time.Duration
	}{
		{"seconds", "30", 30 * time.Second},
		{"an HTTP date", now.Add(2 * time.Minute).Format(http.TimeFormat), 2 * time.Minute},
		{"a date already past", now.Add(-time.Minute).Format(http.TimeFormat), 0},
		{"no header", "", 0},
		{"garbage", "soon", 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			restore := jira.SetClockForTest(func() time.Time { return now })
			t.Cleanup(restore)
			client := newTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
				if tt.retryAfter != "" {
					w.Header().Set("Retry-After", tt.retryAfter)
				}
				w.WriteHeader(http.StatusTooManyRequests)
			})

			_, err := client.SearchAssigned(context.Background())

			var limited *jira.RateLimitError
			if !errors.As(err, &limited) {
				t.Fatalf("error = %v, want a *jira.RateLimitError", err)
			}
			if limited.Wait != tt.want {
				t.Errorf("Wait = %v, want %v", limited.Wait, tt.want)
			}
			if !errors.Is(err, jira.ErrRateLimited) {
				t.Errorf("error = %v, want it to wrap ErrRateLimited", err)
			}
		})
	}
}

func TestContextCancellationPropagates(t *testing.T) {
	client := newTestClient(t, func(_ http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	})

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if _, err := client.SearchAssigned(ctx); err == nil {
		t.Error("SearchAssigned ignored a cancelled context")
	}
}
