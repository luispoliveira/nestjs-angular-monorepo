## Why

The monorepo is intended to be the reusable base for future NestJS + Angular projects, but `apps/web` is Next.js and the frontend stack (React, shadcn/ui, tRPC) does not transfer. Replacing it with Angular now — while the dashboard is still small (~1500 LOC of real app code) — is far cheaper than after the template accumulates features. Angular is also the org's established frontend stack: every existing 3decide frontend is Angular + Angular Material + Tailwind, so the template currently diverges from every project it is meant to seed.

Two findings shape the scope:

- **tRPC is vestigial.** The whole monorepo contains exactly one tRPC router (`apps/api/src/app.router.ts`) with one `hello` query. Removing tRPC costs no business logic.
- **No REST greenfield is required for parity.** Every user-facing operation the dashboard performs (`listUsers`, `createUser`, `setRole`, `banUser`, `unbanUser`, `removeUser`, `signIn.email`, session) already goes through the better-auth admin plugin, whose client (`better-auth/client/plugins`) is framework-agnostic and works unchanged in Angular.

## What Changes

- **BREAKING** `apps/web` is replaced: Next.js 16 + React 19 + shadcn/ui → Angular 22 + Tailwind CSS v4 + **Angular Material 22**. The app keeps its name, port and route paths (`/sign-in`, `/dashboard`, `/users`).
- **BREAKING** tRPC is removed monorepo-wide: `packages/trpc` is deleted, `nestjs-trpc-v2` is dropped from `apps/api` and `apps/auth`, and `packages/shared/src/trpc/` (module, context, base router, logging + auth middlewares) is removed along with `apps/auth/src/auth-trpc.middleware.ts` and `apps/api/src/app.router.ts`.
- **BREAKING** The frontend no longer runs a server. Next.js route handlers (`app/api/auth/[...path]`, `app/api/trpc/[...path]`), the `proxy.ts` middleware and `getServerSession()` are removed. Request routing moves to **nginx**, in the split-subdomain shape already running in production at 3decide: the frontend's own API is proxied same-origin under `/api/`, while `apps/auth` lives on its own sibling subdomain and is reached cross-origin. The session cookie is shared across siblings via `COOKIE_DOMAIN`, so it stays `SameSite=Lax` and gives SSO across apps on the same parent domain.
- **BREAKING** `CORS_ORIGIN` must be split into a list before reaching `enableCors`. It is currently passed to `enableCors({ origin })` as a single comma-joined string; `cors@2.8.6` echoes a string origin verbatim into `Access-Control-Allow-Origin`, producing an invalid multi-origin header that browsers reject. This is invisible today because the Next.js proxy makes every request same-origin, and becomes load-bearing the moment `apps/auth` is reached cross-origin.
- `@repo/shared-types` becomes the single api↔web contract and is fixed to emit ESM (it currently emits CommonJS while its `exports` map advertises `import`, and its `main` field points at a non-existent path). Response schemas are added alongside the existing input schemas so the Angular app can validate at the network boundary.
- A Zod → Angular `ValidatorFn` adapter replaces `react-hook-form` + `@hookform/resolvers/zod`, so the same schemas drive both backend DTOs (`createZodDto`) and frontend form validation.
- Data fetching moves to `@tanstack/angular-query-experimental` (same TanStack Query v5 core already used by `@tanstack/react-query`), theming to Angular Material's theming API plus a signal-based service backed by `localStorage` (replacing `next-themes`), and toasts to `MatSnackBar` (replacing `sonner`).
- `engines.node` is tightened from `>=22` to `>=22.22.3` to satisfy the Angular CLI.

## Capabilities

### New Capabilities

