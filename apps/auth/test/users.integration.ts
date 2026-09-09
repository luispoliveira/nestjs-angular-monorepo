import { jest } from '@jest/globals';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseModule, DatabaseService } from '@repo/database';
import { MongoService } from '@repo/shared';
import {
  TEST_PASSWORD,
  createSession,
  createUser,
  truncateDatabase,
} from '@repo/testing-utils';
import * as crypto from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(crypto.scrypt);

describe('testing-utils — users integration', () => {
  let module: TestingModule;
  let db: DatabaseService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env.test',
        }),
        DatabaseModule,
      ],
      providers: [
        {
          provide: MongoService,
          useValue: {
            createLog: jest.fn(),
            updateLog: jest.fn(),
            createEmailLog: jest.fn(),
            updateEmailLog: jest.fn(),
          },
        },
      ],
    }).compile();

    db = module.get(DatabaseService);
    await module.init();
  });

  afterEach(async () => {
    await truncateDatabase(db);
  });

  afterAll(async () => {
    await module.close();
  });

  describe('createUser()', () => {
    it('produces a user with expected default shape', async () => {
      const user = await createUser(db);

      const found = await db.user.findUniqueOrThrow({
        where: { id: user.id },
      });

      expect(found.role).toBe('user');
      expect(found.emailVerified).toBe(false);
      expect(found.email).toBeTruthy();
      expect(found.name).toBeTruthy();
    });

    it('applies role override', async () => {
      const user = await createUser(db, { role: 'admin' });

      const found = await db.user.findUniqueOrThrow({
        where: { id: user.id },
      });

      expect(found.role).toBe('admin');
    });

    it('throws a unique constraint error on duplicate email', async () => {
      const email = 'dup@example.com';
      await createUser(db, { email });

      await expect(createUser(db, { email })).rejects.toThrow();
    });

    it('stores a valid scrypt hash that matches TEST_PASSWORD', async () => {
      const user = await createUser(db);

      const account = await db.account.findFirstOrThrow({
        where: { userId: user.id, providerId: 'credential' },
      });

      expect(account.password).toBeTruthy();

      // Format: "${salt}:${hex(key)}" — matches better-auth's scrypt format
      const [salt, hashedPart] = account.password!.split(':');
      const derived = (await scryptAsync(
        TEST_PASSWORD.normalize('NFKC'),
        salt,
        64,
        { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 },
      )) as Buffer;
      expect(derived.toString('hex')).toBe(hashedPart);
    });
  });

  describe('createSession()', () => {
    it('creates a session with a future expiresAt linked to the user', async () => {
      const user = await createUser(db);
      const session = await createSession(db, user.id);

      const found = await db.session.findUniqueOrThrow({
        where: { id: session.id },
      });

      expect(found.userId).toBe(user.id);
      expect(found.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(found.token).toBeTruthy();
    });
  });

  describe('truncateDatabase()', () => {
    it('removes all rows after users and sessions are created', async () => {
      const user = await createUser(db);
      await createSession(db, user.id);

      await truncateDatabase(db);

      const userCount = await db.user.count();
      const sessionCount = await db.session.count();
      const verificationCount = await db.verification.count();

      expect(userCount).toBe(0);
      expect(sessionCount).toBe(0);
      expect(verificationCount).toBe(0);
    });

    it('is safe on an empty database', async () => {
      await expect(truncateDatabase(db)).resolves.not.toThrow();
    });
  });
});
