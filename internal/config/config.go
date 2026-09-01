// Package config loads and validates the server's runtime configuration.
package config

import (
	"encoding/base64"
	"fmt"
	"time"
)

// secretKeyLen is the AES-256 key size the token encryption requires.
const secretKeyLen = 32

// Config holds validated runtime settings. A Config only ever exists in a valid
// state; Load is the sole constructor and it rejects anything incomplete.
type Config struct {
	Addr     string
	DBPath   string
	Secret   []byte
	Location *time.Location
}

// Load reads configuration through getenv and validates it. Callers pass
// os.Getenv in production; tests pass a map lookup.
func Load(getenv func(string) string) (*Config, error) {
	secret, err := decodeSecret(getenv("THAT_SECRET_KEY"))
	if err != nil {
		return nil, err
	}

	tzName := getenv("THAT_TIMEZONE")
	if tzName == "" {
		return nil, fmt.Errorf("THAT_TIMEZONE is required (an IANA name such as Europe/Amsterdam)")
	}
	loc, err := time.LoadLocation(tzName)
	if err != nil {
		return nil, fmt.Errorf("THAT_TIMEZONE %q is not a known timezone: %w", tzName, err)
	}

	return &Config{
		Addr:     orDefault(getenv("THAT_ADDR"), ":8080"),
		DBPath:   orDefault(getenv("THAT_DB_PATH"), "/data/thatapp.db"),
		Secret:   secret,
		Location: loc,
	}, nil
}

func decodeSecret(raw string) ([]byte, error) {
	if raw == "" {
		return nil, fmt.Errorf("THAT_SECRET_KEY is required (%d base64-encoded bytes)", secretKeyLen)
	}
	secret, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return nil, fmt.Errorf("THAT_SECRET_KEY is not valid base64: %w", err)
	}
	if len(secret) != secretKeyLen {
		return nil, fmt.Errorf("THAT_SECRET_KEY decodes to %d bytes, want %d", len(secret), secretKeyLen)
	}
	return secret, nil
}

func orDefault(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
