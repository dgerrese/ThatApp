package update

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func newer(tag string) string {
	return `{"tag_name":"` + tag + `","html_url":"https://github.com/dgerrese/ThatApp/releases/tag/` + tag + `"}`
}

func TestCheck(t *testing.T) {
	tests := []struct {
		name    string
		current string
		status  int
		body    string
		sleep   time.Duration
		want    *Release
		wantErr string
	}{
		{"newer", "2026.47.1", 200, newer("v2026.49.1"), 0, &Release{"2026.49.1", "https://github.com/dgerrese/ThatApp/releases/tag/v2026.49.1"}, ""},
		{"same", "2026.47.1", 200, newer("v2026.47.1"), 0, nil, ""},
		{"older", "2026.47.1", 200, newer("v2026.46.3"), 0, nil, ""},
		{"newer week lower N", "2026.47.9", 200, newer("v2026.48.1"), 0, &Release{"2026.48.1", "https://github.com/dgerrese/ThatApp/releases/tag/v2026.48.1"}, ""},
		{"string compare trap", "2026.9.1", 200, newer("v2026.10.1"), 0, &Release{"2026.10.1", "https://github.com/dgerrese/ThatApp/releases/tag/v2026.10.1"}, ""},
		{"404", "2026.47.1", 404, "", 0, nil, "GitHub answered 404."},
		{"403", "2026.47.1", 403, "", 0, nil, "GitHub answered 403."},
		{"not json", "2026.47.1", 200, "<html>", 0, nil, "GitHub's answer could not be read."},
		{"no tag", "2026.47.1", 200, "{}", 0, nil, `GitHub's newest release "" is not a version.`},
		{"bad tag", "2026.47.1", 200, `{"tag_name":"nightly"}`, 0, nil, `GitHub's newest release "nightly" is not a version.`},
		{"hang", "2026.47.1", 200, "{}", 300 * time.Millisecond, nil, "GitHub did not answer."},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if got := r.Header.Get("Accept"); got != "application/vnd.github+json" {
					t.Errorf("Accept = %q", got)
				}
				if got := r.Header.Get("User-Agent"); got != "ThatApp" {
					t.Errorf("User-Agent = %q", got)
				}
				time.Sleep(tt.sleep)
				w.WriteHeader(tt.status)
				_, _ = w.Write([]byte(tt.body))
			}))
			defer srv.Close()
			c := NewChecker(tt.current, srv.URL, &http.Client{Timeout: 50 * time.Millisecond})
			c.Check(context.Background())
			got := c.Status()
			if got.Err != tt.wantErr {
				t.Errorf("Err = %q, want %q", got.Err, tt.wantErr)
			}
			switch {
			case tt.want == nil && got.Latest != nil:
				t.Errorf("Latest = %+v, want nil", *got.Latest)
			case tt.want != nil && (got.Latest == nil || *got.Latest != *tt.want):
				t.Errorf("Latest = %+v, want %+v", got.Latest, *tt.want)
			}
		})
	}
}

func TestCheckRecovers(t *testing.T) {
	status := 404
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(status)
		if status == 200 {
			_, _ = w.Write([]byte(newer("v2026.49.1")))
		}
	}))
	defer srv.Close()
	c := NewChecker("2026.47.1", srv.URL, srv.Client())
	c.Check(context.Background())
	if c.Status().Err == "" {
		t.Fatal("first check: Err empty, want failure")
	}
	status = 200
	c.Check(context.Background())
	if got := c.Status(); got.Err != "" || got.Latest == nil {
		t.Errorf("after recovery: %+v", got)
	}
}

func TestParseVersion(t *testing.T) {
	tests := []struct {
		in      string
		want    Version
		wantErr bool
	}{
		{"2026.47.1", Version{2026, 47, 1}, false},
		{"v2026.47.1", Version{2026, 47, 1}, false},
		{"2026.47", Version{}, true},
		{"2026.47.1.2", Version{}, true},
		{"2026.x.1", Version{}, true},
		{"", Version{}, true},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			got, err := ParseVersion(tt.in)
			if (err != nil) != tt.wantErr || got != tt.want {
				t.Errorf("ParseVersion(%q) = %v, %v", tt.in, got, err)
			}
		})
	}
}

func TestRunChecksImmediately(t *testing.T) {
	hit := make(chan struct{}, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		select {
		case hit <- struct{}{}:
		default:
		}
		_, _ = w.Write([]byte(newer("v2026.49.1")))
	}))
	defer srv.Close()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		NewChecker("2026.47.1", srv.URL, srv.Client()).Run(ctx, time.Hour)
		close(done)
	}()
	select {
	case <-hit:
	case <-time.After(time.Second):
		t.Fatal("no request within 1s")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Run did not return after cancel")
	}
}
