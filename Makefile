.DEFAULT_GOAL := help

# The dev containers run as this user so the SQLite database under ./data, and
# anything written into the bind-mounted tree, belong to whoever runs `make`
# rather than to root. Exported, so every recipe's compose call sees them.
export THAT_UID := $(shell id -u)
export THAT_GID := $(shell id -g)

COMPOSE := docker compose
# --build, for the same reason test-e2e uses it: `run` reuses a cached image, so
# a Dockerfile change silently does nothing until something forces a rebuild.
# That failure surfaces as an unrelated-looking permission error, because the
# stale image lacks the cache paths the `user:` mapping depends on. ~0.5s when
# the layers are cached; a confusing afternoon when they are not.
APP     := $(COMPOSE) run --build --rm --no-deps app
WEB     := $(COMPOSE) run --build --rm --no-deps web
# No `build:` key on this service — it runs a pulled image, so there is nothing
# to rebuild.
LINT    := $(COMPOSE) run --rm --no-deps lint

.PHONY: help up down install-web build-web test-go test test-web test-e2e fmt lint-go lint-web lint tsc verify

help: ## Show this help
	@grep -E '^[a-z-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  %-12s %s\n", $$1, $$2}'

up: ## Start the dev stack
	$(COMPOSE) up

# -v drops the build and dependency caches, which is the point of it. It no
# longer takes the database: that lives in ./data on the host (#73).
down: ## Stop the dev stack and drop its caches (the database survives)
	$(COMPOSE) --profile e2e down -v

install-web: ## Install frontend dependencies into the web-node-modules volume
	$(WEB) npm ci

build-web: install-web ## Build the frontend into web/dist
	$(WEB) npm run build

test-go: ## Run the Go test suite
	$(APP) go test ./...

test: test-go ## Run all tests

# Deliberately NOT part of `verify`. #51 owns the frontend test runner — where
# its gate belongs and what its conventions are — and wiring one in here would
# be deciding that by accident. Node runs the .ts directly, so this adds no
# dependency. Until #51 lands, this target is run by hand.
test-web: install-web ## Run the frontend unit tests (see #51)
	$(WEB) node --test 'src/**/*.test.ts'

# --build, because `run` reuses a cached image: without it a bump to
# @playwright/test installs new packages into the node_modules volume while the
# image still carries the browsers the old version pinned.
test-e2e: ## Run the Playwright suite (starts the app stack itself)
	$(COMPOSE) --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test'

fmt: install-web ## Format Go and frontend sources
	$(LINT) golangci-lint fmt
	$(WEB) npm run fmt

lint-go: ## Lint the Go sources
	$(LINT) golangci-lint run

lint-web: install-web ## Lint the frontend sources
	$(WEB) npm run lint

lint: lint-go lint-web ## Lint everything

tsc: install-web ## Type-check the frontend
	$(WEB) npx tsc --noEmit
	$(WEB) npx tsc --noEmit -p tsconfig.worker.json

verify: lint tsc test ## The full merge gate
	@echo "verify: OK"
