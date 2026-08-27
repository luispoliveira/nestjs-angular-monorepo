---
name: "Find Entrypoints"
description: "Find all system entry points — HTTP routes, microservice patterns, Bull jobs, and health endpoints."
category: Analysis
tags: [entrypoints, routes, api, analysis]
---

Discover all entry points in this NestJS + Angular monorepo.

**Input**: Optional filter — e.g., `apps/auth`, `http`, `events`, `jobs`, or leave blank for all.

## Discovery Scope

- **HTTP routes**: @Controller, @Get, @Post, @Put, @Delete, @Patch in all apps
- **better-auth routes**: auto-mounted at /api/auth/* (sign-in, sign-up, OAuth, 2FA, admin)
- **Redis message patterns**: @MessagePattern (request/response) handlers
- **Redis event patterns**: @EventPattern (fire-and-forget) handlers
- **Bull jobs**: @Processor + @Process handlers in apps/worker
- **Health endpoints**: GET /health/live and /health/ready (global via SharedModule)
- **Angular routes**: route definitions in `app.routes.ts` and their lazy-loaded standalone components

## Output Format

Tables grouped by service with columns: Method/Type, Path/Pattern, Auth required, File reference.

Compare against ENTRYPOINTS.md and offer to update if gaps found.

**Do not modify code — read only.**
