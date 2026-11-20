# syntax=docker/dockerfile:1

FROM golang:1.26-alpine AS dev
WORKDIR /src
ENV CGO_ENABLED=0
# Dev-only reloader, outside go.mod. Throwaway caches, deleted in the same layer,
# so the image stays small and nothing lands in /cache even if this line moves.
RUN GOBIN=/usr/local/bin GOCACHE=/tmp/gc GOMODCACHE=/tmp/gm GOPATH=/tmp/gp \
    go install github.com/air-verse/air@v1.67.4 \
    && rm -rf /tmp/gc /tmp/gm /tmp/gp
# The dev services run as the host user (docker-compose.yml `user:`), so
# HOME=/root is unwritable and Go's caches cannot use their defaults. Pre-creating
# these world-writable is what makes them work for an arbitrary UID: Docker seeds
# a *fresh* named volume from the image directory, permissions included, and a
# volume that already exists keeps the ownership it was created with.
ENV GOCACHE=/cache/go-build \
    GOMODCACHE=/cache/go-mod \
    GOPATH=/cache/gopath \
    HOME=/cache/home
RUN mkdir -p /cache/go-build /cache/go-mod /cache/gopath /cache/home \
    && chmod -R 0777 /cache

# The frontend watcher, as the host user for the same reason: it writes web/dist
# and node_modules, and root-owned build output in the working tree needs sudo to
# clear.
FROM node:26-alpine AS webdev
WORKDIR /src/web
ENV npm_config_cache=/cache/npm \
    HOME=/cache/home
RUN mkdir -p /cache/npm /cache/home /src/web/node_modules \
    && chmod -R 0777 /cache /src
