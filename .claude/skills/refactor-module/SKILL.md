---
name: refactor-module
description: Safely refactor a NestJS module or Angular component — extract abstractions, reduce duplication, improve naming, fix convention deviations. Follows the monorepo's patterns and validates the build after changes.
license: MIT
compatibility: NestJS + Angular monorepo
metadata:
  author: project
  version: "1.0"
---

Refactor a module, service, or component in this NestJS + Angular monorepo. Improve the code without changing behavior.

**Input**: The argument after `/refactor-module` names what to refactor. Examples:
- A module: `apps/api/src/users`
- A service: `apps/auth/src/local-auth.service.ts`
- A component: `apps/web/src/components/user-table`
- A package: `packages/shared/src/utils`

---

## Refactoring Principles

1. **No behavior changes** — refactoring must not change what the code does
2. **Follow conventions** — after refactoring, code must comply with `CLAUDE.md` and `CONVENTIONS.md`
3. **Build must pass** — run `pnpm build` and `pnpm check-types` after changes
4. **Tests must pass** — run tests for affected packages after changes

---

## Step 1: Understand the Current State

Read the target files:

```bash
# Find all files in the target
find <target-path> -name "*.ts" -o -name "*.tsx" | sort

# Read the main file
cat <target-file>
```

Identify:
- What does this module/service/component do?
- What does it depend on (imports)?
- What depends on it (who imports it)?
- Does it follow monorepo conventions?

### Convention Violations to Look For

**NestJS:**
- `process.env` outside `main.ts` → use `ConfigService.getOrThrow()`
- Hardcoded strings for queue names, event patterns → use `@repo/shared` constants
- `PrismaClient` injected directly → use `DatabaseService`
- Custom JWT/Passport logic → remove, use `better-auth`
- Legacy `bull` / `@nestjs/bull` imports → replace with `@nestjs/bullmq`
- `ZodValidationPipe` registered per-module → remove (it's global)
- Missing `SharedModule.register()` as first import in `AppModule`
- Zod v3 APIs (`.string().email()`) → update to v4 (`.email()`)

**Angular:**
- Components injecting `authClient` directly → inject `AUTH_CLIENT` instead (testing seam)
- Class-based guards → convert to functional `CanActivateFn`
- Missing `OnPush` change detection strategy
- Forms validated ad hoc → use `zodValidator(schema)` from `@repo/shared-types`

**General:**
- Files over 500 lines → split
- Duplicate code that could use existing abstractions (`BasePublisher`, `BaseProducer`)
- `console.log` → `this.logger.log()` or `this.logger.debug()`

---

## Step 2: Plan the Refactor

Before writing any code, outline:

```
Planned changes:
1. [description] — [file] — reason: [why]
2. ...

Files affected:
- [file path] — [change type: extract/rename/move/simplify]

Downstream impact:
- [files that import the changed code]
```

Get confirmation if the scope is large (> 5 files).

---

## Step 3: Execute

Make changes incrementally:
1. Rename identifiers (fix all references)
2. Move code (update imports)
3. Extract abstractions (create new files, update callers)
4. Remove duplication (consolidate)

When moving code to `packages/shared`:
- Add export to `packages/shared/src/index.ts`
- Update all importers to use `@repo/shared` import

---

## Step 4: Validate

After changes:

```bash
# Type check
pnpm check-types

# Build
pnpm build

# Tests (if they exist for this package/app)
pnpm --filter <app-or-package> test
```

Fix any errors before declaring the refactor complete.

---

## Common Refactoring Patterns

### Extract to BasePublisher

```typescript
// Before
@Injectable()
class NotificationsService {
  constructor(@Inject(SERVICES.NOTIFICATIONS) private client: ClientProxy) {}

  async publishEvent(pattern: string, data: unknown) {
    this.client.emit(pattern, data);
  }
}

// After
@Injectable()
class NotificationsPublisher extends BasePublisher {
  publishUserCreated(user: User) {
    return this.emit(EVENT_PATTERNS.USER_CREATED, { user });
  }
}
// Or just use the pre-built NotificationsPublisher from @repo/shared
```

### Extract to BaseProducer

```typescript
// Before — inline job.add() everywhere
await this.emailQueue.add('send_welcome', data, { attempts: 3, ... });

// After — extend BaseProducer
class EmailProducer extends BaseProducer {
  async sendWelcome(data: WelcomeData) {
    return this.add(JOB_PATTERNS.SEND_WELCOME_EMAIL, data);
  }
}
// Or use the pre-built EmailProducer from @repo/shared
```

### Fix Hardcoded Strings

```typescript
// Before
@Processor('email-queue')
@Process('job:send_welcome_email')

// After
@Processor(QUEUES.EMAIL)
@Process(JOB_PATTERNS.SEND_WELCOME_EMAIL)
```

### Fix Direct env Access

```typescript
// Before (anywhere outside main.ts)
const host = process.env.REDIS_HOST;

// After
constructor(private readonly config: ConfigService) {}
const host = this.config.getOrThrow<string>('REDIS_HOST');
```

---

## Guardrails

- Never change behavior — only structure and names
- Never add new features during a refactor
- Keep each change small and verifiable
- Run build + types after every significant change
- If tests don't exist and the code is complex, suggest adding them before refactoring
