import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '@repo/database';
import {
  JOB_PATTERNS,
  QUEUES,
  SendPushNotificationInput,
  sendPushNotificationInputSchema,
  SentryUtil,
} from '@repo/shared';
import { Job, Queue } from 'bullmq';
import { sendNotification, WebPushError } from 'web-push';
import { QueueMetricsService } from '../metrics/queue-metrics.service';

/** The push service's answer for a subscription that no longer exists. */
const GONE = new Set([404, 410]);

/**
 * Delivers one push to every live subscription of its recipients.
 *
 * ponytail: one job fans out to all devices, so a retry re-sends to the ones
 * that already succeeded — invisible thanks to `tag`. Per-device jobs if
 * duplicates ever show.
 */
@Processor(QUEUES.PUSH)
export class PushConsumer extends WorkerHost {
  private readonly logger = new Logger(PushConsumer.name);
  private readonly vapidDetails: {
    subject: string;
    publicKey: string;
    privateKey: string;
  };

  constructor(
    private readonly db: DatabaseService,
    private readonly queueMetrics: QueueMetricsService,
    @InjectQueue(QUEUES.PUSH_DLQ) private readonly dlqQueue: Queue,
    config: ConfigService,
  ) {
    super();
    this.vapidDetails = {
      subject: config.getOrThrow<string>('VAPID_SUBJECT'),
      publicKey: config.getOrThrow<string>('VAPID_PUBLIC_KEY'),
      privateKey: config.getOrThrow<string>('VAPID_PRIVATE_KEY'),
    };
  }

  async process(job: Job): Promise<void> {
    if (job.name !== JOB_PATTERNS.SEND_PUSH_NOTIFICATION) {
      this.logger.warn(`No handler for job ${job.id} with name ${job.name}`);
      return;
    }
    const push = sendPushNotificationInputSchema.parse(job.data);
    const subscriptions = await this.db.pushSubscription.findMany({
      where: { userId: { in: push.userIds }, deletedAt: null },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    if (subscriptions.length === 0) return;

    const payload = JSON.stringify(PushConsumer.ngswPayload(push));
    const results = await Promise.allSettled(
      subscriptions.map((subscription) =>
        sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          payload,
          { vapidDetails: this.vapidDetails },
        ),
      ),
    );

    const gone: string[] = [];
    const failures: unknown[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') return;
      if (
        result.reason instanceof WebPushError &&
        GONE.has(result.reason.statusCode)
      ) {
        gone.push(subscriptions[index]!.id);
      } else {
        failures.push(result.reason);
      }
    });

    if (gone.length > 0) {
      await this.db.pushSubscription.updateMany({
        where: { id: { in: gone } },
        data: { deletedAt: new Date() },
      });
    }
    // Dead subscriptions are cleaned first, so a retry only re-tries the rest.
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `${failures.length}/${subscriptions.length} push deliveries failed`,
      );
    }
  }

  /**
   * `ngsw-worker.js` only shows a push wrapped in `notification`, and opens
   * its url through `data.onActionClick`.
   */
  static ngswPayload(push: SendPushNotificationInput) {
    return {
      notification: {
        title: push.title,
        body: push.body,
        icon: '/icons/icon-192.png',
        ...(push.tag ? { tag: push.tag, renotify: true } : {}),
        data: {
          onActionClick: {
            default: { operation: 'navigateLastFocusedOrOpen', url: push.url },
          },
        },
      },
    };
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job): void {
    const durationMs =
      (job.finishedOn ?? Date.now()) - (job.processedOn ?? Date.now());
    this.queueMetrics.recordDuration(job.name, durationMs, QUEUES.PUSH);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error): void {
    this.queueMetrics.recordFailure(job.name, QUEUES.PUSH);
    SentryUtil.captureException(error, {
      extra: { jobId: job.id, jobName: job.name, data: job.data },
      tags: { queue: QUEUES.PUSH, app: 'worker' },
    });

    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade >= maxAttempts) {
      void this.dlqQueue.add(job.name, job.data, {
        removeOnFail: { count: 1000, age: 2592000 },
        removeOnComplete: true,
      });
    }
  }
}
