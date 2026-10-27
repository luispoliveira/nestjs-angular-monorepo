import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ClsService } from 'nestjs-cls';
import { BaseProducer } from '../../abstracts';
import { JOB_PATTERNS, QUEUES } from '../../constants';
import {
  SendPushNotificationInput,
  sendPushNotificationInputSchema,
} from '../input';

/**
 * The one producer every push notification type uses — a new type needs no
 * new job pattern, method or consumer branch.
 */
@Injectable()
export class PushProducer extends BaseProducer {
  constructor(
    @InjectQueue(QUEUES.PUSH) pushQueue: Queue,
    protected clsService: ClsService,
  ) {
    super(pushQueue, clsService);
  }

  /** Parsed here so a caller's bad payload (e.g. an absolute `url`) fails at its source, not in the worker. */
  async send(payload: SendPushNotificationInput) {
    await this.addJob(
      JOB_PATTERNS.SEND_PUSH_NOTIFICATION,
      sendPushNotificationInputSchema.parse(payload),
    );
  }
}
