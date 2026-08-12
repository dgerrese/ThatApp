package store

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func tableExists(t *testing.T, s *Store, name string) bool {
	t.Helper()

	var n int
	err := s.db.QueryRow(
		`SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, name,
	).Scan(&n)
	if err != nil {
		t.Fatalf("querying sqlite_master for %q: %v", name, err)
	}

	return n > 0
}

func TestOpenCreatesEverySchemaTable(t *testing.T) {
	s := openTestStore(t)

	for _, name := range []string{
		"instances", "pinned_issues", "time_entries", "timers", "schema_migrations",
	} {
		t.Run(name, func(t *testing.T) {
			if !tableExists(t, s, name) {
				t.Errorf("table %q does not exist after Open", name)
			}
		})
	}
}

func TestMigrateIsIdempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")

	first, err := Open(path)
	if err != nil {
		t.Fatalf("first Open() returned error: %v", err)
	}
	if err := first.Close(); err != nil {
		t.Fatalf("closing first store: %v", err)
	}

	second, err := Open(path)
	if err != nil {
		t.Fatalf("second Open() returned error: %v", err)
	}
	t.Cleanup(func() { _ = second.Close() })

	// One row per migration file, not two. A second Open must record nothing new.
	var rows int
	if err := second.db.QueryRow(`SELECT count(*) FROM schema_migrations`).Scan(&rows); err != nil {
		t.Fatalf("counting schema_migrations: %v", err)
	}

	names, err := migrationNames()
	if err != nil {
		t.Fatalf("migrationNames() returned error: %v", err)
	}
	if rows != len(names) {
		t.Errorf("schema_migrations has %d rows, want %d (one per migration file)", rows, len(names))
	}
}

func TestOpenRejectsADatabaseMigratedByANewerBuild(t *testing.T) {
	// Rolling the container image back after a schema change must not start the
	// app against a database whose shape it does not understand.
	path := filepath.Join(t.TempDir(), "test.db")

	first, err := Open(path)
	if err != nil {
		t.Fatalf("first Open() returned error: %v", err)
	}

	const future = "2099-01-01_000000_future.sql"
	if _, err := first.db.Exec(
		`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`,
		future, "2099-01-01T00:00:00Z",
	); err != nil {
		t.Fatalf("recording a future migration: %v", err)
	}
	if err := first.Close(); err != nil {
		t.Fatalf("closing first store: %v", err)
	}

	second, err := Open(path)
	if err == nil {
		_ = second.Close()
		t.Fatal("Open() succeeded against a database migrated by a newer build, want error")
	}
	if !strings.Contains(err.Error(), future) {
		t.Errorf("Open() error = %v, want it to name the unknown version %q", err, future)
	}
}

func TestConcurrentOpenMigratesExactlyOnce(t *testing.T) {
	// Two containers racing on `docker compose up` open the same fresh database
	// at once. Each Open gets its own connection pool, so this is the real race:
	// without the recheck inside the migration transaction the loser dies with
	// "table instances already exists".
	path := filepath.Join(t.TempDir(), "test.db")

	const openers = 8
	var wg sync.WaitGroup
	errs := make(chan error, openers)
	start := make(chan struct{})

	for range openers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			s, err := Open(path)
			if err != nil {
				errs <- err
				return
			}
			t.Cleanup(func() { _ = s.Close() })
		}()
	}
	close(start)
	wg.Wait()
	close(errs)

	for err := range errs {
		t.Errorf("concurrent Open() returned error: %v", err)
	}

	s, err := Open(path)
	if err != nil {
		t.Fatalf("Open() after the race returned error: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })

	names, err := migrationNames()
	if err != nil {
		t.Fatalf("migrationNames() returned error: %v", err)
	}

	var rows int
	if err := s.db.QueryRow(`SELECT count(*) FROM schema_migrations`).Scan(&rows); err != nil {
		t.Fatalf("counting schema_migrations: %v", err)
	}
	if rows != len(names) {
		t.Errorf("schema_migrations has %d rows, want %d (one per migration file)", rows, len(names))
	}
}

func TestFailedMigrationLeavesNothingBehind(t *testing.T) {
	s := openTestStore(t)

	// A migration whose second statement is invalid. The first must not survive:
	// SQLite DDL is transactional, which is what makes a failed migration safe.
	const bad = `
CREATE TABLE should_not_survive (id INTEGER PRIMARY KEY);
CREATE TABLE this is not valid sql;
`
	if err := s.applyMigration("9999-01-01_000000_bad.sql", []byte(bad)); err == nil {
		t.Fatal("applyMigration() succeeded on invalid SQL, want error")
	}

	if tableExists(t, s, "should_not_survive") {
		t.Error("the failed migration's first statement persisted; the transaction did not roll back")
	}

	var n int
	if err := s.db.QueryRow(
		`SELECT count(*) FROM schema_migrations WHERE version = ?`, "9999-01-01_000000_bad.sql",
	).Scan(&n); err != nil {
		t.Fatalf("counting schema_migrations: %v", err)
	}
	if n != 0 {
		t.Errorf("failed migration recorded %d rows in schema_migrations, want 0", n)
	}
}

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

func TestDeletingAnInstanceCascades(t *testing.T) {
	// This is the test that fails if the foreign_keys pragma is ever dropped.
	// Without it SQLite accepts the delete and silently orphans every child row.
	s := openTestStore(t)

	if _, err := s.db.Exec(
		`INSERT INTO instances (id, name, site_url, email, api_token_enc, created_at)
		 VALUES (1, 'Acme', 'https://acme.atlassian.net', 'a@b.c', X'00', '2026-08-07T12:00:00Z')`,
	); err != nil {
		t.Fatalf("inserting instance: %v", err)
	}

	children := map[string]string{
		"pinned_issues": `INSERT INTO pinned_issues (instance_id, issue_key, created_at)
		                  VALUES (1, 'ABC-1', '2026-08-07T12:00:00Z')`,
		"time_entries": `INSERT INTO time_entries
		                  (instance_id, issue_key, day, started_at, seconds, created_at, updated_at)
		                  VALUES (1, 'ABC-1', '2026-08-07', '2026-08-07T12:00:00Z', 60,
		                          '2026-08-07T12:00:00Z', '2026-08-07T12:00:00Z')`,
		"timers": `INSERT INTO timers (id, instance_id, issue_key, started_at)
		           VALUES (1, 1, 'ABC-1', '2026-08-07T12:00:00Z')`,
	}
	for table, insert := range children {
		if _, err := s.db.Exec(insert); err != nil {
			t.Fatalf("inserting into %s: %v", table, err)
		}
	}

	if _, err := s.db.Exec(`DELETE FROM instances WHERE id = 1`); err != nil {
		t.Fatalf("deleting instance: %v", err)
	}

	for table := range children {
		t.Run(table, func(t *testing.T) {
			var n int
			if err := s.db.QueryRow(`SELECT count(*) FROM ` + table).Scan(&n); err != nil {
				t.Fatalf("counting %s: %v", table, err)
			}
			if n != 0 {
				t.Errorf("%s has %d rows after deleting its instance, want 0 — the cascade did not fire", table, n)
			}
		})
	}
}
