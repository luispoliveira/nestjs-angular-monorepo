---
name: "TDD"
description: "Test-driven development — write tests first, then implement. Covers unit tests for NestJS services, controllers, consumers, and producers."
category: Testing
tags: [tdd, testing, jest, unit-test, tdd-cycle]
---

Apply test-driven development in this NestJS + Angular monorepo.

**Input**: What to implement. Examples:
- `users.getUser — returns user by ID, throws 404 if not found`
- `EmailConsumer.sendWelcomeEmail — processes job and sends via MailModule`
- `NotificationsPublisher.emitUserCreated — emits user:created event`

## TDD Cycle

```
RED   → Write a failing test
GREEN → Write minimum code to pass
REFACTOR → Clean up without breaking tests
```

## Testing Stack

- **Framework**: Jest + `@nestjs/testing`
- **Test files**: `*.spec.ts` co-located with source
- **Run**: `pnpm --filter <app-or-package> test`
- **Watch**: `pnpm --filter <app-or-package> test -- --watch`
- **Coverage**: `pnpm --filter <app-or-package> test -- --coverage`

## What to Mock vs Not

**Mock** (crosses module boundary):
- `DatabaseService` — use `jest.fn()` on methods
- `MailService` — use `jest.fn()` on send methods
- `ClientProxy` (Redis client) — mock `.emit()` and `.send()`

**Do NOT mock**:
- NestJS framework internals (guards, pipes — tested by framework)
- `ConfigModule` — use real module in tests or stub values

## Test Pattern (Service)

```typescript
describe('UsersService', () => {
  let service: UsersService;
  let db: jest.Mocked<DatabaseService>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: DatabaseService, useValue: { user: { findUnique: jest.fn() } } },
      ],
    }).compile();
    service = module.get(UsersService);
    db = module.get(DatabaseService);
  });

  it('throws NotFoundException when not found', async () => {
    db.user.findUnique.mockResolvedValue(null);
    await expect(service.getUser('999')).rejects.toThrow(NotFoundException);
  });
});
```

Write the test first, run it (RED), then implement (GREEN), then clean up (REFACTOR).
