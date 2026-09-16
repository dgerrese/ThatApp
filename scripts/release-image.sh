#!/bin/sh
# Assembles the release image for linux/amd64 and linux/arm64 and pushes it as
# one index to REPO:VERSION and REPO:latest.
#
# There is no `docker build`: Codeberg's runners have no Docker daemon, and an
# image that is one static binary on an empty base needs no build stage, only a
# layer. crane assembles and pushes it without a daemon.
#
# usage: release-image.sh VERSION REPO    (web/dist must already be built)
#
# A localhost REPO gets a throwaway registry started here unless one is already
# listening, which is how pull requests and `make image` run this exact path
# without touching Codeberg.
set -eu

usage="usage: release-image.sh YYYY.WW.N REPO"
version=${1:?$usage}
repo=${2:?$usage}

# The case rejects anything but digits and dots first, so a multi-line value
# cannot slip one good line past grep.
case $version in
*[!0-9.]*) valid= ;;
*) valid=$(printf '%s\n' "$version" | grep -Ex '[0-9]{4}\.(0[1-9]|[1-4][0-9]|5[0-3])\.[1-9][0-9]*' || true) ;;
esac
if [ -z "$valid" ]; then
	echo "release-image: '$version' is not YYYY.WW.N" >&2
	exit 2
fi

fail() { echo "release-image: $*" >&2; exit 1; }

# go run backgrounds a wrapper subshell, not the crane binary itself: kill $!
# would leave the actual "registry serve" process orphaned. Installing once and
# calling the binary directly means $! is that process.
install_crane() {
	bin=$(mktemp -d)
	GOBIN="$bin" go install github.com/google/go-containerregistry/cmd/crane@v0.22.1
	crane() { "$bin/crane" "$@"; }
}

case $repo in
localhost:*)
	install_crane
	if ! crane catalog "${repo%%/*}" >/dev/null 2>&1; then
		"$bin/crane" registry serve --address "${repo%%/*}" >/dev/null 2>&1 &
		registry=$!
		trap 'kill "$registry" 2>/dev/null' EXIT
		tries=0
		until crane catalog "${repo%%/*}" >/dev/null 2>&1; do
			tries=$((tries + 1))
			[ "$tries" -lt 60 ] || fail "local registry did not start"
			sleep 1
		done
	fi
	;;
*)
	[ -n "${REGISTRY_USER:-}" ] && [ -n "${REGISTRY_TOKEN:-}" ] || {
		echo "release-image: REGISTRY_USER and REGISTRY_TOKEN are required for $repo" >&2
		exit 2
	}
	install_crane
	printf '%s' "$REGISTRY_TOKEN" | crane auth login "${repo%%/*}" -u "$REGISTRY_USER" --password-stdin
	;;
esac

work=$(mktemp -d)
expected='etc
etc/ssl
etc/ssl/certs
etc/ssl/certs/ca-certificates.crt
thatapp'

for arch in amd64 arm64; do
	root=$work/$arch
	mkdir -p "$root/etc/ssl/certs"
	CGO_ENABLED=0 GOOS=linux GOARCH=$arch go build -trimpath \
		-ldflags="-s -w -X main.version=$version" -o "$root/thatapp" ./cmd/server
	cp /etc/ssl/certs/ca-certificates.crt "$root/etc/ssl/certs/"

	go version -m "$root/thatapp" | grep -q "GOARCH=$arch" || fail "$arch binary has the wrong GOARCH"
	if [ "$arch" = "$(go env GOHOSTARCH)" ]; then
		env -i "$root/thatapp" 2>&1 | grep -q "thatapp $version\$" || fail "binary does not report $version"
	fi

	tar -C "$root" -cf "$work/$arch.tar" thatapp etc
	[ "$(tar -tf "$work/$arch.tar" | sed 's:/$::' | LC_ALL=C sort)" = "$expected" ] || fail "$arch layer holds more than the binary and CA bundle"

	crane append --oci-empty-base -f "$work/$arch.tar" -t "$repo:$version-$arch"
	crane mutate "$repo:$version-$arch" -t "$repo:$version-$arch" \
		--set-platform "linux/$arch" --entrypoint /thatapp --exposed-ports 8080
	crane config "$repo:$version-$arch" | grep -q "\"architecture\":\"$arch\"" || fail "$arch config has the wrong architecture"
	[ "$(crane export "$repo:$version-$arch" - | tar -tf - | sed 's:/$::' | LC_ALL=C sort)" = "$expected" ] || fail "$arch image holds more than the binary and CA bundle"
done

crane index append -m "$repo:$version-amd64" -m "$repo:$version-arm64" -t "$repo:$version"
crane tag "$repo:$version" latest

for arch in amd64 arm64; do
	crane manifest "$repo:latest" | grep -q "\"architecture\":\"$arch\"" || fail "index is missing $arch"
done
echo "release-image: pushed $repo:$version and $repo:latest"
