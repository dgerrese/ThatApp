//go:build dev

package web

import (
	"io/fs"
	"os"
)

// Assets returns the frontend read from disk, so that a rebuild is visible on
// refresh without recompiling the binary. The path is relative to the repo
// root, which is the working directory the dev container runs from.
func Assets() fs.FS {
	return os.DirFS("web/dist")
}
