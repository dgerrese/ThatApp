# syntax=docker/dockerfile:1

# Debian, not Alpine: Playwright does not officially support Alpine and its
# browser binaries will not run there.
FROM node:26-bookworm-slim

WORKDIR /e2e

COPY package.json package-lock.json ./

# Only the two browsers this project supports. WebKit is an explicit non-goal,
# which is also why this does not use the official Playwright image — that one
# ships all three.
RUN npm ci --no-audit --no-fund \
 && npx playwright install --with-deps firefox chromium
