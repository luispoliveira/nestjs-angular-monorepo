import { getQueueToken } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '@repo/database';
import { JOB_PATTERNS, QUEUES } from '@repo/shared';
import { Job } from 'bullmq';
import { sendNotification, WebPushError } from 'web-push';
import { QueueMetricsService } from '../metrics/queue-metrics.service';
import { PushConsumer } from './push.consumer';

jest.mock('web-push', () => {
  class WebPushError extends Error {
    constructor(
      message: string,
      readonly statusCode: number,
    ) {
      super(message);
    }
  }
  return { sendNotification: jest.fn(), WebPushError };
});

const send = sendNotification as jest.Mock;

const push = {
  userIds: ['u1'],
  title: 'Hello',
  body: 'World',
  url: '/account',
  tag: 'test',
};

const subs = [
  { id: 's1', endpoint: 'https://push.test/1', p256dh: 'k1', auth: 'a1' },
  { id: 's2', endpoint: 'https://push.test/2', p256dh: 'k2', auth: 'a2' },
];

const jobOf = (
  data: unknown,
  name: string = JOB_PATTERNS.SEND_PUSH_NOTIFICATION,
) => ({ id: 'job-1', name, data }) as unknown as Job;

describe('PushConsumer', () => {
  let consumer: PushConsumer;
  let db: {
    pushSubscription: { findMany: jest.Mock; updateMany: jest.Mock };
  };
  let metrics: { recordDuration: jest.Mock; recordFailure: jest.Mock };
  let dlq: { add: jest.Mock };

  beforeEach(async () => {
    db = {
      pushSubscription: {
        findMany: jest.fn().mockResolvedValue(subs),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    metrics = { recordDuration: jest.fn(), recordFailure: jest.fn() };
    dlq = { add: jest.fn().mockResolvedValue(undefined) };
    send.mockReset().mockResolvedValue({ statusCode: 201 });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const config = {
      getOrThrow: jest.fn((key: string) => `value-of-${key}`),
    } as unknown as ConfigService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PushConsumer,
        { provide: DatabaseService, useValue: db },
        { provide: QueueMetricsService, useValue: metrics },
        { provide: getQueueToken(QUEUES.PUSH_DLQ), useValue: dlq },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    consumer = module.get(PushConsumer);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('process()', () => {
    it('delivers to every live subscription of the recipients', async () => {
      await consumer.process(jobOf(push));

      expect(db.pushSubscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: { in: ['u1'] }, deletedAt: null },
        }),
      );
      expect(send).toHaveBeenCalledTimes(2);
      expect(
        send.mock.calls.map((c: [{ endpoint: string }]) => c[0].endpoint),
      ).toEqual(['https://push.test/1', 'https://push.test/2']);
      expect(send.mock.calls[0]![0].keys).toEqual({ p256dh: 'k1', auth: 'a1' });
    });

    it('signs with the VAPID details from config', async () => {
      await consumer.process(jobOf(push));
      expect(send.mock.calls[0]![2]).toEqual({
        vapidDetails: {
          subject: 'value-of-VAPID_SUBJECT',
          publicKey: 'value-of-VAPID_PUBLIC_KEY',
          privateKey: 'value-of-VAPID_PRIVATE_KEY',
        },
      });
    });

    it('sends the ngsw notification payload as JSON', async () => {
      await consumer.process(jobOf(push));
      expect(JSON.parse(send.mock.calls[0]![1] as string)).toEqual(
        PushConsumer.ngswPayload(push),
      );
    });

    it('sends nothing and does not fail for a recipient without subscriptions', async () => {
      db.pushSubscription.findMany.mockResolvedValue([]);
      await expect(consumer.process(jobOf(push))).resolves.toBeUndefined();
      expect(send).not.toHaveBeenCalled();
      expect(db.pushSubscription.updateMany).not.toHaveBeenCalled();
    });

    it.each([404, 410])(
      'removes a subscription the push service reports gone (%i) and still delivers to the others',
      async (statusCode) => {
        send
          .mockRejectedValueOnce(
            new WebPushError('gone', statusCode, {}, '', ''),
          )
          .mockResolvedValueOnce({ statusCode: 201 });

        await expect(consumer.process(jobOf(push))).resolves.toBeUndefined();

        expect(send).toHaveBeenCalledTimes(2);
        expect(db.pushSubscription.updateMany).toHaveBeenCalledWith({
          where: { id: { in: ['s1'] } },
          data: { deletedAt: expect.any(Date) },
        });
      },
    );

    it('fails the job on any other delivery error, after cleaning up the gone ones', async () => {
      send
        .mockRejectedValueOnce(new WebPushError('gone', 410, {}, '', ''))
        .mockRejectedValueOnce(
          new WebPushError('unavailable', 503, {}, '', ''),
        );

      await expect(consumer.process(jobOf(push))).rejects.toThrow(
        /1\/2 push deliveries failed/,
      );
      expect(db.pushSubscription.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['s1'] } },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('rejects an invalid payload without touching the database', async () => {
      await expect(
        consumer.process(jobOf({ ...push, url: 'https://evil.example/' })),
      ).rejects.toThrow();
      expect(db.pushSubscription.findMany).not.toHaveBeenCalled();
    });

    it('warns and does nothing for an unknown job name', async () => {
      await consumer.process(jobOf(push, 'job:something_else'));
      expect(send).not.toHaveBeenCalled();
      expect(Logger.prototype.warn).toHaveBeenCalled();
    });
  });

  describe('ngswPayload()', () => {
    it('wraps the push in `notification` and opens its url through onActionClick', () => {
      expect(PushConsumer.ngswPayload(push)).toEqual({
        notification: {
          title: 'Hello',
          body: 'World',
          icon: '/icons/icon-192.png',
          tag: 'test',
          renotify: true,
          data: {
            onActionClick: {
              default: {
                operation: 'navigateLastFocusedOrOpen',
                url: '/account',
              },
            },
          },
        },
      });
    });

    it('leaves out tag and renotify when the push has no tag', () => {
      const untagged: Partial<typeof push> & Omit<typeof push, 'tag'> = {
        ...push,
      };
      delete untagged.tag;
      const { notification } = PushConsumer.ngswPayload(untagged);
      expect(notification).not.toHaveProperty('tag');
      expect(notification).not.toHaveProperty('renotify');
    });
  });

  describe('worker events', () => {
    it('records the duration under the push queue when a job completes', () => {
      consumer.onCompleted({
        name: JOB_PATTERNS.SEND_PUSH_NOTIFICATION,
        processedOn: 1000,
        finishedOn: 1250,
      } as unknown as Job);
      expect(metrics.recordDuration).toHaveBeenCalledWith(
        JOB_PATTERNS.SEND_PUSH_NOTIFICATION,
        250,
        QUEUES.PUSH,
      );
    });

    const failedJob = (attemptsMade: number) =>
      ({
        id: 'job-9',
        name: JOB_PATTERNS.SEND_PUSH_NOTIFICATION,
        data: push,
        attemptsMade,
        opts: { attempts: 3 },
      }) as unknown as Job;

    it('records a failure and keeps the job out of the DLQ while retries remain', () => {
      consumer.onFailed(failedJob(2), new Error('boom'));
      expect(metrics.recordFailure).toHaveBeenCalledWith(
        JOB_PATTERNS.SEND_PUSH_NOTIFICATION,
        QUEUES.PUSH,
      );
      expect(dlq.add).not.toHaveBeenCalled();
    });

    it('moves the job to the push dead-letter queue after the last attempt', () => {
      consumer.onFailed(failedJob(3), new Error('boom'));
      expect(dlq.add).toHaveBeenCalledWith(
        JOB_PATTERNS.SEND_PUSH_NOTIFICATION,
        push,
        expect.objectContaining({ removeOnComplete: true }),
      );
    });
  });
});
