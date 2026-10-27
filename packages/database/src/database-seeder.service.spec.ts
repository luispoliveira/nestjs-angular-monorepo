jest.mock('../generated/prisma/client', () => ({
  PrismaClient: class MockPrismaClient {
    $connect = jest.fn().mockResolvedValue(undefined);
    $disconnect = jest.fn().mockResolvedValue(undefined);
    constructor(_opts?: unknown) {}
  },
}));

jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation(() => ({})),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseSeederService } from './database-seeder.service';
import { DatabaseService } from './database.service';

describe('DatabaseSeederService', () => {
  let service: DatabaseSeederService;

  beforeEach(async () => {
    const mockDatabaseService = {
      getOrThrow: jest.fn(),
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseSeederService,
        { provide: DatabaseService, useValue: mockDatabaseService },
      ],
    }).compile();

    service = module.get<DatabaseSeederService>(DatabaseSeederService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should complete onModuleInit without errors', async () => {
    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  describe('retry', () => {
    // Retries wait attempt * 500 ms; fake timers keep the spec instant.
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    const run = async (seed: jest.Mock) => {
      (service as unknown as { seed: () => Promise<void> }).seed = seed;
      const warn = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);
      const promise = service.onModuleInit();
      // Attach the rejection handler before advancing timers.
      const settled = promise.then(
        () => undefined,
        (error: unknown) => error,
      );
      await jest.runAllTimersAsync();
      return { error: await settled, warn };
    };

    it('should retry the whole run once and log one warning when the first attempt fails', async () => {
      const seed = jest
        .fn()
        .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
        .mockResolvedValueOnce(undefined);
      const { error, warn } = await run(seed);
      expect(error).toBeUndefined();
      expect(seed).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toContain('attempt 1/3');
    });

    it('should raise the last error when all 3 attempts fail', async () => {
      const seed = jest
        .fn()
        .mockRejectedValueOnce(new Error('first'))
        .mockRejectedValueOnce(new Error('second'))
        .mockRejectedValueOnce(new Error('third'));
      const { error } = await run(seed);
      expect(seed).toHaveBeenCalledTimes(3);
      expect((error as Error).message).toBe('third');
    });
  });
});
