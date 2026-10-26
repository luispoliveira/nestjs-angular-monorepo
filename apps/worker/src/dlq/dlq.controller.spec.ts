import { Test, TestingModule } from '@nestjs/testing';
import { QUEUES } from '@repo/shared';
import { DlqController } from './dlq.controller';
import { EmailDlqService } from './email.dlq.service';
import { PushDlqService } from './push.dlq.service';

describe('DlqController', () => {
  let controller: DlqController;
  let emailDlqService: jest.Mocked<EmailDlqService>;
  let pushDlqService: jest.Mocked<PushDlqService>;

  beforeEach(async () => {
    emailDlqService = {
      list: jest.fn(),
      replay: jest.fn().mockResolvedValue(undefined),
      purge: jest.fn(),
    } as unknown as jest.Mocked<EmailDlqService>;

    pushDlqService = {
      list: jest.fn(),
      replay: jest.fn().mockResolvedValue(undefined),
      purge: jest.fn(),
    } as unknown as jest.Mocked<PushDlqService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DlqController],
      providers: [
        { provide: EmailDlqService, useValue: emailDlqService },
        { provide: PushDlqService, useValue: pushDlqService },
      ],
    }).compile();

    controller = module.get<DlqController>(DlqController);
  });

  describe('list()', () => {
    it('should delegate to emailDlqService.list and return the result', async () => {
      const mockResult = { jobs: [], total: 0 };
      emailDlqService.list.mockResolvedValue(mockResult);

      const result = await controller.list({ page: 1, limit: 20 });

      expect(emailDlqService.list).toHaveBeenCalledWith(1, 20);
      expect(result).toEqual(mockResult);
    });

    it('should pass undefined page and limit when not provided', async () => {
      emailDlqService.list.mockResolvedValue({ jobs: [], total: 0 });

      await controller.list({});

      expect(emailDlqService.list).toHaveBeenCalledWith(undefined, undefined);
    });
  });

  describe('replay()', () => {
    it('should delegate to emailDlqService.replay and return success', async () => {
      const result = await controller.replay({ jobId: 'job-123' });

      expect(emailDlqService.replay).toHaveBeenCalledWith('job-123');
      expect(result).toEqual({ success: true });
    });
  });

  describe('purge()', () => {
    it('should delegate to emailDlqService.purge and return removed count', async () => {
      emailDlqService.purge.mockResolvedValue(5);

      const result = await controller.purge();

      expect(emailDlqService.purge).toHaveBeenCalled();
      expect(result).toEqual({ removed: 5 });
    });
  });

  describe('queue selection', () => {
    it('serves the push queue when the payload names it', async () => {
      pushDlqService.list.mockResolvedValue({ jobs: [], total: 3 });
      pushDlqService.purge.mockResolvedValue(4);

      await expect(
        controller.list({ queue: QUEUES.PUSH, page: 2, limit: 10 }),
      ).resolves.toEqual({ jobs: [], total: 3 });
      await controller.replay({ queue: QUEUES.PUSH, jobId: 'p-1' });
      await expect(controller.purge({ queue: QUEUES.PUSH })).resolves.toEqual({
        removed: 4,
      });

      expect(pushDlqService.list).toHaveBeenCalledWith(2, 10);
      expect(pushDlqService.replay).toHaveBeenCalledWith('p-1');
      expect(emailDlqService.list).not.toHaveBeenCalled();
      expect(emailDlqService.replay).not.toHaveBeenCalled();
      expect(emailDlqService.purge).not.toHaveBeenCalled();
    });

    it('serves the email queue when the payload names it', async () => {
      emailDlqService.list.mockResolvedValue({ jobs: [], total: 0 });

      await controller.list({ queue: QUEUES.EMAIL });

      expect(emailDlqService.list).toHaveBeenCalled();
      expect(pushDlqService.list).not.toHaveBeenCalled();
    });

    it('rejects an unknown queue and touches no queue', async () => {
      await expect(controller.list({ queue: 'other-queue' })).rejects.toThrow(
        /Unknown queue/,
      );
      await expect(
        controller.replay({ queue: 'other-queue', jobId: 'x' }),
      ).rejects.toThrow(/Unknown queue/);
      await expect(controller.purge({ queue: 'other-queue' })).rejects.toThrow(
        /Unknown queue/,
      );

      for (const service of [emailDlqService, pushDlqService]) {
        expect(service.list).not.toHaveBeenCalled();
        expect(service.replay).not.toHaveBeenCalled();
        expect(service.purge).not.toHaveBeenCalled();
      }
    });
  });
});
