package store

import (
	"context"
	"database/sql"
	"errors"
	"testing"
)

func createTestPin(t *testing.T, s *Store, instanceID int64, key string) *Pin {
	t.Helper()

	pin, err := s.CreatePin(context.Background(), PinInput{
		InstanceID:   instanceID,
		IssueKey:     key,
		SummaryCache: "Weekly standup",
		StatusCache:  "In Progress",
	})
	if err != nil {
		t.Fatalf("creating pin %q: %v", key, err)
	}

	return pin
}

func TestCreatePinReturnsTheStoredRow(t *testing.T) {
	s := openTestStore(t)
	inst := createTestInstance(t, s)

	pin := createTestPin(t, s, inst.ID, "SHARED-12")

	if pin.ID == 0 {
		t.Error("ID = 0, want an assigned id")
	}
	if pin.IssueKey != "SHARED-12" {
		t.Errorf("IssueKey = %q, want SHARED-12", pin.IssueKey)
	}
	if pin.SummaryCache != "Weekly standup" {
		t.Errorf("SummaryCache = %q, want Weekly standup", pin.SummaryCache)
	}
	if pin.StatusCache != "In Progress" {
		t.Errorf("StatusCache = %q, want In Progress", pin.StatusCache)
	}
	if pin.CreatedAt.IsZero() {
		t.Error("CreatedAt is zero")
	}
}

func TestPinsRoundTripBothCaches(t *testing.T) {
	s := openTestStore(t)
	inst := createTestInstance(t, s)
	createTestPin(t, s, inst.ID, "SHARED-12")

	pins, err := s.Pins(context.Background())
	if err != nil {
		t.Fatalf("reading pins: %v", err)
	}
	if len(pins) != 1 {
		t.Fatalf("got %d pins, want 1", len(pins))
	}
	if pins[0].SummaryCache != "Weekly standup" || pins[0].StatusCache != "In Progress" {
		t.Errorf("caches = %q/%q, want Weekly standup/In Progress",
			pins[0].SummaryCache, pins[0].StatusCache)
	}
}

// The UNIQUE(instance_id, issue_key) constraint has to reach the handler as
// something it can answer 409 to, not as an opaque driver error.
func TestPinningTheSameKeyTwiceIsRejected(t *testing.T) {
	s := openTestStore(t)
	inst := createTestInstance(t, s)
	createTestPin(t, s, inst.ID, "SHARED-12")

	_, err := s.CreatePin(context.Background(), PinInput{
		InstanceID: inst.ID, IssueKey: "SHARED-12", SummaryCache: "Again", StatusCache: "To Do",
	})

	if !errors.Is(err, ErrPinExists) {
		t.Errorf("err = %v, want ErrPinExists", err)
	}
}

// The constraint is per instance, not global: the same shared key can exist on
// two sites and both are pinnable.
func TestTheSameKeyOnAnotherInstanceIsAllowed(t *testing.T) {
	s := openTestStore(t)
	first := createTestInstance(t, s)
	second, err := s.CreateInstance(context.Background(), InstanceInput{
		Name: "Second", SiteURL: "https://second.atlassian.net",
		Email: "a@b.c", TokenEnc: []byte("sealed"),
	})
	if err != nil {
		t.Fatalf("creating the second instance: %v", err)
	}
	createTestPin(t, s, first.ID, "SHARED-12")

	if _, err := s.CreatePin(context.Background(), PinInput{
		InstanceID: second.ID, IssueKey: "SHARED-12", SummaryCache: "Standup", StatusCache: "Open",
	}); err != nil {
		t.Errorf("pinning the same key on another instance: %v", err)
	}
}

func TestSetPinCacheRewritesBothColumns(t *testing.T) {
	s := openTestStore(t)
	inst := createTestInstance(t, s)
	pin := createTestPin(t, s, inst.ID, "SHARED-12")

	if err := s.SetPinCache(context.Background(), pin.ID, "Renamed standup", "Done"); err != nil {
		t.Fatalf("rewriting the cache: %v", err)
	}

	pins, err := s.Pins(context.Background())
	if err != nil {
		t.Fatalf("reading pins: %v", err)
	}
	if pins[0].SummaryCache != "Renamed standup" || pins[0].StatusCache != "Done" {
		t.Errorf("caches = %q/%q, want Renamed standup/Done",
			pins[0].SummaryCache, pins[0].StatusCache)
	}
}

func TestSetPinCacheOnAMissingIDIsNotFound(t *testing.T) {
	s := openTestStore(t)

	err := s.SetPinCache(context.Background(), 404, "x", "y")

	if !errors.Is(err, sql.ErrNoRows) {
		t.Errorf("err = %v, want sql.ErrNoRows", err)
	}
}

func TestDeletePinRemovesTheRow(t *testing.T) {
	s := openTestStore(t)
	inst := createTestInstance(t, s)
	pin := createTestPin(t, s, inst.ID, "SHARED-12")

	if err := s.DeletePin(context.Background(), pin.ID); err != nil {
		t.Fatalf("deleting the pin: %v", err)
	}

	pins, err := s.Pins(context.Background())
	if err != nil {
		t.Fatalf("reading pins: %v", err)
	}
	if len(pins) != 0 {
		t.Errorf("got %d pins, want 0", len(pins))
	}
}

func TestDeletePinOnAMissingIDIsNotFound(t *testing.T) {
	s := openTestStore(t)

	err := s.DeletePin(context.Background(), 404)

	if !errors.Is(err, sql.ErrNoRows) {
		t.Errorf("err = %v, want sql.ErrNoRows", err)
	}
}

// The view iterates the result without a null check.
func TestPinsIsEmptyNotNilWhenNoneStored(t *testing.T) {
	s := openTestStore(t)

	pins, err := s.Pins(context.Background())
	if err != nil {
		t.Fatalf("reading pins: %v", err)
	}
	if pins == nil {
		t.Fatal("Pins returned nil, want an empty slice")
	}
	if len(pins) != 0 {
		t.Errorf("got %d pins, want 0", len(pins))
	}
}

func TestDeletingAnInstanceTakesItsPins(t *testing.T) {
	s := openTestStore(t)
	inst := createTestInstance(t, s)
	createTestPin(t, s, inst.ID, "SHARED-12")

	if err := s.DeleteInstance(context.Background(), inst.ID); err != nil {
		t.Fatalf("deleting the instance: %v", err)
	}

	pins, err := s.Pins(context.Background())
	if err != nil {
		t.Fatalf("reading pins: %v", err)
	}
	if len(pins) != 0 {
		t.Errorf("got %d pins after the cascade, want 0", len(pins))
	}
}
