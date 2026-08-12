package server

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dgerrese/work-dashboard/internal/atlassian"
	"github.com/dgerrese/work-dashboard/internal/store"
)

// tenantInfoServer stands in for a Jira site's unauthenticated tenant-info
// endpoint.
func tenantInfoServer(t *testing.T, cloudID string) *httptest.Server {
	t.Helper()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/_edge/tenant_info" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_, _ = w.Write([]byte(`{"cloudId":"` + cloudID + `"}`))
	}))
	t.Cleanup(srv.Close)

	return srv
}

func TestForInstanceResolvesAndPersistsAMissingAPIBase(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	site := tenantInfoServer(t, "7c41e2b6")

	sealed, err := sealer.Seal("token")
	if err != nil {
		t.Fatalf("sealing: %v", err)
	}
	inst, err := db.CreateInstance(context.Background(), store.InstanceInput{
		Name: "Work", SiteURL: site.URL, Email: "me@example.com", TokenEnc: sealed,
	})
	if err != nil {
		t.Fatalf("CreateInstance() returned error: %v", err)
	}

	clients := srv.clients
	clients.http = site.Client()

	if _, err := clients.forInstance(context.Background(), inst); err != nil {
		t.Fatalf("forInstance() returned error: %v", err)
	}

	// Persisted, not merely computed: the next call must not repeat the lookup.
	reloaded, err := db.Instance(context.Background(), inst.ID)
	if err != nil {
		t.Fatalf("Instance() returned error: %v", err)
	}
	if want := atlassian.APIBaseURL("7c41e2b6"); reloaded.APIBaseURL != want {
		t.Errorf("APIBaseURL = %q, want %q", reloaded.APIBaseURL, want)
	}
}

func TestForInstanceLeavesAStoredAPIBaseAlone(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)

	sealed, err := sealer.Seal("token")
	if err != nil {
		t.Fatalf("sealing: %v", err)
	}
	const apiBase = "https://api.atlassian.com/ex/jira/already-known"
	inst, err := db.CreateInstance(context.Background(), store.InstanceInput{
		Name: "Work", SiteURL: "https://example.atlassian.net", APIBaseURL: apiBase,
		Email: "me@example.com", TokenEnc: sealed,
	})
	if err != nil {
		t.Fatalf("CreateInstance() returned error: %v", err)
	}

	// No tenant-info server exists, so any resolution attempt fails the test.
	if _, err := srv.clients.forInstance(context.Background(), inst); err != nil {
		t.Fatalf("forInstance() returned error: %v", err)
	}

	reloaded, err := db.Instance(context.Background(), inst.ID)
	if err != nil {
		t.Fatalf("Instance() returned error: %v", err)
	}
	if reloaded.APIBaseURL != apiBase {
		t.Errorf("APIBaseURL = %q, want it unchanged at %q", reloaded.APIBaseURL, apiBase)
	}
}

func TestForInstanceReportsAnUnreadableSite(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)

	sealed, err := sealer.Seal("token")
	if err != nil {
		t.Fatalf("sealing: %v", err)
	}
	// A migrated row whose site URL was never reachable.
	inst, err := db.CreateInstance(context.Background(), store.InstanceInput{
		Name: "Work", SiteURL: "http://127.0.0.1:1", Email: "me@example.com", TokenEnc: sealed,
	})
	if err != nil {
		t.Fatalf("CreateInstance() returned error: %v", err)
	}

	_, err = srv.clients.forInstance(context.Background(), inst)
	if !errors.Is(err, atlassian.ErrTenantUnreadable) {
		t.Errorf("forInstance() error = %v, want ErrTenantUnreadable", err)
	}
}

// A migrated gateway-URL row has no site to resolve from and needs none.
func TestForInstanceWorksWithNoSiteURL(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)

	sealed, err := sealer.Seal("token")
	if err != nil {
		t.Fatalf("sealing: %v", err)
	}
	inst, err := db.CreateInstance(context.Background(), store.InstanceInput{
		Name: "Work", APIBaseURL: "https://api.atlassian.com/ex/jira/7c41e2b6",
		Email: "me@example.com", TokenEnc: sealed,
	})
	if err != nil {
		t.Fatalf("CreateInstance() returned error: %v", err)
	}

	if _, err := srv.clients.forInstance(context.Background(), inst); err != nil {
		t.Errorf("forInstance() returned error: %v", err)
	}
}
