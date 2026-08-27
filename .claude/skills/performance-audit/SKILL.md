---
name: performance-audit
description: Performance audit of the codebase — identifies N+1 queries, missing indexes, slow queue jobs, unoptimized data access patterns, and Redis cache opportunities. Produces a prioritized report.
license: MIT
compatibility: NestJS + Angular monorepo
metadata:
  author: project
  version: "1.0"
---

Audit this NestJS + Angular monorepo for performance issues. Focus on database access patterns, queue configuration, caching, and response size.

**Do not modify anything.** This is a read-only analysis.

---

## Audit Areas

### 1. Database — N+1 Queries

The most common performance killer. Look for loops with database calls inside:

```bash
# Find potential N+1 patterns (db call inside loop)
grep -r "for.*await.*this\.db\|forEach.*await.*this\.db\|map.*await.*this\.db" apps --include="*.ts" -n

# Find missing 'include' on relations
grep -r "this\.db\.\w*\.findMany\|this\.db\.\w*\.findFirst" apps --include="*.ts" -n
```

For each `findMany`, check:
- Are related entities fetched in a loop? → N+1
- Should they be included with `include: { ... }`?
- Is a `select` clause limiting fields returned?

### 2. Database — Missing Indexes

```bash
# Check schema for @index annotations
grep -r "@@index\|@index" packages/database/prisma --include="*.prisma" -n

# Find columns used in where clauses that may lack indexes
grep -r "where:.*{" apps --include="*.ts" -n
```

For each field used in `where`, `orderBy`, or `cursor`, verify a `@@index` exists in the schema.

### 3. Pagination

```bash
# Find queries without pagination
grep -r "findMany(" apps --include="*.ts" -n | grep -v "take\|skip"

# Verify PaginatedUtil usage
grep -r "PaginatedUtil\|paginationSchema" apps --include="*.ts" -n
```

- Every `findMany` on a potentially large collection should have `skip` + `take`
- `take` should be capped (max 100 via `paginationSchema`)

### 4. Bull Queue Configuration

```bash
# Check job options
grep -r "attempts\|backoff\|removeOnComplete\|removeOnFail" apps --include="*.ts" -n

# Check for unbounded queues
grep -r "removeOnFail\|removeOnComplete" apps --include="*.ts" -n
```

Required job options (per CLAUDE.md):
- `attempts: 3`
- `backoff: { type: 'exponential', delay: 2000 }`
- `removeOnComplete: true`
- `removeOnFail: 500`

Missing `removeOnFail` → unbounded Redis memory growth.

### 5. Redis — Cache Opportunities

```bash
# Check for repeated identical DB queries
grep -r "this\.db\." apps --include="*.ts" -n | sort | uniq -c | sort -rn | head -20
```

Look for:
- Repeated lookups by ID (user by ID on every request)
- Static/slow-changing data (config, roles) fetched per request
- Session data fetched multiple times per request

### 6. HTTP Response Size

```bash
# Check for missing select clauses (fetching entire models)
grep -r "findMany({\s*where\|findFirst({\s*where\|findUnique({\s*where" apps --include="*.ts" -n | grep -v "select"
```

Always use `select` to return only needed fields — especially on list endpoints.

### 7. Angular Performance

```bash
# Check for components missing OnPush
grep -rL "ChangeDetectionStrategy.OnPush" apps/web/src/app --include="*.ts" | grep -v "\.spec\.ts"

# Check for method calls in templates (recompute every change-detection cycle)
grep -rn "{{ *this\.\|(click)=\"this\." apps/web/src/app --include="*.html"

# Check for missing track in @for loops
grep -rn "@for" apps/web/src/app --include="*.html" | grep -v "track "
```

- Prefer `OnPush` + signals over default change detection
- Avoid calling methods in templates — use a signal or `computed()` instead
- Every `@for` needs a `track` expression to avoid full-list re-renders
- Check TanStack Angular Query `staleTime` on queries that rarely change

### 8. Logging Overhead

```bash
# Check logging in hot paths
grep -r "this\.logger\.\|console\.\|Logger\." apps --include="*.ts" -n | grep -v "error\|warn"
```

- Debug/verbose logging in hot paths (health checks, frequent events) → overhead
- Verify health check paths are silenced (`/health`, `/metrics` in pino config)

### 9. Throttling Configuration

```bash
grep -r "ThrottlerModule\|ttl\|limit" packages/shared/src --include="*.ts" -n
```

Default: 10 req / 60s per IP. Evaluate if this is appropriate for each endpoint type.

---

## Output Format

```
## Performance Audit Report

### CRITICAL (Blocking production scale)
| # | Issue | Location | Estimated Impact |
|---|-------|----------|-----------------|
| 1 | N+1 on user.findMany (relations loaded in loop) | apps/api/src/users.service.ts:45 | O(n) queries |

### HIGH (Address soon)
| # | Issue | Location | Recommendation |
|---|-------|----------|---------------|

### MEDIUM (Optimization opportunity)
| # | Issue | Location | Recommendation |
|---|-------|----------|---------------|

### PASSED CHECKS
- ✓ All findMany calls paginated
- ✓ removeOnFail set on all queue jobs
- ...

### Quick Wins
- [ ] Add `include` to users.findMany at users.service.ts:45
- [ ] Cache config lookup at config.service.ts:23 (changes rarely)
```

---

## Guardrails

- Never modify code — read only
- Estimate query count impact where possible (O(1) vs O(n))
- Distinguish between "will cause issues at scale" vs "already causing issues"
- Reference specific file paths and line numbers for every finding
