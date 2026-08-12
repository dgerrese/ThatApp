# Settings View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-08-12
**Supersedes:** nothing
**Superseded by:** nothing

**Goal:** Ship [#4](https://github.com/dgerrese/work-dashboard/issues/4) — the Settings view, where Jira instances are added, edited, removed and credential-tested, backed by an instance record that finally distinguishes the site URL from the API base.

**Architecture:** `instances` grows `site_url` and `api_base_url`, both nullable, split by migration. A new `internal/atlassian` package owns cloud-id resolution and the gateway URL template, so `internal/jira` never derives one URL from the other. `internal/server` gains a per-instance client factory that unseals the token, resolves a missing API base on demand, and builds a `jira.Client`. The frontend gains its real shell — router, typed API layer, three `wd-*` components and the Settings view.

**Tech Stack:** Go standard library + `modernc.org/sqlite`; vanilla TypeScript bundled by esbuild; Tailwind CSS v4; Playwright.

**Design of record:** [`../specs/2026-08-12-settings-view-design.md`](../specs/2026-08-12-settings-view-design.md), which elaborates [`../specs/2026-08-04-work-dashboard-design.md`](../specs/2026-08-04-work-dashboard-design.md).

## Global Constraints

Every task's requirements implicitly include this section.

- **Everything runs in Docker.** There is no Go, Node or npm on the host. Never run them bare.
- **No JavaScript frameworks.** Vanilla JS only; TypeScript for typing.
- **Tailwind CSS v4**, CSS-first. No `tailwind.config.js`; theme values live in `@theme` in `web/src/styles.css`.
- **Reusable UI is a native WebComponent** registered as `wd-*`, **light DOM, never shadow DOM**.
- **Keep the initial HTTP response under 14kB.** Views load through dynamic `import()`.
- **Browser support is Firefox and Chromium.** Safari and WebKit are an explicit non-goal — never add WebKit to the Playwright matrix.
- **No test ever contacts a real Jira instance.** Use `httptest.Server` in Go and `page.route` in Playwright.
- **TypeScript is `strict` with `noUncheckedIndexedAccess`.** Do not weaken `web/tsconfig.json`. No `any`, no `as any`, no non-null assertions.
- **Go: standard library first.** The approved non-stdlib set is `modernc.org/sqlite` and `golang.org/x/sync`. Adding anything else is a blocker, not a decision.
- **Wrap errors with `%w`** and context about what was attempted. Table-driven tests with `t.Run` subtests.
- **Tests use `context.Background()`**, matching every existing test in the repo. `t.Context()` exists on Go 1.26 and is arguably better, but a second idiom for the same thing is worse than the marginal gain. Add `"context"` to the imports of any test file that gains its first use.
- **Comments are rare and earn their place** — a non-obvious "why", a workaround, a subtle invariant. Never narrate the next line.
- **Naming:** a function's name must let a reader predict what it returns. Bare verbs (`process`, `handle`, `build`) fail that test.
- **Adding a `WD_*` variable is a public API change.** This ticket adds none.

**Verification commands** (all run through Compose; never bare):

```shell
docker compose run --rm --no-deps app go test ./internal/store/ -run TestName -v
docker compose run --rm --no-deps web npx tsc --noEmit
docker compose run --rm --no-deps web npm run lint
make verify        # the full gate: golangci-lint, eslint, tsc, go test
make test-e2e      # Playwright; brings the stack up itself
```

---

### Task 1: Split the instance URLs in schema and store

**Files:**
- Create: `internal/store/migrations/2026-08-12_090000_split_instance_urls.sql`
- Modify: `internal/store/instances.go`
- Modify: `internal/store/instances_test.go`
- Modify: `internal/store/migrate_test.go`
- Modify: `internal/jira/_smoke/main.go`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```go
  type Instance struct {
      ID         int64
      Name       string
      SiteURL    string   // "" when the column is NULL
      APIBaseURL string   // "" when the column is NULL
      Email      string
      TokenEnc   []byte `json:"-"`
      CreatedAt  time.Time
  }

  type InstanceInput struct {
      Name       string
      SiteURL    string
      APIBaseURL string
      Email      string
      TokenEnc   []byte
  }

  var ErrInstanceNeedsURL = errors.New("store: instance needs a site URL or an API base URL")

  func (s *Store) CreateInstance(ctx context.Context, in InstanceInput) (*Instance, error)
  func (s *Store) UpdateInstance(ctx context.Context, id int64, in InstanceInput) error
  func (s *Store) SetInstanceAPIBase(ctx context.Context, id int64, apiBaseURL string) error
  ```
  `Instances`, `Instance` and `DeleteInstance` keep their existing signatures.

**Background the implementer needs:**

`applyMigration` in `internal/store/migrate.go` runs each migration inside a transaction. `PRAGMA foreign_keys` is a no-op inside a transaction, so foreign keys cannot be disabled there. With them on, `DROP TABLE instances` implicitly deletes every row first, firing the `ON DELETE CASCADE` on `pinned_issues`, `time_entries` and `timers`. **A create-copy-drop-rename rebuild therefore destroys the user's logged time.** This was verified, not reasoned about. Use `ADD COLUMN` / `DROP COLUMN`, which are supported by `modernc.org/sqlite`, including a column-level `CHECK`.

`ALTER TABLE` cannot add a *table-level* constraint, so "at least one URL is present" cannot live in SQL. It is enforced by `InstanceInput.validate` instead.

- [ ] **Step 1: Write the failing migration tests**

Add to `internal/store/migrate_test.go`:

```go
// seedPreMigrationDB builds a database in the shape the initial migration left,
// records that migration as applied, and inserts one instance plus one child
// row. Opening it afterwards runs only the migrations that follow.
func seedPreMigrationDB(t *testing.T, baseURL string) string {
	t.Helper()

	path := filepath.Join(t.TempDir(), "test.db")
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=foreign_keys(1)")
	if err != nil {
		t.Fatalf("opening seed database: %v", err)
	}
	defer func() { _ = db.Close() }()

	initial, err := migrationsFS.ReadFile("migrations/2026-08-07_120000_initial.sql")
	if err != nil {
		t.Fatalf("reading initial migration: %v", err)
	}
	stmts := []string{
		string(initial),
		`CREATE TABLE schema_migrations (
			version VARCHAR(150) PRIMARY KEY, applied_at DATETIME NOT NULL)`,
		`INSERT INTO schema_migrations (version, applied_at)
		 VALUES ('2026-08-07_120000_initial.sql', '2026-08-07T12:00:00Z')`,
		`INSERT INTO instances (id, name, base_url, email, api_token_enc, created_at)
		 VALUES (1, 'Work', '` + baseURL + `', 'me@example.com', X'0102', '2026-08-07T12:00:00Z')`,
		`INSERT INTO time_entries
		   (instance_id, issue_key, day, started_at, seconds, created_at, updated_at)
		 VALUES (1, 'AB-1', '2026-08-07', '2026-08-07T09:00:00Z', 3600,
		         '2026-08-07T09:00:00Z', '2026-08-07T09:00:00Z')`,
	}
	for _, stmt := range stmts {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("seeding: %v", err)
		}
	}

	return path
}

func TestMigrationSplitsInstanceURLsByHost(t *testing.T) {
	cases := map[string]struct {
		baseURL        string
		wantSiteURL    string
		wantAPIBaseURL string
	}{
		"site URL becomes site_url": {
			baseURL:        "https://example.atlassian.net",
			wantSiteURL:    "https://example.atlassian.net",
			wantAPIBaseURL: "",
		},
		// The row that cannot be repaired offline: a gateway URL carries no site.
		"gateway URL becomes api_base_url": {
			baseURL:        "https://api.atlassian.com/ex/jira/7c41e2b6",
			wantSiteURL:    "",
			wantAPIBaseURL: "https://api.atlassian.com/ex/jira/7c41e2b6",
		},
	}

	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			path := seedPreMigrationDB(t, tc.baseURL)

			s, err := Open(path)
			if err != nil {
				t.Fatalf("Open() after seeding returned error: %v", err)
			}
			t.Cleanup(func() { _ = s.Close() })

			inst, err := s.Instance(context.Background(), 1)
			if err != nil {
				t.Fatalf("Instance(1) returned error: %v", err)
			}
			if inst.SiteURL != tc.wantSiteURL {
				t.Errorf("SiteURL = %q, want %q", inst.SiteURL, tc.wantSiteURL)
			}
			if inst.APIBaseURL != tc.wantAPIBaseURL {
				t.Errorf("APIBaseURL = %q, want %q", inst.APIBaseURL, tc.wantAPIBaseURL)
			}
		})
	}
}

// The migration must not be "tidied" into a table rebuild: dropping instances
// with foreign keys on cascades into time_entries and destroys logged time.
func TestMigrationPreservesChildRows(t *testing.T) {
	path := seedPreMigrationDB(t, "https://example.atlassian.net")

	s, err := Open(path)
	if err != nil {
		t.Fatalf("Open() after seeding returned error: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })

	var entries int
	if err := s.db.QueryRow(`SELECT count(*) FROM time_entries`).Scan(&entries); err != nil {
		t.Fatalf("counting time_entries: %v", err)
	}
	if entries != 1 {
		t.Errorf("time_entries has %d rows after migrating, want 1", entries)
	}
}
```

Add `"database/sql"` to the imports of `migrate_test.go`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker compose run --rm --no-deps app go test ./internal/store/ -run 'TestMigration(SplitsInstanceURLsByHost|PreservesChildRows)' -v`

Expected: FAIL — `inst.SiteURL` undefined (compile error), because `Instance` has no `SiteURL` field yet.

- [ ] **Step 3: Write the migration**

Create `internal/store/migrations/2026-08-12_090000_split_instance_urls.sql`:

```sql
-- Two URLs, because they are two different things: REST calls go to the API
-- gateway at api.atlassian.com, while issue links the user clicks go to the
-- site host. Basic auth is rejected by the site host and accepted by the
-- gateway, so a single column cannot serve both.
--
-- ADD COLUMN and DROP COLUMN, never a table rebuild: applyMigration runs this
-- inside a transaction, PRAGMA foreign_keys is a no-op there, and DROP TABLE
-- with foreign keys on would cascade into time_entries and delete logged time.
ALTER TABLE instances ADD COLUMN site_url VARCHAR(255)
  CHECK (site_url IS NULL OR site_url <> '');
ALTER TABLE instances ADD COLUMN api_base_url VARCHAR(255)
  CHECK (api_base_url IS NULL OR api_base_url <> '');

-- A gateway URL carries no recoverable site, and resolving one needs a network
-- call a migration cannot make. Such a row keeps working for REST calls and is
-- flagged in Settings so the user supplies the site URL once.
UPDATE instances SET
  site_url = CASE
    WHEN base_url LIKE 'https://api.atlassian.com/%' THEN NULL ELSE base_url END,
  api_base_url = CASE
    WHEN base_url LIKE 'https://api.atlassian.com/%' THEN base_url ELSE NULL END;

ALTER TABLE instances DROP COLUMN base_url;
```

- [ ] **Step 4: Update the store to the new columns**

In `internal/store/instances.go`, replace the `Instance` struct, `instanceColumns`, `scanInstance`, `CreateInstance` and `UpdateInstance`:

```go
// Instance is a configured Jira Cloud site.
//
// SiteURL and APIBaseURL are two different things and neither is derived from
// the other: REST calls go to the API gateway, issue links go to the site host.
// Either may be empty, which is how a NULL column reads: a migrated row that
// held a gateway URL has no recoverable site, and a row awaiting its first use
// has no resolved API base. Both cannot be empty at once — validate enforces
// what ALTER TABLE could not express as a table-level CHECK.
//
// TokenEnc is opaque to the store: written and read unchanged, and encrypting
// it is the caller's job. Its json:"-" is defence in depth, not a licence to
// serialise this struct — the HTTP layer owns its own response shape.
type Instance struct {
	ID         int64
	Name       string
	SiteURL    string
	APIBaseURL string
	Email      string
	TokenEnc   []byte `json:"-"`
	CreatedAt  time.Time
}

// InstanceInput carries the fields a caller supplies when storing a site. It is
// a struct rather than positional parameters because six adjacent strings at a
// call site cannot be read for correctness.
type InstanceInput struct {
	Name       string
	SiteURL    string
	APIBaseURL string
	Email      string
	TokenEnc   []byte
}

// ErrInstanceNeedsURL reports an input carrying neither URL. The schema cannot
// enforce this: ALTER TABLE adds no table-level CHECK, and the rebuild that
// would add one cascades into time_entries.
var ErrInstanceNeedsURL = errors.New("store: instance needs a site URL or an API base URL")

func (in InstanceInput) validate() error {
	if in.SiteURL == "" && in.APIBaseURL == "" {
		return ErrInstanceNeedsURL
	}

	return nil
}

const instanceColumns = `id, name, site_url, api_base_url, email, api_token_enc, created_at`

type scanner interface {
	Scan(dest ...any) error
}

func scanInstance(row scanner) (*Instance, error) {
	var (
		inst       Instance
		siteURL    sql.NullString
		apiBaseURL sql.NullString
		createdAt  string
	)
	if err := row.Scan(
		&inst.ID, &inst.Name, &siteURL, &apiBaseURL, &inst.Email, &inst.TokenEnc, &createdAt,
	); err != nil {
		return nil, err
	}
	inst.SiteURL = siteURL.String
	inst.APIBaseURL = apiBaseURL.String

	parsed, err := time.Parse(time.RFC3339, createdAt)
	if err != nil {
		return nil, fmt.Errorf("parsing created_at %q: %w", createdAt, err)
	}
	inst.CreatedAt = parsed

	return &inst, nil
}

// nullable turns the Go zero value into a SQL NULL, so that absence has one
// representation in the database and the CHECK constraints stay satisfiable.
func nullable(s string) any {
	if s == "" {
		return nil
	}

	return s
}

// CreateInstance stores a new Jira site and returns it with its assigned id.
func (s *Store) CreateInstance(ctx context.Context, in InstanceInput) (*Instance, error) {
	if err := in.validate(); err != nil {
		return nil, err
	}

	// Truncated because created_at is stored as RFC3339, which has one-second
	// resolution. Without this the returned value would not equal the stored one.
	createdAt := time.Now().UTC().Truncate(time.Second)

	result, err := s.db.ExecContext(ctx,
		`INSERT INTO instances (name, site_url, api_base_url, email, api_token_enc, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		in.Name, nullable(in.SiteURL), nullable(in.APIBaseURL), in.Email, in.TokenEnc,
		createdAt.Format(time.RFC3339),
	)
	if err != nil {
		return nil, fmt.Errorf("inserting instance %q: %w", in.Name, err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("reading id of new instance %q: %w", in.Name, err)
	}

	return &Instance{
		ID: id, Name: in.Name, SiteURL: in.SiteURL, APIBaseURL: in.APIBaseURL,
		Email: in.Email, TokenEnc: in.TokenEnc, CreatedAt: createdAt,
	}, nil
}

// UpdateInstance overwrites a stored Jira site. A missing id yields an error
// wrapping sql.ErrNoRows.
func (s *Store) UpdateInstance(ctx context.Context, id int64, in InstanceInput) error {
	if err := in.validate(); err != nil {
		return err
	}

	result, err := s.db.ExecContext(ctx,
		`UPDATE instances
		    SET name = ?, site_url = ?, api_base_url = ?, email = ?, api_token_enc = ?
		  WHERE id = ?`,
		in.Name, nullable(in.SiteURL), nullable(in.APIBaseURL), in.Email, in.TokenEnc, id,
	)
	if err != nil {
		return fmt.Errorf("updating instance %d: %w", id, err)
	}

	return errNoRowsIfUnaffected(result, "updating instance", id)
}

// SetInstanceAPIBase persists an API base resolved after the row was stored.
// Only a migrated row reaches here: creating an instance resolves its cloud id
// up front, because the save-time identity check cannot run without one.
func (s *Store) SetInstanceAPIBase(ctx context.Context, id int64, apiBaseURL string) error {
	if apiBaseURL == "" {
		return fmt.Errorf("setting API base for instance %d: %w", id, ErrInstanceNeedsURL)
	}

	result, err := s.db.ExecContext(ctx,
		`UPDATE instances SET api_base_url = ? WHERE id = ?`, apiBaseURL, id)
	if err != nil {
		return fmt.Errorf("setting API base for instance %d: %w", id, err)
	}

	return errNoRowsIfUnaffected(result, "setting API base for instance", id)
}
```

Add `"errors"` to the imports.

- [ ] **Step 5: Run the migration tests to verify they pass**

Run: `docker compose run --rm --no-deps app go test ./internal/store/ -run 'TestMigration' -v`

Expected: PASS, all subtests.

- [ ] **Step 6: Update the existing store tests to the new API**

`internal/store/instances_test.go` calls `CreateInstance` and `UpdateInstance` positionally. Convert every call to `InstanceInput`, and assert on `SiteURL`/`APIBaseURL` where it asserted on `BaseURL`. For example:

```go
inst, err := s.CreateInstance(context.Background(), InstanceInput{
	Name:     "Work",
	SiteURL:  "https://example.atlassian.net",
	Email:    "me@example.com",
	TokenEnc: []byte{0x01, 0x02},
})
```

- [ ] **Step 7: Add store tests for the new behaviour**

Append to `internal/store/instances_test.go`:

```go
func TestCreateInstanceRejectsInputWithNoURL(t *testing.T) {
	s := openTestStore(t)

	_, err := s.CreateInstance(context.Background(), InstanceInput{
		Name: "Work", Email: "me@example.com", TokenEnc: []byte{0x01},
	})
	if !errors.Is(err, ErrInstanceNeedsURL) {
		t.Errorf("CreateInstance() error = %v, want ErrInstanceNeedsURL", err)
	}
}

func TestCreateInstanceStoresAbsentURLAsNull(t *testing.T) {
	s := openTestStore(t)

	inst, err := s.CreateInstance(context.Background(), InstanceInput{
		Name:       "Work",
		APIBaseURL: "https://api.atlassian.com/ex/jira/7c41e2b6",
		Email:      "me@example.com",
		TokenEnc:   []byte{0x01},
	})
	if err != nil {
		t.Fatalf("CreateInstance() returned error: %v", err)
	}

	// NULL, not "": the CHECK constraints reject the empty string, so a second
	// representation of absence would be a write that fails at runtime.
	var siteURL sql.NullString
	if err := s.db.QueryRow(
		`SELECT site_url FROM instances WHERE id = ?`, inst.ID,
	).Scan(&siteURL); err != nil {
		t.Fatalf("reading site_url: %v", err)
	}
	if siteURL.Valid {
		t.Errorf("site_url = %q, want NULL", siteURL.String)
	}
}

func TestSetInstanceAPIBasePersists(t *testing.T) {
	s := openTestStore(t)

	inst, err := s.CreateInstance(context.Background(), InstanceInput{
		Name: "Work", SiteURL: "https://example.atlassian.net",
		Email: "me@example.com", TokenEnc: []byte{0x01},
	})
	if err != nil {
		t.Fatalf("CreateInstance() returned error: %v", err)
	}

	const apiBase = "https://api.atlassian.com/ex/jira/7c41e2b6"
	if err := s.SetInstanceAPIBase(context.Background(), inst.ID, apiBase); err != nil {
		t.Fatalf("SetInstanceAPIBase() returned error: %v", err)
	}

	reloaded, err := s.Instance(context.Background(), inst.ID)
	if err != nil {
		t.Fatalf("Instance() returned error: %v", err)
	}
	if reloaded.APIBaseURL != apiBase {
		t.Errorf("APIBaseURL = %q, want %q", reloaded.APIBaseURL, apiBase)
	}
	if reloaded.SiteURL != "https://example.atlassian.net" {
		t.Errorf("SiteURL = %q, want it untouched", reloaded.SiteURL)
	}
}

func TestSetInstanceAPIBaseRejectsMissingID(t *testing.T) {
	s := openTestStore(t)

	err := s.SetInstanceAPIBase(context.Background(), 404, "https://api.atlassian.com/ex/jira/x")
	if !errors.Is(err, sql.ErrNoRows) {
		t.Errorf("SetInstanceAPIBase() error = %v, want sql.ErrNoRows", err)
	}
}

// The acceptance criterion "deleting an instance cascades to its pins and time
// entries" has no coverage anywhere before this test. It lives in package store
// because only here can a child row be inserted directly: the cascade is the
// schema's, and what makes it fire is the foreign_keys pragma in the DSN.
func TestDeleteInstanceCascadesToChildren(t *testing.T) {
	s := openTestStore(t)

	inst, err := s.CreateInstance(context.Background(), InstanceInput{
		Name: "Work", SiteURL: "https://example.atlassian.net",
		Email: "me@example.com", TokenEnc: []byte{0x01},
	})
	if err != nil {
		t.Fatalf("CreateInstance() returned error: %v", err)
	}

	children := []struct {
		table string
		stmt  string
	}{
		{
			table: "pinned_issues",
			stmt: `INSERT INTO pinned_issues (instance_id, issue_key, created_at)
			       VALUES (?, 'AB-1', '2026-08-12T09:00:00Z')`,
		},
		{
			table: "time_entries",
			stmt: `INSERT INTO time_entries
			         (instance_id, issue_key, day, started_at, seconds, created_at, updated_at)
			       VALUES (?, 'AB-1', '2026-08-12', '2026-08-12T09:00:00Z', 3600,
			               '2026-08-12T09:00:00Z', '2026-08-12T09:00:00Z')`,
		},
		{
			table: "timers",
			stmt: `INSERT INTO timers (id, instance_id, issue_key, started_at)
			       VALUES (1, ?, 'AB-1', '2026-08-12T09:00:00Z')`,
		},
	}
	for _, child := range children {
		if _, err := s.db.Exec(child.stmt, inst.ID); err != nil {
			t.Fatalf("seeding %s: %v", child.table, err)
		}
	}

	if err := s.DeleteInstance(context.Background(), inst.ID); err != nil {
		t.Fatalf("DeleteInstance() returned error: %v", err)
	}

	for _, child := range children {
		t.Run(child.table, func(t *testing.T) {
			var remaining int
			if err := s.db.QueryRow(
				`SELECT count(*) FROM ` + child.table,
			).Scan(&remaining); err != nil {
				t.Fatalf("counting %s: %v", child.table, err)
			}
			if remaining != 0 {
				t.Errorf("%s has %d rows after deleting the instance, want 0", child.table, remaining)
			}
		})
	}
}
```

Ensure `"database/sql"` and `"errors"` are imported.

- [ ] **Step 8: Update the smoke command**

`internal/jira/_smoke/main.go` is excluded from the build by its leading underscore, so `make verify` will not catch its breakage. Update it by hand or it rots silently.

In `seed`, replace the `jira.New` check and the `CreateInstance` call:

```go
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
```

In `checkInstance` and `diagnose`, replace `inst.BaseURL` with a resolved base. `checkInstance` becomes:

```go
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
```

In `diagnose`, replace `strings.TrimSuffix(inst.BaseURL, "/")` with `strings.TrimSuffix(inst.SiteURL, "/")`, since `diagnose` probes the site host specifically.

- [ ] **Step 9: Verify the smoke command still compiles**

Run: `docker compose run --rm --no-deps app go vet ./internal/jira/_smoke/`

Expected: no output. (`./...` skips it; naming the path directly does not.)

- [ ] **Step 10: Run the full gate**

Run: `make verify`

Expected: `verify: OK`.

- [ ] **Step 11: Commit**

```bash
git add internal/store internal/jira/_smoke
git commit -m "feat(store): split instance URLs into site and API base

The API gateway and the site host are different URLs serving different
purposes, and one column cannot hold both. Both columns are nullable: a
migrated gateway URL carries no recoverable site, and an API base cannot
be resolved at migration time without a network call.

ADD COLUMN and DROP COLUMN rather than a table rebuild — DROP TABLE with
foreign keys on cascades into time_entries and deletes logged time."
```

---

### Task 2: `internal/atlassian` — cloud-id resolution and the gateway template

**Files:**
- Create: `internal/atlassian/tenant.go`
- Create: `internal/atlassian/tenant_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```go
  package atlassian

  var ErrTenantUnreadable = errors.New("atlassian: tenant info unreadable")

  func NormalizeSiteURL(raw string) (string, error)
  func ResolveCloudID(ctx context.Context, httpClient *http.Client, siteURL string) (string, error)
  func APIBaseURL(cloudID string) string
  ```

**Why this package exists:** so the gateway's URL shape has exactly one home, and that home is not `internal/jira`. The client is handed an API base and uses it verbatim.

- [ ] **Step 1: Write the failing tests**

Create `internal/atlassian/tenant_test.go`:

```go
package atlassian

import (
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
		"plain host":            {raw: "https://example.atlassian.net", want: "https://example.atlassian.net"},
		"trailing slash":        {raw: "https://example.atlassian.net/", want: "https://example.atlassian.net"},
		"path is dropped":       {raw: "https://example.atlassian.net/jira/software", want: "https://example.atlassian.net"},
		"query is dropped":      {raw: "https://example.atlassian.net/?a=b", want: "https://example.atlassian.net"},
		"surrounding space":     {raw: "  https://example.atlassian.net  ", want: "https://example.atlassian.net"},
		"http is allowed":       {raw: "http://localhost:8080", want: "http://localhost:8080"},
		"empty":                 {raw: "", wantErr: true},
		"no scheme":             {raw: "example.atlassian.net", wantErr: true},
		"no host":               {raw: "https://", wantErr: true},
		"unsupported scheme":    {raw: "ftp://example.atlassian.net", wantErr: true},
		"not a URL at all":      {raw: "://nonsense", wantErr: true},
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker compose run --rm --no-deps app go test ./internal/atlassian/ -v`

Expected: FAIL — the package does not exist.

- [ ] **Step 3: Write the implementation**

Create `internal/atlassian/tenant.go`:

```go
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `docker compose run --rm --no-deps app go test ./internal/atlassian/ -v`

Expected: PASS, every subtest.

- [ ] **Step 5: Commit**

```bash
git add internal/atlassian
git commit -m "feat(atlassian): resolve a site URL to its API gateway base

The gateway URL shape lives in one package, not in internal/jira, which
is handed a base URL and uses it verbatim."
```

---

### Task 3: `jira.Client.Myself` — the only call that proves credentials work

**Files:**
- Create: `internal/jira/myself.go`
- Create: `internal/jira/myself_test.go`

**Interfaces:**
- Consumes: `jira.New(baseURL, email, token)` and the unexported `(*Client).do`, both existing.
- Produces:
  ```go
  type User struct {
      AccountID   string `json:"accountId"`
      DisplayName string `json:"displayName"`
      Active      bool   `json:"active"`
  }

  func (c *Client) Myself(ctx context.Context) (*User, error)
  ```

**Why this exists:** `POST /rest/api/3/search/jql` answers an unauthenticated caller with `200 {"issues":[]}` rather than a 401. A connection test built on a search passes against credentials Jira has entirely rejected. Only `/myself` distinguishes them.

- [ ] **Step 1: Write the failing tests**

Create `internal/jira/myself_test.go`:

```go
package jira

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMyselfReturnsTheAuthenticatedAccount(t *testing.T) {
	var gotPath, gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		_, _ = w.Write([]byte(
			`{"accountId":"5b10a2","displayName":"Dion","active":true}`))
	}))
	defer srv.Close()

	client, err := New(srv.URL, "me@example.com", "token")
	if err != nil {
		t.Fatalf("New() returned error: %v", err)
	}

	me, err := client.Myself(context.Background())
	if err != nil {
		t.Fatalf("Myself() returned error: %v", err)
	}
	if me.AccountID != "5b10a2" {
		t.Errorf("AccountID = %q, want %q", me.AccountID, "5b10a2")
	}
	if me.DisplayName != "Dion" {
		t.Errorf("DisplayName = %q, want %q", me.DisplayName, "Dion")
	}
	if !me.Active {
		t.Error("Active = false, want true")
	}
	if gotPath != "/rest/api/3/myself" {
		t.Errorf("requested %q, want /rest/api/3/myself", gotPath)
	}
	if gotAuth == "" {
		t.Error("no Authorization header sent; the call must be authenticated")
	}
}

func TestMyselfMapsRejectedCredentials(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"message":"Client must be authenticated"}`))
	}))
	defer srv.Close()

	client, err := New(srv.URL, "me@example.com", "token")
	if err != nil {
		t.Fatalf("New() returned error: %v", err)
	}

	if _, err := client.Myself(context.Background()); !errors.Is(err, ErrUnauthorized) {
		t.Errorf("Myself() error = %v, want ErrUnauthorized", err)
	}
}

