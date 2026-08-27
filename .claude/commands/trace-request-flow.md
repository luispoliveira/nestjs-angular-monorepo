---
name: "Trace Request Flow"
description: "Trace the complete lifecycle of an HTTP request or event through the system — from entrypoint to database and back."
category: Analysis
tags: [trace, request, flow, debug]
---

Trace a request through this NestJS + Angular monorepo. Follow the code from entry to persistence and back.

**Input**: What to trace. Examples:
- An HTTP route: `POST /api/auth/sign-in/email`
- An event: `user:created`
- A REST endpoint: `GET /api/users/:id`
- A job: `job:send_welcome_email`
- A description: "user registration flow"

## Trace Steps

1. **Find the entry point** — grep for controller/handler/processor
2. **Trace the middleware chain** — Guards → Interceptors → Pipes → Controller → Service → DB
3. **Follow service calls** — constructor injections, DB queries
4. **Map side effects** — Redis events emitted, Bull jobs queued, MongoDB writes
5. **Trace the response** — return shape, status code, serializer applied

## Output Format

```
REQUEST: <method> <path>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Step 1: Guard — <file>:<line>
Step 2: Pipe — <file>:<line>
Step 3: Controller — <file>:<line>
Step 4: Service — <file>:<line>
Step 5: Database — <model>
Step 6: Side effect — <event/job>
Step 7: Response — <shape> → <status>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOTAL PATH: N hops, M services, K DB queries
```

Flag any missing middleware, security gaps, or performance concerns.
