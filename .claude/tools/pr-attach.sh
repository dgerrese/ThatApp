#!/bin/sh
# Put screenshots for a pull request on the orphan branch `pr-assets`, and print
# the markdown to paste.
#
#   usage: pr-attach.sh <number> <file> [<file>...]
#
# GitHub has no API to attach an image to a pull request, so the files are
# committed under pr-<number>/ on a branch that shares no history with the code.
# No code branch and no release image ever carries a screenshot. The commit is
# built with plumbing on a throwaway index, so the working tree, the real index
# and the current branch are never touched, and it is signed like every push.
set -eu

usage='usage: pr-attach.sh <number> <file> [<file>...]'
number=${1:?$usage}
shift
[ $# -gt 0 ] || { echo "$usage" >&2; exit 2; }

case $number in
*[!0-9]*) echo "pr-attach: '$number' is not a pull request number" >&2; exit 2 ;;
esac

for file do
	[ -f "$file" ] || { echo "pr-attach: no such file: $file" >&2; exit 1; }
	case $(basename "$file") in
	*[!A-Za-z0-9._-]*) echo "pr-attach: '$file': use only letters, digits, '.', '_' and '-' in the name" >&2; exit 2 ;;
	esac
done

# The remote decides the repository, so this works unchanged in a fork.
remote=$(git config --get branch.main.remote)
repo=$(git config --get "remote.$remote.url" | sed -e 's#^.*[:/]\([^/]*/[^/]*\)$#\1#' -e 's#\.git$##')
[ -n "$repo" ] || { echo "pr-attach: could not read the repository from the git remote" >&2; exit 1; }
branch=pr-assets

git fetch -q "$remote" "+refs/heads/$branch:refs/remotes/$remote/$branch" 2>/dev/null || true
parent=$(git rev-parse -q --verify "refs/remotes/$remote/$branch" || true)

index=$(mktemp -u "${TMPDIR:-/tmp}/pr-attach.XXXXXX")
trap 'rm -f "$index"' EXIT
if [ -n "$parent" ]; then
	GIT_INDEX_FILE=$index git read-tree "$parent"
else
	GIT_INDEX_FILE=$index git read-tree --empty
fi

for file do
	blob=$(git hash-object -w "$file")
	GIT_INDEX_FILE=$index git update-index --add --cacheinfo "100644,$blob,pr-$number/$(basename "$file")"
done

tree=$(GIT_INDEX_FILE=$index git write-tree)
commit=$(git commit-tree -S "$tree" ${parent:+-p "$parent"} -m "Screenshots for pull request #$number")
git push -q "$remote" "$commit:refs/heads/$branch"

# Markdown, ready to paste into the pull request body. The alt text is the file
# name without its extension, which is why the plans ask for names that say what
# the shot shows. raw.githubusercontent.com caches a 404 for a file asked for
# before it existed; the blob URL with ?raw=true does not.
for file do
	name=$(basename "$file")
	printf '![%s](https://github.com/%s/blob/%s/pr-%s/%s?raw=true)\n' \
		"${name%.*}" "$repo" "$branch" "$number" "$name"
done