func TestMyselfRejectsAnAccountWithNoID(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"displayName":"Anonymous"}`))
	}))
	defer srv.Close()

	client, err := New(srv.URL, "me@example.com", "token")
	if err != nil {
		t.Fatalf("New() returned error: %v", err)
	}

	if _, err := client.Myself(context.Background()); err == nil {
		t.Error("Myself() succeeded on a response with no accountId, want an error")
	}
}

// The trap #22 was raised for, at the client level: a stub that answers a search
// happily and /myself with a 401 must not look healthy. A connection test built
// on SearchAssigned would pass here.
func TestSearchSucceedsWhereMyselfFailsOnRejectedCredentials(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/rest/api/3/myself" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(`{"issues":[],"isLast":true}`))
	}))
	defer srv.Close()

	client, err := New(srv.URL, "me@example.com", "token")
	if err != nil {
		t.Fatalf("New() returned error: %v", err)
	}

	if _, err := client.SearchAssigned(context.Background()); err != nil {
		t.Fatalf("SearchAssigned() returned error: %v; the trap requires it to succeed", err)
	}
	if _, err := client.Myself(context.Background()); !errors.Is(err, ErrUnauthorized) {
		t.Errorf("Myself() error = %v, want ErrUnauthorized", err)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker compose run --rm --no-deps app go test ./internal/jira/ -run TestMyself -v`

