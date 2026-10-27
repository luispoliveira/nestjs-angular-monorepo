import { Module } from '@nestjs/common';
import { QueueModule, QUEUES } from '@repo/shared';
import { DlqController } from './dlq.controller';
import { EmailDlqService } from './email.dlq.service';
import { PushDlqService } from './push.dlq.service';

@Module({
  imports: [QueueModule.registerQueues([QUEUES.EMAIL, QUEUES.PUSH])],
  providers: [EmailDlqService, PushDlqService],
  controllers: [DlqController],
  exports: [EmailDlqService, PushDlqService],
})
export class DlqModule {}
