.PHONY: deploy start stop restart status logs migrate build setup

ECOSYSTEM := ecosystem.config.js
PM2       := pm2
ENV       ?= production

# Full deploy: pull → install → build → migrate → reload
# Usage: make deploy ENV=qa (defaults to production)
deploy:
	git pull
	pnpm install --frozen-lockfile
	$(MAKE) build
	$(MAKE) migrate
	$(PM2) reload $(ECOSYSTEM) --env $(ENV) --update-env
	$(PM2) save

# Build all apps. The web app is a static Angular bundle (apps/web/dist/web/browser/)
# served by nginx; its configuration is compiled in from apps/web/src/environments/,
# not read from environment variables, so there is nothing to export here.
build:
	pnpm build

# Run Prisma migrations
migrate:
	pnpm --filter @repo/database db:migrate:deploy

# First-time startup
start:
	$(PM2) start $(ECOSYSTEM) --env $(ENV)
	$(PM2) save

# Stop all services
stop:
	$(PM2) stop $(ECOSYSTEM)

# Restart all services
restart:
	$(PM2) restart $(ECOSYSTEM) --env $(ENV) --update-env

# Status
status:
	$(PM2) status

# Logs (all or specific: make logs APP=api)
logs:
	$(PM2) logs $(APP)

# First-time setup: create the log directory the ecosystem writes to, and start
setup:
	mkdir -p logs
	$(MAKE) start
	$(PM2) startup
