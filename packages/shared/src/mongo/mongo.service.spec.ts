import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { EmailLog } from './schema/email-log.schema';
import { AuditEvent } from './schema/audit-event.schema';
import { Log } from './schema/log.schema';
import { MongoService } from './mongo.service';

describe('MongoService', () => {
  let service: MongoService;

  const mockSave = jest.fn();
  const mockExec = jest.fn();
  const mockFindByIdAndUpdate = jest.fn().mockReturnValue({ exec: mockExec });

  function createModelMock() {
    const ctor = jest.fn().mockReturnValue({ save: mockSave });
    (ctor as unknown as Record<string, jest.Mock>).findByIdAndUpdate = mockFindByIdAndUpdate;
    return ctor;
  }

  const mockLean = jest.fn();
  const mockLimit = jest.fn().mockReturnValue({ lean: () => ({ exec: mockLean }) });
  const mockSkip = jest.fn().mockReturnValue({ limit: mockLimit });
  const mockSort = jest.fn().mockReturnValue({ skip: mockSkip });
  const mockFind = jest.fn().mockReturnValue({ sort: mockSort });
  const mockCountExec = jest.fn();
  const mockCountDocuments = jest.fn().mockReturnValue({ exec: mockCountExec });

  function createAuditModelMock() {
    const ctor = jest.fn().mockReturnValue({ save: mockSave });
    Object.assign(ctor, { find: mockFind, countDocuments: mockCountDocuments });
    return ctor;
  }

  beforeEach(async () => {
    mockFind.mockClear();
    mockSort.mockClear();
    mockSkip.mockClear();
    mockLimit.mockClear();
    mockLean.mockReset();
    mockCountDocuments.mockClear();
    mockCountExec.mockReset();
    mockSave.mockReset();
    mockExec.mockReset();
    mockFindByIdAndUpdate.mockReturnValue({ exec: mockExec });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MongoService,
        { provide: getModelToken(Log.name), useValue: createModelMock() },
        { provide: getModelToken(EmailLog.name), useValue: createModelMock() },
        { provide: getModelToken(AuditEvent.name), useValue: createAuditModelMock() },
      ],
    }).compile();

    service = module.get<MongoService>(MongoService);
  });

  describe('createLog', () => {
    it('should create a log document and call save', async () => {
      const savedLog = { _id: 'log-1', method: 'GET', url: '/test' };
      mockSave.mockResolvedValue(savedLog);

      const result = await service.createLog({ method: 'GET', url: '/test' });

      expect(mockSave).toHaveBeenCalled();
      expect(result).toEqual(savedLog);
    });
  });

  describe('updateLog', () => {
    it('should call findByIdAndUpdate and return the updated document', async () => {
      const updated = { _id: 'log-1', statusCode: 200 };
      mockExec.mockResolvedValue(updated);

      const result = await service.updateLog('log-1', { statusCode: 200 } as Partial<Log>);

      expect(mockFindByIdAndUpdate).toHaveBeenCalledWith(
        'log-1',
        { statusCode: 200 },
        { returnDocument: 'after' },
      );
      expect(result).toEqual(updated);
    });
  });

  describe('createEmailLog', () => {
    it('should create an email log document and call save', async () => {
      const savedLog = { _id: 'el-1', to: 'a@b.com' };
      mockSave.mockResolvedValue(savedLog);

      const result = await service.createEmailLog({ to: 'a@b.com' } as Partial<EmailLog>);

      expect(mockSave).toHaveBeenCalled();
      expect(result).toEqual(savedLog);
    });
  });

  describe('updateEmailLog', () => {
    it('should call findByIdAndUpdate and return the updated email log', async () => {
      const updated = { _id: 'el-1', status: 'sent' };
      mockExec.mockResolvedValue(updated);

      const result = await service.updateEmailLog('el-1', { status: 'sent' } as Partial<EmailLog>);

      expect(result).toEqual(updated);
    });
  });

  describe('createAuditEvent', () => {
    it('should create the event document and call save', async () => {
      const saved = { _id: 'ae-1', action: 'auth.sign-in' };
      mockSave.mockResolvedValue(saved);

      const result = await service.createAuditEvent({ action: 'auth.sign-in' } as Partial<AuditEvent>);

      expect(mockSave).toHaveBeenCalled();
      expect(result).toEqual(saved);
    });
  });

  describe('findAuditEvents', () => {
    const doc = (id: string) => ({ _id: { toString: () => id }, action: 'auth.sign-in', outcome: 'success' });

    it('queries newest first with skip/take and returns items with `id` plus the total', async () => {
      mockLean.mockResolvedValue([doc('a'), doc('b')]);
      mockCountExec.mockResolvedValue(7);

      const result = await service.findAuditEvents({}, 20, 10);

      expect(mockFind).toHaveBeenCalledWith({});
      expect(mockSort).toHaveBeenCalledWith({ occurredAt: -1 });
      expect(mockSkip).toHaveBeenCalledWith(20);
      expect(mockLimit).toHaveBeenCalledWith(10);
      expect(mockCountDocuments).toHaveBeenCalledWith({});
      expect(result.total).toBe(7);
      expect(result.items.map((e) => e.id)).toEqual(['a', 'b']);
      expect(result.items[0]).not.toHaveProperty('_id');
    });

    it('translates the filters into a Mongo query', async () => {
      mockLean.mockResolvedValue([]);
      mockCountExec.mockResolvedValue(0);
      const from = new Date('2026-01-01T00:00:00.000Z');
      const to = new Date('2026-02-01T00:00:00.000Z');

      await service.findAuditEvents(
        { actorId: 'u1', targetId: 'u2', action: 'admin.user.ban', outcome: 'failure', from, to },
        0,
        20,
      );

      const expected = {
        actorId: 'u1',
        targetId: 'u2',
        action: 'admin.user.ban',
        outcome: 'failure',
        occurredAt: { $gte: from, $lte: to },
      };
      expect(mockFind).toHaveBeenCalledWith(expected);
      expect(mockCountDocuments).toHaveBeenCalledWith(expected);
    });

    it('matches an email against the actor and against the attempted email of failed sign-ins', async () => {
      mockLean.mockResolvedValue([]);
      mockCountExec.mockResolvedValue(0);

      await service.findAuditEvents({ actorEmail: 'ana@example.com', outcome: 'failure' }, 0, 20);

      const expected = {
        outcome: 'failure',
        $or: [{ actorEmail: 'ana@example.com' }, { attemptedEmail: 'ana@example.com' }],
      };
      expect(mockFind).toHaveBeenCalledWith(expected);
      expect(mockCountDocuments).toHaveBeenCalledWith(expected);
    });

    it('supports a one-sided date range', async () => {
      mockLean.mockResolvedValue([]);
      mockCountExec.mockResolvedValue(0);
      const from = new Date('2026-01-01T00:00:00.000Z');

      await service.findAuditEvents({ from }, 0, 20);

      expect(mockFind).toHaveBeenCalledWith({ occurredAt: { $gte: from } });
    });
  });

  it('exposes no way to update or delete an audit event (immutability)', () => {
    const proto = Object.getOwnPropertyNames(MongoService.prototype);
    expect(proto.filter((m) => /audit/i.test(m)).sort()).toEqual(['createAuditEvent', 'findAuditEvents']);
  });
});
