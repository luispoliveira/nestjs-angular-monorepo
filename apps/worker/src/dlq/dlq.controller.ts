import { BadRequestException, Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { BaseDlqService, MESSAGE_PATTERNS, QUEUES } from '@repo/shared';
import { EmailDlqService } from './email.dlq.service';
import { PushDlqService } from './push.dlq.service';

/** `queue` names the work queue whose DLQ is meant; it defaults to email. */
interface DlqPayload {
  queue?: string;
}

interface DlqListPayload extends DlqPayload {
  page?: number;
  limit?: number;
}

interface DlqReplayPayload extends DlqPayload {
  jobId: string;
}

@Controller()
export class DlqController {
  private readonly services: Record<string, BaseDlqService>;

  constructor(
    emailDlqService: EmailDlqService,
    pushDlqService: PushDlqService,
  ) {
    this.services = {
      [QUEUES.EMAIL]: emailDlqService,
      [QUEUES.PUSH]: pushDlqService,
    };
  }

  private serviceFor(queue: string = QUEUES.EMAIL): BaseDlqService {
    const service = this.services[queue];
    if (!service) throw new BadRequestException(`Unknown queue: ${queue}`);
    return service;
  }

  @MessagePattern(MESSAGE_PATTERNS.DLQ_LIST)
  async list(payload: DlqListPayload) {
    return this.serviceFor(payload.queue).list(payload.page, payload.limit);
  }

  @MessagePattern(MESSAGE_PATTERNS.DLQ_REPLAY)
  async replay(payload: DlqReplayPayload) {
    await this.serviceFor(payload.queue).replay(payload.jobId);
    return { success: true };
  }

  @MessagePattern(MESSAGE_PATTERNS.DLQ_PURGE)
  async purge(payload?: DlqPayload) {
    const removed = await this.serviceFor(payload?.queue).purge();
    return { removed };
  }
}
