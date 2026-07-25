.PHONY: help dev-up dev-down migrate migrate-auto lint test test-backend test-frontend install retention-dry

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

dev-up: ## Start all services (db, redis, backend)
	docker compose up -d db redis backend

dev-down: ## Stop all services
	docker compose down

migrate: ## Apply pending Alembic migrations
	docker compose exec backend alembic upgrade head

migrate-auto: ## Generate new migration from model changes (pass MSG="...")
	docker compose exec backend alembic revision --autogenerate -m "$(MSG)"

install: ## Install backend dev deps with uv
	cd backend && uv pip install -e ".[dev]"

install-frontend: ## Install frontend npm deps
	cd frontend && npm install

lint: ## Run ruff + mypy on backend
	cd backend && ruff check app && mypy app

lint-frontend: ## Run eslint + tsc on frontend
	cd frontend && npm run lint && npm run check

test-backend: ## Run pytest
	cd backend && pytest

test-frontend: ## Run vitest
	cd frontend && npm run test:unit

test: test-backend test-frontend ## Run all tests

retention-dry: ## Dry-run the retention CLI (no DB writes)
	docker compose exec backend python -m app.cli run-retention --dry-run
