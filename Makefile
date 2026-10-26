.PHONY: deploy start stop restart status logs migrate build setup

ECOSYSTEM := ecosystem.config.js
PM2       := pm2
ENV       ?= production

# Full deploy: pull → install → build → migrate → reload
# Usage: make deploy ENV=qa (defaults to production)
deploy:
	git pull origin main
	pnpm install --frozen-lockfile
	$(MAKE) build
	$(MAKE) migrate
	$(PM2) reload $(ECOSYSTEM) --env $(ENV) --update-env
	$(PM2) save

# Build all apps + copy Next.js static files
# NEXT_PUBLIC_* vars must be present at build time (Next.js bakes them into the
# client bundle) — next build only reads .env* from apps/web/, never the repo
# root, so the shared env file must be exported into this shell first.
build:
	bash -c 'set -a; [ -f .env.$(ENV) ] && source .env.$(ENV) || source .env; set +a; pnpm build'
	cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static
	cp -r apps/web/public       apps/web/.next/standalone/apps/web/public

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

# Logs (all or specific: make logs APP=tx-api)
logs:
	$(PM2) logs $(APP)

# First-time setup: create log dir and start
setup:
	sudo mkdir -p /var/log/pm2
	sudo chown $$USER:$$USER /var/log/pm2
	$(MAKE) start
	$(PM2) startup
