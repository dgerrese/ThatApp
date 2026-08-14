package server

import (
	"path/filepath"
	"testing"
	"testing/fstest"
	"time"

	"github.com/dgerrese/work-dashboard/internal/config"
	"github.com/dgerrese/work-dashboard/internal/crypto"
	"github.com/dgerrese/work-dashboard/internal/store"
)

// newServerWithStore builds a Server over a real store in a temp directory and
// a sealer with a throwaway key.
func newServerWithStore(t *testing.T) (*Server, *store.Store, *crypto.Sealer) {
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

func TestNewWiresTheStoreAndSealerItWasGiven(t *testing.T) {
	s, db, sealer := newServerWithStore(t)

	if s.db != db {
		t.Error("s.db is not the store passed to New")
	}
	if s.sealer != sealer {
		t.Error("s.sealer is not the sealer passed to New")
	}
}
