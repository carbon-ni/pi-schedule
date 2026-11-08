.PHONY: help setup hooks-check check lint typecheck test coverage format format-write security release-check try
help: ## List commands
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "%-16s %s\n", $$1, $$2}' $(MAKEFILE_LIST)
setup: ## Install locked dependencies and versioned hooks
	@npm ci
	@node scripts/hooks.mjs install
hooks-check: ## Verify hook installation and executability
	@node scripts/hooks.mjs check
check: ## Normal gate: lint, typecheck, deterministic tests (boolean result)
	@sh scripts/gate.sh
lint: ## Static lint checks
	@npm run lint
typecheck: ## TypeScript check
	@npm run typecheck
test: ## Deterministic tests
	@npm test
coverage: ## Enforce explicit coverage budgets
	@npm run test:coverage
format: ## Check formatting
	@npm run format
format-write: ## Apply formatting
	@npm run format:write
security: ## Audit dependencies
	@npm audit --audit-level=high
release-check: ## Explicit release checks, beyond the normal gate
	@$(MAKE) --no-print-directory check
	@$(MAKE) --no-print-directory format coverage security
	@npm pack --dry-run
try: ## Load only this extension in an isolated Pi configuration
	@pi --no-extensions --no-mcp -e ./src/index.ts
