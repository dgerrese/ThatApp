package server

import (
	"path/filepath"
	"testing"
	"testing/fstest"
	"time"

	"github.com/dgerrese/ThatApp/internal/config"
	"github.com/dgerrese/ThatApp/internal/crypto"
	"github.com/dgerrese/ThatApp/internal/store"
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

// TestNewDefaultsNowToTheWallClock brackets the default clock between two
// time.Now readings taken after New returned. A nil field panics, a zero or
// fixed instant falls outside the bracket, and an instant captured during New
// lands before it — so only a live clock passes.
func TestNewDefaultsNowToTheWallClock(t *testing.T) {
	s, _, _ := newServerWithStore(t)

	if s.now == nil {
		t.Fatal("New left s.now nil; handlers would panic on the first request")
	}

	before := time.Now()
	got := s.now()
	after := time.Now()

	if got.Before(before) || got.After(after) {
		t.Errorf("s.now() = %v, want an instant within [%v, %v]", got, before, after)
	}

	time.Sleep(time.Millisecond)
	if next := s.now(); !next.After(got) {
		t.Errorf("s.now() returned %v twice; the default is a captured instant, not a clock", next)
	}
}