Expected: FAIL — `client.Myself` undefined.

- [ ] **Step 3: Write the implementation**

Create `internal/jira/myself.go`:

```go
package jira

import (
	"context"
	"fmt"
	"net/http"
)

// User is the account Jira resolves the configured credentials to.
type User struct {
	AccountID   string `json:"accountId"`
	DisplayName string `json:"displayName"`
	Active      bool   `json:"active"`
}

// Myself returns the account the credentials authenticate as.
//
// This is the only call that proves credentials work. A search answers an
// unauthenticated caller with 200 and an empty issue list rather than a 401, so
// a connection test built on one passes against credentials Jira has rejected.
func (c *Client) Myself(ctx context.Context) (*User, error) {
	var user User
	if err := c.do(ctx, http.MethodGet, "/rest/api/3/myself", nil, nil, &user); err != nil {
		return nil, fmt.Errorf("reading the authenticated account: %w", err)
	}
	// Identity is the whole point of the call: a 200 carrying no account is no
	// more proof than the empty search this call exists to replace.
	if user.AccountID == "" {
		return nil, fmt.Errorf("reading the authenticated account: response carried no accountId")
	}

	return &user, nil
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `docker compose run --rm --no-deps app go test ./internal/jira/ -v`

Expected: PASS, including the pre-existing search and worklog tests.

- [ ] **Step 5: Commit**

```bash
git add internal/jira/myself.go internal/jira/myself_test.go
git commit -m "feat(jira): add Myself, the only call that proves credentials work

A search answers an unauthenticated caller with 200 and no issues, so it
cannot tell working credentials from rejected ones."
```

---

### Task 4: Server plumbing — JSON helpers, error envelope, store and sealer

**Files:**
- Create: `internal/server/json.go`
- Create: `internal/server/json_test.go`
- Modify: `internal/server/server.go`
- Modify: `internal/server/server_test.go`
- Modify: `cmd/server/main.go`

**Interfaces:**
- Consumes: `store.Store` and `crypto.Sealer`, both existing.
- Produces:
  ```go
  func New(cfg *config.Config, assets fs.FS, db *store.Store, sealer *crypto.Sealer) *Server

  func writeJSON(w http.ResponseWriter, status int, payload any)
  func writeError(w http.ResponseWriter, status int, code, message string)

  type errorBody struct {
      Code    string `json:"code"`
      Message string `json:"message"`
  }
  ```

- [ ] **Step 1: Write the failing tests**

Create `internal/server/json_test.go`:

```go
package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWriteJSONSetsStatusAndContentType(t *testing.T) {
	rec := httptest.NewRecorder()

	writeJSON(rec, http.StatusCreated, map[string]string{"name": "Work"})

	if rec.Code != http.StatusCreated {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusCreated)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", got)
	}

	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decoding body: %v", err)
	}
	if body["name"] != "Work" {
		t.Errorf("body[name] = %q, want %q", body["name"], "Work")
	}
}

