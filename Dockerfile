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

FROM scratch AS prod
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=build /out/work-dashboard /work-dashboard
EXPOSE 8080
ENTRYPOINT ["/work-dashboard"]
