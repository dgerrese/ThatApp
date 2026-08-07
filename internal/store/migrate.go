package store

import (
	"embed"
	"fmt"
	"io/fs"
	"slices"
	"strings"
	"time"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// migrate applies every embedded migration this database has not recorded yet,
// in lexicographic filename order.
//
// Each migration and the row recording it commit together. A migration applied
// without its row would run again on the next boot; a row without its migration
// would skip it forever.
func (s *Store) migrate() error {
	if _, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version    VARCHAR(150) PRIMARY KEY,
			applied_at DATETIME NOT NULL
		)`); err != nil {
		return fmt.Errorf("creating schema_migrations: %w", err)
	}

	applied, err := s.appliedMigrations()
	if err != nil {
		return err
	}

	names, err := migrationNames()
	if err != nil {
		return err
	}

	if unknown := unknownRecordedMigrations(applied, names); len(unknown) > 0 {
		return fmt.Errorf(
			"database records migrations this build does not carry, so its schema is newer "+
				"than this binary understands: %s", strings.Join(unknown, ", "),
		)
	}

	for _, name := range names {
		if applied[name] {
			continue
		}

		body, err := migrationsFS.ReadFile("migrations/" + name)
		if err != nil {
			return fmt.Errorf("reading migration %s: %w", name, err)
		}
		if err := s.applyMigration(name, body); err != nil {
			return fmt.Errorf("applying migration %s: %w", name, err)
		}
	}

	return nil
}

// appliedMigrations returns the set of migration filenames already recorded.
func (s *Store) appliedMigrations() (map[string]bool, error) {
	rows, err := s.db.Query(`SELECT version FROM schema_migrations`)
	if err != nil {
		return nil, fmt.Errorf("reading schema_migrations: %w", err)
	}
	defer func() { _ = rows.Close() }()

	applied := make(map[string]bool)
	for rows.Next() {
		var version string
		if err := rows.Scan(&version); err != nil {
			return nil, fmt.Errorf("scanning schema_migrations: %w", err)
		}
		applied[version] = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating schema_migrations: %w", err)
	}

	return applied, nil
}

// unknownRecordedMigrations returns the recorded versions absent from embedded,
// sorted. A non-empty result means the database was migrated by a newer build —
// roll the image back after a schema change and this is what catches it, rather
// than the app running happily against a shape it does not understand.
func unknownRecordedMigrations(applied map[string]bool, embedded []string) []string {
	known := make(map[string]bool, len(embedded))
	for _, name := range embedded {
		known[name] = true
	}

	unknown := make([]string, 0)
	for version := range applied {
		if !known[version] {
			unknown = append(unknown, version)
		}
	}
	slices.Sort(unknown)

	return unknown
}

// migrationNames lists the embedded migration filenames in the order they must
// be applied. The timestamp naming scheme sorts correctly under plain string
// comparison, including when a collision added a millisecond suffix.
func migrationNames() ([]string, error) {
	entries, err := fs.ReadDir(migrationsFS, "migrations")
	if err != nil {
		return nil, fmt.Errorf("reading embedded migrations: %w", err)
	}

	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	slices.Sort(names)

	return names, nil
}

// applyMigration runs body and records name, in one transaction. A migration
// another process recorded first is left alone.
//
// The applied set is read before this transaction opens, so a second process
// starting against the same fresh database can reach here for a migration that
// is no longer unapplied. Rechecking inside the transaction closes that window:
// the DSN's _txlock=immediate means the write lock is held from BEGIN, so the
// loser of the race waits, then sees the winner's row and skips instead of
// dying on "table instances already exists".
func (s *Store) applyMigration(name string, body []byte) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("beginning transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var recorded int
	if err := tx.QueryRow(
		`SELECT count(*) FROM schema_migrations WHERE version = ?`, name,
	).Scan(&recorded); err != nil {
		return fmt.Errorf("rechecking: %w", err)
	}
	if recorded > 0 {
		return nil
	}

	if _, err := tx.Exec(string(body)); err != nil {
		return fmt.Errorf("executing: %w", err)
	}

	if _, err := tx.Exec(
		`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`,
		name, time.Now().UTC().Format(time.RFC3339),
	); err != nil {
		return fmt.Errorf("recording: %w", err)
	}

	return tx.Commit()
}
