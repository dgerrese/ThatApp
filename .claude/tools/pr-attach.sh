#!/bin/sh
# Attach an image to a pull request or issue, and print the markdown to paste.
#
#   usage: pr-attach.sh <number> <file> [<file>...]
#
# Forgejo serves attachments from its own store, so a screenshot never enters the
# repository — which matters here, where the app's own budget is measured in
# kilobytes. `tea` cannot do this: `tea api` sends JSON only, and an attachment
# needs a multipart POST, so this reaches for curl.
#
# The token is read from tea's existing config and passed straight to curl. It is
# never echoed, logged, or written anywhere.
set -eu

usage='usage: pr-attach.sh <number> <file> [<file>...]'
number=${1:?$usage}
shift
[ $# -gt 0 ] || { echo "$usage" >&2; exit 2; }

case $number in
*[!0-9]*) echo "pr-attach: '$number' is not a pull request or issue number" >&2; exit 2 ;;
esac

# The remote decides the repository, so this works unchanged in a fork.
remote=$(git config --get remote.codeberg.url 2>/dev/null || git config --get remote.origin.url)
repo=$(printf '%s\n' "$remote" | sed -e 's#^.*[:/]\([^/]*/[^/]*\)$#\1#' -e 's#\.git$##')
[ -n "$repo" ] || { echo "pr-attach: could not read the repository from the git remote" >&2; exit 1; }

config="${HOME}/.config/tea/config.yml"
[ -f "$config" ] || { echo "pr-attach: no tea config at $config — run 'tea login add' first" >&2; exit 1; }
token=$(sed -n 's/^[[:space:]]*token:[[:space:]]*//p' "$config" | head -1)
[ -n "$token" ] || { echo "pr-attach: no token in $config" >&2; exit 1; }

for file do
	[ -f "$file" ] || { echo "pr-attach: no such file: $file" >&2; exit 1; }

	url=$(curl -sS --fail-with-body -X POST \
		-H "Authorization: token ${token}" \
		-F "attachment=@${file}" \
		"https://codeberg.org/api/v1/repos/${repo}/issues/${number}/assets" \
		| python3 -c 'import sys,json;print(json.load(sys.stdin)["browser_download_url"])')

	# Markdown, ready to paste into the pull request body. The alt text is the
	# file name without its extension, which is why the plans ask for names that
	# say what the shot shows.
	alt=$(basename "$file" | sed 's/\.[^.]*$//')
	printf '![%s](%s)\n' "$alt" "$url"
done