func TestWriteErrorCarriesCodeAndMessage(t *testing.T) {
	rec := httptest.NewRecorder()

	writeError(rec, http.StatusBadRequest, "invalid_site_url", "site URL is required")

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}

	var body errorBody
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decoding body: %v", err)
	}
	if body.Code != "invalid_site_url" {
		t.Errorf("code = %q, want invalid_site_url", body.Code)
	}
	if body.Message != "site URL is required" {
		t.Errorf("message = %q, want the supplied message", body.Message)
	}
}
```

- [ ] **Step 2: Run to verify failure**

Run: `docker compose run --rm --no-deps app go test ./internal/server/ -run 'TestWrite' -v`

Expected: FAIL — `writeJSON` takes a string today, and `writeError` and `errorBody` do not exist.

- [ ] **Step 3: Write the helpers**

Create `internal/server/json.go`:

```go
package server

import (
	"encoding/json"
	"log"
	"net/http"
)

// errorBody is the shape every API failure takes. The code is stable and
// machine-readable; the message is for a person.
type errorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// writeJSON encodes payload as the response body.
//
// The header is written before encoding, so an encoding failure cannot change
// the status the client already has. It is logged rather than returned: the
// response is committed by then, and a half-written body is all the caller can
// observe either way.
func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("encoding %d response: %v", status, err)
	}
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, errorBody{Code: code, Message: message})
}
```

Remove the old `writeJSON` from `internal/server/server.go` and update its two callers:

```go
func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func handleAPINotFound(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotFound, "not_found", "no such endpoint")
}
```

- [ ] **Step 4: Give the server its store and sealer**

In `internal/server/server.go`:

```go
// Server routes API requests and serves the PWA's static assets.
type Server struct {
	cfg     *config.Config
	assets  fs.FS
	db      *store.Store
	sealer  *crypto.Sealer
	clients *instanceClients
	mux     *http.ServeMux
}

// New builds a Server that serves its static files from assets. Production
// passes an embedded filesystem; development passes one backed by web/dist.
func New(cfg *config.Config, assets fs.FS, db *store.Store, sealer *crypto.Sealer) *Server {
	s := &Server{
		cfg:    cfg,
		assets: assets,
		db:     db,
		sealer: sealer,
		mux:    http.NewServeMux(),
	}

	s.mux.HandleFunc("GET /api/health", s.handleHealth)
	s.mux.HandleFunc("/api/", handleAPINotFound)
	s.mux.HandleFunc("/", s.handleAsset)

	return s
}
```

Add the `internal/crypto` and `internal/store` imports. Leave `clients` nil for now — Task 5 populates it.

- [ ] **Step 5: Update the existing server tests**

Every `New(cfg, assets)` call in `internal/server/server_test.go` becomes `New(cfg, assets, nil, nil)`. The asset and health tests touch neither dependency.

Add a helper the later tasks reuse, so each does not reinvent it:

```go
// newTestServer builds a Server over a real store in a temp directory and a
// sealer with a throwaway key.
func newTestServer(t *testing.T) (*Server, *store.Store, *crypto.Sealer) {
	t.Helper()

	db, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("opening store: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	sealer, err := crypto.NewSealer(make([]byte, crypto.KeySize))
	if err != nil {
		t.Fatalf("building sealer: %v", err)
	}

	cfg := &config.Config{Addr: ":8080", Location: time.UTC}

	return New(cfg, fstest.MapFS{}, db, sealer), db, sealer
}
```

Check `internal/config`'s `Config` field names before writing this and match them exactly.

- [ ] **Step 6: Wire the store into cmd/server**

In `cmd/server/main.go`:

```go
func main() {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		log.Fatalf("configuration: %v", err)
	}

	sealer, err := crypto.NewSealer(cfg.Secret)
	if err != nil {
		log.Fatalf("sealer: %v", err)
	}

	db, err := store.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("store: %v", err)
	}
	defer func() { _ = db.Close() }()

	srv := server.New(cfg, web.Assets(), db, sealer)

	log.Printf("work-dashboard listening on %s (%s)", cfg.Addr, cfg.Location)
	if err := http.ListenAndServe(cfg.Addr, srv); err != nil {
		log.Fatalf("server: %v", err)
	}
}
```

Add the `internal/crypto` and `internal/store` imports. Check `cfg.Secret` and `cfg.DBPath` against `internal/config` and match the real names.

- [ ] **Step 7: Run the gate**

Run: `make verify`

Expected: `verify: OK`.

- [ ] **Step 8: Commit**

```bash
git add internal/server cmd/server
git commit -m "feat(server): add a JSON error envelope and wire in the store

The store has had no caller since it shipped; this is it."
```

---

### Task 5: The per-instance Jira client factory

**Files:**
- Create: `internal/server/clients.go`
- Create: `internal/server/clients_test.go`
- Modify: `internal/server/server.go`

**Interfaces:**
- Consumes: `store.Instance`, `store.SetInstanceAPIBase`, `crypto.Sealer.Open`, `atlassian.ResolveCloudID`, `atlassian.APIBaseURL`, `jira.New`.
- Produces:
  ```go
  type instanceClients struct { /* db, sealer, http */ }

  func newInstanceClients(db *store.Store, sealer *crypto.Sealer) *instanceClients
  func (c *instanceClients) forInstance(ctx context.Context, inst *store.Instance) (*jira.Client, error)
  func (c *instanceClients) apiBaseForSite(ctx context.Context, siteURL string) (string, error)
  ```
  `forInstance` resolves and persists a missing API base as a side effect. `apiBaseForSite` is for a site with no row yet — the create path.

**Test seam:** `instanceClients` holds an `*http.Client` field so a test can point tenant-info resolution at an `httptest.Server`. `newInstanceClients` defaults it to `http.DefaultClient`.

- [ ] **Step 1: Write the failing tests**

Create `internal/server/clients_test.go`:

```go
package server

