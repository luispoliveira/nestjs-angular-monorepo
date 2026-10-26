import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QUEUES } from '../constants';
import { EmailProducer, PushProducer } from './producers';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    BullModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.getOrThrow<string>('REDIS_HOST'),
          port: configService.getOrThrow<number>('REDIS_PORT'),
          password: configService.get<string>('REDIS_PASSWORD') || undefined,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: true,
          removeOnFail: 500,
        },
      }),
      inject: [ConfigService],
    }),
  ],
})
export class QueueModule {
  static registerQueues(queues: string[]): DynamicModule {
    const mainQueues = queues.map((queue) =>
      BullModule.registerQueue({ name: queue }),
    );
    const dlqQueues = queues.map((queue) =>
      BullModule.registerQueue({
        name: `${queue}-dlq`,
        defaultJobOptions: {
          removeOnFail: { count: 1000, age: 2592000 },
          removeOnComplete: true,
        },
      }),
    );
    const allQueues = [...mainQueues, ...dlqQueues];
    // A producer injects its own queue, so it is only provided where that
    // queue is registered.
    const producers = [
      ...(queues.includes(QUEUES.EMAIL) ? [EmailProducer] : []),
      ...(queues.includes(QUEUES.PUSH) ? [PushProducer] : []),
    ];
    return {
      imports: allQueues,
      providers: producers,
      exports: [...producers, ...allQueues],
      module: QueueModule,
    };
  }
}
