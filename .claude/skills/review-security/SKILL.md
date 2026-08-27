---
name: review-security
description: Security audit of the codebase — checks authentication, authorization, input validation, secret handling, injection risks, and OWASP Top 10 concerns. Produces a prioritized findings report.
license: MIT
compatibility: NestJS + Angular monorepo
metadata:
  author: project
  version: "1.0"
---

Perform a security audit of this NestJS + Angular monorepo. Identify vulnerabilities, misconfigurations, and deviations from security best practices.

**Do not exploit or modify anything.** This is a read-only security analysis.

---

## Audit Checklist

### 1. Authentication

- [ ] All routes protected by `AuthGuard` as `APP_GUARD`?
- [ ] `@Public()` decorator only on genuinely public routes?
- [ ] Cookie names correct (`better-auth.session_token` + `__Secure-better-auth.session_token`)?
- [ ] No custom JWT or Passport strategies added?
- [ ] Session validation via `better-auth` only?

```bash
# Check for @Public() usage
grep -r "@Public()" apps --include="*.ts" -n

# Check for custom JWT
grep -r "jwt\|passport\|jsonwebtoken" apps --include="*.ts" -l

# Check APP_GUARD
grep -r "APP_GUARD" apps --include="*.ts" -n
```

### 2. Authorization

- [ ] Role checks via `RoleEnum` from `@repo/shared-types`?
- [ ] `MicroserviceAuthGuard` on all inter-service message handlers?
- [ ] No privilege escalation paths (e.g., user modifying their own role)?

```bash
grep -r "RoleEnum\|role.*check\|hasRole" apps --include="*.ts" -n
grep -r "MicroserviceAuthGuard" apps --include="*.ts" -n
```

### 3. Input Validation

- [ ] All HTTP endpoints use `ZodValidationPipe` (global via `SharedModule`)?
- [ ] No raw `req.body` access without validation?
- [ ] Zod v4 APIs used correctly (`z.email()` not `z.string().email()`)?
- [ ] No `any` type on controller parameters?

```bash
# Check for raw body access
grep -r "req\.body\|request\.body" apps --include="*.ts" -n | grep -v "test\|spec"

# Check for any-typed params
grep -r "@Body() body: any\|@Query() query: any" apps --include="*.ts" -n
```

### 4. Secret Handling

- [ ] No hardcoded secrets or API keys in source code?
- [ ] No `process.env` access outside `main.ts`?
- [ ] `.env` files not committed?
- [ ] `SanitizeUtil` applied in logging (prevents token leaks in logs)?

```bash
# Check for process.env outside main.ts
grep -r "process\.env" apps packages --include="*.ts" | grep -v "main.ts\|test\|spec"

# Check for hardcoded secrets
grep -rE "(password|secret|key|token)\s*=\s*['\"][^$\{]" apps --include="*.ts"
```

### 5. Injection Risks

- [ ] All database queries via Prisma (parameterized by default)?
- [ ] No raw SQL with string interpolation?
- [ ] No template literals in Mongo queries?

```bash
# Check for raw SQL
grep -r "\$queryRaw\|queryRawUnsafe\|executeRaw" apps packages --include="*.ts" -n

# Check Mongo raw queries
grep -r "\.find({.*\$where\|\.aggregate(" apps packages --include="*.ts" -n
```

### 6. HTTP Security Headers

- [ ] Helmet enabled (`useHelmet: true` in `BootstrapUtil.setup()`)?
- [ ] CORS configured with specific origin (not `*`)?
- [ ] Rate limiting active (`ThrottlerModule` in `SharedModule`)?

```bash
grep -r "useHelmet\|helmet" apps --include="*.ts" -n
grep -r "cors.*origin" apps --include="*.ts" -n
```

### 7. Error Handling

- [ ] `AllExceptionFilter` active globally?
- [ ] Error responses do not leak stack traces or internal paths?
- [ ] `RpcException` used for microservice errors (not raw `Error`)?

```bash
grep -r "AllExceptionFilter" packages/shared/src --include="*.ts" -n
grep -r "throw new Error\|throw Error" apps --include="*.ts" -n | grep -v "test\|spec"
```

### 8. Dependencies

- [ ] No known vulnerable packages?
- [ ] No legacy `bull` / `@nestjs/bull` imported (only BullMQ)?
- [ ] Auth-related packages from trusted sources?

```bash
grep -r "bullmq" apps packages --include="*.ts" -l
grep -r "passport\|jwt" package.json apps/*/package.json packages/*/package.json 2>/dev/null
```

### 9. Angular Specific

- [ ] No secrets in `environment.ts`/`environment.prod.ts` (they ship to the browser)?
- [ ] Route guards await `session.ready()` before deciding — never render protected content against a still-loading session?
- [ ] Components inject `AUTH_CLIENT`, never the vanilla `authClient` directly?
- [ ] No `[innerHTML]`/`bypassSecurityTrustHtml` on unsanitized user content?

```bash
grep -rE "SECRET|KEY|TOKEN" apps/web/src/environments -n
grep -r "bypassSecurityTrustHtml\|bypassSecurityTrustResourceUrl" apps/web/src --include="*.ts" -n
```

### 10. MongoDB Security

- [ ] MongoDB used only for logs/audit (not business data)?
- [ ] TTL indexes set on log collections (30-day)?
- [ ] No user-supplied data in MongoDB queries?

---

## Output Format

Produce a prioritized findings report:

```
## Security Audit Report

### CRITICAL (Fix immediately)
| # | Finding | Location | Risk |
|---|---------|----------|------|
| 1 | ... | file.ts:42 | ... |

### HIGH (Fix before production)
| # | Finding | Location | Risk |
|---|---------|----------|------|

### MEDIUM (Address soon)
| # | Finding | Location | Risk |
|---|---------|----------|------|

### LOW / INFORMATIONAL
| # | Finding | Location | Notes |
|---|---------|----------|-------|

### PASSED CHECKS
- ✓ All routes behind AuthGuard
- ✓ Helmet enabled on all apps
- ...
```

---

## Guardrails

- Never modify code — read only
- Never attempt to exploit vulnerabilities
- Flag false positives clearly
- Reference OWASP categories where applicable
- Tie every finding to a specific file and line number
