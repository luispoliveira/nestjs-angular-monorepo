---
name: "Performance Audit"
description: "Performance audit — identifies N+1 queries, missing indexes, unbounded queues, and Redis cache opportunities."
category: Performance
tags: [performance, audit, database, queues, caching]
---

Audit this NestJS + Angular monorepo for performance issues.

**Input**: Optional scope — e.g., `apps/api/src/users`, or leave blank for full codebase.

## Audit Areas

- **N+1 queries**: loops calling DatabaseService once per item
- **Missing includes**: related entities fetched in a second query
- **Missing select**: fetching entire models when only a few fields needed
- **Missing indexes**: fields in where/orderBy without @@index in Prisma schema
- **Missing pagination**: findMany without skip/take
- **Queue config**: jobs missing removeOnFail (unbounded Redis growth)
- **Cache opportunities**: repeated identical DB queries per request
- **Angular**: missing `OnPush`, methods called in templates, missing `track` on `@for` loops

## Output Format

Findings grouped by severity: CRITICAL → HIGH → MEDIUM.
Every finding includes file path + line, issue, estimated impact, and exact fix.
End with quick wins list and summary scorecard.

**Do not modify code — read only.**
