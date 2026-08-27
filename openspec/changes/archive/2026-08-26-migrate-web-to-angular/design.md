## Context

See `proposal.md` → Why for motivation. The design-relevant constraints:

- **`apps/web` is the only app that changes shape.** `apps/auth`, `apps/api`, `apps/notifications`, `apps/worker`, `apps/cron`, `packages/database` and `packages/mail` are untouched except for removing tRPC wiring and aligning the auth app's origin/cookie settings.
- **The frontend loses its server runtime.** Next.js gave `apps/web` three server-side capabilities — a same-origin cookie proxy (`app/api/auth/[...path]/route.ts`), a pre-render redirect (`proxy.ts`), and server-side session reads (`lib/auth/server.ts` → `getServerSession()`). An Angular static bundle has none. nginx absorbs the first; route guards absorb the second; the third has no equivalent and is dropped.
- **The target topology already exists in production.** 3decide runs this exact shape today: each frontend on its own subdomain proxying its own API same-origin under `/api/`, a shared `auth.` sibling subdomain reached cross-origin, and one session cookie scoped to the parent domain for SSO. This design generalises that shape into the template rather than inventing one.
- **The backend is already partly proxy-ready.** `apps/api` bootstraps with `trustProxy: true`, and `ContextUtil.extractToken()` (`packages/shared/src/utils/context.util.ts`) reads both `better-auth.session_token` and `__Secure-better-auth.session_token` from cookies as well as the `Authorization` header.
- **The data plane is better-auth, not `apps/api`.** All eight operations the dashboard performs go through the better-auth admin plugin. `apps/api` serves exactly `GET /` today.
- **Angular is the org's frontend stack.** Three existing 3decide frontends run Angular + Angular Material + Tailwind. Version constraints are already satisfied: `typescript@6.0.3` sits inside Angular 22's `>=6.0 <6.1` window, and `tailwindcss@4.3.2` is already an `apps/web` dependency. Full table in `proposal.md` → Impact.

## Goals / Non-Goals

**Goals:**

- Preserve the cookie-based session model — same cookie names, same `SameSite=Lax` — while widening its scope just enough to give SSO across sibling apps.
- Make the CORS path impossible to get wrong silently: whatever configuration production needs, local development must exercise the same path.
- Make `@repo/shared-types` a package both a CJS NestJS app and an Angular esbuild pipeline can consume cleanly, since it becomes the load-bearing contract.
- Leave every backend package importable and buildable at each step, so the migration is not a single atomic cutover.

**Non-Goals (design-level, beyond `proposal.md` → Non-goals):**

- No abstraction layer over the better-auth client. The Angular app calls `authClient.admin.*` directly, exactly as the React app does.
- No facade layer over Material components (see `proposal.md` → Alternatives considered).
- No state-management library (NgRx store, Signals Store). Server state goes to TanStack Query; the small amount of local state fits in component signals.

## Decisions

### D1 — Split subdomains behind nginx: same-origin for the app's own API, cross-origin for shared auth

**Affects:** `apps/web` (new `proxy.conf.json`, `Dockerfile`), `apps/auth` (`BETTER_AUTH_URL`, `trustedOrigins`, `CORS_ORIGIN`, `COOKIE_DOMAIN`, `trustProxy`), `packages/shared` (`BootstrapUtil`), deployment config.

The frontend and the auth service are separate origins; the frontend's own backend is not.

```
  ┌─ admin.example.com ──────────────────────────────┐
  │  /          → static Angular bundle              │
  │               try_files $uri $uri/ /index.html   │   ← SPA history fallback
  │  /api/      → proxy_pass apps/api    SAME-ORIGIN │   ← no CORS, relative URLs
  └──────────────────────────────────────────────────┘
                          │
                          │  cross-ORIGIN, same-SITE
                          ▼
  ┌─ auth.example.com ───────────────────────────────┐
  │  /api/auth/ → proxy_pass apps/auth   CORS needed │
  └──────────────────────────────────────────────────┘

  Cookie: Domain=.example.com · SameSite=Lax · Secure · HttpOnly
          → shared by every sibling subdomain ⇒ SSO
```

