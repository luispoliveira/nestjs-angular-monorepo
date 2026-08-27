---
name: "Review Security"
description: "Security audit — checks authentication, authorization, input validation, secret handling, injection risks, and OWASP Top 10 concerns."
category: Security
tags: [security, audit, vulnerability, owasp]
---

Perform a security audit of this NestJS + Angular monorepo.

**Input**: Optional scope — e.g., `apps/auth`, `apps/api`, or leave blank for full codebase.

## Audit Checklist

- **Authentication**: AuthGuard as APP_GUARD, @Public() only on public routes, no custom JWT
- **Authorization**: Role checks via RoleEnum, MicroserviceAuthGuard on cross-service handlers
- **Input validation**: ZodValidationPipe global, no raw req.body, Zod v4 APIs
- **Secret handling**: No process.env outside main.ts, no hardcoded secrets
- **Injection**: All DB via Prisma (parameterized), no $queryRawUnsafe with user input
- **HTTP security**: Helmet enabled, CORS with specific origin, ThrottlerModule active
- **Error handling**: AllExceptionFilter active, no stack traces in responses
- **Dependencies**: BullMQ (not legacy Bull v4/`@nestjs/bull`), no known-vulnerable auth packages
- **Angular**: No secrets in `environment.ts`, session read via `SessionService`/`AUTH_CLIENT` — never trust it without server-side re-validation
- **MongoDB**: Logs/audit only, TTL indexes set

## Output Format

Findings grouped by severity: CRITICAL → HIGH → MEDIUM → LOW.
Every finding includes: file path + line, issue, risk, and exact fix.
End with summary scorecard and list of passed checks.

**Do not modify code or exploit vulnerabilities — read only.**
