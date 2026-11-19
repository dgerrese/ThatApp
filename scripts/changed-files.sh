#!/bin/sh
# Reads changed file names on stdin and prints the two flags the CI and release
# workflows run on:
#   code  anything but docs/**, Markdown and .claude/skills/**
#   e2e   any file the Playwright rig depends on, Markdown excluded (CB#16, CB#167)
set -eu

awk '
	!/^docs\/|\.md$|^\.claude\/skills\// { code = 1 }
	!/\.md$/ && /^(web\/|\.claude\/e2e\/|docker-compose\.yml$|Dockerfile$|Makefile$|\.env\.example$|\.github\/workflows\/ci\.yml$|\.github\/compose-ci\.yml$)/ { e2e = 1 }
	END {
		print "code=" (code ? "true" : "false")
		print "e2e=" (e2e ? "true" : "false")
	}'
