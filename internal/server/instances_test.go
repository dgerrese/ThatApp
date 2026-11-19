package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/dgerrese/ThatApp/internal/crypto"
	"github.com/dgerrese/ThatApp/internal/jira"
	"github.com/dgerrese/ThatApp/internal/store"
)

// jiraSiteServer stands in for a whole Jira site: the unauthenticated
// tenant-info endpoint and the authenticated /myself endpoint. myselfStatus
// chooses whether the credentials are accepted.
func jiraSiteServer(t *testing.T, myselfStatus int) *httptest.Server {
	t.Helper()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/_edge/tenant_info":
			_, _ = w.Write([]byte(`{"cloudId":"7c41e2b6"}`))
		case "/rest/api/3/myself":
			if myselfStatus != http.StatusOK {
				w.WriteHeader(myselfStatus)
				return
			}
			_, _ = w.Write([]byte(`{"accountId":"5b10a2","displayName":"Dion","active":true}`))
		default:
			// The trap: a search answers an unauthenticated caller happily.
			_, _ = w.Write([]byte(`{"issues":[],"isLast":true}`))
		}
	}))
	t.Cleanup(srv.Close)

	return srv
}

// pointAtSite makes both tenant-info resolution and the resolved API base land
// on the stub site.
func pointAtSite(srv *Server, site *httptest.Server) {
	srv.clients.http = site.Client()
	srv.clients.apiBaseFor = func(string) string { return site.URL }
}

func postInstance(t *testing.T, srv *Server, body string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(http.MethodPost, "/api/instances", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	return rec
}

func TestPostInstanceStoresAVerifiedSite(t *testing.T) {
	srv, db, _ := newServerWithStore(t)
	site := jiraSiteServer(t, http.StatusOK)
	pointAtSite(srv, site)

	rec := postInstance(t, srv, `{
		"name":"Work","siteUrl":"`+site.URL+`",
		"email":"me@example.com","token":"secret"}`)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, http.StatusCreated, rec.Body)
	}

	var got instanceDTO
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decoding body: %v", err)
	}
	if got.Name != "Work" {
		t.Errorf("name = %q, want Work", got.Name)
	}
	if got.APIBaseURL == "" {
		t.Error("apiBaseUrl is empty; creating an instance must resolve it")
	}

	stored, err := db.Instance(context.Background(), got.ID)
	if err != nil {
		t.Fatalf("Instance() returned error: %v", err)
	}
	if len(stored.TokenEnc) == 0 {
		t.Error("stored token is empty")
	}
}

// The trap, at the HTTP boundary: a site that answers searches with 200 and
// /myself with 401 must not produce a stored instance.
func TestPostInstanceRefusesCredentialsJiraRejects(t *testing.T) {
	srv, db, _ := newServerWithStore(t)
	site := jiraSiteServer(t, http.StatusUnauthorized)
	pointAtSite(srv, site)

	rec := postInstance(t, srv, `{
		"name":"Work","siteUrl":"`+site.URL+`",
		"email":"me@example.com","token":"wrong"}`)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d; body %s", rec.Code, http.StatusUnauthorized, rec.Body)
	}

	var body errorBody
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decoding body: %v", err)
	}
	if body.Code != "credentials_rejected" {
		t.Errorf("code = %q, want credentials_rejected", body.Code)
	}

	instances, err := db.Instances(context.Background())
	if err != nil {
		t.Fatalf("Instances() returned error: %v", err)
	}
	if len(instances) != 0 {
		t.Errorf("stored %d instances, want 0: an unverified instance must not persist", len(instances))
	}
}

