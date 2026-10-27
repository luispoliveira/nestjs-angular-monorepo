import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import { AUDIT_KEY, MongoService, ROLES_KEY } from '@repo/shared';
import { RoleEnum } from '@repo/shared-types';
import { AuditEventsController } from './audit-events.controller';

describe('AuditEventsController', () => {
  let controller: AuditEventsController;
  let mongo: { findAuditEvents: jest.Mock };

  beforeEach(async () => {
    mongo = {
      findAuditEvents: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditEventsController],
      providers: [{ provide: MongoService, useValue: mongo }],
    }).compile();
    controller = module.get(AuditEventsController);
  });

  describe('metadata', () => {
    const proto = AuditEventsController.prototype;

    it('is admin only', () => {
      expect(Reflect.getMetadata(ROLES_KEY, proto.list)).toEqual([
        RoleEnum.ADMIN,
      ]);
    });

    it('is read-only: the single handler is a GET, and there is no other route', () => {
      expect(Reflect.getMetadata(METHOD_METADATA, proto.list)).toBe(
        RequestMethod.GET,
      );
      const handlers = Object.getOwnPropertyNames(proto).filter(
        (n) => n !== 'constructor',
      );
      expect(handlers).toEqual(['list']);
    });

    it('does not audit its own reads', () => {
      expect(Reflect.getMetadata(AUDIT_KEY, proto.list)).toBeUndefined();
    });
  });

  describe('list', () => {
    it('passes the filters, skip and take to the store and returns the paginated shape', async () => {
      const from = new Date('2026-01-01T00:00:00.000Z');
      mongo.findAuditEvents.mockResolvedValue({
        items: [{ id: 'e1' }],
        total: 41,
      });

      const result = await controller.list({
        skip: 20,
        take: 20,
        actorId: 'u1',
        outcome: 'failure',
        from,
      } as never);

      expect(mongo.findAuditEvents).toHaveBeenCalledWith(
        { actorId: 'u1', outcome: 'failure', from },
        20,
        20,
      );
      expect(result).toEqual({
        items: [{ id: 'e1' }],
        meta: { total: 41, totalPages: 3, page: 2, pageSize: 20 },
      });
    });

    it('works without any filter', async () => {
      await controller.list({ skip: 0, take: 20 });

      expect(mongo.findAuditEvents).toHaveBeenCalledWith({}, 0, 20);
    });
  });
});