import (
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
	srv, db, sealer := newTestServer(t)
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
	srv, db, sealer := newTestServer(t)

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
	srv, db, sealer := newTestServer(t)

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
	srv, db, sealer := newTestServer(t)

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
```

- [ ] **Step 2: Run to verify failure**

Run: `docker compose run --rm --no-deps app go test ./internal/server/ -run TestForInstance -v`

Expected: FAIL — `srv.clients` is nil and `forInstance` does not exist.

- [ ] **Step 3: Write the factory**

Create `internal/server/clients.go`:

```go
package server

import (
	"context"
	"fmt"
	"net/http"

	"github.com/dgerrese/work-dashboard/internal/atlassian"
	"github.com/dgerrese/work-dashboard/internal/crypto"
	"github.com/dgerrese/work-dashboard/internal/jira"
	"github.com/dgerrese/work-dashboard/internal/store"
)

// instanceClients builds a Jira client for a stored instance: unseal the token,
// resolve the API base if the row has none, hand both to jira.New.
//
// Tickets 5 through 10 all need this sequence, which is why it is a type rather
// than a helper inside one handler.
type instanceClients struct {
	db     *store.Store
	sealer *crypto.Sealer
	// http serves tenant-info lookups only. Jira calls go through jira.Client,
	// which owns its own timeout.
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
		http:       http.DefaultClient,
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
```

In `internal/server/server.go`, populate the field inside `New`:

```go
	s.clients = newInstanceClients(db, sealer)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `docker compose run --rm --no-deps app go test ./internal/server/ -run TestForInstance -v`

Expected: PASS, all four.

- [ ] **Step 5: Commit**

```bash
git add internal/server
git commit -m "feat(server): add the per-instance Jira client factory

Unseal, resolve a missing API base, persist it, build the client. A
missing API base only ever comes from a migrated row."
```

---

### Task 6: `GET` and `POST /api/instances`

**Files:**
- Create: `internal/server/instances.go`
- Create: `internal/server/instances_test.go`
- Modify: `internal/server/server.go`

**Interfaces:**
- Consumes: `instanceClients` from Task 5, `atlassian.NormalizeSiteURL`, `jira.Client.Myself`, `store.InstanceInput`.
- Produces:
  ```go
  type instanceDTO struct {
      ID         int64  `json:"id"`
      Name       string `json:"name"`
      SiteURL    string `json:"siteUrl"`
      APIBaseURL string `json:"apiBaseUrl"`
      Email      string `json:"email"`
      CreatedAt  string `json:"createdAt"`
  }

  type instanceRequest struct {
      Name    string `json:"name"`
      SiteURL string `json:"siteUrl"`
      Email   string `json:"email"`
      Token   string `json:"token"`
  }
  ```
  Routes `GET /api/instances` and `POST /api/instances`.

**Note on reaching a stub Jira in tests:** `POST` must verify credentials before storing, so a test needs both `/_edge/tenant_info` and `/rest/api/3/myself` to land on its `httptest.Server`. Two fields on `instanceClients` make that possible, both already present from Task 5: `http` (which tenant-info resolution uses) and `apiBaseFor` (which turns the resolved cloud id into a base URL). A test points both at its stub. Production takes `atlassian.APIBaseURL` from the constructor — there is no test-only branch in the code.

- [ ] **Step 1: Write the failing tests**

Create `internal/server/instances_test.go`:

```go
package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dgerrese/work-dashboard/internal/store"
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
	srv, db, _ := newTestServer(t)
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
	srv, db, _ := newTestServer(t)
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
			srv, db, _ := newTestServer(t)
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
	srv, _, _ := newTestServer(t)

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
	srv, db, sealer := newTestServer(t)

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
	// #5 needs this for issue links.
	if got[0].SiteURL != "https://example.atlassian.net" {
		t.Errorf("siteUrl = %q, want the stored site URL", got[0].SiteURL)
	}
}

func TestGetInstancesReturnsAnEmptyArrayNotNull(t *testing.T) {
	srv, _, _ := newTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/api/instances", nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	// null would make the frontend branch before it can iterate.
	if got := strings.TrimSpace(rec.Body.String()); got != "[]" {
		t.Errorf("body = %q, want []", got)
	}
}
```

- [ ] **Step 2: Run to verify failure**

Run: `docker compose run --rm --no-deps app go test ./internal/server/ -run 'Test(Post|Get)Instance' -v`

Expected: FAIL — `instanceDTO` undefined and the routes 404.

- [ ] **Step 3: Write the handlers**

Create `internal/server/instances.go`:

```go
package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/dgerrese/work-dashboard/internal/atlassian"
	"github.com/dgerrese/work-dashboard/internal/jira"
	"github.com/dgerrese/work-dashboard/internal/store"
)

// instanceDTO is the response shape. It is written out rather than reusing
// store.Instance so that adding a field to the store struct cannot leak a token
// into a response.
type instanceDTO struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	SiteURL    string `json:"siteUrl"`
	APIBaseURL string `json:"apiBaseUrl"`
	Email      string `json:"email"`
	CreatedAt  string `json:"createdAt"`
}

func dtoFromInstance(inst store.Instance) instanceDTO {
	return instanceDTO{
		ID:         inst.ID,
		Name:       inst.Name,
		SiteURL:    inst.SiteURL,
		APIBaseURL: inst.APIBaseURL,
		Email:      inst.Email,
		CreatedAt:  inst.CreatedAt.Format(time.RFC3339),
	}
}

// instanceRequest is the body POST and PATCH accept. An empty Token on PATCH
// means "keep the stored one".
type instanceRequest struct {
	Name    string `json:"name"`
	SiteURL string `json:"siteUrl"`
	Email   string `json:"email"`
	Token   string `json:"token"`
}

func (s *Server) handleListInstances(w http.ResponseWriter, r *http.Request) {
	instances, err := s.db.Instances(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not read the stored instances")
		return
	}

	dtos := make([]instanceDTO, 0, len(instances))
	for _, inst := range instances {
		dtos = append(dtos, dtoFromInstance(inst))
	}

	writeJSON(w, http.StatusOK, dtos)
}

func (s *Server) handleCreateInstance(w http.ResponseWriter, r *http.Request) {
	var req instanceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "the request body is not valid JSON")
		return
	}

	name := strings.TrimSpace(req.Name)
	email := strings.TrimSpace(req.Email)
	if name == "" {
		writeError(w, http.StatusBadRequest, "invalid_name", "a name is required")
		return
	}
	if email == "" {
		writeError(w, http.StatusBadRequest, "invalid_email", "an account email is required")
		return
	}
	if req.Token == "" {
		writeError(w, http.StatusBadRequest, "missing_token", "an API token is required")
		return
	}
	siteURL, err := atlassian.NormalizeSiteURL(req.SiteURL)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_site_url", err.Error())
		return
	}

	apiBase, err := s.clients.apiBaseForSite(r.Context(), siteURL)
	if err != nil {
		writeInstanceError(w, err)
		return
	}

	// Verify before storing: an instance must not be storable in a state that
	// silently returns nothing.
	client, err := jira.New(apiBase, email, req.Token)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_site_url", err.Error())
		return
	}
	if _, err := client.Myself(r.Context()); err != nil {
		writeInstanceError(w, err)
		return
	}

	sealed, err := s.sealer.Seal(req.Token)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "seal_failed", "could not encrypt the API token")
		return
	}

	inst, err := s.db.CreateInstance(r.Context(), store.InstanceInput{
		Name: name, SiteURL: siteURL, APIBaseURL: apiBase, Email: email, TokenEnc: sealed,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not store the instance")
		return
	}

	writeJSON(w, http.StatusCreated, dtoFromInstance(*inst))
}

// writeInstanceError maps the errors a Jira round trip produces onto statuses.
// Rejected credentials are the user's to fix in Settings; an unreachable site is
// not a server fault, so neither is a 500.
func writeInstanceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, atlassian.ErrTenantUnreadable):
		writeError(w, http.StatusBadGateway, "tenant_unreadable",
			"could not read the site's tenant info; check the site URL and that the site is reachable")
	case errors.Is(err, jira.ErrUnauthorized):
		writeError(w, http.StatusUnauthorized, "credentials_rejected",
			"Jira rejected the email and API token")
	case errors.Is(err, jira.ErrUnreachable):
		writeError(w, http.StatusBadGateway, "instance_unreachable", "the Jira site could not be reached")
	default:
		writeError(w, http.StatusInternalServerError, "unexpected", err.Error())
	}
}
```

Register the routes in `New`, above the `/api/` catch-all:

```go
	s.mux.HandleFunc("GET /api/instances", s.handleListInstances)
	s.mux.HandleFunc("POST /api/instances", s.handleCreateInstance)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `docker compose run --rm --no-deps app go test ./internal/server/ -run 'Test(Post|Get)Instance' -v`

Expected: PASS, every subtest.

- [ ] **Step 5: Commit**

```bash
git add internal/server
git commit -m "feat(server): list and create Jira instances

Creating verifies identity via /myself before storing, so an instance
cannot be saved in a state that silently returns nothing."
```

---

### Task 7: `PATCH` and `DELETE /api/instances/{id}`

**Files:**
- Modify: `internal/server/instances.go`
- Modify: `internal/server/instances_test.go`
- Modify: `internal/server/server.go`

**Interfaces:**
- Consumes: everything from Task 6.
- Produces: routes `PATCH /api/instances/{id}` and `DELETE /api/instances/{id}`.

**The rule this task encodes:** every write that stores an instance re-verifies identity, including a `PATCH` that changes only the display name. A `PATCH` with no token verifies with the stored one, unsealed, so re-verification never forces the credential to be re-entered. `DELETE` does not verify — it removes the row, leaving nothing to verify.

- [ ] **Step 1: Write the failing tests**

Append to `internal/server/instances_test.go`:

```go
func seedInstance(t *testing.T, db *store.Store, sealer *crypto.Sealer, site *httptest.Server) *store.Instance {
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
	srv, db, sealer := newTestServer(t)
	site := jiraSiteServer(t, http.StatusOK)
	pointAtSite(srv, site)
	inst := seedInstance(t, db, sealer, site)
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
	srv, db, sealer := newTestServer(t)
	good := jiraSiteServer(t, http.StatusOK)
	inst := seedInstance(t, db, sealer, good)

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
	srv, _, _ := newTestServer(t)

	rec := patchInstance(t, srv, 404, `{"name":"X","siteUrl":"https://x.atlassian.net","email":"me@example.com"}`)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}

// The cascade itself is covered in package store, where a child row can be
// inserted directly. This asserts only what the handler adds: the row goes, and
// the response is a 204.
func TestDeleteInstanceRemovesTheRow(t *testing.T) {
	srv, db, sealer := newTestServer(t)
	site := jiraSiteServer(t, http.StatusOK)
	inst := seedInstance(t, db, sealer, site)

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
	srv, db, sealer := newTestServer(t)
	site := jiraSiteServer(t, http.StatusOK)
	inst := seedInstance(t, db, sealer, site)
	site.Close()

	req := httptest.NewRequest(http.MethodDelete,
		"/api/instances/"+strconv.FormatInt(inst.ID, 10), nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Errorf("status = %d, want %d; body %s", rec.Code, http.StatusNoContent, rec.Body)
	}
}
```

**Where the cascade is covered:** in `internal/store`, by `TestDeleteInstanceCascadesToChildren` in Task 1. It belongs there because a child row must be inserted directly and `Store.db` is unexported — a test in package `server` cannot reach it, and `internal/store` has no `CreateTimeEntry` until #7. The handler test above asserts only what the handler itself adds.

Imports to add to `instances_test.go`: `"strconv"` and `"github.com/dgerrese/work-dashboard/internal/crypto"`.

- [ ] **Step 2: Run to verify failure**

Run: `docker compose run --rm --no-deps app go test ./internal/server/ -run 'Test(Patch|Delete)Instance' -v`

Expected: FAIL — the routes 404.

- [ ] **Step 3: Write the handlers**

Append to `internal/server/instances.go`:

```go
// instanceIDFromPath reads the {id} wildcard. A non-numeric id is a 404 rather
// than a 400: the path simply does not name an instance.
func instanceIDFromPath(r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}

	return id, true
}

func (s *Server) handleUpdateInstance(w http.ResponseWriter, r *http.Request) {
	id, ok := instanceIDFromPath(r)
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "no such instance")
		return
	}

	existing, err := s.db.Instance(r.Context(), id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "not_found", "no such instance")
			return
		}
		writeError(w, http.StatusInternalServerError, "store_failed", "could not read the instance")
		return
	}

	var req instanceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "the request body is not valid JSON")
		return
	}

	name := strings.TrimSpace(req.Name)
	email := strings.TrimSpace(req.Email)
	if name == "" {
		writeError(w, http.StatusBadRequest, "invalid_name", "a name is required")
		return
	}
	if email == "" {
		writeError(w, http.StatusBadRequest, "invalid_email", "an account email is required")
		return
	}
	siteURL, err := atlassian.NormalizeSiteURL(req.SiteURL)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_site_url", err.Error())
		return
	}

	// An empty token means "keep the stored one", so re-verification never
	// forces the credential to be re-entered.
	token := req.Token
	sealed := existing.TokenEnc
	if token == "" {
		token, err = s.sealer.Open(existing.TokenEnc)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "seal_failed", "could not read the stored token")
			return
		}
	} else {
		sealed, err = s.sealer.Seal(token)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "seal_failed", "could not encrypt the API token")
			return
		}
	}

	// The site URL may have changed, so the API base is resolved afresh rather
	// than reused.
	apiBase, err := s.clients.apiBaseForSite(r.Context(), siteURL)
	if err != nil {
		writeInstanceError(w, err)
		return
	}

	// Every write that stores an instance re-verifies, with no exception for a
	// rename. A rule with no exceptions is harder to erode than one carrying a
	// special case, and a stored instance nothing has checked is the failure
	// this whole ticket exists to prevent.
	client, err := jira.New(apiBase, email, token)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_site_url", err.Error())
		return
	}
	if _, err := client.Myself(r.Context()); err != nil {
		writeInstanceError(w, err)
		return
	}

	if err := s.db.UpdateInstance(r.Context(), id, store.InstanceInput{
		Name: name, SiteURL: siteURL, APIBaseURL: apiBase, Email: email, TokenEnc: sealed,
	}); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "not_found", "no such instance")
			return
		}
		writeError(w, http.StatusInternalServerError, "store_failed", "could not update the instance")
		return
	}

	updated, err := s.db.Instance(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not read the updated instance")
		return
	}

	writeJSON(w, http.StatusOK, dtoFromInstance(*updated))
}

// handleDeleteInstance removes an instance and, through the schema's
// ON DELETE CASCADE, its pins, time entries and timer. It contacts Jira not at
// all: there is nothing left to verify, and a site being down must not strand a
// row the user is trying to remove.
func (s *Server) handleDeleteInstance(w http.ResponseWriter, r *http.Request) {
	id, ok := instanceIDFromPath(r)
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "no such instance")
		return
	}

	if err := s.db.DeleteInstance(r.Context(), id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "not_found", "no such instance")
			return
		}
		writeError(w, http.StatusInternalServerError, "store_failed", "could not delete the instance")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