func TestPostInstanceRejectsBadRequests(t *testing.T) {
	site := jiraSiteServer(t, http.StatusOK)

	cases := map[string]struct {
		body     string
		wantCode string
	}{
		"missing name":     {body: `{"siteUrl":"URL","email":"me@example.com","token":"t"}`, wantCode: "invalid_name"},
		"blank name":       {body: `{"name":"  ","siteUrl":"URL","email":"me@example.com","token":"t"}`, wantCode: "invalid_name"},
		"missing site URL": {body: `{"name":"Work","email":"me@example.com","token":"t"}`, wantCode: "invalid_site_url"},
		"malformed site":   {body: `{"name":"Work","siteUrl":"not-a-url","email":"me@example.com","token":"t"}`, wantCode: "invalid_site_url"},
		"missing email":    {body: `{"name":"Work","siteUrl":"URL","token":"t"}`, wantCode: "invalid_email"},
		"missing token":    {body: `{"name":"Work","siteUrl":"URL","email":"me@example.com"}`, wantCode: "missing_token"},
	}

	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			srv, db, _ := newServerWithStore(t)
			pointAtSite(srv, site)

			rec := postInstance(t, srv, strings.ReplaceAll(tc.body, "URL", site.URL))

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d; body %s", rec.Code, http.StatusBadRequest, rec.Body)
			}
			var body errorBody
			if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
				t.Fatalf("decoding body: %v", err)
			}
			if body.Code != tc.wantCode {
				t.Errorf("code = %q, want %q", body.Code, tc.wantCode)
			}

			instances, err := db.Instances(context.Background())
			if err != nil {
				t.Fatalf("Instances() returned error: %v", err)
			}
			if len(instances) != 0 {
				t.Errorf("stored %d instances, want 0", len(instances))
			}
		})
	}
}

func TestPostInstanceReportsAnUnreadableSiteAsBadGateway(t *testing.T) {
	srv, _, _ := newServerWithStore(t)

	rec := postInstance(t, srv, `{
		"name":"Work","siteUrl":"http://127.0.0.1:1",
		"email":"me@example.com","token":"secret"}`)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, http.StatusBadGateway, rec.Body)
	}
	var body errorBody
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decoding body: %v", err)
	}
	if body.Code != "tenant_unreadable" {
		t.Errorf("code = %q, want tenant_unreadable", body.Code)
	}
}

