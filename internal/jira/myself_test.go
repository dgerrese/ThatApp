package jira

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMyselfReturnsTheAuthenticatedAccount(t *testing.T) {
	var gotPath, gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		_, _ = w.Write([]byte(
			`{"accountId":"5b10a2","displayName":"Dion","active":true}`))
	}))
	defer srv.Close()

	client, err := New(srv.URL, "me@example.com", "token")
	if err != nil {
		t.Fatalf("New() returned error: %v", err)
	}

	me, err := client.Myself(context.Background())
	if err != nil {
		t.Fatalf("Myself() returned error: %v", err)
	}
	if me.AccountID != "5b10a2" {
		t.Errorf("AccountID = %q, want %q", me.AccountID, "5b10a2")
	}
	if me.DisplayName != "Dion" {
		t.Errorf("DisplayName = %q, want %q", me.DisplayName, "Dion")
	}
	if !me.Active {
		t.Error("Active = false, want true")
	}
	if gotPath != "/rest/api/3/myself" {
		t.Errorf("requested %q, want /rest/api/3/myself", gotPath)
	}
	if gotAuth == "" {
		t.Error("no Authorization header sent; the call must be authenticated")
	}
}

func TestMyselfMapsRejectedCredentials(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"message":"Client must be authenticated"}`))
	}))
	defer srv.Close()

	client, err := New(srv.URL, "me@example.com", "token")
	if err != nil {
		t.Fatalf("New() returned error: %v", err)
	}

	if _, err := client.Myself(context.Background()); !errors.Is(err, ErrUnauthorized) {
		t.Errorf("Myself() error = %v, want ErrUnauthorized", err)
	}
}

func TestMyselfRejectsAnAccountWithNoID(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"displayName":"Anonymous"}`))
	}))
	defer srv.Close()

	client, err := New(srv.URL, "me@example.com", "token")
	if err != nil {
		t.Fatalf("New() returned error: %v", err)
	}

	if _, err := client.Myself(context.Background()); err == nil {
		t.Error("Myself() succeeded on a response with no accountId, want an error")
	}
}

// The trap CB#22 was raised for, at the client level: a stub that answers a search
// happily and /myself with a 401 must not look healthy. A connection test built
// on SearchAssigned would pass here.
func TestSearchSucceedsWhereMyselfFailsOnRejectedCredentials(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/rest/api/3/myself" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(`{"issues":[],"isLast":true}`))
	}))
	defer srv.Close()

	client, err := New(srv.URL, "me@example.com", "token")
	if err != nil {
		t.Fatalf("New() returned error: %v", err)
	}

	if _, err := client.SearchAssigned(context.Background()); err != nil {
		t.Fatalf("SearchAssigned() returned error: %v; the trap requires it to succeed", err)
	}
	if _, err := client.Myself(context.Background()); !errors.Is(err, ErrUnauthorized) {
		t.Errorf("Myself() error = %v, want ErrUnauthorized", err)
	}
}
