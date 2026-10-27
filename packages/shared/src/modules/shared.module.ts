import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { TerminusModule } from '@nestjs/terminus';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { DatabaseModule } from '@repo/database';
import { SentryModule } from '@sentry/nestjs/setup';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import z from 'zod';
import { AuditService } from '../audit/audit.service';
import { CLS_CORRELATION_ID } from '../constants';
import { AllExceptionFilter } from '../filters';
import { HealthController } from '../health/health.controller';
import { CorrelationInterceptor, LoggingInterceptor } from '../interceptors';
import { pinoConfig } from '../logging';
import { ContextUtil } from '../utils/context.util';
import { HttpMetricsInterceptor, MetricsModule } from '../metrics';
import { MongoModule } from '../mongo/mongo.module';

const sharedModuleRegisterParamsSchema = z.object({
  throttlerOptions: z
    .object({
      ttl: z.number(),
      limit: z.number(),
    })
    .optional(),
  throttlerRedisUrl: z.string().optional(),
  metrics: z
    .object({
      appName: z.string(),
    })
    .optional(),
});

type SharedModuleRegisterParams = z.infer<
  typeof sharedModuleRegisterParamsSchema
> & {
  validate?: (config: Record<string, unknown>) => Record<string, unknown>;
};

const defaultParams: SharedModuleRegisterParams = {
  throttlerOptions: {
    ttl: 60000,
    limit: 10,
  },
};

@Module({})
export class SharedModule {
  static register(params = defaultParams): DynamicModule {
    return {
      global: true,
      module: SharedModule,
      imports: [
        // Names Sentry transactions after Nest routes. No SentryGlobalFilter:
        // AllExceptionFilter already captures 5xx/RPC errors.
        SentryModule.forRoot(),
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env',
          validate: params.validate,
        }),
        DatabaseModule,
        TerminusModule.forRoot({
          errorLogStyle: 'pretty',
        }),
        MongoModule,
        LoggerModule.forRoot(pinoConfig),
        ThrottlerModule.forRootAsync({
          useFactory: () => {
            const throttlerOptions =
              params.throttlerOptions ?? defaultParams.throttlerOptions!;
            return {
              throttlers: [{ name: 'default', ...throttlerOptions }],
              ...(params.throttlerRedisUrl
                ? {
                    storage: new ThrottlerStorageRedisService(
                      params.throttlerRedisUrl,
                    ),
                  }
                : {}),
            };
          },
        }),
        ClsModule.forRoot({
          global: true,
          middleware: {
            mount: true,
            setup(cls, req: Request, _res: Response) {
              const correlationId = ContextUtil.newCorrelationId();
              cls.set(CLS_CORRELATION_ID, correlationId);
              (req as unknown as Record<string, unknown>)[CLS_CORRELATION_ID] =
                correlationId;
            },
          },
          interceptor: {
            mount: true,
          },
        }),
        MetricsModule.register(params.metrics ?? {}),
      ],
      providers: [
        AuditService,
        {
          provide: APP_FILTER,
          useClass: AllExceptionFilter,
        },
        {
          provide: APP_INTERCEPTOR,
          useClass: LoggingInterceptor,
        },
        {
          provide: APP_INTERCEPTOR,
          useClass: CorrelationInterceptor,
        },
        {
          provide: APP_PIPE,
          useClass: ZodValidationPipe,
        },
        {
          provide: APP_INTERCEPTOR,
          useClass: ZodSerializerInterceptor,
        },
        {
          provide: APP_INTERCEPTOR,
          useClass: HttpMetricsInterceptor,
        },
      ],
      controllers: [HealthController],
      exports: [AuditService],
    };
  }
}