- `angular-web-app`: The Angular dashboard shell — routing and lazy-loaded feature routes, auth route guards, session state as a signal bridged from the better-auth vanilla client, sidebar/top-bar layout, light/dark theming, and the Angular Material component layer. Covers the behaviour previously provided by `apps/web` (App Router, `proxy.ts`, `next-themes`, `components/ui/*`).
- `nginx-subdomain-topology`: How browser requests reach the services. Defines the nginx server blocks for the frontend and `apps/auth` on sibling subdomains; the frontend block's same-origin `/api/` proxy to its own backend; the SPA history fallback that makes deep links survive a refresh; the CORS allowlist required for the cross-origin auth calls; and the session cookie's shared-domain scope, including which better-auth settings (`BETTER_AUTH_URL`, `trustedOrigins`, `COOKIE_DOMAIN`) must agree with it. Covers local development, which deliberately exercises the same cross-origin auth path rather than proxying it away.
- `zod-shared-contract`: `@repo/shared-types` as the enforced contract between backend and frontend — ESM-compatible build consumable by both the NestJS CJS apps and the Angular esbuild pipeline, request and response schemas for every endpoint the frontend calls, boundary validation of HTTP responses in the Angular app, and the Zod → Angular `ValidatorFn` adapter.

### Modified Capabilities

- `env-validation`: The requirement "apps/web validates env vars at module load time" is Next.js-specific — it mandates `apps/web/env.ts` with a top-level `z.parse()` failing `next build`, and names `apps/web/lib/auth/server.ts` as a consumer. Angular has no server runtime and no `process.env` in the browser, so the requirement is restated for a build-time-substituted, Zod-validated Angular configuration object. The NestJS `ConfigService` requirements in that spec are unaffected.

## Impact

**Replaced**
- `apps/web` — entire app (Next.js 16 → Angular 22). ~1400 LOC of `components/ui/*` is not ported at all — Material ships its own components; ~1500 LOC of pages, layout and `components/users/*` is genuinely ported; ~500 LOC of tRPC and Next-server plumbing is deleted outright.

**Deleted**
- `packages/trpc` (workspace package and the `@repo/trpc` dependency in `apps/api`, `apps/auth`, `apps/web`)
- `packages/shared/src/trpc/` — `trpc.module.ts`, `app.context.ts`, `app-context.interface.ts`, `router/base.router.ts`, `middlewares/logging-trpc.middleware.ts`, `middlewares/microservice-auth-trpc.middleware.ts`
- `apps/api/src/app.router.ts`, `apps/api/src/app.context.ts`
- `apps/auth/src/auth-trpc.middleware.ts`

**Modified**
- `packages/shared-types` — ESM build output, corrected `main`/`exports`, new response schemas, Angular validator adapter
- `packages/shared` — `index.ts` barrel loses the tRPC exports; `BootstrapUtil` splits `CORS_ORIGIN` into an array
- `apps/api`, `apps/auth` — `nestjs-trpc-v2` and `@trpc/server` removed; `apps/api` keeps its existing REST bootstrap (`globalPrefix: 'api'`, Swagger, `trustProxy: true`)
- `apps/auth` — `BETTER_AUTH_URL`, `trustedOrigins` and `CORS_ORIGIN` aligned with the subdomain topology; `trustProxy` added to its bootstrap for correct client-IP handling behind nginx
- `packages/eslint-config` — `next-js` config replaced by an Angular config; `@next/eslint-plugin-next`, `eslint-plugin-react`, `eslint-plugin-react-hooks` dropped
- `packages/typescript-config` — `nextjs.json` replaced by an Angular base
- `turbo.json` — build `outputs` change from `.next/**` to `dist/**`; the `NEXT_PUBLIC_BASE_PATH` env entry is replaced
- Root `package.json` — `engines.node` → `>=22.22.3`
- `apps/web/Dockerfile` — Next standalone output → static bundle served by nginx
- `openspec/config.yaml` and `CLAUDE.md` — stack description, conventions and source-of-truth references

**Dependency changes**

Verified against the registry; no backend version has to move:

