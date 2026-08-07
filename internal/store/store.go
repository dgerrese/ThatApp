// Package store persists the dashboard's state in SQLite.
package store

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite" // registers the "sqlite" driver
)

// Store owns the database handle. Open is its sole constructor.
type Store struct {
	db *sql.DB
}

// Open connects to the SQLite database at path.
//
// The pragmas travel in the DSN rather than as separate statements so that they
// apply to every connection database/sql pools, not only to whichever one
// happened to execute them. foreign_keys matters most: SQLite defaults it off,
// and without it the schema's ON DELETE CASCADE clauses silently do nothing.
func Open(path string) (*Store, error) {
	dsn := fmt.Sprintf(
		"file:%s?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)",
		path,
	)

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("opening database %s: %w", path, err)
	}

	// sql.Open is lazy, so a bad path only surfaces on first use. Ping now, to
	// fail at startup rather than on the first request.
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("connecting to database %s: %w", path, err)
	}

	return &Store{db: db}, nil
}

// Close releases the database handle.
func (s *Store) Close() error {
	return s.db.Close()
}
