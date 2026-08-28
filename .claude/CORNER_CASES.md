# Corner Cases — Living Memory

Accumulated corner cases, gotchas, and non-obvious behaviours discovered during development.
**Always read this file at the start of any task.** Append new findings at the bottom of the relevant section.

---

## Zod v4

<!-- Add Zod-specific surprises here -->

---

## NestJS / SharedModule

<!-- Add NestJS gotchas here -->

---

## Microservices (Redis transport)

<!-- Add microservice edge cases here -->

---

## Authentication (better-auth)

### `BETTER_AUTH_URL` drives the `Secure` cookie prefix, not the proxy headers

**Symptom:** the session cookie is issued without the `Secure` attribute (and without the `__Secure-` name prefix) even though the app sits behind an HTTPS-terminating reverse proxy that correctly forwards `X-Forwarded-Proto: https`.

**Fix:** better-auth derives the `Secure` prefix from `advanced.useSecureCookies`, else from whether `baseURL` (i.e. `BETTER_AUTH_URL`) itself starts with `https://`, else from `isProduction` — **never** from `X-Forwarded-Proto` or any other proxy header. Set `BETTER_AUTH_URL` to the actual public `https://` origin (e.g. `https://auth.example.com/api/auth`); a plain-`http://` or container-internal value here silently drops the `Secure` prefix no matter how the proxy in front of it is configured. Verified against a real `Set-Cookie` header from a running `apps/auth` instance with `BETTER_AUTH_URL=https://…`: `__Secure-better-auth.session_token=…; Secure; SameSite=Lax; Domain=…`.

### `*` means opposite things to `enableCors` and to `trustedOrigins`

**Symptom:** a `CORS_ORIGIN`/origin-allowlist value of `*` looks like it should behave the same way in every place it's consumed, but it doesn't — in one place it silently blocks everything, in the other it silently trusts everything.

**Fix:** `BootstrapUtil`'s `enableCors` (see `packages/shared/src/utils/bootstrap.util.ts`) always calls Nest's `app.enableCors({ origin: [...] })` with an **array** (splitting the comma-joined `CORS_ORIGIN` string) — the `cors` package only pattern-matches when given a function; given an array it does a literal string comparison, so a literal `"*"` entry never equals any real browser `Origin` header and is effectively a no-op that grants nothing. better-auth's `trustedOrigins`, by contrast, treats a bare `*` as a genuine wildcard pattern (`matchesOriginPattern`) that trusts **every** origin. `apps/auth/src/app.module.ts` filters `*` out of the list before it reaches `trustedOrigins` for exactly this reason — do not "simplify" that filter on the assumption the two behave the same.

---

## Queues (BullMQ)

### Every app using `Transport.REDIS` must declare `ioredis` itself

`@nestjs/microservices` never imports `ioredis` statically — it resolves the driver lazily at
runtime (`client/client-redis.js`: `loadPackage('ioredis', ClientRedis.name, () => require('ioredis'))`),
and lists it as a wildcard peer. So a missing `ioredis` passes `pnpm build`, `check-types`, lint and
the whole test suite, then fails at boot with `Cannot find module 'ioredis'`.

`apps/worker` and `apps/notifications` ran for a long time without declaring it: `worker` inherited it
from `bullmq@5`, which pinned `ioredis: 5.10.1` as a hard dependency, and `notifications` got it purely
from pnpm hoisting. **`bullmq@6` moves `ioredis` to a peer dependency** (alongside `redis`, `pg` and
`bullmq-otel`, since v6 supports several Redis drivers), so that transitive copy disappears on upgrade.

Rule: if an app calls `app.connectMicroservice({ transport: Transport.REDIS })`, it declares `ioredis`
in its own `dependencies` — same range across all apps so pnpm resolves a single copy. Verify with
`node -e "require.resolve('ioredis')"` run **from the app's own directory**, not from the repo root;
hoisting at the root hides exactly the failure a pruned deploy reproduces.

---

## Database (Prisma / PrismaPg)

<!-- Add Prisma / DB corner cases here -->

---

## Angular

<!-- Add Angular edge cases here -->

---

## Deployment / Nginx

### SPA history fallback can mask a genuinely missing static asset as a 200

**Symptom:** a client-side route (e.g. `/dashboard`) correctly survives a direct navigation or hard reload, but a request for a static asset that no longer exists (e.g. a stale hashed JS chunk referenced by a cached `index.html` after a new deploy) returns `200` with the app shell's HTML instead of a `404` — the failure is silently swallowed instead of surfacing.

**Fix:** a single catch-all `location / { try_files $uri $uri/ /index.html; }` cannot tell "a client-side route with no matching file" apart from "a missing static asset" — both fall through to `index.html`. Split it into two location blocks: one matching known static-asset extensions (`\.(?:js|css|map|ico|png|jpg|jpeg|gif|svg|webp|woff2?|ttf|eot|json|txt)$`) that does `try_files $uri =404;` (never falls back), and the SPA fallback (`try_files $uri /index.html;`) for everything else. See `apps/web/nginx.conf.template` and `docs/deploy/nginx/frontend.conf`. Verified against a real built image: a nested route returns `200` with the app document, a genuinely missing asset returns `404`, and a real hashed chunk still serves `200`.

---

## Build / Turborepo / pnpm

<!-- Add build-system gotchas here -->

---

## Testing

### `apps/web`'s Angular CLI refuses to run under the shell's default active Node version

**Symptom:** `pnpm --filter web test` (or `build`/`lint`) fails immediately with `The Angular CLI requires a minimum Node.js version of v22.22.3 or v24.15.0 or v26.0.0` even though a correct Node version is installed on the machine — the shell's currently-active `node -v` just isn't one of them (e.g. `v24.14.1`, one patch below the `v24.15.0` floor).

**Fix:** `nvm use` (or check `nvm ls`) against the version pinned in `.nvmrc` (`v24.19.0`) before running any `apps/web` script — it's usually already installed, just not the shell's active version. Also note: `ng test` (Angular 22's `@angular/build:unit-test` Vitest-based builder) does not accept a `-- <spec-file>` filter the way Jest-backed app scripts do (`Option '--' has been specified multiple times` / schema validation error) — run `pnpm --filter web test` for the whole suite; there is no supported single-file shortcut through the package script.