func TestGetInstancesNeverReturnsTheToken(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)

	sealed, err := sealer.Seal("super-secret-token")
	if err != nil {
		t.Fatalf("sealing: %v", err)
	}
	if _, err := db.CreateInstance(context.Background(), store.InstanceInput{
		Name: "Work", SiteURL: "https://example.atlassian.net",
		APIBaseURL: "https://api.atlassian.com/ex/jira/7c41e2b6",
		Email:      "me@example.com", TokenEnc: sealed,
	}); err != nil {
		t.Fatalf("CreateInstance() returned error: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/instances", nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	raw := rec.Body.String()
	for _, forbidden := range []string{"super-secret-token", "token", "TokenEnc", "apiToken"} {
		if bytes.Contains([]byte(raw), []byte(forbidden)) {
			t.Errorf("response mentions %q; it must carry no token in any form:\n%s", forbidden, raw)
		}
	}

	var got []instanceDTO
	if err := json.NewDecoder(strings.NewReader(raw)).Decode(&got); err != nil {
		t.Fatalf("decoding body: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("returned %d instances, want 1", len(got))
	}
	// CB#5 needs this for issue links.
	if got[0].SiteURL != "https://example.atlassian.net" {
		t.Errorf("siteUrl = %q, want the stored site URL", got[0].SiteURL)
	}
}

func TestGetInstancesReturnsAnEmptyArrayNotNull(t *testing.T) {
	srv, _, _ := newServerWithStore(t)

	req := httptest.NewRequest(http.MethodGet, "/api/instances", nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	// null would make the frontend branch before it can iterate.
	if got := strings.TrimSpace(rec.Body.String()); got != "[]" {
		t.Errorf("body = %q, want []", got)
	}
}

func seedInstanceAtSite(t *testing.T, db *store.Store, sealer *crypto.Sealer, site *httptest.Server) *store.Instance {
	t.Helper()

	sealed, err := sealer.Seal("secret")
	if err != nil {
		t.Fatalf("sealing: %v", err)
	}
	inst, err := db.CreateInstance(context.Background(), store.InstanceInput{
		Name: "Work", SiteURL: site.URL, APIBaseURL: site.URL,
		Email: "me@example.com", TokenEnc: sealed,
	})
	if err != nil {
		t.Fatalf("CreateInstance() returned error: %v", err)
	}

	return inst
}

func patchInstance(t *testing.T, srv *Server, id int64, body string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(http.MethodPatch,
		"/api/instances/"+strconv.FormatInt(id, 10), strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	return rec
}

func TestPatchInstanceWithoutATokenKeepsTheStoredOne(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	site := jiraSiteServer(t, http.StatusOK)
	pointAtSite(srv, site)
	inst := seedInstanceAtSite(t, db, sealer, site)
	before := inst.TokenEnc

	rec := patchInstance(t, srv, inst.ID, `{
		"name":"Renamed","siteUrl":"`+site.URL+`","email":"me@example.com"}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body)
	}

	after, err := db.Instance(context.Background(), inst.ID)
	if err != nil {
		t.Fatalf("Instance() returned error: %v", err)
	}
	if after.Name != "Renamed" {
		t.Errorf("name = %q, want Renamed", after.Name)
	}
	if !bytes.Equal(after.TokenEnc, before) {
		t.Error("stored token changed; a PATCH with no token must keep it")
	}
}

// Every write re-verifies, with no exception for a rename. This is the test that
// catches an "unless only the name changed" shortcut being reintroduced.
func TestPatchInstanceVerifiesEvenWhenOnlyTheNameChanges(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	good := jiraSiteServer(t, http.StatusOK)
	inst := seedInstanceAtSite(t, db, sealer, good)

	// Jira now rejects the stored credential.
	bad := jiraSiteServer(t, http.StatusUnauthorized)
	if err := db.UpdateInstance(context.Background(), inst.ID, store.InstanceInput{
		Name: inst.Name, SiteURL: bad.URL, APIBaseURL: bad.URL,
		Email: inst.Email, TokenEnc: inst.TokenEnc,
	}); err != nil {
		t.Fatalf("UpdateInstance() returned error: %v", err)
	}
	pointAtSite(srv, bad)

	rec := patchInstance(t, srv, inst.ID, `{
		"name":"Renamed","siteUrl":"`+bad.URL+`","email":"me@example.com"}`)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, http.StatusUnauthorized, rec.Body)
	}

	after, err := db.Instance(context.Background(), inst.ID)
	if err != nil {
		t.Fatalf("Instance() returned error: %v", err)
	}
	if after.Name == "Renamed" {
		t.Error("the rename persisted despite the identity check failing")
	}
}

func TestPatchInstanceRejectsAMissingID(t *testing.T) {
	srv, _, _ := newServerWithStore(t)

	rec := patchInstance(t, srv, 404, `{"name":"X","siteUrl":"https://x.atlassian.net","email":"me@example.com"}`)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}

// PATCH validates its body through the same decodeInstanceRequest as POST; this
// proves the handler actually routes through it rather than a diverging copy.
func TestPatchInstanceRejectsAMalformedSiteURL(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	site := jiraSiteServer(t, http.StatusOK)
	inst := seedInstanceAtSite(t, db, sealer, site)

	rec := patchInstance(t, srv, inst.ID, `{"name":"Renamed","siteUrl":"not-a-url","email":"me@example.com"}`)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, http.StatusBadRequest, rec.Body)
	}
	var body errorBody
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decoding body: %v", err)
	}
	if body.Code != "invalid_site_url" {
		t.Errorf("code = %q, want invalid_site_url", body.Code)
	}

	after, err := db.Instance(context.Background(), inst.ID)
	if err != nil {
		t.Fatalf("Instance() returned error: %v", err)
	}
	if after.Name == "Renamed" {
		t.Error("the rename persisted despite the malformed site URL")
	}
}

// The cascade itself is covered in package store, where a child row can be
// inserted directly. This asserts only what the handler adds: the row goes, and
// the response is a 204.
func TestDeleteInstanceRemovesTheRow(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	site := jiraSiteServer(t, http.StatusOK)
	inst := seedInstanceAtSite(t, db, sealer, site)

	req := httptest.NewRequest(http.MethodDelete,
		"/api/instances/"+strconv.FormatInt(inst.ID, 10), nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, http.StatusNoContent, rec.Body)
	}

	instances, err := db.Instances(context.Background())
	if err != nil {
		t.Fatalf("Instances() returned error: %v", err)
	}
	if len(instances) != 0 {
		t.Errorf("instances remaining = %d, want 0", len(instances))
	}
}

// Deleting must not require Jira: there is nothing left to verify.
func TestDeleteInstanceWorksWithJiraUnreachable(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	site := jiraSiteServer(t, http.StatusOK)
	inst := seedInstanceAtSite(t, db, sealer, site)
	site.Close()

	req := httptest.NewRequest(http.MethodDelete,
		"/api/instances/"+strconv.FormatInt(inst.ID, 10), nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Errorf("status = %d, want %d; body %s", rec.Code, http.StatusNoContent, rec.Body)
	}
}

func testConnection(t *testing.T, srv *Server, id int64) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(http.MethodPost,
		"/api/instances/"+strconv.FormatInt(id, 10)+"/test", nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	return rec
}

func TestConnectionTestReportsTheIdentity(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	site := jiraSiteServer(t, http.StatusOK)
	pointAtSite(srv, site)
	inst := seedInstanceAtSite(t, db, sealer, site)

	rec := testConnection(t, srv, inst.ID)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, http.StatusOK, rec.Body)
	}
	var got connectionTestDTO
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decoding body: %v", err)
	}
	if got.AccountID != "5b10a2" {
		t.Errorf("accountId = %q, want 5b10a2", got.AccountID)
	}
	if got.DisplayName != "Dion" {
		t.Errorf("displayName = %q, want Dion", got.DisplayName)
	}
}

// The trap, stated exactly as CB#22 framed it: a stub that answers search/jql with
// 200 {"issues": []} and /myself with 401 must make the test FAIL.
func TestConnectionTestFailsWhenOnlyMyselfRejects(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	site := jiraSiteServer(t, http.StatusUnauthorized)
	pointAtSite(srv, site)
	inst := seedInstanceAtSite(t, db, sealer, site)

	rec := testConnection(t, srv, inst.ID)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d; a search-based test would have passed here", rec.Code, http.StatusUnauthorized)
	}
	var body errorBody
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decoding body: %v", err)
	}
	if body.Code != "credentials_rejected" {
		t.Errorf("code = %q, want credentials_rejected", body.Code)
	}
}

// 401 versus 502: a rejected credential is the user's to fix, an unreachable
// host is not.
func TestConnectionTestDistinguishesUnreachableFromRejected(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	site := jiraSiteServer(t, http.StatusOK)
	pointAtSite(srv, site)
	inst := seedInstanceAtSite(t, db, sealer, site)
	site.Close()

	rec := testConnection(t, srv, inst.ID)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadGateway)
	}
	var body errorBody
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decoding body: %v", err)
	}
	if body.Code != "instance_unreachable" {
		t.Errorf("code = %q, want instance_unreachable", body.Code)
	}
}

// A 404 from /myself means the site answered but this account has no access
// to the Jira product on it — a realistic wrong-account misconfiguration, not
// a server fault.
func TestConnectionTestReportsAccountNotFoundAsBadGateway(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	site := jiraSiteServer(t, http.StatusNotFound)
	pointAtSite(srv, site)
	inst := seedInstanceAtSite(t, db, sealer, site)

	rec := testConnection(t, srv, inst.ID)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, http.StatusBadGateway, rec.Body)
	}
	var body errorBody
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decoding body: %v", err)
	}
	if body.Code != "account_not_found" {
		t.Errorf("code = %q, want account_not_found", body.Code)
	}
}

// A status writeInstanceError does not recognize (418 here) falls to the
// default branch, which must not leak the underlying error's text — that text
// carries the request path and the Jira response body.
func TestConnectionTestHidesTheUnderlyingErrorOnAnUnmappedStatus(t *testing.T) {
	srv, db, sealer := newServerWithStore(t)
	site := jiraSiteServer(t, http.StatusTeapot)
	pointAtSite(srv, site)
	inst := seedInstanceAtSite(t, db, sealer, site)

	rec := testConnection(t, srv, inst.ID)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, http.StatusInternalServerError, rec.Body)
	}
	var body errorBody
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decoding body: %v", err)
	}
	if body.Code != "unexpected" {
		t.Errorf("code = %q, want unexpected", body.Code)
	}
	if strings.Contains(body.Message, "/rest/api/3/myself") || strings.Contains(body.Message, site.URL) {
		t.Errorf("message = %q, leaks the underlying error's request detail", body.Message)
	}
}

func TestConnectionTestRejectsAMissingID(t *testing.T) {
	srv, _, _ := newServerWithStore(t)

	if rec := testConnection(t, srv, 404); rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}

// CB#79: what Jira said is only useful if something records it. Every mapped
// failure — classified or not — is logged once with the request, the status
// and Jira's own body, and never with the credentials that made the request.
func TestInstanceErrorForLogsWhatJiraSaid(t *testing.T) {
	cases := []struct {
		name     string
		status   int
		body     string
		wantCode string
	}{
		{"a 401", http.StatusUnauthorized, `{"code":401,"message":"Unauthorized; scope does not match"}`, "credentials_rejected"},
		{"a 403", http.StatusForbidden, `{"errorMessages":["You do not have permission"]}`, "permission_denied"},
		{"a 404", http.StatusNotFound, `{"errorMessages":["Issue does not exist"]}`, "account_not_found"},
		{"a 429", http.StatusTooManyRequests, `{"message":"slow down"}`, "rate_limited"},
		{"a 5xx", http.StatusBadGateway, `upstream exploded`, "instance_unreachable"},
		{"an unmapped status", http.StatusTeapot, `short and stout`, "unexpected"},
		{"a multi-line body", http.StatusBadGateway, "<html>\r\n<body>502 Bad Gateway</body>\n</html>", "instance_unreachable"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			jiraSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			t.Cleanup(jiraSrv.Close)

			client, err := jira.New(jiraSrv.URL, "me@example.com", "s3cret-token")
			if err != nil {
				t.Fatalf("building the client: %v", err)
			}
			_, jiraErr := client.Myself(context.Background())
			if jiraErr == nil {
				t.Fatal("Myself() succeeded against a failing server")
			}

			var logged bytes.Buffer
			previous := log.Writer()
			log.SetOutput(&logged)
			t.Cleanup(func() { log.SetOutput(previous) })

			_, code, _ := instanceErrorFor(jiraErr)

			if code != tc.wantCode {
				t.Errorf("code = %q, want %q (the response contract must not move)", code, tc.wantCode)
			}
			line := logged.String()
			if n := strings.Count(line, "\n"); n != 1 {
				t.Errorf("logged %d lines, want exactly 1: %q", n, line)
			}
			// A body carrying its own newlines (e.g. a proxy's HTML error page)
			// is flattened in the log line, so it no longer appears verbatim;
			// every other row's body has no newline and must still appear as-is.
			wants := []string{"/rest/api/3/myself", strconv.Itoa(tc.status)}
			if !strings.Contains(tc.body, "\n") {
				wants = append(wants, tc.body)
			}
			for _, want := range wants {
				if !strings.Contains(line, want) {
					t.Errorf("log line %q does not contain %q", line, want)
				}
			}
			for _, secret := range []string{"me@example.com", "s3cret-token"} {
				if strings.Contains(line, secret) {
					t.Errorf("log line %q leaks %q", line, secret)
				}
			}
		})
	}
}

func TestInstanceErrorForTellsTheUserWhatToDo(t *testing.T) {
	cases := []struct {
		name        string
		status      int
		retryAfter  string
		wantStatus  int
		wantCode    string
		wantMessage string
	}{
		{
			"a 401", http.StatusUnauthorized, "",
			http.StatusUnauthorized, "credentials_rejected",
			"Jira did not accept the API token for this request; check the token and its scopes",
		},
		{
			"a 403", http.StatusForbidden, "",
			http.StatusForbidden, "permission_denied",
			"your Jira account lacks permission for this",
		},
		{
			"a 429 with a one-second wait", http.StatusTooManyRequests, "1",
			http.StatusServiceUnavailable, "rate_limited",
			"Jira is rate-limiting requests; try again in 1 second",
		},
		{
			"a 429 with a 30-second wait", http.StatusTooManyRequests, "30",
			http.StatusServiceUnavailable, "rate_limited",
			"Jira is rate-limiting requests; try again in 30 seconds",
		},
		{
			"a 429 with a 90-second wait rounds up to minutes", http.StatusTooManyRequests, "90",
			http.StatusServiceUnavailable, "rate_limited",
			"Jira is rate-limiting requests; try again in 2 minutes",
		},
		{
			"a 429 with no usable wait", http.StatusTooManyRequests, "",
			http.StatusServiceUnavailable, "rate_limited",
			"Jira is rate-limiting requests; try again shortly",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			jiraSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				if tc.retryAfter != "" {
					w.Header().Set("Retry-After", tc.retryAfter)
				}
				w.WriteHeader(tc.status)
			}))
			t.Cleanup(jiraSrv.Close)

			client, err := jira.New(jiraSrv.URL, "me@example.com", "s3cret-token")
			if err != nil {
				t.Fatalf("building the client: %v", err)
			}
			_, jiraErr := client.Myself(context.Background())
			if jiraErr == nil {
				t.Fatal("Myself() succeeded against a failing server")
			}

			status, code, message := instanceErrorFor(jiraErr)

			if status != tc.wantStatus {
				t.Errorf("status = %d, want %d", status, tc.wantStatus)
			}
			if code != tc.wantCode {
				t.Errorf("code = %q, want %q", code, tc.wantCode)
			}
			if message != tc.wantMessage {
				t.Errorf("message = %q, want %q", message, tc.wantMessage)
			}
		})
	}
}

func TestWaitPhrase(t *testing.T) {
	cases := []struct {
		wait time.Duration
		want string
	}{
		{1 * time.Second, "1 second"},
		{time.Duration(59.4 * float64(time.Second)), "1 minute"},
		{60 * time.Second, "1 minute"},
		{61 * time.Second, "2 minutes"},
		{90 * time.Second, "2 minutes"},
	}

	for _, tc := range cases {
		t.Run(tc.want+"/"+tc.wait.String(), func(t *testing.T) {
			if got := waitPhrase(tc.wait); got != tc.want {
				t.Errorf("waitPhrase(%v) = %q, want %q", tc.wait, got, tc.want)
			}
		})
	}
}

// The issue search cancels its in-flight fetch on every debounced keystroke
// (that-issue-search.ts), and leaving Today/Week mid-fan-out does the same:
// neither is Jira failing, so instanceErrorFor must not log either.
func TestInstanceErrorForDoesNotLogACancelledRequest(t *testing.T) {
	jiraSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"accountId":"5b10a2","displayName":"Dion","active":true}`))
	}))
	t.Cleanup(jiraSrv.Close)

	client, err := jira.New(jiraSrv.URL, "me@example.com", "s3cret-token")
	if err != nil {
		t.Fatalf("building the client: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, jiraErr := client.Myself(ctx)
	if jiraErr == nil {
		t.Fatal("Myself() succeeded against an already-cancelled context")
	}
	if !errors.Is(jiraErr, context.Canceled) {
		t.Fatalf("Myself() error %v does not wrap context.Canceled", jiraErr)
	}

	var logged bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&logged)
	t.Cleanup(func() { log.SetOutput(previous) })

	_, code, _ := instanceErrorFor(jiraErr)

	if code != "instance_unreachable" {
		t.Errorf("code = %q, want instance_unreachable (a cancelled request classifies the same as today)", code)
	}
	if logged.Len() != 0 {
		t.Errorf("logged %q; a cancelled request must not be logged", logged.String())
	}
}
