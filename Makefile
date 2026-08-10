.DEFAULT_GOAL := help
COMPOSE := docker compose
APP     := $(COMPOSE) run --rm --no-deps app
WEB     := $(COMPOSE) run --rm --no-deps web
LINT    := $(COMPOSE) run --rm --no-deps lint

.PHONY: help up down install-web build-web test-go test test-e2e fmt lint-go lint-web lint tsc verify

help: ## Show this help
	@grep -E '^[a-z-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  %-12s %s\n", $$1, $$2}'

up: ## Start the dev stack
	$(COMPOSE) up

down: ## Stop the dev stack and drop its volumes
	$(COMPOSE) --profile e2e down -v

install-web: ## Install frontend dependencies into the web-node-modules volume
	$(WEB) npm ci

build-web: install-web ## Build the frontend into web/dist
	$(WEB) npm run build

test-go: ## Run the Go test suite
	$(APP) go test ./...

test: test-go ## Run all tests

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

verify: lint tsc test ## The full merge gate
	@echo "verify: OK"
