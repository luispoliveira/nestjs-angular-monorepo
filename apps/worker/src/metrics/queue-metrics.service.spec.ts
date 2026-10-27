import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { QUEUES } from '@repo/shared';
import { Queue } from 'bullmq';
import { Gauge } from 'prom-client';
import { QueueMetricsService } from './queue-metrics.service';

jest.mock('prom-client', () => ({
  Histogram: jest.fn().mockReturnValue({ observe: jest.fn() }),
  Counter: jest.fn().mockReturnValue({ inc: jest.fn() }),
  Gauge: jest.fn().mockReturnValue({ set: jest.fn() }),
}));

describe('QueueMetricsService', () => {
  let service: QueueMetricsService;
  let mockQueue: jest.Mocked<Pick<Queue, 'getJobCounts'>>;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockQueue = {
      getJobCounts: jest
        .fn()
        .mockResolvedValue({ waiting: 2, active: 1, delayed: 0, failed: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueMetricsService,
        { provide: getQueueToken(QUEUES.EMAIL), useValue: mockQueue },
        { provide: getQueueToken(QUEUES.EMAIL_DLQ), useValue: mockQueue },
        { provide: getQueueToken(QUEUES.PUSH), useValue: mockQueue },
        { provide: getQueueToken(QUEUES.PUSH_DLQ), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<QueueMetricsService>(QueueMetricsService);
    service.onModuleInit();
  });

  describe('onModuleInit() — Gauge collect callback', () => {
    it('should call set with job counts from the queue', async () => {
      const GaugeMock = Gauge as jest.Mock;
      const collectFn = GaugeMock.mock.calls[0][0]
        .collect as () => Promise<void>;
      const setMock = GaugeMock.mock.results[0]!.value.set as jest.Mock;

      await collectFn.call({ set: setMock });

      expect(setMock).toHaveBeenCalledWith(
        { queue: QUEUES.EMAIL, state: 'waiting' },
        2,
      );
      expect(setMock).toHaveBeenCalledWith(
        { queue: QUEUES.EMAIL, state: 'active' },
        1,
      );
    });

    it('should fall back to 0 when count properties are undefined', async () => {
      (mockQueue.getJobCounts as jest.Mock).mockResolvedValue({});
      const GaugeMock = Gauge as jest.Mock;
      const collectFn = GaugeMock.mock.calls[0][0]
        .collect as () => Promise<void>;
      const setMock = jest.fn();

      await collectFn.call({ set: setMock });

      expect(setMock).toHaveBeenCalledWith(
        { queue: QUEUES.EMAIL, state: 'waiting' },
        0,
      );
    });
  });

  describe('onModuleInit() — push queues', () => {
    it('reports the depth of the push queue and of its dead-letter queue', async () => {
      const GaugeMock = Gauge as jest.Mock;
      const collectFn = GaugeMock.mock.calls[0][0]
        .collect as () => Promise<void>;
      const setMock = jest.fn();

      await collectFn.call({ set: setMock });

      expect(setMock).toHaveBeenCalledWith(
        { queue: QUEUES.PUSH, state: 'waiting' },
        2,
      );
      expect(setMock).toHaveBeenCalledWith(
        { queue: QUEUES.PUSH_DLQ, state: 'waiting' },
        2,
      );
    });
  });

  describe('recordDuration()', () => {
    it('should observe the histogram with job name and duration converted to seconds', () => {
      const histogram = (service as unknown as Record<string, unknown>)
        .durationHistogram as { observe: jest.Mock };

      service.recordDuration('send-welcome-email', 1500);

      expect(histogram.observe).toHaveBeenCalledWith(
        { queue: QUEUES.EMAIL, job_name: 'send-welcome-email' },
        1.5,
      );
    });
  });

  describe('queue label', () => {
    it('labels a duration with the push queue when one is given', () => {
      const histogram = (service as unknown as Record<string, unknown>)
        .durationHistogram as { observe: jest.Mock };

      service.recordDuration('job:send_push_notification', 500, QUEUES.PUSH);

      expect(histogram.observe).toHaveBeenCalledWith(
        { queue: QUEUES.PUSH, job_name: 'job:send_push_notification' },
        0.5,
      );
    });

    it('labels a failure with the push queue when one is given', () => {
      const counter = (service as unknown as Record<string, unknown>)
        .failureCounter as { inc: jest.Mock };

      service.recordFailure('job:send_push_notification', QUEUES.PUSH);

      expect(counter.inc).toHaveBeenCalledWith({
        queue: QUEUES.PUSH,
        job_name: 'job:send_push_notification',
      });
    });
  });

  describe('recordFailure()', () => {
    it('should increment the counter with job name labels', () => {
      const counter = (service as unknown as Record<string, unknown>)
        .failureCounter as { inc: jest.Mock };

      service.recordFailure('send-password-reset-email');

      expect(counter.inc).toHaveBeenCalledWith({
        queue: QUEUES.EMAIL,
        job_name: 'send-password-reset-email',
      });
    });
  });
});
