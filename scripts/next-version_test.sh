#!/bin/sh
# Runs in the app container through `make test-scripts`.
set -u
cd "$(dirname "$0")"
failed=0

check() { # name, date, tags, want
	got=$(printf '%s' "$3" | sh next-version.sh "$2" 2>&1)
	if [ "$got" != "$4" ]; then
		echo "FAIL next-version: $1: got '$got', want '$4'" >&2
		failed=1
	fi
}

check "no tags" 2026-11-19 "" 2026.47.1
check "highest N in the week plus one" 2026-11-19 "v2026.47.1
v2026.47.2
v2026.46.9
" 2026.47.3
check "N compares as a number" 2026-11-19 "v2026.47.9
v2026.47.10
" 2026.47.11
check "ISO week 1 is zero-padded" 2027-01-04 "" 2027.01.1
check "ISO year, not calendar year" 2026-12-31 "" 2026.53.1
check "ISO year differs from calendar year" 2027-01-01 "v2026.53.1
" 2026.53.2
check "non-matching tags ignored" 2026-11-19 "2026.47.5
v2026.47.x
v2026.47.3-rc1
xv2026.47.7
v12026.47.8
" 2026.47.1

exit $failed
