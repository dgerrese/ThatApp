// Command smoke checks that the Jira client can reach real sites and fetch the
// issues assigned to you, reading their credentials from the database exactly as
// the server will. It is read-only against Jira: the only call it makes is
// SearchAssigned, and it holds no reference to the worklog write methods.
//
// It is not part of the build: the leading underscore on this directory keeps
// `go build ./...`, `go test ./...` and golangci-lint from ever seeing it, so
// `make verify` stays offline. Run it explicitly by path.
//
// Seed a site once. This is the only step that takes a plaintext token, and it
// stands in for the settings UI that ticket 8 brings:
//
//	docker compose run --rm --no-deps app go run ./internal/jira/_smoke \
//	  seed -name Work -url https://your-site.atlassian.net -email you@example.com -token ...
//
// Then every later run reads the sealed token straight from the database:
//
//	docker compose run --rm --no-deps app go run ./internal/jira/_smoke
//	docker compose run --rm --no-deps app go run ./internal/jira/_smoke -site Work
//
// Configuration comes from WD_SECRET_KEY and WD_DB_PATH, which docker-compose.yml
// already sets. There are no smoke-only environment variables.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/dgerrese/work-dashboard/internal/config"
	"github.com/dgerrese/work-dashboard/internal/crypto"
	"github.com/dgerrese/work-dashboard/internal/jira"
	"github.com/dgerrese/work-dashboard/internal/store"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "smoke:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return err
	}
	sealer, err := crypto.NewSealer(cfg.Secret)
	if err != nil {
		return err
	}
	db, err := store.Open(cfg.DBPath)
	if err != nil {
		return err
	}

	ctx := context.Background()
	switch {
	case len(args) > 0 && args[0] == "seed":
		return seed(ctx, db, sealer, args[1:])
	case len(args) > 0 && args[0] == "diagnose":
		return diagnose(ctx, db, sealer, args[1:])
	default:
		return check(ctx, db, sealer, args)
	}
}

// seed stores one Jira site, sealing its token the way the settings UI will.
func seed(ctx context.Context, db *store.Store, sealer *crypto.Sealer, args []string) error {
	flags := flag.NewFlagSet("seed", flag.ExitOnError)
	name := flags.String("name", "", "label for the site")
	baseURL := flags.String("url", "", "https://your-site.atlassian.net")
	email := flags.String("email", "", "Atlassian account email")
	token := flags.String("token", "", "API token from id.atlassian.com/manage-profile/security/api-tokens")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *name == "" || *baseURL == "" || *email == "" || *token == "" {
		return fmt.Errorf("seed needs -name, -url, -email and -token")
	}

	// Fail on a malformed URL here rather than at the first API call.
	if _, err := jira.New(*baseURL, *email, *token); err != nil {
		return err
	}

	sealed, err := sealer.Seal(*token)
	if err != nil {
		return fmt.Errorf("sealing token: %w", err)
	}
	inst, err := db.CreateInstance(ctx, store.InstanceInput{
		Name: *name, SiteURL: *baseURL, Email: *email, TokenEnc: sealed,
	})
	if err != nil {
		return err
	}
	fmt.Printf("seeded %q as instance %d\n", inst.Name, inst.ID)

	return nil
}

// check calls every stored site with its own decrypted token.
func check(ctx context.Context, db *store.Store, sealer *crypto.Sealer, args []string) error {
	flags := flag.NewFlagSet("check", flag.ExitOnError)
	site := flags.String("site", "", "limit to the instance with this name")
	if err := flags.Parse(args); err != nil {
		return err
	}

	instances, err := db.Instances(ctx)
	if err != nil {
		return err
	}
	if len(instances) == 0 {
		return fmt.Errorf("no instances stored — run `smoke seed` first")
	}

	for _, inst := range instances {
		if *site != "" && inst.Name != *site {
			continue
		}
		if err := checkInstance(ctx, sealer, inst); err != nil {
			return fmt.Errorf("instance %q: %w", inst.Name, err)
		}
	}

	return nil
}

func checkInstance(ctx context.Context, sealer *crypto.Sealer, inst store.Instance) error {
	token, err := sealer.Open(inst.TokenEnc)
	if err != nil {
		return fmt.Errorf("opening sealed token: %w", err)
	}

	base := inst.APIBaseURL
	if base == "" {
		base = inst.SiteURL
	}
	client, err := jira.New(base, inst.Email, token)
	if err != nil {
		return err
	}

	issues, err := client.SearchAssigned(ctx)
	if err != nil {
		return fmt.Errorf("search: %w", err)
	}
	fmt.Printf("%s (%s): %d assigned issues\n", inst.Name, base, len(issues))
	for i, issue := range issues {
		if i == 5 {
			fmt.Println("  ...")
			break
		}
		fmt.Printf("  %s  %s\n", issue.Key, issue.Summary)
	}

	return nil
}

