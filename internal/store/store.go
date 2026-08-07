// Package store persists the dashboard's state in SQLite.
package store

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"modernc.org/sqlite" // registers the "sqlite" driver
	sqlite3 "modernc.org/sqlite/lib"
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
//
// _txlock=immediate is a deliberate trade. busy_timeout covers plain statements
// but not transactions: db.Begin opens a deferred transaction, and when that
// upgrades from read to write SQLite returns SQLITE_BUSY immediately rather than
// waiting, because waiting there could deadlock. Beginning IMMEDIATE takes the
// write lock up front, where busy_timeout does apply. The cost is that every
// transaction takes the write lock, so read-only transactions serialise with
// writers — acceptable for a single-user app, and cheaper than intermittent
// SQLITE_BUSY in the code that owns the user's timesheet.
func Open(path string) (*Store, error) {
	dsn := fmt.Sprintf(
		"file:%s?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)"+
			"&_pragma=busy_timeout(5000)&_txlock=immediate",
		path,
	)

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("opening database %s: %w", path, err)
	}

	// sql.Open is lazy, so a bad path only surfaces on first use. Ping now, to
	// fail at startup rather than on the first request.
	if err := pingRetryingBusy(db); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("connecting to database %s: %w", path, err)
	}

	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("migrating database %s: %w", path, err)
	}

	return s, nil
}

// connectAttempts bounds pingRetryingBusy. Ten attempts at a 10ms step back off
// over roughly half a second, which is far longer than the WAL conversion the
// retry exists for.
const connectAttempts = 10

// pingRetryingBusy opens a connection, retrying while SQLite reports the
// database busy.
//
// Converting a database to WAL needs exclusive access, and unlike ordinary lock
// contention SQLite does not run the busy handler for it — busy_timeout cannot
// help. Two processes creating the same database at once, which is a compose
// stack starting on an empty volume, would otherwise leave one dead at boot. The
// conversion happens once; a retry finds the database already in WAL. Any other
// error returns straight away, so an unusable path still fails fast.
func pingRetryingBusy(db *sql.DB) error {
	var err error
	for attempt := range connectAttempts {
		if err = db.Ping(); err == nil || !isBusy(err) {
			return err
		}
		time.Sleep(time.Duration(attempt+1) * 10 * time.Millisecond)
	}

	return err
}

func isBusy(err error) bool {
	var sqliteErr *sqlite.Error

	return errors.As(err, &sqliteErr) && sqliteErr.Code() == sqlite3.SQLITE_BUSY
}

// Close releases the database handle.
func (s *Store) Close() error {
	return s.db.Close()
}
