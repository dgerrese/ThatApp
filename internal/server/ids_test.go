package server

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

// TestEveryIDRouteAnswersAMalformedIDAsAMissingOne: a path segment that is not
// a positive integer names no resource, so it gets the same 404 not_found a
// well-formed id with no row behind it gets, on every {id} route and method.
func TestEveryIDRouteAnswersAMalformedIDAsAMissingOne(t *testing.T) {
	routes := []struct {
		method, prefix, suffix, body, message string
	}{
		{http.MethodPatch, "/api/instances/", "",
			`{"name":"X","siteUrl":"https://x.atlassian.net","email":"me@example.com"}`, "no such instance"},
		{http.MethodDelete, "/api/instances/", "", "", "no such instance"},
		{http.MethodPost, "/api/instances/", "/test", "", "no such instance"},
		{http.MethodDelete, "/api/pins/", "", "", "no such pin"},
		{http.MethodPatch, "/api/entries/", "", `{"seconds":900}`, "no such entry"},
		{http.MethodDelete, "/api/entries/", "", "", "no such entry"},
	}
	ids := []struct{ name, id string }{
		{"non-numeric", "abc"},
		{"zero", "0"},
		{"negative", "-1"},
		{"beyond int64", "9223372036854775808"},
		{"well-formed but missing", "999999"},
	}

	for _, route := range routes {
		for _, id := range ids {
			t.Run(route.method+" "+route.prefix+"{id}"+route.suffix+" "+id.name, func(t *testing.T) {
				srv, _, _ := serverInZone(t, "Europe/Amsterdam",
					time.Date(2026, 8, 21, 12, 5, 0, 0, time.UTC))

				rec := callEntries(t, srv, route.method, route.prefix+id.id+route.suffix, route.body)

				assertRejected(t, rec, http.StatusNotFound, "not_found")
				var body errorBody
				if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
					t.Fatalf("decoding %s: %v", rec.Body.String(), err)
				}
				if body.Message != route.message {
					t.Errorf("message = %q, want %q", body.Message, route.message)
				}
			})
		}
	}
}
