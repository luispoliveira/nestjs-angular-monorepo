import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { BaseDlqService, QUEUES } from '@repo/shared';
import { Queue } from 'bullmq';

@Injectable()
export class PushDlqService extends BaseDlqService {
  constructor(
    @InjectQueue(QUEUES.PUSH_DLQ) dlqQueue: Queue,
    @InjectQueue(QUEUES.PUSH) originalQueue: Queue,
  ) {
    super(dlqQueue, originalQueue);
  }
}