```

Add `"database/sql"` and `"strconv"` to the imports. Register the routes in `New`:

```go
	s.mux.HandleFunc("PATCH /api/instances/{id}", s.handleUpdateInstance)
	s.mux.HandleFunc("DELETE /api/instances/{id}", s.handleDeleteInstance)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `docker compose run --rm --no-deps app go test ./internal/server/ -v`

Expected: PASS, the whole package.

- [ ] **Step 5: Commit**

```bash
git add internal/server
git commit -m "feat(server): update and delete Jira instances

Every write that stores an instance re-verifies identity, with no
exception for a rename. A PATCH with no token verifies with the stored
one, so re-verification never forces the credential to be re-entered."
```

---

### Task 8: `POST /api/instances/{id}/test`

**Files:**
- Modify: `internal/server/instances.go`
- Modify: `internal/server/instances_test.go`
- Modify: `internal/server/server.go`

**Interfaces:**
- Consumes: `instanceClients.forInstance`, `jira.Client.Myself`, `writeInstanceError`.
- Produces: route `POST /api/instances/{id}/test`, responding
  ```go
  type connectionTestDTO struct {
      AccountID   string `json:"accountId"`
      DisplayName string `json:"displayName"`
  }
  ```

- [ ] **Step 1: Write the failing tests**

Append to `internal/server/instances_test.go`:

```go
func testConnection(t *testing.T, srv *Server, id int64) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(http.MethodPost,
		"/api/instances/"+strconv.FormatInt(id, 10)+"/test", nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	return rec
}

func TestConnectionTestReportsTheIdentity(t *testing.T) {
	srv, db, sealer := newTestServer(t)
	site := jiraSiteServer(t, http.StatusOK)
	pointAtSite(srv, site)
	inst := seedInstance(t, db, sealer, site)

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

// The trap, stated exactly as #22 framed it: a stub that answers search/jql with
// 200 {"issues": []} and /myself with 401 must make the test FAIL.
func TestConnectionTestFailsWhenOnlyMyselfRejects(t *testing.T) {
	srv, db, sealer := newTestServer(t)
	site := jiraSiteServer(t, http.StatusUnauthorized)
	pointAtSite(srv, site)
	inst := seedInstance(t, db, sealer, site)

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
	srv, db, sealer := newTestServer(t)
	site := jiraSiteServer(t, http.StatusOK)
	pointAtSite(srv, site)
	inst := seedInstance(t, db, sealer, site)
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

func TestConnectionTestRejectsAMissingID(t *testing.T) {
	srv, _, _ := newTestServer(t)

	if rec := testConnection(t, srv, 404); rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}
```

- [ ] **Step 2: Run to verify failure**

Run: `docker compose run --rm --no-deps app go test ./internal/server/ -run TestConnectionTest -v`

Expected: FAIL — `connectionTestDTO` undefined and the route 404s.

- [ ] **Step 3: Write the handler**

Append to `internal/server/instances.go`:

```go
// connectionTestDTO reports who Jira resolved the credentials to. The account
// id is the assertion: a 2xx from any endpoint is not one, which is why this
// route exists at all.
type connectionTestDTO struct {
	AccountID   string `json:"accountId"`
	DisplayName string `json:"displayName"`
}

func (s *Server) handleTestInstance(w http.ResponseWriter, r *http.Request) {
	id, ok := instanceIDFromPath(r)
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "no such instance")
		return
	}

	inst, err := s.db.Instance(r.Context(), id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "not_found", "no such instance")
			return
		}
		writeError(w, http.StatusInternalServerError, "store_failed", "could not read the instance")
		return
	}

	client, err := s.clients.forInstance(r.Context(), inst)
	if err != nil {
		writeInstanceError(w, err)
		return
	}

	me, err := client.Myself(r.Context())
	if err != nil {
		writeInstanceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, connectionTestDTO{
		AccountID: me.AccountID, DisplayName: me.DisplayName,
	})
}
```

Register in `New`:

```go
	s.mux.HandleFunc("POST /api/instances/{id}/test", s.handleTestInstance)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `docker compose run --rm --no-deps app go test ./internal/server/ -v`

Expected: PASS.

- [ ] **Step 5: Run the full gate**

Run: `make verify`

Expected: `verify: OK`.

- [ ] **Step 6: Commit**

```bash
git add internal/server
git commit -m "feat(server): test a stored instance's credentials

The test asserts identity via /myself. A search answers an
unauthenticated caller with 200 and no issues, so a search-based test
passes against credentials Jira has rejected."
```

---

### Task 9: Make dynamic `import()` actually split

**Files:**
- Modify: `web/build.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `dist/app.js` plus separate chunk files, so `import()` defers a view instead of inlining it.

**Why this comes before the router:** `build.mjs` sets `splitting: false` with `outfile`. esbuild inlines a dynamic `import()` under that configuration, so views would ship inside the entry bundle and the 14kB budget would be blown silently — the code would look lazy and not be. Code splitting requires `format: "esm"` (already set), `splitting: true` and `outdir` rather than `outfile`.

- [ ] **Step 1: Change the build configuration**

In `web/build.mjs`, replace `jsOptions`:

```js
const jsOptions = {
  entryPoints: ["src/main.ts"],
  // outdir, not outfile: code splitting emits chunks alongside the entry, and
  // esbuild rejects outfile when splitting is on. entryNames keeps the entry at
  // dist/app.js so index.html needs no change.
  outdir: "dist",
  entryNames: "app",
  chunkNames: "chunk-[hash]",
  bundle: true,
  format: "esm",
  // Views load through dynamic import(). Without splitting, esbuild inlines
  // them into the entry bundle and the lazy loading is a lie.
  splitting: true,
  minify: true,
  sourcemap: watch,
  target: ["es2022"],
};
```

- [ ] **Step 2: Verify the entry still builds to the expected path**

Run: `docker compose run --rm --no-deps web npm run build && docker compose run --rm --no-deps web ls -la dist/`

Expected: `dist/app.js`, `dist/app.css` and `dist/index.html` all present. No chunks yet — nothing uses `import()` until Task 10.

- [ ] **Step 3: Commit**

```bash
git add web/build.mjs
git commit -m "build(web): emit chunks so dynamic import defers a view

With splitting off, esbuild inlines dynamic imports into the entry
bundle: the lazy loading the 14kB budget depends on would be a lie."
```

---

### Task 10: Frontend core — types, API client, router, shell

**Files:**
- Create: `web/src/types.ts`
- Create: `web/src/api.ts`
- Create: `web/src/router.ts`
- Modify: `web/src/main.ts`
- Modify: `web/index.html`

**Interfaces:**
- Consumes: the JSON shapes from Tasks 6–8.
- Produces:
  ```ts
  // types.ts
  export interface Instance {
    id: number; name: string; siteUrl: string;
    apiBaseUrl: string; email: string; createdAt: string;
  }
  export interface ConnectionTest { accountId: string; displayName: string }
  export interface InstanceDraft {
    name: string; siteUrl: string; email: string; token?: string;
  }

  // api.ts
  export class ApiError extends Error {
    readonly status: number; readonly code: string;
  }
  export function listInstances(): Promise<Instance[]>;
  export function createInstance(draft: InstanceDraft): Promise<Instance>;
  export function updateInstance(id: number, draft: InstanceDraft): Promise<Instance>;
  export function deleteInstance(id: number): Promise<void>;
  export function testInstance(id: number): Promise<ConnectionTest>;

  // router.ts
  export function startRouter(root: HTMLElement): void;
  export function navigate(path: string): void;
  ```
  Every view module exports `render(root: HTMLElement): Promise<void>`.

- [ ] **Step 1: Write the types**

Create `web/src/types.ts`:

```ts
// A hand-written mirror of the Go response structs. There is no shared type
// definition across the language boundary; the API is small enough that drift
// surfaces immediately in the UI.

export interface Instance {
  id: number;
  name: string;
  /** Empty when the instance was migrated from a gateway URL, which carries no recoverable site. */
  siteUrl: string;
  apiBaseUrl: string;
  email: string;
  createdAt: string;
}

export interface ConnectionTest {
  accountId: string;
  displayName: string;
}

/** The fields a create or update sends. An absent token means "keep the stored one". */
export interface InstanceDraft {
  name: string;
  siteUrl: string;
  email: string;
  token?: string;
}

export interface ApiErrorBody {
  code: string;
  message: string;
}
```

- [ ] **Step 2: Write the API client**

Create `web/src/api.ts`:

```ts
import type { ApiErrorBody, ConnectionTest, Instance, InstanceDraft } from "./types";

/**
 * A failed API call. The code is what callers branch on: a rejected credential
 * and an unreachable host both fail a connection test and need different words,
 * and matching on message text would break the moment one is reworded.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch (cause) {
    throw new ApiError(0, "network_error", "Could not reach the dashboard server.");
  }

  if (!response.ok) {
    throw new ApiError(response.status, ...(await errorFrom(response)));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

/** Reads the server's {code, message} envelope, falling back when a proxy or crash returns something else. */
async function errorFrom(response: Response): Promise<[string, string]> {
  try {
    const body = (await response.json()) as Partial<ApiErrorBody>;
    if (body.code && body.message) {
      return [body.code, body.message];
    }
  } catch {
    // Fall through to the generic message below.
  }

  return ["unexpected", `The server returned ${response.status}.`];
}

export function listInstances(): Promise<Instance[]> {
  return request<Instance[]>("/api/instances");
}

export function createInstance(draft: InstanceDraft): Promise<Instance> {
  return request<Instance>("/api/instances", {
    method: "POST",
    body: JSON.stringify(draft),
  });
}

export function updateInstance(id: number, draft: InstanceDraft): Promise<Instance> {
  return request<Instance>(`/api/instances/${id}`, {
    method: "PATCH",
    body: JSON.stringify(draft),
  });
}

export function deleteInstance(id: number): Promise<void> {
  return request<void>(`/api/instances/${id}`, { method: "DELETE" });
}

export function testInstance(id: number): Promise<ConnectionTest> {
  return request<ConnectionTest>(`/api/instances/${id}/test`, { method: "POST" });
}
```

Note: `catch (cause)` declares an unused binding, which `noUnusedLocals` permits for catch parameters but ESLint may flag. Write `catch {` instead if the rule complains.

- [ ] **Step 3: Write the router**

Create `web/src/router.ts`:

