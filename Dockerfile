# syntax=docker/dockerfile:1

FROM node:26-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . .
COPY --from=web /src/web/dist ./web/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/work-dashboard ./cmd/server

FROM golang:1.26-alpine AS dev
WORKDIR /src
ENV CGO_ENABLED=0
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
# clear. Distinct from the `web` stage above, which builds dist for the prod image.
FROM node:26-alpine AS webdev
WORKDIR /src/web
ENV npm_config_cache=/cache/npm \
    HOME=/cache/home
RUN mkdir -p /cache/npm /cache/home /src/web/node_modules \
    && chmod -R 0777 /cache /src

FROM scratch AS prod
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=build /out/work-dashboard /work-dashboard
EXPOSE 8080
ENTRYPOINT ["/work-dashboard"]
