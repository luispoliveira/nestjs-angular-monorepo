import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ClientsModule } from '@nestjs/microservices';
import { DatabaseSeederModule } from '@repo/database';
import {
  AuditContextGuard,
  AuditInterceptor,
  MicroserviceAuthGuard,
  MicroserviceUtil,
  RolesGuard,
  SharedModule,
} from '@repo/shared';
import { AppController } from './app.controller';
import { AuditEventsController } from './audit/audit-events.controller';
import { CustomersModule } from './customers/customers.module';
import { apiEnvSchema } from './env';
import { PushModule } from './push/push.module';

@Module({
  imports: [
    SharedModule.register({
      validate: (c) => apiEnvSchema.parse(c),
      metrics: { appName: 'api' },

      throttlerRedisUrl: process.env.REDIS_URL,
    }),
    ClientsModule.registerAsync([MicroserviceUtil.registerAuthService()]),
    DatabaseSeederModule,
    CustomersModule,
    PushModule,
  ],
  controllers: [AppController, AuditEventsController],
  providers: [
    // Must stay FIRST: global guards run in registration order, and this one
    // has to copy the @Audit metadata onto the request before a later guard
    // can reject it with a 401/403 (design.md → D5).
    {
      provide: APP_GUARD,
      useClass: AuditContextGuard,
    },
    {
      provide: APP_GUARD,
      useClass: MicroserviceAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