Why this split rather than one origin for everything:

- **SSO is the requirement.** A single hostname gives host-only cookies, so a second app on a sibling subdomain gets an independent session. Widening the cookie to the parent domain is the only way to share it, and that implies auth lives on its own subdomain.
- **It costs CORS only on the auth hop.** The frontend's own API stays same-origin under `/api/`, so business calls need no CORS, no preflight and no absolute URLs.
- **`SameSite=Lax` survives.** Siblings share a registrable domain, so they are the same *site*; `Lax` cookies are sent on same-site subresource requests. Verified in `better-auth@1.6.23` (`dist/cookies/index.mjs`): `crossSubDomainCookies` adds **only** the `Domain` attribute — `sameSite` stays `lax`, `secure` is untouched. No `SameSite=None` anywhere.

Naming convention, inherited from the production deployment: **the subdomain identifies the app; `/api/` only means "this is the API"**. The app name is never repeated in the path. The one exception is `/api/auth/`, which is better-auth's own convention.

Settings that must agree, and the non-obvious reasons:

| Setting | Value | Why |
|---|---|---|
| `BETTER_AUTH_URL` | `https://auth.example.com/api/auth` | The `Secure` cookie prefix is derived from `advanced.useSecureCookies`, else from `baseURL.startsWith('https://')`, else from `isProduction` — **not** from `X-Forwarded-Proto`. A container-port value here silently drops the prefix. |
| `COOKIE_DOMAIN` | narrowest shared parent | Enables `crossSubDomainCookies`. better-auth's guidance is to prefer host-only cookies and widen only when sharing is genuinely needed; here it is, for SSO. Every sibling under it can read the session, so nothing untrusted may be hosted there. |
| `trustedOrigins` | the **browser** origins | Gates both the CSRF origin check and redirect allowlisting (better-auth exposes `advanced.disableCSRFCheck` and `advanced.disableOriginCheck` separately, confirming the two roles). Wildcards are supported (`https://*.example.com`), which avoids enumerating siblings — at the cost of trusting every subdomain. A bare `*` is **not** rejected: `matchesOriginPattern` matches a scheme-less wildcard against the host, so `*` would trust every origin and void the check. Filtering it out is correct. |
| `CORS_ORIGIN` | list of browser origins | See below. |
| `trustProxy` | `true` on `apps/auth` | `apps/api` already sets it; `apps/auth` does not. It does not affect the cookie prefix (per the row above), but without it everything deriving the client IP behind nginx sees the proxy's address — notably `ThrottlerModule`'s per-IP limits. |

**`BootstrapUtil` must split `CORS_ORIGIN` into an array.** Confirmed in `cors@2.8.6` (`lib/index.js`, `configureOrigin`): a **string** origin is echoed verbatim into `Access-Control-Allow-Origin` with no comparison against the request origin, so a comma-joined value produces an invalid multi-origin header that browsers reject. Only an **array** (or function) takes the `isOriginAllowed()` path and reflects the matched origin. `enableCors` is reached from `BootstrapUtil.setup()` and its schema already accepts `string | string[]`, so this is a one-line change at the seam plus the `.env` values.

**`*` must not appear in `CORS_ORIGIN` at all**, because the two consumers of that variable interpret it in opposite ways:

| Consumer | How `*` is treated | Consequence |
|---|---|---|
| `enableCors` (array form) | **literal string**, compared with `===` in `isOriginAllowed` | inert — matches nothing, silently useless |
| better-auth `trustedOrigins` | **wildcard**, matched against the host by `matchesOriginPattern` | trusts every origin, voiding the CSRF origin check |

