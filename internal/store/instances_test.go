package store

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func createTestInstance(t *testing.T, s *Store) *Instance {
	t.Helper()

	inst, err := s.CreateInstance(
		context.Background(), "Acme", "https://acme.atlassian.net", "a@b.c", []byte{0x01, 0x02},
	)
	if err != nil {
		t.Fatalf("CreateInstance() returned error: %v", err)
	}

	return inst
}

func TestCreateInstanceReturnsTheStoredRow(t *testing.T) {
	s := openTestStore(t)

	before := time.Now().UTC().Truncate(time.Second)
	inst := createTestInstance(t, s)
	after := time.Now().UTC()

	if inst.ID == 0 {
		t.Error("ID = 0, want the id the database assigned")
	}
	if inst.Name != "Acme" {
		t.Errorf("Name = %q, want %q", inst.Name, "Acme")
	}
	if inst.CreatedAt.Before(before) || inst.CreatedAt.After(after) {
		t.Errorf("CreatedAt = %v, want within [%v, %v]", inst.CreatedAt, before, after)
	}

	stored, err := s.Instance(context.Background(), inst.ID)
	if err != nil {
		t.Fatalf("Instance() returned error: %v", err)
	}
	if !stored.CreatedAt.Equal(inst.CreatedAt) {
		t.Errorf("stored CreatedAt = %v, want %v — the timestamp did not round-trip", stored.CreatedAt, inst.CreatedAt)
	}
}

func TestInstanceTokenRoundTripsUnchanged(t *testing.T) {
	// The store must treat the token as opaque bytes: encryption is ticket 3's
	// job, and a store that transformed it would break that separation.
	s := openTestStore(t)
	token := []byte{0x00, 0xff, 0x10, 0x00, 0x7f}

	created, err := s.CreateInstance(context.Background(), "Acme", "https://a.example", "a@b.c", token)
	if err != nil {
		t.Fatalf("CreateInstance() returned error: %v", err)
	}

	stored, err := s.Instance(context.Background(), created.ID)
	if err != nil {
		t.Fatalf("Instance() returned error: %v", err)
	}
	if string(stored.TokenEnc) != string(token) {
		t.Errorf("TokenEnc = %v, want %v", stored.TokenEnc, token)
	}
}

func TestInstancesReturnsEveryRow(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	for _, name := range []string{"Acme", "Globex"} {
		if _, err := s.CreateInstance(ctx, name, "https://x.example", "a@b.c", []byte{0x01}); err != nil {
			t.Fatalf("CreateInstance(%q) returned error: %v", name, err)
		}
	}

	all, err := s.Instances(ctx)
	if err != nil {
		t.Fatalf("Instances() returned error: %v", err)
	}
	if len(all) != 2 {
		t.Fatalf("len(Instances()) = %d, want 2", len(all))
	}
}

func TestInstancesAreOldestFirst(t *testing.T) {
	// instances.id is INTEGER PRIMARY KEY without AUTOINCREMENT, so SQLite may
	// reuse a rowid freed by a delete. Ordering by id alone would then put a newly
	// created site before older ones.
	s := openTestStore(t)

	rows := []struct {
		id        int64
		name      string
		createdAt string
	}{
		{id: 9, name: "oldest", createdAt: "2026-08-01T09:00:00Z"},
		{id: 1, name: "newest", createdAt: "2026-08-03T09:00:00Z"},
		{id: 5, name: "middle", createdAt: "2026-08-02T09:00:00Z"},
	}
	for _, row := range rows {
		if _, err := s.db.Exec(
			`INSERT INTO instances (id, name, base_url, email, api_token_enc, created_at)
			 VALUES (?, ?, 'https://x.example', 'a@b.c', X'01', ?)`,
			row.id, row.name, row.createdAt,
		); err != nil {
			t.Fatalf("inserting %q: %v", row.name, err)
		}
	}

	all, err := s.Instances(context.Background())
	if err != nil {
		t.Fatalf("Instances() returned error: %v", err)
	}

	want := []string{"oldest", "middle", "newest"}
	if len(all) != len(want) {
		t.Fatalf("len(Instances()) = %d, want %d", len(all), len(want))
	}
	for i, name := range want {
		if all[i].Name != name {
			got := make([]string, len(all))
			for j, inst := range all {
				got[j] = inst.Name
			}
			t.Fatalf("Instances() order = %v, want %v", got, want)
		}
	}
}

