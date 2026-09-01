// Package crypto seals Jira API tokens so that possession of the SQLite file
// alone does not yield working credentials.
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"fmt"
)

// KeySize is the AES-256 key length callers must supply. config validates
// THAT_SECRET_KEY to this length at boot.
const KeySize = 32

// Sealer encrypts and decrypts tokens with AES-GCM under one key.
type Sealer struct {
	aead cipher.AEAD
}

// NewSealer builds a Sealer from a 32-byte key.
func NewSealer(key []byte) (*Sealer, error) {
	if len(key) != KeySize {
		return nil, fmt.Errorf("sealer key is %d bytes, want %d", len(key), KeySize)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("creating AES cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("creating GCM: %w", err)
	}

	return &Sealer{aead: aead}, nil
}

// Seal encrypts a token, returning the nonce followed by the ciphertext. GCM
// nonces must never repeat under one key, so each call draws a fresh one and
// carries it alongside the output rather than deriving it from anything.
func (s *Sealer) Seal(plaintext string) ([]byte, error) {
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, fmt.Errorf("drawing nonce: %w", err)
	}

	return s.aead.Seal(nonce, nonce, []byte(plaintext), nil), nil
}

// Open decrypts what Seal produced. GCM authenticates as it decrypts, so a
// tampered nonce, ciphertext or tag fails here rather than returning garbage.
func (s *Sealer) Open(sealed []byte) (string, error) {
	nonceSize := s.aead.NonceSize()
	if len(sealed) < nonceSize {
		return "", fmt.Errorf("sealed value is %d bytes, shorter than the %d-byte nonce", len(sealed), nonceSize)
	}

	nonce, ciphertext := sealed[:nonceSize], sealed[nonceSize:]
	plaintext, err := s.aead.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("opening sealed token: %w", err)
	}

	return string(plaintext), nil
}