Filtering `*` out before it reaches `trustedOrigins` is therefore required, and leaving it in the CORS array is harmless but misleading. Removing it from the env values is what actually makes the configuration honest: it has no valid meaning in either consumer. (Separately, `origin: '*'` as the *whole* value combined with `credentials: true` is rejected by browsers for credentialed requests.) Because one variable feeds two matchers with different grammars, a comment at the derivation site is worth more than it looks.

**Alternatives:** single-origin nginx and cross-*site* `SameSite=None` — both rejected in `proposal.md` → Alternatives considered. Serving Angular from a NestJS `ServeStaticModule` — rejected because it puts static-asset serving in the request path of a Node process for no gain when nginx is already deployed.

### D1b — Local development uses the same cross-origin auth path as production

**Affects:** `apps/web` (`proxy.conf.json`), `apps/auth` (`.env`).

The tempting dev setup proxies *everything* — including auth — through the Angular dev server, reproducing the old same-origin model. This design deliberately does not, because that is exactly what hides CORS and `trustedOrigins` defects until deployment: the current repo cannot detect a broken `CORS_ORIGIN` locally for precisely this reason.

```
  localhost:4200          Angular dev server (the CLI default)
    /api/     → proxy.conf.json → localhost:3100 (apps/api)     SAME-ORIGIN   mirrors nginx
    auth      → http://localhost:3000/api/auth  (absolute)      CROSS-ORIGIN  mirrors nginx
```

This works locally without `COOKIE_DOMAIN` because **cookies ignore the port**: a cookie set by `localhost:3000` is sent to `localhost:4200`, since both are the host `localhost`. But the two *are* different origins for CORS, so `apps/auth` must have `CORS_ORIGIN` and `trustedOrigins` containing `http://localhost:4200` for local development to work at all. That is the point: the allowlist becomes a precondition for `pnpm dev`, not a deployment detail.

The port moves from the Next.js app's `8080` to Angular's default `4200`, so `apps/auth`'s local origin list changes rather than being inherited.

`COOKIE_DOMAIN` stays unset locally. It is only meaningful once real subdomains are involved.

### D2 — `@repo/shared-types` emits ESM only

**Affects:** `packages/shared-types`, and by extension every app that imports it.

The package currently emits CommonJS (`exports.paginationSchema = …`, `__importDefault(require("zod"))`) because `typescript-config/nestjs.json` sets `module: nodenext` on a package without `"type": "module"` — while `package.json` advertises `"import": "./dist/index.js"`. Its `main` also points at `./dist/src/index.js`, which does not exist. Next.js transpiles over all of this; Angular's esbuild will consume it but with CommonJS interop, lost tree-shaking, `optimization bailout` warnings, and a `require()` of ESM-first Zod v4 as a sharp edge.

**Decision:** make it `"type": "module"`, emit ESM, correct `main` and `exports` to the real paths. **Not** a dual CJS/ESM build.

Rationale: dual builds double the output, double the tsconfigs, and create the dual-package hazard — two Zod schema identities, so `instanceof` checks and schema registries diverge. That is a real risk for a package whose entire job is schema identity. ESM-only is viable because `engines.node` is `>=22` and Node ≥22.12 supports `require(esm)` unflagged, so the CJS NestJS apps can consume it as-is.

**Sequencing:** this is task one. Every app must still `pnpm build` before the Angular app is introduced, so an ESM regression surfaces on its own rather than tangled with the frontend port.

**Alternatives:** dual build (rejected: dual-package hazard); leaving it CJS and letting esbuild cope (rejected: degrades the Angular build permanently to avoid a small fix); publishing source and letting consumers compile (rejected: breaks the NestJS `dist` convention every other `@repo/*` package follows).

### D3 — Session state: nanostores atom bridged to an Angular signal

**Affects:** `apps/web`.

