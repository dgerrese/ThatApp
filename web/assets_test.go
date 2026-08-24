package web

import (
	"encoding/json"
	"fmt"
	"image/png"
	"os"
	"strings"
	"testing"
)

type manifestIcon struct {
	Src   string `json:"src"`
	Sizes string `json:"sizes"`
}

type manifest struct {
	Icons []manifestIcon `json:"icons"`
}

func readManifest(t *testing.T) manifest {
	t.Helper()

	data, err := os.ReadFile("manifest.json")
	if err != nil {
		t.Fatalf("reading manifest.json: %v", err)
	}

	var m manifest
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("decoding manifest.json: %v", err)
	}
	return m
}

// sizesToDimensions turns "512x512" into (512, 512).
func sizesToDimensions(sizes string) (width, height int, err error) {
	before, after, found := strings.Cut(sizes, "x")
	if !found {
		return 0, 0, fmt.Errorf("sizes %q is not WxH", sizes)
	}
	if _, err := fmt.Sscanf(before, "%d", &width); err != nil {
		return 0, 0, fmt.Errorf("sizes %q: %w", sizes, err)
	}
	if _, err := fmt.Sscanf(after, "%d", &height); err != nil {
		return 0, 0, fmt.Errorf("sizes %q: %w", sizes, err)
	}
	return width, height, nil
}

func TestManifestIconsMatchCommittedPNGDimensions(t *testing.T) {
	for _, icon := range readManifest(t).Icons {
		t.Run(icon.Src, func(t *testing.T) {
			wantWidth, wantHeight, err := sizesToDimensions(icon.Sizes)
			if err != nil {
				t.Fatalf("parsing manifest sizes: %v", err)
			}

			path := strings.TrimPrefix(icon.Src, "/")
			f, err := os.Open(path)
			if err != nil {
				t.Fatalf("opening %s: %v", path, err)
			}
			defer f.Close()

			cfg, err := png.DecodeConfig(f)
			if err != nil {
				t.Fatalf("decoding %s as PNG: %v", path, err)
			}
			if cfg.Width != wantWidth || cfg.Height != wantHeight {
				t.Errorf("%s is %dx%d, manifest declares %s", path, cfg.Width, cfg.Height, icon.Sizes)
			}
		})
	}
}
