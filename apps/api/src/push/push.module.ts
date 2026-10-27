import { Module } from '@nestjs/common';
import { QueueModule, QUEUES } from '@repo/shared';
import { PushController } from './push.controller';
import { PushService } from './push.service';

@Module({
  imports: [QueueModule.registerQueues([QUEUES.PUSH])],
  controllers: [PushController],
  providers: [PushService],
})
export class PushModule {}