`better-auth@1.6.23` exports `./client` (the vanilla client, `dist/client/vanilla.mjs` + `session-atom.mjs`) and `./client/plugins`. There is no `./angular` export, but the framework wrappers are thin shells over this core, and `nanostores@^1.1.1` is a real dependency of `better-auth`.

```
  better-auth/react                      better-auth/client
  ─────────────────                      ──────────────────
  createAuthClient({ basePath })    →    createAuthClient({ baseURL })    absolute (D1)
  authClient.signIn.email(…)        →    authClient.signIn.email(…)       identical
  authClient.admin.listUsers(…)     →    authClient.admin.listUsers(…)    identical
  twoFactorClient(), adminClient()  →    same imports                     identical
  authClient.useSession()  ← hook   →    session atom  ← nanostores       BRIDGE
```

Two differences from the React setup, both small:

- `basePath: '/api/auth'` becomes an absolute `baseURL` pointing at the auth subdomain, because auth is no longer same-origin (D1). The client accepts either.
- `useSession()` becomes a nanostores atom. The bridge is one injectable service: subscribe to the atom, push into a `signal`, unsubscribe via `DestroyRef`. Roughly ten lines, one file, no dependency.

Cross-origin credentials need no work: the client already sets `credentials: "include"` by default (`dist/client/config.mjs`).

**Alternatives:** an unofficial community Angular adapter (rejected: a ten-line bridge does not justify a dependency with an unknown maintenance horizon); reimplementing session fetching with `HttpClient` (rejected: throws away token refresh, multi-tab broadcast and the plugin surface `better-auth/client` already provides).

### D4 — Angular Material 22 for components, Tailwind v4 for layout

**Affects:** `apps/web`.

Material owns component surfaces; Tailwind owns layout, spacing and one-off utilities. The division matters because the two overlap and an unmanaged mix produces specificity fights.

```
  @angular/material 22 + @angular/cdk 22     components: form fields, table, dialog,
                                             menu, snackbar, sidenav, tooltip, …
  tailwindcss 4 (@tailwindcss/postcss)       layout, spacing, responsive utilities
  Material theming API (mat.theme)           colour system, light/dark, density
```

Tailwind is wired the Angular-official way: `@tailwindcss/postcss` in `.postcssrc.json` and `@import 'tailwindcss'` in the global stylesheet. Material's theme is defined in the same stylesheet so one file owns the visual system.

The 17 shadcn primitives `apps/web` uses today map onto Material components rather than being ported — `components/ui/*` is deleted, not translated. The mapping is mostly one-to-one (`dialog`→`MatDialog`, `select`→`mat-select`, `table`→`mat-table`, `sheet`/`sidebar`→`mat-sidenav`, `dropdown-menu`→`mat-menu`, `tooltip`→`matTooltip`, `skeleton`→`mat-progress-spinner` or a Tailwind shim, `sonner`→`MatSnackBar`). Icons move from `lucide-react` to Material icons.

**Validate this pairing in the scaffold step, not late.** The org runs Material + Tailwind in three frontends, so the combination is proven — but on Angular 15–18 with Tailwind v3. Material 22 + Tailwind v4 is newer than any of them, and Tailwind v4's `@layer`-based reset interacts with Material's component styles. Confirming it on an empty scaffold costs minutes; discovering it during the users-table port costs a day.

**Alternative:** `spartan/ui` — rejected in `proposal.md` → Alternatives considered, reversing the initial recommendation once the org's existing stack was checked.

### D5 — Route guards resolve the session before activation; the lost server redirect is accepted

**Affects:** `apps/web`.

`proxy.ts` read the session cookie and redirected server-side before anything rendered. A static SPA cannot do that. The replacement:

- An auth guard resolves the session (D3) before activating a route, redirecting to `/sign-in` when absent — mirroring the old `publicRoutes` logic, including redirecting an authenticated user away from `/sign-in`.
- An admin guard checks `RoleEnum.ADMIN` from `@repo/shared-types`, replacing the role check in `(dashboard)/layout.tsx`.
- While the session is pending, the shell renders a **skeleton**, never dashboard content. This bounds the regression to a loading state rather than a flash of protected data.

