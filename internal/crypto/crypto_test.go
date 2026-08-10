package crypto_test

import (
	"bytes"
	"testing"

	"github.com/dgerrese/work-dashboard/internal/crypto"
)

// key32 is a fixed 32-byte key. Tests must not depend on randomness they do not control.
func key32() []byte {
	return bytes.Repeat([]byte{0x2a}, 32)
}

func TestSealOpenRoundTrip(t *testing.T) {
	sealer, err := crypto.NewSealer(key32())
	if err != nil {
		t.Fatalf("NewSealer: %v", err)
	}

	tests := []struct {
		name  string
		token string
	}{
		{"typical token", "ATATT3xFfGF0abcdef1234567890"},
		{"empty", ""},
		{"unicode", "tøkèn-ünicode-✓"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sealed, err := sealer.Seal(tt.token)
			if err != nil {
				t.Fatalf("Seal: %v", err)
			}
			if tt.token != "" && bytes.Contains(sealed, []byte(tt.token)) {
				t.Error("sealed output contains the plaintext")
			}

			got, err := sealer.Open(sealed)
			if err != nil {
				t.Fatalf("Open: %v", err)
			}
			if got != tt.token {
				t.Errorf("Open = %q, want %q", got, tt.token)
			}
		})
	}
}

func TestSealUsesAFreshNonce(t *testing.T) {
	sealer, err := crypto.NewSealer(key32())
	if err != nil {
		t.Fatalf("NewSealer: %v", err)
	}

	first, err := sealer.Seal("same-token")
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	second, err := sealer.Seal("same-token")
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}

	if bytes.Equal(first, second) {
		t.Error("sealing the same token twice produced identical output; the nonce is not fresh")
	}
}

func TestOpenRejectsTamperedCiphertext(t *testing.T) {
	sealer, err := crypto.NewSealer(key32())
	if err != nil {
		t.Fatalf("NewSealer: %v", err)
	}

	sealed, err := sealer.Seal("a-real-token")
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}

	tests := []struct {
		name    string
		corrupt func([]byte) []byte
	}{
		{"flipped byte in ciphertext", func(b []byte) []byte {
			out := bytes.Clone(b)
			out[len(out)-1] ^= 0xff
			return out
		}},
		{"flipped byte in nonce", func(b []byte) []byte {
			out := bytes.Clone(b)
			out[0] ^= 0xff
			return out
		}},
		{"truncated below nonce size", func(b []byte) []byte {
			return b[:4]
		}},
		{"empty", func([]byte) []byte { return nil }},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := sealer.Open(tt.corrupt(sealed)); err == nil {
				t.Error("Open accepted corrupt input; want an error")
			}
		})
	}
}

func TestNewSealerRejectsWrongKeySize(t *testing.T) {
	for _, size := range []int{0, 16, 31, 33} {
		if _, err := crypto.NewSealer(bytes.Repeat([]byte{1}, size)); err == nil {
			t.Errorf("NewSealer accepted a %d-byte key; want an error", size)
		}
	}
}

func TestOpenRejectsAnotherKeysCiphertext(t *testing.T) {
	mine, err := crypto.NewSealer(key32())
	if err != nil {
		t.Fatalf("NewSealer: %v", err)
	}
	theirs, err := crypto.NewSealer(bytes.Repeat([]byte{0x99}, 32))
	if err != nil {
		t.Fatalf("NewSealer: %v", err)
	}

	sealed, err := theirs.Seal("not-yours")
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}

	if _, err := mine.Open(sealed); err == nil {
		t.Error("Open accepted ciphertext sealed with a different key")
	}
}
