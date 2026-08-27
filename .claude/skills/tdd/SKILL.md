---
name: tdd
description: Test-driven development guide for this monorepo — write tests before implementation, following the project's testing stack (Jest, nestjs testing utilities). Covers unit, integration, and e2e test patterns.
license: MIT
compatibility: NestJS + Angular monorepo
metadata:
  author: project
  version: "1.0"
---

Apply test-driven development in this NestJS + Angular monorepo. Write tests first, then implement the minimum code to make them pass.

**Input**: The argument after `/tdd` describes what to implement. Examples:
- `users.getUser — returns user by ID, throws 404 if not found`
- `EmailConsumer.sendWelcomeEmail — processes job and sends via MailModule`
- `AuthController.authenticate — validates token, returns user`

---

## Testing Stack

| Layer | Tool | Command |
|-------|------|---------|
| Unit tests | Jest + `@nestjs/testing` | `pnpm --filter <pkg> test` |
| Integration | Jest + real DB | `pnpm --filter <pkg> test` |
| Type checking | TypeScript | `pnpm check-types` |
| Coverage | Jest `--coverage` | `pnpm --filter <pkg> test -- --coverage` |

Test files live alongside source: `*.spec.ts` (unit) or `*.e2e-spec.ts` (e2e).

---

## TDD Cycle

```
1. RED   → Write a failing test
2. GREEN → Write minimum code to pass
3. REFACTOR → Clean up without breaking tests
```

---

## Step 1: Write the Test First

### Unit Test (Service/Producer/Publisher)

```typescript
// apps/api/src/users/users.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { DatabaseService } from '@repo/database';

describe('UsersService', () => {
  let service: UsersService;
  let db: jest.Mocked<DatabaseService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: DatabaseService,
          useValue: {
            user: {
              findUnique: jest.fn(),
              findMany: jest.fn(),
              count: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get(UsersService);
    db = module.get(DatabaseService);
  });

  describe('getUser', () => {
    it('returns user when found', async () => {
      const user = { id: '1', email: 'test@example.com', deletedAt: null };
      db.user.findUnique.mockResolvedValue(user);

      const result = await service.getUser('1');

      expect(result).toEqual(user);
      expect(db.user.findUnique).toHaveBeenCalledWith({
        where: { id: '1', deletedAt: null },
      });
    });

    it('throws NotFoundException when user not found', async () => {
      db.user.findUnique.mockResolvedValue(null);

      await expect(service.getUser('999')).rejects.toThrow(NotFoundException);
    });
  });
});
```

### Controller Test

```typescript
// apps/api/src/users/users.controller.spec.ts
import { Test } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  let service: jest.Mocked<UsersService>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: { getUser: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get(UsersController);
    service = module.get(UsersService);
  });

  it('returns user from service', async () => {
    const user = { id: '1', email: 'test@example.com' };
    service.getUser.mockResolvedValue(user);

    expect(await controller.getUser('1')).toEqual(user);
  });
});
```

### Queue Consumer Test

```typescript
// apps/worker/src/consumer/email.consumer.spec.ts
import { Test } from '@nestjs/testing';
import { EmailConsumer } from './email.consumer';
import { MailService } from '@repo/mail';

describe('EmailConsumer', () => {
  let consumer: EmailConsumer;
  let mailService: jest.Mocked<MailService>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        EmailConsumer,
        { provide: MailService, useValue: { sendWelcome: jest.fn() } },
      ],
    }).compile();

    consumer = module.get(EmailConsumer);
    mailService = module.get(MailService);
  });

  it('calls mailService.sendWelcome with job data', async () => {
    const job = { data: { to: 'user@test.com', name: 'Alice' } } as any;
    mailService.sendWelcome.mockResolvedValue(undefined);

    await consumer.sendWelcomeEmail(job);

    expect(mailService.sendWelcome).toHaveBeenCalledWith(job.data);
  });

  it('does not swallow errors', async () => {
    const job = { data: { to: 'bad@test.com' } } as any;
    mailService.sendWelcome.mockRejectedValue(new Error('SMTP error'));

    await expect(consumer.sendWelcomeEmail(job)).rejects.toThrow('SMTP error');
  });
});
```

---

## Step 2: Run and See It Fail

```bash
pnpm --filter <app-name> test --watch
```

The test should fail with a meaningful error (class not found, method not implemented, etc.).

---

## Step 3: Write Minimum Implementation

Write only what's needed to make the test pass:

```typescript
// users.service.ts — minimum implementation
@Injectable()
export class UsersService {
  constructor(private readonly db: DatabaseService) {}

  async getUser(id: string) {
    const user = await this.db.user.findUnique({
      where: { id, deletedAt: null },
    });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }
}
```

---

## Step 4: Refactor

Once tests are green:
- Extract constants to `@repo/shared` if reusable
- Add `@ApiOperation`, `@ApiResponse` decorators for Swagger
- Ensure Zod DTO is used for validation

---

## What to Test vs Not Test

**Test:**
- Service business logic (happy path + error cases)
- Controller parameter extraction and response shaping
- Consumer error handling and retry logic
- Publisher event emission
- Validator/DTO schema edge cases

**Do NOT test:**
- NestJS framework behavior (guards, pipes, interceptors) — they're tested by the framework
- Prisma itself — mock `DatabaseService`
- better-auth internals — mock `AuthService`
- External APIs (Brevo, Google OAuth)

---

## Guardrails

- Always write the test before the implementation (the TDD discipline)
- Mock only what crosses a module boundary (external services, DB)
- Never mock `ConfigService` — use `Test.createTestingModule` with real `ConfigModule` or stub
- Run `pnpm check-types` after adding test files
- Keep test files co-located with source (`.spec.ts` in same directory)
