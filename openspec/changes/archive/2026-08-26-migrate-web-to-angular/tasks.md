## 1. packages/shared-types: ESM contract foundation

Sequenced first per design.md → D2. Every app must still build before Angular is introduced.

- [x] 1.1 `packages/shared-types`: chore(shared-types): set `"type": "module"`, correct `main` and `exports` to the real emitted paths, and adjust the tsconfig so the package emits ESM — verify `pnpm --filter @repo/shared-types build` produces `export` statements (not `exports.x =`) and that every path declared in `exports` and `main` exists on disk
- [x] 1.2 `packages/shared-types`: test(shared-types): add a unit test that resolves each declared package entry point and asserts the file exists and imports without throwing — verify the test fails when an entry point is pointed at a missing path
- [x] 1.3 root: chore: verify the ESM switch across the workspace with `pnpm build && pnpm lint && pnpm check-types && pnpm test` — verify every app builds and all existing suites pass with no new module-resolution errors
- [x] 1.4 root: test: assert a single resolved `zod` version in the workspace (`pnpm why zod`) — verify exactly one version resolves, satisfying the shared-schema identity requirement

## 2. Origin, CORS and proxy correctness

Independent of Angular and repairs current behaviour. Hard prerequisite for the cross-origin auth hop (design.md → D1).

- [x] 2.1 `packages/shared`: fix(shared): pass `CORS_ORIGIN` to `enableCors` as a trimmed array in `BootstrapUtil` (already applied in the working tree) and add a comment at the seam noting that `*` is a literal here but a wildcard in `trustedOrigins` — verify the comment is present and the behaviour is covered by 2.2
- [x] 2.2 `packages/shared`: test(shared): unit-test `BootstrapUtil` CORS handling — verify a comma-joined value produces an array of trimmed origins, that a single origin still works, and that the configured value is never emitted as one multi-origin string
- [x] 2.3 `apps/auth`: fix(auth): remove `*` from `CORS_ORIGIN` in `.env`, `.env.development` and `.env.example`, add `http://localhost:4200`, and delete the duplicated `CORS_ORIGIN` line in `.env.example` — verify the file declares `CORS_ORIGIN` exactly once and contains no wildcard entry
- [x] 2.4 `apps/auth`: fix(auth): add `trustProxy: true` to the `BootstrapUtil.setup` call in `apps/auth/src/main.ts`, matching `apps/api` — verify a request carrying `X-Forwarded-For` is attributed to the forwarded address rather than the proxy
- [x] 2.5 `apps/auth`: test(auth): extend the e2e suite with origin-validation cases — verify a request from a trusted origin with an explicit `Origin` header succeeds, and one from an untrusted origin is rejected as forbidden; confirm the new cases fail if `trustedOrigins` is emptied
- [x] 2.6 `apps/auth`: test(auth): add an e2e case asserting the session cookie's attributes — verify `HttpOnly` and `SameSite=Lax` are set, and that a `https` base URL yields the `Secure` attribute and its name prefix while an `http` base URL does not

## 3. Remove tRPC

Ordered so nothing is deleted before its consumers are (design.md → Migration Plan step 3).

- [x] 3.1 `apps/web`: refactor(web): remove the tRPC client, providers and proxy route handlers (`lib/trpc/*`, `components/trpc/*`, `app/api/trpc/[...path]/route.ts`) and drop `@repo/trpc`, `@trpc/react-query` from `package.json` — verify the Next.js app still builds and `/dashboard` and `/users` still render, since neither used tRPC for data
- [x] 3.2 `apps/api`: refactor(api): delete `src/app.router.ts` and `src/app.context.ts`, unregister the tRPC module from `AppModule`, and drop `nestjs-trpc-v2` and `@repo/trpc` — verify `pnpm --filter api build` succeeds and `GET /api` still returns its response
- [x] 3.3 `apps/auth`: refactor(auth): delete `src/auth-trpc.middleware.ts`, unregister the tRPC module, and drop `nestjs-trpc-v2` and `@repo/trpc` — verify `pnpm --filter auth build` succeeds and the existing auth e2e suite passes
- [x] 3.4 `packages/shared`: refactor(shared): delete `src/trpc/` and remove its exports from the barrel — verify `pnpm build` succeeds across the workspace with no unresolved imports of the removed symbols
- [x] 3.5 `packages/trpc`: chore: delete the `packages/trpc` workspace package — verify `pnpm install` succeeds and no `package.json` in the workspace still references `@repo/trpc`

