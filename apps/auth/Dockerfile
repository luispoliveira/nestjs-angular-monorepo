# syntax=docker/dockerfile:1.9

# ─── Build stage ────────────────────────────────────────────────────────────────
FROM node:26-alpine AS development

ENV CI=true
ENV NODE_ENV=development
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /usr/src/app

# Node 25+ no longer bundles corepack. It picks up the pnpm version from the root package.json "packageManager" field.
RUN npm install -g corepack@0.36.0 && corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY patches ./patches

COPY packages/database/package.json          ./packages/database/
COPY packages/eslint-config/package.json     ./packages/eslint-config/
COPY packages/mail/package.json              ./packages/mail/
COPY packages/shared/package.json            ./packages/shared/
COPY packages/shared-types/package.json      ./packages/shared-types/
COPY packages/testing-utils/package.json     ./packages/testing-utils/
COPY packages/typescript-config/package.json ./packages/typescript-config/
COPY apps/auth/package.json                  ./apps/auth/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY packages ./packages
COPY apps/auth ./apps/auth

RUN pnpm exec turbo db:generate
RUN pnpm exec turbo build --filter=auth

# Produce a self-contained production node_modules under /prod/auth.
RUN pnpm --filter=auth deploy --prod --legacy /prod/auth

# ─── Production stage ───────────────────────────────────────────────────────────
FROM node:26-alpine AS production

ENV NODE_ENV=production

WORKDIR /usr/src/app

# Least-privilege: run as non-root.
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nestjs

COPY --from=development --chown=nestjs:nodejs /prod/auth/node_modules ./node_modules
COPY --from=development --chown=nestjs:nodejs /usr/src/app/apps/auth/dist ./dist

USER nestjs

CMD ["node", "dist/main.js"]
