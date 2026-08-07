package config_test

import (
	"testing"

	"github.com/dgerrese/work-dashboard/internal/config"
)

func envFrom(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func validEnv() map[string]string {
	return map[string]string{
		// 32 zero bytes, base64-encoded
		"WD_SECRET_KEY": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
		"WD_TIMEZONE":   "Europe/Amsterdam",
	}
}

func TestLoadAppliesDefaults(t *testing.T) {
	cfg, err := config.Load(envFrom(validEnv()))
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}
	if cfg.Addr != ":8080" {
		t.Errorf("Addr = %q, want %q", cfg.Addr, ":8080")
	}
	if cfg.DBPath != "/data/work-dashboard.db" {
		t.Errorf("DBPath = %q, want %q", cfg.DBPath, "/data/work-dashboard.db")
	}
	if cfg.Location.String() != "Europe/Amsterdam" {
		t.Errorf("Location = %q, want %q", cfg.Location, "Europe/Amsterdam")
	}
	if len(cfg.Secret) != 32 {
		t.Errorf("len(Secret) = %d, want 32", len(cfg.Secret))
	}
}

func TestLoadRejectsBadInput(t *testing.T) {
	cases := map[string]func(map[string]string){
		"missing secret":     func(m map[string]string) { delete(m, "WD_SECRET_KEY") },
		"secret not base64":  func(m map[string]string) { m["WD_SECRET_KEY"] = "not!base64" },
		"secret wrong size":  func(m map[string]string) { m["WD_SECRET_KEY"] = "AAAA" },
		"missing timezone":   func(m map[string]string) { delete(m, "WD_TIMEZONE") },
		"unparseable tzname": func(m map[string]string) { m["WD_TIMEZONE"] = "Mars/Olympus" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			env := validEnv()
			mutate(env)
			if _, err := config.Load(envFrom(env)); err == nil {
				t.Fatal("Load() succeeded, want error")
			}
		})
	}
}

func TestLoadHonoursOverrides(t *testing.T) {
	env := validEnv()
	env["WD_ADDR"] = ":9999"
	env["WD_DB_PATH"] = "/tmp/other.db"

	cfg, err := config.Load(envFrom(env))
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}
	if cfg.Addr != ":9999" {
		t.Errorf("Addr = %q, want %q", cfg.Addr, ":9999")
	}
	if cfg.DBPath != "/tmp/other.db" {
		t.Errorf("DBPath = %q, want %q", cfg.DBPath, "/tmp/other.db")
	}
}
