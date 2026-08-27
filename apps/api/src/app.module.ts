import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ClientsModule } from '@nestjs/microservices';
import {
  MicroserviceAuthGuard,
  MicroserviceUtil,
  SharedModule,
} from '@repo/shared';
import { AppController } from './app.controller';
import { apiEnvSchema } from './env';

@Module({
  imports: [
    SharedModule.register({
      validate: (c) => apiEnvSchema.parse(c),
      metrics: { appName: 'api' },

      throttlerRedisUrl: process.env.REDIS_URL,
    }),
    ClientsModule.registerAsync([MicroserviceUtil.registerAuthService()]),
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: MicroserviceAuthGuard,
    },
  ],
})
export class AppModule {}