```ts
interface View {
  render(root: HTMLElement): Promise<void>;
}

/**
 * Views load through dynamic import() so the entry bundle stays under the 14kB
 * initial-response budget. build.mjs must keep splitting on, or esbuild inlines
 * these and the deferral silently stops happening.
 */
const routes: Record<string, () => Promise<View>> = {
  "/settings": () => import("./views/settings"),
};

let mountPoint: HTMLElement | undefined;

export function startRouter(root: HTMLElement): void {
  mountPoint = root;

  window.addEventListener("popstate", () => {
    void renderCurrent();
  });

  // Intercept in-app links so navigation does not reload the shell.
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest("a[data-route]");
    if (!(link instanceof HTMLAnchorElement)) return;

    event.preventDefault();
    navigate(new URL(link.href).pathname);
  });

  void renderCurrent();
}

export function navigate(path: string): void {
  if (path !== window.location.pathname) {
    window.history.pushState({}, "", path);
  }
  void renderCurrent();
}

async function renderCurrent(): Promise<void> {
  const root = mountPoint;
  if (!root) return;

  const load = routes[window.location.pathname];
  if (!load) {
    renderPlaceholder(root);
    return;
  }

  const view = await load();
  root.replaceChildren();
  await view.render(root);
}

/**
 * Stands in for Today until #5 lands it. The server serves the app shell for any
 * unknown path, so this is what an unrouted URL reaches.
 */
function renderPlaceholder(root: HTMLElement): void {
  root.replaceChildren();

  const paragraph = document.createElement("p");
  paragraph.className = "text-neutral-600";
  paragraph.textContent = "Nothing here yet. Add a Jira instance to get started.";

  const link = document.createElement("a");
  link.href = "/settings";
  link.dataset["route"] = "";
  link.className = "mt-4 inline-block font-medium text-blue-700 underline";
  link.textContent = "Open Settings";

  root.append(paragraph, link);
}
```

- [ ] **Step 4: Update the shell and entry point**

Replace `web/src/main.ts`:

```ts
import { startRouter } from "./router";

const root = document.querySelector<HTMLElement>("#view");
if (root) {
  startRouter(root);
}
```

Replace the `<main>` block in `web/index.html`:

```html
    <main class="mx-auto max-w-3xl p-6">
      <header class="mb-6 flex items-baseline justify-between">
        <h1 class="text-2xl font-semibold">Work Dashboard</h1>
        <nav>
          <a
            href="/settings"
            data-route
            class="text-sm font-medium text-neutral-600 underline hover:text-neutral-900"
            >Settings</a
          >
        </nav>
      </header>
      <div id="view"></div>
    </main>
```

- [ ] **Step 5: Type-check, lint and build**

Run:
```shell
docker compose run --rm --no-deps web npx tsc --noEmit
docker compose run --rm --no-deps web npm run lint
docker compose run --rm --no-deps web npm run build
```

Expected: all three clean. The build now fails on the missing `./views/settings` — that is Task 12. If blocking, create `web/src/views/settings.ts` with `export async function render(): Promise<void> {}` and fill it in at Task 12.

- [ ] **Step 6: Commit**

```bash
git add web/src web/index.html
git commit -m "feat(web): add the router, typed API client and shell nav

The server already falls back to the app shell for client-side routes,
so the shell was promising routing that did not exist."
```

---

### Task 11: The `wd-*` components

**Files:**
- Create: `web/src/components/wd-card.ts`
- Create: `web/src/components/wd-button.ts`
- Create: `web/src/components/wd-alert.ts`

**Interfaces:**
- Produces three custom elements, all light DOM:
  - `<wd-card>` — a titled container. Attribute: `heading`.
  - `<wd-button>` — attributes `variant` (`primary` | `secondary` | `danger`), `disabled`. Emits ordinary click events.
  - `<wd-alert>` — attributes `tone` (`success` | `error` | `warning`), `message`.

**Light DOM, never shadow DOM.** A shadow root stops Tailwind's utility classes reaching component internals, which would force per-component style duplication.

- [ ] **Step 1: Write the card**

Create `web/src/components/wd-card.ts`:

```ts
/**
 * A titled container. Light DOM: children stay in the document, so Tailwind
 * utilities on them keep working and the card adds only its own wrapper classes.
 */
export class WdCard extends HTMLElement {
  connectedCallback(): void {
    this.className = "block rounded-lg border border-neutral-200 bg-white p-4 shadow-sm";

    const heading = this.getAttribute("heading");
    if (heading && !this.querySelector("[data-card-heading]")) {
      const title = document.createElement("h2");
      title.dataset["cardHeading"] = "";
      title.className = "mb-3 text-lg font-medium";
      title.textContent = heading;
      this.prepend(title);
    }
  }
}

customElements.define("wd-card", WdCard);
```

- [ ] **Step 2: Write the button**

Create `web/src/components/wd-button.ts`:

```ts
const VARIANTS: Record<string, string> = {
  primary: "bg-neutral-900 text-white hover:bg-neutral-700",
  secondary: "bg-white text-neutral-900 border border-neutral-300 hover:bg-neutral-50",
  danger: "bg-red-700 text-white hover:bg-red-600",
};

/**
 * Wraps a real <button> rather than making the host focusable itself, so that
 * keyboard activation, form participation and the disabled state come from the
 * platform instead of being reimplemented.
 */
export class WdButton extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["variant", "disabled", "label"];
  }

  private button: HTMLButtonElement | undefined;

  connectedCallback(): void {
    if (!this.button) {
      this.button = document.createElement("button");
      this.button.type = "button";
      this.append(this.button);
    }
    this.applyAttributes();
  }

  attributeChangedCallback(): void {
    if (this.button) {
      this.applyAttributes();
    }
  }

  private applyAttributes(): void {
    const button = this.button;
    if (!button) return;

    const variant = this.getAttribute("variant") ?? "secondary";
    const base =
      "inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium " +
      "disabled:cursor-not-allowed disabled:opacity-50";
    button.className = `${base} ${VARIANTS[variant] ?? VARIANTS["secondary"] ?? ""}`;
    button.disabled = this.hasAttribute("disabled");
    button.textContent = this.getAttribute("label") ?? "";
  }
}

customElements.define("wd-button", WdButton);
```

- [ ] **Step 3: Write the alert**

Create `web/src/components/wd-alert.ts`:

```ts
const TONES: Record<string, string> = {
  success: "border-green-300 bg-green-50 text-green-900",
  error: "border-red-300 bg-red-50 text-red-900",
  warning: "border-amber-300 bg-amber-50 text-amber-900",
};

/**
 * A status message. role="status" rather than "alert": these report the outcome
 * of something the user just did, so they should not interrupt a screen reader
 * mid-sentence.
 */
export class WdAlert extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["tone", "message"];
  }

  connectedCallback(): void {
    this.setAttribute("role", "status");
    this.render();
  }

  attributeChangedCallback(): void {
    this.render();
  }

  private render(): void {
    const tone = this.getAttribute("tone") ?? "warning";
    this.className = `block rounded-md border px-3 py-2 text-sm ${TONES[tone] ?? TONES["warning"] ?? ""}`;
    this.textContent = this.getAttribute("message") ?? "";
  }
}

customElements.define("wd-alert", WdAlert);
```

- [ ] **Step 4: Type-check and lint**

Run:
```shell
docker compose run --rm --no-deps web npx tsc --noEmit
docker compose run --rm --no-deps web npm run lint
```

Expected: clean. `noUncheckedIndexedAccess` is why every `VARIANTS[...]` lookup carries a fallback.

- [ ] **Step 5: Commit**

```bash
git add web/src/components
git commit -m "feat(web): add the wd-card, wd-button and wd-alert components

Light DOM throughout: a shadow root would stop Tailwind utilities
reaching component internals."
```

---

### Task 12: The Settings view

**Files:**
- Create: `web/src/views/settings.ts`

**Interfaces:**
- Consumes: `api.ts`, `types.ts` and all three components from Task 11.
- Produces: `export async function render(root: HTMLElement): Promise<void>`.

