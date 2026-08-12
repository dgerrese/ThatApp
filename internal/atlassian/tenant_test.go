package atlassian

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNormalizeSiteURL(t *testing.T) {
	cases := map[string]struct {
		raw     string
		want    string
		wantErr bool
	}{
		"plain host":         {raw: "https://example.atlassian.net", want: "https://example.atlassian.net"},
		"trailing slash":     {raw: "https://example.atlassian.net/", want: "https://example.atlassian.net"},
		"path is dropped":    {raw: "https://example.atlassian.net/jira/software", want: "https://example.atlassian.net"},
		"query is dropped":   {raw: "https://example.atlassian.net/?a=b", want: "https://example.atlassian.net"},
		"surrounding space":  {raw: "  https://example.atlassian.net  ", want: "https://example.atlassian.net"},
		"http is allowed":    {raw: "http://localhost:8080", want: "http://localhost:8080"},
		"empty":              {raw: "", wantErr: true},
		"no scheme":          {raw: "example.atlassian.net", wantErr: true},
		"no host":            {raw: "https://", wantErr: true},
		"unsupported scheme": {raw: "ftp://example.atlassian.net", wantErr: true},
		"not a URL at all":   {raw: "://nonsense", wantErr: true},
	}

	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			got, err := NormalizeSiteURL(tc.raw)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("NormalizeSiteURL(%q) = %q, want an error", tc.raw, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("NormalizeSiteURL(%q) returned error: %v", tc.raw, err)
			}
			if got != tc.want {
				t.Errorf("NormalizeSiteURL(%q) = %q, want %q", tc.raw, got, tc.want)
			}
		})
	}
}

func TestAPIBaseURL(t *testing.T) {
	const cloudID = "7c41e2b6-9d38-4a71-b5c0-2e8f6a1d90b4"
	want := "https://api.atlassian.com/ex/jira/" + cloudID

	if got := APIBaseURL(cloudID); got != want {
		t.Errorf("APIBaseURL(%q) = %q, want %q", cloudID, got, want)
	}
}

func TestResolveCloudIDReadsTenantInfo(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"cloudId":"7c41e2b6-9d38-4a71-b5c0-2e8f6a1d90b4"}`))
	}))
	defer srv.Close()

	got, err := ResolveCloudID(context.Background(), srv.Client(), srv.URL)
	if err != nil {
		t.Fatalf("ResolveCloudID() returned error: %v", err)
	}
	if got != "7c41e2b6-9d38-4a71-b5c0-2e8f6a1d90b4" {
		t.Errorf("ResolveCloudID() = %q, want the seeded cloud id", got)
	}
	// The endpoint is unauthenticated, which is what lets the settings form ask
	// for a site URL alone.
	if gotPath != "/_edge/tenant_info" {
		t.Errorf("requested %q, want /_edge/tenant_info", gotPath)
	}
}

func TestResolveCloudIDRejectsUnusableResponses(t *testing.T) {
	cases := map[string]http.HandlerFunc{
		"not found": func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNotFound)
		},
		"server error": func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		},
		"not json": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte("<html>a login page</html>"))
		},
		"json without a cloud id": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"other":"field"}`))
		},
	}

	for name, handler := range cases {
		t.Run(name, func(t *testing.T) {
			srv := httptest.NewServer(handler)
			defer srv.Close()

			_, err := ResolveCloudID(context.Background(), srv.Client(), srv.URL)
			if !errors.Is(err, ErrTenantUnreadable) {
				t.Errorf("ResolveCloudID() error = %v, want ErrTenantUnreadable", err)
			}
		})
	}
}

func TestResolveCloudIDReportsAnUnreachableSite(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	url := srv.URL
	srv.Close() // nothing is listening now

	_, err := ResolveCloudID(context.Background(), http.DefaultClient, url)
	if !errors.Is(err, ErrTenantUnreadable) {
		t.Errorf("ResolveCloudID() error = %v, want ErrTenantUnreadable", err)
	}
}
