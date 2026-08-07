package store

import (
	"path/filepath"
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

func TestOpenRejectsAnUnusableDatabase(t *testing.T) {
	// A directory is not a database file. Open must fail rather than hand back
	// a Store whose first real query dies.
	if _, err := Open(t.TempDir()); err == nil {
		t.Fatal("Open() on a directory succeeded, want error")
	}
}