func TestInstanceDoesNotSerialiseItsToken(t *testing.T) {
	// From ticket 3 TokenEnc holds an AES-GCM ciphertext of a Jira API token.
	// Ticket 4 drives instances from a settings UI, where the obvious handler
	// hands the struct straight to json.NewEncoder.
	token := []byte("ciphertext-not-for-the-browser")
	inst := &Instance{
		ID: 1, Name: "Acme", BaseURL: "https://acme.atlassian.net",
		Email: "a@b.c", TokenEnc: token, CreatedAt: time.Now().UTC(),
	}

	encoded, err := json.Marshal(inst)
	if err != nil {
		t.Fatalf("json.Marshal() returned error: %v", err)
	}

	for _, leak := range []string{
		"TokenEnc",
		"api_token_enc",
		base64.StdEncoding.EncodeToString(token),
	} {
		if strings.Contains(string(encoded), leak) {
			t.Errorf("json.Marshal(Instance) = %s, want it to omit %q", encoded, leak)
		}
	}
}

func TestInstancesIsEmptyWhenNoneStored(t *testing.T) {
	s := openTestStore(t)

	all, err := s.Instances(context.Background())
	if err != nil {
		t.Fatalf("Instances() returned error: %v", err)
	}
	if len(all) != 0 {
		t.Errorf("len(Instances()) = %d, want 0", len(all))
	}
}

func TestUpdateInstanceChangesTheStoredRow(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	inst := createTestInstance(t, s)

	if err := s.UpdateInstance(ctx, inst.ID, "Renamed", "https://new.example", "new@b.c", []byte{0x09}); err != nil {
		t.Fatalf("UpdateInstance() returned error: %v", err)
	}

	stored, err := s.Instance(ctx, inst.ID)
	if err != nil {
		t.Fatalf("Instance() returned error: %v", err)
	}
	if stored.Name != "Renamed" {
		t.Errorf("Name = %q, want %q", stored.Name, "Renamed")
	}
	if stored.BaseURL != "https://new.example" {
		t.Errorf("BaseURL = %q, want %q", stored.BaseURL, "https://new.example")
	}
	if string(stored.TokenEnc) != string([]byte{0x09}) {
		t.Errorf("TokenEnc = %v, want %v", stored.TokenEnc, []byte{0x09})
	}
}

func TestDeleteInstanceRemovesTheRow(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	inst := createTestInstance(t, s)

	if err := s.DeleteInstance(ctx, inst.ID); err != nil {
		t.Fatalf("DeleteInstance() returned error: %v", err)
	}

	if _, err := s.Instance(ctx, inst.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Errorf("Instance() after delete returned %v, want an error wrapping sql.ErrNoRows", err)
	}
}

func TestMissingInstanceIsNotFound(t *testing.T) {
	// A silent no-op here would surface in ticket 4 as a settings form that
	// reports success and changes nothing.
	s := openTestStore(t)
	ctx := context.Background()
	const missing int64 = 4242

	cases := map[string]func() error{
		"Instance": func() error {
			_, err := s.Instance(ctx, missing)
			return err
		},
		"UpdateInstance": func() error {
			return s.UpdateInstance(ctx, missing, "x", "https://x.example", "a@b.c", []byte{0x01})
		},
		"DeleteInstance": func() error {
			return s.DeleteInstance(ctx, missing)
		},
	}

	for name, call := range cases {
		t.Run(name, func(t *testing.T) {
			if err := call(); !errors.Is(err, sql.ErrNoRows) {
				t.Errorf("%s on a missing id returned %v, want an error wrapping sql.ErrNoRows", name, err)
			}
		})
	}
}
