import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService, Prisma } from '@repo/database';
import { EncryptionService } from '@repo/shared';
import { CustomersService } from './customers.service';

/**
 * Unit tests for CustomersService with mocked DatabaseService and
 * EncryptionService. Real Postgres behaviour (partial unique index,
 * concurrency, insensitive search) is covered by
 * test/customers.integration.ts.
 */
const NOW = new Date('2026-10-10T10:00:00.000Z');

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    name: 'Ana Silva',
    email: 'ana@example.com',
    notes: null,
    taxIdEncrypted: 'enc(123456789)',
    taxIdHash: 'hash(123456789)',
    ...overrides,
  };
}

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('CustomersService', () => {
  let service: CustomersService;
  let db: {
    customer: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let encryption: {
    encrypt: jest.Mock;
    decrypt: jest.Mock;
    blindIndex: jest.Mock;
  };

  beforeEach(async () => {
    db = {
      customer: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    encryption = {
      encrypt: jest.fn((v: string) => `enc(${v})`),
      decrypt: jest.fn((v: string) => v.slice(4, -1)),
      blindIndex: jest.fn((v: string) => `hash(${v})`),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: DatabaseService, useValue: db },
        { provide: EncryptionService, useValue: encryption },
      ],
    }).compile();

    service = module.get(CustomersService);
  });

  describe('create', () => {
    it('encrypts and blind-indexes taxId, and returns the decrypted value', async () => {
      db.customer.create.mockResolvedValue(row());

      const result = await service.create({
        name: 'Ana Silva',
        email: 'ana@example.com',
        taxId: '123456789',
      });

      expect(db.customer.create).toHaveBeenCalledWith({
        data: {
          name: 'Ana Silva',
          email: 'ana@example.com',
          notes: undefined,
          taxIdEncrypted: 'enc(123456789)',
          taxIdHash: 'hash(123456789)',
        },
      });
      expect(result.taxId).toBe('123456789');
    });

    it('stores no taxId columns when taxId is absent', async () => {
      db.customer.create.mockResolvedValue(
        row({ taxIdEncrypted: null, taxIdHash: null }),
      );

      const result = await service.create({ name: 'Ana Silva' });

      const data = db.customer.create.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('taxIdEncrypted');
      expect(data).not.toHaveProperty('taxIdHash');
      expect(encryption.encrypt).not.toHaveBeenCalled();
      expect(result.taxId).toBeNull();
    });

    it('maps a unique violation (P2002) to ConflictException', async () => {
      db.customer.create.mockRejectedValue(p2002());

      await expect(
        service.create({ name: 'Ana', taxId: '123456789' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rethrows other errors untouched', async () => {
      const boom = new Error('boom');
      db.customer.create.mockRejectedValue(boom);

      await expect(service.create({ name: 'Ana' })).rejects.toBe(boom);
    });
  });

  describe('findOne', () => {
    it('only looks up non-deleted customers', async () => {
      db.customer.findFirst.mockResolvedValue(row());

      await service.findOne('c1');

      expect(db.customer.findFirst).toHaveBeenCalledWith({
        where: { id: 'c1', deletedAt: null },
      });
    });

    it('throws NotFoundException for a missing or deleted customer', async () => {
      db.customer.findFirst.mockResolvedValue(null);

      await expect(service.findOne('gone')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('never exposes the encrypted or hashed columns', async () => {
      db.customer.findFirst.mockResolvedValue(row());

      const result = await service.findOne('c1');

      expect(result).toEqual({
        id: 'c1',
        name: 'Ana Silva',
        email: 'ana@example.com',
        taxId: '123456789',
        notes: null,
        createdAt: NOW,
        updatedAt: NOW,
      });
    });
  });

  describe('update', () => {
    beforeEach(() => {
      db.customer.updateMany.mockResolvedValue({ count: 1 });
      db.customer.findFirst.mockResolvedValue(row());
    });

    it('clears both taxId columns when taxId is null', async () => {
      await service.update('c1', { taxId: null });

      expect(db.customer.updateMany).toHaveBeenCalledWith({
        where: { id: 'c1', deletedAt: null },
        data: { taxIdEncrypted: null, taxIdHash: null },
      });
    });

    it('re-encrypts when taxId is a new value', async () => {
      await service.update('c1', { taxId: '999999990' });

      expect(db.customer.updateMany.mock.calls[0][0].data).toEqual({
        taxIdEncrypted: 'enc(999999990)',
        taxIdHash: 'hash(999999990)',
      });
    });

    it('leaves taxId columns untouched when taxId is omitted', async () => {
      await service.update('c1', { name: 'New name' });

      expect(db.customer.updateMany.mock.calls[0][0].data).toEqual({
        name: 'New name',
      });
    });

    it('returns the re-read customer', async () => {
      db.customer.findFirst.mockResolvedValue(row({ name: 'New name' }));

      const result = await service.update('c1', { name: 'New name' });

      expect(result.name).toBe('New name');
    });

    it('throws NotFoundException when no active row matched', async () => {
      db.customer.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.update('gone', { name: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('maps a unique violation (P2002) to ConflictException', async () => {
      db.customer.updateMany.mockRejectedValue(p2002());

      await expect(
        service.update('c1', { taxId: '123456789' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('remove', () => {
    it('soft deletes an active customer', async () => {
      db.customer.updateMany.mockResolvedValue({ count: 1 });

      await service.remove('c1');

      expect(db.customer.updateMany).toHaveBeenCalledWith({
        where: { id: 'c1', deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('throws NotFoundException when already deleted or missing', async () => {
      db.customer.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.remove('gone')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('list', () => {
    const baseQuery = {
      skip: 0,
      take: 20,
      sortBy: 'createdAt' as const,
      sortOrder: 'desc' as const,
    };

    beforeEach(() => {
      db.customer.findMany.mockResolvedValue([row()]);
      db.customer.count.mockResolvedValue(1);
    });

    it('filters deleted rows, paginates, sorts, and returns { items, meta }', async () => {
      const result = await service.list(baseQuery);

      expect(db.customer.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
      });
      expect(db.customer.count).toHaveBeenCalledWith({
        where: { deletedAt: null },
      });
      expect(db.$transaction).toHaveBeenCalled();
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.taxId).toBe('123456789');
      expect(result.items[0]).not.toHaveProperty('taxIdHash');
      expect(result.meta.total).toBe(1);
    });

    it('ignores a blank search term', async () => {
      await service.list({ ...baseQuery, search: '' });

      expect(db.customer.findMany.mock.calls[0][0].where).toEqual({
        deletedAt: null,
      });
    });

    it('searches name and email case-insensitively for a non-NIF term', async () => {
      await service.list({ ...baseQuery, search: 'silva' });

      expect(db.customer.findMany.mock.calls[0][0].where).toEqual({
        deletedAt: null,
        OR: [
          { name: { contains: 'silva', mode: 'insensitive' } },
          { email: { contains: 'silva', mode: 'insensitive' } },
        ],
      });
      expect(encryption.blindIndex).not.toHaveBeenCalled();
    });

    it('adds an exact blind-index match when the term is a valid NIF', async () => {
      await service.list({ ...baseQuery, search: 'PT 123 456 789' });

      expect(encryption.blindIndex).toHaveBeenCalledWith('123456789');
      expect(db.customer.findMany.mock.calls[0][0].where.OR).toContainEqual({
        taxIdHash: 'hash(123456789)',
      });
    });

    it('does not add a blind-index match for a partial NIF', async () => {
      await service.list({ ...baseQuery, search: '12345' });

      expect(encryption.blindIndex).not.toHaveBeenCalled();
      expect(db.customer.findMany.mock.calls[0][0].where.OR).toHaveLength(2);
    });
  });
});
