---
name: dependency-map
description: Map all module and package dependencies in the monorepo — internal packages, NestJS module imports, and cross-service communication. Produces a dependency graph with circular dependency detection.
license: MIT
compatibility: NestJS + Angular monorepo
metadata:
  author: project
  version: "1.0"
---

Map dependencies across this NestJS + Angular monorepo. Identify internal package usage, module imports, and cross-service communication channels.

**Do not modify anything.** This is a read-only analysis.

---

## Mapping Steps

### 1. Internal Package Dependencies

```bash
# Check which apps depend on which packages
for pkg in database shared shared-types mail; do
  echo "=== @repo/$pkg ==="
  grep -r "\"@repo/$pkg\"" apps packages --include="package.json" -l
done
```

Build a matrix: app/package → which `@repo/*` packages it imports.

### 2. NestJS Module Import Graph

For each NestJS app, trace the module tree:

```bash
# Find all module files
find apps packages -name "*.module.ts" | grep -v node_modules | sort

# For each module, extract imports
grep -A 20 "imports:\s*\[" apps/auth/src/app.module.ts
```

Check:
- Does `SharedModule.register()` appear first?
- Which feature modules are imported?
- Are there circular module dependencies?

### 3. Cross-Service Communication

```bash
# Who emits events?
grep -r "NotificationsPublisher\|emit\|publish" apps --include="*.ts" -n | grep -v "import\|test"

# Who listens to events?
grep -r "@EventPattern" apps --include="*.ts" -n

# Who sends messages?
grep -r "send\|sendMessage\|ClientProxy" apps --include="*.ts" -n | grep -v "import\|test"

# Who handles messages?
grep -r "@MessagePattern" apps --include="*.ts" -n
```

### 4. Package Export Analysis

For each internal package, check what it exports:

```bash
cat packages/shared/src/index.ts
cat packages/database/src/index.ts
cat packages/shared-types/src/index.ts
cat packages/mail/src/index.ts
```

Flag unexported internal modules that are imported directly (bypasses the package API).

### 5. External Dependency Audit

```bash
# Check for duplicate/conflicting deps
cat pnpm-workspace.yaml
cat package.json | grep dependencies -A 50

# Check for version mismatches
grep -r "\"bull\"\|\"bullmq\"" apps packages --include="package.json"
grep -r "\"zod\"" apps packages --include="package.json"
```

### 6. Circular Dependency Detection

```bash
# Look for potential circular imports in shared
grep -r "from '@repo/shared'" packages/database --include="*.ts"
grep -r "from '@repo/database'" packages/shared --include="*.ts"
```

Check the rules from `DEPENDENCY_GRAPH.md`:
- Apps MUST NOT import from other apps
- `@repo/shared-types` must have zero internal dependencies

---

## Output Format

```
## Dependency Map

### Internal Package Usage Matrix

|                 | @repo/database | @repo/shared | @repo/shared-types | @repo/mail |
|-----------------|:--------------:|:------------:|:------------------:|:----------:|
| apps/auth       | ✓              | ✓            | ✓                  |            |
| apps/api        | ✓              | ✓            | ✓                  |            |
| apps/notifications |             | ✓            | ✓                  |            |
| apps/worker     |               | ✓            |                    | ✓          |
| apps/web        |               |              | ✓                  |            |
| @repo/shared    | ✓              |              |                    |            |

### Cross-Service Communication

Event flows:
  apps/auth → [user:created] → apps/notifications → [job:send_welcome_email] → apps/worker

Message flows:
  apps/api → [auth:authenticate] → apps/auth

### Dependency Rule Violations
- ⚠ None found / [list violations]

### Circular Dependencies
- ✓ None detected / [list cycles]

### External Dependency Concerns
- ✓ BullMQ used everywhere (no legacy Bull v4 / `@nestjs/bull`) / [list violations]
- ✓ Zod v4 consistent / [list mismatches]
```

---

## Reference Documents

- `DEPENDENCY_GRAPH.md` — existing dependency map (compare and offer to update)
- `CLAUDE.md` — dependency rules

---

## Guardrails

- Never modify files — read only
- Flag any violation of the dependency rules in `DEPENDENCY_GRAPH.md`
- Offer to update `DEPENDENCY_GRAPH.md` if the map is stale
