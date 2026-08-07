package store

import (
	"path/filepath"
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

func TestDeletingAnInstanceCascades(t *testing.T) {
	// This is the test that fails if the foreign_keys pragma is ever dropped.
	// Without it SQLite accepts the delete and silently orphans every child row.
	s := openTestStore(t)

	if _, err := s.db.Exec(
		`INSERT INTO instances (id, name, base_url, email, api_token_enc, created_at)
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