// diagnose answers why a search came back empty by separating the three things
// that produce an empty result with no error: who Jira thinks the caller is,
// what the caller can see at all, and which clause of assignedJQL excludes the
// issues. It deliberately bypasses the jira package and speaks HTTP directly, so
// that what is printed is Jira's own answer rather than this repo's parsing of
// it. Read-only: GET /myself and POST /search/jql.
func diagnose(ctx context.Context, db *store.Store, sealer *crypto.Sealer, args []string) error {
	flags := flag.NewFlagSet("diagnose", flag.ExitOnError)
	site := flags.String("site", "", "limit to the instance with this name")
	if err := flags.Parse(args); err != nil {
		return err
	}

	instances, err := db.Instances(ctx)
	if err != nil {
		return err
	}
	if len(instances) == 0 {
		return fmt.Errorf("no instances stored — run `smoke seed` first")
	}

	for _, inst := range instances {
		if *site != "" && inst.Name != *site {
			continue
		}
		token, err := sealer.Open(inst.TokenEnc)
		if err != nil {
			return fmt.Errorf("instance %q: opening sealed token: %w", inst.Name, err)
		}
		probe := &probe{baseURL: strings.TrimSuffix(inst.SiteURL, "/"), email: inst.Email, token: token}

		fmt.Printf("== %s (%s)\n", inst.Name, probe.baseURL)
		fmt.Printf("   seeded email: %s\n", inst.Email)
		fmt.Printf("   token: %d chars, prefix %q, surrounding whitespace: %t\n",
			len(token), tokenPrefix(token), token != strings.TrimSpace(token))

		// Basic auth against the site host is what internal/jira does today. A
		// scoped token is only accepted on api.atlassian.com/ex/jira/{cloudId},
		// so trying both says which kind of token this is.
		siteOK := probe.whoami(ctx, "site host", probe.baseURL)

		gatewayOK := false
		cloudID, err := probe.cloudID(ctx)
		if err != nil {
			fmt.Printf("   cloud id: unavailable (%v)\n", err)
		} else {
			fmt.Printf("   cloud id: %s\n", cloudID)
			gatewayOK = probe.whoami(ctx, "api gateway", "https://api.atlassian.com/ex/jira/"+cloudID)
		}

		switch {
		case siteOK:
			for _, q := range diagnosticQueries {
				probe.count(ctx, q.label, q.jql)
			}
		case gatewayOK:
			fmt.Println("   -> the credentials are good but only via the gateway: this is a SCOPED token")
		default:
			fmt.Println("   -> neither host accepted the credentials: email/token pair is wrong")
		}
		fmt.Println()
	}

	return nil
}

var diagnosticQueries = []struct{ label, jql string }{
	{"everything visible to this token", "order by updated DESC"},
	{"assignee = currentUser()", "assignee = currentUser() ORDER BY updated DESC"},
	{"assignee = currentUser(), not Done", assignedJQLCopy},
	{"anything not Done", "statusCategory != Done ORDER BY updated DESC"},
}

// assignedJQLCopy mirrors assignedJQL in internal/jira/search.go. It is copied
// rather than exported: this file is a throwaway diagnostic and must not shape
// the package's API.
const assignedJQLCopy = `assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC`

type probe struct {
	baseURL, email, token string
}

func (p *probe) do(ctx context.Context, method, path string, body any, out any) error {
	return p.doAt(ctx, p.baseURL, method, path, body, out)
}

func (p *probe) doAt(ctx context.Context, base, method, path string, body any, out any) error {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, base+path, reader)
	if err != nil {
		return err
	}
	req.SetBasicAuth(p.email, p.token)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("%s %s: status %d: %s", method, path, resp.StatusCode, detail)
	}

	return json.NewDecoder(resp.Body).Decode(out)
}

// whoami reports the account a host resolves the credentials to, and whether it
// accepted them at all. It returns false rather than an error so the caller can
// try the other host.
func (p *probe) whoami(ctx context.Context, label, base string) bool {
	var me struct {
		AccountID   string `json:"accountId"`
		DisplayName string `json:"displayName"`
		Email       string `json:"emailAddress"`
		Active      bool   `json:"active"`
	}
	if err := p.doAt(ctx, base, http.MethodGet, "/rest/api/3/myself", nil, &me); err != nil {
		fmt.Printf("   %-12s /myself REJECTED: %v\n", label, err)
		return false
	}
	fmt.Printf("   %-12s /myself OK: %s <%s> accountId=%s active=%t\n",
		label, me.DisplayName, me.Email, me.AccountID, me.Active)

	return true
}

// cloudID reads the site's tenant id from the unauthenticated _edge endpoint,
// which is what the api.atlassian.com gateway path is keyed on.
func (p *probe) cloudID(ctx context.Context) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.baseURL+"/_edge/tenant_info", nil)
	if err != nil {
		return "", err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("status %d", resp.StatusCode)
	}
	var info struct {
		CloudID string `json:"cloudId"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return "", err
	}

	return info.CloudID, nil
}

// tokenPrefix returns enough of the token to tell the ATATT/ATCTT families
// apart without disclosing anything usable.
func tokenPrefix(token string) string {
	trimmed := strings.TrimSpace(token)
	if len(trimmed) < 5 {
		return trimmed
	}

	return trimmed[:5]
}

// count runs one JQL and reports how many issues came back, printing the first
// few keys so a non-zero result can be recognised.
func (p *probe) count(ctx context.Context, label, jql string) {
	var resp struct {
		Issues []struct {
			Key    string `json:"key"`
			Fields struct {
				Status struct {
					Name           string `json:"name"`
					StatusCategory struct {
						Key string `json:"key"`
					} `json:"statusCategory"`
				} `json:"status"`
			} `json:"fields"`
		} `json:"issues"`
	}
	body := map[string]any{
		"jql":        jql,
		"fields":     []string{"status"},
		"maxResults": 5,
	}
	if err := p.do(ctx, http.MethodPost, "/rest/api/3/search/jql", body, &resp); err != nil {
		fmt.Printf("   %-38s ERROR %v\n", label, err)
		return
	}

	fmt.Printf("   %-38s %d issue(s)\n", label, len(resp.Issues))
	for _, issue := range resp.Issues {
		fmt.Printf("       %-14s %s [%s]\n",
			issue.Key, issue.Fields.Status.Name, issue.Fields.Status.StatusCategory.Key)
	}
}
