import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailModule, type MailProviderName } from '@repo/mail';
import { QueueModule, QUEUES, SharedModule } from '@repo/shared';
import { BullBoardDashboardModule } from './bull-board/bull-board.module';
import { EmailConsumer } from './consumer/email.consumer';
import { workerEnvSchema } from './env';
import { DlqModule } from './dlq/dlq.module';
import { QueueMetricsService } from './metrics/queue-metrics.service';

@Module({
  imports: [
    SharedModule.register({
      validate: (c) => workerEnvSchema.parse(c),
      metrics: { appName: 'worker' },
    }),
    QueueModule.registerQueues([QUEUES.EMAIL]),
    MailModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const provider =
          configService.getOrThrow<MailProviderName>('MAIL_PROVIDER');
        return {
          provider,
          apiKey: configService.getOrThrow<string>(
            provider === 'resend' ? 'RESEND_API_KEY' : 'BREVO_API_KEY',
          ),
          fromEmail: configService.getOrThrow<string>('FROM_EMAIL'),
          fromName: configService.get<string>('FROM_NAME', ''),
          devEmail: configService.get<string>('DEV_EMAIL', ''),
        };
      },
      inject: [ConfigService],
    }),
    DlqModule,
    BullBoardDashboardModule,
  ],
  controllers: [],
  providers: [EmailConsumer, QueueMetricsService],
})
export class AppModule {}