## 4. apps/web: Angular 22 scaffold

Validate the Material + Tailwind pairing here, before any screen exists (design.md → D4).

- [x] 4.1 `apps/web`: feat(web)!: replace the Next.js app with an Angular 22 application scaffold serving on port 4200 — verify `pnpm --filter web dev` serves a page and `pnpm --filter web build` emits to `dist/`
- [x] 4.2 `apps/web`: feat(web): configure Tailwind CSS v4 via `@tailwindcss/postcss` in `.postcssrc.json` and `@import 'tailwindcss'` in the global stylesheet — verify a Tailwind utility class visibly applies in a built page, not only in dev
- [x] 4.3 `apps/web`: feat(web): add `@angular/material` and `@angular/cdk` 22 with a theme definition in the global stylesheet — verify a Material component and a Tailwind utility render correctly together on one page in both light and dark, with no reset-layer or specificity conflict; this is the gate for D4 and must pass before any screen is ported
- [x] 4.4 `packages/eslint-config`: chore(eslint-config): replace the `next-js` config with an Angular config and drop `@next/eslint-plugin-next`, `eslint-plugin-react` and `eslint-plugin-react-hooks` — verify `pnpm lint` passes on the scaffold with `--max-warnings 0`
- [x] 4.5 `packages/typescript-config`: chore(typescript-config): replace `nextjs.json` with an Angular base and point `apps/web` at it — verify `pnpm check-types` passes for `apps/web`
- [x] 4.6 root: chore: update `turbo.json` build `outputs` from `.next/**` to `dist/**`, replace the `NEXT_PUBLIC_BASE_PATH` env entry, and raise `engines.node` to `>=22.22.3` — verify a cached `pnpm build` correctly restores `apps/web` outputs and the Angular CLI reports no engine warning

## 5. Contract plumbing

- [x] 5.1 `packages/shared-types`: feat(shared-types): add response schemas for the payloads the dashboard renders (user, paginated collection wrapper) so response shapes stop being typed from a third-party library's exports — verify each schema parses a representative payload captured from the auth service
- [x] 5.2 `packages/shared-types`: feat(shared-types): add a `zodValidator()` adapter converting a Zod schema into an Angular `ValidatorFn` that reports errors per field — verify it produces a field-keyed error object for a failing value and `null` for a passing one
- [x] 5.3 `packages/shared-types`: test(shared-types): unit-test `zodValidator()` — verify required, malformed-email and enum violations each surface against the correct field, and that a valid value yields no error

## 6. Authentication in Angular

- [x] 6.1 `apps/web`: feat(web): add a schema-validated, build-time configuration module exposing the auth service origin as an absolute URL and the app's own API as a relative `/api` prefix — verify the production build fails with a named error when a required value is absent
- [x] 6.2 `apps/web`: feat(web): create the better-auth client from `better-auth/client` with an absolute `baseURL` and the two-factor and admin plugins — verify `getSession` reaches the auth service cross-origin and the session cookie is sent
- [x] 6.3 `apps/web`: feat(web): bridge the better-auth nanostores session atom to an Angular signal in an injectable service, unsubscribing via `DestroyRef` — verify the signal updates on sign-in and sign-out and that the subscription is released when the injector is destroyed
- [x] 6.4 `apps/web`: feat(web): add `proxy.conf.json` forwarding only `/api/` to the local API app, deliberately leaving auth cross-origin — verify a local business API call is same-origin and a local auth call targets port 3000, and that emptying the auth allowlist breaks local sign-in
- [x] 6.5 `apps/web`: feat(web): add auth and admin route guards that resolve the session before activation and render a loading placeholder while pending — verify an unauthenticated request to `/users` never renders user data before redirecting to `/sign-in`, and a non-admin is sent to `/dashboard`
- [x] 6.6 `apps/web`: feat(web): build `/sign-in` with email/password validated by the shared schema via `zodValidator()` — verify a successful sign-in navigates to `/dashboard` and an invalid credential shows an error without navigating
- [x] 6.7 `apps/web`: test(web): unit-test the guards and the session bridge — verify the pending, authenticated, unauthenticated and wrong-role paths each produce the specified navigation, and that no protected content renders while pending

## 7. Shell and screens