This is a genuine, accepted regression: the redirect is now client-side. Restoring server-side gating requires SSR, an explicit non-goal. The security boundary is unaffected — it was never the middleware. Every protected read is authorized server-side by better-auth or by `MicroserviceAuthGuard`; the guard is navigation UX.

### D6 — Zod schemas as the contract: one adapter for forms, `parse` at the network boundary

**Affects:** `packages/shared-types`, `apps/web`.

```
                 ┌──────────────── @repo/shared-types (Zod v4) ────────────────┐
                 │  input schemas   createUserSchema, editRoleSchema, …        │
                 │  response schemas  userSchema, paginated wrappers, …  (NEW) │
                 │  enums           RoleEnum, EnvironmentEnum                  │
                 │  zodValidator()  Zod → Angular ValidatorFn           (NEW)  │
                 └───────────┬────────────────────────────────┬───────────────┘
                             │                                │
              createZodDto() │                                │ zodValidator() + schema.parse()
                             ▼                                ▼
                     NestJS (apps/api)                  Angular (apps/web)
```

Two additions:

- **Response schemas.** Today the package holds only input schemas; the frontend types its data from `better-auth/plugins/admin`'s `UserWithRole`. Response schemas make the boundary explicit and satisfy the project rule to validate input at system boundaries — an HTTP response is one.
- **`zodValidator()`**, a ~20-line Zod → `ValidatorFn` adapter replacing `@hookform/resolvers/zod`. One function, reused by every form, no dependency. This is the only place the Angular stack is measurably more work than the React one.

Validation policy: `parse` (throw) on responses the app cannot render without, `safeParse` where a partial render is preferable. Not blanket-`parse` everywhere — schema drift in a peripheral field should not blank the page.

**Alternatives:** `ngx-zod-form`-style libraries (rejected: small surface, uncertain maintenance, for twenty lines); OpenAPI-generated client (deferred in `proposal.md`); trusting responses untyped (rejected: violates the boundary-validation rule and is exactly the guarantee tRPC nominally provided).

### D7 — TanStack Angular Query for server state

**Affects:** `apps/web`.

`@tanstack/angular-query-experimental@5.102.5` runs the same TanStack Query v5 core as the `@tanstack/react-query@5.101` already in `apps/web`. Query keys, `staleTime`, invalidation semantics and the existing `queryFn: () => authClient.admin.listUsers(...)` call sites port near-verbatim; the dashboard's parallel stat queries and the debounced, paginated users table keep their current caching behaviour.

Note the `-experimental` suffix: the package name is unstable, the underlying core is not. Accepted — the alternative is reimplementing request dedup, caching and invalidation in bespoke services.

**Alternative:** plain `HttpClient` + `httpResource` in services (rejected: would hand-roll the caching and invalidation the dashboard already relies on).

### D8 — Configuration is build-time substituted and Zod-validated

**Affects:** `apps/web`, and the `env-validation` spec.

`apps/web/env.ts` parses `process.env` at module load, which works because Next.js has a build step *and* a server. Angular has a build step and no server: nothing in the browser can read `process.env` at runtime.