| Package | Version | Constraint | Status |
|---|---|---|---|
| `@angular/core` / `cli` / `build` | 22.1.x | `typescript >=6.0 <6.1` | repo already pins `typescript@6.0.3` |
| `@angular/cli` | 22.x | `node ^22.22.3 \|\| ^24.15.0 \|\| >=26` | requires the `engines` bump |
| `@angular/material` / `@angular/cdk` | 22.1.x | tracks Angular majors 1:1 | new; the org's other frontends already use Material (on 15–18) |
| `tailwindcss` | 4.3.x | Angular has an official Tailwind guide (`ng add tailwindcss`) | already an `apps/web` dependency |
| `zod` | 4.4.3 | workspace override `~4.4.3` | exact match |
| `@tanstack/angular-query-experimental` | 5.102.5 | TanStack Query v5 core | same core as `@tanstack/react-query@5.101` |
| `better-auth` | 1.6.23 | exports `./client`, `./client/plugins` (nanostores) | no `./angular` export; vanilla client is framework-agnostic and already defaults to `credentials: 'include'` |

**Untouched**
- `apps/auth` better-auth configuration beyond the origin/cookie settings above (plugins, hooks, email flows), `apps/notifications`, `apps/worker`, `apps/cron`, `packages/database`, `packages/mail`, `packages/testing-utils`, all Prisma schemas and migrations, all Redis/BullMQ patterns and constants.

## Non-goals

- **Building a REST business API.** `apps/api` keeps its single `GET /` endpoint. The REST infrastructure it already has (`nestjs-zod@5.4`, `@nestjs/swagger@11`, global `ZodValidationPipe`, `@RateLimit`, `PaginatedUtil`) stays available for future domains, but no new endpoints are added here — the dashboard reaches parity through the better-auth admin plugin alone.
- **Moving user management off better-auth.** `listUsers`, `createUser`, `setRole`, `banUser`, `unbanUser` and `removeUser` continue to be served by the better-auth admin plugin, not reimplemented as `apps/api` controllers.
- **OpenAPI client generation.** The contract is hand-written shared Zod schemas. Generating a typed client from `@nestjs/swagger` output is a plausible later step, deliberately deferred.
- **Angular SSR.** `@angular/ssr` is not adopted. The app ships as a static bundle behind nginx; there is no SEO requirement for an admin dashboard and SSR would reintroduce the server-runtime complexity this change removes.
- **Changing authentication mechanics.** No Passport, no custom JWT, no change to better-auth plugins, session storage, 2FA or email verification flows.
- **Visual redesign.** The port targets the existing layout, navigation and screens, re-expressed in Material's component vocabulary. Deliberately improving them is separate work.
- **A shared UI package.** There is one frontend; its components live in `apps/web`.

## Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| CORS misconfiguration silently blocks all cross-origin auth calls | High | Fix `BootstrapUtil` to pass an array (`cors@2.8.6` only matches and reflects when given an array or function), and make local development use the same cross-origin auth path as production so a broken allowlist fails on a developer's machine rather than on QA. |
| Cookie/session breakage once the Next.js same-origin proxy is gone | High | The subdomain split keeps frontend and auth same-*site*, so `SameSite=Lax` cookies keep working with only a `Domain` widening — no `SameSite=None`. `BETTER_AUTH_URL` must be the public `https://` origin, since better-auth derives the `Secure` cookie prefix from it. Verified by an auth smoke test against the proxied origins, not the app ports. |
| `trustedOrigins` set to the wrong value rejects authenticated requests and breaks redirect handling | High | It must list the *browser* origins, not the auth app's own. Covered by a new e2e case that sends an `Origin` header — the current suite sends none, so the guarantee is untested today. |
| nginx SPA history fallback omitted → deep links 404 on a refresh while `ng serve` works | Medium | `try_files $uri $uri/ /index.html` is part of the frontend server block, and the smoke test hard-refreshes a nested route through nginx rather than only loading `/`. |
| `@repo/shared-types` CJS output breaks or degrades the Angular esbuild build (optimization bailouts, `__importDefault(require("zod"))` interop against ESM-first Zod v4) | Medium | Fix the package to emit ESM before the Angular app consumes it. Node >=22.12 supports `require(esm)`, so the existing NestJS apps can consume ESM-only output without a dual build. Sequence this task first and verify `pnpm build` across every app. |
| Material's theming fights the Tailwind v4 token layer, or the two disagree on light/dark | Medium | The org already runs Material + Tailwind together in three frontends, so this is a solved problem in practice rather than an unknown; the pairing is set up once in the global stylesheet with Material owning component surfaces and Tailwind owning layout. Material 22 + Tailwind 4 is a newer combination than those projects use, so it is validated early, in the scaffold step. |
| Widening the cookie to a parent domain exposes the session to every sibling subdomain | Medium | `COOKIE_DOMAIN` is scoped to the narrowest parent that the apps actually share, and untrusted or third-party services are not hosted under it. better-auth's own guidance is to prefer host-only cookies unless sharing is required — here it is, for SSO. |
| Losing `react-hook-form` + Zod resolver ergonomics | Low | A single ~20-line Zod → `ValidatorFn` adapter in `@repo/shared-types`, reused by every form. No new dependency. |
| `useSession()` has no Angular equivalent | Low | `better-auth/client` exposes the session as a nanostores atom (`nanostores@^1.1.1` is a real dependency of `better-auth`); a small bridge converts it to an Angular signal. Every other client method is byte-for-byte identical, and the client already sends `credentials: 'include'`. |
| Version incompatibility across Angular / TypeScript / Tailwind / Zod | Low | All constraints verified against the registry (table above). No backend package needs to move. |

