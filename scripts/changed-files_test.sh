#!/bin/sh
# Runs in the app container through `make test-scripts`.
set -u
cd "$(dirname "$0")"
failed=0

check() { # name, files, want
	got=$(printf '%s' "$2" | sh changed-files.sh 2>&1)
	if [ "$got" != "$3" ]; then
		echo "FAIL changed-files: $1: got '$got', want '$3'" >&2
		failed=1
	fi
}

no='code=false
e2e=false'
check "nothing changed" "" "$no"
check "docs only" "docs/superpowers/plans/x.md
README.md
.claude/skills/eod/SKILL.md
docs/design.png
web/README.md
" "$no"
check "Go code" "docs/a.md
internal/server/server.go
" "code=true
e2e=false"
check "frontend" "web/src/app.ts
" "code=true
e2e=true"
check "the rig's own workflow" ".github/workflows/ci.yml
" "code=true
e2e=true"
check "release workflow is code, not rig" ".github/workflows/release.yml
" "code=true
e2e=false"

exit $failed
