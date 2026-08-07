//go:build !dev

// Package web exposes the built frontend as a filesystem.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var distFS embed.FS

// Assets returns the frontend built into the binary at compile time.
func Assets() fs.FS {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		// Unreachable: "dist" is embedded above, so the subtree always exists.
		panic(err)
	}
	return sub
}
