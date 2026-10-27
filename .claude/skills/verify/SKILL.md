---
name: verify
description: Runtime verification recipe for this monorepo — boot the stack, get real admin/user sessions, drive apps/api through the web proxy and apps/web in Chrome, and check logs/DB for side effects. Use when verifying a change end to end (e.g. via /verify).
---

# Verify (runtime) — nestjs-angular-monorepo

Observe the running stack; don't re-run CI. Surfaces: REST via the web proxy
(`:4200/api`), the Angular UI (`:4200`), Mongo request logs, Postgres rows,
pino output on the dev console.

## 1. Boot

```bash
docker ps --format '{{.Names}}' | grep nestjs-angular-monorepo || pnpm docker:up
pnpm dev > <scratchpad>/dev.log 2>&1        # run in background
# ready when all 5 backends + web are up:
grep -a "is running on port" <scratchpad>/dev.log; grep -a "localhost:4200" <scratchpad>/dev.log
```

Ports: auth 3000, api 3100, notifications 3200, worker 3300, cron 3400, web 4200.
`apps/web/proxy.conf.json` sends `/api` → 3100. If `GET :4200/api/v1/customers`
without a session isn't **401**, a local `apps/*/.env` `PORT` is wrong (never edit
`.env` without the user's OK).

`apps/api/.env` needs `FIELD_ENCRYPTION_KEY` / `FIELD_ENCRYPTION_HMAC_KEY`
(`pnpm setup` only writes them into a *new* `.env`).

## 2. Sessions without anyone's real password

Sign up throwaway users on the local auth service, then verify/promote them in
Postgres (container credentials stay in the container):

```bash
PW=$(node -e 'console.log("Vf!"+require("crypto").randomBytes(12).toString("base64url"))')
# keep $PW in a scratchpad file; never echo it in chat
# POST :3000/api/auth/sign-up/email  {email,password,name}  with header Origin: http://localhost:4200
docker exec nestjs-angular-monorepo-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "UPDATE \"user\" SET \"emailVerified\"=true, role=... WHERE email IN (...)"'
```

`emailAndPassword.requireEmailVerification` is on: unverified users get
"Email not verified" at sign-in.

## 3. Drive the API

A hook blocks `curl` with a printed body, so use a Node `fetch` script in the
scratchpad: sign in at `:3000/api/auth/sign-in/email`, collect
`res.headers.getSetCookie()` into a `Cookie` header, then call
`http://localhost:4200/api/v1/...`. Print `status` + a truncated body per call.
Probe: 401 (no cookie), 403 (non-admin writes), 400 (bad query/body — Zod
validation is **400**, not 422), 409, wrong method, unknown fields.

## 4. Side effects

```bash
# Mongo request logs (TTL 30d) — check url/requestBody/responseBody for PII
docker exec nestjs-angular-monorepo-mongo-1 sh -c 'mongosh --quiet -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin "${MONGO_INITDB_DATABASE:-nestjs}" --eval "printjson(db.logs.find().sort({createdAt:-1}).limit(5).toArray())"'
# pino console
grep -a "api:dev" <scratchpad>/dev.log | sed 's/\x1b\[[0-9;]*m//g' | tail
```

## 5. Drive the UI (Claude in Chrome)

- Use a fresh tab. A previous session's cookie may still be live — `/sign-in`
  redirecting to `/dashboard` is `guestGuard`, not a bug.
- Overlays (MatMenu, MatDialog) don't open from `ref` clicks in a background
  tab — click by **coordinates** from a fresh screenshot, or click via
  `javascript_tool`.
- Fill reactive forms from JS with `el.value = …; el.dispatchEvent(new Event('input', {bubbles:true}))`.
- Background tabs throttle timers to ~1s and stall CDK animations: timings from
  in-page loops are coarse, and a dialog captured mid-`mdc-dialog--opening`
  looks translucent. Measure with `performance.getEntriesByType('resource')`.
- Sign-in navigates only after better-auth's session refetch (~1s after the
  POST) — expected, see `SessionService.signedIn()`.

## 6. Clean up

Stop `pnpm dev`, close the tab, and tell the user which throwaway users/rows
you left (or delete them if they ask).
