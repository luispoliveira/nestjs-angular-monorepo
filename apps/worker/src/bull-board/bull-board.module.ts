import { ExpressAdapter } from '@bull-board/express';
import { BullBoardModule } from '@bull-board/nestjs';
import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { ClientProxy } from '@nestjs/microservices';
import { MicroserviceUtil, QUEUES, SERVICES } from '@repo/shared';
import { BULL_BOARD_ROUTE } from '../bootstrap.config';
import { bullBoardAuth } from './bull-board-auth.middleware';
import { RedactingBullMQAdapter } from './redacting-bullmq.adapter';

/**
 * Read-only queue dashboard for admins. Replay and purge of DLQ jobs stay on
 * the DLQ_* message patterns: the dashboard's own retry would re-run a job
 * inside the DLQ (which has no consumer) or duplicate one already copied there.
 */
@Module({
  imports: [
    BullBoardModule.forRootAsync({
      imports: [
        ClientsModule.registerAsync([MicroserviceUtil.registerAuthService()]),
      ],
      inject: [SERVICES.AUTH],
      useFactory: (authClient: ClientProxy) => ({
        route: BULL_BOARD_ROUTE,
        adapter: ExpressAdapter,
        middleware: bullBoardAuth(authClient),
      }),
    }),
    BullBoardModule.forFeature(
      {
        name: QUEUES.EMAIL,
        adapter: RedactingBullMQAdapter,
        options: { readOnlyMode: true },
      },
      {
        name: QUEUES.EMAIL_DLQ,
        adapter: RedactingBullMQAdapter,
        options: { readOnlyMode: true },
      },
      {
        name: QUEUES.PUSH,
        adapter: RedactingBullMQAdapter,
        options: { readOnlyMode: true },
      },
      {
        name: QUEUES.PUSH_DLQ,
        adapter: RedactingBullMQAdapter,
        options: { readOnlyMode: true },
      },
    ),
  ],
})
export class BullBoardDashboardModule {}
