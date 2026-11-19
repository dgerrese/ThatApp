#!/bin/sh
# Prints the release version for DATE: YYYY.WW.N, the ISO year and week of DATE
# and one more than the highest N among the tags vYYYY.WW.* read on stdin.
#
# usage: git tag -l | next-version.sh YYYY-MM-DD
set -eu

week=$(date -d "${1:?usage: next-version.sh YYYY-MM-DD}" +%G.%V)
n=$(awk -v p="v$week." '
	index($0, p) == 1 && substr($0, length(p) + 1) ~ /^[1-9][0-9]*$/ {
		n = substr($0, length(p) + 1) + 0
		if (n > max) max = n
	}
	END { print max + 1 }')
echo "$week.$n"