**Behaviour:**
- Lists instances, each row showing name, site URL, email, and buttons for Test, Edit and Remove.
- An instance with an empty `siteUrl` renders a warning naming what is missing — the migrated gateway-URL row.
- Adding and editing use one form; editing pre-fills it and leaves the token field blank, labelled to say a blank token keeps the stored one.
- The test button reports success (`Connected as <name>`) and failure (the server's message) distinguishably.
- No full page reload: the list re-renders in place after every mutation.

- [ ] **Step 1: Write the view**

Create `web/src/views/settings.ts`:

```ts
import "../components/wd-alert";
import "../components/wd-button";
import "../components/wd-card";

import { ApiError, createInstance, deleteInstance, listInstances, testInstance, updateInstance } from "../api";
import type { Instance } from "../types";

export async function render(root: HTMLElement): Promise<void> {
  const container = document.createElement("div");
  container.className = "space-y-6";
  root.append(container);

  await refresh(container);
}

async function refresh(container: HTMLElement): Promise<void> {
  container.replaceChildren();

  let instances: Instance[];
  try {
    instances = await listInstances();
  } catch (error) {
    container.append(alertFor("error", messageOf(error)));
    return;
  }

  container.append(instanceList(container, instances), instanceForm(container, undefined));
}

function instanceList(container: HTMLElement, instances: Instance[]): HTMLElement {
  const card = document.createElement("wd-card");
  card.setAttribute("heading", "Jira instances");

  if (instances.length === 0) {
    const empty = document.createElement("p");
    empty.className = "text-sm text-neutral-600";
    empty.textContent = "No instances yet. Add one below.";
    card.append(empty);

    return card;
  }

  const list = document.createElement("ul");
  list.className = "divide-y divide-neutral-200";
  for (const instance of instances) {
    list.append(instanceRow(container, instance));
  }
  card.append(list);

  return card;
}

function instanceRow(container: HTMLElement, instance: Instance): HTMLElement {
  const row = document.createElement("li");
  row.className = "py-3";
  row.dataset["instanceId"] = String(instance.id);

  const heading = document.createElement("div");
  heading.className = "flex items-center justify-between gap-3";

  const labels = document.createElement("div");
  const name = document.createElement("p");
  name.className = "font-medium";
  name.textContent = instance.name;
  const detail = document.createElement("p");
  detail.className = "text-sm text-neutral-600";
  detail.textContent = `${instance.email} · ${instance.siteUrl || "no site URL"}`;
  labels.append(name, detail);

  const actions = document.createElement("div");
  actions.className = "flex gap-2";
  const test = button("Test", "secondary");
  const edit = button("Edit", "secondary");
  const remove = button("Remove", "danger");
  actions.append(test, edit, remove);

  heading.append(labels, actions);
  row.append(heading);

  const status = document.createElement("div");
  status.className = "mt-2 empty:mt-0";
  row.append(status);

  // A migrated row that held a gateway URL: REST calls still work, but #5 has no
  // URL to link an issue to until the user supplies one.
  if (instance.siteUrl === "") {
    row.append(
      alertFor(
        "warning",
        "This instance has no site URL, so issue links are unavailable. Edit it to add one.",
      ),
    );
  }

  test.addEventListener("click", () => {
    void runConnectionTest(instance, test, status);
  });
  edit.addEventListener("click", () => {
    container.replaceChildren(instanceForm(container, instance));
  });
  remove.addEventListener("click", () => {
    void removeInstance(container, instance, status);
  });

  return row;
}

async function runConnectionTest(
  instance: Instance,
  trigger: HTMLElement,
  status: HTMLElement,
): Promise<void> {
  trigger.setAttribute("disabled", "");
  status.replaceChildren(alertFor("warning", "Testing…"));

  try {
    const result = await testInstance(instance.id);
    status.replaceChildren(alertFor("success", `Connected as ${result.displayName}.`));
  } catch (error) {
    status.replaceChildren(alertFor("error", messageOf(error)));
  } finally {
    trigger.removeAttribute("disabled");
  }
}

async function removeInstance(
  container: HTMLElement,
  instance: Instance,
  status: HTMLElement,
): Promise<void> {
  try {
    await deleteInstance(instance.id);
    await refresh(container);
  } catch (error) {
    status.replaceChildren(alertFor("error", messageOf(error)));
  }
}

function instanceForm(container: HTMLElement, editing: Instance | undefined): HTMLElement {
  const card = document.createElement("wd-card");
  card.setAttribute("heading", editing ? `Edit ${editing.name}` : "Add an instance");

  const form = document.createElement("form");
  form.className = "space-y-3";
  form.noValidate = true;

  const name = field("name", "Name", "text", editing?.name ?? "");
  const siteUrl = field("siteUrl", "Site URL", "url", editing?.siteUrl ?? "");
  const email = field("email", "Account email", "email", editing?.email ?? "");
  const token = field(
    "token",
    editing ? "API token (leave blank to keep the stored one)" : "API token",
    "password",
    "",
  );

  const status = document.createElement("div");
  const submit = button(editing ? "Save changes" : "Add instance", "primary");

  form.append(name.wrapper, siteUrl.wrapper, email.wrapper, token.wrapper, status, submit);
  card.append(form);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void save();
  });
  // wd-button renders a real <button type="button">, so it does not submit the
  // form on its own.
  submit.addEventListener("click", () => {
    void save();
  });

  async function save(): Promise<void> {
    submit.setAttribute("disabled", "");
    status.replaceChildren();

    const draft = {
      name: name.input.value,
      siteUrl: siteUrl.input.value,
      email: email.input.value,
      ...(token.input.value === "" ? {} : { token: token.input.value }),
    };

    try {
      if (editing) {
        await updateInstance(editing.id, draft);
      } else {
        await createInstance(draft);
      }
      await refresh(container);
    } catch (error) {
      status.replaceChildren(alertFor("error", messageOf(error)));
      submit.removeAttribute("disabled");
    }
  }

  return card;
}

interface Field {
  wrapper: HTMLElement;
  input: HTMLInputElement;
}

function field(name: string, label: string, type: string, value: string): Field {
  const wrapper = document.createElement("label");
  wrapper.className = "block";

  const caption = document.createElement("span");
  caption.className = "mb-1 block text-sm font-medium text-neutral-700";
  caption.textContent = label;

  const input = document.createElement("input");
  input.name = name;
  input.type = type;
  input.value = value;
  input.className =
    "w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm " +
    "focus:border-neutral-900 focus:outline-none";

  wrapper.append(caption, input);

  return { wrapper, input };
}

function button(label: string, variant: string): HTMLElement {
  const element = document.createElement("wd-button");
  element.setAttribute("label", label);
  element.setAttribute("variant", variant);

  return element;
}

function alertFor(tone: string, message: string): HTMLElement {
  const alert = document.createElement("wd-alert");
  alert.setAttribute("tone", tone);
  alert.setAttribute("message", message);

  return alert;
}

/** The server's message when there is one; ApiError carries it already. */
function messageOf(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  return "Something went wrong.";
}
```

- [ ] **Step 2: Type-check, lint and build**

Run:
```shell
docker compose run --rm --no-deps web npx tsc --noEmit
docker compose run --rm --no-deps web npm run lint
docker compose run --rm --no-deps web npm run build
```

Expected: clean, and `dist/` now holds `app.js` **plus at least one `chunk-*.js`** — proof the view is deferred rather than inlined. Check with:

```shell
docker compose run --rm --no-deps web ls dist/
```

- [ ] **Step 3: Confirm the shell stays under budget**

Run: `docker compose run --rm --no-deps web sh -c 'wc -c dist/index.html dist/app.js dist/app.css'`

Expected: `index.html` well under 14kB. Record the numbers in the pull request. If `app.js` alone approaches the budget, that is a finding to raise, not something to work around.

- [ ] **Step 4: Commit**

```bash
git add web/src/views
git commit -m "feat(web): add the settings view

Instance CRUD with a connection test, re-rendering in place. A migrated
instance with no site URL is flagged rather than hidden."
```

---

### Task 13: The Playwright spec

**Files:**
- Create: `.claude/e2e/tests/settings.spec.ts`
- Modify: `docs/superpowers/plans/2026-08-12-handoff.md`

**Interfaces:**
- Consumes: the routes from Tasks 6–8 and the view from Task 12.
- Produces: end-to-end coverage of adding an instance and running a connection test against a stubbed backend.

**No real Jira, and no real backend either.** `page.route` intercepts `/api/instances*`, so the spec exercises the view's behaviour rather than the server's — the server has its own `httptest` coverage.

- [ ] **Step 1: Write the spec**

Create `.claude/e2e/tests/settings.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";

interface StubInstance {
  id: number;
  name: string;
  siteUrl: string;
  apiBaseUrl: string;
  email: string;
  createdAt: string;
}

/**
 * Stubs the instances API in the browser, so the spec covers the view rather
 * than the server. The server's own behaviour is covered by httptest, and no
 * test anywhere contacts a real Jira instance.
 */
async function stubInstancesApi(page: Page, options: { testStatus: number }): Promise<void> {
  const instances: StubInstance[] = [];

  await page.route("**/api/instances", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { name: string; siteUrl: string; email: string };
      const created: StubInstance = {
        id: instances.length + 1,
        name: body.name,
        siteUrl: body.siteUrl,
        apiBaseUrl: "https://api.atlassian.com/ex/jira/7c41e2b6",
        email: body.email,
        createdAt: "2026-08-12T09:00:00Z",
      };
      instances.push(created);
      await route.fulfill({ status: 201, json: created });
      return;
    }

    await route.fulfill({ status: 200, json: instances });
  });

  await page.route("**/api/instances/*/test", async (route) => {
    if (options.testStatus === 200) {
      await route.fulfill({ status: 200, json: { accountId: "5b10a2", displayName: "Dion" } });
      return;
    }
    await route.fulfill({
      status: options.testStatus,
      json: { code: "credentials_rejected", message: "Jira rejected the email and API token" },
    });
  });
}

async function addInstance(page: Page): Promise<void> {
  await page.getByLabel("Name").fill("Work");
  await page.getByLabel("Site URL").fill("https://example.atlassian.net");
  await page.getByLabel("Account email").fill("me@example.com");
  await page.getByLabel("API token", { exact: true }).fill("secret");
  await page.getByRole("button", { name: "Add instance" }).click();
}

test("an instance can be added and appears in the list", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");

  await expect(page.getByText("No instances yet. Add one below.")).toBeVisible();

  await addInstance(page);

  await expect(page.getByText("Work")).toBeVisible();
  await expect(page.getByText("me@example.com · https://example.atlassian.net")).toBeVisible();
});

test("a successful connection test names the account", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");
  await addInstance(page);

  await page.getByRole("button", { name: "Test" }).click();

  await expect(page.getByText("Connected as Dion.")).toBeVisible();
});

// Success and failure must be distinguishable, which is the whole point of a
// test button that asserts identity rather than a 2xx.
test("a rejected connection test reports the failure", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 401 });
  await page.goto("/settings");
  await addInstance(page);

  await page.getByRole("button", { name: "Test" }).click();

  await expect(page.getByText("Jira rejected the email and API token")).toBeVisible();
  await expect(page.getByText("Connected as")).toBeHidden();
});

test("settings is reachable from the shell nav", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/");

  await page.getByRole("link", { name: "Settings" }).click();

  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Add an instance" })).toBeVisible();
});
```

- [ ] **Step 2: Run the end-to-end suite**

Run: `make test-e2e`

Expected: every spec passes on both Firefox and Chromium, including the pre-existing `smoke.spec.ts`. **Firefox is the primary target** — a Firefox-only failure is a real failure, not flake.

If `getByLabel` does not match, the cause is the `<label>` wrapping in `field()` rather than the spec; fix the view so the accessible name is correct rather than switching the spec to a CSS selector.

- [ ] **Step 3: Confirm the e2e CI gate already covers this**

`.github/workflows/e2e.yml` lists `web/**` and `.claude/e2e/**` in its `paths:`, so both this spec and the frontend changes are covered. **No change to the workflow is needed** — verify this rather than assuming, by re-reading the `paths:` list.

- [ ] **Step 4: Update the handoff**

In `docs/superpowers/plans/2026-08-12-handoff.md`, under "Where things stand", record that #4 is implemented and in review, and note the two findings this work produced:

- The migration cannot be a table rebuild — `DROP TABLE` with foreign keys on cascades into `time_entries`. Verified.
- `build.mjs` had `splitting: false`, which inlines dynamic `import()`; the 14kB budget depended on a deferral that was not happening.

Do **not** push this as its own pull request — handoff edits accumulate and go out when the owner signals end of day.

- [ ] **Step 5: Run the full gate**

Run:
```shell
make verify
make test-e2e
```

Expected: `verify: OK` and a green Playwright run. **Paste both outputs into the pull request.**

- [ ] **Step 6: Commit**

```bash
git add .claude/e2e/tests/settings.spec.ts docs/superpowers/plans/2026-08-12-handoff.md
git commit -m "test(e2e): cover adding an instance and testing its connection

The backend is stubbed with page.route: the spec covers the view, and
the server has its own httptest coverage."
```

---

## After the last task

1. **Whole-branch review.** `superpowers:requesting-code-review` across the entire diff, not per task. Ticket 1's seven task reviews all passed while the branch still shipped a Critical defect that only a cross-task read could see.
2. **Both gates green, output pasted.** `make verify` and `make test-e2e`.
3. **`superpowers:finishing-a-development-branch`** — push and open the pull request with `Closes #4`.
4. **Move the ticket to `status:review`** in the same breath:
   ```shell
   gh issue edit 4 --remove-label status:ready --add-label status:review
   ```
5. **Stop.** Review → done is the owner's move alone, and no amount of green changes that.

## Blockers

Any of these is a hard stop under the `ticket-workflow` skill — move #4 to `status:blocked`, say what happened, and stop. Do not lower a threshold, skip a test, or reshape the scope to get past one.

- A dependency outside `modernc.org/sqlite` and `golang.org/x/sync` appears necessary.
- `tsconfig.json` would have to be weakened, or `any` / a non-null assertion used, to type something.
- The 14kB initial-response budget cannot be met.
- A test can only be made to pass by asserting something weaker than the acceptance criterion.
- The migration cannot preserve a pre-existing row without manual repair.