**Decision:** a Zod-validated config object populated at build time (Angular's file replacement / `define`), validated with a top-level `parse` so a missing variable fails `ng build` — preserving the *intent* of the existing requirement (fail the build, never read raw env in app code) under a different mechanism. Runtime-injected config (fetching `/config.json` at bootstrap) is rejected: it adds a request before the app can start, for values that do not change between deploys of the same artifact.

The topology decides which variables survive, and it is not symmetric:

- **`API_URL` collapses to the relative prefix `/api`** — the app's own backend is same-origin (D1), so no host is needed.
- **`AUTH_API_URL` stays absolute** and is per-environment, because auth is a different origin.
- `NEXT_PUBLIC_AUTH_API_URL`, `BACKEND_PROTOCOL`, `BACKEND_HOST` disappear.

### D9 — Theme: Material's theming API plus a signal service and an inline pre-hydration script

**Affects:** `apps/web`.

Light/dark comes from Material's theme definition rather than Tailwind's `dark:` variant, so component surfaces and utility classes agree on one source of truth. An injectable service owns the current mode as a signal and persists it to `localStorage`.

`next-themes` avoided a flash of the wrong theme by injecting a blocking script server-side. A static bundle has no server, so the theme must be applied before Angular bootstraps: a small inline script in `index.html` reads `localStorage` and sets the class on `<html>`. Skipping it produces a visible light-to-dark flash on every load — the kind of regression that reads as "the migration made it worse".

### D10 — Tooling changes are mechanical

**Affects:** `packages/eslint-config`, `packages/typescript-config`, `turbo.json`, root `package.json`, `apps/web/Dockerfile`.

`eslint-config/next.js` → an Angular config (`angular-eslint`), dropping `@next/eslint-plugin-next`, `eslint-plugin-react`, `eslint-plugin-react-hooks`. `typescript-config/nextjs.json` → an Angular base. `turbo.json` build `outputs` `.next/**` → `dist/**`, and the `NEXT_PUBLIC_BASE_PATH` env entry is replaced (Angular uses `--base-href`). `engines.node` `>=22` → `>=22.22.3` for the Angular CLI. The Dockerfile changes from Next standalone output to a static build stage plus an nginx serving stage, using the same server block as D1 so container and QA/PROD agree.

No Prisma schema changes. No new event patterns, message patterns or queue jobs. No new roles or guards on the backend.

## Risks / Trade-offs

Change-level risks are in `proposal.md` → Risks & Mitigations. Design-level additions:

- **nginx SPA fallback omitted → deep links 404 in QA while `ng serve` works.** → `try_files $uri $uri/ /index.html` belongs to the frontend server block; the smoke test hard-refreshes a nested route through nginx, not just `/`.
- **`CORS_ORIGIN` left as a comma string → every credentialed cross-origin auth call fails with an invalid `Access-Control-Allow-Origin`.** → Fixed at the `BootstrapUtil` seam (D1) rather than per app, so no app can reintroduce it. D1b makes it fail locally first.
- **`trustedOrigins` pointing at the auth app's own origin instead of the browser's → authenticated requests rejected and redirect handling broken.** → It is derived from the browser-origin list, and a new e2e case sends an `Origin` header. The existing `apps/auth` suite sends none, so this guarantee is currently untested — that gap is what makes the failure mode plausible.
- **`BETTER_AUTH_URL` left at a container port → the cookie silently loses its `Secure` prefix, because the prefix comes from `baseURL`, not the proxy headers (D1).** → Set to the public `https://` origin as part of the nginx task; both cookie names are already handled by `ContextUtil` and covered by `context.util.spec.ts`.
- **Cookie widened further than the apps actually share → every sibling subdomain can read the session.** → `COOKIE_DOMAIN` is scoped to the narrowest shared parent, and nothing untrusted is hosted under it. Choosing a wildcard `trustedOrigins` pattern has the same shape of risk and the same answer.
- **Material 22 + Tailwind v4 interact badly (reset layering, specificity).** → Validated on the empty scaffold before any screen is ported (D4).
- **ESM-only `@repo/shared-types` regresses a NestJS app's build or Jest transform.** → Sequenced first (D2) and verified with a full `pnpm build` plus the existing suites before Angular is introduced. `require(esm)` needs Node ≥22.12, which the tightened `engines` guarantees.
- **`@tanstack/angular-query-experimental` is renamed or its API shifts on the road to stable.** → Query usage is confined to feature components with plain query keys; a rename is a dependency swap, not a rewrite.
- **Trade-off accepted: no server-side redirect.** Unauthenticated navigation shows a skeleton before redirecting rather than never rendering (D5). This is the price of dropping the frontend server runtime, which is the point of the change.
- **Trade-off accepted: hand-maintained contract.** Shared Zod schemas do not fail the build when `apps/api` and the schema diverge — an OpenAPI-generated client would. Mitigated by response validation at the boundary (D6) turning drift into a loud runtime error rather than silent wrong data, and revisitable once `apps/api` has real endpoints.
- **Trade-off accepted: Material's component model.** Components are closed and themed by Material rather than owned in-repo and themed by Tailwind tokens. Bought deliberately, for team familiarity and support horizon (`proposal.md` → Alternatives considered).

## Migration Plan

Ordered so the repo builds after every step and nothing depends on the frontend being finished.

1. **`packages/shared-types` → ESM** (D2). Fix `type`/`main`/`exports`, verify `pnpm build` and all suites across every app. Independently shippable and useful on its own.
2. **`CORS_ORIGIN` split in `BootstrapUtil`, plus `trustProxy` on `apps/auth`, plus the `Origin`-sending e2e case** (D1). Repairs current behaviour, independent of Angular, and a hard prerequisite for the cross-origin auth hop.
3. **Remove tRPC** (`proposal.md` → Impact). Delete `packages/trpc`, `packages/shared/src/trpc/`, `apps/api/src/app.router.ts` + `app.context.ts`, `apps/auth/src/auth-trpc.middleware.ts`; drop `nestjs-trpc-v2` and `@trpc/server`; clean the `@repo/shared` barrel. `apps/web` still builds because its tRPC providers go in the same step. Backend is now Angular-ready and still ships.
4. **Scaffold `apps/web` as Angular 22** — Tailwind v4 + Material 22, `.postcssrc.json`, theme file, ESLint/tsconfig/turbo/Docker updates (D4, D10). Validate the Material + Tailwind pairing here, before any screen exists.
5. **Auth layer** — vanilla client with absolute `baseURL`, session signal bridge, guards, `/sign-in`, and the `proxy.conf.json` that proxies `/api/` but not auth (D3, D5, D1b).
6. **Shell and screens** — layout, sidenav, top bar, theme (D9), then `/dashboard` and `/users` with TanStack Query (D7) and the Zod contract (D6).
7. **nginx server blocks + deployment settings** (D1) — `BETTER_AUTH_URL`, `trustedOrigins`, `COOKIE_DOMAIN`, and the Dockerfile serving stage.
8. **Documentation** — `CLAUDE.md`, `openspec/config.yaml`, `.github/instructions/*`, `README.md`, and a `.claude/CORNER_CASES.md` entry for the SPA-fallback, `BETTER_AUTH_URL`-drives-`Secure`, and string-vs-array CORS gotchas.
9. **Smoke test through nginx** — sign in, hard-refresh a nested route, exercise all six admin operations, verify 2FA and password-reset emails still flow, confirm `/health/live` on each backend app, and confirm the session survives across two sibling subdomains.

**Rollback.** Steps 1–3 are independently revertable and leave a working Next.js app. From step 4 on, the Next.js app is replaced rather than removed incrementally, so rollback is a git revert of the migration branch — cheap because no backend behaviour, schema or migration changes. The dividing line is deliberate: everything irreversible happens after the backend is already proven on the new footing.

## Open Questions

- **`--base-href`.** Whether any environment actually needs the sub-path deployment that `NEXT_PUBLIC_BASE_PATH` allowed. If nothing uses it, the config drops entirely rather than being translated.
- **`trustedOrigins`: wildcard or enumerated?** `https://*.example.com` is one entry and needs no edit when a sibling app is added; an explicit list is tighter but must be maintained. Deferrable — it is a value, not a mechanism, and does not change the specs or the task breakdown.
