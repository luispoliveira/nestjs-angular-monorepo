# syntax=docker/dockerfile:1.9

# ─── Build stage ────────────────────────────────────────────────────────────────
FROM node:24-alpine AS build

ENV CI=true
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /usr/src/app

# Corepack picks up the pnpm version from the root package.json "packageManager" field.
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./

COPY packages/eslint-config/package.json     ./packages/eslint-config/
COPY packages/shared-types/package.json      ./packages/shared-types/
COPY packages/typescript-config/package.json ./packages/typescript-config/
COPY apps/web/package.json                   ./apps/web/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY packages/eslint-config     ./packages/eslint-config
COPY packages/shared-types      ./packages/shared-types
COPY packages/typescript-config ./packages/typescript-config
COPY apps/web                   ./apps/web

RUN pnpm exec turbo build --filter=web

# ─── Production stage — static build served by nginx (design.md → D1/D9) ────────
FROM nginx:1-alpine AS production

COPY --from=build /usr/src/app/apps/web/dist/web/browser /usr/share/nginx/html
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template

# Reachable address for the frontend's own backend API (design.md → D1's
# same-origin /api/ proxy) — override at `docker run -e API_UPSTREAM=...` for
# a deployment where apps/api is not at this docker-compose service name.
ENV API_UPSTREAM=http://api:3100

EXPOSE 8080