- [x] 7.1 `apps/web`: feat(web): build the app shell — sidenav, top bar, and navigation entries filtered by session role — verify admin-only entries are absent for a non-admin session and the signed-in user's name appears in the top bar
- [x] 7.2 `apps/web`: feat(web): add the theme service backed by `localStorage` plus the inline pre-bootstrap script in `index.html` — verify a dark preference survives reload with no light-theme frame before it applies, and that an unreadable stored value falls back to the default without error
- [x] 7.3 `apps/web`: feat(web): register the `@tanstack/angular-query-experimental` provider with the existing 60s `staleTime` default — verify a repeated query within the window is served from cache rather than refetched
- [x] 7.4 `apps/web`: feat(web): build `/dashboard` with its parallel stat queries — verify the counts render and match the users list, and that a failing query surfaces an error instead of rendering zeros
- [x] 7.5 `apps/web`: feat(web): build the `/users` table with pagination, 300 ms debounced email search, and role and banned-status filters — verify paging advances, a search term resets to the first page, and combined status-plus-role filtering returns the same rows as the current implementation
- [x] 7.6 `apps/web`: feat(web): add the create-user dialog validated by the shared schema — verify a valid submission creates the user, shows a success message and refreshes the list, and a malformed email is blocked before submitting
- [x] 7.7 `apps/web`: feat(web): add the edit-role dialog and the ban, unban and delete actions — verify each persists, reports success, and that a server rejection shows an error without leaving the list displaying the un-persisted change
- [x] 7.8 `apps/web`: feat(web): validate responses against the shared response schemas at the boundary, throwing for payloads a screen cannot render without and degrading gracefully for non-essential fields — verify a deliberately malformed essential response surfaces a validation error and renders no unvalidated data
- [x] 7.9 `apps/web`: test(web): component-test the users table and both dialogs — verify debounce and page-reset behaviour, field-level validation errors, and the failure path of each management operation

## 8. Deployment topology

- [x] 8.1 `apps/web`: feat(web): replace the Dockerfile with a static build stage plus an nginx serving stage using the same server block as the deployed frontend — verify the built image serves the app and a nested route returns the app document on a direct request
- [x] 8.2 root: feat: add the nginx server blocks — the frontend origin serving static files with a history fallback and proxying `/api/` to the API app, and the auth origin proxying `/api/auth/` to the auth app, both forwarding `Host`, `X-Real-IP`, `X-Forwarded-For` and `X-Forwarded-Proto` — verify `nginx -t` passes, a nested route survives a hard refresh, and `/api/` is not captured by the fallback
- [x] 8.3 `apps/auth`: chore(auth): set `BETTER_AUTH_URL` to the public `https` auth origin, `trustedOrigins` to the browser origins, and `COOKIE_DOMAIN` to the narrowest shared parent domain, per environment — verify the issued cookie carries the `Secure` prefix, the configured `Domain`, and `SameSite=Lax`

## 9. Documentation

- [x] 9.1 root: docs: update `CLAUDE.md` and `openspec/config.yaml` — stack, workspace layout, frontend conventions, and removal of every tRPC reference — verify no remaining mention of tRPC, shadcn/ui, Next.js or `next-themes` describes current behaviour
- [x] 9.2 root: docs: replace `.github/instructions/nextjs-conventions.instructions.md` with Angular conventions and refresh `README.md` and the deploy docs for the subdomain topology — verify the documented dev commands and ports match reality
- [x] 9.3 `.claude`: docs: add `CORNER_CASES.md` entries for the SPA history fallback, `BETTER_AUTH_URL` driving the `Secure` cookie prefix rather than the proxy headers, and `*` meaning opposite things to `enableCors` and `trustedOrigins` — verify each entry names the symptom and the fix

## 10. End-to-end verification

- [x] 10.1 root: test: run the full gate — `pnpm build && pnpm lint && pnpm check-types && pnpm test` — verify all pass with no new warnings
- [x] 10.2 root: test: smoke-test through nginx, not the app ports — sign in, hard-refresh a nested route, exercise list, create, set-role, ban, unban and delete, and confirm `/health/live` on each backend app — verify every step succeeds against the proxied origins
- [x] 10.3 root: test: verify single sign-on and the email flows — sign in on one sibling subdomain and confirm the session is already active on another, then confirm the two-factor and password-reset emails are still queued and delivered
