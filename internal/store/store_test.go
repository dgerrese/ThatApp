package store

import (
	"fmt"
	"path/filepath"
	"sync"
	"testing"
)

func openTestStore(t *testing.T) *Store {
	t.Helper()

	s, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("Open() returned error: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })

	return s
}

func TestOpenSetsPragmas(t *testing.T) {
	s := openTestStore(t)

	// foreign_keys is the load-bearing one: SQLite defaults it off, and without
	// it every ON DELETE CASCADE in the schema silently does nothing.
	cases := map[string]string{
		"foreign_keys": "1",
		"journal_mode": "wal",
		"busy_timeout": "5000",
	}

	for pragma, want := range cases {
		t.Run(pragma, func(t *testing.T) {
			var got string
			if err := s.db.QueryRow("PRAGMA " + pragma).Scan(&got); err != nil {
				t.Fatalf("PRAGMA %s: %v", pragma, err)
			}
			if got != want {
				t.Errorf("PRAGMA %s = %q, want %q", pragma, got, want)
			}
		})
	}
}

// readThenInsertInTransaction models the shape tickets 6-9 need: read inside a
// transaction, then write, then commit. A deferred transaction takes its write
// lock at the INSERT, and SQLite refuses to wait for that upgrade.
func readThenInsertInTransaction(s *Store, n int) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("beginning: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var count int
	if err := tx.QueryRow(`SELECT count(*) FROM instances`).Scan(&count); err != nil {
		return fmt.Errorf("reading: %w", err)
	}

	if _, err := tx.Exec(
		`INSERT INTO instances (name, site_url, email, api_token_enc, created_at)
		 VALUES (?, ?, ?, ?, ?)`,
		fmt.Sprintf("site-%d", n), "https://x.example", "a@b.c", []byte{0x01},
		"2026-08-07T12:00:00Z",
	); err != nil {
		return fmt.Errorf("inserting: %w", err)
	}

	return tx.Commit()
}

func TestConcurrentWriteTransactionsAllCommit(t *testing.T) {
	// This is the test that fails if _txlock=immediate is ever dropped from the
	// DSN. busy_timeout covers plain statements but not a deferred transaction's
	// read-to-write upgrade, where SQLite returns SQLITE_BUSY at once rather than
	// waiting, because waiting could deadlock.
	s := openTestStore(t)

	const writers = 8
	var wg sync.WaitGroup
	errs := make(chan error, writers)
	start := make(chan struct{})

	for i := range writers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			if err := readThenInsertInTransaction(s, i); err != nil {
				errs <- err
			}
		}()
	}
	close(start)
	wg.Wait()
	close(errs)

	failed := 0
	for err := range errs {
		failed++
		t.Errorf("concurrent write transaction failed: %v", err)
	}
	if failed > 0 {
		t.Fatalf("%d of %d concurrent write transactions failed, want 0", failed, writers)
	}

	var stored int
	if err := s.db.QueryRow(`SELECT count(*) FROM instances`).Scan(&stored); err != nil {
		t.Fatalf("counting instances: %v", err)
	}
	if stored != writers {
		t.Errorf("instances has %d rows, want %d", stored, writers)
	}
}

func TestOpenRejectsAnUnusableDatabase(t *testing.T) {
	// A directory is not a database file. Open must fail rather than hand back
	// a Store whose first real query dies.
	if _, err := Open(t.TempDir()); err == nil {
		t.Fatal("Open() on a directory succeeded, want error")
	}
}