## Alternatives considered

- **`spartan/ui` instead of Angular Material.** `spartan/ui` is the true shadcn analogue for Angular — headless `@spartan-ng/brain` primitives on npm plus styled components generated into the repo, `components.json`, Tailwind v4, 55+ components at v1.0 — and was the initial recommendation on the grounds that Material's closed components and Material Design theming would fight the repo's Tailwind tokens. That objection does not survive contact with the org's actual practice: all three existing 3decide Angular frontends (`ext-d2-crm-frontend-angular`, `ext_remonstar_frontend_angular`, `ext_lousal_kiosks_ng_v2`) already run Angular Material *together with* Tailwind. For a template whose purpose is to seed future projects at 3decide, matching the stack developers already know outweighs the shadcn authoring model, and Google's support horizon is materially longer than spartan's stated two-Angular-major window. Material is chosen; spartan remains the fallback if Material's component model ever becomes the binding constraint.
- **Wrapping Material behind in-repo `components/ui/*` facades to keep the choice reversible.** Rejected as speculative abstraction: an indirection layer with one implementation, for a swap that probably never happens. If it ever does, five pages are cheaper to revisit than a wrapper layer is to carry indefinitely.
- **Angular SSR (`@angular/ssr`).** Rejected as a non-goal. It would restore `getServerSession()` and server-side redirects, but reintroduces a server runtime, a second build target and hydration concerns for an admin dashboard with no SEO requirement.
- **Single-origin nginx (everything, auth included, behind one hostname).** Simpler — no CORS at all, host-only cookies — and was the initial design. Rejected because it cannot deliver SSO: the session must be shared across sibling apps on the same parent domain, which is precisely what the split-subdomain shape plus `COOKIE_DOMAIN` provides, and which is already proven in production at 3decide. The hybrid keeps the simplicity where it is free (the frontend's own `/api/` stays same-origin) and pays the CORS cost only on the auth hop.
- **Cross-*site* frontend with `SameSite=None` cookies.** Rejected. Different registrable domains require `SameSite=None; Secure`, weakening the cookie posture and inviting Safari/ITP problems. The subdomain split avoids this entirely because siblings are same-site.
- **Keeping tRPC and adding an Angular tRPC client.** Rejected. It would preserve a dependency whose only consumer is a one-procedure `hello` router while the real data plane bypasses it entirely.
- **OpenAPI-generated typed client instead of shared Zod schemas.** Deferred, not rejected. `@nestjs/swagger` + `nestjs-zod` could generate a client giving automatic end-to-end types, closer to what tRPC promised. Shared Zod schemas were chosen for this change because they need no new tooling, already exist as a convention (`createZodDto`), and validate at runtime on both sides — but the door stays open once `apps/api` has real endpoints.
- **Running Angular and Next.js side by side during the migration.** Rejected. Two frontends would double the auth surface and the component inventory for a dashboard small enough to port in one pass.
